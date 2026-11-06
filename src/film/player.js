// Real-time playback: the soundtrack is the clock; every animation frame
// renders the film at the audio's current time.
import { WebSpeechEngine } from '../audio/tts.js';

export class Player {
  // audioContext: one unlocked during a tap (iPhone plays sound only from a context started by a tap)
  constructor({ film, compositor, glCanvas, soundtrack, liveSpeech, voices, onTime, audioContext = null }) {
    this.film = film;
    this.compositor = compositor;
    this.glCanvas = glCanvas;
    this.soundtrack = soundtrack; // AudioBuffer (may lack voices in live-speech mode)
    this.liveSpeech = liveSpeech ? new WebSpeechEngine() : null;
    this.voices = voices;
    this.onTime = onTime || (() => {});
    this.t = 0;
    this.playing = false;
    this.ac = audioContext;
    this.ownsAc = !audioContext;
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
    // iPhone: play like a video (heard even with the silent switch on), not like a ringtone
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    if (!this.ac) { this.ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' }); this.ownsAc = true; }
    if (!this.watching) {
      // a phone call, the lock button or another app stops the sound (iPhone: "interrupted"): the film
      // pauses with it (its clock is the sound), and the next tap on play carries on
      this.watching = true;
      const ac = this.ac;
      let was = ac.state;
      ac.addEventListener('statechange', () => {
        if (ac !== this.ac) return;  // an old sound that was replaced
        const now = ac.state;
        if (this.playing && was === 'running' && now !== 'running') this.pause();
        was = now;
      });
    }
    if (this.ac.state !== 'running') this.ac.resume().catch(() => {});
  }

  // Is the sound's clock really moving? (An iPhone can report "running" while its sound is asleep,
  // e.g. minutes after the tap that started it: then its clock stands still.)
  async soundMoves(ms = 350) {
    if (!this.ac || this.ac.state !== 'running') return false;
    const a = this.ac.currentTime;
    await new Promise((r) => setTimeout(r, ms));
    return this.ac.currentTime > a;
  }

  // Starts playing by itself when the sound can start; otherwise waits on the first picture with the
  // play button showing, and onNeedTap() tells the viewer to tap ▶ (a tap can always start the sound).
  async autoplay(onNeedTap = () => {}) {
    this.ensureAudio();
    if (this.ac.state !== 'running') {
      await Promise.race([this.ac.resume().catch(() => {}), new Promise((r) => setTimeout(r, 600))]);
    }
    if (await this.soundMoves()) { this.play(); return; }
    this.stalled = true;  // the next tap starts fresh sound
    this.t = 0; this.render();
    onNeedTap();
  }

  // gesture: called from a tap on play (a fresh sound can start only then on an iPhone)
  play(gesture = false) {
    if (this.playing) return;
    if (this.t >= this.duration - 0.05) this.t = 0;
    if (gesture && this.stalled) {
      // the old sound is stuck: start a new one, inside the tap
      try { if (this.ownsAc) this.ac.close(); } catch {}
      this.ac = null; this.watching = false; this.stalled = false;
    }
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
    // The clock is the sound while it moves; if it stands still, a plain timer keeps the film going,
    // so the picture never freezes (and the next tap on play tries fresh sound).
    let lastAudio = this.ac.currentTime, lastAudioWall = performance.now(), lastWall = performance.now();
    const loop = () => {
      if (!this.playing) return;
      const now = performance.now(), at = this.ac.currentTime;
      if (at !== lastAudio) { lastAudio = at; lastAudioWall = now; }
      const soundOk = this.ac.state === 'running' && now - lastAudioWall < 400;
      if (!soundOk && now - lastAudioWall > 700) this.stalled = true;
      const next = soundOk ? at - this.startedAt : this.t + (now - lastWall) / 1000;
      lastWall = now;
      this.t = Math.max(0, this.t - 0.02, Math.min(this.duration, next));  // never runs backwards while playing
      if (!soundOk) this.startedAt = at - this.t;  // when the sound comes back, it carries on from here
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

  toggle() { this.playing ? this.pause() : this.play(true); }

  seek(t) {
    const was = this.playing;
    if (was) this.pause();
    this.t = Math.max(0, Math.min(this.duration, t));
    this.spoken.clear();
    this.render();
    if (was) this.play(true);
  }

  render() {
    this.film.renderAt(this.t);
    this.compositor.draw(this.glCanvas, this.film, this.t);
    this.onTime(this.t, false);
  }

  dispose() {
    this.pause();
    if (this.ac && this.ownsAc) this.ac.close();
    this.film.talkOverride = null;
  }
}
