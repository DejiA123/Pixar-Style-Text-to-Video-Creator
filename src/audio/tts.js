// Text-to-speech engines.
//  • KokoroEngine — neural voices that run 100% in the browser (WebGPU/WASM).
//    Produces real audio, so it can be mixed into the exported video.
//  • WebSpeechEngine — the browser's built-in voices. Instant, but the audio
//    can't be captured, so it's for live preview only.
export const KOKORO_LIB = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export class KokoroEngine {
  constructor() {
    this.worker = null;
    this.ready = null;
    this.pending = new Map();
    this.nextId = 1;
    this.cache = new Map();
    this.onProgress = () => {};
  }

  static supported() { return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined'; }

  load({ device } = {}) {
    if (this.ready) return this.ready;
    const useGpu = device === 'webgpu' || (device !== 'wasm' && typeof navigator !== 'undefined' && !!navigator.gpu && /Chrome|Edg/.test(navigator.userAgent));
    this.device = useGpu ? 'webgpu' : 'wasm';
    this.ready = new Promise((resolve, reject) => {
      this.worker = new Worker(new URL('./kokoro-worker.js', import.meta.url), { type: 'module' });
      const files = new Map();
      // Safari (iOS) can kill the worker silently when memory runs short, so
      // every phase has a deadline instead of waiting forever.
      let settled = false;
      const fail = (msg) => { if (settled) return; settled = true; clearTimeout(timer); this.dispose(); reject(new Error(msg)); };
      let timer = setTimeout(() => fail('Voice model took too long to load'), 240000);
      const arm = (ms, msg) => { clearTimeout(timer); timer = setTimeout(() => fail(msg), ms); };
      const ok = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(this); };
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') {
          const p = m.p || {};
          if (p.file && p.total) files.set(p.file, { loaded: p.loaded || 0, total: p.total });
          if (p.status === 'done' && p.file && files.has(p.file)) files.get(p.file).loaded = files.get(p.file).total;
          let L = 0, T = 0;
          for (const f of files.values()) { L += f.loaded; T += f.total; }
          this.onProgress(T ? L / T : 0, T);
          // still downloading: extend the deadline; once complete, allow a minute to start up
          arm(T && L >= T * 0.999 ? 60000 : 90000, 'Voice model stopped loading');
          if (T && L >= T * 0.999) this.onReady?.();
        } else if (m.type === 'loaded') ok();
        else if (m.type === 'audio') { const r = this.pending.get(m.id); this.pending.delete(m.id); r && r.resolve({ samples: m.samples, sampleRate: m.sampleRate }); }
        else if (m.type === 'error') {
          if (m.id && this.pending.has(m.id)) { const r = this.pending.get(m.id); this.pending.delete(m.id); r.reject(new Error(m.error)); }
          else fail(m.error);
        }
      };
      this.worker.onerror = (e) => fail(e.message || 'Voice worker failed to start');
      this.worker.onmessageerror = () => fail('Voice worker message error');
      this.worker.postMessage({ type: 'load', lib: KOKORO_LIB, model: KOKORO_MODEL, dtype: this.device === 'webgpu' ? 'fp32' : 'q8', device: this.device });
    });
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }

  dispose() {
    try { this.worker && this.worker.terminate(); } catch {}
    this.worker = null;
    this.ready = null;
    for (const r of this.pending.values()) r.reject(new Error('Voice engine stopped'));
    this.pending.clear();
  }

  async synthesize(text, { voice = 'af_heart', speed = 1 } = {}) {
    const key = `${voice}|${speed}|${text}`;
    if (this.cache.has(key)) return this.cache.get(key);
    await this.load();
    const id = this.nextId++;
    const p = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // generous per-line deadline (slow phones), then give up on neural voices
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); this.dispose(); reject(new Error('Voice generation timed out')); } }, 30000 + text.length * 400);
    });
    this.worker.postMessage({ type: 'gen', id, text, voice, speed });
    const out = await p;
    // trim leading/trailing near-silence so lines butt together naturally
    const s = out.samples;
    let a = 0, b = s.length - 1;
    while (a < b && Math.abs(s[a]) < 0.004) a++;
    while (b > a && Math.abs(s[b]) < 0.004) b--;
    const trimmed = s.slice(Math.max(0, a - 400), Math.min(s.length, b + 1200));
    const res = { samples: trimmed, sampleRate: out.sampleRate };
    this.cache.set(key, res);
    return res;
  }
}

export class WebSpeechEngine {
  static supported() { return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'; }

  constructor() {
    this.voices = [];
    this.speaking = null;
    if (WebSpeechEngine.supported()) {
      const load = () => { this.voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)); };
      load();
      speechSynthesis.addEventListener?.('voiceschanged', load);
    }
  }

  pickVoice(gender) {
    const vs = this.voices;
    if (!vs.length) return null;
    const fem = /female|samantha|victoria|karen|moira|tessa|zira|susan|serena|fiona|ava|allison|aria|jenny|libby|sonia|natasha|emma|google uk english female|google us english/i;
    const male = /male|daniel|alex|fred|david|mark|george|guy|ryan|thomas|arthur|oliver|rishi|google uk english male/i;
    const pool = vs.filter((v) => (gender === 'f' ? fem.test(v.name) && !/\bmale\b/i.test(v.name.replace(/female/i, '')) : male.test(v.name) && !/female/i.test(v.name)));
    const natural = (v) => /natural|neural|premium|enhanced|google/i.test(v.name);
    return (pool.find(natural) || pool[0] || vs.find(natural) || vs[0]);
  }

  // Speaks now; resolves when finished. onBoundary(charIndex) for lip flaps.
  speak(text, spec = {}, onBoundary) {
    return new Promise((resolve) => {
      if (!WebSpeechEngine.supported()) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      const v = this.pickVoice(spec.gender);
      if (v) u.voice = v;
      u.pitch = Math.max(0, Math.min(2, spec.pitch ?? 1));
      u.rate = Math.max(0.5, Math.min(1.6, spec.rate ?? 1));
      u.onboundary = (e) => onBoundary && onBoundary(e.charIndex);
      u.onend = u.onerror = () => { this.speaking = null; resolve(); };
      this.speaking = u;
      speechSynthesis.speak(u);
    });
  }

  cancel() { if (WebSpeechEngine.supported()) speechSynthesis.cancel(); }
  pause() { if (WebSpeechEngine.supported()) speechSynthesis.pause(); }
  resume() { if (WebSpeechEngine.supported()) speechSynthesis.resume(); }
}
