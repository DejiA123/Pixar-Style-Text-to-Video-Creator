// Storyreel app controller: story → plan → voices → timeline → film →
// soundtrack → player, plus export. Two render paths: the built-in 3D engine
// and the Cinematic AI renderer (fal.ai).
import { parseStory, displayName } from '../story/parser.js';
import { SAMPLES } from '../story/samples.js';
import { SETTING_LABEL, INTERIOR_SETTINGS } from '../story/lexicon.js';
import { FilmRenderer } from '../engine/renderer.js';
import { buildTimeline, lineKey } from '../film/timeline.js';
import { Film } from '../film/film.js';
import { Compositor } from '../film/compositor.js';
import { Player } from '../film/player.js';
import { exportVideo } from '../film/exporter.js';
import { castVoices, KOKORO_NARRATORS } from '../audio/voices.js';
import { Painter, PaintedFilm, painterSize } from '../ai/painter.js';
import { renderFreeFilm } from '../ai/freefilm.js';
import { aiServer, serverlessId, waitForServer } from '../ai/aiserver.js';
import { serverVoices } from '../ai/servervoice.js';
import { KokoroEngine, WebSpeechEngine } from '../audio/tts.js';
import { renderSoundtrack, lipEnvelope, clipDuration } from '../audio/mixer.js';
import { timecode, formatTime } from '../util.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('storyreel:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('storyreel:' + k, JSON.stringify(v)); } catch {} },
};

const state = {
  fr: null, film: null, compositor: null, player: null, soundtrack: null, timeline: null, plan: null,
  busy: false, kokoro: null, aspect: '16:9', exportAbort: null,
};

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------
function init() {
  const chips = $('samples');
  for (const s of SAMPLES) {
    const b = document.createElement('button');
    b.className = 'chip'; b.type = 'button'; b.textContent = s.label; b.setAttribute('role', 'listitem');
    b.addEventListener('click', () => {
      $('story').value = s.text;
      for (const c of chips.children) c.setAttribute('aria-pressed', String(c === b));
      store.set('draft', s.text);
    });
    chips.appendChild(b);
  }
  const draft = store.get('draft', null);
  $('story').value = draft || SAMPLES[0].text;
  if (!draft) chips.children[0].setAttribute('aria-pressed', 'true');
  $('story').addEventListener('input', () => store.set('draft', $('story').value));

  const nar = $('narrator');
  for (const n of KOKORO_NARRATORS) { const o = document.createElement('option'); o.value = n.id; o.textContent = n.label; nar.appendChild(o); }
  // AI film with AI voices only: their old saved choices are no longer restored
  for (const id of ['narrator', 'aspect', 'length', 'quality', 'export-res', 'ai-video']) {
    const el = $(id); const v = store.get(id, null);
    if (v != null && [...el.options].some((o) => o.value === v)) el.value = v;
    el.addEventListener('change', () => { store.set(id, el.value); onSettings(id); });
  }
  for (const id of ['sfx', 'subs']) {
    const el = $(id); const v = store.get(id, null);
    if (v != null) el.checked = v;
    el.addEventListener('change', () => { store.set(id, el.checked); onSettings(id); });
  }
  $('fal-key').value = store.get('fal-key', '');
  $('fal-key').addEventListener('change', () => store.set('fal-key', $('fal-key').value.trim()));
  if (store.get('render-mode', null) == null) $('render-mode').value = 'free';
  $('ai-server').value = store.get('ai-server', '');
  $('ai-server').addEventListener('change', () => store.set('ai-server', $('ai-server').value.trim()));
  $('runpod-key').value = store.get('runpod-key', '');
  $('runpod-key').addEventListener('change', () => store.set('runpod-key', $('runpod-key').value.trim()));
  setupServerStatus();
  $('hf-token').value = store.get('hf-token', '');
  $('hf-token').addEventListener('change', () => store.set('hf-token', $('hf-token').value.trim()));
  $('free-animate').checked = store.get('free-animate', true);
  $('free-animate').addEventListener('change', () => store.set('free-animate', $('free-animate').checked));
  $('review-first').checked = store.get('review-first', true);
  $('review-first').addEventListener('change', () => store.set('review-first', $('review-first').checked));
  onSettings('render-mode');
  $('style-ref').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    state.styleImage = f ? await downscaleImage(f, 1024) : null;
    if (f) toast('Style reference loaded. Characters and shots will follow its look.');
  });

  const out = $('out');
  state.compositor = new Compositor(out);
  state.glCanvas = document.createElement('canvas');
  setAspect($('aspect').value);

  $('make').addEventListener('click', () => makeMovie().catch(fail));
  $('play').addEventListener('click', () => state.player && state.player.toggle());
  $('scrub').addEventListener('input', (e) => state.player && state.player.seek((+e.target.value / 1000) * state.player.duration));
  $('fs').addEventListener('click', () => { const s = $('screen'); (s.requestFullscreen ? s.requestFullscreen() : Promise.reject()).catch(() => {}); });
  $('export').addEventListener('click', () => doExport().catch(fail));
  $('busy-cancel').addEventListener('click', () => state.exportAbort && state.exportAbort.abort());
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('textarea, input, select')) return;
    if (e.code === 'Space' && state.player) { e.preventDefault(); state.player.toggle(); }
  });
  new ResizeObserver(() => resizePreview()).observe($('screen'));
  // Ctrl/⌘+Enter generates; clicking elsewhere closes the settings popover
  $('story').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); makeMovie().catch(fail); } });
  document.addEventListener('click', (e) => { const d = $('settings'); if (d.open && !d.contains(e.target)) d.open = false; });
  window.__storyreel = state; // handy for debugging and automated tests
}

