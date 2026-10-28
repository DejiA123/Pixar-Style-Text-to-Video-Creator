// Your AI server, behind one client: either a link to a running server (a RunPod
// pod or your own PC) or a RunPod Serverless endpoint, which starts GPUs only
// while films are being made. The rest of the app only sees this interface:
//   health()           -> {ready, loading, image, video, tts, lipsync, gpu, serverless, ...} or null
//   image|video|tts|lipsync(body, signal) -> Blob (throws on failure; tts throws code 'unknown-ref'
//                         when the server needs the reference voice clip itself again)
//   usage()            -> GPU seconds used so far (for the cost after a film)

const sleep = (ms, signal) => new Promise((r, j) => {
  const t = setTimeout(r, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); j(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

// "https://api.runpod.ai/v2/<id>" or a bare endpoint id is a serverless endpoint;
// anything else is a link to a server.
export function serverlessId(value) {
  const v = (value || '').trim().replace(/\/+$/, '');
  const m = v.match(/^(https?:\/\/[^/]+)\/v2\/([a-z0-9-]+)$/i) || v.match(/^()([a-z0-9]{8,32})$/i);
  return m ? { base: m[1] || 'https://api.runpod.ai', id: m[2] } : null;
}

export function aiServer(value, apiKey = '') {
  const v = (value || '').trim().replace(/\/+$/, '');
  if (!v) return null;
  const sl = serverlessId(v);
  return sl ? runpodEndpoint(sl.base, sl.id, apiKey.trim()) : linkedServer(v);
}

function linkedServer(url) {
  const post = (path, body, signal) => fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  // background job + polling: proxies (RunPod, Cloudflare) cut requests after ~100 s
  const job = async (kind, body, signal) => {
    const start = await post(`/${kind}/start`, body, signal);
    if (!start.ok) throw new Error(`AI server ${kind} failed (${start.status})`);
    const { id } = await start.json();
    for (let misses = 0; ;) {
      await sleep(3000, signal);
      let res;
      try { res = await fetch(`${url}/${kind}/result?id=${id}`, { signal }); } catch (e) {
        if (e?.name === 'AbortError' || ++misses > 10) throw e;
        continue;  // a dropped poll is fine, the job keeps running
      }
      if (res.status === 202) continue;
      if (!res.ok) throw new Error(`AI server ${kind} failed (${res.status})`);
      return res.blob();
    }
  };
  const blob = async (path, body, signal) => {
    const res = await post(path, body, signal);
    if (res.status === 409) throw Object.assign(new Error('unknown ref_key'), { code: 'unknown-ref' });
    if (!res.ok) throw new Error(`AI server ${path.slice(1)} failed (${res.status})`);
    return res.blob();
  };
  const client = {
    kind: 'link', label: url,
    async health() {
      try {
        const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(8000) });
        const j = await res.json();
        return j && j.ok ? j : null;
      } catch { return null; }
    },
    image: (body, signal) => blob('/image', body, signal),
    video: (body, signal) => job('video', body, signal),
    tts: (body, signal) => blob('/tts', body, signal),
    lipsync: (body, signal) => job('lipsync', body, signal),
    async usage() { const h = await client.health(); return h?.stats ? h.stats.busy_seconds : null; },
    price: async () => (await client.health())?.price_per_hour || null,
  };
  return client;
}

function runpodEndpoint(base, id, key) {
  const api = `${base}/v2/${id}`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  let spent = 0;  // seconds of GPU time billed for this app's jobs (RunPod's executionTime)
  const run = async (op, body, signal) => {
    const res = await fetch(`${api}/run`, { method: 'POST', headers, body: JSON.stringify({ input: { op, ...body } }), signal });
    if (res.status === 401) throw new Error('RunPod didn’t accept the API key');
    if (!res.ok) throw new Error(`RunPod ${op} failed (${res.status})`);
    const { id: job } = await res.json();
    const cancel = () => fetch(`${api}/cancel/${job}`, { method: 'POST', headers }).catch(() => {});
    signal?.addEventListener('abort', cancel, { once: true });
    const queued = Date.now();
    let waited = false;
    try {
      for (let misses = 0; ;) {
        await sleep(2500, signal);
        let st;
        try { st = await (await fetch(`${api}/status/${job}`, { headers, signal })).json(); } catch (e) {
          if (e?.name === 'AbortError' || ++misses > 10) throw e;
          continue;
        }
        // still queued = no GPU free or awake yet: let the app say so
        if (st.status === 'IN_QUEUE') { waited = true; client.onWait?.(op, (Date.now() - queued) / 1000); continue; }
        if (waited) { waited = false; client.onWait?.(op, -1); }
        if (st.status === 'IN_PROGRESS') continue;
        spent += (st.executionTime || 0) / 1000;
        const out = st.output || {};
        const err = out.error || st.error;
        if (st.status !== 'COMPLETED' || err) {
          if (/unknown ref_key/.test(String(err))) throw Object.assign(new Error('unknown ref_key'), { code: 'unknown-ref' });
          throw new Error(`RunPod ${op}: ${err || st.status}`);
        }
        const bytes = Uint8Array.from(atob(out.data), (c) => c.charCodeAt(0));
        return new Blob([bytes], { type: out.mime });
      }
    } finally { signal?.removeEventListener('abort', cancel); }
  };
  const client = {
    kind: 'serverless', label: `RunPod Serverless ${id}`,
    onWait: null,  // (op, seconds queued) while waiting for a GPU; seconds < 0 when the wait is over
    async health() {
      if (!key) return { ok: false, ready: false, needsKey: true };
      try {
        const res = await fetch(`${api}/health`, { headers, signal: AbortSignal.timeout(8000) });
        if (res.status === 401) return { ok: false, ready: false, badKey: true };
        if (!res.ok) return null;
        const j = await res.json();
        const w = j.workers || {};
        // workers start on demand, so the endpoint is "ready" even with none running
        return { ok: true, ready: true, serverless: true, image: true, video: true, tts: true, lipsync: true, jobs: true,
          gpu: 'RunPod Serverless', warm: (w.idle || 0) + (w.running || 0) + (w.ready || 0), starting: w.initializing || 0, queued: j.jobs?.inQueue || 0 };
      } catch { return null; }
    },
    image: (body, signal) => run('image', body, signal),
    video: (body, signal) => run('video', body, signal),
    tts: (body, signal) => run('tts', body, signal),
    lipsync: (body, signal) => run('lipsync', body, signal),
    usage: async () => spent,
    price: async () => null,
  };
  return client;
}

// Waits while a linked server downloads and loads its models (first start).
export async function waitForServer(server, health, onProgress, signal) {
  const t0 = Date.now();
  while (health && !health.ready && health.loading && Date.now() - t0 < 30 * 60000) {
    onProgress(0, `Your AI server is starting: ${health.loading}…`);
    await sleep(5000, signal);
    health = (await server.health()) || health;
  }
  return health;
}
