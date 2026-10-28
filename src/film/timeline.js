// Turns a StoryPlan plus voice-clip durations into a timed shot list with
// staging (where everyone stands and what they do) and camera choices.
import { makeRng } from '../util.js';
import { INTERIOR_SETTINGS } from '../story/lexicon.js';

let LEAD = 0.35, GAP = 0.22, TAIL = 0.65, MIN_SHOT = 2.8;
const END_CARD = 3.5;
const TITLE_HOLD = 1.2;

export function estimateDuration(text, rate = 1) {
  const words = (text.match(/\S+/g) || []).length;
  const pauses = (text.match(/[,;:]/g) || []).length * 0.18 + (text.match(/[.!?]/g) || []).length * 0.25;
  return (words / (2.55 * rate)) + pauses + 0.25;
}

export function lineKey(speaker, text) { return `${speaker}::${text}`; }

const TRAVEL = new Set(['walk', 'run', 'chase', 'sneak', 'ride', 'fly', 'swim']);

// durations: Map(lineKey → seconds). Missing entries are estimated.
// opts.target: desired film length in seconds (null = natural pacing).
export function buildTimeline(plan, durations = new Map(), opts = {}) {
  // a short target tightens the pacing; dialogue itself is never cut
  const tight = opts.target && opts.target < naturalLength(plan, durations, opts);
  [LEAD, GAP, TAIL, MIN_SHOT] = tight ? [0.2, 0.12, 0.3, 2.0] : [0.35, 0.22, 0.65, 2.8];
  const rng = makeRng(opts.seed ?? 99);
  const shots = [];
  let t = 0;
  const dur = (sp, text) => durations.get(lineKey(sp, text)) ?? estimateDuration(text, opts.rate ?? 1);
  const castById = new Map(plan.cast.map((c) => [c.id, c]));

  // title shot: establishing view of the first scene, narrator reads the title
  const first = plan.scenes[0];
  if (first) {
    const spoken = plan.titleVoice !== false;  // characters tell the story: the title is only on screen
    const d = spoken ? dur('narrator', plan.title) : 0;
    shots.push(makeShot({
      kind: 'title', scene: { ...first, lines: [], actions: {}, shot: 'establishing' },
      start: t, lines: spoken ? [{ speaker: 'narrator', text: plan.title, start: t + 0.9, end: t + 0.9 + d }] : [], end: t + Math.max(spoken ? 4.2 : 3.2, 0.9 + d + TITLE_HOLD),
    }));
    t = shots[0].end;
  }

  let prev = null;
  let lastShotType = null;
  // extra hold per scene so the film lands on the requested length
  const nat = plan.scenes.map((sc, i) => sceneNatural(plan, sc, i, durations, opts));
  const natTotal = t + nat.reduce((a, b) => a + b, 0) + END_CARD;
  const extra = opts.target ? Math.max(0, opts.target - natTotal) : 0;
  const natSum = nat.reduce((a, b) => a + b, 0) || 1;
  plan.scenes.forEach((scene, i) => {
    const lines = [];
    let cursor = t + LEAD + (scene.isNewSetting && i > 0 ? 0.6 : 0);
    for (const l of scene.lines) {
      const d = dur(l.speaker, l.text);
      lines.push({ speaker: l.speaker, text: l.text, start: cursor, end: cursor + d });
      cursor += d + GAP;
    }
    const mainAct = scene.focus ? scene.actions[scene.focus] : null;
    let end = Math.max(cursor - GAP + TAIL, t + MIN_SHOT + (TRAVEL.has(mainAct) ? 0.8 : 0));
    if (i === plan.scenes.length - 1) end += 1.2;
    end += extra * (nat[i] / natSum);
    // vary shot type a little so the cut rhythm isn't monotonous
    let type = scene.shot || 'medium';
    if (type === lastShotType && type !== 'over-shoulder' && type !== 'tracking') {
      type = { medium: rng.pick(['wide', 'closeup']), closeup: 'medium', wide: 'medium', establishing: 'wide', lowangle: 'medium' }[type] || type;
    }
    if (scene.characters.length === 0) type = 'establishing';
    // Short prompts (one or two sentences) get proper coverage: wide → medium →
    // close-up, so a single description still plays like a little film.
    const short = plan.scenes.length <= 2 && scene.characters.length > 0;
    if (short && !opts.target) end = Math.max(end, t + (plan.scenes.length === 1 ? 12 : 8));
    // long holds (short prompts, or a long requested length) get coverage:
    // a run of different camera angles instead of one static shot
    const coverage = scene.characters.length > 0 && end - t >= 6;
    if (coverage) {
      const base = scene.characters.length > 1 ? ['wide', 'two-shot', 'closeup', 'medium', 'over-shoulder', 'lowangle'] : ['wide', 'medium', 'closeup', 'lowangle', 'medium', 'closeup'];
      const seq = i > 0 ? [type, ...base.filter((x) => x !== type)] : base;
      const n = Math.max(2, Math.min(40, Math.round((end - t) / 3.6)));
      const cuts = Array.from({ length: n + 1 }, (_, k) => k / n);
      // repeat the angle cycle without the same angle twice in a row
      while (seq.length < n) { const nxt = rng.pick(base); if (nxt !== seq[seq.length - 1]) seq.push(nxt); }
      for (let k = 0; k < n; k++) {
        const s0 = t + (end - t) * cuts[k], s1 = t + (end - t) * cuts[k + 1];
        const sub = makeShot({ kind: 'scene', scene, start: s0, end: s1, lines: lines.filter((l) => l.start >= s0 && l.start < s1), type: seq[k] });
        sub.transition = k === 0 && prev && prev.scene.setting !== scene.setting ? 'fade' : 'cut';
        shots.push(sub);
        prev = sub;
      }
      lastShotType = seq[n - 1];
      t = end;
      return;
    }
    // split very long dialogue shots into reverse shots between speakers
    const shot = makeShot({ kind: 'scene', scene, start: t, end, lines, type });
    shot.transition = prev && prev.scene.setting !== scene.setting ? 'fade' : 'cut';
    shots.push(shot);
    prev = shot;
    lastShotType = type;
    t = end;
  });

  // end card
  const endStart = t;
  const film = { title: plan.title, cast: plan.cast, shots, duration: endStart + END_CARD, endCard: { start: endStart, end: endStart + END_CARD } };
  stage(film, castById, rng);
  return film;
}

