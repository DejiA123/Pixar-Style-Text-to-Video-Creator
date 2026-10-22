// Sculpted cartoon head: a dense sphere pushed into a stylized human shape,
// with big glossy eyes, eyelids, live mouth, brows, nose and ears.
// All coordinates here are in "head units" (cranium radius ≈ 1), +z = face.
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { skinMaterial, mat, basic } from '../materials.js';
import { clamp, smoothstep, lerp } from '../../util.js';
import { faceUVs } from './skin.js';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function gauss3(px, py, pz, cx, cy, cz, sx, sy = sx, sz = sx) {
  const dx = (px - cx) / sx, dy = (py - cy) / sy, dz = (pz - cz) / sz;
  return Math.exp(-0.5 * (dx * dx + dy * dy + dz * dz));
}

// Face shape parameters derived from age/gender/seed.
export function faceParams(spec, rng) {
  const child = spec.age === 'child' || spec.age === 'baby';
  const old = spec.age === 'old';
  const f = spec.gender === 'f';
  return {
    jaw: child ? 0.84 : f ? 0.78 : (spec.age === 'teen' ? 0.82 : 0.86) + rng.range(-0.03, 0.03),
    jawSquare: f || child ? 0.02 : rng.range(0.04, 0.09),
    chin: child ? 0.03 : f ? 0.05 : rng.range(0.06, 0.1),
    cheek: child ? 0.07 : f ? 0.045 : 0.03,
    cranium: child ? 1.08 : 1.0,
    faceLength: child ? 0.9 : f ? 1.02 : (spec.age === 'teen' ? 1.04 : 1.08) + rng.range(-0.02, 0.03),
    nose: child ? 0.11 : f ? 0.125 : rng.range(0.15, 0.18),
    noseDown: rng.range(-0.02, 0.03),
    eyeR: child ? 0.26 : spec.age === 'teen' ? (f ? 0.215 : 0.205) : (f ? 0.205 : 0.195),
    eyeSpacing: child ? 0.37 : 0.355,
    eyeY: child ? -0.02 : 0.06,
    mouthY: child ? -0.52 : -0.56,
    browY: child ? 0.32 : 0.37,
    browThick: f ? 0.032 : 0.05 + rng.range(0, 0.012),
    old,
    adult: !child,
    female: f,
  };
}

