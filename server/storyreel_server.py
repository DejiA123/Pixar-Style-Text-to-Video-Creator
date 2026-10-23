#!/usr/bin/env python3
"""Storyreel AI server: unlimited, free AI images and AI video on your own GPU.

Runs open models on your computer and serves them to the Storyreel app (phone
or browser). No accounts, no quotas, no watermarks.

  image: SDXL-Turbo        (stabilityai/sdxl-turbo)        ~6 GB VRAM
  video: LTX-Video         (Lightricks/LTX-Video)          ~10-12 GB VRAM with CPU offload

Usage:
  pip install -r server/requirements.txt
  python server/storyreel_server.py                 # http://0.0.0.0:7860
  python server/storyreel_server.py --tunnel        # also opens a free HTTPS link for your phone
  python server/storyreel_server.py --mock          # no GPU: placeholder output, to test the app

API (CORS open; JSON in, media out):
  GET  /health -> {"ok": true, "image": bool, "video": bool, "device": "..."}
  POST /image  {"prompt", "width", "height", "seed"}                         -> image/png
  POST /video  {"prompt", "image": data-URL, "width", "height", "seconds", "seed"} -> video/mp4
"""
import argparse, base64, io, json, os, re, shutil, subprocess, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

IMAGE_MODEL = os.environ.get('STORYREEL_IMAGE_MODEL', 'stabilityai/sdxl-turbo')
VIDEO_MODEL = os.environ.get('STORYREEL_VIDEO_MODEL', 'Lightricks/LTX-Video')
NEGATIVE = 'worst quality, inconsistent motion, blurry, jittery, distorted, deformed, text, watermark'

gpu_lock = threading.Lock()  # one generation at a time on the GPU
state = {'image': None, 'video': None, 'device': 'cpu', 'mock': False}


def snap(v, m, lo, hi):
    return int(max(lo, min(hi, round(v / m) * m)))


def load_models(want_video=True):
    import torch
    from diffusers import AutoPipelineForText2Image
    dev = 'cuda' if torch.cuda.is_available() else ('mps' if torch.backends.mps.is_available() else 'cpu')
    state['device'] = dev
    dtype = torch.float16 if dev != 'cpu' else torch.float32
    print(f'[storyreel] loading image model {IMAGE_MODEL} on {dev}…', flush=True)
    img = AutoPipelineForText2Image.from_pretrained(IMAGE_MODEL, torch_dtype=dtype, variant='fp16' if dtype == torch.float16 else None)
    img.to(dev)
    state['image'] = img
    if want_video:
        try:
            from diffusers import LTXImageToVideoPipeline
            print(f'[storyreel] loading video model {VIDEO_MODEL}…', flush=True)
            vid = LTXImageToVideoPipeline.from_pretrained(VIDEO_MODEL, torch_dtype=torch.bfloat16 if dev == 'cuda' else dtype)
            if dev == 'cuda':
                vid.enable_model_cpu_offload()  # fits 10-12 GB cards
                vid.vae.enable_tiling()
            else:
                vid.to(dev)
            state['video'] = vid
        except Exception as e:  # image-only servers still help a lot
            print(f'[storyreel] video model unavailable ({e}); serving images only', flush=True)
    print('[storyreel] ready', flush=True)


def make_image(prompt, width, height, seed):
    from PIL import Image, ImageDraw
    w, h = snap(width, 64, 256, 1280), snap(height, 64, 256, 1280)
    if state['mock']:
        pics = sorted(f for f in os.listdir(os.environ.get('STORYREEL_MOCK_IMAGES', '.')) if f.lower().endswith(('.png', '.jpg', '.jpeg'))) if os.environ.get('STORYREEL_MOCK_IMAGES') else []
        if pics:  # test mode: hand out real pictures from a folder
            return Image.open(os.path.join(os.environ['STORYREEL_MOCK_IMAGES'], pics[seed % len(pics)])).convert('RGB').resize((w, h))
        im = Image.new('RGB', (w, h), (40 + seed % 150, 70, 120))
        ImageDraw.Draw(im).text((20, 20), prompt[:120], fill=(255, 255, 255))
        return im
    import torch
    g = torch.Generator(device='cpu').manual_seed(int(seed))
    with gpu_lock:
        return state['image'](prompt=prompt, width=w, height=h, num_inference_steps=4, guidance_scale=0.0, generator=g).images[0]


