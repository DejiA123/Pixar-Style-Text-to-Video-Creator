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
  for (const id of ['render-mode', 'voice-engine', 'narrator', 'aspect', 'quality', 'export-res', 'ai-video']) {
    const el = $(id); const v = store.get(id, null);
    if (v != null && [...el.options].some((o) => o.value === v)) el.value = v;
    el.addEventListener('change', () => { store.set(id, el.value); onSettings(id); });
  }
  for (const id of ['music', 'sfx', 'subs']) {
    const el = $(id); const v = store.get(id, null);
    if (v != null) el.checked = v;
    el.addEventListener('change', () => { store.set(id, el.checked); onSettings(id); });
  }
  $('fal-key').value = store.get('fal-key', '');
  $('fal-key').addEventListener('change', () => store.set('fal-key', $('fal-key').value.trim()));
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

function onSettings(id) {
  if (id === 'render-mode') $('ai-box').hidden = $('render-mode').value !== 'ai';
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
const steps = {
  list: [],
  reset(names) {
    const ol = $('steps'); ol.innerHTML = '';
    this.list = names.map(([key, label]) => { const li = document.createElement('li'); li.dataset.key = key; li.innerHTML = `<span>${label}</span><span class="pct"></span>`; ol.appendChild(li); return li; });
  },
  set(key, status, pct) {
    const li = this.list.find((l) => l.dataset.key === key);
    if (!li) return;
    li.classList.remove('active', 'done', 'error');
    if (status) li.classList.add(status);
    if (pct != null) li.querySelector('.pct').textContent = typeof pct === 'number' ? `${Math.round(pct * 100)}%` : pct;
    else if (status === 'done') li.querySelector('.pct').textContent = '';
  },
  label(key, text) { const li = this.list.find((l) => l.dataset.key === key); if (li) li.firstChild.textContent = text; },
};

function toast(msg, err = false, ms = 6000) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false; t.classList.toggle('err', err);
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

function fail(e) {
  console.error(e);
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
  const neural = $('voice-engine').value === 'neural';
  setAspect($('aspect').value);
  steps.reset([
    ['plan', ai ? 'AI director is reading your story' : 'Reading your story'],
    ['voices', neural ? 'Recording voices' : 'Casting voices'],
    ['build', ai ? 'Rendering shots with AI' : 'Building the world'],
    ['score', 'Composing music & sound'],
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
  const tl = buildTimeline(plan, durations, { rate: 0.95 });
  state.timeline = tl;
  steps.set('build', 'active');
  let film;
  if (ai) {
    film = await aiDirector.render(tl, (p, msg) => { steps.label('build', msg); steps.set('build', 'active', p); }, confirmCost);
    state.ai = true;
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
  state.film = film;
  steps.set('build', 'done');

  // 4) soundtrack
  steps.set('score', 'active');
  state.soundtrack = await renderSoundtrack(tl, clips, voices, { music: $('music').checked, sfx: $('sfx').checked, seed: plan.title.length });
  state.hasVoiceAudio = usedNeural;
  steps.set('score', 'done');

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
  if (a < 1) { W = res === 1080 ? 1080 : 720; H = Math.round(W / a / 2) * 2; }
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = W; exportCanvas.height = H;
  const comp = new Compositor(exportCanvas);
  comp.subtitles = $('subs').checked;
  state.exporting = true;
  const prevQ = state.fr?.qualityName;
  if (!state.ai) { state.fr.setQuality('export'); state.fr.setSize(W, H, 1); }
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
        comp.draw(state.ai ? state.film.canvas : state.glCanvas, state.film, t);
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