// Seconds a scene needs at natural pacing (dialogue, minimum hold, travel).
function sceneNatural(plan, scene, i, durations, opts) {
  const dur = (sp, text) => durations.get(lineKey(sp, text)) ?? estimateDuration(text, opts.rate ?? 1);
  let need = LEAD + (scene.isNewSetting && i > 0 ? 0.6 : 0);
  for (const l of scene.lines) need += dur(l.speaker, l.text) + GAP;
  need = Math.max(need - GAP + TAIL, MIN_SHOT);
  if (i === plan.scenes.length - 1) need += 1.2;
  return need;
}
function naturalLength(plan, durations, opts) {
  const dur = (sp, text) => durations.get(lineKey(sp, text)) ?? estimateDuration(text, opts.rate ?? 1);
  const spoken = plan.titleVoice !== false;
  const title = plan.scenes[0] ? Math.max(spoken ? 4.2 : 3.2, 0.9 + (spoken ? dur('narrator', plan.title) : 0) + TITLE_HOLD) : 0;
  return title + plan.scenes.reduce((a, sc, i) => a + sceneNatural(plan, sc, i, durations, opts), 0) + END_CARD;
}

function makeShot({ kind, scene, start, end, lines, type }) {
  return {
    kind, scene, start, end, lines,
    type: type || scene.shot || 'medium',
    envKey: `${scene.setting}|${scene.time}|${scene.weather}`,
    blocking: {},
    props: [],
    transition: 'cut',
  };
}

