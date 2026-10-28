# Rent a GPU on RunPod: real AI video for a few cents a film

> Prefer not to start and stop pods yourself? [RunPod Serverless](SERVERLESS.md) starts a GPU only while you make films.

You don't need a PC for this. Storyreel's AI server runs on a graphics card you
rent by the second on [RunPod](https://www.runpod.io), and you can set it up
entirely from your phone. Every shot is painted (SDXL-Turbo) and animated with
real AI video (LTX-Video 0.9.8 13B distilled), so people walk, turn, gesture and
talk, and the background moves. Every line is spoken by a realistic, emotional AI
voice (Chatterbox), and on 40 GB+ cards the talking shots get real lip sync
(LatentSync 1.6), so mouths match the words.

**Cost, measured:** on an A40 (48 GB, $0.59 an hour) a 5-second AI clip takes
about 26 seconds. A 14-shot film (about a minute of AI video) used 5 minutes of
GPU time, roughly **$0.05**. The pod **stops itself after 20 idle minutes**, so a
forgotten pod can't run up a bill, and it keeps its link: next time, tap **Start**
on it in RunPod and the same link works again (the models download again, about
15 minutes). After each film, the app shows the GPU time it used and its cost.

## One-time setup (about 5 minutes)

1. Sign up at [runpod.io](https://www.runpod.io) and add some credit under **Billing**.
2. Open **Templates** in the menu, tap **New Template**, and fill in:

   | Field | Value |
   |---|---|
   | Name | `Storyreel AI server` |
   | Type | Pod · NVIDIA GPU |
   | Container image | `runpod/pytorch:0.7.0-cu1241-torch260-ubuntu2204` |
   | Start command (tap **+ Start command**) | see below |
   | Container disk | `120` GB (video, voice and lip-sync models) |
   | Volume disk | `0` GB (none: it's the cheapest) |
   | HTTP ports | label `storyreel`, port `7860` |
   | Environment variable | `STORYREEL_GPU_PRICE` = the GPU's hourly price, e.g. `0.34` (optional: it turns GPU time into a cost) |

   Container start command (copy it exactly):

   ```
   bash -c "curl -fsSL https://raw.githubusercontent.com/DejiA123/Pixar-Style-Text-to-Video-Creator/claude/jolly-ramanujan-vzdz0b/server/runpod/start.sh -o /start-storyreel.sh && bash /start-storyreel.sh"
   ```

   On the **GPU Compatibility** tab, open **Advanced compatibility settings**:

   | Setting | Value | Why |
   |---|---|---|
   | Allowed CUDA versions | 12.4 and newer | the image is built for CUDA 12.4, which also runs on newer machines |
   | Minimum vRAM | `24` GB | the video model needs a 24 GB card |
   | Minimum RAM | `40` GB | room to load the models |

3. Tap **Create**.

## Every time you make films

1. Open **Templates**, tap **⋮** on Storyreel AI server, and choose **Deploy**.
   Under **Compute**, open the **Available** tab and tap the first card with
   **24 GB or more**: **A40** or **RTX A6000** (48 GB, about $0.35–0.59/hr) are
   ideal; **RTX A5000 / 3090 / 4090** (24 GB) work too. Cheap cards sell out
   within minutes, so tap **Deploy Pod** straight away. Don't use
   "Deploy when available": it starts later on its own and bills you.
2. Open the pod and look at its **Logs**. The first minutes are spent downloading
   the AI models, about 55 GB. Then you'll see:

   ```
   PHONE LINK → paste into Storyreel Settings → "Your AI server":
       https://abc123xyz-7860.proxy.runpod.net
   ```

   The same link is also under the pod's **Connect → HTTP Service (7860)**.
3. In Storyreel, open **Settings**, choose **AI film — free, online**, and paste
   the link into **Your AI server**. Make your film. If the server is still
   loading, the app shows *"Your AI server is starting…"* and waits for it.
4. When you're done, tap **Terminate** on the pod. Or just leave it: it deletes
   itself after 20 minutes with no films.

Each new pod gets a new link, so paste the new one into Settings.

## Options (environment variables on the template)

| Variable | Default | What it does |
|---|---|---|
| `STORYREEL_IDLE_MINUTES` | `20` | Idle minutes before the pod shuts itself down. |
| `STORYREEL_IDLE_ACTION` | `stop` | `stop` keeps the pod and its link (with no volume disk, a stopped pod costs next to nothing), but RunPod may have no free GPU on that machine when you start it again. `remove` deletes the pod. |
| `STORYREEL_GPU_PRICE` | none | The GPU's $/hour, so the app and logs can show the cost. |
| `STORYREEL_VIDEO_MODEL` | `Lightricks/LTX-Video-0.9.8-13B-distilled` | The video model. |
| `STORYREEL_BRANCH` | `claude/jolly-ramanujan-vzdz0b` | The branch of this repo to run. |
| `STORYREEL_LIPSYNC` | `auto` | `auto` turns lip sync on for 40 GB+ cards, `1` forces it on, `0` turns it off. |

## Other GPUs

- **A40 / RTX A6000 / L40S (48 GB):** best value. The video model (fp8 weights)
  stays on the card, so system RAM use stays low (about 17 GB). Tested on an A40.
- **RTX 4090 / 3090 / A5000 (24 GB):** fp8 weights moved between RAM and the card
  for each step; slower, and needs about 40 GB of RAM.
- **RTX 50xx / RTX PRO 6000 / B200 (newest cards):** the start script installs a
  newer PyTorch for them automatically (2–3 extra minutes at start).
- **Avoid** cards under 24 GB (RTX 4070 Ti, A4000, 3070…): the video model won't fit.

## Voices and lip sync

- **Voices:** with the server connected, Storyreel records each line in your
  browser first, then the server re-speaks it with Chatterbox in the same voice,
  acting the scene's emotion (excited, sad, scared…). If that fails, the
  in-browser voices stay. Needs **Voices: AI voices** in Settings.
- **Lip sync:** for each AI clip where an on-screen character speaks, LatentSync
  re-renders the mouth to match their words. It's set up in the background a few
  minutes after the server starts (logs show `[lipsync] ready`); films made
  before that skip it. Shots with no clear face keep their original clip.

## If something goes wrong

- **The app says the server isn't running.** The pod stopped after 20 idle
  minutes: open **Pods** and tap **Start** on it. If RunPod says there's no free
  GPU for it, deploy a new pod and paste its new link.
- **Logs show "Killed" while loading.** The pod ran out of memory. Pick a pod
  with at least 48 GB of RAM (RunPod shows RAM next to each GPU).
- **"video model unavailable" in the logs.** Pictures still work, and the app
  animates shots on your phone instead. Check the error line above it, and try a
  48 GB GPU.
