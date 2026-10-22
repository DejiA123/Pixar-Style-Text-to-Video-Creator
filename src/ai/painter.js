// Free, on-device AI painter: SD-Turbo running in the browser with ONNX
// Runtime Web on WebGPU (no server, no key, no cost). It repaints a 3D render
// of each shot in an illustrated style (image-to-image), so composition and
// characters stay consistent from shot to shot.
// Pipeline follows Microsoft's onnxruntime-inference-examples/js/sd-turbo.
const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.webgpu.min.mjs';
const TOK_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';
const MODEL_BASE = 'https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/main';
// test hooks: window.__painterBase (local model copy), window.__painterEP ('wasm')
const modelBase = () => (typeof window !== 'undefined' && window.__painterBase) || MODEL_BASE;
const ep = () => (typeof window !== 'undefined' && window.__painterEP) || 'webgpu';
const VAE_SCALE = 0.18215;

// SD 2.x "scaled_linear" schedule → cumulative alphas, for img2img noise levels.
const ALPHAS = (() => {
  const a = new Float64Array(1000);
  let prod = 1;
  const b0 = Math.sqrt(0.00085), b1 = Math.sqrt(0.012);
  for (let i = 0; i < 1000; i++) { const b = (b0 + (b1 - b0) * (i / 999)) ** 2; prod *= 1 - b; a[i] = prod; }
  return a;
})();

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gaussian(n, seed) {
  const r = mulberry(seed), out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = Math.max(1e-9, r()), v = r(), m = Math.sqrt(-2 * Math.log(u));
    out[i] = m * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) out[i + 1] = m * Math.sin(2 * Math.PI * v);
  }
  return out;
}

// float32 ⇄ float16 (IEEE half) for the fp16 VAE encoder
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
function toHalf(src) {
  const out = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    _f[0] = src[i];
    const x = _u[0], sign = (x >>> 16) & 0x8000;
    let e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
    if (e <= 0) out[i] = sign; else if (e >= 31) out[i] = sign | 0x7c00;
    else out[i] = sign | (e << 10) | ((m + 0x1000) >>> 13);
  }
  return out;
}
function fromHalf(src) {
  if (src instanceof Float32Array) return src;
  if (typeof Float16Array !== 'undefined' && src instanceof Float16Array) return Float32Array.from(src);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const h = src[i], s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
    out[i] = e === 0 ? s * m * 5.960464477539063e-8 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return out;
}

