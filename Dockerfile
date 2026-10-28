# Storyreel AI server as a RunPod Serverless worker (see server/SERVERLESS.md).
# RunPod builds this file from GitHub; the worker code is server/serverless/handler.py.
# Build context: the repository root. Models are not baked in: they download to
# the endpoint's network volume on the first start and load from it afterwards.
FROM runpod/pytorch:0.7.0-cu1241-torch260-ubuntu2204

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg libgl1 git \
 && rm -rf /var/lib/apt/lists/* && python3 -c "import torch; print('torch', torch.__version__)"

WORKDIR /app
COPY server/requirements.txt server/requirements.txt
# video, image and voice models (Chatterbox without its older pins), torchaudio matching torch
RUN python3 -m pip install -q -r server/requirements.txt runpod \
 && python3 -m pip install -q --no-deps chatterbox-tts==0.1.7 \
 && (python3 -c 'import torch, torchaudio, sys; sys.exit(torchaudio.__version__.split("+")[0] != torch.__version__.split("+")[0])' \
     || python3 -m pip install -q "torchaudio==$(python3 -c 'import torch; print(torch.__version__.split("+")[0])')" \
          --index-url "https://download.pytorch.org/whl/cu$(python3 -c 'import torch; print(torch.version.cuda.replace(".", ""))')")

# lip sync: LatentSync in its own Python 3.10 environment (it pins older libraries; --python
# keeps them there, "python -m uv" would otherwise install into the main Python)
ARG LS_COMMIT=a229c3948406bc2cf6eaf4873e662e70c6a04746
RUN git clone -q https://github.com/bytedance/LatentSync /opt/LatentSync && git -C /opt/LatentSync checkout -q $LS_COMMIT \
 && python3 -m pip install -q uv \
 && python3 -m uv venv -q --python 3.10 /opt/lsvenv \
 && grep -v -i '^gradio' /opt/LatentSync/requirements.txt > /tmp/lipsync-requirements.txt \
 && python3 -m uv pip install -q --no-cache --python /opt/lsvenv/bin/python --index-strategy unsafe-best-match -r /tmp/lipsync-requirements.txt

COPY server/ server/
CMD ["python3", "-u", "server/serverless/handler.py"]
