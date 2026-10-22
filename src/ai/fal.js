// Minimal fal.ai queue client for the browser.
// Docs: submit → poll status → fetch result. Keys stay in the browser.
const QUEUE = 'https://queue.fal.run';

export class FalError extends Error {
  constructor(message, status, detail) { super(message); this.status = status; this.detail = detail; }
}

export class FalClient {
  constructor(key, opts = {}) {
    this.key = key;
    this.base = opts.base || QUEUE; // overridable for tests
  }

  headers() { return { Authorization: `Key ${this.key}`, 'Content-Type': 'application/json' }; }

  async run(endpoint, input, { signal, onStatus, pollMs = 2000, timeoutMs = 15 * 60 * 1000 } = {}) {
    const submit = await fetch(`${this.base}/${endpoint}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(input), signal });
    if (!submit.ok) throw await this.error(submit, endpoint);
    const job = await submit.json();
    const statusUrl = job.status_url || `${this.base}/${endpoint}/requests/${job.request_id}/status`;
    const responseUrl = job.response_url || `${this.base}/${endpoint}/requests/${job.request_id}`;
    const t0 = Date.now();
    for (;;) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (Date.now() - t0 > timeoutMs) throw new FalError(`${endpoint} timed out`, 408);
      await sleep(pollMs, signal);
      const st = await fetch(statusUrl, { headers: this.headers(), signal });
      if (!st.ok) { if (st.status >= 500) continue; throw await this.error(st, endpoint); }
      const s = await st.json();
      onStatus && onStatus(s.status, s.queue_position);
      if (s.status === 'COMPLETED') break;
      if (s.status === 'FAILED' || s.status === 'ERROR') throw new FalError(`${endpoint} failed`, 500, s);
    }
    const res = await fetch(responseUrl, { headers: this.headers(), signal });
    if (!res.ok) throw await this.error(res, endpoint);
    return res.json();
  }

  async error(res, endpoint) {
    let detail = null;
    try { detail = await res.json(); } catch {}
    const msg = res.status === 401 || res.status === 403
      ? 'fal.ai rejected the API key. Check it under Film settings (format key_id:key_secret) and that your account has credit.'
      : res.status === 422
        ? `fal.ai couldn’t accept the request for ${endpoint}: ${JSON.stringify(detail?.detail ?? detail).slice(0, 300)}`
        : `fal.ai error ${res.status} on ${endpoint}${detail?.detail ? ': ' + JSON.stringify(detail.detail).slice(0, 200) : ''}`;
    return new FalError(msg, res.status, detail);
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
  });
}

// Run async tasks with limited concurrency, preserving order.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  });
  await Promise.all(workers);
  return out;
}
