// Runs the Kokoro neural TTS model off the main thread.
let tts = null;
let KokoroTTS = null;

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      if (!KokoroTTS) ({ KokoroTTS } = await import(msg.lib));
      if (!tts) {
        tts = await KokoroTTS.from_pretrained(msg.model, {
          dtype: msg.dtype || 'q8',
          device: msg.device || 'wasm',
          progress_callback: (p) => self.postMessage({ type: 'progress', p }),
        });
      }
      self.postMessage({ type: 'loaded' });
    } else if (msg.type === 'gen') {
      const audio = await tts.generate(msg.text, { voice: msg.voice, speed: msg.speed ?? 1 });
      const samples = audio.audio;
      self.postMessage({ type: 'audio', id: msg.id, samples, sampleRate: audio.sampling_rate }, [samples.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, error: String(err && err.message || err) });
  }
};
