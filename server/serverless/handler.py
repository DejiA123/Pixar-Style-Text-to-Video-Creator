#!/usr/bin/env python3
"""Storyreel AI server as a RunPod Serverless worker.

The same models and code as server/storyreel_server.py, but RunPod starts and
stops the GPU: a worker exists only while films are being made. Models live on
the endpoint's network volume (/runpod-volume), so a cold start loads them
instead of downloading them again.

Job input:  {"op": "health" | "image" | "video" | "tts" | "lipsync" | "script", ...the same fields as the HTTP API}
Job output: {"mime": "image/png" | "video/mp4" | "audio/wav" | "application/json", "data": base64} or, for health,
            {"image", "video", "tts", "lipsync", "gpu"}; {"error": "..."} on failure
            (for tts, "unknown ref_key" means: send the reference clip itself again).

Local test without a GPU: STORYREEL_MOCK=1 python server/serverless/handler.py --test_input '{"input": {"op": "health"}}'
"""
import base64, io, os, subprocess, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # server/
VOLUME = '/runpod-volume' if os.path.isdir('/runpod-volume') else os.environ.get('STORYREEL_DATA', '/tmp/storyreel')
os.environ.setdefault('HF_HOME', os.path.join(VOLUME, 'hf'))  # models stay on the volume between workers

import runpod  # noqa: E402
import storyreel_server as S  # noqa: E402

LATENTSYNC = os.environ.get('STORYREEL_LATENTSYNC_DIR', '/opt/LatentSync')
LS_PYTHON = os.environ.get('STORYREEL_LATENTSYNC_PYTHON', '/opt/lsvenv/bin/python')
lipsync = {'state': 'off', 'proc': None}  # off | starting | failed (ready is asked of the worker itself)


def start_lipsync():
    """LatentSync runs in its own Python (built into the image); its checkpoints live on the volume."""
    if not (os.path.isdir(LATENTSYNC) and os.path.exists(LS_PYTHON)):
        print('[storyreel] lip sync not in this image', flush=True)
        return
    lipsync['state'] = 'starting'
    try:
        ckpt = os.path.join(VOLUME, 'latentsync', 'checkpoints')
        os.makedirs(ckpt, exist_ok=True)
        link = os.path.join(LATENTSYNC, 'checkpoints')
        if not os.path.islink(link):
            if os.path.isdir(link):
                os.rename(link, link + '.image')
            os.symlink(ckpt, link)
        env = {**os.environ, 'HF_HUB_ENABLE_HF_TRANSFER': '0'}  # not installed in the lip-sync environment
        subprocess.run([LS_PYTHON, '-c', "from huggingface_hub import hf_hub_download as d; "
                        "[d('ByteDance/LatentSync-1.6', f, local_dir='checkpoints') for f in ('latentsync_unet.pt', 'whisper/tiny.pt')]"],
                       cwd=LATENTSYNC, check=True, env=env)
        lipsync['proc'] = subprocess.Popen([LS_PYTHON, '-u', os.path.join(os.path.dirname(HERE), 'lipsync_worker.py'), '--port', '7862'], cwd=LATENTSYNC, env=env)
        print('[storyreel] lip sync starting', flush=True)
    except Exception as e:
        lipsync['state'] = 'failed'
        print(f'[storyreel] lip sync unavailable ({e})', flush=True)


def wait_for_lipsync(seconds):
    """Wait only while lip sync is still starting on this worker; give up at once if it failed."""
    t = time.time()
    while time.time() - t < seconds:
        S._lipsync['t'] = 0  # don't use the cached answer
        if S.lipsync_ready():
            return True
        p = lipsync['proc']
        if lipsync['state'] != 'starting' or (p is not None and p.poll() is not None):
            return False
        time.sleep(3)
    return False


def warm_up():
    if os.environ.get('STORYREEL_MOCK') == '1':
        S.state.update(mock=True, loading=None)
        return
    t = time.time()
    if os.environ.get('STORYREEL_LIPSYNC', 'auto') != '0':
        threading.Thread(target=start_lipsync, daemon=True).start()
    S.load_models(want_video=True)  # also loads the dialogue writer
    S.state['loading'] = None
    print(f'[storyreel] worker ready in {time.time() - t:.0f}s', flush=True)


def b64(req, key):
    return base64.b64decode(S.re.sub(r'^data:[^,]+,', '', req.get(key, '')))


def handler(job):
    req = job.get('input') or {}
    op = req.get('op')
    t0 = time.time()
    try:
        if op == 'health':
            return {'image': bool(S.state['image']) or S.state['mock'], 'video': bool(S.state['video']) or S.state['mock'],
                    'tts': bool(S.state['tts']) or S.state['mock'], 'lipsync': S.lipsync_ready(), 'gpu': S.state['gpu'],
                    'writer': S.writer.state['status'] == 'ready' or S.state['mock']}
        if op == 'image':
            im = S.make_image(str(req.get('prompt', ''))[:1500], int(req.get('width', 1024)), int(req.get('height', 576)), int(req.get('seed', 1)) % (2 ** 31))
            buf = io.BytesIO(); im.save(buf, 'PNG')
            body, mime = buf.getvalue(), 'image/png'
        elif op == 'video':
            body, mime = S.video_from_request(req), 'video/mp4'
        elif op == 'tts':
            ref = b64(req, 'ref') if req.get('ref') else None
            try:
                body = S.make_speech(str(req.get('text', '')), ref, req.get('ref_key'), float(req.get('emotion', 0.3)), int(req.get('seed', 1)) % (2 ** 31))
            except KeyError:  # this worker hasn't heard that voice yet
                return {'error': 'unknown ref_key'}
            mime = 'audio/wav'
        elif op == 'script':
            body, mime = S.script_from_request(req), 'application/json'
        elif op == 'lipsync':
            # a worker that just started may still be loading LatentSync: give it a few minutes
            if not (S.lipsync_ready() or wait_for_lipsync(300)):
                return {'error': 'lip sync not available'}
            body, mime = S.lipsync_from_request(req), 'video/mp4'
        else:
            return {'error': f'unknown op {op!r}'}
        print(f'[storyreel] {op} in {time.time() - t0:.1f}s', flush=True)
        return {'mime': mime, 'data': base64.b64encode(body).decode()}
    except Exception as e:
        print(f'[storyreel] {op} failed: {e}', flush=True)
        return {'error': str(e)[:500]}


if __name__ == '__main__':
    warm_up()  # load the models before taking jobs
    runpod.serverless.start({'handler': handler})
