// Realistic voices and lip sync from your own Storyreel AI server.
// Voices: every line is re-spoken by Chatterbox in the voice of that character's
// in-browser (Kokoro) voice, with the scene's emotion. Lip sync: talking shots'
// AI video clips get their mouths re-rendered by LatentSync to match the words.
import { lineKey } from '../film/timeline.js';

const VOICE_SR = 24000;
const LIPSYNC_SR = 16000;
// how strongly each emotion is acted (0 calm .. 1 intense)
const EMOTION_LEVEL = { excited: 0.85, angry: 0.85, surprised: 0.8, scared: 0.75, sad: 0.7, happy: 0.6, love: 0.55, hopeful: 0.5, curious: 0.45, neutral: 0.3, tired: 0.25 };

export const blobToDataUrl = (blob) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });

// Linear-interpolated resample of mono samples, sped up by `speed` (1.1 = 10% faster and higher).
function resample(samples, fromRate, toRate, speed = 1) {
  const step = (fromRate * speed) / toRate;
  const out = new Float32Array(Math.floor(samples.length / step));
  for (let i = 0; i < out.length; i++) {
    const x = i * step, k = Math.floor(x), f = x - k;
    out[i] = samples[k] * (1 - f) + (samples[k + 1] ?? samples[k]) * f;
  }
  return out;
}

export function wavBlob(samples, sampleRate) {
  const data = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true); data.setUint32(24, sampleRate, true);
  data.setUint32(28, sampleRate * 2, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true); w(36, 'data'); data.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const v = Math.max(-1, Math.min(1, samples[i])); data.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  return new Blob([data.buffer], { type: 'audio/wav' });
}

// 16-bit PCM WAV → {samples, sampleRate} (the clip format the mixer uses)
export async function wavClip(blob) {
  const v = new DataView(await blob.arrayBuffer());
  let o = 12, rate = VOICE_SR, ch = 1;
  while (o + 8 <= v.byteLength) {
    const id = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') { ch = v.getUint16(o + 10, true); rate = v.getUint32(o + 12, true); }
    if (id === 'data') {
      const n = Math.floor(Math.min(size, v.byteLength - o - 8) / 2 / ch);
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = v.getInt16(o + 8 + i * 2 * ch, true) / 32768;
      return { samples, sampleRate: rate };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error('not a WAV file');
}

// Each speaker's reference voice: their own lines as the listener hears them
// (playback speed applied, so a child's voice stays a child's), about 10 s.
function referenceVoices(lines, clips, voices) {
  const parts = new Map();
  for (const l of lines) {
    const c = clips.get(lineKey(l.speaker, l.text));
    if (!c) continue;
    const list = parts.get(l.speaker) || [];
    const have = list.reduce((a, s) => a + s.length, 0) / VOICE_SR;
    if (have < 10) list.push(resample(c.samples, c.sampleRate, VOICE_SR, (voices.get(l.speaker) || voices.get('narrator'))?.rate || 1));
    parts.set(l.speaker, list);
  }
  const refs = new Map();
  for (const [sp, list] of parts) {
    const gap = new Float32Array(Math.round(VOICE_SR * 0.3));
    const all = list.flatMap((s) => [s, gap]);
    const out = new Float32Array(all.reduce((a, s) => a + s.length, 0));
    let k = 0;
    for (const s of all) { out.set(s, k); k += s.length; }
    refs.set(sp, wavBlob(out, VOICE_SR));
  }
  return refs;
}

// Re-speak every line on the server (an aiserver.js client). Replaces entries in `clips` and returns true
// only if every line succeeded (otherwise the in-browser voices stay as they were).
export async function serverVoices(server, plan, clips, voices, { onProgress = () => {}, signal } = {}) {
  const lines = plan.titleVoice === false ? [] : [{ speaker: 'narrator', text: plan.title, emo: 'neutral' }];
  for (const s of plan.scenes) for (const l of s.lines) lines.push({ ...l, emo: s.emotions?.[l.speaker] });
  const uniq = [...new Map(lines.map((l) => [lineKey(l.speaker, l.text), l])).values()].filter((l) => clips.has(lineKey(l.speaker, l.text)));
  if (!uniq.length) return false;
  // each reference voice is uploaded once; after that the server knows it by its sha1
  const refs = new Map();
  for (const [sp, b] of referenceVoices(uniq, clips, voices)) {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-1', await b.arrayBuffer()))].map((x) => x.toString(16).padStart(2, '0')).join('');
    refs.set(sp, { key: hash, data: await blobToDataUrl(b), sent: false });
  }
  const out = new Map();
  let seed = 7;
  onProgress(0, `0/${uniq.length}`);
  for (const l of uniq) {
    const emotion = l.speaker === 'narrator' ? 0.35 : Math.min(1, (EMOTION_LEVEL[l.emo] ?? 0.4) + (/!/.test(l.text) ? 0.1 : 0));
    const ref = refs.get(l.speaker);
    const say = (withClip) => server.tts({ text: l.text, ...(withClip ? { ref: ref.data } : { ref_key: ref.key }), emotion, seed }, signal);
    let wav;
    try { wav = await say(!ref.sent); } catch (e) {
      if (e?.code !== 'unknown-ref') throw e;
      wav = await say(true);  // this server (or serverless worker) hasn't heard that voice yet
    }
    ref.sent = true;
    seed++;
    out.set(lineKey(l.speaker, l.text), await wavClip(wav));
    onProgress(out.size / uniq.length, `${out.size}/${uniq.length}`);
  }
  for (const [k, c] of out) clips.set(k, c);
  return true;
}

// The on-screen speakers' words for one shot, laid out on the AI clip's own clock
// (the player maps shot time onto the clip at `rate`), as a 16 kHz WAV, or null
// when nobody in the shot speaks. Narration is left out: its mouth isn't on screen.
export function shotSpeech(shot, clips, voices, clipDur, rate) {
  const onScreen = new Set(shot.kind === 'title' ? [] : shot.scene.characters || []);
  const out = new Float32Array(Math.ceil(clipDur * LIPSYNC_SR));
  let any = false;
  for (const l of shot.lines) {
    if (l.speaker === 'narrator' || !onScreen.has(l.speaker)) continue;
    const c = clips.get(lineKey(l.speaker, l.text));
    if (!c) continue;
    const speed = ((voices.get(l.speaker) || {}).rate || 1) / rate;  // playback speed, then onto the clip's clock
    const s = resample(c.samples, c.sampleRate, LIPSYNC_SR, speed);
    const at = Math.round((l.start - shot.start) * rate * LIPSYNC_SR);
    for (let i = 0; i < s.length; i++) {
      const k = at + i;
      if (k >= out.length) break;
      if (k >= 0) { out[k] += s[i]; any = true; }
    }
  }
  return any ? wavBlob(out, LIPSYNC_SR) : null;
}

// Lip-sync one AI clip on the server; resolves to the new MP4 blob, or null if the
// server couldn't (no clear face in the shot, for example).
export async function lipsyncClip(server, video, audio, signal) {
  try {
    return await server.lipsync({ video: await blobToDataUrl(video), audio: await blobToDataUrl(audio) }, signal);
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    console.warn('lip sync skipped:', e?.message || e);
    return null;
  }
}
