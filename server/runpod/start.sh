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
# voices: torchaudio must match the installed PyTorch exactly
if ! "$PY" -c 'import torch, torchaudio, sys; sys.exit(0 if torchaudio.__version__.split("+")[0] == torch.__version__.split("+")[0] else 1)' 2>/dev/null; then
  TV=$("$PY" -c 'import torch; print(torch.__version__.split("+")[0])')
  CU=$("$PY" -c 'import torch; print("cu" + (torch.version.cuda or "").replace(".", ""))')
  pipi "torchaudio==$TV" --index-url "https://download.pytorch.org/whl/$CU" || echo "[storyreel] no matching torchaudio: voices off"
fi
pipi --no-deps chatterbox-tts==0.1.7 || echo "[storyreel] voice model install failed: voices off"

# lip sync: LatentSync in its own environment (it pins older libraries), set up in the
# background so films can start meanwhile. Needs about 18 GB of GPU memory next to the
# video model, so it's on by default for 40 GB+ cards (STORYREEL_LIPSYNC=1 forces, 0 disables).
LS_COMMIT=a229c3948406bc2cf6eaf4873e662e70c6a04746
VRAM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 || echo 0)
LIPSYNC="${STORYREEL_LIPSYNC:-auto}"
if [ "$LIPSYNC" = auto ]; then [ "${VRAM:-0}" -ge 40000 ] && LIPSYNC=1 || LIPSYNC=0; fi
lipsync() {
  set -e
  local LS="$W/LatentSync" V="$W/lsvenv"
  if ! command -v ffmpeg >/dev/null || ! ldconfig -p | grep -q libGL.so.1; then
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg libgl1 >/dev/null
  fi
  [ -d "$LS/.git" ] || git clone -q https://github.com/bytedance/LatentSync "$LS"
  git -C "$LS" fetch -q --depth 1 origin "$LS_COMMIT" && git -C "$LS" checkout -q "$LS_COMMIT"
  pipi uv
  [ -x "$V/bin/python" ] || "$PY" -m uv venv -q --python 3.10 "$V"
  grep -v -i '^gradio' "$LS/requirements.txt" > "$W/lipsync-requirements.txt"
  # --python, not VIRTUAL_ENV: "python -m uv" installs into the Python that runs it otherwise
  "$PY" -m uv pip install -q --python "$V/bin/python" --index-strategy unsafe-best-match -r "$W/lipsync-requirements.txt"
  cd "$LS"
  "$V/bin/python" -c "from huggingface_hub import hf_hub_download as d; [d('ByteDance/LatentSync-1.6', f, local_dir='checkpoints') for f in ('latentsync_unet.pt', 'whisper/tiny.pt')]"
  echo "lip sync installed, loading…"
  exec "$V/bin/python" -u "$APP/server/lipsync_worker.py" --port 7862
}
if [ "$LIPSYNC" = 1 ]; then
  echo "[storyreel] setting up lip sync in the background…"
  ( lipsync 2>&1 | sed -u 's/^/[lipsync] /' ) &
else
  echo "[storyreel] lip sync off (needs a 40 GB+ card, or set STORYREEL_LIPSYNC=1)"
fi

export STORYREEL_LIPSYNC_ON="$LIPSYNC"  # so the app can show "lip sync setting up…"
echo "[storyreel] starting (shuts down after ${IDLE} idle minutes: $IDLE_ACTION)…"
exec "$PY" -u "$APP/server/storyreel_server.py" --port "$PORT" --idle-stop "$IDLE" --idle-action "$IDLE_ACTION"
