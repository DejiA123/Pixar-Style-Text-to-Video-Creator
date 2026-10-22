// Sound design: ambience beds per setting and one-shot effects keyed to the
// actions and effects in each shot. Times mirror the visual formulas so the
// thunder lands with the lightning and the booms with the fireworks.
import { noiseBed, noiseHit, chirp, bell, kick, pluck } from './synth.js';
import { hash01, makeRng } from '../util.js';

export function scheduleSfx(ctx, out, timeline, opts = {}) {
  const rng = makeRng(opts.seed ?? 11);
  const shots = timeline.shots;
  // merge consecutive shots with the same ambience into one bed
  const beds = [];
  for (const s of shots) {
    const key = ambienceKey(s.scene);
    const last = beds[beds.length - 1];
    if (last && last.key === key && Math.abs(last.end - s.start) < 0.01) last.end = s.end;
    else beds.push({ key, start: s.start, end: s.end, scene: s.scene });
  }
  const endT = timeline.endCard.start + 1.5;
  for (const b of beds) ambience(ctx, out, b, Math.min(b.end + 0.6, endT), rng);

  for (const s of shots) {
    const sc = s.scene;
    if (s.transition === 'fade') whoosh(ctx, out, s.start - 0.35, 0.12);
    const len = s.end - s.start;
    for (const id of s.ids || []) {
      const a = s.blocking[id]?.action;
      if (a === 'jump' || a === 'cheer' || a === 'play') {
        const per = a === 'cheer' ? 0.9 : a === 'play' ? 1.0 : 1.3;
        for (let k = 0; k * per < len; k++) boing(ctx, out, s.start + k * per + per * 0.22, 0.09);
      }
      if (a === 'walk' || a === 'run' || a === 'sneak' || a === 'chase') {
        const step = a === 'run' || a === 'chase' ? 0.28 : a === 'sneak' ? 0.7 : 0.48;
        for (let t = s.start + 0.25; t < s.end - 0.3; t += step) noiseHit(ctx, out, t, { type: 'lowpass', freq: sc.setting === 'snow' ? 2400 : 900, vel: a === 'sneak' ? 0.03 : 0.07, dur: 0.06, offset: t * 7 });
      }
      if (a === 'magic') for (let k = 0; k < 6; k++) bell(ctx, out, s.start + 0.3 + k * 0.17, 84 + ((k * 5) % 12), 0.05, 1.4);
      if (a === 'fall') { whoosh(ctx, out, s.start + 0.05, 0.1); kick(ctx, out, s.start + 0.55, 0.5); }
      if (a === 'fly') whoosh(ctx, out, s.start + 0.2, 0.08, 2.5);
      if (a === 'swim') for (let t = s.start + 0.3; t < s.end; t += 0.55) noiseHit(ctx, out, t, { type: 'bandpass', freq: 1800, vel: 0.06, dur: 0.18 });
      if (a === 'cheer' || (a === 'dance' && sc.fx?.includes('confetti'))) crowdCheer(ctx, out, s.start + 0.2, Math.min(3, len), 0.05, rng);
      if (a === 'hug') for (let k = 0; k < 3; k++) bell(ctx, out, s.start + 0.6 + k * 0.22, 79 + k * 4, 0.04, 1.6);
    }
    for (const f of sc.fx || []) {
      if (f === 'sparkles' || f === 'godrays') for (let k = 0; k < 8; k++) bell(ctx, out, s.start + 0.2 + rng() * Math.max(0.5, len - 1), 88 + rng.int(0, 7), 0.025, 1.6);
      if (f === 'confetti') for (let k = 0; k < 4; k++) pop(ctx, out, s.start + 0.15 + k * 0.12, 0.12);
      if (f === 'poof') pop(ctx, out, s.start + 0.05, 0.2);
      if (f === 'fireworks') {
        for (let b = 0; b < 6; b++) for (let k = 0; k < 40; k++) {
          const t = k * 2.4 - b * 0.8;
          if (t >= s.start && t < s.end) boom(ctx, out, t + 0.05, 0.18);
        }
      }
      if (f === 'shootingstar') for (let k = Math.ceil(s.start / 5); k * 5 < s.end; k++) chirp(ctx, out, k * 5, 2400, 900, 1.2, 0.03);
    }
    if (sc.weather === 'storm') {
      const k0 = Math.floor(s.start / 3.7), k1 = Math.ceil(s.end / 3.7);
      for (let k = k0; k <= k1; k++) {
        const t = k * 3.7 + hash01(k, 3) * 2.5;
        if (t >= s.start && t < s.end) thunder(ctx, out, t + 0.25, 0.4);
      }
    }
    for (const p of s.props || []) if (p.type === 'campfire') noiseBed(ctx, out, s.start, s.end, { type: 'bandpass', freq: 2500, q: 0.8, vel: 0.03, lfoRate: 9, lfoDepth: 0.9 });
  }
  // title shimmer
  for (let k = 0; k < 7; k++) bell(ctx, out, 0.4 + k * 0.11, 84 + [0, 4, 7, 11, 12, 16, 19][k], 0.04, 2.2);
}

function ambienceKey(sc) {
  return `${sc.setting}|${sc.time}|${sc.weather}`;
}

