# RunPod Serverless: a GPU only while you make films

With a **Serverless endpoint**, RunPod starts a GPU when Storyreel sends work
and stops it when the work is done. You never start pods, paste new links or
forget to terminate anything. Storyreel just works whenever you press
**Generate**.

**Cost:** you pay per second only while a GPU is working: about **$1.22 an
hour** for a 48 GB card (twice the pod rate, but nothing when idle). On top of
that, the network volume that keeps the models costs about **$5.60 a month**
(80 GB). The first film after a quiet spell waits **2–3 minutes** while a GPU
starts and loads the models; films right after it start straight away.

## One-time setup (about 15 minutes, from your phone)

1. **Connect GitHub.** In the RunPod console, open **Settings**, find **GitHub**
   under **Connections**, tap **Connect**, and allow the
   `Pixar-Style-Text-to-Video-Creator` repository.
2. **Make a storage volume for the models.** Open **Storage**, tap **New Network
   Volume**, pick a **datacenter where 48 GB cards (A40, RTX A6000, L40, L40S,
   RTX 6000 Ada) show some availability** (tap a datacenter to see its own
   table; US-KS-2 had L40s and A100s), name it
   `storyreel-models`, set **80 GB**, and create it. Workers run in that
   datacenter, so pick one with 48 GB cards available.
3. **Create the endpoint.** Open **Serverless**, tap **New Endpoint**, then under
   **Import Git Repository** choose this repository and set:

   | Setting | Value |
   |---|---|
   | Branch | `claude/jolly-ramanujan-vzdz0b` |
   | Dockerfile Path | `server/serverless/Dockerfile` |
   | Endpoint Name | `storyreel` |
   | Endpoint Type | **Queue** |
   | GPU | **48 GB** and/or **48 GB PRO** (A40, RTX A6000, L40, L40S, RTX 6000 Ada), with **80 GB** (A100, H100) as a second choice. Not RTX 5090 / RTX PRO 6000 / B200: the worker's software doesn't support that newest generation yet |
   | Active workers | `0` (nothing runs, and nothing is billed, while you're not making films) |
   | Max workers | `1` (raise it later if several people make films at once) |
   | Idle timeout | `120` seconds (a film is many small jobs; this keeps the GPU between them) |
   | Execution timeout | `900` seconds |
   | FlashBoot | on |
   | Network volume (under Advanced) | `storyreel-models` |

   Tap **Deploy Endpoint**. RunPod now builds the server. Watch the **Builds**
   tab; the first build takes about 20–40 minutes.
4. **Create an API key.** Open **Settings → API Keys**, create a key named
   `storyreel`, and copy it. If RunPod offers restricted keys, give it access to
   this endpoint only.
5. **Connect Storyreel.** In Storyreel's **Settings**, paste the endpoint's **ID**
   (shown on the endpoint page, e.g. `abc123xyz456`) into **Your AI server**, and
   the API key into **RunPod API key**. The light turns green: *Ready · RunPod
   Serverless*.

**The very first film** also downloads the AI models (about 65 GB) to the
volume, which takes 10–20 minutes, once. After that, a cold start just loads
them from the volume.

## Updating the server

RunPod rebuilds the endpoint only when you **publish a GitHub release**, not on
every change. When there's a server update, go to the repository on GitHub,
tap **Releases → Draft a new release**, create a new tag (e.g. `v1.1`) on the
branch above, and **Publish**. The endpoint switches to the new build once it's
done.

## Good to know

- **Your API key** is stored only in your browser and sent only to RunPod. That's
  fine while you're the only user. Before other people use Storyreel, the key
  has to move to a small backend server so they can't see it.
- **Lip sync** needs the 48 GB card. On smaller cards the film still gets AI
  video and voices, without lip sync.
- **To stop all spending:** set Max workers to 0, or delete the endpoint. The
  volume keeps costing its monthly storage until you delete it too.
