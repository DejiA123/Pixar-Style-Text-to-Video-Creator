// Small Web Audio instrument kit shared by the score and the sound effects.
// Everything schedules onto any BaseAudioContext (live or offline).

export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

const noiseCache = new WeakMap();
export function noiseBuffer(ctx) {
  if (noiseCache.has(ctx)) return noiseCache.get(ctx);
  const len = ctx.sampleRate * 2;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < len; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
  noiseCache.set(ctx, b);
  return b;
}

export function reverb(ctx, seconds = 2.6, decay = 3) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  let s = 777;
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) { s = (s * 16807) % 2147483647; d[i] = ((s / 2147483647) * 2 - 1) * Math.pow(1 - i / len, decay); }
  }
  const c = ctx.createConvolver();
  c.buffer = ir;
  return c;
}

function env(g, t, a, peak, d, sustain, r, end) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setTargetAtTime(Math.max(0.0001, peak * sustain), t + a, d);
  const rel = Math.max(t + a + 0.01, end);
  g.gain.setTargetAtTime(0.0001, rel, r);
}

export function piano(ctx, out, t, midi, vel = 0.5, dur = 1.2) {
  const f = midiHz(midi);
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 2400 + vel * 2000;
  const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.001;
  const g2 = ctx.createGain(); g2.gain.value = 0.25;
  o1.connect(lp); o2.connect(g2).connect(lp); lp.connect(g).connect(out);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel * 0.5, t + 0.006);
  g.gain.setTargetAtTime(0.0001, t + 0.01, dur * 0.35);
  o1.start(t); o2.start(t); o1.stop(t + dur * 2 + 0.5); o2.stop(t + dur * 2 + 0.5);
}

export function pad(ctx, out, t, midis, dur, vel = 0.12, bright = 900) {
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = bright; lp.Q.value = 0.4;
  lp.connect(g).connect(out);
  for (const m of midis) {
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midiHz(m); o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = 0.3 / midis.length;
      o.connect(og).connect(lp); o.start(t); o.stop(t + dur + 2.5);
    }
  }
  env(g, t, Math.min(0.8, dur * 0.3), vel, 0.5, 0.8, 0.6, t + dur);
}

export function strings(ctx, out, t, midis, dur, vel = 0.1) {
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
  lp.connect(g).connect(out);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2;
  const lfoG = ctx.createGain(); lfoG.gain.value = 5;
  lfo.connect(lfoG); lfo.start(t); lfo.stop(t + dur + 3);
  for (const m of midis) {
    for (const det of [-9, 0, 9]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midiHz(m); o.detune.value = det;
      lfoG.connect(o.detune);
      const og = ctx.createGain(); og.gain.value = 0.22 / midis.length;
      o.connect(og).connect(lp); o.start(t); o.stop(t + dur + 3);
    }
  }
  env(g, t, Math.min(1.2, dur * 0.4), vel, 0.6, 0.85, 0.9, t + dur);
}

export function bass(ctx, out, t, midi, dur, vel = 0.35) {
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = midiHz(midi);
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = midiHz(midi - 12);
  o.connect(lp); o2.connect(lp); lp.connect(g).connect(out);
  env(g, t, 0.01, vel, 0.25, 0.6, 0.12, t + dur);
  o.start(t); o2.start(t); o.stop(t + dur + 1); o2.stop(t + dur + 1);
}

export function bell(ctx, out, t, midi, vel = 0.15, dur = 2.2) {
  const f = midiHz(midi);
  const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = f;
  const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * 3.5;
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + dur);
  mod.connect(mg).connect(car.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  car.connect(g).connect(out);
  car.start(t); mod.start(t); car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
}

export function pluck(ctx, out, t, midi, vel = 0.25) {
  const g = ctx.createGain();
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = midiHz(midi);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(400, t + 0.3);
  o.connect(lp).connect(g).connect(out);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.start(t); o.stop(t + 0.4);
}

export function choir(ctx, out, t, midis, dur, vel = 0.08) {
  const g = ctx.createGain();
  g.connect(out);
  for (const m of midis) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midiHz(m);
    const vib = ctx.createOscillator(); vib.frequency.value = 4.8; const vg = ctx.createGain(); vg.gain.value = 6; vib.connect(vg).connect(o.detune);
    for (const [fq, q, a] of [[730, 8, 1], [1090, 10, 0.6], [2440, 12, 0.25]]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = q;
      const bg = ctx.createGain(); bg.gain.value = a / midis.length;
      o.connect(bp).connect(bg).connect(g);
    }
    o.start(t); vib.start(t); o.stop(t + dur + 3); vib.stop(t + dur + 3);
  }
  env(g, t, 1.0, vel * 4, 0.8, 0.85, 1.0, t + dur);
}

export function kick(ctx, out, t, vel = 0.6) {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.connect(g).connect(out); o.start(t); o.stop(t + 0.4);
}

export function noiseHit(ctx, out, t, { dur = 0.05, vel = 0.2, type = 'highpass', freq = 7000, q = 0.7, attack = 0.002, offset = 0 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, offset % 1.5); src.stop(t + attack + dur + 0.05);
  return { src, f, g };
}

// A continuous noise bed between t0 and t1 (rain, wind, waves, crowd).
export function noiseBed(ctx, out, t0, t1, { type = 'lowpass', freq = 800, q = 0.5, vel = 0.1, lfoRate = 0, lfoDepth = 0, fade = 0.6 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx); src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vel, t0 + fade);
  g.gain.setValueAtTime(vel, Math.max(t0 + fade, t1 - fade)); g.gain.linearRampToValueAtTime(0.0001, t1);
  if (lfoRate) {
    const l = ctx.createOscillator(); l.frequency.value = lfoRate; const lg = ctx.createGain(); lg.gain.value = vel * lfoDepth;
    l.connect(lg).connect(g.gain); l.start(t0); l.stop(t1 + 0.1);
  }
  src.connect(f).connect(g).connect(out);
  src.start(t0); src.stop(t1 + 0.1);
}

export function chirp(ctx, out, t, f0, f1, dur, vel = 0.05, type = 'sine') {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + dur * 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.02);
}
