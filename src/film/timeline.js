// Turns a StoryPlan plus voice-clip durations into a timed shot list with
// staging (where everyone stands and what they do) and camera choices.
import { makeRng } from '../util.js';
import { INTERIOR_SETTINGS } from '../story/lexicon.js';

const LEAD = 0.35, GAP = 0.22, TAIL = 0.65, MIN_SHOT = 2.8;
const TITLE_HOLD = 1.2;

export function estimateDuration(text, rate = 1) {
  const words = (text.match(/\S+/g) || []).length;
  const pauses = (text.match(/[,;:]/g) || []).length * 0.18 + (text.match(/[.!?]/g) || []).length * 0.25;
  return (words / (2.55 * rate)) + pauses + 0.25;
}

export function lineKey(speaker, text) { return `${speaker}::${text}`; }

const TRAVEL = new Set(['walk', 'run', 'chase', 'sneak', 'ride', 'fly', 'swim']);

// durations: Map(lineKey → seconds). Missing entries are estimated.
export function buildTimeline(plan, durations = new Map(), opts = {}) {
  const rng = makeRng(opts.seed ?? 99);
  const shots = [];
  let t = 0;
  const dur = (sp, text) => durations.get(lineKey(sp, text)) ?? estimateDuration(text, opts.rate ?? 1);
  const castById = new Map(plan.cast.map((c) => [c.id, c]));

  // title shot: establishing view of the first scene, narrator reads the title
  const first = plan.scenes[0];
  if (first) {
    const titleLine = { speaker: 'narrator', text: plan.title };
    const d = dur('narrator', plan.title);
    shots.push(makeShot({
      kind: 'title', scene: { ...first, lines: [], actions: {}, shot: 'establishing' },
      start: t, lines: [{ ...titleLine, start: t + 0.9, end: t + 0.9 + d }], end: t + Math.max(4.2, 0.9 + d + TITLE_HOLD),
    }));
    t = shots[0].end;
  }

  let prev = null;
  let lastShotType = null;
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
    // vary shot type a little so the cut rhythm isn't monotonous
    let type = scene.shot || 'medium';
    if (type === lastShotType && type !== 'over-shoulder' && type !== 'tracking') {
      type = { medium: rng.pick(['wide', 'closeup']), closeup: 'medium', wide: 'medium', establishing: 'wide', lowangle: 'medium' }[type] || type;
    }
    if (scene.characters.length === 0) type = 'establishing';
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
  const film = { title: plan.title, cast: plan.cast, shots, duration: endStart + 3.5, endCard: { start: endStart, end: endStart + 3.5 } };
  stage(film, castById, rng);
  return film;
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
