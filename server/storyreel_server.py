#!/usr/bin/env python3
"""Storyreel AI server: unlimited AI images and AI video on your own (or a rented) GPU.

Runs open models and serves them to the Storyreel app (phone or browser). No
accounts, no quotas, no watermarks.

  image: SDXL-Turbo                    (stabilityai/sdxl-turbo)                 ~7 GB VRAM
  voice: Chatterbox                    (ResembleAI/chatterbox)                  ~4 GB VRAM
         realistic, emotional speech in the voice of a short reference clip
  lips:  LatentSync 1.6                (ByteDance/LatentSync-1.6)               ~18 GB VRAM
         re-renders the mouth so it matches the words; runs in its own Python
         environment as server/lipsync_worker.py (set up by server/runpod/start.sh)
  words: Qwen3-4B-Instruct-2507        (Qwen/Qwen3-4B-Instruct-2507)            ~8 GB, borrows the GPU while writing
         writes what the characters say in each scene (server/writer.py)
  video: LTX-Video 0.9.8 13B distilled (Lightricks/LTX-Video-0.9.8-13B-distilled)
         24 GB cards (RTX 4090/3090) run it with fp8 weights; 48 GB cards (A40, L40S) in bf16
         with CPU offload; 80 GB cards keep everything on the card

Usage:
  pip install -r server/requirements.txt
  python server/storyreel_server.py                 # http://0.0.0.0:7860
  python server/storyreel_server.py --tunnel        # also opens a free HTTPS link for your phone
  python server/storyreel_server.py --idle-stop 15  # on RunPod: stop the pod after 15 idle minutes
  python server/storyreel_server.py --mock          # no GPU: placeholder output, to test the app

API (CORS open; JSON in, media out):
  GET  /health -> {"ok", "ready", "loading", "image", "video", "jobs", "device", "stats", "price_per_hour"}
  POST /image  {"prompt", "width", "height", "seed"}                         -> image/png
  POST /video  {"prompt", "image": data-URL, "width", "height", "seconds", "seed"} -> video/mp4
  POST /video/start  (same body)  -> {"id"}         start a clip in the background
  GET  /video/result?id=…         -> 202 {"status"} while working, then video/mp4
       (use the job API behind proxies that cut requests after ~100 s, like RunPod's and Cloudflare's)
  POST /tts    {"text", "ref": data-URL wav, or "ref_key": sha1 of one sent before, "emotion": 0..1, "seed"} -> audio/wav
  POST /lipsync/start {"video": data-URL mp4, "audio": data-URL wav} -> {"id"}
  GET  /lipsync/result?id=…       -> 202 while working, then video/mp4 (500 if no face was found)
  POST /script/start {"title", "story", "cast", "scenes"} -> {"id"}   the characters' dialogue (see server/writer.py)
  GET  /script/result?id=…        -> 202 while working, then {"scenes": [{"index", "lines": [{"speaker", "text"}]}]}
"""
import argparse, base64, io, json, os, re, shutil, subprocess, sys, tempfile, threading, time, uuid, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import writer

IMAGE_MODEL = os.environ.get('STORYREEL_IMAGE_MODEL', 'stabilityai/sdxl-turbo')
VIDEO_MODEL = os.environ.get('STORYREEL_VIDEO_MODEL', 'Lightricks/LTX-Video-0.9.8-13B-distilled')
NEGATIVE = 'worst quality, static, still image, frozen, no motion, inconsistent motion, blurry, jittery, distorted, deformed, text, watermark'
# the distilled LTX models are tuned for these exact timesteps (diffusers docs)
DISTILLED_TIMESTEPS = [1000, 993, 987, 981, 975, 909, 725, 0.03]
PRICE = float(os.environ.get('STORYREEL_GPU_PRICE', '0') or 0)  # your GPU's $/hour, for cost reports
LIPSYNC_URL = os.environ.get('STORYREEL_LIPSYNC_URL', 'http://127.0.0.1:7862')  # lipsync_worker.py

gpu_lock = threading.Lock()  # one generation at a time on the GPU
state = {'image': None, 'video': None, 'video_kind': None, 'tts': None, 'device': 'cpu', 'gpu': '', 'mock': False,
         'loading': 'starting', 'error': None, 'last_use': time.time()}
