// The Film: a deterministic world that can render any moment t of the
// movie. Owns characters, environments, props and effects.
import { fabricsReady } from '../engine/materials.js';
import * as THREE from 'three';
import { Character } from '../engine/characters/character.js';
import { buildEnvironment } from '../engine/world/environments.js';
import { makeProp, HANDHELD } from '../engine/world/props.js';
import { Effect } from '../engine/world/effects.js';
import { cameraFor } from './camera.js';
import { lineKey } from './timeline.js';
import { clamp, easeInOut, smoothstep, makeRng, hash01, noise1 } from '../util.js';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const FADE = 0.45;

export class Film {
  constructor(fr, timeline, opts = {}) {
    this.fr = fr;
    this.tl = timeline;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.05, 900);
    this.chars = new Map();
    this.envs = new Map();
    this.currentEnv = null;
    this.propCache = new Map();
    this.effects = new Map();
    this.envelopes = new Map(); // lineKey → { data: Float32Array, rate }
    this.talkOverride = null; // (id, t) → amplitude, for live speech engines
    this.aspect = opts.aspect ?? 16 / 9;
    this.storyText = opts.storyText || '';
  }

  // Build every character and environment up front (yielding so the UI stays alive).
  async prepare(onProgress = () => {}) {
    const cast = this.tl.cast;
    const envKeys = [...new Set(this.tl.shots.map((s) => s.envKey))];
    const total = cast.length + envKeys.length;
    let done = 0;
    const tick = async (label) => { done++; onProgress(done / total, label); await new Promise((r) => setTimeout(r, 0)); };
    for (const c of cast) {
      const ch = new Character(c);
      ch.root.visible = false;
      this.scene.add(ch.root);
      this.chars.set(c.id, ch);
      await tick(`Building ${c.name || c.noun || 'character'}`);
    }
    for (const key of envKeys) {
      await this.getEnv(key).loadHDRI(this.fr.renderer);
      await tick(`Building ${key.split('|')[0]}`);
    }
    await fabricsReady();
    // compile shaders for every environment once, so playback doesn't hitch
    for (const env of this.envs.values()) {
      env.attach(this.scene);
      this.fr.renderer.compile(this.scene, this.camera);
      env.detach(this.scene);
    }
  }

  getEnv(key) {
    if (this.envs.has(key)) return this.envs.get(key);
    const [setting, time, weather] = key.split('|');
    const env = buildEnvironment(this.fr.renderer, { setting, time, weather, seed: 1000 + this.envs.size * 7, text: this.storyText });
    this.envs.set(key, env);
    return env;
  }

  shotAt(t) {
    const shots = this.tl.shots;
    let lo = 0, hi = shots.length - 1;
    if (t >= shots[hi].start) return { shot: shots[hi], index: hi };
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (shots[mid].start <= t) lo = mid; else hi = mid - 1;
    }
    return { shot: shots[lo], index: lo };
  }

  lineAt(t) {
    const { shot } = this.shotAt(t);
    return shot.lines.find((l) => t >= l.start && t <= l.end + 0.15) || null;
  }

  talkAmount(id, t, shot) {
    if (this.talkOverride) return this.talkOverride(id, t);
    for (const l of shot.lines) {
      if (l.speaker !== id || t < l.start || t > l.end) continue;
      const env = this.envelopes.get(lineKey(l.speaker, l.text));
      if (env) {
        const i = Math.floor((t - l.start) * env.rate);
        return i >= 0 && i < env.data.length ? env.data[i] : 0;
      }
      // procedural syllables when no audio envelope exists
      const local = t - l.start;
      return clamp(0.25 + 0.75 * Math.abs(Math.sin(local * 11 + Math.sin(local * 3.1) * 2)) * (0.6 + 0.4 * noise1(local * 4, 7)));
    }
    return 0;
  }

  // ---- per-frame --------------------------------------------------------------------
  renderAt(t, opts = {}) {
    const tl = this.tl;
    t = clamp(t, 0, tl.duration);
    const { shot, index } = this.shotAt(Math.min(t, tl.endCard.start - 1e-3));
    const local = t - shot.start;
    const len = Math.max(0.01, shot.end - shot.start);
    const u = clamp(local / len);
    const env = this.getEnv(shot.envKey);
    if (env !== this.currentEnv) {
      if (this.currentEnv) this.currentEnv.detach(this.scene);
      env.attach(this.scene);
      this.currentEnv = env;
    }
    env.update(t);

    // characters
    for (const ch of this.chars.values()) ch.root.visible = false;
    const seatsTaken = new Set();
    const placed = [];
    for (const id of shot.ids) {
      const ch = this.chars.get(id);
      if (!ch) continue;
      const b = shot.blocking[id];
      ch.root.visible = true;
      let x, z, ry;
      const travel = b.from.x !== b.to.x || b.from.z !== b.to.z;
      const k = travel ? clamp((local - 0.2) / Math.max(0.5, len - 0.6)) : 0;
      const kk = travel ? (b.action === 'walk' || b.action === 'sneak' ? k : easeInOut(k)) : 0;
      x = b.from.x + (b.to.x - b.from.x) * kk;
      z = b.from.z + (b.to.z - b.from.z) * kk;
      ry = travel ? Math.atan2(b.to.x - b.from.x, b.to.z - b.from.z) : b.from.ry;
      let action = b.action;
      let seatHeight;
      if (b.hug) action = 'hug';
      if (b.seat) {
        const seat = this.pickSeat(env, x, z, seatsTaken);
        if (seat) { x = seat.pos.x; z = seat.pos.z; ry = seat.ry; seatHeight = seat.h; }
      }
      if (b.mark && env.marks[b.mark]) { const m = env.marks[b.mark]; x = m.pos.x; z = m.pos.z + 0.6; ry = 0; }
      if (b.bed && env.marks.bed) { const m = env.marks.bed; x = m.pos.x; z = m.pos.z + 0.6; ry = 0; }
      // hug: walk together during the first part
      if (action === 'hug' && b.from.x !== b.to.x) { /* handled by travel */ }
      const y = env.heightAt ? env.heightAt(x, z) : 0;
      ch.root.position.set(x, y + (b.mark ? env.marks[b.mark]?.pos.y ?? 0 : 0), z);
      ch.root.rotation.set(0, ry, 0);
      placed.push({ id, ch, b, action, seatHeight });
    }
    this.scene.updateMatrixWorld(true);

    // who looks at whom
    const focusCh = this.chars.get(shot.focus);
    const targetCh = shot.target ? this.chars.get(shot.target) : null;
    for (const p of placed) {
      const { id, ch, b, action, seatHeight } = p;
      const talk = this.talkAmount(id, t, shot);
      let lookAt = null, lookWeight = 0.75;
      const other = id === shot.focus ? targetCh : focusCh;
      if (other && other !== ch && !['run', 'walk', 'fly', 'sleep', 'pray', 'read'].includes(action)) lookAt = other.headWorld(v3());
      else if (this._lastCamPos && ['stand', 'talk', 'wave', 'think', 'cheer', 'laugh'].includes(action)) { lookAt = this._lastCamPos.clone(); lookWeight = 0.35; }
      const prevEmotion = index > 0 ? this.tl.shots[index - 1].blocking[id]?.emotion : null;
      ch.update({
        t, localT: local, action, emotion: b.emotion, talk, lookAt, lookWeight, seatHeight, kneel: b.kneel,
        speed: travel(b) ? Math.hypot(b.to.x - b.from.x, b.to.z - b.from.z) / Math.max(0.5, len - 0.6) : undefined,
        prevEmotion, emotionBlend: clamp(local / 0.5),
      });
    }
    this.scene.updateMatrixWorld(true);

    // props
    this.updateProps(shot, index, local, placed);

    // camera
    const subjects = this.subjects(shot, placed);
    const cam = cameraFor(shot, u, subjects, this.aspect, index * 7 + 3);
    this.camera.position.copy(cam.pos);
    this.camera.fov = cam.fov;
    this.camera.lookAt(cam.look);
    this._lastCamPos = cam.pos.clone();
    env.frame(subjects.group.center, cam.pos);

    // effects
    this.updateEffects(shot, t, local, subjects, env);

    // lightning in storms
    let flash = 0;
    if (shot.scene.weather === 'storm') {
      const k = Math.floor(t / 3.7);
      const ph = t - k * 3.7 - hash01(k, 3) * 2.5;
      if (ph > 0 && ph < 0.35) flash = Math.max(0, Math.sin(ph * 30)) * (1 - ph / 0.35);
    }
    env.hemi.intensity = (env.baseHemi ??= env.hemi.intensity) + flash * 3;

    // fades: title in, between settings, to the end card
    let fade = 0;
    if (t < 0.8) fade = 1 - t / 0.8;
    const next = this.tl.shots[index + 1];
    if (next && next.transition === 'fade' && shot.end - t < FADE) fade = Math.max(fade, 1 - (shot.end - t) / FADE);
    if (shot.transition === 'fade' && local < FADE) fade = Math.max(fade, 1 - local / FADE);
    if (t > tl.endCard.start - 0.6) fade = Math.max(fade, clamp((t - (tl.endCard.start - 0.6)) / 0.9));

    const g = env.grade || {};
    const pxScale = this.fr.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    for (const e of this.effects.values()) e.uniforms.uScale.value = pxScale;
    this.fr.render(this.scene, this.camera, {
      focusDist: cam.focus, aperture: (opts.dof === false ? 0 : cam.aperture), time: t,
      bloom: opts.bloomOverride ?? g.bloom ?? 0.35, bloomThreshold: g.bloomThreshold, bloomRadius: g.bloomRadius, exposure: (env.exposure ?? 1) * (1 + flash * 0.6),
      vignette: g.vignette ?? 0.4, saturation: g.saturation, contrast: g.contrast,
      shadowTint: g.shadowTint, highlightTint: g.highlightTint, fade,
      maxBlurFrac: opts.maxBlurFrac,
    });
    return { shot, index, local, fade };
  }

  pickSeat(env, x, z, taken) {
    let best = null, bd = Infinity;
    for (const s of env.seats) {
      if (taken.has(s)) continue;
      const d = (s.pos.x - x) ** 2 + (s.pos.z - z) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    if (best) taken.add(best);
    return best;
  }

  subjects(shot, placed) {
    const info = (ch) => {
      if (!ch) return null;
      const head = ch.headWorld(v3());
      const feet = ch.root.position.clone();
      const height = Math.max(0.4, head.y - feet.y + ch.height * 0.12);
      const chest = feet.clone().lerp(head, 0.72);
      return { head, feet, chest, height, facing: ch.root.rotation.y };
    };
    const focus = info(this.chars.get(shot.focus));
    const target = shot.target && shot.ids.includes(shot.target) ? info(this.chars.get(shot.target)) : null;
    const box = new THREE.Box3();
    let any = false;
    for (const p of placed) { const i = info(p.ch); box.expandByPoint(i.head); box.expandByPoint(i.feet); any = true; }
    const center = any ? box.getCenter(v3()) : v3(0, 1, 0);
    const size = any ? box.getSize(v3()) : v3(2, 2, 2);
    return { focus, target, group: { center: v3(center.x, 0, center.z), width: Math.max(size.x, size.z * 0.6) + 0.8, height: Math.max(size.y, 1.8) } };
  }

  updateProps(shot, index, local, placed) {
    for (const [, o] of this.propCache) o.visible = false;
    const rng = makeRng(index * 13 + 5);
    shot.props.forEach((p, i) => {
      const key = `${index}:${p.type}:${i}`;
      let o = this.propCache.get(key);
      if (!o) {
        o = makeProp(p.type, rng, { night: shot.scene.time === 'night', flame: p.type === 'rocket' });
        this.propCache.set(key, o);
        this.scene.add(o);
      }
      o.visible = true;
      const holder = p.holder && placed.find((q) => q.id === p.holder);
      if (holder && HANDHELD.has(p.type) && holder.ch.joints.gripR) {
        const grip = holder.ch.joints.gripR;
        grip.updateWorldMatrix(true, false);
        const wp = grip.getWorldPosition(v3());
        o.position.copy(wp);
        if (['kite', 'balloon'].includes(p.type)) o.position.y -= 0.1;
        else o.position.y -= ['umbrella', 'guitar', 'lantern', 'basket'].includes(p.type) ? 0.0 : 0.04;
        o.rotation.set(0, holder.ch.root.rotation.y, 0);
        o.scale.setScalar(['umbrella'].includes(p.type) ? 1 : 1);
      } else {
        const big = ['rocket', 'car', 'house', 'tree', 'boat', 'tent', 'ufo', 'bridge', 'piano', 'snowman', 'bike', 'telescope', 'campfire', 'bench'].includes(p.type);
        const f = placed.find((q) => q.id === shot.focus);
        const base = f ? f.ch.root.position : v3();
        const dx = big ? 3.2 : 0.9, dz = big ? -2.5 : 0.5;
        o.position.set(base.x + (i % 2 ? -dx : dx), 0, base.z + dz);
        if (['star', 'heart'].includes(p.type)) o.position.y = 0.2 + Math.sin(local * 2) * 0.1;
        if (p.type === 'ufo') o.position.y = 3 + Math.sin(local) * 0.3;
        if (p.type === 'rocket' && /blast|launch|took off|flew|soar/.test(shot.scene.text)) o.position.y = Math.max(0, (local - 1) ** 2 * 1.5);
        if (o.userData.flame) o.userData.flame.visible = o.position.y > 0.01;
        o.rotation.y = 0.4;
      }
      if (o.userData.flames) o.userData.flames.children.forEach((fl, k) => { fl.scale.set(1, 0.8 + 0.3 * Math.sin(local * 14 + k * 2), 1); });
    });
  }

  updateEffects(shot, t, local, subjects, env) {
    const wanted = new Set();
    const sc = shot.scene;
    if (sc.weather === 'rain' || sc.weather === 'storm') wanted.add('rain');
    if (sc.weather === 'snow') wanted.add('snow');
    if (sc.time === 'night' && ['forest', 'meadow', 'lake', 'village', 'farm'].includes(sc.setting)) wanted.add('fireflies');
    if (sc.setting === 'church' || (sc.fx || []).includes('godrays')) wanted.add(sc.setting === 'church' ? 'dust' : 'godlight');
    for (const f of sc.fx || []) if (f !== 'godrays') wanted.add(f);
    for (const [k, e] of this.effects) e.points.visible = wanted.has(k);
    const F = subjects.focus;
    for (const k of wanted) {
      let e = this.effects.get(k);
      if (!e) {
        try { e = new Effect(k, 7); } catch { continue; }
        this.effects.set(k, e);
        this.scene.add(e.points);
      }
      e.points.visible = true;
      let origin = subjects.group.center.clone();
      if (F && ['hearts', 'notes', 'zzz', 'tears', 'poof'].includes(k)) origin = F.head.clone().add(v3(0, k === 'tears' ? -0.02 : 0.25, 0));
      if (F && ['sparkles'].includes(k)) origin = F.chest.clone();
      if (k === 'dust') origin = v3(0, 0, -4);
      if (k === 'godlight' && F) origin = F.feet.clone();
      const time = ['poof'].includes(k) ? local : t;
      e.update(time, origin, 500);
    }
  }

  dispose() {
    for (const e of this.effects.values()) e.dispose();
  }
}

function travel(b) { return b.from.x !== b.to.x || b.from.z !== b.to.z; }
