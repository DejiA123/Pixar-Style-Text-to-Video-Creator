// Sculpted hair: every lock is a chain of flattened round cones; locks are
// smooth-unioned with each other (leaving soft grooves between them) and with
// an optional hair mass, then polygonized with surface nets. Each vertex gets
// the flow direction of its nearest lock as a tangent (for the anisotropic
// highlight and strand-groove normal map), a UV running along the lock, and a
// root-to-tip colour.
import * as THREE from 'three';
import { smin, sampleGrid, meshGrid, gridDims } from './sdf.js';
import { gpuLockGrid } from './gpufield.js';
import { lerp, smoothstep } from '../../util.js';

const BIG = 1e3;

export class LockField {
  // locks: [{ pts: Vector3[], w: number[], t: number[], shade?: number }]
  // mass: optional (x, y, z) => distance
  constructor(locks, opts = {}) {
    this.k = opts.k ?? 0.03;
    this.massK = opts.massK ?? 0.05;
    this.mass = opts.mass || null;
    const segs = [];
    const box = new THREE.Box3();
    locks = locks.map((L) => resampleLock(L, opts.step ?? 0.045));
    this.locks = locks;
    locks.forEach((L, li) => {
      const n = L.pts.length;
      for (let i = 0; i < n - 1; i++) {
        const a = L.pts[i], b = L.pts[i + 1];
        const ax = b.clone().sub(a);
        const len = ax.length();
        if (len < 1e-5) continue;
        ax.divideScalar(len);
        // thickness direction: away from the head centre, perpendicular to the lock
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const nrm = (L.up ? L.up.clone() : mid.clone().setLength(1)).addScaledVector(ax, -(L.up ? L.up.dot(ax) : mid.clone().setLength(1).dot(ax)));
        if (nrm.lengthSq() < 1e-6) nrm.set(0, 0, 1).addScaledVector(ax, -ax.z);
        nrm.normalize();
        const lat = new THREE.Vector3().crossVectors(ax, nrm).normalize();
        const s = {
          lock: li, ax: a.x, ay: a.y, az: a.z, dx: ax.x, dy: ax.y, dz: ax.z, len,
          nx: nrm.x, ny: nrm.y, nz: nrm.z, lx: lat.x, ly: lat.y, lz: lat.z,
          wa: L.w[i], wb: L.w[i + 1], ta: L.t[i], tb: L.t[i + 1],
          u0: L.u ? L.u[i] : i / (n - 1), u1: L.u ? L.u[i + 1] : (i + 1) / (n - 1),
          wm: Math.max(L.w[i], L.w[i + 1]), tm: Math.max(L.t[i], L.t[i + 1]),
        };
        segs.push(s);
        const r = Math.max(s.wa, s.wb, s.ta, s.tb);
        box.expandByPoint(new THREE.Vector3(Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.min(a.z, b.z) - r));
        box.expandByPoint(new THREE.Vector3(Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, Math.max(a.z, b.z) + r));
      }
    });
    if (opts.massBox) box.union(opts.massBox);
    this.segs = segs;
    this.box = box;
    // uniform bucket grid; each segment goes into every bucket its padded box touches
    const C = (this.cell = opts.cell ?? 0.07);
    const pad = opts.pad ?? 0.1;
    this.min = box.min.clone().subScalar(pad + C);
    const size = box.max.clone().addScalar(pad + C).sub(this.min);
    this.nx = Math.ceil(size.x / C); this.ny = Math.ceil(size.y / C); this.nz = Math.ceil(size.z / C);
    const lists = new Map();
    segs.forEach((s, si) => {
      const r = Math.max(s.wa, s.wb, s.ta, s.tb) + pad;
      const x0 = Math.min(s.ax, s.ax + s.dx * s.len) - r, x1 = Math.max(s.ax, s.ax + s.dx * s.len) + r;
      const y0 = Math.min(s.ay, s.ay + s.dy * s.len) - r, y1 = Math.max(s.ay, s.ay + s.dy * s.len) + r;
      const z0 = Math.min(s.az, s.az + s.dz * s.len) - r, z1 = Math.max(s.az, s.az + s.dz * s.len) + r;
      for (let k = this.bi(z0, 2); k <= this.bi(z1, 2); k++) for (let j = this.bi(y0, 1); j <= this.bi(y1, 1); j++) for (let i = this.bi(x0, 0); i <= this.bi(x1, 0); i++) {
        const key = (k * this.ny + j) * this.nx + i;
        let l = lists.get(key);
        if (!l) lists.set(key, (l = []));
        l.push(si);
      }
    });
    this.buckets = lists; // segment ids are pushed in lock order, so each list is grouped by lock
    this.f = (x, y, z) => this.eval(x, y, z);
  }
  bi(v, axis) {
    const m = axis === 0 ? this.min.x : axis === 1 ? this.min.y : this.min.z;
    const n = axis === 0 ? this.nx : axis === 1 ? this.ny : this.nz;
    return Math.max(0, Math.min(n - 1, Math.floor((v - m) / this.cell)));
  }
  segDist(s, x, y, z) {
    const px = x - s.ax, py = y - s.ay, pz = z - s.az;
    let h = (px * s.dx + py * s.dy + pz * s.dz) / s.len;
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const ox = px - s.dx * s.len * h, oy = py - s.dy * s.len * h, oz = pz - s.dz * s.len * h;
    const w = s.wa + (s.wb - s.wa) * h, t = s.ta + (s.tb - s.ta) * h;
    const on = ox * s.nx + oy * s.ny + oz * s.nz;
    const ol = ox * s.lx + oy * s.ly + oz * s.lz;
    const oa = ox * s.dx + oy * s.dy + oz * s.dz;
    // ellipsoid-ish distance with radii (w, t, t)
    const a = ol / w, b = on / t, c = oa / t;
    const k0 = Math.sqrt(a * a + b * b + c * c);
    const a2 = a / w, b2 = b / t, c2 = c / t;
    const k1 = Math.sqrt(a2 * a2 + b2 * b2 + c2 * c2);
    return k1 < 1e-9 ? -t : (k0 * (k0 - 1)) / k1;
  }
  eval(x, y, z) {
    let d = this.mass ? this.mass(x, y, z) : BIG;
    const i = Math.floor((x - this.min.x) / this.cell), j = Math.floor((y - this.min.y) / this.cell), k = Math.floor((z - this.min.z) / this.cell);
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return d === BIG ? this.cell : d;
    const list = this.buckets.get((k * this.ny + j) * this.nx + i);
    if (!list) return d === BIG ? this.cell : d;
    let cur = -1, cm = BIG, acc = BIG;
    for (let q = 0; q < list.length; q++) {
      const s = this.segs[list[q]];
      if (s.lock !== cur) {
        if (cm < BIG) acc = acc === BIG ? cm : smin(acc, cm, this.k);
        cur = s.lock; cm = BIG;
      }
      // skip segments that can't lower this lock's distance or touch the blend
      const thr = Math.min(cm, acc + this.k, d + this.massK);
      const px = x - s.ax, py = y - s.ay, pz = z - s.az;
      const on = px * s.nx + py * s.ny + pz * s.nz;
      if ((on < 0 ? -on : on) - s.tm > thr) continue;
      const al = px * s.dx + py * s.dy + pz * s.dz;
      if (al < -s.tm - thr || al > s.len + s.tm + thr) continue;
      const ol = px * s.lx + py * s.ly + pz * s.lz;
      if ((ol < 0 ? -ol : ol) - s.wm > thr) continue;
      const sd = this.segDist(s, x, y, z);
      if (sd < cm) cm = sd;
    }
    if (cm < BIG) acc = acc === BIG ? cm : smin(acc, cm, this.k);
    if (acc === BIG) return d === BIG ? this.cell : d;
    return d === BIG ? acc : smin(d, acc, this.massK);
  }
  // nearest lock segment to a point: { seg, h, d }
  nearest(x, y, z) {
    const i = this.bi(x, 0), j = this.bi(y, 1), k = this.bi(z, 2);
    const list = this.buckets.get((k * this.ny + j) * this.nx + i);
    let best = null, bd = BIG, bh = 0;
    if (!list) return null;
    for (const si of list) {
      const s = this.segs[si];
      const d = this.segDist(s, x, y, z);
      if (d < bd) {
        bd = d; best = s;
        const px = x - s.ax, py = y - s.ay, pz = z - s.az;
        bh = Math.max(0, Math.min(1, (px * s.dx + py * s.dy + pz * s.dz) / s.len));
      }
    }
    return best ? { seg: best, h: bh, d: bd } : null;
  }
}

