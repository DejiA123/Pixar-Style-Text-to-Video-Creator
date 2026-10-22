// Renders the complete soundtrack (voices + score + sound design) into one
// AudioBuffer with an OfflineAudioContext, and computes lip-sync envelopes.
import { scheduleScore } from './music.js';
import { scheduleSfx } from './sfx.js';
import { reverb } from './synth.js';
import { lineKey } from '../film/timeline.js';

export const SAMPLE_RATE = 48000;

// clips: Map(lineKey → {samples: Float32Array, sampleRate}); voices: Map(speaker → voice spec)
export async function renderSoundtrack(timeline, clips, voices, opts = {}) {
  const duration = timeline.duration + 0.5;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -14; master.knee.value = 12; master.ratio.value = 3; master.attack.value = 0.005; master.release.value = 0.2;
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.95;
  master.connect(masterGain).connect(ctx.destination);

  const room = reverb(ctx, 2.6, 2.6);
  const roomOut = ctx.createGain(); roomOut.gain.value = 0.32;
  room.connect(roomOut).connect(master);

  // music bus with ducking under dialogue
  const musicBus = ctx.createGain();
  const musicDry = ctx.createGain(); musicDry.gain.value = 0.75;
  const musicWet = ctx.createGain(); musicWet.gain.value = 0.5;
  musicBus.connect(musicDry).connect(master);
  musicBus.connect(musicWet).connect(room);
  const base = opts.music === false ? 0 : (opts.musicVolume ?? 0.55);
  const duck = base * 0.42;
  musicBus.gain.setValueAtTime(0.0001, 0);
  musicBus.gain.linearRampToValueAtTime(base, 1.2);
  const voiceLines = [];
  for (const s of timeline.shots) for (const l of s.lines) voiceLines.push(l);
  // merge overlapping duck windows
  const wins = [];
  for (const l of voiceLines.sort((a, b) => a.start - b.start)) {
    const a = l.start - 0.2, b = l.end + 0.3;
    const last = wins[wins.length - 1];
    if (last && a <= last[1] + 0.4) last[1] = Math.max(last[1], b); else wins.push([a, b]);
  }
  for (const [a, b] of wins) {
    musicBus.gain.setTargetAtTime(duck, Math.max(1.3, a), 0.08);
    musicBus.gain.setTargetAtTime(base, Math.max(1.4, b), 0.35);
  }
  musicBus.gain.setTargetAtTime(base * 1.1, timeline.endCard.start, 0.3);
  musicBus.gain.setTargetAtTime(0.0001, timeline.duration - 1.6, 0.5);
  if (opts.music !== false) scheduleScore(ctx, musicBus, timeline, { seed: opts.seed });

  // sound effects
  const sfxBus = ctx.createGain(); sfxBus.gain.value = opts.sfx === false ? 0 : 0.9;
  const sfxWet = ctx.createGain(); sfxWet.gain.value = 0.15;
  sfxBus.connect(master); sfxBus.connect(sfxWet).connect(room);
  if (opts.sfx !== false) scheduleSfx(ctx, sfxBus, timeline, { seed: opts.seed });

  // voices
  const voiceBus = ctx.createGain(); voiceBus.gain.value = 1.0;
  voiceBus.connect(master);
  const churchWet = ctx.createGain(); churchWet.gain.value = 0.35;
  churchWet.connect(room);
  const speakers = [...voices.keys()];
  for (const s of timeline.shots) {
    for (const l of s.lines) {
      const clip = clips.get(lineKey(l.speaker, l.text));
      if (!clip) continue;
      const v = voices.get(l.speaker) || voices.get('narrator');
      const buf = ctx.createBuffer(1, clip.samples.length, clip.sampleRate);
      buf.copyToChannel(clip.samples, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = v.rate || 1;
      let node = src;
      if (v.fx === 'robot' || v.fx === 'alien') {
        const ring = ctx.createGain(); ring.gain.value = 0.0;
        const osc = ctx.createOscillator(); osc.frequency.value = v.fx === 'robot' ? 55 : 420;
        const depth = ctx.createGain(); depth.gain.value = v.fx === 'robot' ? 0.75 : 0.35;
        osc.connect(depth).connect(ring.gain);
        const dry = ctx.createGain(); dry.gain.value = v.fx === 'robot' ? 0.45 : 0.75;
        const mix = ctx.createGain();
        src.connect(ring).connect(mix); src.connect(dry).connect(mix);
        osc.start(l.start); osc.stop(l.end + 0.5);
        node = mix;
      } else if (v.fx === 'big') {
        const lp = ctx.createBiquadFilter(); lp.type = 'lowshelf'; lp.frequency.value = 250; lp.gain.value = 6;
        src.connect(lp); node = lp;
      }
      const pan = ctx.createStereoPanner();
      const idx = speakers.indexOf(l.speaker);
      pan.pan.value = l.speaker === 'narrator' ? 0 : ((idx % 2 ? 1 : -1) * 0.12);
      const g = ctx.createGain(); g.gain.value = l.speaker === 'narrator' ? 0.95 : 1.0;
      node.connect(g).connect(pan).connect(voiceBus);
      if (s.scene.setting === 'church' || s.scene.setting === 'cave') pan.connect(churchWet);
      src.start(l.start);
    }
  }
  return ctx.startRendering();
}

// RMS envelope (100 Hz) normalized to 0..1, in *playback* time.
export function lipEnvelope(clip, rate = 1) {
  const sr = clip.sampleRate;
  const s = clip.samples;
  const hop = (sr * rate) / 100;
  const n = Math.ceil(s.length / hop);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, c = 0;
    const a = Math.floor(i * hop), b = Math.min(s.length, Math.floor(a + hop * 1.5));
    for (let k = a; k < b; k++) { sum += s[k] * s[k]; c++; }
    out[i] = Math.sqrt(sum / Math.max(1, c));
  }
  const sorted = Array.from(out).sort((a, b) => a - b);
  const ref = sorted[Math.floor(sorted.length * 0.92)] || 1;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.min(1, out[i] / (ref || 1));
    prev = v > prev ? v : prev * 0.72 + v * 0.28; // fast open, softer close
    out[i] = prev < 0.08 ? 0 : prev;
  }
  return { data: out, rate: 100 };
}

export function clipDuration(clip, rate = 1) { return clip.samples.length / clip.sampleRate / rate; }

export function audioBufferToWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true); data.setUint32(24, sr, true);
  data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true); w(36, 'data'); data.setUint32(40, len * ch * 2, true);
  const chans = [...Array(ch)].map((_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, chans[c][i])); data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return new Blob([data.buffer], { type: 'audio/wav' });
}
