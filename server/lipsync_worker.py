#!/usr/bin/env python3
"""LatentSync lip-sync worker for the Storyreel AI server.

Runs inside LatentSync's own Python environment (it pins older libraries than
the main server), from the LatentSync repository folder, and listens on
localhost only. The main server sends it one job at a time:

  GET  /health -> {"ok": true}
  POST /sync   {"video": path.mp4, "audio": path.wav, "out": path.mp4} -> {"ok": true} | {"ok": false, "error"}

server/runpod/start.sh sets it up and starts it.
"""
import argparse, json, os, sys, tempfile, threading, time, traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.getcwd())  # the LatentSync repository
pipe = {}
busy = threading.Lock()  # one lip sync at a time; /health still answers while one runs


def load(config_path, ckpt, steps, guidance, deepcache):
    import torch
    from omegaconf import OmegaConf
    from diffusers import AutoencoderKL, DDIMScheduler
    from latentsync.models.unet import UNet3DConditionModel
    from latentsync.pipelines.lipsync_pipeline import LipsyncPipeline
    tolerate_lost_faces(LipsyncPipeline)
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


def tolerate_lost_faces(P):
    """LatentSync gives up on a whole clip when one frame has no face it can find (a head turning,
    a hand in front). Here such frames borrow the nearest found face, so the model keeps its rhythm,
    and are then put back exactly as they were. A clip with no face in most frames is still refused."""
    import math
    import torch
    if getattr(P, '_storyreel_tolerant', False):
        return
    P._storyreel_tolerant = True
    orig_loop, orig_restore = P.loop_video, P.restore_video

    def affine_transform_video(self, video_frames):
        faces, boxes, mats, ok = [], [], [], []
        for frame in video_frames:
            try:
                face, box, m = self.image_processor.affine_transform(frame)
                faces.append(face); boxes.append(box); mats.append(m); ok.append(True)
            except RuntimeError as e:
                if 'Face not detected' not in str(e):
                    raise
                faces.append(None); boxes.append(None); mats.append(None); ok.append(False)
        found = [i for i, g in enumerate(ok) if g]
        if len(found) < 0.6 * len(ok):
            raise RuntimeError('Face not detected')
        for i, g in enumerate(ok):
            if not g:
                j = min(found, key=lambda k: abs(k - i))
                faces[i], boxes[i], mats[i] = faces[j], boxes[j], mats[j]
        self._face_ok = ok
        return torch.stack(faces), boxes, mats

    def loop_video(self, whisper_chunks, video_frames):
        n, L = len(video_frames), len(whisper_chunks)
        res = orig_loop(self, whisper_chunks, video_frames)
        ok = self._face_ok
        if L > n:  # LatentSync plays the clip forwards, backwards, forwards… to fit longer speech
            seq = []
            for k in range(math.ceil(L / n)):
                seq += ok if k % 2 == 0 else ok[::-1]
            ok = seq
        self._face_ok = ok[:L]
        return res

    def restore_video(self, faces, video_frames, boxes, affine_matrices):
        out = orig_restore(self, faces, video_frames, boxes, affine_matrices)
        for i, g in enumerate(getattr(self, '_face_ok', [])[:len(out)]):
            if not g:
                out[i] = video_frames[i]  # no face here: the frame as it was
        return out

    P.affine_transform_video, P.loop_video, P.restore_video = affine_transform_video, loop_video, restore_video


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
            with busy:
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
    ap.add_argument('--steps', type=int, default=int(os.environ.get('STORYREEL_LIPSYNC_STEPS', '10')))  # 20 is LatentSync's default: twice the GPU time
    ap.add_argument('--guidance', type=float, default=1.5)
    ap.add_argument('--no-deepcache', action='store_true')
    a = ap.parse_args()
    t = time.time()
    load(a.config, a.ckpt, a.steps, a.guidance, not a.no_deepcache)
    print(f'[lipsync] ready in {time.time() - t:.0f}s', flush=True)
    ThreadingHTTPServer(('127.0.0.1', a.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