// Shot review: every picture is shown before anything is animated. Redo repaints one
// shot (a note like "she wears a red dress" goes first in its picture and video
// prompts); Animate film continues, Cancel stops the film.
function reviewShots({ shots, blobs, repaint }) {
  return new Promise((resolve, reject) => {
    const panel = $('review'), grid = $('review-grid'), go = $('review-go');
    const urls = [];
    const url = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };
    let busy = 0;
    const sync = () => { go.disabled = busy > 0; go.textContent = busy ? 'Painting…' : 'Animate film'; };
    grid.innerHTML = '';
    shots.forEach((shot, i) => {
      const card = document.createElement('div'); card.className = 'review-card';
      const pic = document.createElement('div'); pic.className = 'pic';
      const img = document.createElement('img'); img.alt = `Shot ${i + 1}`;
      const state = document.createElement('span'); state.className = 'state';
      if (blobs[i]) img.src = url(blobs[i]); else state.textContent = 'Not painted yet: tap Redo';
      pic.append(img, state);
      const cap = document.createElement('p'); cap.className = 'cap';
      const said = shot.kind === 'title' ? 'Opening title' : (shot.lines.map((l) => l.text).join(' ') || shot.scene.text || '');
      const num = document.createElement('b'); num.textContent = `Shot ${i + 1}`;
      cap.append(num, ` · ${said.length > 140 ? said.slice(0, 137) + '…' : said}`);
      const row = document.createElement('div'); row.className = 'row';
      const note = document.createElement('input'); note.type = 'text'; note.placeholder = 'What to change (optional)'; note.setAttribute('aria-label', `What to change in shot ${i + 1}`);
      const redo = document.createElement('button'); redo.type = 'button'; redo.className = 'btn-ghost'; redo.textContent = 'Redo';
      redo.onclick = async () => {
        busy++; sync(); redo.disabled = true; pic.classList.add('busy'); state.textContent = 'Painting…';
        try {
          const b = await repaint(i, note.value);
          if (b) { img.src = url(b); state.textContent = ''; } else state.textContent = 'Couldn’t paint it: try again';
        } catch (e) { console.warn(e); state.textContent = 'Couldn’t paint it: try again'; }
        busy--; sync(); redo.disabled = false; pic.classList.remove('busy');
      };
      note.addEventListener('keydown', (e) => { if (e.key === 'Enter') redo.click(); });
      row.append(note, redo);
      const meta = document.createElement('div'); meta.className = 'meta';
      meta.append(cap, row);
      card.append(pic, meta);
      grid.append(card);
    });
    const close = () => { panel.hidden = true; go.onclick = $('review-cancel').onclick = null; setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 1000); };
    go.onclick = () => { close(); resolve(); };
    $('review-cancel').onclick = () => { close(); reject(new DOMException('Stopped', 'AbortError')); };
    sync();
    panel.hidden = false;
  });
}

// Your AI server from Settings: a RunPod Serverless endpoint (ID + API key) or a link.
const currentServer = () => aiServer($('ai-server').value, $('runpod-key').value);