// Re-sample a lock along a Catmull-Rom spline so joints don't show as kinks.
export function resampleLock(L, step) {
  const n = L.pts.length;
  if (n < 3) return L;
  const curve = new THREE.CatmullRomCurve3(L.pts, false, 'centripetal');
  const len = curve.getLength();
  const m = Math.max(n, Math.ceil(len / step) + 1);
  const pts = [], w = [], t = [], u = [];
  for (let i = 0; i < m; i++) {
    const q = i / (m - 1);
    pts.push(curve.getPointAt(q));
    // profiles are indexed by the original points' parameter
    const f = q * (n - 1), i0 = Math.min(n - 2, Math.floor(f)), a = f - i0;
    w.push(lerp(L.w[i0], L.w[i0 + 1], a));
    t.push(lerp(L.t[i0], L.t[i0 + 1], a));
    u.push(L.u ? lerp(L.u[i0], L.u[i0 + 1], a) : q);
  }
  return { ...L, pts, w, t, u };
}

// Mesh a LockField and decorate it with tangents, UVs and colours.
// flowAt(p) → Vector3 gives the comb direction for vertices that belong to the mass.
export function meshLocks(field, opts = {}) {
  const h = opts.h ?? 0.016;
  const pad = 0.06;
  const b = field.box;
  const min = [b.min.x - pad, b.min.y - pad, b.min.z - pad], max = [b.max.x + pad, b.max.y + pad, b.max.z + pad];
  const [nx, ny, nz] = gridDims(min, max, h);
  const t0 = performance.now();
  let vals = opts.cpu ? null : gpuLockGrid(field, min, nx, ny, nz, h);
  const gpu = !!vals;
  if (vals && field.mass) {
    const m = sampleGrid(field.mass, min, max, h).vals;
    const far = field.cell * 0.999;
    for (let i = 0; i < vals.length; i++) vals[i] = vals[i] >= far ? m[i] : smin(m[i], vals[i], field.massK);
  }
  if (!vals) vals = sampleGrid(field.f, min, max, h).vals;
  const geo = meshGrid(vals, nx, ny, nz, min, h);
  if (opts.log !== false && typeof window !== 'undefined' && window.__hairLog) console.log(`hair field ${gpu ? 'GPU' : 'CPU'} ${nx}x${ny}x${nz} ${(performance.now() - t0).toFixed(0)}ms`);
  const pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
  const n = pos.length / 3;
  const tan = new Float32Array(n * 4), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
  const base = new THREE.Color(opts.color ?? 0x3a2a20);
  const root = base.clone().multiplyScalar(opts.rootDark ?? 0.55);
  const tip = base.clone().lerp(new THREE.Color(0xffe2b0), opts.tipLight ?? 0.12);
  const lockShade = opts.lockShade || (() => 1);
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    N.set(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
    const near = field.nearest(x, y, z);
    let u = 0, across = 0, shade = 1, tt = 0.5;
    const onMass = !near || (field.mass && field.mass(x, y, z) < near.d - 0.01);
    if (!onMass) {
      const s = near.seg;
      T.set(s.dx, s.dy, s.dz);
      u = (s.u0 + (s.u1 - s.u0) * near.h);
      tt = u;
      // position across the lock, in head units: lateral offset + a little of the thickness side
      const px = x - s.ax, py = y - s.ay, pz = z - s.az;
      across = (px * s.lx + py * s.ly + pz * s.lz) + 0.3 * (px * s.nx + py * s.ny + pz * s.nz);
      shade = lockShade(s.lock);
    } else {
      T.copy(opts.flowAt ? opts.flowAt(x, y, z) : new THREE.Vector3(0, -1, 0));
      u = -y * 0.5;
      across = Math.atan2(x, z) * 0.9;
      tt = 0.15;
    }
    // make the tangent perpendicular to the normal
    T.addScaledVector(N, -T.dot(N));
    if (T.lengthSq() < 1e-8) { B.set(0, 1, 0).cross(N); T.copy(B); }
    T.normalize();
    tan[v * 4] = T.x; tan[v * 4 + 1] = T.y; tan[v * 4 + 2] = T.z; tan[v * 4 + 3] = 1;
    uv[v * 2] = u * (opts.uScale ?? 3);
    uv[v * 2 + 1] = across * (opts.vScale ?? 1.4);
    // colour: darker at roots and in the grooves (via the ambient-occlusion-ish depth term)
    const c = root.clone().lerp(base, smoothstep(0, 0.35, tt)).lerp(tip, smoothstep(0.55, 1, tt) * 0.8).multiplyScalar(shade);
    col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
  }
  geo.setAttribute('tangent', new THREE.BufferAttribute(tan, 4));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Width/thickness profile along a lock, matching the old ribbon parameters.
export function lockProfile(n, w0, w1, flat, opts = {}) {
  const w = [], t = [];
  const minT = opts.minT ?? 0.02;
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    const taper = opts.taper ?? 0.75;
    const body = opts.belly ? 1 + opts.belly * Math.sin(Math.PI * Math.min(1, s * 1.4)) : 1;
    const leaf = opts.leaf ? 0.3 + 0.7 * smoothstep(0, opts.leaf, s) : 1;
    // the last stretch narrows to a point
    const tipK = s > 0.78 ? lerp(1, 0.25, smoothstep(0.78, 1, s)) : 1;
    const ww = Math.max(minT, lerp(w0, w1, Math.pow(s, taper)) * body * leaf) * tipK;
    w.push(ww);
    t.push(Math.max(minT, Math.min(ww, ww * flat)) * tipK);
  }
  return { w, t };
}

