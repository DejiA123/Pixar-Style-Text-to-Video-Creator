# Storyreel on Modal: films for free

[Modal](https://modal.com) gives every account **$30 of GPU time each month on its free
plan** and bills per second, only while your films are being made: no starting or
stopping pods, no paying for idle time, and one link that never changes. Films run on an
H100 (80 GB, about $3.95 an hour), which keeps every model loaded, so they are made
several times faster than on a 48 GB L40S. Check modal.com/pricing for current rates;
the credit doesn't roll over.

The first film after a break waits a few minutes while the GPU starts and loads
the models. The very first start also downloads them (about 15 minutes, once).

## One-time setup (about 10 minutes, all in the browser)

1. Sign up at [modal.com](https://modal.com) (with GitHub is quickest) on the free
   **Starter** plan.
2. In Modal open **Settings → API Tokens → New Token** and keep the page open: it
   shows a **Token ID** and a **Token Secret**.
3. On GitHub, open this repository → **Settings → Secrets and variables → Actions →
   New repository secret**, and add two secrets: `MODAL_TOKEN_ID` (the Token ID) and
   `MODAL_TOKEN_SECRET` (the Token Secret).
4. Open the repository's **Actions** tab → **Deploy AI server to Modal** → **Run
   workflow**. It builds and deploys the server (the first build takes 15–30 minutes).
5. In Modal, open **Apps → storyreel**: the web endpoint link looks like
   `https://<your-workspace>--storyreel-serve.modal.run`. Paste it into Storyreel's
   **Settings → Your AI server**.

After that, every server change in this repository redeploys automatically.

## Good to know

- **My films and accounts** run in the same Modal app as a second, small web endpoint,
  `library` (`https://<your-workspace>--storyreel-library.modal.run`): a quarter of a CPU core,
  never the GPU, so opening your films, signing in and backing up don't wake the H100. It
  costs about a cent an hour while awake and sleeps two minutes after the last request. It
  keeps accounts and films on its own volume, `storyreel-films` (at most 5 GB per account and
  100 GB in all, and 6 new accounts an hour from one address: the numbers are at the top of
  `server/library_server.py`). It deploys with the server.

- **Spending stays at $0** while you stay within the free credit. In Modal's
  **Settings → Usage & Billing** you can see what's used and set a spending limit of $0
  so nothing beyond the credit is ever charged.
- **More films than the credit covers:** use a RunPod Community Cloud Spot pod for the
  rest (server/RUNPOD.md), about 3–5 cents a film when you make several in a row.
- The GPU type can be changed with the `STORYREEL_MODAL_GPU` environment variable at
  deploy time (`H100` by default; `A100-80GB` is a little slower and cheaper; `L40S`
  is the cheapest per hour but much slower, as it can't keep all the models loaded).