// Displace a unit-sphere direction into the head surface.
export function sculpt(d, P, out = v3()) {
  let { x, y, z } = d;
  const front = smoothstep(0.2, 0.75, z);
  let r = 1;
  const G = (cx, cy, cz, sx, sy = sx, sz = sx) => gauss3(x, y, z, cx, cy, cz, sx, sy, sz);
  const adult = P.adult ? 1 : 0;
  // brow ridge and forehead plane
  r += 0.035 * front * Math.exp(-0.5 * ((y - (P.eyeY + 0.27)) / 0.07) ** 2) * smoothstep(0.62, 0.2, Math.abs(x));
  // eye sockets
  r -= 0.045 * (G(P.eyeSpacing, P.eyeY, 0.84, 0.15) + G(-P.eyeSpacing, P.eyeY, 0.84, 0.15));
  // temples
  r -= 0.025 * (G(0.74, P.eyeY + 0.3, 0.45, 0.16) + G(-0.74, P.eyeY + 0.3, 0.45, 0.16));
  // cheekbones, soft cheeks, adult hollows
  r += (0.04 + P.cheek * 0.6) * (G(0.5, P.eyeY - 0.2, 0.68, 0.17, 0.12) + G(-0.5, P.eyeY - 0.2, 0.68, 0.17, 0.12));
  r += P.cheek * (G(0.45, -0.36, 0.66, 0.2) + G(-0.45, -0.36, 0.66, 0.2));
  r -= 0.022 * adult * (G(0.52, -0.46, 0.55, 0.12) + G(-0.52, -0.46, 0.55, 0.12));
  // nose bridge rising toward the tip
  const bridge = Math.exp(-0.5 * (x / 0.065) ** 2) * smoothstep(P.eyeY + 0.12, P.eyeY - 0.05, y) * smoothstep(-0.32, -0.12, y) * front;
  r += bridge * (0.05 + 0.05 * smoothstep(0.1, -0.2, y));
  // muzzle, lips, philtrum, chin, jaw angle
  r += 0.05 * G(0, P.mouthY + 0.02, 0.84, 0.24, 0.16);
  r += 0.03 * G(0, P.mouthY + 0.05, 0.92, 0.17, 0.032);
  r += 0.034 * G(0, P.mouthY - 0.06, 0.92, 0.14, 0.04);
  r -= 0.012 * G(0, P.mouthY + 0.13, 0.95, 0.03, 0.05);
  r -= 0.015 * G(0, P.mouthY - 0.15, 0.88, 0.14, 0.04);
  r += (P.chin + 0.02) * G(0, -0.86, 0.55, 0.15, 0.12);
  r += 0.03 * adult * (G(0.7, -0.55, 0.15, 0.16) + G(-0.7, -0.55, 0.15, 0.16)) * (P.female ? 0.4 : 1);
  x *= r; y *= r; z *= r;

  // base ellipsoid
  x *= 0.8; z *= 0.9;
  if (y > 0) { const k = y; x *= 1 + 0.05 * k * P.cranium; z *= 1 + 0.04 * k; y *= P.cranium; }
  if (z < 0) z *= 1.06;
  const t = smoothstep(0.1, -0.98, y);
  const jawCorner = Math.exp(-0.5 * ((y + 0.5) / 0.18) ** 2) * (z > -0.2 ? 1 : 0.5);
  const tj = smoothstep(-0.12, -0.98, y);
  x *= lerp(1, P.jaw, Math.pow(tj, 1.5)) * lerp(1, 0.9, Math.pow(tj, 3)) * (1 + P.jawSquare * jawCorner);
  if (y < 0) y *= P.faceLength;
  if (z > 0) z *= lerp(1, 0.93, t);
  return out.set(x, y, z);
}

// Iteratively find the surface point whose front projection is (x, y).
export function surfaceAt(P, x, y) {
  const d = v3(x, y, Math.sqrt(Math.max(0.05, 1 - x * x - y * y))).normalize();
  const p = v3();
  for (let i = 0; i < 8; i++) {
    sculpt(d, P, p);
    d.x += (x - p.x) * 0.8;
    d.y += (y - p.y) * 0.8;
    d.z = Math.sqrt(Math.max(0.02, 1 - d.x * d.x - d.y * d.y));
    d.normalize();
  }
  sculpt(d, P, p);
  // normal by finite difference over the sphere
  const e = 0.01;
  const t1 = v3(1, 0, 0).sub(d.clone().multiplyScalar(d.x)).normalize();
  const t2 = d.clone().cross(t1).normalize();
  const a = sculpt(d.clone().addScaledVector(t1, e).normalize(), P, v3());
  const b = sculpt(d.clone().addScaledVector(t2, e).normalize(), P, v3());
  const n = a.sub(p).cross(b.sub(p)).normalize();
  if (n.dot(p) < 0) n.negate();
  return { p, n, d };
}

// Heightfield z(x, y) of the face over a rectangle — for decals that hug skin.
export class FaceField {
  constructor(P, x0, x1, y0, y1, nx = 33, ny = 21) {
    Object.assign(this, { x0, x1, y0, y1, nx, ny });
    this.z = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = lerp(x0, x1, i / (nx - 1));
        const y = lerp(y0, y1, j / (ny - 1));
        this.z[j * nx + i] = surfaceAt(P, x, y).p.z;
      }
    }
  }
  zAt(x, y) {
    const fx = clamp((x - this.x0) / (this.x1 - this.x0)) * (this.nx - 1);
    const fy = clamp((y - this.y0) / (this.y1 - this.y0)) * (this.ny - 1);
    const i = Math.min(this.nx - 2, Math.floor(fx)), j = Math.min(this.ny - 2, Math.floor(fy));
    const u = fx - i, v = fy - j;
    const z = this.z, n = this.nx;
    return lerp(lerp(z[j * n + i], z[j * n + i + 1], u), lerp(z[(j + 1) * n + i], z[(j + 1) * n + i + 1], u), v);
  }
}

