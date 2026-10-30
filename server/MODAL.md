# Storyreel on Modal: films for free

[Modal](https://modal.com) gives every account **$30 of GPU time each month on its free
plan** and bills per second, only while your films are being made: no starting or
stopping pods, no paying for idle time, and one link that never changes. A film uses
about 15–25 cents of Modal GPU time (an L40S at about $1.95 an hour), so the free
credit covers roughly **120–180 films a month for $0**. Check modal.com/pricing for
current rates; the credit doesn't roll over.

The first film after a quiet spell waits a few minutes while the GPU starts and loads
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

- **Spending stays at $0** while you stay within the free credit. In Modal's
  **Settings → Usage & Billing** you can see what's used and set a spending limit of $0
  so nothing beyond the credit is ever charged.
- **More films than the credit covers:** use a RunPod Community Cloud Spot pod for the
  rest (server/RUNPOD.md), about 3–5 cents a film when you make several in a row.
- The GPU type can be changed with the `STORYREEL_MODAL_GPU` environment variable at
  deploy time (`L40S` by default; `A100-80GB` is faster and pricier).