async function cachedBytes(url, onBytes) {
  let cache = null;
  try { cache = await caches.open('storyreel-models'); } catch {}
  const hit = cache && (await cache.match(url));
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Model download failed (${res.status})`);
  const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    onBytes(got, total);
  }
  const blob = new Blob(parts);
  if (cache) { try { await cache.put(url, new Response(blob)); } catch {} }
  return blob.arrayBuffer();
}

export class Painter {
  // width/height in pixels (multiples of 64): 640×384 landscape, 384×640 vertical, 512×512 square
  constructor({ width = 640, height = 384 } = {}) {
    this.W = width; this.H = height;
    this.sessions = {};
    this.onProgress = () => {};
  }

  static async supported() {
    if (typeof window !== 'undefined' && window.__painterEP === 'wasm') return { ok: true };
    try {
      if (!navigator.gpu) return { ok: false, why: 'This browser has no WebGPU.' };
      const ad = await navigator.gpu.requestAdapter();
      if (!ad) return { ok: false, why: 'No WebGPU graphics adapter.' };
      if (!ad.features.has('shader-f16')) return { ok: false, why: 'This device’s graphics chip lacks 16-bit float support.' };
      return { ok: true };
    } catch (e) { return { ok: false, why: e.message }; }
  }

  async load() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const ortMod = await import(/* @vite-ignore */ ORT_URL);
      const ort = (this.ort = ortMod.default ?? ortMod);
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
      const { AutoTokenizer } = await import(/* @vite-ignore */ TOK_URL);
      this.tokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-base-patch16');
      this.tokenizer.pad_token_id = 0;
      const lh = this.H / 8, lw = this.W / 8;
      const models = {
        text_encoder: { url: 'text_encoder/model.onnx', mb: 681, dims: { batch_size: 1 } },
        unet: { url: 'unet/model.onnx', mb: 1733, dims: { batch_size: 1, num_channels: 4, height: lh, width: lw, sequence_length: 77 } },
        vae_decoder: { url: 'vae_decoder/model.onnx', mb: 99, dims: { batch_size: 1, num_channels_latent: 4, height_latent: lh, width_latent: lw } },
        vae_encoder: { url: 'vae_encoder/model.onnx', mb: 65, dims: { batch_size: 1, num_channels: 3, height: this.H, width: this.W } },
      };
      const totalMB = Object.values(models).reduce((a, m) => a + m.mb, 0);
      let doneMB = 0;
      const base = {
        executionProviders: [ep()], enableMemPattern: false, enableCpuMemArena: false,
        extra: { session: { disable_prepacking: '1', use_device_allocator_for_initializers: '1', use_ort_model_bytes_directly: '1', use_ort_model_bytes_for_initializers: '1' } },
      };
      for (const [name, m] of Object.entries(models)) {
        const bytes = await cachedBytes(`${modelBase()}/${m.url}`, (got) => this.onProgress((doneMB + got / 1048576) / totalMB, `Downloading AI painter (${Math.round(totalMB / 100) / 10} GB, one time)`));
        doneMB += m.mb;
        this.onProgress(doneMB / totalMB, 'Starting AI painter');
        const opt = { ...base, freeDimensionOverrides: m.dims };
        if (name === 'text_encoder' && ep() === 'webgpu') opt.preferredOutputLocation = { last_hidden_state: 'gpu-buffer' };
        this.sessions[name] = await ort.InferenceSession.create(bytes, opt);
      }
      return this;
    })();
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }

  // init: canvas/image to repaint (null = from scratch); strength 0..1 = how much to change it.
  async paint(prompt, { init = null, strength = 0.6, seed = 1 } = {}) {
    await this.load();
    const ort = this.ort, S = this.sessions, W = this.W, H = this.H;
    let { input_ids } = await this.tokenizer(prompt, { padding: 'max_length', max_length: 77, truncation: true, return_tensor: false });
    input_ids = Array.from(input_ids).slice(0, 77);
    while (input_ids.length < 77) input_ids.push(0);
    const { last_hidden_state } = await S.text_encoder.run({ input_ids: new ort.Tensor('int32', Int32Array.from(input_ids), [1, 77]) });
    const n = 4 * (H / 8) * (W / 8);
    const noise = gaussian(n, seed);
    let t = 999, sigma = 14.6146;
    let latents;
    if (init) {
      t = Math.max(1, Math.min(999, Math.round(999 * strength)));
      sigma = Math.sqrt((1 - ALPHAS[t]) / ALPHAS[t]);
      const enc = await S.vae_encoder.run({ [S.vae_encoder.inputNames[0]]: this.imageTensor(init) });
      const lat = fromHalf(enc[S.vae_encoder.outputNames[0]].data);
      latents = new Float32Array(n);
      for (let i = 0; i < n; i++) latents[i] = lat[i] * VAE_SCALE + sigma * noise[i];
    } else {
      latents = new Float32Array(n);
      for (let i = 0; i < n; i++) latents[i] = sigma * noise[i];
    }
    const k = 1 / Math.sqrt(sigma * sigma + 1);
    const scaled = new Float32Array(n);
    for (let i = 0; i < n; i++) scaled[i] = latents[i] * k;
    const dims = [1, 4, H / 8, W / 8];
    const { out_sample } = await S.unet.run({
      sample: new ort.Tensor(scaled, dims),
      timestep: new ort.Tensor('int64', [BigInt(t)], [1]),
      encoder_hidden_states: last_hidden_state,
    });
    last_hidden_state.dispose?.();
    // one Euler step to the clean image, then undo the VAE scaling
    const eps = out_sample.data, den = new Float32Array(n);
    for (let i = 0; i < n; i++) den[i] = (latents[i] - sigma * eps[i]) / VAE_SCALE;
    const { sample } = await S.vae_decoder.run({ latent_sample: new ort.Tensor(den, dims) });
    return this.toCanvas(sample.data);
  }

  imageTensor(src) {
    const c = document.createElement('canvas');
    c.width = this.W; c.height = this.H;
    const g = c.getContext('2d');
    const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
    const s = Math.max(this.W / sw, this.H / sh);
    g.drawImage(src, (this.W - sw * s) / 2, (this.H - sh * s) / 2, sw * s, sh * s);
    const px = g.getImageData(0, 0, this.W, this.H).data;
    const plane = this.W * this.H, out = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      out[i] = px[i * 4] / 127.5 - 1;
      out[plane + i] = px[i * 4 + 1] / 127.5 - 1;
      out[2 * plane + i] = px[i * 4 + 2] / 127.5 - 1;
    }
    // the encoder takes float16
    return new this.ort.Tensor('float16', toHalf(out), [1, 3, this.H, this.W]);
  }

  toCanvas(d) {
    const c = document.createElement('canvas');
    c.width = this.W; c.height = this.H;
    const g = c.getContext('2d');
    const img = g.createImageData(this.W, this.H);
    const plane = this.W * this.H;
    for (let i = 0; i < plane; i++) {
      for (let ch = 0; ch < 3; ch++) img.data[i * 4 + ch] = Math.max(0, Math.min(255, (d[ch * plane + i] / 2 + 0.5) * 255));
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
}

// A short, CLIP-friendly description of a shot, built from the story plan.
export function shotPrompt(shot, castById) {
  const sc = shot.scene;
  const who = (sc.characters || []).slice(0, 3).map((id) => castById.get(id)).filter(Boolean).map((c) => describe(c, sc)).join(' and ');
  const where = { home: 'cozy bedroom', church: 'church interior with pews and stained glass', city: 'city street', school: 'school classroom', meadow: 'sunny park', forest: 'forest', beach: 'beach', market: 'busy market', kitchen: 'kitchen' }[sc.setting] || sc.setting;
  const when = { night: 'at night, warm glowing lights', sunset: 'at golden sunset', dawn: 'in soft morning light', day: 'soft daylight' }[sc.time] || '';
  return `${who || 'a scene'}, in a ${where} ${when}, 3d pixar disney animation style, cute expressive cartoon characters, big eyes, smooth skin, cinematic lighting, highly detailed render`;
}

function describe(c, sc) {
  if (c.kind !== 'human') return `a cute cartoon ${c.noun || c.kind}`;
  const age = { child: c.gender === 'f' ? 'little girl' : 'little boy', teen: c.gender === 'f' ? 'teenage girl' : 'teenage boy', old: c.gender === 'f' ? 'grandmother' : 'grandfather' }[c.age] || (c.gender === 'f' ? 'woman' : 'man');
  const tone = { dark: 'black', brown: 'brown-skinned', tan: 'latino', 'light-warm': 'asian', light: 'fair-skinned' }[c.skinTone] || '';
  const hair = c.hair && c.hair.style ? `${c.hair.style} hair` : '';
  const acc = (c.accessories || []).filter((a) => ['glasses', 'backpack', 'hoodie', 'dress', 'hat', 'beard'].includes(a)).join(' ');
  const act = { pray: 'praying', groom: 'brushing her hair', dance: 'dancing', walk: 'walking', run: 'running', cry: 'crying', laugh: 'laughing', sing: 'singing', cook: 'cooking', eat: 'eating', read: 'reading', play: 'playing', wave: 'waving', hug: 'hugging', sit: 'sitting', talk: 'talking' }[sc.actions?.[c.id]] || '';
  const role = c.role && c.role !== 'student' ? c.role : '';
  return [tone, role || age, hair && `with ${hair}`, acc && `with ${acc}`, act].filter(Boolean).join(' ');
}

// ---- painted film --------------------------------------------------------------------
// Wraps a built 3D Film: for every shot it renders a few key frames of the 3D
// animation, has the AI painter repaint them, and plays them back with slow
// camera drift and cross-dissolves. Same interface as Film for player/export.
export class PaintedFilm {
  constructor(film3d, fr, glCanvas, painter, opts = {}) {
    this.base = film3d;
    this.fr = fr;
    this.glCanvas = glCanvas;
    this.painter = painter;
    this.tl = film3d.tl;
    this.envelopes = film3d.envelopes;
    this.talkOverride = null;
    this.canvas = document.createElement('canvas');
    this.canvas.width = opts.width || 1280; this.canvas.height = opts.height || 720;
    this.ctx = this.canvas.getContext('2d');
    this.keys = [];
    this.strength = opts.strength ?? 0.55;
  }

  async prepare(onProgress = () => {}, isCancelled = () => false) {
    const shots = this.tl.shots;
    const castById = new Map(this.tl.cast.map((c) => [c.id, c]));
    const plan = shots.map((s) => {
      const len = s.end - s.start;
      const n = len > 7 ? 3 : 2;
      return Array.from({ length: n }, (_, k) => s.start + len * (k + 0.5) / n);
    });
    const total = plan.reduce((a, p) => a + p.length, 0);
    let done = 0;
    this.fr.setSize(this.painter.W, this.painter.H, 1);
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      // one seed per scene keeps the painted look of a place and its people steady
      const seed = 1000 + (hashStr(shot.scene.text || '') % 100000);
      const prompt = shotPrompt(shot, castById);
      const frames = [];
      for (const t of plan[i]) {
        if (isCancelled()) throw new DOMException('Stopped', 'AbortError');
        this.base.renderAt(t, { dof: false });
        const snap = document.createElement('canvas');
        snap.width = this.glCanvas.width; snap.height = this.glCanvas.height;
        snap.getContext('2d').drawImage(this.glCanvas, 0, 0);
        frames.push({ t, img: await this.painter.paint(prompt, { init: snap, strength: this.strength, seed }) });
        onProgress(++done / total, `Painting shot ${i + 1} of ${shots.length}`);
        await new Promise((r) => setTimeout(r, 0));
      }
      this.keys.push(frames);
    }
  }

  setPlaying() {}
  shotAt(t) { return this.base.shotAt(t); }
  lineAt(t) { return this.base.lineAt(t); }

  renderAt(t) {
    const tl = this.tl;
    t = Math.max(0, Math.min(tl.duration, t));
    const { shot, index } = this.shotAt(Math.min(t, tl.endCard.start - 1e-3));
    const frames = this.keys[index] || [];
    const g = this.ctx, W = this.canvas.width, H = this.canvas.height;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    if (frames.length) {
      const u = Math.max(0, Math.min(1, (t - shot.start) / Math.max(0.01, shot.end - shot.start)));
      // which pair of key frames we're between
      let a = 0;
      while (a < frames.length - 1 && t > frames[a + 1].t) a++;
      const b = Math.min(frames.length - 1, a + 1);
      const span = Math.max(0.01, frames[b].t - frames[a].t);
      const mix = a === b ? 0 : smooth(Math.max(0, Math.min(1, (t - frames[a].t) / span)));
      const zoom = 1.02 + 0.07 * u;
      const dir = index % 2 ? 1 : -1;
      const pan = dir * 0.025 * (u - 0.5);
      this.drawKey(frames[a].img, zoom, pan, 1);
      if (mix > 0) this.drawKey(frames[b].img, zoom, pan, mix);
    }
    // fades between settings and at the end, like the 3D film
    let f = t < 0.8 ? 1 - t / 0.8 : 0;
    const next = tl.shots[index + 1], prev = tl.shots[index - 1];
    if (next && next.scene.setting !== shot.scene.setting && shot.end - t < 0.45) f = Math.max(f, 1 - (shot.end - t) / 0.45);
    if (prev && prev.scene.setting !== shot.scene.setting && t - shot.start < 0.45) f = Math.max(f, 1 - (t - shot.start) / 0.45);
    if (t > tl.endCard.start - 0.6) f = Math.max(f, Math.min(1, (t - (tl.endCard.start - 0.6)) / 0.9));
    if (f > 0) { g.fillStyle = `rgba(0,0,0,${f})`; g.fillRect(0, 0, W, H); }
    return { shot, index };
  }

  drawKey(img, zoom, pan, alpha) {
    const g = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const k = Math.max(W / img.width, H / img.height) * zoom;
    const w = img.width * k, h = img.height * k;
    g.globalAlpha = alpha;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, (W - w) / 2 + pan * W, (H - h) / 2, w, h);
    g.globalAlpha = 1;
  }

  setOutputSize(W, H) { this.canvas.width = W; this.canvas.height = H; }
}

const smooth = (x) => x * x * (3 - 2 * x);
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// Painter canvas size for an aspect ratio (multiples of 64).
export function painterSize(aspect) {
  if (aspect === '9:16') return { width: 384, height: 640 };
  if (aspect === '1:1') return { width: 512, height: 512 };
  return { width: 640, height: 384 };
}
