// A procedural film score that follows the story's moods shot by shot.
import { piano, pad, strings, bass, bell, pluck, choir, kick, noiseHit } from './synth.js';
import { makeRng } from '../util.js';

const Q = { maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], dom7: [0, 4, 7, 10], sus2: [0, 2, 7] };
export const MOODS = {
  happy: { bpm: 104, prog: [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']], piano: 'arp8', drums: 'light', bells: false },
  adventure: { bpm: 118, prog: [[9, 'min'], [5, 'maj'], [0, 'maj'], [7, 'maj']], piano: 'arp8', drums: 'drive', strings: true },
  calm: { bpm: 76, prog: [[0, 'maj7'], [4, 'm7'], [5, 'maj7'], [0, 'maj7']], piano: 'arp4', drums: null },
  sad: { bpm: 68, prog: [[9, 'm7'], [5, 'maj7'], [0, 'maj'], [7, 'sus2']], piano: 'arp4', strings: true },
  tense: { bpm: 92, prog: [[9, 'min'], [9, 'min'], [5, 'maj'], [4, 'maj']], piano: null, strings: true, pulse: true },
  magical: { bpm: 86, prog: [[5, 'maj7'], [7, 'maj'], [4, 'm7'], [9, 'm7']], piano: 'arp8', bells: true },
  curious: { bpm: 96, prog: [[2, 'm7'], [7, 'dom7'], [0, 'maj7'], [9, 'm7']], piano: null, pizz: true },
  hopeful: { bpm: 80, prog: [[5, 'maj'], [7, 'maj'], [9, 'min'], [0, 'maj']], piano: 'arp4', strings: true, bells: true, choir: true },
  funny: { bpm: 112, prog: [[0, 'maj'], [5, 'maj'], [7, 'dom7'], [0, 'maj']], pizz: true, drums: 'light' },
};

function moodAt(timeline, t) {
  for (const s of timeline.shots) if (t >= s.start && t < s.end) return s.scene.mood || 'happy';
  const last = timeline.shots[timeline.shots.length - 1];
  return (last && last.scene.mood) || 'happy';
}

// Schedules the whole score into `out`. Returns the music bus gain for ducking.
export function scheduleScore(ctx, out, timeline, opts = {}) {
  const rng = makeRng(opts.seed ?? 5);
  const key = opts.key ?? rng.int(-3, 4); // transpose around C
  const counts = {};
  for (const s of timeline.shots) counts[s.scene.mood] = (counts[s.scene.mood] || 0) + (s.end - s.start);
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'happy';
  const bpm = MOODS[dominant]?.bpm ?? 96;
  const beat = 60 / bpm, bar = beat * 4;
  const end = timeline.duration;
  const churchy = timeline.shots.some((s) => s.scene.setting === 'church');
  let prevMood = null;
  for (let b = 0, t = 0; t < end - 0.5; b++, t = b * bar) {
    const mood = moodAt(timeline, t + 0.01);
    const M = MOODS[mood] || MOODS.happy;
    const [deg, qual] = M.prog[b % 4];
    const root = 48 + key + deg;
    const chord = Q[qual].map((i) => root + i + 12);
    const lastBar = t + bar >= end - 3.4;
    const vel = lastBar ? 0.7 : 1;
    pad(ctx, out, t, chord, bar, 0.09 * vel, mood === 'tense' ? 600 : 1100);
    bass(ctx, out, t, root - 12, beat * 1.8, 0.28 * vel);
    if (mood !== 'calm' && mood !== 'sad') bass(ctx, out, t + beat * 2, root - 12 + (b % 2 ? 7 : 0), beat * 1.5, 0.22 * vel);
    if (M.strings || (churchy && mood === 'hopeful')) strings(ctx, out, t, [chord[0], chord[1] + 12, chord[2] + 12], bar, 0.06 * vel);
    if (M.choir && churchy) choir(ctx, out, t, [chord[0], chord[2]], bar, 0.05 * vel);
    if (M.piano === 'arp8' || M.piano === 'arp4') {
      const steps = M.piano === 'arp8' ? 8 : 4;
      const tones = [...chord, chord[0] + 12, chord[1] + 12];
      for (let i = 0; i < steps; i++) {
        const n = tones[[0, 2, 1, 3, 2, 4, 3, 1][i % 8] % tones.length] + 12;
        piano(ctx, out, t + i * (bar / steps), n, (i === 0 ? 0.42 : 0.3) * vel * (0.85 + rng() * 0.3), bar / steps * 2.2);
      }
    }
    if (M.pizz) for (let i = 0; i < 4; i++) pluck(ctx, out, t + i * beat + (i % 2 ? beat * 0.5 : 0), chord[i % chord.length] + 12, 0.18);
    if (M.bells && b % 2 === 0) for (let i = 0; i < 3; i++) bell(ctx, out, t + i * beat * 1.33 + beat * 0.5, chord[(i + b) % chord.length] + 24, 0.06);
    if (M.pulse) for (let i = 0; i < 8; i++) bass(ctx, out, t + i * beat / 2, root - 12, beat * 0.3, 0.12);
    if (M.drums && !lastBar) {
      for (let i = 0; i < 4; i++) {
        if (M.drums === 'drive' || i % 2 === 0) kick(ctx, out, t + i * beat, M.drums === 'drive' ? 0.45 : 0.32);
        noiseHit(ctx, out, t + i * beat + beat / 2, { vel: 0.05, dur: 0.04 });
        if (M.drums === 'drive') noiseHit(ctx, out, t + i * beat + beat * 0.25, { vel: 0.025, dur: 0.03 });
      }
    }
    // a little sparkle when the mood changes
    if (prevMood && mood !== prevMood) bell(ctx, out, t, chord[2] + 24, 0.07, 3);
    prevMood = mood;
  }
  // final cadence on the end card
  const tEnd = timeline.endCard.start + 0.1;
  const M = MOODS[moodAt(timeline, tEnd - 1)] || MOODS.happy;
  const root = 48 + key + (M === MOODS.sad ? 9 : 0);
  const fin = Q[M === MOODS.sad ? 'm7' : 'maj7'].map((i) => root + i + 12);
  pad(ctx, out, tEnd, fin, 3.0, 0.1, 1200);
  strings(ctx, out, tEnd, fin.map((m) => m + 12), 3.0, 0.05);
  for (let i = 0; i < 5; i++) bell(ctx, out, tEnd + i * 0.18, fin[i % fin.length] + 24, 0.08, 3);
  return { bpm, key };
}