def make_video(prompt, image, width, height, seconds, seed):
    w, h = snap(width, 32, 256, 960), snap(height, 32, 256, 960)
    frames = int(max(2, min(8, seconds)) * 24) // 8 * 8 + 1  # LTX wants 8k+1 frames
    out = tempfile.NamedTemporaryFile(suffix='.mp4', delete=False).name
    if state['mock']:
        if not shutil.which('ffmpeg'):
            raise RuntimeError('mock video needs ffmpeg')
        src = tempfile.NamedTemporaryFile(suffix='.png', delete=False).name
        image.resize((w, h)).save(src)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-i', src, '-vf', f"zoompan=z='1+0.002*on':d={frames}:s={w}x{h}:fps=24",
                        '-frames:v', str(frames), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', out], check=True)
        return out
    import torch
    from diffusers.utils import export_to_video
    g = torch.Generator(device='cpu').manual_seed(int(seed))
    with gpu_lock:
        res = state['video'](image=image.resize((w, h)), prompt=prompt, negative_prompt=NEGATIVE, width=w, height=h,
                             num_frames=frames, num_inference_steps=30, guidance_scale=3.0, generator=g)
    export_to_video(res.frames[0], out, fps=24)
    return out


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def _send(self, code, body, ctype):
        self.send_response(code); self._cors()
        self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode(), 'application/json')

    def do_GET(self):
        if self.path.startswith('/health'):
            return self._json(200, {'ok': True, 'image': bool(state['image']) or state['mock'], 'video': bool(state['video']) or (state['mock'] and not state.get('novideo')),
                                    'device': state['device'], 'mock': state['mock'], 'name': 'storyreel-server'})
        self._json(404, {'error': 'not found'})

    def do_POST(self):
        try:
            n = int(self.headers.get('Content-Length') or 0)
            req = json.loads(self.rfile.read(n) or b'{}')
            prompt = str(req.get('prompt', ''))[:1500]
            seed = int(req.get('seed', 1)) % (2 ** 31)
            t0 = time.time()
            if self.path.startswith('/image'):
                im = make_image(prompt, int(req.get('width', 1024)), int(req.get('height', 576)), seed)
                buf = io.BytesIO(); im.save(buf, 'PNG')
                print(f'[storyreel] image {time.time() - t0:.1f}s', flush=True)
                return self._send(200, buf.getvalue(), 'image/png')
            if self.path.startswith('/video'):
                if not (state['video'] or state['mock']):
                    return self._json(503, {'error': 'video model not loaded'})
                from PIL import Image
                data = re.sub(r'^data:[^,]+,', '', req.get('image', ''))
                im = Image.open(io.BytesIO(base64.b64decode(data))).convert('RGB')
                path = make_video(prompt, im, int(req.get('width', 768)), int(req.get('height', 448)), float(req.get('seconds', 4)), seed)
                with open(path, 'rb') as f:
                    body = f.read()
                os.unlink(path)
                print(f'[storyreel] video {time.time() - t0:.1f}s', flush=True)
                return self._send(200, body, 'video/mp4')
            self._json(404, {'error': 'not found'})
        except Exception as e:
            print('[storyreel] error', e, flush=True)
            self._json(500, {'error': str(e)})

    def log_message(self, *a):
        pass


def open_tunnel(port):
    exe = shutil.which('cloudflared')
    if not exe:
        print('[storyreel] for a phone link, install cloudflared (free): https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/', flush=True)
        return
    p = subprocess.Popen([exe, 'tunnel', '--url', f'http://localhost:{port}', '--no-autoupdate'], stderr=subprocess.PIPE, text=True)

    def watch():
        for line in p.stderr:
            m = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', line)
            if m:
                print(f'\n[storyreel] PHONE LINK → paste into Storyreel Settings → "Your AI server":\n    {m.group(0)}\n', flush=True)
    threading.Thread(target=watch, daemon=True).start()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=7860)
    ap.add_argument('--mock', action='store_true', help='no GPU needed: placeholder output for testing')
    ap.add_argument('--no-video', action='store_true', help='images only (smaller GPUs)')
    ap.add_argument('--tunnel', action='store_true', help='open a free HTTPS link (cloudflared) for phones')
    a = ap.parse_args()
    state['mock'] = a.mock
    state['novideo'] = a.no_video
    if not a.mock:
        load_models(want_video=not a.no_video)
    srv = ThreadingHTTPServer(('0.0.0.0', a.port), Handler)
    print(f'[storyreel] serving on http://localhost:{a.port}  (mock={a.mock})', flush=True)
    if a.tunnel:
        open_tunnel(a.port)
    srv.serve_forever()


if __name__ == '__main__':
    main()
