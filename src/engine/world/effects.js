// GPU particle effects. Positions are computed in the vertex shader from time
// and per-particle seeds only, so effects scrub and export deterministically.
import * as THREE from 'three';
import { makeRng } from '../../util.js';

let _atlas = null;
// 4×4 atlas of 128px cells: 0 dot, 1 sparkle, 2 heart, 3 note, 4 Z, 5 confetti, 6 snow, 7 streak, 8 leaf, 9 bubble, 10 tear, 11 star
function atlas() {
  if (_atlas) return _atlas;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const cell = (i, fn) => { g.save(); g.translate((i % 4) * 128 + 64, Math.floor(i / 4) * 128 + 64); fn(); g.restore(); };
  const radial = (r, a = 1) => { const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.4, `rgba(255,255,255,${a * 0.6})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); };
  cell(0, () => radial(60));
  cell(1, () => { radial(30); g.fillStyle = '#fff'; g.beginPath(); for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, r = k % 2 ? 8 : 58; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.fill(); });
  cell(2, () => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, 40); g.bezierCurveTo(-70, -10, -35, -60, 0, -25); g.bezierCurveTo(35, -60, 70, -10, 0, 40); g.fill(); });
  cell(3, () => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(-18, 30, 20, 14, -0.4, 0, 7); g.fill(); g.fillRect(-2, -45, 8, 75); g.beginPath(); g.moveTo(2, -45); g.quadraticCurveTo(40, -30, 30, 0); g.lineTo(26, -4); g.quadraticCurveTo(30, -25, 2, -30); g.fill(); });
  cell(4, () => { g.fillStyle = '#fff'; g.font = 'bold 100px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('z', 0, 0); });
  cell(5, () => { g.fillStyle = '#fff'; g.fillRect(-22, -12, 44, 24); });
  cell(6, () => { radial(40); g.strokeStyle = '#fff'; g.lineWidth = 6; for (let k = 0; k < 6; k++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 40); g.stroke(); } });
  cell(7, () => { const gr = g.createLinearGradient(0, -60, 0, 60); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,0.9)'); g.fillStyle = gr; g.fillRect(-3, -60, 6, 120); });
  cell(8, () => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, 0, 22, 48, 0.6, 0, 7); g.fill(); });
  cell(9, () => { g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 45, 0, 7); g.stroke(); g.fillStyle = 'rgba(255,255,255,0.15)'; g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(-15, -18, 9, 0, 7); g.fill(); });
  cell(10, () => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -45); g.quadraticCurveTo(30, 10, 0, 40); g.quadraticCurveTo(-30, 10, 0, -45); g.fill(); });
  cell(11, () => { g.fillStyle = '#fff'; g.beginPath(); for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2 - Math.PI / 2, r = k % 2 ? 22 : 55; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.fill(); });
  _atlas = new THREE.CanvasTexture(c);
  _atlas.colorSpace = THREE.SRGBColorSpace;
  return _atlas;
}

// kind → behavior constants
const KINDS = {
  rain: { id: 0, count: 4000, cell: 7, size: 0.5, colors: [0xaec8e8], blend: 'normal', alpha: 0.55, world: true },
  snow: { id: 1, count: 2500, cell: 6, size: 0.12, colors: [0xffffff], blend: 'normal', alpha: 0.9, world: true },
  sparkles: { id: 2, count: 160, cell: 1, size: 0.16, colors: [0xfff1a8, 0xffffff, 0xffd0f0, 0xb8e8ff], blend: 'add', alpha: 1 },
  hearts: { id: 3, count: 26, cell: 2, size: 0.16, colors: [0xff4f7a, 0xff7aa0, 0xe8435a], blend: 'normal', alpha: 1 },
  notes: { id: 4, count: 18, cell: 3, size: 0.16, colors: [0xffd84f, 0x7fd0ff, 0xff8ad0, 0xffffff], blend: 'normal', alpha: 1 },
  confetti: { id: 5, count: 500, cell: 5, size: 0.07, colors: [0xff4f7a, 0xffd84f, 0x4fc8ff, 0x7dff6a, 0xb38cff, 0xff8a3d], blend: 'normal', alpha: 1 },
  bubbles: { id: 6, count: 140, cell: 9, size: 0.12, colors: [0xdff6ff], blend: 'normal', alpha: 0.8 },
  fireflies: { id: 7, count: 90, cell: 0, size: 0.22, colors: [0xfff47a, 0xd8ff7a], blend: 'add', alpha: 1, world: true },
  leaves: { id: 8, count: 120, cell: 8, size: 0.12, colors: [0xf2a03d, 0xd9643b, 0xf2c94c, 0x8aa83a], blend: 'normal', alpha: 1, world: true },
  zzz: { id: 9, count: 6, cell: 4, size: 0.16, colors: [0xffffff, 0xcfe0ff], blend: 'normal', alpha: 1 },
  tears: { id: 10, count: 16, cell: 10, size: 0.035, colors: [0x9fd8ff], blend: 'normal', alpha: 0.9 },
  dust: { id: 11, count: 400, cell: 0, size: 0.05, colors: [0xfff2d0], blend: 'add', alpha: 0.5, world: true },
  fireworks: { id: 12, count: 600, cell: 0, size: 0.35, colors: [0xff4f7a, 0xffd84f, 0x4fc8ff, 0x7dff6a, 0xb38cff], blend: 'add', alpha: 1, world: true },
  shootingstar: { id: 13, count: 60, cell: 0, size: 0.6, colors: [0xffffff, 0xfff1c8], blend: 'add', alpha: 1, world: true },
  poof: { id: 14, count: 60, cell: 0, size: 0.6, colors: [0xffffff, 0xf2eef8], blend: 'normal', alpha: 0.7 },
  godlight: { id: 15, count: 220, cell: 1, size: 0.08, colors: [0xfff2c8, 0xffffff], blend: 'add', alpha: 0.9 },
};

const VERT = /* glsl */ `
  attribute vec4 aSeed;
  attribute vec3 aColor;
  uniform float uTime, uSize, uScale;
  uniform vec3 uOrigin;
  uniform int uKind;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vRot;
  const float TAU = 6.2831853;
  void main() {
    vec3 p = vec3(0.0);
    float alpha = 1.0;
    float size = uSize * (0.6 + aSeed.w * 0.8);
    float t = uTime;
    vRot = 0.0;
    if (uKind == 0) { // rain
      p = vec3((aSeed.x - 0.5) * 30.0, fract(aSeed.y - t * 1.4) * 14.0, (aSeed.z - 0.5) * 30.0) + vec3(uOrigin.x, 0.0, uOrigin.z);
    } else if (uKind == 1) { // snow
      float y = fract(aSeed.y - t * 0.08) * 12.0;
      p = vec3((aSeed.x - 0.5) * 28.0 + sin(t * 0.6 + aSeed.z * 20.0) * 0.6, y, (aSeed.z - 0.5) * 28.0 + cos(t * 0.5 + aSeed.x * 20.0) * 0.6) + vec3(uOrigin.x, 0.0, uOrigin.z);
    } else if (uKind == 2 || uKind == 15) { // sparkles / heavenly glints
      float life = fract(t * 0.35 + aSeed.w);
      float a = aSeed.x * TAU + t * (0.6 + aSeed.y);
      float r = (uKind == 15 ? 2.5 : 0.5) + aSeed.z * (uKind == 15 ? 4.0 : 0.9);
      p = uOrigin + vec3(cos(a) * r, life * (uKind == 15 ? 5.0 : 2.2) - 0.3, sin(a) * r);
      alpha = sin(life * 3.14159) * (0.6 + 0.4 * sin(t * 12.0 + aSeed.x * 50.0));
      size *= 0.7 + 0.5 * sin(t * 9.0 + aSeed.y * 40.0);
    } else if (uKind == 3 || uKind == 4) { // hearts / notes rise and sway
      float life = fract(t * 0.3 + aSeed.w);
      p = uOrigin + vec3((aSeed.x - 0.5) * 0.9 + sin(life * 6.0 + aSeed.y * 9.0) * 0.18, life * 1.6, (aSeed.z - 0.5) * 0.5);
      alpha = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.7, 1.0, life));
      size *= 0.7 + life * 0.6;
    } else if (uKind == 5) { // confetti falls from above
      float life = fract(t * 0.25 + aSeed.w);
      p = uOrigin + vec3((aSeed.x - 0.5) * 6.0 + sin(t * 2.0 + aSeed.y * 30.0) * 0.4, 4.5 - life * 5.0, (aSeed.z - 0.5) * 5.0 + cos(t * 1.7 + aSeed.x * 30.0) * 0.4);
      alpha = 1.0 - smoothstep(0.85, 1.0, life);
      vRot = t * (2.0 + aSeed.y * 6.0);
      size *= 0.6 + 0.4 * abs(sin(t * 5.0 + aSeed.z * 20.0));
    } else if (uKind == 6) { // bubbles
      float life = fract(t * 0.18 + aSeed.w);
      p = uOrigin + vec3((aSeed.x - 0.5) * 8.0 + sin(t + aSeed.y * 10.0) * 0.3, life * 6.0 - 0.5, (aSeed.z - 0.5) * 8.0);
      alpha = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.85, 1.0, life));
    } else if (uKind == 7) { // fireflies wander
      p = vec3((aSeed.x - 0.5) * 22.0 + sin(t * 0.3 + aSeed.y * 20.0) * 1.5, 0.4 + aSeed.y * 3.0 + sin(t * 0.7 + aSeed.z * 9.0) * 0.4, (aSeed.z - 0.5) * 22.0 - 3.0 + cos(t * 0.25 + aSeed.x * 20.0) * 1.5);
      alpha = smoothstep(0.2, 1.0, sin(t * 1.7 + aSeed.w * 40.0) * 0.5 + 0.5);
    } else if (uKind == 8) { // leaves drift on the wind
      float life = fract(t * 0.07 + aSeed.w);
      p = vec3((life - 0.5) * 30.0 + (aSeed.x - 0.5) * 10.0, 6.0 - life * 6.0 + sin(t * 2.0 + aSeed.y * 9.0) * 0.4, (aSeed.z - 0.5) * 20.0);
      vRot = t * (1.0 + aSeed.y * 3.0);
    } else if (uKind == 9) { // Zzz drift up from a sleeper
      float life = fract(t * 0.35 + aSeed.w);
      p = uOrigin + vec3(life * 0.5 + sin(life * 5.0) * 0.08, life * 0.9, 0.0);
      alpha = smoothstep(0.0, 0.2, life) * (1.0 - smoothstep(0.75, 1.0, life));
      size *= 0.6 + life;
    } else if (uKind == 10) { // tears fall from the eyes
      float life = fract(t * 0.9 + aSeed.w);
      float side = aSeed.x < 0.5 ? -1.0 : 1.0;
      p = uOrigin + vec3(side * 0.07, -life * life * 0.35, 0.09 + life * 0.03);
      alpha = 1.0 - smoothstep(0.7, 1.0, life);
    } else if (uKind == 11) { // dust motes in a light beam
      p = uOrigin + vec3((aSeed.x - 0.5) * 8.0 + sin(t * 0.2 + aSeed.y * 30.0) * 0.5, aSeed.y * 5.0 + sin(t * 0.3 + aSeed.z * 30.0) * 0.3, (aSeed.z - 0.5) * 8.0);
      alpha = 0.4 + 0.6 * sin(t * 0.8 + aSeed.w * 30.0);
    } else if (uKind == 12) { // fireworks
      float period = 2.4;
      float burst = floor(aSeed.w * 6.0);
      float tt = t + burst * 0.8;
      float k = floor(tt / period);
      float age = fract(tt / period) * period;
      vec3 center = vec3(sin(k * 12.9 + burst * 3.7) * 14.0, 16.0 + sin(k * 7.3 + burst) * 4.0, -30.0 + cos(k * 5.1 + burst) * 8.0);
      vec3 dir = normalize(vec3(aSeed.x - 0.5, aSeed.y - 0.5, aSeed.z - 0.5) + 0.0001);
      p = center + dir * (1.0 - exp(-age * 2.0)) * 6.0 - vec3(0.0, age * age * 0.6, 0.0);
      alpha = 1.0 - smoothstep(0.6, 2.2, age);
    } else if (uKind == 13) { // shooting star with a trail
      float period = 5.0;
      float age = fract(t / period) * period;
      float trail = aSeed.x * 0.4;
      float s = clamp((age - trail) / 1.2, 0.0, 1.0);
      p = vec3(-30.0 + s * 60.0, 40.0 - s * 14.0, -80.0);
      alpha = (1.0 - aSeed.x) * step(age, 1.6) * step(trail, age);
      size *= 1.0 - aSeed.x * 0.8;
    } else if (uKind == 14) { // poof cloud
      float age = clamp(t, 0.0, 2.0);
      vec3 dir = normalize(vec3(aSeed.x - 0.5, aSeed.y * 0.8, aSeed.z - 0.5) + 0.0001);
      p = uOrigin + dir * (1.0 - exp(-age * 3.0)) * 1.2;
      alpha = 1.0 - smoothstep(0.4, 1.6, age);
      size *= 1.0 + age;
    }
    vColor = aColor;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = size * uScale / max(0.1, -mv.z);
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uCell, uAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vRot;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    uv = mat2(c, -s, s, c) * uv + 0.5;
    vec2 cell = vec2(mod(uCell, 4.0), floor(uCell / 4.0));
    vec2 auv = (cell + vec2(uv.x, 1.0 - uv.y)) / 4.0;
    vec4 tex = texture2D(uAtlas, vec2(auv.x, 1.0 - auv.y));
    float a = tex.a * vAlpha * uAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * tex.rgb, a);
  }`;

export class Effect {
  constructor(kind, seed = 1) {
    const K = KINDS[kind];
    if (!K) throw new Error('unknown effect ' + kind);
    this.kind = kind;
    this.K = K;
    const rng = makeRng(seed + K.id * 101);
    const n = K.count;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const seed4 = new Float32Array(n * 4);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      seed4.set([rng(), rng(), rng(), rng()], i * 4);
      c.set(K.colors[i % K.colors.length]);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed4, 4));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    this.uniforms = {
      uTime: { value: 0 }, uSize: { value: K.size }, uScale: { value: 500 }, uOrigin: { value: new THREE.Vector3() },
      uKind: { value: K.id }, uAtlas: { value: atlas() }, uCell: { value: K.cell }, uAlpha: { value: K.alpha },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: K.blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }
  // t: seconds since the effect started; origin: world position; pxScale: viewport height / (2·tan(fov/2))
  update(t, origin, pxScale) {
    this.uniforms.uTime.value = t;
    if (origin) this.uniforms.uOrigin.value.copy(origin);
    this.uniforms.uScale.value = pxScale;
  }
  dispose() { this.points.geometry.dispose(); this.points.material.dispose(); }
}

export const EFFECT_KINDS = Object.keys(KINDS);
