// Free, on-device AI painter: SD-Turbo running in the browser with ONNX
// Runtime Web on WebGPU (no server, no key, no cost). It repaints a 3D render
// of each shot in an illustrated style (image-to-image), so composition and
// characters stay consistent from shot to shot.
// Pipeline follows Microsoft's onnxruntime-inference-examples/js/sd-turbo.
const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.webgpu.min.mjs';
const TOK_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';
const MODEL_BASE = 'https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/main';
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
        text_encoder: { url: 'text_encoder/model.onnx', mb: 1700, dims: { batch_size: 1 } },
        unet: { url: 'unet/model.onnx', mb: 640, dims: { batch_size: 1, num_channels: 4, height: lh, width: lw, sequence_length: 77 } },
        vae_decoder: { url: 'vae_decoder/model.onnx', mb: 95, dims: { batch_size: 1, num_channels_latent: 4, height_latent: lh, width_latent: lw } },
        vae_encoder: { url: 'vae_encoder/model.onnx', mb: 65, dims: { batch_size: 1, num_channels: 3, height: this.H, width: this.W } },
      };
      const totalMB = Object.values(models).reduce((a, m) => a + m.mb, 0);
      let doneMB = 0;
      const base = {
        executionProviders: ['webgpu'], enableMemPattern: false, enableCpuMemArena: false,
        extra: { session: { disable_prepacking: '1', use_device_allocator_for_initializers: '1', use_ort_model_bytes_directly: '1', use_ort_model_bytes_for_initializers: '1' } },
      };
      for (const [name, m] of Object.entries(models)) {
        const bytes = await cachedBytes(`${MODEL_BASE}/${m.url}`, (got) => this.onProgress((doneMB + got / 1048576) / totalMB, `Downloading AI painter (${Math.round(totalMB / 100) / 10} GB, one time)`));
        doneMB += m.mb;
        this.onProgress(doneMB / totalMB, 'Starting AI painter');
        const opt = { ...base, freeDimensionOverrides: m.dims };
        if (name === 'text_encoder') opt.preferredOutputLocation = { last_hidden_state: 'gpu-buffer' };
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
    const { input_ids } = await this.tokenizer(prompt, { padding: true, max_length: 77, truncation: true, return_tensor: false });
    const { last_hidden_state } = await S.text_encoder.run({ input_ids: new ort.Tensor('int32', input_ids, [1, input_ids.length]) });
    const n = 4 * (H / 8) * (W / 8);
    const noise = gaussian(n, seed);
    let t = 999, sigma = 14.6146;
    let latents;
    if (init) {
      t = Math.max(1, Math.min(999, Math.round(999 * strength)));
      sigma = Math.sqrt((1 - ALPHAS[t]) / ALPHAS[t]);
      const enc = await S.vae_encoder.run({ [S.vae_encoder.inputNames[0]]: this.imageTensor(init) });
      const lat = enc[S.vae_encoder.outputNames[0]].data;
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
    return new this.ort.Tensor(out, [1, 3, this.H, this.W]);
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
