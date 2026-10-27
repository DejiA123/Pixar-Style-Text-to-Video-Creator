# Rent a GPU on RunPod: real AI video for a few cents a film

You don't need a PC for this. Storyreel's AI server runs on a graphics card you
rent by the second on [RunPod](https://www.runpod.io), and you can set it up
entirely from your phone. Every shot is painted (SDXL-Turbo) and animated with
real AI video (LTX-Video 0.9.8 13B distilled), so people walk, turn, gesture and
talk, and the background moves.

**Cost:** an RTX 4090 costs about **$0.34 an hour** on Community Cloud, and you
only pay while the pod exists. The pod **deletes itself after 20 idle minutes**,
so a forgotten pod can't run up a bill. After each film, the app shows the GPU
time it used and its cost, so you see the real price per film.

## One-time setup (about 5 minutes)

1. Sign up at [runpod.io](https://www.runpod.io) and add some credit under **Billing**.
2. Open **Templates** in the menu, tap **New Template**, and fill in:

   | Field | Value |
   |---|---|
   | Name | `Storyreel AI server` |
   | Type | Pod · NVIDIA GPU |
   | Container image | `runpod/pytorch:1.4.0-cu1281-torch280-ubuntu2204` |
   | Container start command | see below |
   | Container disk | `80` GB |
   | Volume disk | `0` GB (none: it's the cheapest) |
   | Expose HTTP ports | `7860` |
   | Environment variable | `STORYREEL_GPU_PRICE` = the GPU's hourly price, e.g. `0.34` (optional: it turns GPU time into a cost) |

   Container start command (copy it exactly):

   ```
   bash -c "curl -fsSL https://raw.githubusercontent.com/DejiA123/Pixar-Style-Text-to-Video-Creator/claude/jolly-ramanujan-vzdz0b/server/runpod/start.sh -o /start-storyreel.sh && bash /start-storyreel.sh"
   ```

3. Save the template.

## Every time you make films

1. Open **Pods → Deploy**. Pick **RTX 4090** (Community Cloud is cheapest),
   tap **Change Template**, choose **Storyreel AI server**, and tap **Deploy On-Demand**.
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
| `STORYREEL_IDLE_ACTION` | `remove` | `remove` deletes the pod and costs nothing afterwards. `stop` keeps it and its link, but RunPod charges for its disk while stopped and may have no free GPU when you restart it. |
| `STORYREEL_GPU_PRICE` | none | The GPU's $/hour, so the app and logs can show the cost. |
| `STORYREEL_VIDEO_MODEL` | `Lightricks/LTX-Video-0.9.8-13B-distilled` | The video model. |
| `STORYREEL_BRANCH` | `claude/jolly-ramanujan-vzdz0b` | The branch of this repo to run. |

## Other GPUs

- **RTX 4090 / RTX 3090 (24 GB):** the server stores the video model's weights in
  fp8 and moves parts between the card and memory as needed. The 3090 is cheaper
  but slower.
- **L40S / A6000 / A40 (48 GB):** the whole model stays on the card. These cost
  more per hour but don't need the fp8 trick.

## If something goes wrong

- **The app says the server isn't running.** The pod was deleted or stopped.
  Deploy a new one and paste its new link.
- **Logs show "Killed" while loading.** The pod ran out of memory. Pick a pod
  with at least 48 GB of RAM (RunPod shows RAM next to each GPU).
- **"video model unavailable" in the logs.** Pictures still work, and the app
  animates shots on your phone instead. Check the error line above it, and try a
  48 GB GPU.
