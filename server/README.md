# Your own Storyreel AI server (unlimited, free)

Run free open-source AI models on your own computer, and the Storyreel app (on
your phone or anywhere) uses it to paint and **animate every shot with real AI
video**. You get no quotas, no accounts, no watermarks, and no cost beyond your
electricity.

- **Images:** SDXL-Turbo, about 1 second per picture
- **Video:** LTX-Video (Lightricks), image-to-video, about 1–3 minutes per clip depending on your graphics card

## What you need

- A Windows or Linux PC with an **NVIDIA graphics card with 12 GB or more** for video. 8 GB works for images only (`--no-video`).
- [Python 3.10+](https://www.python.org/downloads/)
- About 30 GB of free disk space for the models. They download automatically the first time.

## Set up (once)

```bash
git clone https://github.com/DejiA123/Pixar-Style-Text-to-Video-Creator
cd Pixar-Style-Text-to-Video-Creator
python -m venv .venv
# Windows:  .venv\Scripts\activate      Linux/Mac:  source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install -r server/requirements.txt
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
- `--mock`: no GPU needed. It returns placeholder pictures and clips so you can test the connection.

Keep the window open while you make films. The link changes each time you
start the server, so paste the new one into Settings.

## No graphics card?

The app still never stops. It uses the free online AI while that's available,
and otherwise paints shots on your device (the "AI painted" style) or renders
them in 3D.
