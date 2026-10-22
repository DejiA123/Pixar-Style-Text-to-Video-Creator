// Environment builder: sky, ground, set dressing, lights, fog and grade for
// every setting the story parser knows about. Characters perform near the
// origin; the camera usually looks toward -z, so the richest dressing is
// placed behind the stage, with enough on the sides for angled shots.
import * as THREE from 'three';
import { surfaceMat } from '../materials.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { pickHDRI, loadHDRI } from './hdri.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat, fabric, canvasTexture, glowTexture, basic } from '../materials.js';
import { makeRng, smoothstep, lerp, noise1 } from '../../util.js';
import { TIME_PRESETS, applyWeather, makeSkyMaterial, sunDirection, grassField } from './sky.js';
import * as P from './props.js';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function fbm2(x, z, seed = 0) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < 4; i++) { v += a * (noise1(x * f * 0.11 + i * 7.1, seed + i) * 0.5 + noise1(z * f * 0.13 + i * 3.3, seed + 10 + i) * 0.5); a *= 0.5; f *= 2.1; }
  return v;
}

function makeGround(opts) {
  const R = opts.radius ?? 90;
  const g = new THREE.CircleGeometry(R, 160, 0, Math.PI * 2);
  // densify by subdividing radially with a ring geometry for smooth hills
  const ring = new THREE.RingGeometry(0.01, R, 220, 60);
  ring.rotateX(-Math.PI / 2);
  const pos = ring.attributes.position;
  const c1 = new THREE.Color(opts.color ?? 0x6fa84a), c2 = new THREE.Color(opts.color2 ?? 0x8fbf5a), c3 = new THREE.Color(opts.color3 ?? opts.color2 ?? 0x8fbf5a);
  const cols = new Float32Array(pos.count * 3);
  const flat = opts.flatRadius ?? 9;
  const heightAt = (x, z) => {
    const r = Math.hypot(x, z);
    const k = smoothstep(flat, flat + 14, r);
    let h = (opts.hills ?? 2.5) * k * (fbm2(x, z, opts.seed ?? 3) + 0.15) * 2;
    if (opts.dunes) h += Math.sin(x * 0.18 + Math.sin(z * 0.1) * 2) * 0.8 * k + Math.sin(z * 0.23) * 0.4 * k;
    if (opts.dish) h += smoothstep(flat * 0.7, flat + 2, r) * 0;
    return h;
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const n = fbm2(x * 2.2, z * 2.2, 9);
    const c = c1.clone().lerp(c2, smoothstep(0.1, 0.6, n)).lerp(c3, smoothstep(0.5, 0.9, fbm2(x * 0.7, z * 0.7, 21)) * 0.6);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  ring.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  ring.computeVertexNormals();
  g.dispose();
  const m = new THREE.Mesh(ring, mat(0xffffff, { vertexColors: true, roughness: opts.roughness ?? 0.95, sheen: opts.sheen ?? 0.2, sheenColor: 0xffffff, clearcoat: opts.wet ? 0.6 : 0 }));
  m.receiveShadow = true;
  m.userData.heightAt = heightAt;
  return m;
}

// Simple background people: readable silhouettes that blur nicely.
function extra(rng, opts = {}) {
  const g = new THREE.Group();
  const skin = rng.pick([0xf0c8a8, 0xd9a57f, 0xb07a55, 0x8a5a3c, 0x6a4230]);
  const top = rng.pick([0x3a6fb5, 0xd9643b, 0x4b8f5a, 0x7d5ab8, 0xc9a43a, 0x4a4f5c, 0xb8455a, 0x3a9a9a, 0xe8e4dc, 0x9c6644]);
  const s = opts.scale ?? rng.range(0.9, 1.1);
  const mk = (geo, c, x, y, z) => { const m = new THREE.Mesh(geo, mat(c, { roughness: 0.8 })); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  if (!opts.seated) {
    mk(new THREE.CapsuleGeometry(0.075 * s, 0.75 * s, 4, 8), rng.pick([0x2e4a7a, 0x34495e, 0x3d3d45, 0x6b5b4b]), -0.09 * s, 0.45 * s, 0);
    mk(new THREE.CapsuleGeometry(0.075 * s, 0.75 * s, 4, 8), rng.pick([0x2e4a7a, 0x34495e, 0x3d3d45, 0x6b5b4b]), 0.09 * s, 0.45 * s, 0);
  }
  const torso = mk(new THREE.CapsuleGeometry(0.2 * s, 0.45 * s, 6, 12), top, 0, (opts.seated ? 0.75 : 1.15) * s, 0);
  torso.scale.z = 0.7;
  mk(new THREE.SphereGeometry(0.15 * s, 16, 12), skin, 0, (opts.seated ? 1.22 : 1.62) * s, 0.01);
  const hair = mk(new THREE.SphereGeometry(0.158 * s, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), rng.pick([0x1c1716, 0x3b261a, 0x6e4529, 0xd2aa6a, 0x9a9a9a]), 0, (opts.seated ? 1.24 : 1.64) * s, -0.01);
  void hair;
  for (const sx of [-1, 1]) mk(new THREE.CapsuleGeometry(0.05 * s, 0.5 * s, 4, 8), top, sx * 0.25 * s, (opts.seated ? 0.72 : 1.12) * s, 0);
  return g;
}

function godRay(from, to, width, color, opacity) {
  const len = from.distanceTo(to);
  const tex = canvasTexture(64, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const gx = g.createLinearGradient(0, 0, w, 0);
    gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(0.3, 'rgba(0,0,0,0)'); gx.addColorStop(0.7, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = gx; g.fillRect(0, 0, w, h);
  });
  const m = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const geo = new THREE.CylinderGeometry(width * 0.5, width * 1.4, len, 16, 1, true);
  geo.translate(0, -len / 2, 0);
  // map v along the length
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.copy(from);
  mesh.lookAt(to);
  mesh.rotateX(-Math.PI / 2);
  mesh.renderOrder = 10;
  return mesh;
}

export class Environment {
  constructor(renderer, spec) {
    this.spec = spec;
    this.key = `${spec.setting}|${spec.time}|${spec.weather}`;
    this.group = new THREE.Group();
    this.group.name = 'env:' + this.key;
    this.updaters = [];
    this.seats = [];
    this.marks = {}; // named staging spots
    this.interior = false;
    this.grade = {};
    this.heightAt = () => 0;
    const rng = makeRng(spec.seed ?? 1234);
    this.rng = rng;
    const preset = applyWeather(TIME_PRESETS[spec.time] || TIME_PRESETS.day, spec.weather);
    this.preset = preset;
    this.night = spec.time === 'night';

    const builder = BUILDERS[spec.setting] || BUILDERS.meadow;
    this._lights(preset);
    builder(this, rng, preset);
    this._finish(renderer, preset);
  }

  add(o, x = 0, y = 0, z = 0, ry = 0, s = 1) {
    o.position.set(x, y + (this.groundY ? this.heightAt(x, z) : 0), z);
    o.rotation.y = ry;
    if (typeof s === 'number') o.scale.setScalar(s); else o.scale.set(s[0], s[1], s[2]);
    this.group.add(o);
    return o;
  }

  _lights(preset) {
    const sun = new THREE.DirectionalLight(preset.sun, preset.sunI);
    const dir = sunDirection(preset);
    this.sunDir = dir;
    sun.position.copy(dir).multiplyScalar(30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12; sc.near = 1; sc.far = 80;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 5;
    this.group.add(sun, sun.target);
    this.sun = sun;
    const hemi = new THREE.HemisphereLight(preset.hemiSky, preset.hemiGround, preset.hemiI);
    this.group.add(hemi);
    this.hemi = hemi;
    // character fill & rim (follow the camera; positioned per shot by the director)
    this.fill = new THREE.DirectionalLight(0xffffff, 0.0);
    this.rim = new THREE.DirectionalLight(spec_rim(preset), 1.6);
    this.group.add(this.fill, this.fill.target, this.rim, this.rim.target);
  }

  _finish(renderer, preset) {
    // sky
    if (!this.interior) {
      this.skyMat = makeSkyMaterial(preset);
      this.skyMat.uniforms.sunDir.value.copy(this.sunDir);
      const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), this.skyMat);
      sky.frustumCulled = false;
      sky.renderOrder = -10;
      this.group.add(sky);
      this.sky = sky;
      this.updaters.push((t) => { this.skyMat.uniforms.time.value = t; });
    }
    this.fog = this.customFog || new THREE.FogExp2(preset.fog, preset.fogDensity ?? this.fogDensity ?? 0.012);
    this.background = this.interior ? new THREE.Color(this.bgColor ?? 0x1a1410) : null;
    // image-based light from a tiny version of this world
    const pmrem = new THREE.PMREMGenerator(renderer);
    let envScene;
    if (this.interior) {
      envScene = new RoomEnvironment();
      if (this.envTint) envScene.traverse((o) => { if (o.isMesh && o.material && o.material.color) o.material.color.multiply(new THREE.Color(this.envTint)); });
    } else {
      envScene = new THREE.Scene();
      const s = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), makeSkyMaterial({ ...preset, clouds: 0.2 }));
      s.material.uniforms.sunDir.value.copy(this.sunDir);
      envScene.add(s);
      const gnd = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.groundColor ?? preset.ground).multiplyScalar(0.6) }));
      gnd.rotation.x = -Math.PI / 2; gnd.position.y = -2;
      envScene.add(gnd);
    }
    this.envMap = pmrem.fromScene(envScene, 0.03).texture;
    pmrem.dispose();
    this.envIntensity = this.envIntensityOverride ?? preset.envI;
    this.exposure = this.grade.exposure ?? preset.exposure;
  }

  // Swap the procedural light probe for a real HDRI, normalised to this world's brightness.
  async loadHDRI(renderer) {
    const [setting, time] = this.key.split('|');
    const r = await loadHDRI(renderer, pickHDRI(setting, time, this.interior));
    if (!r) return;
    this.envMap = r.texture;
    this.envIntensity = (this.envIntensityOverride ?? this.envIntensity) * Math.min(3, 0.45 / Math.max(0.02, r.mean));
    if (this._scene) { this._scene.environment = this.envMap; this._scene.environmentIntensity = this.envIntensity; }
  }

  attach(scene) {
    this._scene = scene;
    scene.add(this.group);
    scene.fog = this.fog;
    scene.background = this.background;
    scene.environment = this.envMap;
    scene.environmentIntensity = this.envIntensity;
  }

  detach(scene) { scene.remove(this.group); this._scene = null; }

  update(t) { for (const u of this.updaters) u(t); }

  // Point the shadow frustum and the character fill/rim at the action.
  frame(center, camPos) {
    const c = center || v3();
    this.sun.position.copy(c).addScaledVector(this.sunDir, 30);
    this.sun.target.position.copy(c);
    if (camPos) {
      const toCam = camPos.clone().sub(c).setY(0).normalize();
      this.fill.position.copy(c).addScaledVector(toCam, 10).add(v3(0, 4, 0));
      this.fill.target.position.copy(c);
      this.fill.intensity = this.fillIntensity ?? 0.6;
      this.fill.color.set(this.fillColor ?? 0xdde8ff);
      const side = v3(-toCam.z, 0, toCam.x);
      this.rim.position.copy(c).addScaledVector(toCam, -10).addScaledVector(side, 4).add(v3(0, 5, 0));
      this.rim.target.position.copy(c);
      this.rim.intensity = this.rimIntensity ?? 2.2;
    }
  }
}

