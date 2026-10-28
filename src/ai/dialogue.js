// Real dialogue: the AI writer on your server turns the story into what the
// characters say out loud in each scene, so the film is acted, not narrated
// ("A young guy goes to church" → "Wow… I've never been inside a church before.").
// Scenes it doesn't cover keep their rule-based first-person lines (firstperson.js).
import { displayName } from '../story/parser.js';
import { waitForServer } from './aiserver.js';

const sleep = (ms, signal) => new Promise((r, j) => {
  const t = setTimeout(r, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); j(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

function about(c) {
  const age = { child: 'young', teen: 'teenage', old: 'elderly' }[c.age] || '';
  const sex = c.kind === 'human' ? { f: 'female', m: 'male' }[c.gender] || '' : '';
  const what = c.role && c.role !== 'student' ? c.role : c.kind === 'human' ? c.noun || 'person' : c.noun || c.kind;
  return [age, sex, what, ...(c.traits || []).slice(0, 2)].filter(Boolean).join(' ');
}

export function dialogueRequest(plan, story) {
  const ids = new Set(plan.cast.map((c) => c.id));
  return {
    title: plan.title,
    story: story.slice(0, 6000),
    cast: plan.cast.map((c) => ({ id: c.id, name: displayName(c), about: about(c) })),
    scenes: plan.scenes.map((sc, index) => ({
      index,
      text: sc.text || '',
      characters: (sc.characters || []).filter((id) => ids.has(id)),
      quotes: sc.lines.filter((l) => l.speaker !== 'narrator').map((l) => ({ speaker: l.speaker, text: l.text })),
      mood: sc.mood || '',
    })),
  };
}

// Puts the writer's lines into the plan; returns how many scenes got them.
export function applyDialogue(plan, result) {
  const ids = new Set(plan.cast.map((c) => c.id));
  let n = 0;
  for (const s of result?.scenes || []) {
    const sc = plan.scenes[s.index];
    const lines = (s.lines || []).filter((l) => ids.has(l.speaker) && /[A-Za-z]/.test(l.text || '')).map((l) => ({ speaker: l.speaker, text: String(l.text).trim() }));
    if (!sc || !lines.length) continue;
    sc.lines = lines;
    for (const l of lines) {
      if (!sc.characters.includes(l.speaker)) sc.characters.push(l.speaker);
      const a = sc.actions[l.speaker];
      if (!a || ['look', 'stand'].includes(a)) sc.actions[l.speaker] = 'talk';
    }
    n++;
  }
  if (n) plan.titleVoice = false;
  return n;
}

// Asks the server's writer for the dialogue (waiting while it starts up); false if it can't.
export async function writeDialogue(server, plan, story, { onStatus = () => {}, signal } = {}) {
  let health = await server.health();
  if (!health || health.ok === false) return false;
  health = await waitForServer(server, health, (p, msg) => onStatus(msg), signal);
  const t0 = Date.now();
  while (health && !health.writer && health.writer_state === 'loading' && Date.now() - t0 < 5 * 60000) {
    onStatus('The AI writer is starting on your server…');
    await sleep(5000, signal);
    health = (await server.health()) || health;
  }
  if (!health?.writer) return false;
  onStatus('Writing what your characters say');
  try {
    const n = applyDialogue(plan, await server.script(dialogueRequest(plan, story), signal));
    console.log(`[storyreel] dialogue written for ${n}/${plan.scenes.length} scenes`);
    return n > 0;
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    console.warn('AI dialogue unavailable, characters tell the story instead', e);
    return false;
  }
}
