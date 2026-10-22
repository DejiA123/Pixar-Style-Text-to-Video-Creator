// Real-time playback: the soundtrack is the clock; every animation frame
// renders the film at the audio's current time.
import { WebSpeechEngine } from '../audio/tts.js';

export class Player {
  constructor({ film, compositor, glCanvas, soundtrack, liveSpeech, voices, onTime }) {
    this.film = film;
    this.compositor = compositor;
    this.glCanvas = glCanvas;
    this.soundtrack = soundtrack; // AudioBuffer (may lack voices in live-speech mode)
    this.liveSpeech = liveSpeech ? new WebSpeechEngine() : null;
    this.voices = voices;
    this.onTime = onTime || (() => {});
    this.t = 0;
    this.playing = false;
    this.ac = null;
    this.src = null;
    this.spoken = new Set();
    this.speakingId = null;
    this.flap = 0;
    this._raf = null;
    if (this.liveSpeech) {
      film.talkOverride = (id, t) => {
        if (this.speakingId !== id) return 0;
        const k = (performance.now() - this.flap) / 1000;
        return Math.max(0.15, Math.abs(Math.sin(t * 11)) * 0.9 * Math.exp(-k * 0.5) + 0.25);
      };
    }
  }

  get duration() { return this.film.tl.duration; }

  ensureAudio() {
    if (!this.ac) this.ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    if (this.ac.state === 'suspended') this.ac.resume();
  }

  play() {
    if (this.playing) return;
    if (this.t >= this.duration - 0.05) this.t = 0;
    this.ensureAudio();
    this.playing = true;
    this.spoken = new Set([...this.spoken].filter((k) => this.lineStart(k) < this.t - 0.05));
    if (this.soundtrack) {
      this.src = this.ac.createBufferSource();
      this.src.buffer = this.soundtrack;
      this.src.connect(this.ac.destination);
      this.startedAt = this.ac.currentTime + 0.05 - this.t;
      this.src.start(this.ac.currentTime + 0.05, Math.max(0, this.t));
    } else {
      this.startedAt = this.ac.currentTime - this.t;
    }
    if (this.liveSpeech) this.liveSpeech.resume();
    this.film.setPlaying?.(true);
    const loop = () => {
      if (!this.playing) return;
      this.t = Math.min(this.duration, this.ac.currentTime - this.startedAt);
      this.liveLines();
      this.render();
      if (this.t >= this.duration) { this.pause(); this.onTime(this.t, true); return; }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  lineStart(key) { return +key.split('@')[1]; }

  liveLines() {
    if (!this.liveSpeech) return;
    const { shot } = this.film.shotAt(this.t);
    for (const l of shot.lines) {
      const key = `${l.speaker}::${l.text}@${l.start}`;
      if (this.t >= l.start && this.t < l.end && !this.spoken.has(key)) {
        this.spoken.add(key);
        const v = this.voices.get(l.speaker) || this.voices.get('narrator');
        this.speakingId = l.speaker;
        this.flap = performance.now();
        this.liveSpeech.speak(l.text, v.web, () => { this.flap = performance.now(); }).then(() => { if (this.speakingId === l.speaker) this.speakingId = null; });
      }
    }
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this._raf);
    if (this.src) { try { this.src.stop(); } catch {} this.src.disconnect(); this.src = null; }
    if (this.liveSpeech) { this.liveSpeech.cancel(); this.speakingId = null; }
    this.film.setPlaying?.(false);
    this.render();
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  seek(t) {
    const was = this.playing;
    if (was) this.pause();
    this.t = Math.max(0, Math.min(this.duration, t));
    this.spoken.clear();
    this.render();
    if (was) this.play();
  }

  render() {
    this.film.renderAt(this.t);
    this.compositor.draw(this.glCanvas, this.film, this.t);
    this.onTime(this.t, false);
  }

  dispose() {
    this.pause();
    if (this.ac) this.ac.close();
    this.film.talkOverride = null;
  }
}