stats = {'images': 0, 'videos': 0, 'video_seconds': 0.0, 'lines': 0, 'lipsyncs': 0, 'busy_seconds': 0.0, 'since': time.time()}
jobs = {}  # id -> {'status', 'body', 'type', 'error', 't'}


def snap(v, m, lo, hi):
    return int(max(lo, min(hi, round(v / m) * m)))


def fetch_model(repo):
    """Download only the pipeline's own files. Some repos carry extra copies in nested
    folders (LTX 0.9.8's vae/ holds a whole second model, ~45 GB) that a plain
    from_pretrained would also fetch."""
    if os.path.isdir(repo):
        return repo
    from huggingface_hub import hf_hub_download, snapshot_download
    index = json.load(open(hf_hub_download(repo, 'model_index.json')))
    parts = [k for k, v in index.items() if not k.startswith('_') and isinstance(v, list)]
    return snapshot_download(repo, allow_patterns=['model_index.json'] + [f'{c}/*' for c in parts],
                             ignore_patterns=[f'{c}/*/*' for c in parts] + ['*.bin', '*.msgpack', '*.onnx*'])


def memory_gb():
    """RAM this container may use (its cgroup limit, else the machine's)."""
    for f in ('/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes'):
        try:
            v = open(f).read().strip()
            if v.isdigit() and int(v) < 1 << 50:
                return int(v) / 2**30
        except OSError:
            pass
    return os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES') / 2**30


def memory_use():
    """RAM/GPU numbers for /health, to see how close a card or machine is to its limit."""
    m = {'ram_limit_gb': round(memory_gb(), 1)}
    for f in ('/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory/memory.usage_in_bytes'):
        try:
            m['ram_used_gb'] = round(int(open(f).read()) / 2**30, 1)
            break
        except (OSError, ValueError):
            pass
    try:
        for line in open('/proc/self/status'):
            if line.startswith(('VmRSS', 'VmHWM')):
                m['process_' + line.split(':')[0].lower() + '_gb'] = round(int(line.split()[1]) / 2**20, 1)
    except OSError:
        pass
    try:
        import torch
        if torch.cuda.is_available():
            m['gpu_used_gb'] = round(torch.cuda.memory_allocated() / 2**30, 1)
            m['gpu_peak_gb'] = round(torch.cuda.max_memory_allocated() / 2**30, 1)
    except Exception:
        pass
    return m


def free_memory():
    """Hand freed loading buffers back to the system so RAM use doesn't creep up."""
    import gc, ctypes
    gc.collect()
    try:
        import torch
        torch.cuda.empty_cache()
    except Exception:
        pass
    try:
        ctypes.CDLL('libc.so.6').malloc_trim(0)
    except Exception:
        pass