function spec_rim(preset) {
  return new THREE.Color(preset.sun).lerp(new THREE.Color(0xffffff), 0.3).getHex();
}

// ---- helpers used by builders -------------------------------------------------------
const GROUND_SCAN = (setting) => /beach|desert|island/.test(setting) ? 'coast_sand_01' : /forest|jungle|camp|woods/.test(setting) ? 'forest_ground_04' : /city|street|market|town|school|village/.test(setting) ? 'cobblestone_01' : 'grass_path_2';
function groundFor(env, opts) {
  const g = makeGround(opts);
  const kind = GROUND_SCAN((env.key || '').split('|')[0]);
  // scanned detail multiplied over the painted ground colours
  g.material = surfaceMat(kind, kind === 'cobblestone_01' ? 60 : 45, kind === 'cobblestone_01' ? 60 : 45, { vertexColors: true, brighten: kind === 'grass_path_2' ? 2.2 : kind === 'forest_ground_04' ? 2.0 : 1.5, clearcoat: opts.wet ? 0.6 : 0 });
  env.group.add(g);
  env.heightAt = g.userData.heightAt;
  env.groundColor = opts.color;
  return g;
}

function scatter(env, rng, count, rMin, rMax, fn, opts = {}) {
  for (let i = 0; i < count; i++) {
    const a = opts.arc ? rng.range(opts.arc[0], opts.arc[1]) : rng() * Math.PI * 2;
    const d = rng.range(rMin, rMax);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (opts.keepOut && Math.abs(x) < opts.keepOut[0] && z > opts.keepOut[1]) continue;
    const o = fn(rng, i);
    o.position.set(x, env.heightAt(x, z), z);
    o.rotation.y = rng() * Math.PI * 2;
    env.group.add(o);
  }
}

function hillsBackdrop(env, rng, color, count = 10) {
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + rng.range(-1.6, 1.6);
    const d = rng.range(55, 80);
    const r = rng.range(14, 26);
    const m = new THREE.Mesh(P.blobGeometry(r, rng, { top: color[0], bottom: color[1], detail: 3, bump: 0.08 }), mat(0xffffff, { vertexColors: true, roughness: 0.95 }));
    m.scale.y = rng.range(0.35, 0.55);
    m.position.set(Math.cos(a) * d, -r * 0.2, Math.sin(a) * d);
    env.group.add(m);
  }
}

function mountainsBackdrop(env, rng, snowy = true, count = 9) {
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + rng.range(-1.4, 1.4);
    const d = rng.range(70, 110);
    const h = rng.range(25, 45);
    const geo = new THREE.ConeGeometry(h * 0.9, h, 9, 6);
    const pos = geo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k) / h + 0.5;
      const n = 1 + 0.12 * Math.sin(pos.getX(k) * 0.4 + i) * Math.cos(pos.getZ(k) * 0.3);
      pos.setX(k, pos.getX(k) * n); pos.setZ(k, pos.getZ(k) * n);
      const c = snowy && y > 0.68 + 0.05 * Math.sin(pos.getX(k)) ? new THREE.Color(0xf4f7fb) : new THREE.Color(0x6a7a8a).lerp(new THREE.Color(0x8a9aa8), y);
      cols.set([c.r, c.g, c.b], k * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat(0xffffff, { vertexColors: true, roughness: 0.9, flat: true }));
    m.position.set(Math.cos(a) * d, h / 2 - 3, Math.sin(a) * d);
    env.group.add(m);
  }
}

function bokehLights(env, rng, count, area, colors, size = 0.12) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const c = new THREE.Color(rng.pick(colors)).multiplyScalar(rng.range(2, 5));
    const m = new THREE.Mesh(new THREE.SphereGeometry(size * rng.range(0.6, 1.4), 8, 6), new THREE.MeshBasicMaterial({ color: c, toneMapped: true }));
    m.position.set(rng.range(area[0], area[1]), rng.range(area[2], area[3]), rng.range(area[4], area[5]));
    g.add(m);
  }
  env.group.add(g);
  return g;
}

function room(env, rng, o) {
  // floor + walls; o: {w, d, h, floor, wall, wallTex, floorTex, z0}
  const g = new THREE.Group();
  const { w, d, h } = o;
  const zc = o.zc ?? -d / 2 + 6;
  const floorM = o.floorKind ? surfaceMat(o.floorKind, w / (o.floorTile ?? 2), d / (o.floorTile ?? 2), { clearcoat: o.polish ?? 0.25, tint: o.floorTint, brighten: o.floorBright ?? 1.1 })
    : o.floorTex ? surfaceMat('wood_floor', w / 2.2, d / 2.2, { clearcoat: o.polish ?? 0.3, brighten: 1.15 }) : surfaceMat('marble_01', w / 2, d / 2, { tint: o.floor, brighten: 1.1, clearcoat: 0.2 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorM);
  floor.rotation.x = -Math.PI / 2; floor.position.z = zc; floor.receiveShadow = true;
  g.add(floor);
  const wallM = o.wallTex ? mat(0xffffff, { map: o.wallTex, roughness: 0.9 }) : surfaceMat('grey_plaster', Math.max(w, d) / 3, h / 3, { tint: o.wall, brighten: 1.85, normalScale: 0.35 });
  const mk = (W, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(W, h), wallM); m.position.set(x, h / 2, z); m.rotation.y = ry; m.receiveShadow = true; g.add(m); return m; };
  mk(w, 0, zc - d / 2, 0);
  mk(d, -w / 2, zc, Math.PI / 2);
  mk(d, w / 2, zc, -Math.PI / 2);
  mk(w, 0, zc + d / 2, Math.PI);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(o.ceiling ?? 0xf2ece0, { roughness: 0.9 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, h, zc);
  g.add(ceil);
  // baseboards
  const bb = mat(o.trim ?? 0xf6f1e8, { roughness: 0.6 });
  for (const [W, x, z, ry] of [[w, 0, zc - d / 2 + 0.03, 0], [d, -w / 2 + 0.03, zc, Math.PI / 2], [d, w / 2 - 0.03, zc, -Math.PI / 2]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(W, 0.14, 0.04), bb); b.position.set(x, 0.07, z); b.rotation.y = ry; g.add(b);
  }
  env.group.add(g);
  env.interior = true;
  return g;
}

function plankTexture(base = '#9a6a42') {
  return canvasTexture(512, 512, (g, w, h) => {
    const r = makeRng(5);
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Color(base).multiplyScalar(r.range(0.85, 1.12));
      g.fillStyle = '#' + c.getHexString();
      g.fillRect(0, i * 64, w, 64);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, i * 64, w, 2);
      const off = r() * w; g.fillRect(off, i * 64, 2, 64);
      g.globalAlpha = 0.08; g.fillStyle = '#000';
      for (let k = 0; k < 20; k++) g.fillRect(0, i * 64 + r() * 64, w, 1);
      g.globalAlpha = 1;
    }
  });
}

