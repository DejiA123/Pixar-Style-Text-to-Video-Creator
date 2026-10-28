#!/usr/bin/env bash
# Storyreel AI server on a RunPod GPU pod. The template's start command runs this:
#   bash -c "curl -fsSL https://raw.githubusercontent.com/DejiA123/Pixar-Style-Text-to-Video-Creator/claude/jolly-ramanujan-vzdz0b/server/runpod/start.sh -o /start-storyreel.sh && bash /start-storyreel.sh"
# Code and models (~55 GB) go under /workspace. With no volume (the cheapest
# setup) they download fresh on each new pod in a few minutes; with a volume or
# network volume mounted at /workspace they are reused.
set -euo pipefail

REPO="${STORYREEL_REPO:-https://github.com/DejiA123/Pixar-Style-Text-to-Video-Creator}"
BRANCH="${STORYREEL_BRANCH:-claude/jolly-ramanujan-vzdz0b}"
PORT="${STORYREEL_PORT:-7860}"
IDLE="${STORYREEL_IDLE_MINUTES:-20}"
IDLE_ACTION="${STORYREEL_IDLE_ACTION:-remove}"
W=/workspace
APP="$W/storyreel"
export HF_HOME="$W/hf"  # model cache (reused when /workspace is a volume)
mkdir -p "$W"

echo "[storyreel] fetching the server ($BRANCH)…"
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch -q --depth 1 origin "$BRANCH" && git -C "$APP" reset -q --hard FETCH_HEAD
else
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$APP"
fi

# the image's Python that already has CUDA PyTorch
PY=""
for p in python3 python python3.12 python3.11 python3.10; do
  if command -v "$p" >/dev/null && "$p" -c 'import torch' 2>/dev/null; then PY="$p"; break; fi
done
[ -n "$PY" ] || { echo "[storyreel] no Python with PyTorch in this image: use a runpod/pytorch image"; exit 1; }
pipi() { "$PY" -m pip install -q "$@" 2>/dev/null || "$PY" -m pip install -q --break-system-packages "$@"; }

# newer cards (RTX 50xx, B200…) need a PyTorch built for them: upgrade if this one isn't
if ! "$PY" -c 'import torch, sys; c = torch.cuda.get_device_capability(); sys.exit(0 if f"sm_{c[0]}{c[1]}" in torch.cuda.get_arch_list() else 1)' 2>/dev/null; then
  echo "[storyreel] this GPU needs a newer PyTorch: installing the CUDA 12.8 build…"
  pipi --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
fi
echo "[storyreel] installing Python packages ($("$PY" -c 'import sys, torch; print(sys.version.split()[0], "torch", torch.__version__)'))…"
pipi -r "$APP/server/requirements.txt"

echo "[storyreel] starting (shuts down after ${IDLE} idle minutes: $IDLE_ACTION)…"
exec "$PY" -u "$APP/server/storyreel_server.py" --port "$PORT" --idle-stop "$IDLE" --idle-action "$IDLE_ACTION"