def load_models(want_video=True):
    import torch
    from diffusers import AutoPipelineForText2Image, DiffusionPipeline
    dev = 'cuda' if torch.cuda.is_available() else ('mps' if torch.backends.mps.is_available() else 'cpu')
    state['device'] = dev
    vram = torch.cuda.get_device_properties(0).total_memory / 2**30 if dev == 'cuda' else 0
    if dev == 'cuda':
        state['gpu'] = f'{torch.cuda.get_device_name(0)} {vram:.0f} GB'
    ram = memory_gb()
    print(f'[storyreel] {vram:.0f} GB GPU memory, {ram:.0f} GB RAM', flush=True)
    # Under 70 GB of GPU memory the 13B video weights are stored in fp8 (13 GB instead of 26).
    # 24 GB cards swap the models between RAM and the card for each step; 48 GB cards keep
    # the whole video model on the card, so system RAM only holds the image model.
    small = dev == 'cuda' and vram < 70
    offload_video = dev == 'cuda' and vram < 40
    offload = dev == 'cuda' and vram < 70  # the image model waits in RAM until it paints
    dtype = torch.float16 if dev != 'cpu' else torch.float32
    state['loading'] = 'downloading the image model'
    print(f'[storyreel] loading image model {IMAGE_MODEL} on {dev} {state["gpu"]}…', flush=True)
    img = AutoPipelineForText2Image.from_pretrained(IMAGE_MODEL, torch_dtype=dtype, variant='fp16' if dtype == torch.float16 else None)
    if offload and want_video:
        img.enable_model_cpu_offload()  # leave the card to the video model between pictures
    else:
        img.to(dev)
    state['image'] = img
    if want_video:
        state['loading'] = 'downloading the video model (about 40 GB the first time)'
        try:
            src = fetch_model(VIDEO_MODEL)
            kind = DiffusionPipeline.load_config(src).get('_class_name', '')
            print(f'[storyreel] loading video model {VIDEO_MODEL} ({kind})…', flush=True)
            vdtype = torch.bfloat16 if dev == 'cuda' else dtype
            if kind == 'LTXConditionPipeline':  # LTX-Video 0.9.5+ (0.9.8 distilled by default)
                from diffusers import LTXConditionPipeline, LTXVideoTransformer3DModel
                tr = None
                if dev == 'cuda' and not offload_video:  # straight onto the card, never through RAM
                    try:
                        tr = LTXVideoTransformer3DModel.from_pretrained(src, subfolder='transformer', torch_dtype=vdtype, device_map='cuda')
                    except Exception as e:
                        print(f'[storyreel] loading via RAM instead ({e})', flush=True)
                if tr is None:
                    tr = LTXVideoTransformer3DModel.from_pretrained(src, subfolder='transformer', torch_dtype=vdtype)
                if small:  # 13B weights stored in fp8 (13 GB) and computed in bf16
                    tr.enable_layerwise_casting(storage_dtype=torch.float8_e4m3fn, compute_dtype=vdtype)
                vid = LTXConditionPipeline.from_pretrained(src, transformer=tr, torch_dtype=vdtype)
            else:  # older LTX-Video (0.9.1)
                from diffusers import LTXImageToVideoPipeline
                vid = LTXImageToVideoPipeline.from_pretrained(src, torch_dtype=vdtype)
            if offload_video:
                vid.enable_model_cpu_offload()
            else:
                vid.to(dev)
            if dev == 'cuda':
                vid.vae.enable_tiling()
            state['video'], state['video_kind'] = vid, kind
            free_memory()
        except Exception as e:  # image-only servers still help a lot
            print(f'[storyreel] video model unavailable ({e}); serving images only', flush=True)
            state['error'] = f'video model failed to load: {e}'
    load_tts(dev)
    state['loading'] = None
    print('[storyreel] ready', flush=True)
    if os.environ.get('STORYREEL_WRITER', '1') != '0':
        writer.load()  # the dialogue writer last: films can start while it loads


def load_tts(dev):
    state['loading'] = 'loading the voice model'
    try:
        from chatterbox.tts import ChatterboxTTS
        m = ChatterboxTTS.from_pretrained(device=dev)
        state['tts'], state['tts_default'], state['tts_refs'] = m, m.conds, {}
        print('[storyreel] voice model ready', flush=True)
    except Exception as e:  # films still get the in-browser voices
        print(f'[storyreel] voice model unavailable ({e})', flush=True)


def wav_bytes(samples, sr):
    """Float samples (-1..1) to a 16-bit mono WAV file."""
    import wave, numpy as np
    pcm = (np.clip(np.asarray(samples, dtype=np.float32), -1, 1) * 32767).astype('<i2')
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())
    return buf.getvalue()