// Live status of your AI server: a line under its link in Settings and a pill next
// to Generate (green ready, amber starting, red not running). Health checks don't
// count as use, so they never keep an idle pod (and its bill) alive.
function setupServerStatus() {
  const box = $('server-status'), chip = $('server-chip');
  let timer = 0, seq = 0;
  const show = (st, text, short) => {
    box.dataset.server = chip.dataset.server = st;
    box.querySelector('.text').textContent = text;
    chip.querySelector('.label').textContent = short;
    chip.title = text;
  };
  async function refresh() {
    clearTimeout(timer);
    const value = $('ai-server').value.trim();
    $('runpod-key-field').hidden = !serverlessId(value);
    const server = currentServer();
    box.hidden = chip.hidden = !server;
    if (!server) return;
    const mine = ++seq;
    if (!box.dataset.server) show('checking', 'Checking your AI server…', 'Checking…');
    const h = await server.health();
    if (mine !== seq) return;
    let again = 15000;
    if (server.kind === 'serverless') {
      if (h?.needsKey) show('starting', 'Add your RunPod API key below.', 'Needs key');
      else if (h?.badKey) show('down', 'RunPod didn’t accept that API key.', 'Key refused');
      else if (!h) show('down', 'Can’t reach that RunPod endpoint: check the endpoint ID.', 'Server off');
      else {
        show('ready', `Ready · RunPod Serverless · ${h.warm ? `${h.warm} GPU${h.warm > 1 ? 's' : ''} warm` : h.starting ? 'a GPU is starting…' : 'a GPU starts when you generate (the first film waits a few minutes)'}`, 'Server ready');
        again = 30000;
      }
    } else if (!h) show('down', 'Not running. Start a pod in RunPod (or your own server), then paste its new link here.', 'Server off');
    else if (!h.ready) show('starting', `Starting: ${h.loading}…`, 'Starting…');
    else {
      const lips = h.lipsync ? 'lip sync ✓' : h.lipsync_state === 'setting up' ? 'lip sync setting up…' : 'no lip sync';
      show('ready', `Ready · ${[h.gpu, h.video ? 'AI video ✓' : 'no AI video', h.tts ? 'voices ✓' : 'no voices', lips].filter(Boolean).join(' · ')}`, 'Server ready');
      if (h.lipsync_state !== 'setting up') again = 60000;
    }
    timer = setTimeout(refresh, again);
  }
  $('ai-server').addEventListener('input', () => { clearTimeout(timer); delete box.dataset.server; timer = setTimeout(refresh, 700); });
  $('ai-server').addEventListener('change', refresh);
  $('runpod-key').addEventListener('change', refresh);
  chip.addEventListener('click', (e) => { e.stopPropagation(); $('settings').open = true; });
  refresh();
}

function onSettings(id) {
  if (id === 'render-mode') { $('ai-box').hidden = $('render-mode').value !== 'ai'; $('free-box').hidden = $('render-mode').value !== 'free'; }
  if (id === 'aspect' && !state.player) setAspect($('aspect').value);
  if (id === 'subs' && state.compositor) { state.compositor.subtitles = $('subs').checked; state.player?.render(); }
  if (id === 'quality' && state.fr && !state.ai) { state.fr.setQuality($('quality').value); resizePreview(); }
}

function setAspect(a) {
  state.aspect = a;
  const s = $('screen');
  s.classList.toggle('v916', a === '9:16');
  s.classList.toggle('v11', a === '1:1');
  s.style.aspectRatio = a === '9:16' ? '9 / 16' : a === '1:1' ? '1 / 1' : '16 / 9';
  resizePreview();
}
const aspectNum = (a) => (a === '9:16' ? 9 / 16 : a === '1:1' ? 1 : 16 / 9);

function previewSize() {
  const r = $('screen').getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return { w: Math.max(2, Math.round(r.width)), h: Math.max(2, Math.round(r.height)), dpr };
}

function resizePreview() {
  const { w, h, dpr } = previewSize();
  if (!state.compositor) return;
  if (state.exporting) return;
  state.compositor.setSize(Math.round(w * dpr), Math.round(h * dpr));
  if (state.fr && !state.ai) state.fr.setSize(w, h, dpr > 1 ? 1.25 : 1);
  if (state.player) state.player.render();
}