function windowLightPlane(env, x, y, z, w, h, ry, color, intensity = 2.5) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: true }));
  m.position.set(x, y, z); m.rotation.y = ry;
  env.group.add(m);
  // frame
  const fm = mat(0xf6f1e8, { roughness: 0.6 });
  for (const [ww, hh, dx, dy] of [[w + 0.2, 0.1, 0, h / 2], [w + 0.2, 0.1, 0, -h / 2], [0.1, h, w / 2, 0], [0.1, h, -w / 2, 0], [0.06, h, 0, 0], [w, 0.06, 0, 0]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(ww, hh, 0.08), fm);
    f.position.set(dx, dy, 0.03);
    m.add(f);
  }
  return m;
}

function pointGlow(env, x, y, z, color, intensity, dist, glowSize = 0.6) {
  const pl = new THREE.PointLight(color, intensity, dist, 1.8);
  pl.position.set(x, y, z);
  env.group.add(pl);
  if (glowSize > 0) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.set(glowSize, glowSize, 1);
    s.position.set(x, y, z);
    env.group.add(s);
  }
  return pl;
}

// ---- builders -----------------------------------------------------------------------
const BUILDERS = {
  meadow(env, rng, pre) {
    groundFor(env, { color: 0x5f9e3c, color2: 0x86bf55, color3: 0xa8c95a, hills: 3, flatRadius: 10 });
    hillsBackdrop(env, rng, [0x8cc46a, 0x4f8a3c], 12);
    const grass = grassField(rng, { count: 14000, outer: 30, heightAt: env.heightAt, height: 0.3 });
    env.group.add(grass); env.updaters.push(grass.userData.update);
    scatter(env, rng, 9, 13, 34, (r) => P.tree(r), { arc: [-Math.PI * 0.95, -Math.PI * 0.05] });
    scatter(env, rng, 5, 14, 30, (r) => P.tree(r), { arc: [0.3, Math.PI - 0.3] });
    scatter(env, rng, 10, 6, 24, (r) => P.bush(r, { flowers: r() < 0.5 }), { keepOut: [5, 2] });
    for (let i = 0; i < 9; i++) { const a = rng() * Math.PI * 2, d = rng.range(3.5, 16); env.add(P.flowerPatch(rng, 22, 1.2), Math.cos(a) * d, env.heightAt(Math.cos(a) * d, Math.sin(a) * d), Math.sin(a) * d); }
    scatter(env, rng, 6, 8, 25, (r) => P.rock(r));
    const b = env.add(P.bench(), -3.2, 0, -3.5, 0.35);
    env.seats.push({ pos: v3(-3.2, 0, -3.3), ry: 0.35, h: 0.47, obj: b });
    env.add(P.lampPost(env.night), 3.8, 0, -3.8);
    for (let i = 0; i < 6; i++) env.add(P.cloudPuff(rng, rng.range(2, 4), new THREE.Color(pre.cloud).getHex()), rng.range(-60, 60), rng.range(28, 40), rng.range(-120, -60));
    env.grade = { bloom: 0.3 };
  },
  forest(env, rng, pre) {
    groundFor(env, { color: 0x4a7a35, color2: 0x6a8f3c, color3: 0x7a6a45, hills: 2, flatRadius: 7 });
    const grass = grassField(rng, { count: 9000, outer: 22, heightAt: env.heightAt, height: 0.25, color: 0x5a9a3a });
    env.group.add(grass); env.updaters.push(grass.userData.update);
    scatter(env, rng, 26, 8, 30, (r) => (r() < 0.55 ? P.tree(r, { height: r.range(5, 8), palette: [[0x6fae4a, 0x24502e], [0x7fbf55, 0x2a5a32]][r.int(0, 1)] }) : P.pine(r, { height: r.range(6, 9) })), { arc: [-Math.PI, 0] });
    scatter(env, rng, 12, 9, 26, (r) => P.tree(r, { height: r.range(5, 8) }), { arc: [0.2, Math.PI - 0.2] });
    scatter(env, rng, 16, 4, 18, (r) => P.bush(r, { top: 0x7cba55, bottom: 0x2a5530 }), { keepOut: [4, 1] });
    for (let i = 0; i < 12; i++) { const a = rng.range(-Math.PI, 0), d = rng.range(3, 12); env.add(P.makeProp('mushroom', rng, { scale: rng.range(0.6, 1.6) }), Math.cos(a) * d, 0, Math.sin(a) * d); }
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 2.4, 14), mat(0x6b4a32, { roughness: 0.9 }));
    log.rotation.z = Math.PI / 2; log.castShadow = true;
    env.add(log, 2.6, 0.3, -2.6, 0.4);
    env.seats.push({ pos: v3(2.6, 0, -2.2), ry: 0.4, h: 0.58 });
    scatter(env, rng, 8, 5, 20, (r) => P.rock(r, { top: 0x8a9a7a, bottom: 0x5a6a52 }));
    // sun shafts between the trees
    if (!env.night) for (let i = 0; i < 4; i++) env.group.add(godRay(v3(rng.range(-8, 8) + env.sunDir.x * 18, 22, -6 + rng.range(-6, 2) + env.sunDir.z * 18), v3(rng.range(-5, 5), 0, rng.range(-6, 1)), 2.2, 0xfff0c8, 0.07));
    env.fogDensity = env.night ? 0.03 : 0.022;
    env.grade = { bloom: 0.35 };
  },
  beach(env, rng, pre) {
    groundFor(env, { color: 0xe8d3a6, color2: 0xf2e2bc, color3: 0xd9c08f, hills: 0.8, flatRadius: 12, roughness: 0.95 });
    // ocean
    const og = new THREE.PlaneGeometry(400, 220, 200, 100);
    og.rotateX(-Math.PI / 2);
    const om = new THREE.MeshPhysicalMaterial({ color: 0x1f8fb0, roughness: 0.08, metalness: 0, clearcoat: 1, transmission: 0, sheen: 0.3, sheenColor: 0xaee8ff });
    const uT = { value: 0 };
    om.onBeforeCompile = (sh) => {
      sh.uniforms.uT = uT;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uT;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float wv = sin(position.x * 0.15 + uT * 1.2) * 0.25 + sin(position.z * 0.22 + uT * 0.9) * 0.2 + sin((position.x + position.z) * 0.6 + uT * 2.0) * 0.06;
          transformed.y += wv;`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          float dx = cos(position.x * 0.15 + uT * 1.2) * 0.0375 + cos((position.x + position.z) * 0.6 + uT * 2.0) * 0.036;
          float dz = cos(position.z * 0.22 + uT * 0.9) * 0.044 + cos((position.x + position.z) * 0.6 + uT * 2.0) * 0.036;
          objectNormal = normalize(vec3(-dx, 1.0, -dz));`);
    };
    om.customProgramCacheKey = () => 'ocean';
    const ocean = new THREE.Mesh(og, om);
    ocean.position.set(0, -0.15, -125);
    env.group.add(ocean);
    env.updaters.push((t) => { uT.value = t; });
    // foam line
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(400, 1.2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
    foam.rotation.x = -Math.PI / 2; foam.position.set(0, 0.02, -15.5);
    env.group.add(foam);
    env.updaters.push((t) => { foam.position.z = -15.5 + Math.sin(t * 0.8) * 0.6; foam.material.opacity = 0.45 + Math.sin(t * 0.8) * 0.15; });
    scatter(env, rng, 7, 8, 22, (r) => P.palm(r), { arc: [-Math.PI * 0.95, -Math.PI * 0.55] });
    scatter(env, rng, 5, 8, 22, (r) => P.palm(r), { arc: [-Math.PI * 0.45, -Math.PI * 0.05] });
    scatter(env, rng, 4, 10, 20, (r) => P.palm(r), { arc: [0.4, Math.PI - 0.4] });
    env.add(P.makeProp('umbrella', rng), -4, 0, -2.5, 0, 2.2);
    const towel = new THREE.Mesh(new RoundedBoxGeometry(1, 0.02, 1.9, 2, 0.01), mat(0xf26b5b, { roughness: 0.9 }));
    env.add(towel, -3.6, 0.01, -1.6, 0.3);
    for (let i = 0; i < 8; i++) env.add(P.makeProp('shell', rng), rng.range(-6, 6), 0, rng.range(-8, 4));
    for (let i = 0; i < 4; i++) env.add(P.cloudPuff(rng, rng.range(2, 4), new THREE.Color(pre.cloud).getHex()), rng.range(-80, 80), rng.range(25, 40), rng.range(-160, -90));
    env.fogDensity = 0.006;
    env.grade = { bloom: 0.3, saturation: 1.12 };
  },
  underwater(env, rng, pre) {
    groundFor(env, { color: 0xd8c79a, color2: 0xc9b483, hills: 2.5, flatRadius: 8 });
    env.customFog = new THREE.FogExp2(0x1f6f9a, 0.045);
    env.preset.zenith = 0x1a6fa0; env.preset.horizon = 0x2a8fb8; env.preset.ground = 0x1a4a6a;
    env.sun.color.set(0x9fe0ff); env.sun.intensity = 2.2;
    env.hemi.color.set(0x6fd0ff); env.hemi.groundColor.set(0x1a4a6a); env.hemi.intensity = 0.8;
    const coralCols = [0xff6f91, 0xffa94d, 0xb388ff, 0xff4f6f, 0xffd84d, 0x4fd8c8];
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2, d = rng.range(3.5, 22);
      const c = new THREE.Group();
      const col = rng.pick(coralCols);
      for (let k = 0; k < 6; k++) {
        const br = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, rng.range(0.3, 0.9), 4, 8), mat(col, { roughness: 0.7, sheen: 0.5 }));
        br.position.set(rng.range(-0.2, 0.2), 0.3, rng.range(-0.2, 0.2));
        br.rotation.set(rng.range(-0.6, 0.6), 0, rng.range(-0.6, 0.6));
        c.add(br);
      }
      env.add(c, Math.cos(a) * d, 0, Math.sin(a) * d);
    }
    // swaying seaweed
    const weeds = [];
    for (let i = 0; i < 30; i++) {
      const a = rng() * Math.PI * 2, d = rng.range(4, 20);
      const h = rng.range(1.5, 4);
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.08, h, 6, 8), mat(0x3f9a4a, { roughness: 0.6 }));
      w.geometry.translate(0, h / 2, 0);
      env.add(w, Math.cos(a) * d, 0, Math.sin(a) * d);
      weeds.push([w, rng() * 6]);
    }
    env.updaters.push((t) => { for (const [w, ph] of weeds) { w.rotation.z = Math.sin(t * 0.9 + ph) * 0.15; w.rotation.x = Math.cos(t * 0.7 + ph) * 0.1; } });
    scatter(env, rng, 12, 5, 20, (r) => P.rock(r, { top: 0x7a8a8a, bottom: 0x4a5a5a }));
    // fish schools
    const fishG = new THREE.Group();
    const fish = [];
    for (let i = 0; i < 40; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat(rng.pick([0xffa94d, 0xffd84d, 0x4fd8ff, 0xff6f91]), { roughness: 0.4, clearcoat: 0.6 }));
      f.scale.set(0.5, 0.8, 1.6);
      fishG.add(f);
      fish.push([f, rng() * 6.28, rng.range(5, 14), rng.range(1, 5), rng.range(0.2, 0.5)]);
    }
    env.group.add(fishG);
    env.updaters.push((t) => { for (const [f, ph, r, y, sp] of fish) { const a = ph + t * sp; f.position.set(Math.cos(a) * r, y + Math.sin(t + ph) * 0.3, Math.sin(a) * r - 6); f.rotation.y = -a; } });
    for (let i = 0; i < 5; i++) env.group.add(godRay(v3(rng.range(-10, 10), 25, rng.range(-15, 0)), v3(rng.range(-6, 6), 0, rng.range(-8, 2)), 2.5, 0xbff0ff, 0.09));
    env.grade = { bloom: 0.45, saturation: 1.1, shadowTint: new THREE.Color(0.85, 1.0, 1.1), highlightTint: new THREE.Color(0.95, 1.05, 1.05) };
  },
  city(env, rng, pre) {
    const night = env.night;
    groundFor(env, { color: 0x6a6a70, color2: 0x7a7a80, hills: 0, flatRadius: 100, roughness: night ? 0.35 : 0.8, wet: night || env.spec.weather === 'rain' });
    // street: z axis, sidewalks at |x| 4..6
    const road = new THREE.Mesh(new THREE.PlaneGeometry(8, 160), surfaceMat('asphalt_02', 2, 40, { roughness: night ? 0.5 : 1, clearcoat: night ? 0.7 : 0, brighten: 0.9 }));
    road.rotation.x = -Math.PI / 2; road.position.set(0, 0.01, -40); road.receiveShadow = true;
    env.group.add(road);
    for (let z = 10; z > -110; z -= 6) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 2.5), mat(0xf2f0e6)); l.rotation.x = -Math.PI / 2; l.position.set(0, 0.02, z); env.group.add(l); }
    for (const sx of [-1, 1]) {
      const walk = new THREE.Mesh(new RoundedBoxGeometry(3, 0.16, 160, 2, 0.05), mat(0xa8a49c, { roughness: 0.8 }));
      walk.position.set(sx * 5.5, 0.08, -40); walk.receiveShadow = true; env.group.add(walk);
      for (let z = 8, i = 0; z > -110; i++) {
        const w = rng.range(5, 8);
        const b = P.building(rng, { w, d: 6, h: rng.range(8, 22) + (z < -40 ? 10 : 0), night, vertical: rng() < 0.5 });
        env.add(b, sx * 10.2, 0, z - w / 2, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
        z -= w + 0.3;
      }
      for (let z = 4; z > -90; z -= 9) env.add(P.lampPost(night, { light: z > -30 }), sx * 4.3, 0.16, z);
    }
    // parked cars
    for (let i = 0; i < 6; i++) env.add(P.makeProp('car', rng, { night }), (i % 2 ? 1 : -1) * 3.1, 0, -8 - i * 9, 0);
    // string lights across the street and far away lights for bokeh
    for (let z = -4; z > -60; z -= 8) env.group.add(P.stringLights(v3(-8.5, 6.5, z), v3(8.5, 6.5, z - 2), 18, night));
    if (night) bokehLights(env, rng, 160, [-12, 12, 2, 16, -110, -25], [0xff4fa3, 0x4fd8ff, 0xffd84f, 0xff7a3d, 0xffe2a8, 0xb38cff], 0.18);
    // background pedestrians
    for (let i = 0; i < 18; i++) env.add(extra(rng), rng.range(-5.5, 5.5), 0, rng.range(-30, -7), rng() * Math.PI * 2);
    env.fogDensity = night ? 0.014 : 0.01;
    env.fillIntensity = night ? 0.9 : 0.6;
    env.fillColor = night ? 0xb8c8ff : 0xdde8ff;
    env.rimIntensity = night ? 3.2 : 2.0;
    env.grade = night ? { bloom: 0.75, bloomThreshold: 1.2, saturation: 1.15, exposure: 1.25, shadowTint: new THREE.Color(0.9, 0.95, 1.12), highlightTint: new THREE.Color(1.08, 0.98, 0.95) } : { bloom: 0.3 };
    env.marks.street = true;
  },
  market(env, rng, pre) {
    const night = env.night;
    groundFor(env, { color: 0xb59a7a, color2: 0xa88f70, hills: 0, flatRadius: 100, roughness: 0.85 });
    for (const sx of [-1, 1]) {
      for (let z = 4, i = 0; z > -60; i++) {
        const b = P.house(rng, { w: 5, d: 5, h: rng.range(4, 7), night });
        env.add(b, sx * 11, 0, z, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
        z -= 5.4;
      }
      for (let z = 1; z > -40; z -= 3.4) env.add(P.stall(rng), sx * 5.3, 0, z + rng.range(-0.4, 0.4), sx > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
    for (let z = 0; z > -45; z -= 5) env.group.add(P.bunting(v3(-8, 5.5, z), v3(8, 5.5, z - 1.5), 16, rng));
    for (let z = -2; z > -45; z -= 7) env.group.add(P.stringLights(v3(-8, 6, z), v3(8, 6, z - 1), 16, night || pre === TIME_PRESETS.sunset));
    for (let i = 0; i < 24; i++) env.add(extra(rng), rng.range(-3.5, 3.5), 0, rng.range(-35, -5), rng() * Math.PI * 2);
    if (night) bokehLights(env, rng, 100, [-10, 10, 2, 8, -60, -15], [0xffe2a8, 0xffc46b, 0xff7a3d], 0.15);
    env.fogDensity = 0.012;
    env.grade = { bloom: night ? 0.6 : 0.35, saturation: 1.12, highlightTint: new THREE.Color(1.1, 1.0, 0.88) };
  },
  village(env, rng, pre) {
    groundFor(env, { color: 0x6fa84a, color2: 0x8fbf5a, hills: 2, flatRadius: 10 });
    hillsBackdrop(env, rng, [0x8cc46a, 0x4f8a3c], 8);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 80), mat(0xc8b08a, { roughness: 0.95 }));
    path.rotation.x = -Math.PI / 2; path.position.set(0, 0.015, -30); env.group.add(path);
    const grass = grassField(rng, { count: 9000, inner: 2.5, outer: 26, height: 0.25 });
    env.group.add(grass); env.updaters.push(grass.userData.update);
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) env.add(P.house(rng, { night: env.night }), sx * rng.range(7, 9), 0, -4 - i * 9, sx > 0 ? -Math.PI / 2 + 0.2 : Math.PI / 2 - 0.2);
    for (const sx of [-1, 1]) env.add(P.fence(10), sx * 3.2, 0, -7, Math.PI / 2);
    scatter(env, rng, 10, 14, 32, (r) => P.tree(r));
    for (let i = 0; i < 4; i++) env.add(P.lampPost(env.night, { light: i < 2 }), (i % 2 ? 2.2 : -2.2), 0, -2 - i * 8);
    scatter(env, rng, 8, 4, 16, (r) => P.bush(r, { flowers: true }), { keepOut: [3, -100] });
    env.grade = { bloom: 0.35 };
  },
  farm(env, rng, pre) {
    groundFor(env, { color: 0x7aa84a, color2: 0x9abf5a, color3: 0xc8b06a, hills: 3, flatRadius: 10 });
    hillsBackdrop(env, rng, [0xa8c86a, 0x6a8a3c], 10);
    const grass = grassField(rng, { count: 10000, outer: 26, height: 0.32 });
    env.group.add(grass); env.updaters.push(grass.userData.update);
    // barn
    const barn = new THREE.Group();
    barn.add(new THREE.Mesh(new RoundedBoxGeometry(8, 5, 7, 2, 0.08), mat(0xb03a2e, { roughness: 0.8 })));
    barn.children[0].position.y = 2.5;
    const roofShape = new THREE.Shape(); roofShape.moveTo(-4.4, 0); roofShape.lineTo(-2.5, 2); roofShape.lineTo(2.5, 2); roofShape.lineTo(4.4, 0); roofShape.lineTo(-4.4, 0);
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: 7.6, bevelEnabled: false }), mat(0x5a4a42, { roughness: 0.8 }));
    roof.position.set(0, 5, -3.8); barn.add(roof);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(3, 3.6), mat(0xf6f1e8)); door.position.set(0, 1.8, 3.51); barn.add(door);
    P.shadowed(barn);
    env.add(barn, -6, 0, -14, 0.35);
    env.add(P.fence(12, 0xe8dcc8), 4, 0, -6, 0.1);
    for (let i = 0; i < 5; i++) { const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.2, 20), mat(0xe2c06a, { roughness: 0.95 })); hb.rotation.z = Math.PI / 2; hb.castShadow = true; env.add(hb, 5 + i * 1.6, 0.7, -9 - (i % 2) * 1.5); }
    // windmill
    const wm = new THREE.Group();
    wm.add(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 8, 12), mat(0xe8e2d4)));
    wm.children[0].position.y = 4;
    const blades = new THREE.Group(); blades.position.set(0, 8, 1.1);
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4, 0.08), mat(0xf6f1e8)); b.position.y = 2; const p = new THREE.Group(); p.rotation.z = i * Math.PI / 2; p.add(b); blades.add(p); }
    wm.add(blades);
    env.add(wm, 14, 0, -22, -0.4);
    env.updaters.push((t) => { blades.rotation.z = t * 0.5; });
    scatter(env, rng, 8, 16, 34, (r) => P.tree(r));
    env.grade = { bloom: 0.3, highlightTint: new THREE.Color(1.08, 1.0, 0.9) };
  },
  home(env, rng, pre) {
    const bedroom = /bed|bedroom|sleep|bedtime/.test(env.spec.text || '');
    room(env, rng, { w: 12, d: 12, h: 3.6, floorTex: plankTexture('#a0704a'), wall: rng.pick([0xf2e3c9, 0xdfe8ef, 0xf3d9c9, 0xe5ecd9]), zc: 0 });
    env.bgColor = 0x2a2018;
    windowLightPlane(env, -2.2, 1.9, -5.95, 2.0, 1.6, 0, env.night ? 0x2a3a6a : 0xdff0ff, env.night ? 1.0 : 3.0);
    windowLightPlane(env, 2.2, 1.9, -5.95, 2.0, 1.6, 0, env.night ? 0x2a3a6a : 0xdff0ff, env.night ? 1.0 : 3.0);
    // rug, sofa, lamp, shelf, plant, pictures
    const rug = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), mat(0xc0603a, { roughness: 0.95, map: canvasTexture(256, 256, (g, w, h) => { g.fillStyle = '#c86a4a'; g.fillRect(0, 0, w, h); for (let r = 120; r > 10; r -= 18) { g.strokeStyle = r % 36 ? '#f2d0a0' : '#8a3a2a'; g.lineWidth = 6; g.beginPath(); g.arc(128, 128, r, 0, 6.3); g.stroke(); } }) }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.01, -0.5); rug.receiveShadow = true; env.group.add(rug);
    if (bedroom) {
      const bed = new THREE.Group();
      bed.add(new THREE.Mesh(new RoundedBoxGeometry(2.0, 0.45, 2.4, 3, 0.08), mat(0x8b5a2b, { roughness: 0.6 })));
      bed.children[0].position.y = 0.25;
      const blanket = new THREE.Mesh(new RoundedBoxGeometry(2.05, 0.18, 1.8, 3, 0.08), fabric(0x6f9fd8, { knit: true }));
      blanket.position.set(0, 0.55, 0.3); bed.add(blanket);
      const pillow = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.2, 0.5, 3, 0.09), fabric(0xffffff));
      pillow.position.set(0, 0.6, -0.85); bed.add(pillow);
      const head = new THREE.Mesh(new RoundedBoxGeometry(2.1, 1.2, 0.12, 3, 0.05), mat(0x6b4a32)); head.position.set(0, 0.6, -1.2); bed.add(head);
      P.shadowed(bed);
      env.add(bed, -2.8, 0, -4.2, 0);
      env.marks.bed = { pos: v3(-2.8, 0.62, -4.4), ry: 0 };
    }
    const sofa = new THREE.Group();
    const sm = fabric(rng.pick([0x4a6a8a, 0x8a4a4a, 0x5a7a5a, 0xc8a06a]));
    sofa.add(new THREE.Mesh(new RoundedBoxGeometry(2.6, 0.45, 0.95, 3, 0.12), sm)); sofa.children[0].position.y = 0.32;
    const back = new THREE.Mesh(new RoundedBoxGeometry(2.6, 0.7, 0.3, 3, 0.12), sm); back.position.set(0, 0.75, -0.35); sofa.add(back);
    for (const x of [-1.3, 1.3]) { const arm = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.6, 0.95, 3, 0.12), sm); arm.position.set(x, 0.5, 0); sofa.add(arm); }
    P.shadowed(sofa);
    env.add(sofa, bedroom ? 3.0 : 0, 0, -4.6, 0);
    env.seats.push({ pos: v3(bedroom ? 2.6 : -0.6, 0, -4.4), ry: 0, h: 0.55 }, { pos: v3(bedroom ? 3.4 : 0.6, 0, -4.4), ry: 0, h: 0.55 });
    const lamp = new THREE.Group();
    lamp.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.15, 1.6, 8), mat(0x2b2f36)));
    lamp.children[0].position.y = 0.8;
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.38, 0.4, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffc77a, emissiveIntensity: env.night ? 1.6 : 0.4, side: THREE.DoubleSide }));
    shade.position.y = 1.7; lamp.add(shade);
    env.add(lamp, -2.2, 0, -4.8);
    pointGlow(env, -2.2, 1.6, -4.6, 0xffc77a, env.night ? 9 : 3, 9, 0);
    const shelf = new THREE.Group();
    shelf.add(new THREE.Mesh(new RoundedBoxGeometry(1.6, 2.2, 0.4, 2, 0.03), mat(0x8b5a2b)));
    shelf.children[0].position.y = 1.1;
    for (let r = 0; r < 4; r++) for (let i = 0; i < 7; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.15, rng.range(0.25, 0.4), 0.28), mat(rng.pick([0xd9443b, 0x3a6fb5, 0xf2b33d, 0x2f8f6a, 0x8a4fd0, 0xf2f2f2]))); b.position.set(-0.6 + i * 0.19, 0.3 + r * 0.5, 0.05); shelf.add(b); }
    P.shadowed(shelf);
    env.add(shelf, 5.2, 0, -2.5, -Math.PI / 2);
    const plant = P.bush(rng, { r: 0.45 }); plant.position.y = 0.45;
    const pot = new THREE.Group(); pot.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.5, 16), mat(0xd9764f))); pot.children[0].position.y = 0.25; pot.add(plant);
    env.add(pot, -5.0, 0, -5.0);
    for (let i = 0; i < 3; i++) {
      const pic = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.04), [mat(0x6b4a32), mat(0x6b4a32), mat(0x6b4a32), mat(0x6b4a32), mat(0xffffff, { map: canvasTexture(128, 100, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, ['#8ec5f2', '#f2c18e', '#a6d98e'][i]); gr.addColorStop(1, ['#4f8a3c', '#c0603a', '#3a6fb5'][i]); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#fff8'; g.beginPath(); g.arc(80, 35, 14, 0, 6.3); g.fill(); }) }), mat(0x6b4a32)]);
      env.add(pic, -5.95, 2.1, -1 + i * 1.1, Math.PI / 2);
    }
    env.envIntensityOverride = 0.55;
    env.sun.intensity = env.night ? 0.8 : 2.4;
    env.sun.color.set(env.night ? 0x8fa8ff : 0xfff0d8);
    env.sunDir = v3(-0.3, 0.75, -0.6).normalize(); // through the windows
    env.hemi.intensity = env.night ? 0.3 : 0.5;
    env.grade = { bloom: 0.3, exposure: env.night ? 1.2 : 1.05, highlightTint: new THREE.Color(1.08, 1.0, 0.9) };
  },
  school(env, rng, pre) {
    room(env, rng, { w: 14, d: 13, h: 3.8, floorTex: plankTexture('#b8875a'), wall: 0xe8e2cf, zc: 0 });
    env.bgColor = 0x2a2620;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.8), mat(0xffffff, { map: canvasTexture(512, 184, (g, w, h) => { g.fillStyle = '#2f4f3a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#f2f0e6'; g.fillStyle = '#f2f0e6'; g.font = '28px "Comic Sans MS", cursive'; g.fillText('Welcome back, class!', 30, 50); g.fillText('2 + 2 = 4   ☺', 30, 100); g.lineWidth = 3; g.beginPath(); g.arc(420, 100, 40, 0, 6.3); g.stroke(); }), roughness: 0.9 }));
    env.add(board, 0, 1.9, -6.45);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.0, 0.05), mat(0x8b5a2b)); env.add(frame, 0, 1.9, -6.48);
    for (const x of [-6.95]) for (let i = 0; i < 3; i++) windowLightPlane(env, x, 2.0, -4 + i * 3.2, 2.2, 1.8, Math.PI / 2, 0xdff0ff, 3.0);
    // desks
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      if (r === 0 && (c === 1 || c === 2)) continue; // clear a space in the middle front
      const desk = new THREE.Group();
      desk.add(new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.06, 0.6, 2, 0.02), mat(0xc8a06a)));
      desk.children[0].position.y = 0.75;
      for (const [x, z] of [[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 6), mat(0x6a6f78, { metalness: 0.6 })); l.position.set(x, 0.375, z); desk.add(l); }
      const chair = P.bench({ w: 0.5, color: 0x3a6fb5 }); chair.position.z = 0.55; chair.rotation.y = Math.PI; desk.add(chair);
      P.shadowed(desk);
      env.add(desk, -3.3 + c * 2.2, 0, -3.6 + r * 2.0 + (r > 0 ? 2.5 : 0), Math.PI);
      if (r > 0) env.seats.push({ pos: v3(-3.3 + c * 2.2, 0, -3.6 + r * 2.0 + 2.5 - 0.55), ry: 0, h: 0.47 });
    }
    for (let i = 0; i < 6; i++) env.add(extra(rng, { seated: true, scale: 0.85 }), rng.range(-4, 4), 0.1, rng.range(1.5, 4), Math.PI);
    pointGlow(env, 0, 3.6, 0, 0xfff2dc, 6, 14, 0);
    env.sunDir = v3(-0.8, 0.5, 0.1).normalize();
    env.sun.intensity = 2.2; env.sun.color.set(0xfff0d8);
    env.envIntensityOverride = 0.6;
    env.grade = { bloom: 0.25, exposure: 1.05 };
  },
  hospital(env, rng, pre) {
    room(env, rng, { w: 12, d: 12, h: 3.4, floor: 0xd8dde0, wall: 0xe4f0ee, zc: 0 });
    env.bgColor = 0x1a2222;
    const bed = new THREE.Group();
    bed.add(new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.25, 2.2, 3, 0.06), fabric(0xffffff))); bed.children[0].position.y = 0.7;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.5, 2.25), mat(0xb8c4cc, { metalness: 0.5 })); frame.position.y = 0.35; bed.add(frame);
    P.shadowed(bed); env.add(bed, -2.5, 0, -3.6);
    const curtain = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.6, 24, 1, true, 0, Math.PI), mat(0x8fc8c0, { side: THREE.DoubleSide, roughness: 0.9 }));
    env.add(curtain, -2.5, 1.5, -3.6);
    windowLightPlane(env, 2, 1.8, -5.95, 2.4, 1.6, 0, 0xdff0ff, 1.6);
    pointGlow(env, 0, 3.2, -1, 0xf2fbff, 5, 12, 0);
    env.sunDir = v3(0.3, 0.7, -0.6).normalize();
    env.sun.intensity = 2.0;
    env.envIntensityOverride = 0.7;
    env.grade = { bloom: 0.25, highlightTint: new THREE.Color(0.98, 1.02, 1.02) };
  },
  church(env, rng, pre) {
    // nave runs along z; altar at -z
    const W = 13, D = 30, H = 9;
    room(env, rng, { w: W, d: D, h: H, floorKind: 'marble_01', floorTile: 2.5, floorTint: 0xf2e6d2, wall: 0xe8dcc6, ceiling: 0x8a6a4a, zc: -3, polish: 0.5 });
    env.bgColor = 0x1a120c;
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 24), mat(0x8a1d2a, { roughness: 0.95, sheen: 0.5 }));
    runner.rotation.x = -Math.PI / 2; runner.position.set(0, 0.012, -3); runner.receiveShadow = true; env.group.add(runner);
    // altar platform
    const plat = new THREE.Mesh(new RoundedBoxGeometry(9, 0.45, 4, 2, 0.05), mat(0xb8a07a, { roughness: 0.6 }));
    env.add(plat, 0, 0.22, -14);
    const altar = new THREE.Mesh(new RoundedBoxGeometry(2.6, 1.1, 1.0, 2, 0.04), mat(0xf6f1e8, { roughness: 0.5 }));
    env.add(altar, 0, 1.0, -14.6);
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.02, 1.1), mat(0xd9b26a, { roughness: 0.5, sheen: 0.6 }));
    env.add(cloth, 0, 1.56, -14.6);
    env.add(P.cross(0xd9b26a, 2.6), 0, 2.4, -16.2);
    for (const x of [-1.0, 1.0]) { const c = P.candle(true); c.scale.setScalar(2.2); env.add(c, x, 1.57, -14.6); }
    const pulpit = new THREE.Mesh(new RoundedBoxGeometry(1.0, 1.25, 0.8, 2, 0.05), mat(0x6e4127, { roughness: 0.45, clearcoat: 0.3 }));
    env.add(pulpit, 2.8, 1.07, -12.6);
    env.marks.pulpit = { pos: v3(2.8, 0.45, -13.4), ry: 0 };
    env.marks.altar = { pos: v3(0, 0.45, -13.2), ry: 0 };
    // pews: both sides of the aisle, facing the altar
    for (let r = 0; r < 9; r++) for (const sx of [-1, 1]) {
      const z = -9 + r * 1.35;
      env.add(P.pew(3.6), sx * 3.2, 0, z, Math.PI);
      if (r >= 3) for (let k = 0; k < 2; k++) env.seats.push({ pos: v3(sx * (1.8 + k * 0.7), 0, z - 0.05), ry: Math.PI, h: 0.49 });
      // congregation
      if (r < 6 && rng() < 0.75) for (let k = 0; k < rng.int(1, 3); k++) env.add(extra(rng, { seated: true }), sx * rng.range(1.9, 4.6), 0.0, z - 0.05, Math.PI);
    }
    // columns + stained glass on both walls, with light shafts
    for (let i = 0; i < 5; i++) {
      const z = -12 + i * 5;
      for (const sx of [-1, 1]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, H, 16), mat(0xe8dcc6, { roughness: 0.7 }));
        env.add(col, sx * 5.6, H / 2, z + 2.5);
        const tex = P.stainedGlassTexture(rng);
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 3.6), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(env.night ? 0.8 : 2.2, env.night ? 0.8 : 2.1, env.night ? 0.9 : 1.9) }));
        env.add(win, sx * 6.45, 4.8, z, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
        if (!env.night && sx < 0) env.group.add(godRay(v3(sx * 6.3, 5.2, z), v3(sx * -1.5, 0, z + 2.5), 1.6, rng.pick([0xffe2b0, 0xffd0e0, 0xd8e8ff]), 0.06));
      }
    }
    // rose window above the altar
    const rose = new THREE.Mesh(new THREE.CircleGeometry(1.8, 48), new THREE.MeshBasicMaterial({ map: canvasTexture(256, 256, (g, w, h) => { g.fillStyle = '#1a1410'; g.fillRect(0, 0, w, h); const cols = ['#d9443b', '#3a6fd5', '#f2c94c', '#3fb37f', '#8a4fd0']; for (let i = 0; i < 16; i++) { g.fillStyle = cols[i % 5]; g.beginPath(); g.moveTo(128, 128); g.arc(128, 128, 120, (i / 16) * 6.283, ((i + 1) / 16) * 6.283); g.fill(); g.strokeStyle = '#1a1410'; g.lineWidth = 6; g.stroke(); } g.fillStyle = '#fff2c4'; g.beginPath(); g.arc(128, 128, 30, 0, 6.3); g.fill(); }), color: new THREE.Color(2, 1.9, 1.8) }));
    env.add(rose, 0, 6.6, -17.95);
    if (!env.night) env.group.add(godRay(v3(0, 6.6, -17.8), v3(0, 0, -6), 3.0, 0xfff2c8, 0.06));
    // chandeliers
    for (const z of [-8, -1, 5]) {
      const ch = new THREE.Group();
      ch.add(new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.04, 8, 24), mat(0xd9b26a, { metalness: 0.8, roughness: 0.3 })));
      ch.children[0].rotation.x = Math.PI / 2;
      for (let i = 0; i < 8; i++) { const c = P.candle(true); c.scale.setScalar(0.9); c.position.set(Math.cos(i * 0.785) * 0.8, 0, Math.sin(i * 0.785) * 0.8); ch.add(c); }
      env.add(ch, 0, 6.2, z);
      pointGlow(env, 0, 6.0, z, 0xffc77a, 10, 12, 1.4);
    }
    env.sunDir = v3(-0.85, 0.55, 0.1).normalize();
    env.sun.color.set(0xffe2b8);
    env.sun.intensity = env.night ? 0.6 : 2.6;
    env.hemi.color.set(0xffe8c8); env.hemi.groundColor.set(0x6a4a3a); env.hemi.intensity = 0.5;
    env.envTint = 0xffe0c0;
    env.envIntensityOverride = 0.45;
    env.fogDensity = 0.012;
    env.customFog = new THREE.FogExp2(0x3a2a1a, 0.018);
    env.fillColor = 0xffe8d0;
    env.grade = { bloom: 0.5, bloomThreshold: 1.6, exposure: 1.15, saturation: 1.05, shadowTint: new THREE.Color(0.95, 0.95, 1.05), highlightTint: new THREE.Color(1.12, 1.02, 0.86) };
    env.stageFacing = 0; // characters still face the camera by default
  },
  stage(env, rng, pre) {
    room(env, rng, { w: 18, d: 18, h: 9, floorTex: plankTexture('#8a5a3a'), wall: 0x1a1218, zc: -2, polish: 0.6 });
    env.bgColor = 0x07050a;
    const curtainM = mat(0x8a1020, { roughness: 0.8, sheen: 0.8, sheenColor: 0xff6070 });
    for (const sx of [-1, 1]) {
      const cg = new THREE.PlaneGeometry(4, 8, 40, 1);
      const p = cg.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 6) * 0.15);
      cg.computeVertexNormals();
      env.add(new THREE.Mesh(cg, curtainM), sx * 6.5, 4, -6);
    }
    const back = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), mat(0x2a1a3a, { roughness: 0.9 }));
    env.add(back, 0, 4.5, -8);
    bokehLights(env, rng, 60, [-8, 8, 4, 8.5, -7.9, -7.8], [0xfff1c8, 0xffd27a], 0.08);
    for (const x of [-3, 0, 3]) {
      const sl = new THREE.SpotLight(0xfff0d8, 60, 30, 0.35, 0.5, 1.5);
      sl.position.set(x, 8.5, 6); sl.target.position.set(x * 0.3, 0, -1);
      env.group.add(sl, sl.target);
      env.group.add(godRay(v3(x, 8.5, 6), v3(x * 0.3, 0, -1), 1.2, 0xfff2d8, 0.05));
    }
    for (let i = 0; i < 20; i++) env.add(extra(rng, { seated: true }), rng.range(-8, 8), -0.3, rng.range(7, 10), Math.PI);
    env.sun.intensity = 0.6;
    env.hemi.intensity = 0.15;
    env.envIntensityOverride = 0.2;
    env.grade = { bloom: 0.6, exposure: 1.2, vignette: 0.55 };
  },
  space(env, rng, pre) {
    const moon = /moon|mars|planet surface|landed/.test(env.spec.text || '') || true;
    if (moon) {
      groundFor(env, { color: 0x9a96a0, color2: 0x7a7680, color3: 0xb0acb6, hills: 3, flatRadius: 10, roughness: 1 });
      for (let i = 0; i < 25; i++) {
        const a = rng() * Math.PI * 2, d = rng.range(5, 40), r = rng.range(0.6, 3);
        const crater = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.18, 8, 24), mat(0x8a8690, { roughness: 1 }));
        crater.rotation.x = Math.PI / 2; crater.scale.z = 0.4;
        env.add(crater, Math.cos(a) * d, 0.02, Math.sin(a) * d);
      }
      scatter(env, rng, 14, 6, 30, (r) => P.rock(r, { top: 0xa8a4ae, bottom: 0x6a6670 }));
    }
    env.preset.zenith = 0x02030a; env.preset.horizon = 0x0a0f2a;
    // planets
    const planets = [[0x4f86c6, 18, v3(-40, 30, -120), true], [0xe0a060, 9, v3(50, 45, -140), false], [0xd06a8a, 5, v3(-15, 55, -90), false]];
    for (const [c, r, p, ring] of planets) {
      const pm = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, emissive: c, emissiveIntensity: 0.12, fog: false }));
      pm.position.copy(p);
      env.group.add(pm);
      if (ring) { const rg = new THREE.Mesh(new THREE.RingGeometry(r * 1.4, r * 2.1, 64), new THREE.MeshBasicMaterial({ color: 0xe8d8b0, side: THREE.DoubleSide, transparent: true, opacity: 0.6, fog: false })); rg.position.copy(p); rg.rotation.x = 1.2; env.group.add(rg); }
    }
    // starfield points (in addition to the shader stars)
    const sg = new THREE.BufferGeometry();
    const N = 3000, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const v = v3(rng() - 0.5, rng() * 0.9 + 0.05, rng() - 0.5).normalize().multiplyScalar(300); pos.set([v.x, v.y, v.z], i * 3); }
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    env.group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false, fog: false })));
    env.sun.color.set(0xf4f0ff); env.sun.intensity = 3.0;
    env.hemi.color.set(0x5060a0); env.hemi.groundColor.set(0x202030); env.hemi.intensity = 0.35;
    env.customFog = new THREE.FogExp2(0x05060f, 0.004);
    env.rimIntensity = 3.0; env.fillColor = 0xb0c0ff;
    env.grade = { bloom: 0.55, exposure: 1.1, saturation: 1.1 };
  },
  desert(env, rng, pre) {
    groundFor(env, { color: 0xe2b77a, color2: 0xeec98e, color3: 0xd09a5a, hills: 3.5, flatRadius: 9, dunes: true });
    for (let i = 0; i < 14; i++) {
      const a = rng.range(-Math.PI, 0), d = rng.range(7, 30);
      const c = new THREE.Group();
      const cm = mat(0x5f9e5a, { roughness: 0.7 });
      const h = rng.range(1.5, 3.2);
      c.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.28, h, 6, 12), cm)); c.children[0].position.y = h / 2 + 0.2;
      for (const sx of [-1, 1]) if (rng() < 0.8) { const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.8, 6, 10), cm); arm.position.set(sx * 0.55, h * 0.55 + 0.3, 0); c.add(arm); const elbow = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.3, 6, 10), cm); elbow.rotation.z = Math.PI / 2; elbow.position.set(sx * 0.35, h * 0.55 - 0.05, 0); c.add(elbow); }
      P.shadowed(c);
      env.add(c, Math.cos(a) * d, env.heightAt(Math.cos(a) * d, Math.sin(a) * d), Math.sin(a) * d);
    }
    scatter(env, rng, 10, 6, 30, (r) => P.rock(r, { top: 0xc88a5a, bottom: 0x8a5a3a }));
    for (let i = 0; i < 3; i++) { const py = new THREE.Mesh(new THREE.ConeGeometry(18 - i * 4, 16 - i * 3, 4), mat(0xd8b07a, { roughness: 0.9, flat: true })); py.rotation.y = Math.PI / 4; env.add(py, -40 + i * 26, 7 - i * 1.5, -110 - i * 10); }
    env.fogDensity = 0.007;
    env.grade = { bloom: 0.35, saturation: 1.1, highlightTint: new THREE.Color(1.1, 1.0, 0.86) };
  },
  snow(env, rng, pre) {
    groundFor(env, { color: 0xeef3f8, color2: 0xdfe8f2, color3: 0xf8fbff, hills: 3, flatRadius: 9, sheen: 0.6 });
    mountainsBackdrop(env, rng, true, 10);
    scatter(env, rng, 22, 9, 34, (r) => P.pine(r, { snow: true, height: r.range(4, 8) }));
    env.add(P.makeProp('snowman', rng), 3.5, 0, -3.5, -0.4);
    const igloo = new THREE.Mesh(new THREE.SphereGeometry(2.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xf4f8ff, { roughness: 0.6, sheen: 0.5 }));
    igloo.castShadow = true;
    env.add(igloo, -7, 0, -9);
    scatter(env, rng, 8, 6, 24, (r) => P.rock(r, { top: 0xf2f6fa, bottom: 0x9aa8b6 }));
    env.fogDensity = 0.012;
    env.grade = { bloom: 0.35, exposure: 0.95, shadowTint: new THREE.Color(0.9, 0.98, 1.12), highlightTint: new THREE.Color(1.02, 1.02, 1.0) };
  },
  mountain(env, rng, pre) {
    groundFor(env, { color: 0x6f9a4a, color2: 0x8a9a6a, color3: 0x9a9080, hills: 6, flatRadius: 8 });
    mountainsBackdrop(env, rng, true, 12);
    scatter(env, rng, 20, 9, 34, (r) => P.pine(r, { height: r.range(4, 8) }));
    scatter(env, rng, 14, 5, 26, (r) => P.rock(r, { r: r.range(0.5, 1.6) }));
    const grass = grassField(rng, { count: 7000, outer: 20, heightAt: env.heightAt, height: 0.25 });
    env.group.add(grass); env.updaters.push(grass.userData.update);
    env.fogDensity = 0.009;
    env.grade = { bloom: 0.3 };
  },
  castle(env, rng, pre) {
    groundFor(env, { color: 0x6fa84a, color2: 0x8fbf5a, hills: 2.5, flatRadius: 10 });
    hillsBackdrop(env, rng, [0x8cc46a, 0x4f8a3c], 8);
    const stone = mat(0xd8d0c0, { roughness: 0.85 });
    const roofM = mat(0x3a5a9a, { roughness: 0.6 });
    const castle = new THREE.Group();
    const wall = new THREE.Mesh(new RoundedBoxGeometry(18, 7, 3, 2, 0.1), stone); wall.position.y = 3.5; castle.add(wall);
    for (const x of [-9, -3, 3, 9]) {
      const h = x === -3 || x === 3 ? 15 : 11;
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.2, h, 20), stone); tw.position.set(x, h / 2, 0); castle.add(tw);
      const rf = new THREE.Mesh(new THREE.ConeGeometry(2.6, 4.5, 20), roofM); rf.position.set(x, h + 2.2, 0); castle.add(rf);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), mat(0xd9443b, { side: THREE.DoubleSide })); flag.position.set(x + 0.7, h + 5, 0); castle.add(flag);
      env.updaters.push((t) => { flag.rotation.y = Math.sin(t * 3 + x) * 0.3; });
      for (let k = 0; k < 3; k++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.1), new THREE.MeshStandardMaterial({ color: 0x2a2a40, emissive: env.night ? 0xffc46b : 0x000000, emissiveIntensity: 1.5 })); w.position.set(x, h * 0.4 + k * 2.5, 2.25); castle.add(w); }
    }
    const gate = new THREE.Mesh(new THREE.PlaneGeometry(3, 4.5), mat(0x5a3d28)); gate.position.set(0, 2.25, 1.52); castle.add(gate);
    P.shadowed(castle);
    env.add(castle, 0, 0, -26);
    scatter(env, rng, 10, 12, 30, (r) => P.tree(r), { keepOut: [12, -40] });
    const grass = grassField(rng, { count: 9000, outer: 22, height: 0.28 });
    env.group.add(grass); env.updaters.push(grass.userData.update);
    env.grade = { bloom: 0.35 };
  },
  cave(env, rng, pre) {
    groundFor(env, { color: 0x5a5048, color2: 0x4a4038, hills: 0.5, flatRadius: 20 });
    const dome = new THREE.Mesh(P.blobGeometry(22, rng, { top: 0x5a5048, bottom: 0x3a3028, bump: 0.18, detail: 4 }), mat(0xffffff, { vertexColors: true, roughness: 0.95, side: THREE.BackSide }));
    dome.scale.y = 0.45; dome.position.y = 0;
    env.group.add(dome);
    env.interior = true;
    env.bgColor = 0x050404;
    for (let i = 0; i < 18; i++) { const a = rng() * Math.PI * 2, d = rng.range(5, 16), h = rng.range(1, 3.5); const s = new THREE.Mesh(new THREE.ConeGeometry(rng.range(0.3, 0.7), h, 8), mat(0x6a6058, { roughness: 0.9 })); env.add(s, Math.cos(a) * d, h / 2, Math.sin(a) * d); }
    const crystalCols = [0x4fd8ff, 0xb38cff, 0x4fffc8];
    for (let i = 0; i < 12; i++) {
      const a = rng.range(-Math.PI, 0), d = rng.range(4, 11);
      const c = rng.pick(crystalCols);
      const cg = new THREE.Group();
      for (let k = 0; k < 4; k++) { const cr = new THREE.Mesh(new THREE.OctahedronGeometry(rng.range(0.2, 0.5), 0), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.6, roughness: 0.2 })); cr.scale.y = 2; cr.position.set(rng.range(-0.3, 0.3), 0.4, rng.range(-0.3, 0.3)); cr.rotation.set(rng.range(-0.4, 0.4), rng() * 3, rng.range(-0.4, 0.4)); cg.add(cr); }
      env.add(cg, Math.cos(a) * d, 0, Math.sin(a) * d);
      if (i < 5) pointGlow(env, Math.cos(a) * d, 1, Math.sin(a) * d, c, 6, 8, 0);
    }
    env.sun.intensity = 0.25; env.hemi.intensity = 0.12;
    env.envIntensityOverride = 0.12;
    env.customFog = new THREE.FogExp2(0x0a0812, 0.035);
    env.rimIntensity = 1.8; env.fillColor = 0x9fd0ff; env.fillIntensity = 0.5;
    env.grade = { bloom: 0.7, exposure: 1.3 };
  },
  lake(env, rng, pre) {
    groundFor(env, { color: 0x5f9e3c, color2: 0x86bf55, hills: 2.5, flatRadius: 8 });
    hillsBackdrop(env, rng, [0x8cc46a, 0x4f8a3c], 10);
    const water = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshPhysicalMaterial({ color: 0x3a8ab0, roughness: 0.05, clearcoat: 1, metalness: 0.1 }));
    water.rotation.x = -Math.PI / 2; water.position.set(0, 0.05, -40); water.scale.set(1.6, 1, 1);
    env.group.add(water);
    for (let i = 0; i < 12; i++) { const lp = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16, 0.3, 5.8), mat(0x4f9a3a, { roughness: 0.6 })); lp.rotation.x = -Math.PI / 2; env.add(lp, rng.range(-12, 12), 0.07, rng.range(-18, -12)); }
    const dock = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.15, 6, 2, 0.03), mat(0x8b5a2b)); env.add(dock, 3, 0.3, -12);
    scatter(env, rng, 14, 12, 34, (r) => P.tree(r), { arc: [0.1, Math.PI - 0.1] });
    scatter(env, rng, 10, 9, 14, (r) => P.bush(r), { arc: [-Math.PI, -0.1] });
    const grass = grassField(rng, { count: 8000, outer: 14, height: 0.3 });
    env.group.add(grass); env.updaters.push(grass.userData.update);
    env.grade = { bloom: 0.35 };
  },
  candy(env, rng, pre) {
    groundFor(env, { color: 0xf7b8d4, color2: 0xfcd7e6, color3: 0xd8f0e0, hills: 3, flatRadius: 9 });
    hillsBackdrop(env, rng, [0xffd0e8, 0xd890b8], 10);
    for (let i = 0; i < 18; i++) {
      const a = rng() * Math.PI * 2, d = rng.range(6, 26);
      const lp = new THREE.Group();
      const h = rng.range(2, 4);
      lp.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, h, 8), mat(0xffffff)));
      lp.children[0].position.y = h / 2;
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.25, 32), mat(0xffffff, { clearcoat: 1, roughness: 0.2, map: canvasTexture(256, 256, (g, w, hh) => { const c = rng.pick(['#ff4f8a', '#4fc8ff', '#ffd84f', '#8aff6a']); for (let k = 0; k < 12; k++) { g.fillStyle = k % 2 ? '#ffffff' : c; g.beginPath(); g.moveTo(128, 128); g.arc(128, 128, 128, (k / 12) * 6.283, ((k + 1) / 12) * 6.283 + 0.4); g.fill(); } }) }));
      disc.rotation.x = Math.PI / 2; disc.position.y = h + 0.6; lp.add(disc);
      P.shadowed(lp);
      env.add(lp, Math.cos(a) * d, env.heightAt(Math.cos(a) * d, Math.sin(a) * d), Math.sin(a) * d);
    }
    for (let i = 0; i < 30; i++) { const gd = new THREE.Mesh(new THREE.SphereGeometry(rng.range(0.25, 0.5), 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(rng.pick([0xff4f8a, 0x4fc8ff, 0xffd84f, 0x8aff6a, 0xb38cff]), { roughness: 0.2, clearcoat: 1, sheen: 0.5 })); const a = rng() * Math.PI * 2, d = rng.range(3, 20); env.add(gd, Math.cos(a) * d, 0, Math.sin(a) * d); }
    for (let i = 0; i < 6; i++) env.add(P.cloudPuff(rng, rng.range(2, 3.5), 0xffe0f0), rng.range(-50, 50), rng.range(20, 30), rng.range(-90, -50));
    env.grade = { bloom: 0.45, saturation: 1.2 };
  },
  sky(env, rng, pre) {
    const floor = new THREE.Group();
    for (let i = 0; i < 70; i++) { const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * 60; const c = P.cloudPuff(rng, rng.range(2, 4), 0xffffff); c.position.set(Math.cos(a) * d, rng.range(-3, -1), Math.sin(a) * d); floor.add(c); }
    const pad = P.cloudPuff(rng, 2.6, 0xffffff); pad.position.set(0, -1.7, 0); pad.scale.set(1.4, 0.8, 2.2); floor.add(pad);
    env.group.add(floor);
    for (let i = 0; i < 10; i++) env.add(P.cloudPuff(rng, rng.range(3, 6), new THREE.Color(pre.cloud).getHex()), rng.range(-90, 90), rng.range(5, 30), rng.range(-150, -60));
    env.fogDensity = 0.006;
    env.grade = { bloom: 0.5, exposure: 1.05 };
  },
};
BUILDERS.church.interior = true;

export const SETTING_NAMES = Object.keys(BUILDERS);

export function buildEnvironment(renderer, spec) {
  return new Environment(renderer, spec);
}