def make_speech(text, ref, ref_key, emotion, seed):
    """Speech for one line in the voice of a reference clip (WAV bytes, or the sha1 ref_key of one sent
    before), emotion: 0 calm .. 1 intense. Raises KeyError for an unknown ref_key without the clip."""
    import hashlib
    text = re.sub(r'\s+', ' ', text).strip()[:1200]
    if state['mock']:  # a soft tone as long as the line would take to say
        import numpy as np
        t = np.arange(int(24000 * max(0.6, len(text) * 0.065))) / 24000
        return wav_bytes(0.2 * np.sin(2 * np.pi * 220 * t) * (np.sin(2 * np.pi * 3 * t) > 0), 24000)
    import torch, numpy as np
    m = state['tts']
    exaggeration = 0.35 + 0.6 * max(0.0, min(1.0, emotion))  # Chatterbox: 0.5 is neutral, higher is more dramatic
    cfg = 0.5 - 0.25 * max(0.0, min(1.0, emotion))            # lower cfg slows dramatic lines down a little
    # long narration in pieces of a few sentences, so nothing gets cut off
    parts, cur = [], ''
    for sent in re.split(r'(?<=[.!?])\s+', text):
        if cur and len(cur) + len(sent) > 280:
            parts.append(cur); cur = sent
        else:
            cur = (cur + ' ' + sent).strip()
    if cur:
        parts.append(cur)
    out = []
    with gpu_lock:
        key = hashlib.sha1(ref).hexdigest() if ref else ref_key
        if key and key not in state['tts_refs'] and not ref:
            raise KeyError(key)
        if key:
            if key not in state['tts_refs']:
                path = tempfile.NamedTemporaryFile(suffix='.wav', delete=False).name
                open(path, 'wb').write(ref)
                m.prepare_conditionals(path, exaggeration=exaggeration)
                os.unlink(path)
                state['tts_refs'][key] = m.conds
            m.conds = state['tts_refs'][key]
        else:
            m.conds = state['tts_default']
        for i, p in enumerate(parts):
            torch.manual_seed(int(seed) + i)
            w = m.generate(p, exaggeration=exaggeration, cfg_weight=cfg)
            out.append(w.squeeze(0).cpu().numpy())
            out.append(np.zeros(int(m.sr * 0.18), dtype=np.float32))
    return wav_bytes(np.concatenate(out[:-1]), m.sr)


_lipsync = {'ok': False, 't': 0}


def lipsync_ready():
    """Is the LatentSync worker up? (checked at most every 15 s)"""
    if state['mock']:
        return True
    if time.time() - _lipsync['t'] > 15:
        try:
            _lipsync['ok'] = json.load(urllib.request.urlopen(LIPSYNC_URL + '/health', timeout=2)).get('ok', False)
        except Exception:
            _lipsync['ok'] = False
        _lipsync['t'] = time.time()
    return _lipsync['ok']


def make_lipsync(video, audio):
    """Re-render the speaking face's mouth in an MP4 to match a WAV. Raises if no face is found."""
    if state['mock']:
        return video
    d = tempfile.mkdtemp()
    vin, ain, out = os.path.join(d, 'in.mp4'), os.path.join(d, 'in.wav'), os.path.join(d, 'out.mp4')
    open(vin, 'wb').write(video); open(ain, 'wb').write(audio)
    try:
        with gpu_lock:
            req = urllib.request.Request(LIPSYNC_URL + '/sync', json.dumps({'video': vin, 'audio': ain, 'out': out}).encode(),
                                         {'Content-Type': 'application/json'})
            try:
                res = json.load(urllib.request.urlopen(req, timeout=900))
            except urllib.error.HTTPError as e:
                res = json.load(e)
        if not res.get('ok'):
            raise RuntimeError(res.get('error', 'lip sync failed'))
        return open(out, 'rb').read()
    finally:
        shutil.rmtree(d, ignore_errors=True)


def make_image(prompt, width, height, seed):
    from PIL import Image, ImageDraw
    w, h = snap(width, 64, 256, 1280), snap(height, 64, 256, 1280)
    if state['mock']:
        folder = os.environ.get('STORYREEL_MOCK_IMAGES')
        pics = sorted(f for f in os.listdir(folder) if f.lower().endswith(('.png', '.jpg', '.jpeg'))) if folder else []
        if pics:  # test mode: hand out real pictures from a folder
            return Image.open(os.path.join(folder, pics[seed % len(pics)])).convert('RGB').resize((w, h))
        im = Image.new('RGB', (w, h), (40 + seed % 150, 70, 120))
        ImageDraw.Draw(im).text((20, 20), prompt[:120], fill=(255, 255, 255))
        return im
    import torch
    g = torch.Generator(device='cpu').manual_seed(int(seed))
    with gpu_lock:
        return state['image'](prompt=prompt, width=w, height=h, num_inference_steps=4, guidance_scale=0.0, generator=g).images[0]