export function buildHeadGeometry(P, opts = {}) {
  const geo = new THREE.SphereGeometry(1, opts.wSeg ?? 160, opts.hSeg ?? 120);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const merged = mergeVertices(geo, 1e-5);
  const pos = merged.attributes.position;
  const dirs = new Float32Array(pos.array);
  merged.setAttribute('uv', new THREE.BufferAttribute(faceUVs(dirs), 2));
  const colors = new Float32Array(pos.count * 3);
  const d = v3(), p = v3();
  const blush = opts.blush ?? 0.5;
  const stubble = opts.stubble || null; // {color, amount}
  const sc = stubble ? new THREE.Color(stubble.color) : null;
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    sculpt(d, P, p);
    pos.setXYZ(i, p.x, p.y, p.z);
    // vertex tint: warm cheeks, nose & ears; optional stubble shadow on the jaw
    let rr = 1, gg = 1, bb = 1;
    const cheek = gauss3(d.x, d.y, d.z, 0.48, -0.25, 0.7, 0.16) + gauss3(d.x, d.y, d.z, -0.48, -0.25, 0.7, 0.16);
    const noseTip = gauss3(d.x, d.y, d.z, 0, -0.18, 0.95, 0.1);
    const side = smoothstep(0.75, 0.95, Math.abs(d.x));
    const warm = cheek * 0.22 * blush + noseTip * 0.12 + side * 0.06;
    rr += warm * 0.25; gg -= warm * 0.55; bb -= warm * 0.5;
    if (sc) {
      const jaw = smoothstep(-0.15, -0.45, d.y) * smoothstep(-0.45, 0.1, d.z) * (1 - gauss3(d.x, d.y, d.z, 0, P.mouthY, 0.85, 0.16, 0.06));
      const lip = gauss3(d.x, d.y, d.z, 0, P.mouthY + 0.1, 0.9, 0.18, 0.05);
      const s = clamp((jaw + lip * 0.8) * stubble.amount);
      rr = lerp(rr, sc.r * 1.6, s); gg = lerp(gg, sc.g * 1.6, s); bb = lerp(bb, sc.b * 1.6, s);
    }
    colors[i * 3] = rr; colors[i * 3 + 1] = gg; colors[i * 3 + 2] = bb;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.computeVertexNormals();
  return merged;
}

