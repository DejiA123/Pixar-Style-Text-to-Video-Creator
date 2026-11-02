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
  if (c.crowd) return `a group of ${c.noun}s`;
  const age = { child: 'young', teen: 'teenage', old: 'elderly' }[c.age] || '';
  const sex = c.kind === 'human' ? { f: 'female', m: 'male' }[c.gender] || '' : '';
  const what = c.role && c.role !== 'student' ? c.role : c.kind === 'human' ? c.noun || 'person' : c.noun || c.kind;
  const baby = /^(baby|infant|newborn)$/.test(c.noun || '') ? 'newborn, cannot talk' : '';
  return [age, sex, what, ...(c.traits || []).slice(0, 2), baby].filter(Boolean).join(' ');
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Who the director put in a shot, in the order it names them ("The father and Samuel sit on a bench"):
// people by name; unnamed ones ("the old man", "the shepherds") by what they are.
function namedIn(text, cast) {
  const t = text.toLowerCase();
  const at = (c) => {
    const keys = c.name ? [c.name] : c.noun ? [c.noun, `${c.noun}s`, `${c.noun}es`] : [];
    const hits = keys.map((k) => t.search(new RegExp(`\\b${esc(k.toLowerCase())}\\b`))).filter((i) => i >= 0);
    return hits.length ? Math.min(...hits) : -1;
  };
  return cast.map((c) => [c.id, at(c)]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([id]) => id);
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

// Puts the director's plan into the film plan: each character's look (the same in every shot),
// each scene's shot description, and the lines. Returns how many scenes got lines.
export function applyDialogue(plan, result) {
  const ids = new Set(plan.cast.map((c) => c.id));
  for (const c of result?.cast || []) {
    const m = plan.cast.find((x) => x.id === c.id);
    if (!m) continue;
    // the director says this "character" isn't anyone (a place name read as a person): keep them out of the shots
    if (/^\s*none\b/i.test(c.look || '')) {
      for (const sc of plan.scenes) {
        sc.characters = sc.characters.filter((id) => id !== m.id);
        sc.lines = sc.lines.map((l) => (l.speaker === m.id ? { ...l, speaker: 'narrator' } : l));
      }
      plan.cast = plan.cast.filter((x) => x !== m);
      ids.delete(m.id);
      continue;
    }
    if (/[a-z]/i.test(c.look || '')) m.lookText = String(c.look).trim();
  }
  let n = 0;
  for (const s of result?.scenes || []) {
    const sc = plan.scenes[s.index];
    if (!sc) continue;
    let lines = (s.lines || []).filter((l) => ids.has(l.speaker) && /[A-Za-z]/.test(l.text || '')).map((l) => ({ speaker: l.speaker, text: String(l.text).trim() }));
    if (/[a-z]/i.test(s.shot || '')) {
      sc.shotText = String(s.shot).trim();
      // the shot shows only who the director put in it (and whoever the story has speaking here):
      // nobody who is only talked about, far away, or already gone
      const said = sc.lines.filter((l) => l.speaker !== 'narrator' && ids.has(l.speaker)).map((l) => l.speaker);
      let seen = [...new Set([...namedIn(sc.shotText, plan.cast), ...said])];
      if (!seen.length) seen = [...new Set(lines.map((l) => l.speaker))];
      if (!seen.length && /\b(he|she|they|him|her|his|their|man|woman|boy|girl|child|people|person|family|crowd|friends)\b/i.test(sc.shotText)) seen = sc.characters.slice(0, 2);
      lines = lines.filter((l) => seen.includes(l.speaker));
      sc.characters = seen;
      if (!seen.includes(sc.focus)) sc.focus = seen[0] || null;
      if (sc.target && !seen.includes(sc.target)) sc.target = seen.find((id) => id !== sc.focus) || null;
    }
    if (!lines.length) continue;
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