def make_video(prompt, image, width, height, seconds, seed):
    w, h = snap(width, 32, 256, 960), snap(height, 32, 256, 960)
    frames = int(max(2, min(10, seconds)) * 24) // 8 * 8 + 1  # LTX wants 8k+1 frames
    out = tempfile.NamedTemporaryFile(suffix='.mp4', delete=False).name
    if state['mock']:
        if not shutil.which('ffmpeg'):
            raise RuntimeError('mock video needs ffmpeg')
        src = tempfile.NamedTemporaryFile(suffix='.png', delete=False).name
        image.resize((w, h)).save(src)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-i', src, '-vf', f"zoompan=z='1+0.002*on':d={frames}:s={w}x{h}:fps=24",
                        '-frames:v', str(frames), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', out], check=True)
        os.unlink(src)
        time.sleep(float(os.environ.get('STORYREEL_MOCK_DELAY', '0')))
        return out
    import torch
    from diffusers.utils import export_to_video
    g = torch.Generator(device='cpu').manual_seed(int(seed))
    image = image.resize((w, h))
    with gpu_lock:
        if state['video_kind'] == 'LTXConditionPipeline':
            from diffusers.pipelines.ltx.pipeline_ltx_condition import LTXVideoCondition
            from diffusers.utils import load_video
            # the model was trained on video: give it the picture as a 1-frame compressed clip
            first = tempfile.NamedTemporaryFile(suffix='.mp4', delete=False).name
            export_to_video([image], first, fps=24)
            cond = LTXVideoCondition(video=load_video(first), frame_index=0)
            os.unlink(first)
            res = state['video'](conditions=[cond], prompt=prompt, negative_prompt=NEGATIVE, width=w, height=h,
                                 num_frames=frames, frame_rate=24, timesteps=DISTILLED_TIMESTEPS, guidance_scale=1.0,
                                 guidance_rescale=0.7, decode_timestep=0.05, decode_noise_scale=0.025,
                                 image_cond_noise_scale=0.0, generator=g)
        else:
            res = state['video'](image=image, prompt=prompt, negative_prompt=NEGATIVE, width=w, height=h,
                                 num_frames=frames, num_inference_steps=30, guidance_scale=3.0, generator=g)
    export_to_video(res.frames[0], out, fps=24)
    return out


def video_from_request(req):
    from PIL import Image
    data = re.sub(r'^data:[^,]+,', '', req.get('image', ''))
    im = Image.open(io.BytesIO(base64.b64decode(data))).convert('RGB')
    seconds = float(req.get('seconds', 4))
    t0 = time.time()
    path = make_video(str(req.get('prompt', ''))[:1500], im, int(req.get('width', 768)), int(req.get('height', 448)),
                      seconds, int(req.get('seed', 1)) % (2 ** 31))
    with open(path, 'rb') as f:
        body = f.read()
    os.unlink(path)
    took = time.time() - t0
    free_memory()
    stats['videos'] += 1; stats['video_seconds'] += seconds; stats['busy_seconds'] += took
    cost = f' (≈${took / 3600 * PRICE:.4f})' if PRICE else ''
    print(f'[storyreel] video {seconds:.0f}s clip in {took:.1f}s{cost}', flush=True)
    return body


def lipsync_from_request(req):
    t0 = time.time()
    body = make_lipsync(base64.b64decode(re.sub(r'^data:[^,]+,', '', req.get('video', ''))),
                        base64.b64decode(re.sub(r'^data:[^,]+,', '', req.get('audio', ''))))
    took = time.time() - t0
    free_memory()
    stats['lipsyncs'] += 1; stats['busy_seconds'] += took
    print(f'[storyreel] lip sync in {took:.1f}s', flush=True)
    return body


def script_from_request(req):
    t0 = time.time()
    body = json.dumps(writer.write(req, gpu_lock, mock=state['mock'])).encode()
    stats['busy_seconds'] += time.time() - t0
    return body


def start_job(fn, req, ctype='video/mp4'):
    jid = uuid.uuid4().hex
    jobs[jid] = {'status': 'running', 'body': None, 'error': None, 't': time.time(), 'ctype': ctype}
    threading.Thread(target=run_job, args=(jid, fn, req), daemon=True).start()
    return jid


