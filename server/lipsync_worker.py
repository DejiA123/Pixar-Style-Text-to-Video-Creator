#!/usr/bin/env python3
"""LatentSync lip-sync worker for the Storyreel AI server.

Runs inside LatentSync's own Python environment (it pins older libraries than
the main server), from the LatentSync repository folder, and listens on
localhost only. The main server sends it one job at a time:

  GET  /health -> {"ok": true}
  POST /sync   {"video": path.mp4, "audio": path.wav, "out": path.mp4} -> {"ok": true} | {"ok": false, "error"}

server/runpod/start.sh sets it up and starts it.
"""
import argparse, json, os, sys, tempfile, time, traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.getcwd())  # the LatentSync repository
pipe = {}


def load(config_path, ckpt, steps, guidance, deepcache):
    import torch
    from omegaconf import OmegaConf
    from diffusers import AutoencoderKL, DDIMScheduler
    from latentsync.models.unet import UNet3DConditionModel
    from latentsync.pipelines.lipsync_pipeline import LipsyncPipeline
    from latentsync.whisper.audio2feature import Audio2Feature
    config = OmegaConf.load(config_path)
    dtype = torch.float16 if torch.cuda.get_device_capability()[0] > 7 else torch.float32
    whisper = 'checkpoints/whisper/small.pt' if config.model.cross_attention_dim == 768 else 'checkpoints/whisper/tiny.pt'
    audio_encoder = Audio2Feature(model_path=whisper, device='cuda', num_frames=config.data.num_frames,
                                  audio_feat_length=config.data.audio_feat_length)
    vae = AutoencoderKL.from_pretrained('stabilityai/sd-vae-ft-mse', torch_dtype=dtype)
    vae.config.scaling_factor = 0.18215
    vae.config.shift_factor = 0
    unet, _ = UNet3DConditionModel.from_pretrained(OmegaConf.to_container(config.model), ckpt, device='cpu')
    p = LipsyncPipeline(vae=vae, audio_encoder=audio_encoder, unet=unet.to(dtype=dtype),
                        scheduler=DDIMScheduler.from_pretrained('configs')).to('cuda')
    if deepcache:  # about 1.5x faster for a small loss in detail
        from DeepCache import DeepCacheSDHelper
        helper = DeepCacheSDHelper(pipe=p)
        helper.set_params(cache_interval=3, cache_branch_id=0)
        helper.enable()
    pipe.update(p=p, config=config, dtype=dtype, steps=steps, guidance=guidance)


def sync(video, audio, out):
    import torch
    c = pipe['config']
    tmp = tempfile.mkdtemp()
    try:
        torch.manual_seed(1247)
        pipe['p'](video_path=video, audio_path=audio, video_out_path=out, num_frames=c.data.num_frames,
                  num_inference_steps=pipe['steps'], guidance_scale=pipe['guidance'], weight_dtype=pipe['dtype'],
                  width=c.data.resolution, height=c.data.resolution, mask_image_path=c.data.mask_image_path, temp_dir=tmp)
    finally:
        torch.cuda.empty_cache()
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        self._json(200 if pipe else 503, {'ok': bool(pipe)})

    def do_POST(self):
        try:
            req = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)))
            t = time.time()
            sync(req['video'], req['audio'], req['out'])
            print(f'[lipsync] done in {time.time() - t:.1f}s', flush=True)
            self._json(200, {'ok': True})
        except Exception as e:  # e.g. "Face not detected" on a frame: the caller keeps the original clip
            print('[lipsync] failed:', e, flush=True)
            traceback.print_exc()
            self._json(200, {'ok': False, 'error': str(e)[:300]})

    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=7862)
    ap.add_argument('--config', default='configs/unet/stage2_512.yaml')
    ap.add_argument('--ckpt', default='checkpoints/latentsync_unet.pt')
    ap.add_argument('--steps', type=int, default=20)
    ap.add_argument('--guidance', type=float, default=1.5)
    ap.add_argument('--no-deepcache', action='store_true')
    a = ap.parse_args()
    t = time.time()
    load(a.config, a.ckpt, a.steps, a.guidance, not a.no_deepcache)
    print(f'[lipsync] ready in {time.time() - t:.0f}s', flush=True)
    HTTPServer(('127.0.0.1', a.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
