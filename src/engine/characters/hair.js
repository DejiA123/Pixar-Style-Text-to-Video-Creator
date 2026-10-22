// Hair built from tapered strand clumps that flow over the scalp, collide with
// the head and fall with gravity. Head units (cranium radius ≈ 1).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sculpt } from './head.js';
import { hairMaterial } from '../materials.js';
import { makeRng, clamp, smoothstep, lerp } from '../../util.js';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = v3(0, 1, 0);

// Build one clump: a tube with flattened elliptical cross-section.
function clumpGeometry(points, w0, w1, flat, color, rng, opts = {}) {
  const n = points.length;
  const R = opts.radial ?? 6;
  const pos = new Float32Array(n * R * 3);
  const nor = new Float32Array(n * R * 3);
  const col = new Float32Array(n * R * 3);
  const uv = new Float32Array(n * R * 2);
  const c = new THREE.Color(color);
  const bright = 1 + rng.range(-0.09, 0.09);
  const tipLight = opts.tipLight ?? 0.12;
  const tangent = v3(), side = v3(), up = v3(), q = v3();
  let prevSide = null;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = points[i];
    if (i < n - 1) tangent.subVectors(points[i + 1], p); else tangent.subVectors(p, points[i - 1]);
    tangent.normalize();
    // side vector: keep the flat face roughly facing outward from the head center
    const outward = p.clone().normalize();
    side.crossVectors(tangent, outward);
    if (side.lengthSq() < 1e-6) side.crossVectors(tangent, UP);
    side.normalize();
    if (prevSide && side.dot(prevSide) < 0) side.negate();
    prevSide = side.clone();
    up.crossVectors(side, tangent).normalize();
    const taper = opts.taper ?? 0.75;
    const body = opts.belly ? 1 + opts.belly * Math.sin(Math.PI * Math.min(1, t * 1.4)) : 1;
    const leaf = opts.leaf ? 0.3 + 0.7 * smoothstep(0, opts.leaf, t) : 1;
    const w = lerp(w0, w1, Math.pow(t, taper)) * body * leaf * (opts.rootFlare && t < 0.15 ? 1 + (0.15 - t) * 2 : 1);
    const shade = bright * lerp(0.82, 1 + tipLight, smoothstep(0, 1, t));
    for (let k = 0; k < R; k++) {
      const a = (k / R) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      q.copy(p).addScaledVector(side, ca * w).addScaledVector(up, sa * w * flat);
      const idx = (i * R + k) * 3;
      pos[idx] = q.x; pos[idx + 1] = q.y; pos[idx + 2] = q.z;
      const nn = side.clone().multiplyScalar(ca * flat).addScaledVector(up, sa).normalize();
      nor[idx] = nn.x; nor[idx + 1] = nn.y; nor[idx + 2] = nn.z;
      col[idx] = c.r * shade; col[idx + 1] = c.g * shade; col[idx + 2] = c.b * shade;
      uv[(i * R + k) * 2] = t * (opts.uScale ?? 2);
      uv[(i * R + k) * 2 + 1] = k / R;
    }
  }
  const index = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < R; k++) {
      const a = i * R + k, b = i * R + ((k + 1) % R), c2 = (i + 1) * R + k, d = (i + 1) * R + ((k + 1) % R);
      index.push(a, c2, b, b, c2, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

// Collision shapes in head space: head ellipsoid, face exclusion, torso.
function makeCollider(P, body) {
  const head = { a: 0.92, b: 1.08 * (P.cranium || 1), c: 1.0 };
  return (p, margin = 1.06, faceGuard = true) => {
    // head ellipsoid (slightly bigger than skin)
    let k = (p.x / head.a) ** 2 + (p.y / head.b) ** 2 + (p.z / head.c) ** 2;
    if (k < margin * margin) {
      const s = margin / Math.sqrt(k);
      p.multiplyScalar(s);
    }
    // keep the forehead clear of hanging locks
    if (faceGuard && p.z > 0.45 && p.y < 0.52 && p.y > 0.12 && Math.abs(p.x) < 0.62) {
      p.x = Math.sign(p.x || 1) * lerp(Math.abs(p.x), 0.66, 0.9);
    }
    // keep the face clear: below the hairline, in front, near the middle
    if (faceGuard && p.z > 0.25 && p.y < 0.5 && p.y > -1.25) {
      const lim = 0.78 + (p.y < -0.6 ? 0.1 : 0);
      if (Math.abs(p.x) < lim) p.x = Math.sign(p.x || 1) * lerp(Math.abs(p.x), lim, 0.85);
    }
    // torso / shoulders
    if (body && p.y < body.shoulderY + 0.35) {
      const cy = body.shoulderY - 1.4;
      const ex = body.shoulderHalfW * 1.05, ey = 1.55, ez = body.chestDepth * 1.1;
      const kk = (p.x / ex) ** 2 + ((p.y - cy) / ey) ** 2 + (p.z / ez) ** 2;
      if (kk < 1) {
        const s = 1 / Math.sqrt(kk);
        p.x *= s; p.z *= s; p.y = cy + (p.y - cy) * s;
      }
    }
    return p;
  };
}

// Where the hair starts on the scalp, as a height threshold by direction.
function hairlineY(d, line) {
  const f = d.z;
  const temple = line.front - line.temple * Math.min(1, Math.abs(d.x) * 1.6);
  if (f >= 0) return lerp(line.side, temple, Math.pow(f, 0.8));
  return lerp(line.side, line.back, Math.pow(-f, 0.9));
}

function scalpPoint(P, d, lift = 1.0) {
  return sculpt(d, P, v3()).multiplyScalar(lift);
}

// How far the hair mass stands off the scalp, by direction (head units).
function volumeFn(style, line) {
  const g = (d, cx, cy, cz, s) => Math.exp(-((d.x - cx) ** 2 + (d.y - cy) ** 2 + (d.z - cz) ** 2) / (2 * s * s));
  const base = {
    swept: (d) => 0.05 + 0.3 * g(d, 0, 0.6, 0.7, 0.42) + 0.12 * smoothstep(0.1, 0.9, d.y),
    spiky: (d) => 0.06 + 0.24 * g(d, 0, 0.62, 0.65, 0.45) + 0.14 * smoothstep(0.1, 0.9, d.y),
    short: (d) => 0.04 + 0.07 * smoothstep(0.0, 0.9, d.y) + 0.05 * g(d, 0.35, 0.6, 0.6, 0.4),
    messy: (d) => 0.06 + 0.16 * smoothstep(0.0, 0.9, d.y),
    curly: (d) => 0.08 + 0.12 * smoothstep(0.0, 0.9, d.y),
    buzz: () => 0.018,
    bald: () => 0.02,
    long: (d) => 0.05 + 0.05 * smoothstep(0.2, 0.9, d.y),
    wavy: (d) => 0.06 + 0.07 * smoothstep(0.2, 0.9, d.y),
    bob: (d) => 0.06 + 0.06 * smoothstep(0.2, 0.9, d.y),
  }[style] || ((d) => 0.035);
  return (d) => base(d) * (0.35 + 0.65 * smoothstep(hairlineY(d, line), hairlineY(d, line) + 0.25, d.y));
}

function shellPoint(P, d, vol, extra = 0) {
  return sculpt(d, P, v3()).addScaledVector(d, 0.02 + vol(d) + extra);
}

function fibonacciDirs(count, rng) {
  const out = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = ga * i + rng.range(-0.15, 0.15);
    out.push(v3(Math.cos(th) * r, y, Math.sin(th) * r).normalize());
  }
  return out;
}

// Grow a strand by stepping a direction under forces, with collisions.
function grow(P, collide, root, dir0, opts) {
  const pts = [];
  const seg = opts.length / (opts.steps - 1);
  const p = root.clone();
  const dir = dir0.clone().normalize();
  pts.push(p.clone());
  for (let i = 1; i < opts.steps; i++) {
    const t = i / (opts.steps - 1);
    if (opts.force) dir.add(opts.force(p, t, dir)).normalize();
    p.addScaledVector(dir, seg);
    if (opts.wave && t > (opts.waveStart ?? 0.25)) {
      const ph = t * opts.length / opts.waveLen * Math.PI * 2 + opts.wavePhase;
      const lateral = v3(-p.z, 0, p.x).normalize(); // around the head
      p.addScaledVector(lateral, Math.cos(ph) * opts.wave * seg * 2.2);
      p.addScaledVector(p.clone().setY(0).normalize(), Math.sin(ph) * opts.wave * seg * 0.8);
    }
    collide(p, opts.margin ?? 1.06, opts.faceGuard ?? true);
    // re-derive direction from the collided motion so strands slide over the head
    dir.copy(p).sub(pts[pts.length - 1]).normalize();
    pts.push(p.clone());
  }
  return pts;
}

function tangentToward(d, target) {
  // component of target perpendicular to normal d
  return target.clone().addScaledVector(d, -target.dot(d)).normalize();
}

export const HAIR_STYLES = ['swept', 'short', 'messy', 'curly', 'afro', 'long', 'wavy', 'bob', 'ponytail', 'bun', 'braid', 'pigtails', 'bald', 'buzz', 'spiky'];

export function pickHairStyle(spec, rng) {
  const req = spec.hairStyle;
  const map = { spiky: 'spiky', quiff: 'swept', curly: 'curly', afro: 'afro', long: 'long', wavy: 'wavy', short: 'short', messy: 'messy', ponytail: 'ponytail', bun: 'bun', braided: 'braid', braids: 'braid', pigtails: 'pigtails', bald: 'bald', mohawk: 'spiky', straight: 'long' };
  if (req && map[req]) return map[req];
  if (spec.age === 'old') return spec.gender === 'f' ? 'bun' : rng.pick(['bald', 'short']);
  if (spec.age === 'baby') return 'buzz';
  if (spec.gender === 'f') {
    if (spec.age === 'child') return rng.pick(['pigtails', 'ponytail', 'bob', 'wavy', 'braid']);
    return rng.pick(['long', 'wavy', 'long', 'ponytail', 'bob', 'braid']);
  }
  if (spec.age === 'child') return rng.pick(['messy', 'swept', 'curly', 'short']);
  return rng.pick(['swept', 'swept', 'short', 'messy', 'curly']);
}

// Main entry: returns a Group (hair mesh + optional pivoted parts like ponytails).
export function buildHair(P, spec, rng, body) {
  const style = spec.style;
  const color = spec.color;
  const group = new THREE.Group();
  group.userData.style = style;
  if (style === 'none') return group;
  const material = hairMaterial(color);
  const collide = makeCollider(P, body);
  const geos = [];
  const swingParts = [];

  const line = {
    swept: { front: 0.62, temple: 0.22, side: 0.02, back: -0.62 },
    short: { front: 0.6, temple: 0.2, side: 0.0, back: -0.62 },
    messy: { front: 0.58, temple: 0.18, side: 0.0, back: -0.64 },
    spiky: { front: 0.6, temple: 0.2, side: 0.05, back: -0.6 },
    curly: { front: 0.58, temple: 0.15, side: 0.0, back: -0.64 },
    afro: { front: 0.55, temple: 0.1, side: -0.05, back: -0.66 },
    long: { front: 0.6, temple: 0.12, side: -0.1, back: -0.72 },
    wavy: { front: 0.6, temple: 0.12, side: -0.1, back: -0.72 },
    bob: { front: 0.6, temple: 0.12, side: -0.1, back: -0.7 },
    ponytail: { front: 0.6, temple: 0.12, side: -0.08, back: -0.68 },
    bun: { front: 0.6, temple: 0.12, side: -0.08, back: -0.68 },
    braid: { front: 0.6, temple: 0.12, side: -0.08, back: -0.68 },
    pigtails: { front: 0.6, temple: 0.12, side: -0.08, back: -0.68 },
    bald: { front: -0.05, temple: 0.0, side: 0.12, back: -0.55 },
    buzz: { front: 0.6, temple: 0.2, side: 0.05, back: -0.6 },
  }[style] || { front: 0.6, temple: 0.2, side: 0, back: -0.62 };

  // --- scalp cap: the hair mass itself -----------------------------------------
  const vol = volumeFn(style, line);
  const capLift = 1.0;
  {
    const g = new THREE.SphereGeometry(1, 96, 72);
    const pos = g.attributes.position;
    const keep = new Uint8Array(pos.count);
    const d = v3();
    const cc = new THREE.Color(color).multiplyScalar(0.8);
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      d.fromBufferAttribute(pos, i).normalize();
      let hy = hairlineY(d, line);
      let inside = d.y > hy - 0.14;
      if (style === 'bald') inside = d.y < 0.35 && d.y > hy - 0.05 && d.z < 0.25;
      keep[i] = inside ? 1 : 0;
      const sink = style === 'bald' || style === 'afro' ? 0 : 1 - smoothstep(hy - 0.08, hy + 0.08, d.y);
      const p = style === 'afro' ? scalpPoint(P, d, capLift) : shellPoint(P, d, vol, -0.012 - sink * (0.06 + vol(d)));
      if (style === 'afro') {
        const bulk = 1.45 + 0.05 * Math.sin(d.x * 9) * Math.sin(d.y * 11) * Math.sin(d.z * 7);
        const top = smoothstep(-0.4, 0.6, d.y);
        p.multiplyScalar(lerp(1.03, bulk, top));
        p.y += top * 0.2;
      }
      pos.setXYZ(i, p.x, p.y, p.z);
      colors[i * 3] = cc.r; colors[i * 3 + 1] = cc.g; colors[i * 3 + 2] = cc.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const idx = g.index.array;
    const kept = [];
    for (let i = 0; i < idx.length; i += 3) {
      if (keep[idx[i]] && keep[idx[i + 1]] && keep[idx[i + 2]]) kept.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    g.setIndex(kept);
    g.computeVertexNormals();
    geos.push(g);
  }

  const dirs = fibonacciDirs(style === 'curly' || style === 'afro' ? 900 : 620, rng);
  const onScalp = dirs.filter((d) => {
    if (style === 'bald') return d.y < 0.3 && d.y > hairlineY(d, line) && d.z < 0.2;
    return d.y > hairlineY(d, line) + 0.02;
  });

  const add = (pts, w0, w1, flat, opts) => geos.push(clumpGeometry(pts, w0, w1, flat, color, rng, opts));

  if (['swept', 'short', 'messy', 'spiky', 'buzz', 'bald'].includes(style)) {
    // ribbons that lie on the hair mass and follow a combed flow, peeling off at the tips
    const partX = style === 'short' ? 0.32 : 0;
    const shellR = (d) => shellPoint(P, d, vol).length();
    const hug = (p, lift) => { const d = p.clone().normalize(); const r = shellR(d); return d.multiplyScalar(r + lift); };
    const count = style === 'buzz' ? 0 : style === 'bald' ? 120 : 190;
    const roots = onScalp.slice().sort(() => rng() - 0.5).slice(0, count);
    for (const d of roots) {
      const frontness = smoothstep(0.1, 0.8, d.z) * smoothstep(0.0, 0.6, d.y);
      const top = smoothstep(0.15, 0.85, d.y);
      let flowTarget, length, w0 = 0.27, w1 = 0.04, tipLift = 0.07, steps = 14;
      if (style === 'swept') { flowTarget = v3(rng.range(-0.12, 0.12) + d.x * 0.25, 0.35, -1); length = lerp(0.45, 0.95, top) * (0.85 + rng() * 0.3); tipLift = 0.05 + frontness * 0.12; }
      else if (style === 'spiky') { flowTarget = v3(rng.range(-0.3, 0.3) + d.x * 0.3, 0.55, -1); length = lerp(0.45, 0.85, top) * (0.8 + rng() * 0.4); tipLift = 0.1 + frontness * 0.14; w1 = 0.012; w0 = 0.26; }
      else if (style === 'short') { const sd = d.x > partX ? 1 : -1; flowTarget = v3(sd, -0.25 + frontness * 0.3, -0.35); length = lerp(0.35, 0.7, top) * (0.85 + rng() * 0.3); tipLift = 0.04; }
      else if (style === 'messy') { flowTarget = v3(rng.range(-1, 1), rng.range(-0.2, 0.7), rng.range(-1, 0.5)); length = lerp(0.3, 0.6, top) * (0.8 + rng() * 0.5); tipLift = 0.14; w1 = 0.01; }
      else { flowTarget = v3(0, -1, -0.5); length = 0.22; tipLift = 0.01; w0 = 0.1; steps = 6; }
      if (top < 0.05 && style !== 'bald') { flowTarget = v3(d.x * 0.3, -0.7, -0.6); length = 0.26; tipLift = 0.0; w1 = 0.04; }
      const pts = [];
      let p = hug(shellPoint(P, d, vol), -0.025);
      const seg = length / (steps - 1);
      pts.push(p.clone());
      for (let i = 1; i < steps; i++) {
        const t = i / (steps - 1);
        const n = p.clone().normalize();
        const dir = tangentToward(n, flowTarget.clone().add(v3(0, -0.25 * t, 0)));
        p = p.clone().addScaledVector(dir, seg);
        p = hug(p, 0.006 + Math.pow(Math.max(0, t - 0.55) / 0.45, 2) * tipLift);
        collide(p, 1.03, true);
        pts.push(p);
      }
      add(pts, w0 * (0.85 + rng() * 0.3), w1, 0.16, { taper: 1.5, tipLight: 0.12, radial: 10, belly: 0.25, leaf: 0.3 });
    }
    // fringe locks that break up the front hairline
    if (style !== 'buzz' && style !== 'bald') {
      for (let i = 0; i < 22; i++) {
        const x = lerp(-0.62, 0.62, i / 21) + rng.range(-0.03, 0.03);
        const d0 = v3(x, hairlineY(v3(x, 0.6, 0.78).normalize(), line) + 0.03, 0.8).normalize();
        const pts = [];
        const sweep = style === 'short' ? (x > partX ? 1 : -1) : x * 0.6;
        for (let k = 0; k < 9; k++) {
          const t = k / 8;
          const dd = d0.clone().add(v3(sweep * 0.35 * t, (style === 'short' ? 0.15 : 0.55) * t, -0.45 * t)).normalize();
          pts.push(hug(shellPoint(P, dd, vol), 0.004 + t * t * 0.05));
        }
        add(pts, 0.2, 0.02, 0.16, { taper: 1.3, leaf: 0.35, belly: 0.2, radial: 10 });
      }
    }
  } else if (style === 'curly' || style === 'afro') {
    for (const d of onScalp) {
      if (rng() < (style === 'afro' ? 0.45 : 0.4)) continue;
      const base = style === 'afro' ? scalpPoint(P, d, 1.0).multiplyScalar(lerp(1.02, 1.42, smoothstep(-0.4, 0.6, d.y))).add(v3(0, smoothstep(-0.4, 0.6, d.y) * 0.18, 0)) : shellPoint(P, d, vol, -0.02);
      const axis = d.clone().multiplyScalar(0.7).add(v3(0, -0.4, d.z < 0 ? -0.3 : 0)).normalize();
      const a1 = v3().crossVectors(axis, UP).normalize();
      if (a1.lengthSq() < 0.1) a1.set(1, 0, 0);
      const a2 = v3().crossVectors(axis, a1).normalize();
      const turns = rng.range(1.0, 1.8), rad = rng.range(0.06, 0.09), len = style === 'afro' ? 0.12 : rng.range(0.22, 0.34);
      const pts = [];
      const N = 14, ph = rng() * Math.PI * 2;
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const ang = ph + t * turns * Math.PI * 2;
        const p = base.clone().addScaledVector(axis, t * len).addScaledVector(a1, Math.cos(ang) * rad * t).addScaledVector(a2, Math.sin(ang) * rad * t);
        if (style !== 'afro') collide(p, 1.03, true);
        pts.push(p);
      }
      add(pts, 0.1, 0.04, 0.55, { taper: 1, tipLight: 0.1, radial: 7 });
    }
  } else {
    // long styles share flowing strands from a part line
    const partX = rng.chance(0.5) ? 0 : rng.pick([-0.25, 0.25]);
    const lengths = { long: 2.7, wavy: 2.4, bob: 1.35, ponytail: 0, bun: 0, braid: 0, pigtails: 0 };
    const gathered = ['ponytail', 'bun', 'braid', 'pigtails'].includes(style);
    const gatherPts = style === 'pigtails' ? [v3(-0.82, 0.05, -0.35), v3(0.82, 0.05, -0.35)]
      : style === 'bun' ? [v3(0, 0.82, -0.62)]
      : style === 'braid' ? [v3(0, -0.45, -0.95)]
      : [v3(0, 0.25, -1.02)];
    const wave = style === 'wavy' ? 0.13 : style === 'long' ? 0.05 : style === 'bob' ? 0.03 : 0;
    const longRoots = gathered ? onScalp : onScalp.filter((_, i) => i % 3 === 0);
    if (!gathered) {
      // a continuous curtain of hair behind the locks so no gaps show
      const COLS = 72, ROWS = 28;
      const L = lengths[style];
      const th0 = 0.62; // keep the face open (radians from the front)
      const paths = [];
      for (let ci = 0; ci < COLS; ci++) {
        const th = th0 + (ci / (COLS - 1)) * (Math.PI * 2 - th0 * 2);
        const dir = v3(Math.sin(th), 0, Math.cos(th));
        const front = Math.cos(th);
        const hy = lerp(line.side, front > 0 ? line.front - line.temple : line.back, Math.abs(front)) + 0.05;
        const d = v3(dir.x * Math.sqrt(1 - hy * hy), hy, dir.z * Math.sqrt(1 - hy * hy)).normalize();
        const root = shellPoint(P, d, vol, -0.01);
        const pts = grow(P, collide, root, tangentToward(d, v3(dir.x * 0.4, -1, dir.z * 0.4)), {
          length: L * (0.95 + 0.08 * Math.sin(ci * 1.7)), steps: ROWS, margin: 1.05,
          wave, waveLen: 0.6, wavePhase: ci * 0.21, waveStart: 0.3,
          force: (p, t) => { const f = v3(0, -0.25 - t * 0.2, 0); const out = p.clone().setY(0); if (out.lengthSq() > 1e-4) f.addScaledVector(out.normalize(), 0.06 * (1 - t)); if (style === 'bob' && t > 0.75) f.add(p.clone().setY(0).normalize().multiplyScalar(-0.25)); return f; },
        });
        paths.push(pts);
      }
      const pos = [], col = [], uvs = [], idx = [];
      const cc = new THREE.Color(color);
      for (let ci = 0; ci < COLS; ci++) for (let r = 0; r < ROWS; r++) {
        const p = paths[ci][r];
        pos.push(p.x, p.y, p.z);
        const sh = lerp(0.72, 1.05, r / (ROWS - 1)) * (0.95 + 0.05 * Math.sin(ci * 2.3));
        col.push(cc.r * sh, cc.g * sh, cc.b * sh);
        uvs.push(r / (ROWS - 1) * 2, ci / (COLS - 1) * 8);
      }
      for (let ci = 0; ci < COLS - 1; ci++) for (let r = 0; r < ROWS - 1; r++) {
        const a = ci * ROWS + r, b = a + 1, c2 = a + ROWS, d2 = c2 + 1;
        idx.push(a, c2, b, b, c2, d2);
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      cg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      cg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      cg.setIndex(idx);
      cg.computeVertexNormals();
      const curtain = new THREE.Mesh(cg, material.clone());
      curtain.material.side = THREE.DoubleSide;
      curtain.castShadow = true;
      group.add(curtain);
    }
    for (const d of longRoots) {
      const root = shellPoint(P, d, vol, -0.03);
      if (gathered) {
        // comb every strand along the scalp toward the nearest gather point
        const G = gatherPts.reduce((a, b) => (b.distanceTo(root) < a.distanceTo(root) ? b : a));
        const gd = G.clone().normalize();
        const pts = [];
        const N = 10;
        const ang = d.angleTo(gd);
        for (let i = 0; i < N; i++) {
          const t = i / (N - 1);
          const dd = d.clone().lerp(gd, t).normalize();
          pts.push(shellPoint(P, dd, vol, 0.004 + 0.012 * Math.sin(Math.PI * t)));
        }
        if (ang < 0.05) continue;
        add(pts, 0.17, 0.1, 0.22, { taper: 1, tipLight: 0.06, leaf: 0.15 });
        continue;
      }
      const s = d.x >= partX ? 1 : -1;
      const front = smoothstep(0.2, 0.9, d.z);
      const flow = tangentToward(d, v3(s * (0.8 + front * 0.6), -0.3, -0.25 - (1 - front) * 0.4));
      const dir0 = flow.clone().addScaledVector(d, 0.35).normalize();
      const L = lengths[style] * (0.88 + rng() * 0.22) * (front > 0.6 && style !== 'bob' ? 0.92 : 1);
      const pts = grow(P, collide, root, dir0, {
        length: L, steps: style === 'bob' ? 14 : 22, margin: 1.05,
        wave, waveLen: 0.55 + rng() * 0.2, wavePhase: rng() * Math.PI * 2 + (s > 0 ? 0 : 1.3), waveStart: 0.3,
        force: (p, t) => {
          const f = v3(0, -0.22 - t * 0.2, 0);
          // a gentle outward push gives volume around the head
          const out = p.clone().setY(0);
          if (out.lengthSq() > 1e-4) f.addScaledVector(out.normalize(), 0.05 * (1 - t));
          if (style === 'bob' && t > 0.75) f.add(p.clone().setY(0).normalize().multiplyScalar(-0.25)); // tuck ends under
          return f;
        },
      });
      add(pts, 0.3 * (0.85 + rng() * 0.3), 0.04, 0.14, { taper: 1.3, tipLight: 0.16, leaf: 0.12, belly: 0.2, radial: 10 });
    }
    // gathered styles: the ponytail / bun / braid itself
    if (style === 'ponytail' || style === 'pigtails') {
      for (const G of gatherPts) {
        const pivot = new THREE.Group();
        pivot.position.copy(G);
        const parts = [];
        const L = style === 'pigtails' ? 1.1 : 1.9;
        const outDir = G.clone().normalize();
        for (let i = 0; i < 26; i++) {
          const off = v3(rng.range(-0.08, 0.08), rng.range(-0.08, 0.08), rng.range(-0.05, 0.05));
          const pts = [];
          const N = 16;
          for (let k = 0; k < N; k++) {
            const t = k / (N - 1);
            const p = off.clone().multiplyScalar(1 - t * 0.3)
              .addScaledVector(outDir, Math.sin(Math.min(1, t * 2.2) * Math.PI / 2) * 0.35)
              .add(v3(0, -t * t * L, 0))
              .add(v3(Math.sin(t * 6 + i) * 0.04 * t, 0, Math.cos(t * 5 + i) * 0.04 * t));
            pts.push(p);
          }
          parts.push(clumpGeometry(pts, 0.1, 0.02, 0.5, color, rng, { taper: 1.1, tipLight: 0.15 }));
        }
        const mesh = new THREE.Mesh(mergeGeometries(parts), material);
        mesh.castShadow = true;
        pivot.add(mesh);
        const tie = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.04, 8, 20), new THREE.MeshPhysicalMaterial({ color: spec.tieColor ?? 0xe0457b, roughness: 0.5 }));
        tie.lookAt(outDir);
        pivot.add(tie);
        group.add(pivot);
        swingParts.push(pivot);
      }
    }
    if (style === 'bun') {
      const bun = new THREE.Mesh(new THREE.TorusKnotGeometry(0.22, 0.11, 96, 10, 2, 3), material);
      const bc = new THREE.Color(color).multiplyScalar(0.95);
      const n = bun.geometry.attributes.position.count;
      const cols = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { cols[i * 3] = bc.r; cols[i * 3 + 1] = bc.g; cols[i * 3 + 2] = bc.b; }
      bun.geometry.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      bun.position.copy(gatherPts[0]).multiplyScalar(1.12);
      bun.lookAt(gatherPts[0].clone().multiplyScalar(3));
      bun.castShadow = true;
      group.add(bun);
    }
    if (style === 'braid') {
      const pivot = new THREE.Group();
      pivot.position.copy(gatherPts[0]);
      const segs = [];
      const N = 11;
      const bc = new THREE.Color(color);
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const sg = new THREE.SphereGeometry(1, 16, 12);
        const sx = lerp(0.2, 0.13, t), sy = 0.17, sz = lerp(0.15, 0.1, t);
        sg.scale(sx, sy, sz);
        sg.rotateZ((i % 2 ? 1 : -1) * 0.55);
        sg.translate(0, -0.18 - i * 0.2, -0.05 - Math.sin(t * 1.4) * 0.1);
        const n = sg.attributes.position.count;
        const cols = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) { const sh = 0.9 + (i % 2) * 0.08; cols[k * 3] = bc.r * sh; cols[k * 3 + 1] = bc.g * sh; cols[k * 3 + 2] = bc.b * sh; }
        sg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        segs.push(sg);
      }
      const braid = new THREE.Mesh(mergeGeometries(segs), material);
      braid.castShadow = true;
      pivot.add(braid);
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 16), new THREE.MeshPhysicalMaterial({ color: spec.tieColor ?? 0xd9443b, roughness: 0.5 }));
      tie.rotation.x = Math.PI / 2;
      tie.position.set(0, -0.2 - N * 0.2, -0.15);
      pivot.add(tie);
      const tassel = [];
      for (let i = 0; i < 10; i++) {
        const pts = [];
        for (let k = 0; k < 6; k++) pts.push(v3(rng.range(-0.04, 0.04) * k * 0.4, -0.2 - N * 0.2 - k * 0.05, -0.15 + rng.range(-0.03, 0.03)));
        tassel.push(clumpGeometry(pts, 0.05, 0.01, 0.6, color, rng));
      }
      pivot.add(new THREE.Mesh(mergeGeometries(tassel), material));
      group.add(pivot);
      swingParts.push(pivot);
    }
    // a little fringe for gathered styles so the hairline isn't a hard edge
    if (gathered) {
      for (let i = 0; i < 16; i++) {
        const x = lerp(-0.6, 0.6, i / 15) + rng.range(-0.03, 0.03);
        const d0 = v3(x, 0.5, 0.8).normalize();
        const pts = [];
        for (let k = 0; k < 8; k++) {
          const t = k / 7;
          const dd = d0.clone().add(v3(x * 0.4 * t, 0.5 * t, -0.6 * t)).normalize();
          pts.push(shellPoint(P, dd, vol, 0.006));
        }
        add(pts, 0.14, 0.05, 0.22, { taper: 1, leaf: 0.3 });
      }
    }
  }

  const merged = mergeGeometries(geos.map((g) => (g.index ? g : g)), false);
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  group.userData.swingParts = swingParts;
  group.userData.material = material;
  return group;
}