// ---- staging --------------------------------------------------------------------------
// Decide where each character stands/moves in every shot, keeping continuity
// within a setting.
function stage(film, castById, rng) {
  const lastPos = new Map(); // id → {x, z, ry, setting}
  for (const shot of film.shots) {
    const sc = shot.scene;
    const ids = (shot.kind === 'title' ? sc.characters.slice(0, 3) : sc.characters).filter((id) => castById.has(id));
    const n = ids.length;
    const focus = sc.focus && ids.includes(sc.focus) ? sc.focus : ids[0];
    const speakers = [...new Set(shot.lines.filter((l) => l.speaker !== 'narrator').map((l) => l.speaker))];
    const target = sc.target && ids.includes(sc.target) ? sc.target : ids.find((id) => id !== focus);
    const act = (id) => (shot.kind === 'title' ? (sc.characters.length ? 'stand' : 'stand') : sc.actions[id] || (speakers.includes(id) ? 'talk' : 'stand'));
    const interior = INTERIOR_SETTINGS.has(sc.setting);
    const spacing = n <= 2 ? 1.05 : 1.0;
    const B = {};
    // base formation: gentle arc facing the camera (+z)
    ids.forEach((id, k) => {
      const off = (k - (n - 1) / 2) * spacing;
      let x = off, z = -Math.abs(off) * 0.25;
      const prevP = lastPos.get(id);
      if (prevP && prevP.setting === sc.setting && shot.kind !== 'title') { x = prevP.x * 0.4 + x * 0.6; z = prevP.z * 0.4 + z * 0.6; }
      const ry = -off * 0.18;
      B[id] = { from: { x, z, ry }, to: { x, z, ry }, action: act(id), emotion: sc.emotions[id] || 'neutral' };
    });
    // conversation: speaker and listener face each other
    if (focus && target && (speakers.length || ['hug', 'talk', 'wave', 'point', 'look'].includes(act(focus)))) {
      const a = B[focus], b = B[target];
      const sep = act(focus) === 'hug' || act(target) === 'hug' ? 0.42 : 1.15;
      const left = rng() < 0.5 ? focus : target;
      const right = left === focus ? target : focus;
      B[left].from = B[left].to = { x: -sep / 2, z: 0, ry: 0.85 };
      B[right].from = B[right].to = { x: sep / 2, z: 0, ry: -0.85 };
      if (a.action === 'hug' || b.action === 'hug') { B[left].from = { x: -1.4, z: 0, ry: 1.2 }; B[right].from = { x: 1.4, z: 0, ry: -1.2 }; B[left].action = B[right].action = 'hug'; }
      // others gather behind
      let k = 0;
      for (const id of ids) if (id !== focus && id !== target) { const x = (k % 2 ? 1 : -1) * (1.4 + Math.floor(k / 2) * 0.8); B[id].from = B[id].to = { x, z: -0.9, ry: -x * 0.25 }; k++; }
    }
    // travel: move across the frame (or deeper into the scene)
    for (const id of ids) {
      const a = B[id].action;
      if (!TRAVEL.has(a)) continue;
      const len = { walk: 3.2, sneak: 2.2, run: 7, chase: 7, ride: 6, fly: 5, swim: 4 }[a];
      const k = ids.indexOf(id);
      const z = (k - (n - 1) / 2) * 0.9 - 0.2;
      const lag = a === 'chase' || (a === 'run' && id !== focus) ? -1.4 : 0;
      B[id].from = { x: -len / 2 + lag, z, ry: Math.PI / 2 };
      B[id].to = { x: len / 2 + lag, z, ry: Math.PI / 2 };
      if (interior && (a === 'walk' || a === 'sneak')) { B[id].from = { x: (k - (n - 1) / 2) * 0.9, z: -2.4, ry: 0 }; B[id].to = { x: (k - (n - 1) / 2) * 0.9, z: 0.6, ry: 0 }; }
    }
    // special roles: preachers at the pulpit in church
    if (sc.setting === 'church') {
      for (const id of ids) {
        const c = castById.get(id);
        if (c && ['pastor', 'priest'].includes(c.role) && (speakers.includes(id) || shot.kind === 'title')) { B[id].mark = 'pulpit'; }
      }
    }
    for (const id of ids) {
      const a = B[id].action;
      if (a === 'sit' || a === 'ride') B[id].seat = true;
      if (a === 'sleep') B[id].bed = true;
      if (a === 'pray' && /kneel|knelt/.test(sc.text)) B[id].kneel = true;
    }
    shot.blocking = B;
    shot.ids = ids;
    shot.focus = focus;
    shot.target = target;
    shot.speakers = speakers;
    for (const id of ids) lastPos.set(id, { ...B[id].to, setting: sc.setting });
    // props: held ones attach to hands; others are placed near the focus
    shot.props = (sc.props || []).map((p, i) => ({ ...p, slot: i }));
  }
}