// ---------------------------------------------------------------------------
// progress steps
// ---------------------------------------------------------------------------
// One live bar for the whole film. Each step owns a slice of 0–100%; between updates the
// bar keeps creeping toward the next one (never past it) so it never looks frozen, and
// the time left comes from how fast this film is actually going.
// voicesDl: the in-browser voice model downloading; voices: its lines; voices2: realistic voices on your server
const SLICES = { plan: [0, 3], voicesDl: [3, 5], voices: [5, 10], voices2: [10, 18], build: [18, 95], paint: [90, 95], score: [95, 100] };
const meter = {
  start() {
    clearInterval(this.timer);
    Object.assign(this, { pct: 0, shown: 0, end: 3, step: 0, stepMs: 8000, last: Date.now(), t0: Date.now(), samples: [], paused: 0, pausedAt: 0, note: '' });
    $('p-strip').hidden = true; $('p-strip').innerHTML = '';
    this.timer = setInterval(() => this.tick(), 250);
    this.tick();
  },
  stage(key, frac) {
    const [a, b] = SLICES[key] || [0, 0];
    let f = Math.max(0, Math.min(1, frac));
    this.end = Math.max(this.end || 0, b);  // the bar may creep, but never past the current step's share
    if (key === 'build') f = f <= 0.5 ? f / 0.5 * 0.22 : 0.22 + (f - 0.5) / 0.5 * 0.78;  // painting is quick, animating isn't
    this.to(a + (b - a) * f);
  },
  to(pct) {
    if (pct <= this.pct) return;
    const now = Date.now();
    this.step = pct - this.pct; this.stepMs = Math.max(4000, now - this.last); this.last = now;
    this.pct = pct;
    this.samples.push([now - this.paused, pct]);
  },
  now(text) { $('p-now').textContent = text; },
  pause(text) { this.pausedAt = Date.now(); this.note = text; },
  resume() { if (this.pausedAt) this.paused += Date.now() - this.pausedAt; this.pausedAt = 0; this.note = ''; this.last = Date.now(); },
  finish() { this.pct = this.shown = 100; this.tick(); clearInterval(this.timer); },
  stop() { clearInterval(this.timer); },
  tick() {
    const now = Date.now();
    // catch up quickly to real progress, then creep toward most of the next expected step
    const ceiling = this.pausedAt ? this.pct : Math.min(99, this.end - 0.5, this.pct + this.step * 0.85);
    if (this.shown < this.pct) this.shown = Math.min(this.pct, this.shown + Math.max(0.4, (this.pct - this.shown) * 0.25));
    else if (this.shown < ceiling) this.shown += (ceiling - this.shown) * Math.min(0.08, 250 / this.stepMs);
    $('p-pct').textContent = `${Math.floor(this.shown)}%`;
    $('p-fill').style.width = `${this.shown}%`;
    const active = now - this.t0 - this.paused - (this.pausedAt ? now - this.pausedAt : 0);
    const clock = (ms) => { const sec = Math.round(ms / 1000); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
    let left = '';
    if (this.pausedAt) left = this.note;
    else {
      const recent = this.samples.filter(([t]) => t >= now - this.paused - 150000);
      // time left only once the shots are being made: before that there's too little to go on
      if (recent.length >= 2 && this.pct >= 20 && recent[recent.length - 1][0] - recent[0][0] > 10000) {
        const [t1, p1] = recent[0], [t2, p2] = recent[recent.length - 1];
        const rate = (p2 - p1) / Math.max(1, t2 - t1);  // % per ms
        if (rate > 0) { const sec = (100 - this.pct) / rate / 1000; left = sec < 50 ? 'under a minute left' : `about ${Math.round(sec / 60)} min left`; }
      }
    }
    $('p-time').textContent = [clock(active), left].filter(Boolean).join(' · ');
  },
  // the film's shots as a filmstrip: grey until painted, then the picture, ✓ once animated
  shots(n, aspect) {
    const strip = $('p-strip'); strip.innerHTML = '';
    for (let i = 0; i < n; i++) { const d = document.createElement('div'); d.className = `p-shot ${aspect === '9:16' ? 'v916' : aspect === '1:1' ? 'v11' : ''}`; strip.appendChild(d); }
    strip.hidden = !n;
  },
  shot(i, blob, state) {
    const d = $('p-strip').children[i];
    if (!d) return;
    if (blob) { if (d._url) URL.revokeObjectURL(d._url); d._url = URL.createObjectURL(blob); d.style.backgroundImage = `url(${d._url})`; }
    d.dataset.state = state;
    if (state === 'painted' && blob) d.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  },
};

const steps = {
  list: [],
  reset(names) {
    const ol = $('steps'); ol.innerHTML = '';
    meter.start();
    this.list = names.map(([key, label]) => { const li = document.createElement('li'); li.dataset.key = key; li.innerHTML = `<span>${label}</span><span class="pct"></span>`; ol.appendChild(li); return li; });
  },
  set(key, status, pct) {
    const li = this.list.find((l) => l.dataset.key === key);
    if (!li) return;
    li.classList.remove('active', 'done', 'error');
    if (status) li.classList.add(status);
    if (pct != null) li.querySelector('.pct').textContent = typeof pct === 'number' ? `${Math.round(pct * 100)}%` : pct;
    else if (status === 'done') li.querySelector('.pct').textContent = '';
    // feed the overall bar: a fraction, an "a/b" count, or done
    const frac = typeof pct === 'number' ? pct : typeof pct === 'string' && /^\d+\/\d+$/.test(pct) ? pct.split('/')[0] / pct.split('/')[1] : null;
    if (status === 'done') { meter.stage(key, 1); if (key === 'voices') meter.stage('voices2', 1); }
    else if (frac != null) meter.stage(key === 'voices' && typeof pct === 'number' ? 'voicesDl' : key, frac);
    if (status === 'active' && !$('p-now').textContent) meter.now(li.firstChild.textContent);
    if (status === 'error') meter.stop();
  },
  label(key, text) {
    const li = this.list.find((l) => l.dataset.key === key);
    if (li) li.firstChild.textContent = text;
    if (li?.classList.contains('active')) meter.now(text);
  },
};

function toast(msg, err = false, ms = 6000) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false; t.classList.toggle('err', err);
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

function fail(e) {
  console.error(e);
  meter.stop();
  state.busy = false;
  $('make').disabled = false;
  $('make').textContent = 'Generate';
  for (const li of steps.list) if (li.classList.contains('active')) { li.classList.remove('active'); li.classList.add('error'); }
  if (e && e.name === 'AbortError') { toast('Stopped.'); return; }
  toast(`Something went wrong: ${e && e.message ? e.message : e}`, true, 9000);
}

// ---------------------------------------------------------------------------
// make a movie
// ---------------------------------------------------------------------------
async function makeMovie() {
  if (state.busy) return;
  const text = $('story').value.trim();
  if (!text) { toast('Write a story first, or pick one of the examples.'); return; }
  state.busy = true;
  $('make').disabled = true;
  $('make').textContent = 'Generating…';
  if (state.player) { state.player.dispose(); state.player = null; }
  const ai = $('render-mode').value === 'ai';
  let painted = $('render-mode').value === 'painted';
  let freeAI = $('render-mode').value === 'free' || $('render-mode').value === '3d';
  if (painted) {
    const sup = await Painter.supported();
    if (!sup.ok) { painted = false; freeAI = true; toast('This device can’t run the on-device AI painter, so your film is being painted by the free online AI instead.', false, 8000); }
  }
  const neural = $('voice-engine').value === 'neural';
  // one AI server client for the whole film; a serverless GPU waking up shows in the progress card
  const server = freeAI ? currentServer() : null;
  if (server) {
    server.onWait = (op, sec) => {
      if (sec < 0) { const li = steps.list.find((l) => l.classList.contains('active')); if (li) meter.now(li.firstChild.textContent); return; }
      if (sec < 8) return;
      const t = `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
      meter.now(`Waking up a GPU on RunPod… ${t} (usually 2–3 min; the very first start also downloads the AI models, about 20 min)`);
    };
  }
  setAspect($('aspect').value);
  steps.reset([
    ['plan', ai ? 'AI director is reading your story' : 'Reading your story'],
    ['voices', neural ? 'Recording voices' : 'Casting voices'],
    ['build', ai || freeAI ? 'Painting and animating your shots' : 'Building the world'],
    ...(painted ? [['paint', 'Painting every shot with AI']] : []),
    ['score', 'Mixing voices and sound'],
  ]);

  // 1) plan
  steps.set('plan', 'active');
  let plan;
  let aiDirector = null;
  if (ai) {
    const mod = await import('../ai/cinematic.js');
    aiDirector = new mod.CinematicRenderer({ key: $('fal-key').value.trim(), videoModel: $('ai-video').value, aspect: state.aspect, styleImage: state.styleImage || null });
    plan = await aiDirector.direct(text, parseStory(text), (msg) => steps.label('plan', msg));
  } else {
    plan = parseStory(text);
  }
  if (!plan.scenes.length) throw new Error('I couldn’t find any sentences in that story.');
  state.plan = plan;
  steps.set('plan', 'done');

  // 2) voices
  steps.set('voices', 'active');
  const voices = castVoices(plan.cast, $('narrator').value);
  const clips = new Map();
  const durations = new Map();
  let usedNeural = false;
  if (neural) {
    try {
      if (!state.kokoro) state.kokoro = new KokoroEngine();
      const k = state.kokoro;
      k.onProgress = (p) => { steps.label('voices', 'Downloading voice model (one time)'); steps.set('voices', 'active', p); };
      k.onReady = () => { steps.label('voices', 'Starting voice engine'); steps.set('voices', 'active', ''); };
      await k.load();
      const lines = [{ speaker: 'narrator', text: plan.title }];
      for (const s of plan.scenes) for (const l of s.lines) lines.push(l);
      const uniq = [...new Map(lines.map((l) => [lineKey(l.speaker, l.text), l])).values()];
      steps.label('voices', 'Recording voices');
      let i = 0;
      for (const l of uniq) {
        const v = voices.get(l.speaker) || voices.get('narrator');
        const clip = await k.synthesize(l.text, v.kokoro);
        const key = lineKey(l.speaker, l.text);
        clips.set(key, clip);
        durations.set(key, clipDuration(clip, v.rate || 1));
        steps.set('voices', 'active', `${++i}/${uniq.length}`);
      }
      usedNeural = true;
      // realistic voices: your AI server re-speaks every line in the same voices, with emotion
      const srv = server;
      let health = srv ? await srv.health() : null;
      if (health?.ok === false) health = null;
      if (health) health = await waitForServer(srv, health, (p, msg) => steps.label('voices', msg));
      if (health?.tts) {
        steps.label('voices', 'Recording realistic voices on your AI server');
        try {
          if (await serverVoices(srv, plan, clips, voices, { onProgress: (p, n) => { steps.set('voices', 'active', n); meter.stage('voices2', p); } })) {
            for (const [sp, v] of voices) voices.set(sp, { ...v, rate: 1 });  // speed and pitch are in the new recordings
            for (const [key, clip] of clips) durations.set(key, clipDuration(clip, 1));
          }
        } catch (e) { console.warn('AI server voices unavailable, keeping in-browser voices', e); }
      }
    } catch (e) {
      console.warn('Neural voices unavailable, falling back to browser voices', e);
      state.kokoro?.dispose?.();
      state.kokoro = null;
      clips.clear(); durations.clear();
      toast('AI voices couldn’t load here, so this preview uses your browser’s voices. Downloads will have music but no narration.', false, 9000);
    }
  }
  steps.set('voices', 'done');

  // 3) timeline + world
  const target = $('length').value === 'auto' ? null : +$('length').value;
  const tl = buildTimeline(plan, durations, { rate: 0.95, target });
  if (target && tl.duration > target + 1) toast(`Your story needs about ${Math.ceil(tl.duration)} seconds to tell everything it says, so the film is ${formatTime(tl.duration)}. Shorten the story for a shorter film.`, false, 9000);
  state.timeline = tl;
  steps.set('build', 'active');
  let film;
  if (ai) {
    film = await aiDirector.render(tl, (p, msg) => { steps.label('build', msg); steps.set('build', 'active', p); }, confirmCost);
    state.ai = true;
  } else if (freeAI) {
    meter.shots(tl.shots.length, state.aspect);
    film = await renderFreeFilm(tl, {
      aspect: state.aspect, hfToken: $('hf-token').value.trim(), animate: $('free-animate').checked, server,
      fallbackStill: makeLocalPainter(), voice: usedNeural ? { clips, voices } : null,
      review: $('free-animate').checked && $('review-first').checked ? async (r) => {
        steps.label('build', 'Waiting for you to check the shots'); meter.pause('waiting for you');
        try { await reviewShots(r); } finally { meter.resume(); }
      } : null,
      onShot: (i, blob, st) => meter.shot(i, blob, st),
      onProgress: (p, msg) => { steps.label('build', msg); steps.set('build', 'active', p); },
    });
    state.ai = true;
    if (film.serverDown) toast('Your AI server isn’t running, so free online AI was used instead. Start it again in RunPod (or on your PC) and paste its new link in Settings.', false, 12000);
    else if ($('free-animate').checked) toast(film.usedServer && film.animatedCount ? `All ${film.animatedCount} shots animated on your AI server${film.lipsynced ? `, ${film.lipsynced} with lip sync` : ''}${film.serverSeconds != null ? ` (GPU time ${Math.round(film.serverSeconds)} s${film.serverCost != null ? `, about $${film.serverCost.toFixed(3)}` : ''})` : ''}.` : film.animatedCount ? `${film.animatedCount} of ${tl.shots.length} shots animated with free AI video${film.reason ? ` (${film.reason}; the rest move as paintings)` : ''}.` : `Shots play as moving AI paintings${film.reason ? ` — ${film.reason}` : ''}. Add a free Hugging Face token in Settings for more AI video.`, false, 9000);
  } else {
    if (!state.fr) state.fr = new FilmRenderer(state.glCanvas, { quality: $('quality').value });
    state.fr.setQuality($('quality').value);
    const { w, h, dpr } = previewSize();
    state.fr.setSize(w, h, dpr > 1 ? 1.25 : 1);
    film = new Film(state.fr, tl, { aspect: aspectNum(state.aspect), storyText: text });
    await film.prepare((p) => steps.set('build', 'active', p));
    state.ai = false;
  }
  for (const [key, clip] of clips) {
    const sp = key.split('::')[0];
    film.envelopes.set(key, lipEnvelope(clip, (voices.get(sp) || voices.get('narrator')).rate || 1));
  }
  steps.set('build', 'done');
  if (painted && await confirmModelDownload()) {
    steps.set('paint', 'active');
    try {
      const size = painterSize(state.aspect);
      if (!state.painter || state.painter.W !== size.width || state.painter.H !== size.height) state.painter = new Painter(size);
      state.painter.onProgress = (p, msg) => { steps.label('paint', msg); steps.set('paint', 'active', p); };
      await state.painter.load();
      const pf = new PaintedFilm(film, state.fr, state.glCanvas, state.painter, aspectNum(state.aspect) < 1 ? { width: 720, height: 1280 } : aspectNum(state.aspect) === 1 ? { width: 1024, height: 1024 } : { width: 1280, height: 720 });
      state.fr.setQuality('high');
      await pf.prepare((p, msg) => { steps.label('paint', msg); steps.set('paint', 'active', p); });
      state.fr.setQuality($('quality').value);
      film = pf;
      steps.set('paint', 'done');
    } catch (e) {
      console.warn('AI painting failed, using the 3D film', e);
      state.painter = null;
      steps.set('paint', 'error');
      toast(`The on-device AI painter couldn’t run here (${e.message || e}). Switch Render style to “AI film — free, online”.`, true, 9000);
      throw e;
    }
  } else if (painted) steps.set('paint', 'done');
  state.film = film;

  // 4) soundtrack
  steps.set('score', 'active');
  state.soundtrack = await renderSoundtrack(tl, clips, voices, { music: false, sfx: $('sfx').checked, seed: plan.title.length });
  state.hasVoiceAudio = usedNeural;
  steps.set('score', 'done');
  meter.finish();

  // 5) player
  $('empty').hidden = true;
  state.compositor.subtitles = $('subs').checked;
  state.player = new Player({
    film, compositor: state.compositor, glCanvas: film.canvas || state.glCanvas, soundtrack: state.soundtrack,
    liveSpeech: !usedNeural && WebSpeechEngine.supported(), voices,
    onTime: (t, ended) => onTime(t, ended),
  });
  resizePreview();
  buildBoard(tl);
  $('play').disabled = false; $('scrub').disabled = false; $('export').disabled = false;
  $('dur').textContent = formatTime(tl.duration);
  state.busy = false;
  $('make').disabled = false;
  $('make').textContent = 'Generate again';
  await captureThumbs(tl);
  state.player.seek(0);
  state.player.play();
}

// A frame from the middle of every shot, shown on its card.
async function captureThumbs(tl) {
  const cards = $('board').children, out = $('out');
  const c = document.createElement('canvas');
  const w = 320, h = Math.round(w / aspectNum(state.aspect));
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  for (let i = 0; i < tl.shots.length && i < cards.length; i++) {
    try {
      const s = tl.shots[i];
      state.player.seek(s.start + (s.end - s.start) * 0.55);
      g.drawImage(out, 0, 0, w, h);
      const th = cards[i].querySelector('.thumb');
      if (th) th.style.backgroundImage = `url(${c.toDataURL('image/jpeg', 0.75)})`;
    } catch (e) { console.warn('thumbnail failed', e); }
    await new Promise((r) => setTimeout(r, 0));
  }
}

// In-page confirmation for paid AI renders (no window.confirm in sandboxes).
// Last link of the never-stop chain: the on-device AI painter draws the shot
// from its description (AI only — never a 3D frame). Used only on devices that
// can run it and already have the model, so there's no surprise download.
function makeLocalPainter() {
  let painter = undefined;
  return async (i, prompt) => {
    if (painter === undefined) {
      painter = null;
      try {
        const size = painterSize(state.aspect);
        const cached = await (await caches.open('storyreel-models')).match('https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/main/unet/model.onnx');
        if (cached && (await Painter.supported()).ok) { painter = state.painter && state.painter.W === size.width ? state.painter : new Painter(size); await painter.load(); state.painter = painter; }
      } catch (e) { console.warn('on-device painter unavailable', e); painter = null; }
    }
    return painter ? painter.paint(prompt, { seed: 1000 + i }) : null;
  };
}

// One-time ~2.6 GB model download: ask first (skipped once it's cached).
async function confirmModelDownload() {
  try {
    const c = await caches.open('storyreel-models');
    if (await c.match('https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/main/unet/model.onnx')) return true;
  } catch {}
  if (store.get('painter-ok', false)) return true;
  return new Promise((resolve) => {
    const li = document.createElement('li');
    li.className = 'active';
    li.innerHTML = '<span>The free AI painter is a one-time <b>2.6 GB</b> download (best on Wi-Fi). It then stays on this device.</span><span></span>';
    const go = document.createElement('button'); go.className = 'btn-primary'; go.textContent = 'Download & paint'; go.type = 'button';
    const no = document.createElement('button'); no.className = 'btn-ghost'; no.textContent = 'Use 3D'; no.type = 'button';
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;margin-top:8px';
    row.append(go, no); li.appendChild(row); $('steps').appendChild(li);
    go.onclick = () => { li.remove(); store.set('painter-ok', true); resolve(true); };
    no.onclick = () => { li.remove(); resolve(false); };
  });
}

function confirmCost(estimate) {
  return new Promise((resolve) => {
    const li = document.createElement('li');
    li.className = 'active';
    li.innerHTML = `<span>About ${estimate.shots} AI shots · estimated cost <b>$${estimate.usd.toFixed(2)}</b> on your fal.ai account.</span><span></span>`;
    const go = document.createElement('button'); go.className = 'btn-primary'; go.textContent = 'Render it'; go.type = 'button';
    const no = document.createElement('button'); no.className = 'btn-ghost'; no.textContent = 'Cancel'; no.type = 'button';
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;grid-column:1/-1';
    row.append(go, no);
    li.appendChild(row);
    $('steps').appendChild(li);
    go.onclick = () => { li.remove(); resolve(true); };
    no.onclick = () => { li.remove(); resolve(false); };
  });
}

function onTime(t, ended) {
  const p = state.player;
  if (!p) return;
  $('tc').textContent = timecode(t, 24);
  if (document.activeElement !== $('scrub')) $('scrub').value = String(Math.round((t / p.duration) * 1000));
  $('play-icon').setAttribute('d', p.playing ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M8 5v14l11-7z');
  $('play').setAttribute('aria-label', p.playing ? 'Pause' : 'Play');
  const { index } = state.film.shotAt(Math.min(t, state.timeline.endCard.start - 0.01));
  if (index !== state._shot) {
    state._shot = index;
    const cards = $('board').children;
    for (let i = 0; i < cards.length; i++) cards[i].classList.toggle('now', i === index);
  }
}

function slugline(shot) {
  const sc = shot.scene;
  const ie = INTERIOR_SETTINGS.has(sc.setting) ? 'INT.' : 'EXT.';
  const time = { dawn: 'MORNING', day: 'DAY', sunset: 'SUNSET', night: 'NIGHT' }[sc.time] || 'DAY';
  return `${ie} ${SETTING_LABEL[sc.setting] || sc.setting.toUpperCase()} — ${time}`;
}
const SHOT_ABBR = { establishing: 'EST', wide: 'WS', medium: 'MS', closeup: 'CU', 'over-shoulder': 'OTS', tracking: 'TRACK', lowangle: 'LOW', 'two-shot': '2S', title: 'TITLE' };

function buildBoard(tl) {
  const b = $('board');
  b.innerHTML = '';
  tl.shots.forEach((s, i) => {
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'card'; card.setAttribute('role', 'listitem');
    const who = (s.ids || []).map((id) => displayName(tl.cast.find((c) => c.id === id))).join(', ');
    const line = s.kind === 'title' ? tl.title : (s.lines[0] ? s.lines[0].text : s.scene.text);
    card.innerHTML = `<span class="thumb"></span><span class="slugline">SC ${String(i).padStart(2, '0')} · ${slugline(s)}</span>
      <span class="shot"><span class="tag">${SHOT_ABBR[s.kind === 'title' ? 'title' : s.type] || s.type.toUpperCase()}</span><span class="tag mood">${(s.scene.mood || '').toUpperCase()}</span><span class="dim" style="font:12px var(--font-script)">${(s.end - s.start).toFixed(1)}s</span></span>
      <span class="line"></span>${who ? `<span class="who"></span>` : ''}`;
    card.querySelector('.line').textContent = line;
    if (who) card.querySelector('.who').textContent = who;
    card.addEventListener('click', () => state.player && state.player.seek(s.start + 0.01));
    b.appendChild(card);
  });
  $('board-meta').textContent = `${tl.shots.length} shots · ${formatTime(tl.duration)}`;
  const marks = $('marks');
  marks.innerHTML = '';
  for (const s of tl.shots) { const m = document.createElement('i'); m.style.left = `${(s.start / tl.duration) * 100}%`; marks.appendChild(m); }
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------
async function doExport() {
  const p = state.player;
  if (!p || state.exporting) return;
  p.pause();
  if (!state.hasVoiceAudio && $('voice-engine').value === 'browser') {
    toast('Browser voices can’t be recorded, so the download will have music and subtitles but no narration. Switch Voices to “AI voices” for a full voice-over.', false, 9000);
  }
  const res = +$('export-res').value;
  const a = aspectNum(state.aspect);
  let W, H;
  if (a >= 1) { H = res; W = Math.round((res * a) / 2) * 2; } else { W = res; H = Math.round(res / a / 2) * 2; }
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = W; exportCanvas.height = H;
  const comp = new Compositor(exportCanvas);
  comp.subtitles = $('subs').checked;
  state.exporting = true;
  const prevQ = state.fr?.qualityName;
  if (state.film instanceof PaintedFilm) state.film.setOutputSize(W, H);
  else if (!state.ai) { state.fr.setQuality('export'); state.fr.setSize(W, H, 1); }
  else await state.film.prepareExport?.(W, H);
  await document.fonts.ready;
  $('busy').hidden = false;
  $('busy-title').textContent = 'Rendering your movie';
  const ac = new AbortController();
  state.exportAbort = ac;
  try {
    const out = await exportVideo({
      canvas: exportCanvas, duration: state.timeline.duration, fps: 30, soundtrack: state.soundtrack, signal: ac.signal,
      renderFrame: async (t) => {
        if (state.ai) await state.film.renderAtExact(t); else state.film.renderAt(t);
        comp.draw(state.film.canvas || state.glCanvas, state.film, t);
      },
      onProgress: (f, eta) => {
        $('busy-bar').style.width = `${(f * 100).toFixed(1)}%`;
        $('busy-sub').textContent = `${Math.round(f * 100)}% · about ${formatTime(eta)} left`;
      },
    });
    const name = `${state.timeline.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'my-movie'}.${out.ext}`;
    await saveFile(out.blob, name);
    toast(`Saved ${name} (${(out.blob.size / 1e6).toFixed(1)} MB, ${out.codec}).`);
  } finally {
    state.exporting = false;
    state.exportAbort = null;
    $('busy').hidden = true;
    if (!state.ai) { state.fr.setQuality(prevQ || $('quality').value); }
    resizePreview();
  }
}

// Read an uploaded image as a JPEG data URL no larger than `max` pixels.
function downscaleImage(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => reject(new Error('That image could not be read.'));
    img.src = URL.createObjectURL(file);
  });
}

async function saveFile(blob, filename) {
  // inside a claude.ai artifact, downloads go through the platform
  const dl = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (dl) {
    try { await dl.save({ filename, data: blob }); return; } catch (e) { if (e && e.code === 'declined') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

init();
