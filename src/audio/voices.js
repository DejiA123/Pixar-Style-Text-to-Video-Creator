// Voice casting: give every character a distinct, fitting voice for both
// engines (Kokoro neural voices and the browser's built-in speech).
import { SMALL_KINDS } from '../story/lexicon.js';

export const KOKORO_NARRATORS = [
  { id: 'af_heart', label: 'Heart — warm storyteller (US)' },
  { id: 'af_bella', label: 'Bella — bright and lively (US)' },
  { id: 'am_michael', label: 'Michael — calm and friendly (US)' },
  { id: 'am_fenrir', label: 'Fenrir — deep and dramatic (US)' },
  { id: 'bf_emma', label: 'Emma — gentle (UK)' },
  { id: 'bm_george', label: 'George — classic narrator (UK)' },
];

const FEMALE = ['af_bella', 'af_nicole', 'af_sarah', 'af_kore', 'bf_emma', 'af_aoede', 'af_nova', 'bf_isabella'];
const MALE = ['am_michael', 'am_puck', 'am_fenrir', 'bm_george', 'bm_fable', 'am_eric', 'am_liam', 'am_echo'];
const DEEP = ['am_onyx', 'am_fenrir', 'bm_lewis'];

// Returns { kokoro: {voice, speed}, rate (playback pitch shift), fx, web: {gender, pitch, rate} }
export function castVoices(cast, narratorVoice = 'af_heart') {
  const used = new Set([narratorVoice]);
  const take = (pool) => { const v = pool.find((x) => !used.has(x)) || pool[0]; used.add(v); return v; };
  const out = new Map();
  out.set('narrator', { kokoro: { voice: narratorVoice, speed: 0.95 }, rate: 1, fx: null, web: { gender: narratorVoice[1] === 'f' ? 'f' : 'm', pitch: 1, rate: 0.95 } });
  for (const c of cast) {
    let v;
    const k = c.kind;
    if (k === 'human') {
      const f = c.gender === 'f';
      if (c.age === 'child' || c.age === 'baby') v = { kokoro: { voice: take(f ? FEMALE : ['am_puck', ...MALE]), speed: 0.92 }, rate: f ? 1.12 : 1.16, web: { gender: f ? 'f' : 'm', pitch: 1.45, rate: 1.0 } };
      else if (c.age === 'old') v = { kokoro: { voice: take(f ? ['bf_emma', 'bf_isabella', ...FEMALE] : ['bm_george', 'bm_lewis', ...MALE]), speed: 0.88 }, rate: 0.96, web: { gender: f ? 'f' : 'm', pitch: 0.85, rate: 0.85 } };
      else if (c.age === 'teen') v = { kokoro: { voice: take(f ? FEMALE : ['am_puck', 'am_liam', ...MALE]), speed: 1.0 }, rate: 1.04, web: { gender: f ? 'f' : 'm', pitch: 1.15, rate: 1.0 } };
      else v = { kokoro: { voice: take(f ? FEMALE : MALE), speed: 0.97 }, rate: 1, web: { gender: f ? 'f' : 'm', pitch: f ? 1.05 : 0.9, rate: 0.95 } };
      if (c.role === 'pastor' || c.role === 'priest') v = { kokoro: { voice: take(['bm_george', 'am_michael', 'am_fenrir', ...MALE]), speed: 0.9 }, rate: 0.98, web: { gender: 'm', pitch: 0.85, rate: 0.88 } };
    } else if (k === 'robot') {
      v = { kokoro: { voice: take(['am_echo', 'am_eric', ...MALE]), speed: 0.95 }, rate: 1.06, fx: 'robot', web: { gender: 'm', pitch: 0.7, rate: 0.9 } };
    } else if (k === 'alien') {
      v = { kokoro: { voice: take(['am_puck', 'af_nova', ...MALE]), speed: 0.92 }, rate: 1.22, fx: 'alien', web: { gender: 'm', pitch: 1.8, rate: 1.05 } };
    } else if (['dragon', 'dinosaur', 'monster', 'bear', 'lion', 'tiger', 'elephant', 'wolf'].includes(k)) {
      v = { kokoro: { voice: take(DEEP), speed: 1.05 }, rate: c.size < 0.9 ? 1.08 : 0.86, fx: c.size < 0.9 ? null : 'big', web: { gender: 'm', pitch: c.size < 0.9 ? 1.2 : 0.55, rate: 0.9 } };
    } else if (SMALL_KINDS.has(k) || c.size < 0.8) {
      v = { kokoro: { voice: take(c.gender === 'm' ? ['am_puck', ...MALE] : ['af_sky', 'af_nova', ...FEMALE]), speed: 0.88 }, rate: 1.24, web: { gender: c.gender === 'm' ? 'm' : 'f', pitch: 1.75, rate: 1.05 } };
    } else {
      const f = c.gender === 'f';
      v = { kokoro: { voice: take(f ? FEMALE : MALE), speed: 0.95 }, rate: 1.1, web: { gender: f ? 'f' : 'm', pitch: 1.3, rate: 1.0 } };
    }
    v.fx = v.fx ?? null;
    out.set(c.id, v);
  }
  return out;
}