def run_job(jid, fn, req):
    try:
        jobs[jid]['body'] = fn(req)
        jobs[jid]['status'] = 'done'
    except Exception as e:
        print(f'[storyreel] {fn.__name__} job error', e, flush=True)
        jobs[jid]['status'], jobs[jid]['error'] = 'error', str(e)
    finally:
        state['last_use'] = time.time()
    for k in [k for k, j in jobs.items() if time.time() - j['t'] > 3600]:  # forget hour-old jobs
        jobs.pop(k, None)


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
        url = urlparse(self.path)
        if url.path == '/health':
            mock = state['mock']
            return self._json(200, {'ok': True, 'ready': not state['loading'], 'loading': state['loading'], 'error': state['error'],
                                    'image': bool(state['image']) or mock, 'video': bool(state['video']) or (mock and not state.get('novideo')),
                                    'tts': bool(state['tts']) or mock, 'lipsync': not state['loading'] and lipsync_ready(),
                                    'lipsync_state': 'ready' if (not state['loading'] and lipsync_ready()) else ('setting up' if os.environ.get('STORYREEL_LIPSYNC_ON') == '1' else 'off'),
                                    'writer': writer.state['status'] == 'ready' or mock, 'writer_state': 'ready' if mock else writer.state['status'],
                                    'jobs': True, 'device': state['device'], 'gpu': state['gpu'], 'mock': mock, 'name': 'storyreel-server',
                                    'stats': {**stats, 'busy_seconds': round(stats['busy_seconds'], 1)}, 'memory': memory_use(), 'price_per_hour': PRICE})
        if url.path in ('/video/result', '/lipsync/result', '/script/result'):
            jid = (parse_qs(url.query).get('id') or [''])[0]
            job = jobs.get(jid)
            if not job:
                return self._json(404, {'error': 'unknown job'})
            if job['status'] == 'running':
                return self._json(202, {'status': 'running', 'elapsed': round(time.time() - job['t'], 1)})
            if job['status'] == 'error':
                return self._json(500, {'error': job['error']})
            jobs.pop(jid, None)
            return self._send(200, job['body'], job.get('ctype', 'video/mp4'))
        self._json(404, {'error': 'not found'})

    def do_POST(self):
        state['last_use'] = time.time()
        try:
            n = int(self.headers.get('Content-Length') or 0)
            req = json.loads(self.rfile.read(n) or b'{}')
            path = urlparse(self.path).path
            if state['loading'] and not state['mock']:
                return self._json(503, {'error': f'server is starting: {state["loading"]}'})
            if path == '/image':
                t0 = time.time()
                im = make_image(str(req.get('prompt', ''))[:1500], int(req.get('width', 1024)), int(req.get('height', 576)), int(req.get('seed', 1)) % (2 ** 31))
                buf = io.BytesIO(); im.save(buf, 'PNG')
                took = time.time() - t0
                stats['images'] += 1; stats['busy_seconds'] += took
                print(f'[storyreel] image {took:.1f}s', flush=True)
                return self._send(200, buf.getvalue(), 'image/png')
            if path in ('/video', '/video/start'):
                if not (state['video'] or state['mock']) or (state['mock'] and state.get('novideo')):
                    return self._json(503, {'error': 'video model not loaded'})
                if path == '/video':
                    return self._send(200, video_from_request(req), 'video/mp4')
                return self._json(200, {'id': start_job(video_from_request, req)})
            if path == '/tts':
                if not (state['tts'] or state['mock']):
                    return self._json(503, {'error': 'voice model not loaded'})
                t0 = time.time()
                ref = base64.b64decode(re.sub(r'^data:[^,]+,', '', req['ref'])) if req.get('ref') else None
                try:
                    body = make_speech(str(req.get('text', '')), ref, req.get('ref_key'), float(req.get('emotion', 0.3)), int(req.get('seed', 1)) % (2 ** 31))
                except KeyError:  # the server restarted and forgot this voice: send the clip again
                    return self._json(409, {'error': 'unknown ref_key'})
                took = time.time() - t0
                stats['lines'] += 1; stats['busy_seconds'] += took
                return self._send(200, body, 'audio/wav')
            if path == '/script/start':
                if not (writer.state['status'] == 'ready' or state['mock']):
                    return self._json(503, {'error': f"dialogue writer is {writer.state['status']}"})
                return self._json(200, {'id': start_job(script_from_request, req, 'application/json')})
            if path == '/lipsync/start':
                if not lipsync_ready():
                    return self._json(503, {'error': 'lip sync not available'})
                return self._json(200, {'id': start_job(lipsync_from_request, req)})
            self._json(404, {'error': 'not found'})
        except Exception as e:
            print('[storyreel] error', e, flush=True)
            self._json(500, {'error': str(e)})
        finally:
            state['last_use'] = time.time()

    def log_message(self, *a):
        pass