// ---- eyes ---------------------------------------------------------------------
const irisCache = new Map();
function irisTexture(color) {
  const key = color;
  if (irisCache.has(key)) return irisCache.get(key);
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const base = new THREE.Color(color);
  const dark = base.clone().multiplyScalar(0.35);
  const light = base.clone().lerp(new THREE.Color(0xfff0c0), 0.45);
  const irisA = 0.6, pupilA = 0.22;
  const streak = new Float32Array(W), streak2 = new Float32Array(W);
  let s = 1234;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < W; i++) streak[i] = rnd();
  for (let i = 0; i < W; i++) streak2[i] = (streak[i] + streak[(i + 1) % W] + streak[(i + W - 1) % W]) / 3;
  const crypts = [];
  for (let i = 0; i < 40; i++) crypts.push([rnd() * W, 0.3 + rnd() * 0.5, 4 + rnd() * 10]);
  const veins = [];
  for (let i = 0; i < 26; i++) veins.push([rnd() * W, 0.6 + rnd() * 0.35, rnd() * 0.004 + 0.002]);
  for (let y = 0; y < H; y++) {
    const theta = (y / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let col;
      if (theta < pupilA) col = new THREE.Color(0.012, 0.01, 0.014);
      else if (theta < irisA) {
        const t = (theta - pupilA) / (irisA - pupilA);
        const fib = streak2[x] * 0.7 + streak[(x * 3) % W] * 0.3;
        const collarette = Math.exp(-(((t - 0.32) / 0.07) ** 2));
        col = base.clone().lerp(light, collarette * 0.55 + fib * 0.35 * (1 - t)).lerp(dark, smoothstep(0.78, 1.0, t) * 0.9 + (1 - fib) * 0.25);
        for (const [cx, ct, cr] of crypts) { const dx = Math.min(Math.abs(x - cx), W - Math.abs(x - cx)); if (dx < cr && Math.abs(t - ct) < 0.05) col.lerp(dark, 0.35); }
        const edge = smoothstep(0.0, 0.07, t);
        col.lerp(new THREE.Color(0.012, 0.01, 0.014), 1 - edge);
      } else {
        const t = smoothstep(irisA, irisA + 0.04, theta);
        col = new THREE.Color(0.95, 0.94, 0.92).lerp(new THREE.Color(0.94, 0.8, 0.78), smoothstep(1.25, 1.9, theta) * 0.7);
        for (const [vx, vt, vw] of veins) {
          const dx = Math.min(Math.abs(x - vx), W - Math.abs(x - vx)) / W;
          const wig = Math.sin(theta * 30 + vx) * 0.004;
          if (Math.abs(dx - wig) < vw && theta > vt * Math.PI * 0.8) col.lerp(new THREE.Color(0.85, 0.45, 0.45), 0.35);
        }
        col = dark.clone().lerp(col, t);
      }
      img.data[i] = Math.round(Math.pow(clamp(col.r), 1 / 2.2) * 255);
      img.data[i + 1] = Math.round(Math.pow(clamp(col.g), 1 / 2.2) * 255);
      img.data[i + 2] = Math.round(Math.pow(clamp(col.b), 1 / 2.2) * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  irisCache.set(key, tex);
  return tex;
}

export function buildEye(r, eyeColor, skinMat, opts = {}) {
  const eye = new THREE.Group(); // positioned in socket; does not rotate
  const ball = new THREE.Group(); // rotates to look
  eye.add(ball);
  const g = new THREE.SphereGeometry(r, 48, 32);
  g.rotateX(Math.PI / 2); // texture pole → +z
  const eyeMat = new THREE.MeshPhysicalMaterial({
    map: irisTexture(eyeColor), roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.12, specularIntensity: 0.6, envMapIntensity: 0.5,
  });
  const ballMesh = new THREE.Mesh(g, eyeMat);
  ball.add(ballMesh);
  // cornea bulge: a clear lens over the iris that catches highlights
  const corneaG = new THREE.SphereGeometry(r * 0.62, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
  corneaG.rotateX(Math.PI / 2);
  corneaG.scale(1, 1, 0.55);
  corneaG.translate(0, 0, r * 0.62);
  const cornea = new THREE.Mesh(corneaG, new THREE.MeshPhysicalMaterial({
    color: 0xffffff, transparent: true, opacity: 0.04, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.08, depthWrite: false,
  }));
  ball.add(cornea);

  // catchlights: fixed relative to the socket so they stay put as the eye moves
  const cl = new THREE.Mesh(new THREE.CircleGeometry(r * 0.13, 20), basic(0xffffff, { toneMapped: false }));
  const clDir = v3(-0.42, 0.5, 1).normalize();
  cl.position.copy(clDir).multiplyScalar(r * 1.012);
  cl.lookAt(clDir.clone().multiplyScalar(r * 3));
  eye.add(cl);
  const cl2 = new THREE.Mesh(new THREE.CircleGeometry(r * 0.055, 14), basic(0xffffff, { toneMapped: false, transparent: true, opacity: 0.8 }));
  const cl2Dir = v3(0.3, -0.32, 1).normalize();
  cl2.position.copy(cl2Dir).multiplyScalar(r * 1.012);
  cl2.lookAt(cl2Dir.clone().multiplyScalar(r * 3));
  eye.add(cl2);

  // lids: hemispherical shells of skin that rotate to open/close
  const lidR = r * 1.045;
  const upperG = new THREE.SphereGeometry(lidR, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const lowerG = new THREE.SphereGeometry(r * 1.03, 40, 4, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.04);
  const upper = new THREE.Group();
  const lower = new THREE.Group();
  const lidMat = skinMat.clone();
  lidMat.side = THREE.DoubleSide;
  lidMat.onBeforeCompile = skinMat.onBeforeCompile;
  lidMat.customProgramCacheKey = () => 'skin-sss-lid';
  upper.add(new THREE.Mesh(upperG, lidMat));
  lower.add(new THREE.Mesh(lowerG, lidMat));
  // fleshy lid rim + lash line + individual lashes curling outward
  const lashMat = mat(0x140c0a, { roughness: 0.55 });
  const lashT = opts.female ? r * 0.05 : r * 0.035;
  const rimG = new THREE.TorusGeometry(lidR * 1.01, r * 0.045, 8, 40, Math.PI);
  rimG.rotateX(Math.PI / 2);
  upper.add(new THREE.Mesh(rimG, skinMat));
  const lashG = new THREE.TorusGeometry(lidR * 1.03, lashT, 6, 40, Math.PI);
  lashG.rotateX(Math.PI / 2);
  upper.add(new THREE.Mesh(lashG, lashMat));
  {
    const n = opts.female ? 26 : 16;
    const strands = [];
    for (let k = 0; k < n; k++) {
      const a = 0.18 + (k / (n - 1)) * (Math.PI - 0.36);
      const len = r * (opts.female ? 0.32 : 0.2) * (0.7 + 0.5 * Math.sin(a));
      const pts = [];
      for (let q = 0; q < 5; q++) {
        const t = q / 4;
        const out = lidR * 1.025 + t * len * 0.95;
        pts.push(new THREE.Vector3(Math.cos(a) * out, -t * len * 0.12 + t * t * len * 0.55, Math.sin(a) * out));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      strands.push(new THREE.TubeGeometry(curve, 4, r * 0.012, 3));
    }
    const lashes = new THREE.Mesh(mergeGeometries(strands), lashMat);
    upper.add(lashes);
  }
  if (opts.female) {
    // a little flick at the outer corner
    const flick = new THREE.Mesh(new THREE.ConeGeometry(lashT * 1.2, r * 0.45, 6), lashMat);
    const side = opts.side === 'L' ? -1 : 1;
    flick.position.set(side * lidR * 0.98, r * 0.06, r * 0.12);
    flick.rotation.z = -side * 1.1;
    flick.rotation.x = -0.3;
    upper.add(flick);
  }
  const lowerLash = new THREE.Mesh(new THREE.TorusGeometry(lidR * 1.0, lashT * 0.35, 4, 30, Math.PI), mat(0x6b4a40, { roughness: 0.8 }));
  lowerLash.geometry.rotateX(-Math.PI / 2);
  lower.add(lowerLash);
  eye.add(upper, lower);
  return { eye, ball, upper, lower, r };
}

// ---- mouth ----------------------------------------------------------------------
// A small dynamic mesh that hugs the face: lips line, open cavity, teeth, tongue.
export class Mouth {
  constructor(P, field, opts = {}) {
    this.P = P;
    this.field = field;
    this.N = 28;
    this.w0 = opts.width ?? 0.2;
    this.group = new THREE.Group();
    const N = this.N;
    const mk = (color, offset, extra = {}) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      const idx = [];
      for (let i = 0; i < N - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
      g.setIndex(idx);
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      const m = new THREE.Mesh(g, mat(color, { roughness: extra.roughness ?? 0.7, noCache: true, polygonOffset: -1 - offset * 2, ...extra }));
      m.userData.offset = offset;
      m.frustumCulled = false;
      m.renderOrder = 2 + offset;
      this.group.add(m);
      return m;
    };
    this.cavity = mk(0x3a0f12, 0.004, { roughness: 0.9 });
    this.tongue = mk(0xc0565d, 0.006, { roughness: 0.55 });
    this.teeth = mk(0xf6f1e7, 0.007, { roughness: 0.25, clearcoat: 0.4 });
    this.lowerTeeth = mk(0xefe8dc, 0.0065, { roughness: 0.3 });
    const lipColor = opts.lipColor ?? 0xb86a5e;
    this.upperLip = mk(lipColor, 0.003, { roughness: 0.45, clearcoat: 0.2 });
    this.lowerLip = mk(lipColor, 0.003, { roughness: 0.4, clearcoat: 0.35 });
    this.update({ open: 0, smile: 0.3, width: 1, round: 0 });
  }

  // open 0..1, smile -1..1, width ~0.7..1.3, round 0..1 ("oo"), teethShow 0..1
  update({ open = 0, smile = 0, width = 1, round = 0, teethShow = 1 }) {
    const N = this.N, P = this.P;
    const w = this.w0 * width * (1 - 0.38 * round) * (1 + Math.max(0, smile) * 0.12);
    const y0 = P.mouthY;
    const openH = 0.022 + open * 0.2 * (1 + round * 0.25);
    const xs = [], yU = [], yL = [];
    for (let i = 0; i < N; i++) {
      const u = (i / (N - 1)) * 2 - 1; // -1..1
      const x = u * w;
      const corner = u * u;
      const up = smile >= 0 ? smile * 0.075 * Math.pow(Math.abs(u), 1.6) : smile * 0.06 * corner;
      const bow = -0.006 * Math.exp(-((u / 0.18) ** 2)) * (1 - open);
      const yu = y0 + up + bow + open * 0.02 * (1 - corner);
      let depth = openH * Math.pow(Math.max(0, 1 - corner), 0.55 + round * 0.4) + 0.008 * (1 - corner * 0.6);
      depth += Math.max(0, smile) * 0.035 * (1 - corner) * (0.3 + open);
      xs.push(x); yU.push(yu); yL.push(yu - depth);
    }
    const write = (mesh, topFn, botFn, xScale = 1) => {
      const pos = mesh.geometry.attributes.position;
      const off = mesh.userData.offset;
      for (let i = 0; i < N; i++) {
        const x = xs[i] * xScale;
        const t = topFn(i), b = botFn(i);
        pos.setXYZ(i * 2, x, t, this.field.zAt(x, t) + off);
        pos.setXYZ(i * 2 + 1, x, b, this.field.zAt(x, b) + off);
      }
      pos.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
    };
    write(this.cavity, (i) => yU[i], (i) => yL[i]);
    const openAmt = clamp((open - 0.04) / 0.25);
    const teethH = 0.055 * teethShow;
    write(this.teeth, (i) => yU[i] - 0.004, (i) => Math.max(yU[i] - 0.004 - teethH * openAmt * (1 - (2 * i / (N - 1) - 1) ** 4), yL[i]), 0.92);
    write(this.lowerTeeth, (i) => Math.min(yL[i] + 0.035 * openAmt * Math.max(0, open - 0.3) * (1 - (2 * i / (N - 1) - 1) ** 2), yU[i]), (i) => yL[i] + 0.002, 0.8);
    write(this.tongue, (i) => Math.min(yL[i] + 0.06 * openAmt * (1 - (2 * i / (N - 1) - 1) ** 2), yU[i] - 0.01), (i) => yL[i] + 0.001, 0.72);
    write(this.upperLip, (i) => yU[i] + 0.016 * (1 - (2 * i / (N - 1) - 1) ** 2) + 0.002, (i) => yU[i]);
    write(this.lowerLip, (i) => yL[i], (i) => yL[i] - 0.028 * (1 - (2 * i / (N - 1) - 1) ** 2) - 0.002);
  }
}

// ---- brows ---------------------------------------------------------------------
export class Brow {
  constructor(P, field, side, color, thick) {
    this.P = P; this.field = field; this.side = side; // side: +1 right (x>0), -1 left
    this.thick = thick;
    this.N = 14;
    const N = this.N;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3 * 3), 3));
    const idx = [];
    for (let i = 0; i < N - 1; i++) {
      for (let k = 0; k < 2; k++) {
        const a = i * 3 + k, b = a + 1, c = a + 3, d = a + 4;
        if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
    }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, mat(color, { roughness: 0.85, sheen: 0.4, noCache: true }));
    this.mesh.frustumCulled = false;
    this.update({ innerY: 0, outerY: 0, arch: 0 });
  }
  // innerY/outerY: vertical offsets; arch: extra curve; squeeze: inner ends toward center
  update({ innerY = 0, outerY = 0, arch = 0, squeeze = 0 }) {
    const P = this.P, s = this.side, N = this.N;
    const pos = this.mesh.geometry.attributes.position;
    const xi = s * (0.12 - squeeze * 0.03), xo = s * 0.56;
    const yi = P.browY + innerY, yo = P.browY - 0.04 + outerY;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const x = lerp(xi, xo, t);
      const y = lerp(yi, yo, t) + (0.055 + arch) * Math.sin(Math.PI * Math.pow(t, 0.8)) ;
      const w = this.thick * (1.15 - 0.85 * Math.pow(t, 1.4)) * (t < 0.08 ? 0.75 + t * 3 : 1);
      const yT = y + w * 0.5, yB = y - w * 0.5;
      pos.setXYZ(i * 3, x, yT, this.field.zAt(x, yT) + 0.008);
      pos.setXYZ(i * 3 + 1, x, y, this.field.zAt(x, y) + 0.008 + w * 0.35);
      pos.setXYZ(i * 3 + 2, x, yB, this.field.zAt(x, yB) + 0.008);
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere();
  }
}

// ---- ears & nose -----------------------------------------------------------------
export function buildHumanEar(skinMat, side) {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), skinMat);
  outer.scale.set(0.07, 0.2, 0.13);
  g.add(outer);
  const inner = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), skinMat);
  inner.scale.set(0.035, 0.13, 0.08);
  inner.position.set(side * 0.04, -0.01, 0.01);
  g.add(inner);
  const lobe = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), skinMat);
  lobe.scale.set(0.05, 0.06, 0.06);
  lobe.position.set(0, -0.15, 0.02);
  g.add(lobe);
  g.rotation.y = side * 0.35;
  g.rotation.z = -side * 0.08;
  return g;
}

export function buildNose(P, skinMat, field) {
  const g = new THREE.Group();
  const baseMat = skinMat;
  skinMat = baseMat.clone();
  skinMat.onBeforeCompile = baseMat.onBeforeCompile;
  skinMat.customProgramCacheKey = baseMat.customProgramCacheKey;
  skinMat.color.lerp(new THREE.Color(0xff9a8a), 0.12);
  const tipY = -0.2 + P.noseDown;
  const s = P.nose;
  const tipZ = field.zAt(0, tipY);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), skinMat);
  tip.scale.set(s * 0.95, s * 0.8, s * 0.8);
  tip.position.set(0, tipY, tipZ + s * 0.02);
  g.add(tip);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), skinMat);
    wing.scale.set(s * 0.5, s * 0.45, s * 0.5);
    wing.position.set(side * s * 0.72, tipY - s * 0.22, tipZ - s * 0.26);
    g.add(wing);
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat(0x4a2420, { roughness: 0.9 }));
    nostril.scale.set(s * 0.17, s * 0.07, s * 0.12);
    nostril.position.set(side * s * 0.36, tipY - s * 0.73, tipZ + s * 0.12);
    g.add(nostril);
  }
  return g;
}

export { v3 };
