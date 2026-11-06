"""Storyreel AI server on Modal (see server/MODAL.md): free monthly credits, per-second billing,
and nothing to start or stop. The GPU runs only while films are being made and shuts down
two minutes after the last request; the next film starts it again (a cold start of a few
minutes, while the models load from the volume).

  modal deploy server/modal_app.py      (or let .github/workflows/modal-deploy.yml do it)

The link is https://<your-modal-workspace>--storyreel-serve.modal.run: paste it into
Storyreel's Settings → Your AI server. Same API as a RunPod pod (server/storyreel_server.py).
"""
import os
import subprocess
import threading
import time

import modal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# the same image as the RunPod Serverless worker: models' libraries plus LatentSync in its own Python
# Modal runs its own side on Python 3.11 (add_python); the server itself runs on the image's
# Python, which has PyTorch, under the fixed name storyreel-python
image = modal.Image.from_dockerfile(os.path.join(ROOT, 'Dockerfile'), context_dir=ROOT, add_python='3.11')
models = modal.Volume.from_name('storyreel-models', create_if_missing=True)  # downloaded once, kept between runs
app = modal.App('storyreel')


# An 80 GB card keeps every model on it (no copying the picture model in and out for each picture,
# the video model in full precision): films are made several times faster than on a 48 GB L40S.
GPU = os.environ.get('STORYREEL_MODAL_GPU', 'H100')
PRICE = {'L40S': 1.95, 'A100-80GB': 2.50, 'H100': 3.95, 'H200': 4.54, 'B200': 6.25}.get(GPU, 3.95)  # $ per hour


@app.function(image=image, gpu=GPU, volumes={'/data': models},
              timeout=24 * 3600, scaledown_window=120, max_containers=1)  # one container: jobs live in its memory
@modal.concurrent(max_inputs=64)  # the app polls jobs while others run
@modal.web_server(7860, startup_timeout=600)
def serve():
    env = {**os.environ, 'STORYREEL_DATA': '/data', 'HF_HOME': '/data/hf', 'STORYREEL_GPU_PRICE': str(PRICE)}

    def run():
        # the server's output goes to the Modal log as before; its last lines are kept, so that if it ever
        # stops, the reason is saved on the volume (/data/logs, and "last_crash" in /health) and it starts again
        import collections, signal
        while True:
            started = time.time()
            p = subprocess.Popen(['/usr/local/bin/storyreel-python', '-u', '/app/server/modal_start.py'], env=env, cwd='/app',
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace', bufsize=1,
                                 start_new_session=True)  # its own process group: the lip-sync worker goes with it
            tail = collections.deque(maxlen=200)

            def pump(out=p.stdout, tail=tail):
                for line in out:
                    print(line, end='', flush=True)
                    tail.append(line)
            threading.Thread(target=pump, daemon=True).start()
            code = p.wait()
            time.sleep(1)  # the last lines
            try:
                os.killpg(p.pid, signal.SIGKILL)  # anything it started (lip sync) stops too, freeing the GPU
            except OSError:
                pass
            stamp = time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())
            print(f'[storyreel] server stopped (exit code {code}) after {time.time() - started:.0f} s; starting it again', flush=True)
            try:
                os.makedirs('/data/logs', exist_ok=True)
                with open(f'/data/logs/crash-{int(time.time())}.log', 'w') as f:
                    f.write(f'{stamp} exit code {code}\n' + ''.join(tail))
                with open('/data/logs/last_crash.txt', 'w') as f:
                    f.write(f'{stamp}: exit code {code}: ' + ' | '.join(x.strip() for x in list(tail)[-6:])[:600])
                models.commit()
            except Exception as e:
                print('[storyreel] could not save the crash log:', e, flush=True)
            time.sleep(3)
    threading.Thread(target=run, daemon=True).start()

    def keep():  # save new downloads to the volume as they arrive (it also saves when the container stops)
        while True:
            time.sleep(120)
            try:
                models.commit()
            except Exception as e:
                print('[storyreel] volume commit:', e, flush=True)
    threading.Thread(target=keep, daemon=True).start()