def stop_pod(action):
    """Stop (or remove) this RunPod pod so an idle GPU never bills you."""
    pod = os.environ.get('RUNPOD_POD_ID')
    if not pod:
        print('[storyreel] idle, but this is not a RunPod pod; not stopping anything', flush=True)
        return False
    if shutil.which('runpodctl'):
        r = subprocess.run(['runpodctl', action, 'pod', pod], capture_output=True, text=True)
        print(f'[storyreel] runpodctl {action} pod: {(r.stdout or r.stderr).strip()}', flush=True)
        if r.returncode == 0:
            return True
    key = os.environ.get('RUNPOD_API_KEY')
    if key:  # fall back to RunPod's GraphQL API with the pod's own key
        q = f'mutation {{ podStop(input: {{podId: "{pod}"}}) {{ id }} }}' if action == 'stop' else f'mutation {{ podTerminate(input: {{podId: "{pod}"}}) }}'
        try:
            req = urllib.request.Request(f'https://api.runpod.io/graphql?api_key={key}', json.dumps({'query': q}).encode(), {'Content-Type': 'application/json'})
            print('[storyreel] RunPod API:', urllib.request.urlopen(req, timeout=30).read().decode()[:200], flush=True)
            return True
        except Exception as e:
            print('[storyreel] RunPod API stop failed:', e, flush=True)
    print('[storyreel] could not stop the pod by itself: stop it in the RunPod app to stop paying', flush=True)
    return False


def idle_watch(minutes, action):
    while True:
        time.sleep(30)
        busy = state['loading'] or any(j['status'] == 'running' for j in jobs.values()) or gpu_lock.locked()
        if busy:
            state['last_use'] = time.time()
        elif time.time() - state['last_use'] > minutes * 60:
            print(f'[storyreel] idle for {minutes} min → {action} pod', flush=True)
            if stop_pod(action):
                return
            state['last_use'] = time.time()  # try again after another idle period


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


def runpod_link(port):
    pod = os.environ.get('RUNPOD_POD_ID')
    if pod:
        print(f'\n[storyreel] PHONE LINK → paste into Storyreel Settings → "Your AI server":\n    https://{pod}-{port}.proxy.runpod.net\n', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=7860)
    ap.add_argument('--mock', action='store_true', help='no GPU needed: placeholder output for testing')
    ap.add_argument('--no-video', action='store_true', help='images only (smaller GPUs)')
    ap.add_argument('--tunnel', action='store_true', help='open a free HTTPS link (cloudflared) for phones')
    ap.add_argument('--idle-stop', type=float, default=0, metavar='MIN', help='RunPod: stop the pod after MIN idle minutes (0 = never)')
    ap.add_argument('--idle-action', choices=['stop', 'remove'], default='stop', help='stop keeps the pod (and its link) for next time; remove deletes it')
    a = ap.parse_args()
    state['mock'] = a.mock
    state['novideo'] = a.no_video
    # serve straight away so the app can show "starting…" while models download
    srv = ThreadingHTTPServer(('0.0.0.0', a.port), Handler)
    print(f'[storyreel] serving on http://localhost:{a.port}  (mock={a.mock})', flush=True)
    runpod_link(a.port)
    if a.tunnel:
        open_tunnel(a.port)
    if a.mock:  # STORYREEL_MOCK_STARTUP=seconds pretends to download models first
        threading.Timer(float(os.environ.get('STORYREEL_MOCK_STARTUP', '0')), lambda: state.update(loading=None)).start()
    else:
        def load():
            try:
                load_models(want_video=not a.no_video)
            except Exception as e:
                state['loading'], state['error'] = None, f'models failed to load: {e}'
                print('[storyreel] models failed to load:', e, flush=True)
        threading.Thread(target=load, daemon=True).start()
    if a.idle_stop > 0:
        threading.Thread(target=idle_watch, args=(a.idle_stop, a.idle_action), daemon=True).start()
    srv.serve_forever()


if __name__ == '__main__':
    main()
