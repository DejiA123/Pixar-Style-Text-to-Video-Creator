# Your own Storyreel AI server (unlimited, free)

Run free open-source AI models on your own computer, and the Storyreel app (on
your phone or anywhere) uses it to paint and **animate every shot with real AI
video**. You get no quotas, no accounts, no watermarks, and no cost beyond your
electricity.

- **Images:** SDXL-Turbo, about 1 second per picture
- **Video:** LTX-Video 0.9.8 13B distilled (Lightricks), image-to-video, a fast 8-step model
- **Voices:** Chatterbox (Resemble AI), realistic speech with emotion, in each character's voice
- **Lip sync:** LatentSync 1.6 (ByteDance) on 40 GB+ cards, so talking mouths match the words (set up by `server/runpod/start.sh`)

## What you need

- A Windows or Linux PC with an **NVIDIA graphics card with 24 GB** (RTX 3090/4090) for video, and 48 GB of RAM. 8 GB cards work for images only (`--no-video`).
- No such PC? [Rent one on RunPod](RUNPOD.md) for about $0.34 an hour, all from your phone.
- [Python 3.10+](https://www.python.org/downloads/)
- About 60 GB of free disk space for the models. They download automatically the first time.

## Set up (once)

```bash
git clone https://github.com/DejiA123/Pixar-Style-Text-to-Video-Creator
cd Pixar-Style-Text-to-Video-Creator
python -m venv .venv
# Windows:  .venv\Scripts\activate      Linux/Mac:  source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install -r server/requirements.txt
pip install --no-deps chatterbox-tts==0.1.7   # the voice model (its own pins are older than the video model's)
```

To use it from your phone, also install the free
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
It creates a secure https link to your PC, and you don't need an account for it.

## Run

```bash
python server/storyreel_server.py --tunnel
```

After a minute it prints:

```
PHONE LINK → paste into Storyreel Settings → "Your AI server":
    https://something-random.trycloudflare.com
```

Open Storyreel, go to **Settings → Render style: AI film — free, online**, and
paste that link into **Your AI server**. Every shot is now painted and animated
on your PC, with no limits.

Options:
- `--no-video`: images only, for smaller graphics cards
- `--port 7860`: change the port
- `--idle-stop 20`: on RunPod, shut the pod down after 20 idle minutes
- `--mock`: no GPU needed. It returns placeholder pictures and clips so you can test the connection.

Keep the window open while you make films. The link changes each time you
start the server, so paste the new one into Settings.

## No graphics card?

[Rent one on RunPod](RUNPOD.md). It costs a few cents a film and you can set it up from your phone.

Without a server, the app still never stops. It uses the free online AI while that's available,
and otherwise paints shots on your device (the "AI painted" style) or renders
them in 3D.