// ---- strands ---------------------------------------------------------------------
// Thousands of thin ribbons grown along the guide locks. Each strand keeps a
// fixed offset inside its lock's cross-section that shrinks toward the tip, so
// strands clump into points; the ribbons are expanded to face the camera in the
// vertex shader (see strandMaterial).
export function buildStrands(locks, opts = {}) {
  const rnd = mulberry(opts.seed ?? 7);
  const density = opts.density ?? 520; // strands per unit of lock width
  const width = opts.width ?? 0.0075;
  const base = new THREE.Color(opts.color ?? 0x3a2a20);
  const pos = [], tan = [], nor = [], col = [], side = [], wid = [];
  const idx = [];
  const n = new THREE.Vector3(), l = new THREE.Vector3(), d = new THREE.Vector3(), o = new THREE.Vector3(), mid = new THREE.Vector3();
  let vert = 0;
  for (const L of locks) {
    const m = L.pts.length;
    if (m < 2) continue;
    // per-point frames
    const frames = [];
    for (let i = 0; i < m; i++) {
      const a = L.pts[Math.max(0, i - 1)], b = L.pts[Math.min(m - 1, i + 1)];
      d.subVectors(b, a).normalize();
      mid.copy(L.pts[i]);
      n.copy(L.up || mid).normalize().addScaledVector(d, -(L.up || mid).clone().normalize().dot(d));
      if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
      n.normalize();
      l.crossVectors(d, n).normalize();
      frames.push([d.clone(), n.clone(), l.clone()]);
    }
    const maxW = Math.max(...L.w);
    const count = Math.max(6, Math.round(maxW * 2 * density * (opts.densityScale ?? 1)));
    const stride = Math.max(1, Math.round((opts.step ?? 0.07) / 0.045));
    for (let sI = 0; sI < count; sI++) {
      // position in the cross-section (biased to the outer side, which is what shows)
      const r = Math.sqrt(rnd()), th = rnd() * Math.PI * 2;
      const a = r * Math.cos(th) * 1.05, b = rnd() < 0.85 ? 0.45 + 0.6 * rnd() : -0.3 * rnd();
      const end = 1 - rnd() * 0.18;
      const clumpTo = 0.12 + rnd() * 0.2;
      const shade = 0.82 + rnd() * 0.32;
      const hueJ = (rnd() - 0.5) * 0.04;
      const frizz = rnd() * Math.PI * 2;
      const cBase = base.clone().offsetHSL(hueJ, 0, 0);
      const last = Math.max(1, Math.floor((m - 1) * end));
      const sample = [];
      for (let i = 0; i <= last; i += stride) sample.push(i);
      if (sample[sample.length - 1] !== last) sample.push(last);
      const k = sample.length;
      for (let q = 0; q < k; q++) {
        const i = sample[q];
        const s = i / (m - 1);
        const [D, N, Lt] = frames[i];
        const clump = lerp(1, clumpTo, smoothstep(0.35, 1, s / end));
        const fr = 0.004 * Math.sin(s * 23 + frizz) * smoothstep(0.2, 1, s);
        o.copy(L.pts[i]).addScaledVector(Lt, a * L.w[i] * clump + fr).addScaledVector(N, b * L.t[i] * clump * 0.95);
        const nn = N.clone().multiplyScalar(0.75).addScaledVector(Lt, a * 0.45 * clump).addScaledVector(N, b * 0.2).normalize();
        const tq = q / (k - 1);
        const c = cBase.clone().multiplyScalar(shade * lerp(opts.rootDark ?? 0.6, 1, smoothstep(0, 0.25, s)) * (1 + (opts.tipLight ?? 0.1) * smoothstep(0.6, 1, s)));
        const wv = width * (1 - 0.85 * smoothstep(0.75, 1, tq));
        for (const sd of [-1, 1]) {
          pos.push(o.x, o.y, o.z);
          tan.push(D.x, D.y, D.z, 1);
          nor.push(nn.x, nn.y, nn.z);
          col.push(c.r, c.g, c.b);
          side.push(sd);
          wid.push(wv);
        }
        if (q > 0) { const v0 = vert + (q - 1) * 2; idx.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2); }
      }
      vert += k * 2;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('tangent', new THREE.Float32BufferAttribute(tan, 4));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute('aWidth', new THREE.Float32BufferAttribute(wid, 1));
  g.setIndex(vert > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  if (g.boundingSphere) g.boundingSphere.radius += 0.1;
  return g;
}

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