function ambience(ctx, out, b, end, rng) {
  const sc = b.scene;
  const t0 = b.start, t1 = end;
  const night = sc.time === 'night';
  const outdoorsGreen = ['meadow', 'forest', 'village', 'farm', 'lake', 'castle', 'mountain'].includes(sc.setting);
  if (sc.weather === 'rain' || sc.weather === 'storm') noiseBed(ctx, out, t0, t1, { type: 'highpass', freq: 1400, vel: sc.weather === 'storm' ? 0.11 : 0.08 });
  if (['snow', 'mountain', 'desert', 'sky'].includes(sc.setting) || sc.weather === 'snow') noiseBed(ctx, out, t0, t1, { type: 'bandpass', freq: 500, q: 0.6, vel: 0.05, lfoRate: 0.15, lfoDepth: 0.7 });
  if (sc.setting === 'beach') noiseBed(ctx, out, t0, t1, { type: 'lowpass', freq: 700, vel: 0.09, lfoRate: 0.12, lfoDepth: 0.85 });
  if (sc.setting === 'underwater') { noiseBed(ctx, out, t0, t1, { type: 'lowpass', freq: 260, vel: 0.08, lfoRate: 0.2, lfoDepth: 0.5 }); for (let t = t0 + 0.3; t < t1; t += 0.4 + rng() * 0.9) chirp(ctx, out, t, 300 + rng() * 300, 900 + rng() * 600, 0.08, 0.025); }
  if (['city', 'market'].includes(sc.setting)) { noiseBed(ctx, out, t0, t1, { type: 'lowpass', freq: 380, vel: 0.06 }); crowdBed(ctx, out, t0, t1, 0.03); }
  if (['school', 'church', 'stage'].includes(sc.setting)) { noiseBed(ctx, out, t0, t1, { type: 'lowpass', freq: 300, vel: 0.02 }); if (sc.setting !== 'church') crowdBed(ctx, out, t0, t1, 0.012); }
  if (sc.setting === 'cave') for (let t = t0 + 0.5; t < t1; t += 1.2 + rng() * 2) bell(ctx, out, t, 96 + rng.int(0, 5), 0.02, 0.6);
  if (sc.setting === 'space') noiseBed(ctx, out, t0, t1, { type: 'lowpass', freq: 120, vel: 0.05 });
  if (outdoorsGreen && !night && sc.weather !== 'rain' && sc.weather !== 'storm') {
    for (let t = t0 + 0.3 + rng() * 1.2; t < t1 - 0.3; t += 0.8 + rng() * 2.2) {
      const f = 2600 + rng() * 1800;
      const n = rng.int(2, 4);
      for (let k = 0; k < n; k++) chirp(ctx, out, t + k * 0.09, f, f * (rng() < 0.5 ? 1.35 : 0.75), 0.07, 0.018);
    }
  }
  if (night && (outdoorsGreen || sc.setting === 'beach')) {
    for (let t = t0 + 0.2; t < t1; t += 0.42) for (let k = 0; k < 3; k++) chirp(ctx, out, t + k * 0.045, 4300, 4200, 0.035, 0.008, 'square');
  }
}

function crowdBed(ctx, out, t0, t1, vel) {
  noiseBed(ctx, out, t0, t1, { type: 'bandpass', freq: 650, q: 1.2, vel, lfoRate: 0.7, lfoDepth: 0.4 });
  noiseBed(ctx, out, t0, t1, { type: 'bandpass', freq: 1300, q: 2, vel: vel * 0.6, lfoRate: 1.3, lfoDepth: 0.5 });
}

export function whoosh(ctx, out, t, vel = 0.1, dur = 0.7) {
  const h = noiseHit(ctx, out, t, { type: 'bandpass', freq: 400, q: 1.2, vel, dur, attack: dur * 0.5 });
  h.f.frequency.setValueAtTime(300, t); h.f.frequency.exponentialRampToValueAtTime(2500, t + dur * 0.6); h.f.frequency.exponentialRampToValueAtTime(600, t + dur * 1.2);
}
function boing(ctx, out, t, vel) {
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(520, t + 0.18);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 18; const lg = ctx.createGain(); lg.gain.value = 40; lfo.connect(lg).connect(o.frequency);
  const g = ctx.createGain(); g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.connect(g).connect(out); o.start(t); lfo.start(t); o.stop(t + 0.4); lfo.stop(t + 0.4);
}
function pop(ctx, out, t, vel) { noiseHit(ctx, out, t, { type: 'bandpass', freq: 1500, q: 1, vel, dur: 0.06 }); pluck(ctx, out, t, 84, vel * 0.5); }
function boom(ctx, out, t, vel) { kick(ctx, out, t, vel * 2); noiseHit(ctx, out, t, { type: 'lowpass', freq: 600, vel, dur: 0.9, attack: 0.01 }); for (let k = 0; k < 8; k++) noiseHit(ctx, out, t + 0.2 + k * 0.07, { type: 'highpass', freq: 5000, vel: vel * 0.15, dur: 0.03 }); }
function thunder(ctx, out, t, vel) { noiseHit(ctx, out, t, { type: 'lowpass', freq: 220, vel, dur: 2.6, attack: 0.05 }); noiseHit(ctx, out, t, { type: 'lowpass', freq: 900, vel: vel * 0.5, dur: 0.4 }); }
function crowdCheer(ctx, out, t, dur, vel, rng) {
  noiseHit(ctx, out, t, { type: 'bandpass', freq: 1100, q: 0.8, vel, dur, attack: 0.2 });
  for (let k = 0; k < dur * 7; k++) noiseHit(ctx, out, t + rng() * dur, { type: 'bandpass', freq: 2000 + rng() * 1500, q: 1.5, vel: vel * 0.9, dur: 0.03 });
}
