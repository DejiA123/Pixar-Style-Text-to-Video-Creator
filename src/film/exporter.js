// Video export. Preferred path renders every frame offline (perfectly smooth,
// any resolution) and encodes with WebCodecs through Mediabunny into MP4.
// Fallback: real-time capture with MediaRecorder.
import {
  Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource, Quality,
  getFirstEncodableVideoCodec, getFirstEncodableAudioCodec,
} from '../../vendor/mediabunny/mediabunny.min.mjs';

export function webCodecsSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';
}

// renderFrame(t) must draw the final composited frame into `canvas`.
export async function exportVideo({ canvas, duration, fps = 30, soundtrack, renderFrame, onProgress = () => {}, signal }) {
  const W = canvas.width, H = canvas.height;
  if (!webCodecsSupported()) return recordRealtime({ canvas, duration, fps, soundtrack, renderFrame, onProgress, signal });

  let format = new Mp4OutputFormat({ fastStart: 'in-memory' });
  let vcodec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: W, height: H, frameRate: fps });
  let acodec = soundtrack ? await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: soundtrack.sampleRate }) : null;
  let ext = 'mp4', mime = 'video/mp4';
  if (!vcodec || (vcodec !== 'avc' && vcodec !== 'hevc') || (soundtrack && acodec !== 'aac')) {
    // MP4 players expect H.264/AAC; otherwise produce a WebM (VP9/Opus)
    const v2 = await getFirstEncodableVideoCodec(['vp9', 'vp8', 'av1'], { width: W, height: H, frameRate: fps });
    const a2 = soundtrack ? await getFirstEncodableAudioCodec(['opus', 'vorbis'], { numberOfChannels: 2, sampleRate: soundtrack.sampleRate }) : null;
    if (v2 && (!soundtrack || a2)) { format = new WebMOutputFormat(); vcodec = v2; acodec = a2; ext = 'webm'; mime = 'video/webm'; }
  }
  if (!vcodec) return recordRealtime({ canvas, duration, fps, soundtrack, renderFrame, onProgress, signal });

  const output = new Output({ format, target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: vcodec, bitrate: new Quality('very-high'), keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: fps });
  let audio = null;
  if (soundtrack && acodec) {
    audio = new AudioBufferSource({ codec: acodec, bitrate: new Quality('high') });
    output.addAudioTrack(audio);
  }
  await output.start();
  if (audio) await audio.add(soundtrack);
  const frames = Math.ceil(duration * fps);
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) {
    if (signal?.aborted) { await output.cancel(); throw new DOMException('Export cancelled', 'AbortError'); }
    const t = i / fps;
    await renderFrame(t);
    await video.add(t, 1 / fps);
    if (i % 3 === 0) {
      const el = (performance.now() - t0) / 1000;
      onProgress((i + 1) / frames, el / (i + 1) * (frames - i - 1));
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  video.close();
  audio?.close();
  await output.finalize();
  onProgress(1, 0);
  return { blob: new Blob([output.target.buffer], { type: mime }), ext, codec: `${vcodec}${acodec ? '+' + acodec : ''}` };
}

async function recordRealtime({ canvas, duration, fps, soundtrack, renderFrame, onProgress, signal }) {
  const stream = canvas.captureStream(fps);
  let ac = null, src = null;
  if (soundtrack) {
    ac = new AudioContext();
    const dest = ac.createMediaStreamDestination();
    src = ac.createBufferSource();
    src.buffer = soundtrack;
    src.connect(dest);
    for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
  }
  const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start(250);
  const start = performance.now();
  src?.start();
  await new Promise((resolve) => {
    const tick = async () => {
      const t = (performance.now() - start) / 1000;
      if (signal?.aborted || t >= duration) return resolve();
      await renderFrame(t);
      onProgress(t / duration, duration - t);
      requestAnimationFrame(tick);
    };
    tick();
  });
  rec.stop();
  await done;
  src?.stop(); ac?.close();
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  const type = mime.split(';')[0] || 'video/webm';
  return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm', codec: mime || 'default' };
}
