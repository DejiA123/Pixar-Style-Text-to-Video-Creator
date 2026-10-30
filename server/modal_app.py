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
image = modal.Image.from_dockerfile(os.path.join(ROOT, 'Dockerfile'), context_dir=ROOT)
models = modal.Volume.from_name('storyreel-models', create_if_missing=True)  # downloaded once, kept between runs
app = modal.App('storyreel')


@app.function(image=image, gpu=os.environ.get('STORYREEL_MODAL_GPU', 'L40S'), volumes={'/data': models},
              timeout=24 * 3600, scaledown_window=120, max_containers=1)  # one container: jobs live in its memory
@modal.concurrent(max_inputs=64)  # the app polls jobs while others run
@modal.web_server(7860, startup_timeout=600)
def serve():
    env = {**os.environ, 'STORYREEL_DATA': '/data', 'HF_HOME': '/data/hf', 'STORYREEL_GPU_PRICE': '1.95'}
    subprocess.Popen(['python3', '-u', '/app/server/modal_start.py'], env=env, cwd='/app')

    def keep():  # save new downloads to the volume as they arrive (it also saves when the container stops)
        while True:
            time.sleep(120)
            try:
                models.commit()
            except Exception as e:
                print('[storyreel] volume commit:', e, flush=True)
    threading.Thread(target=keep, daemon=True).start()
