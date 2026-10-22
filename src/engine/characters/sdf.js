// Signed-distance sculpting: smooth-blended primitives polygonized with
// surface nets. This is how the heads and hair masses get soft, seamless,
// "sculpted" forms (nose wings, lids, brow, cheeks) that a displaced sphere
// can't represent.
import * as THREE from 'three';

// Approximate ellipsoid distance (iq). Exact enough for blending and tracing.
export function sdEllipsoid(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const x = (px - cx) / rx, y = (py - cy) / ry, z = (pz - cz) / rz;
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const x2 = x / rx, y2 = y / ry, z2 = z / rz;
  const k1 = Math.sqrt(x2 * x2 + y2 * y2 + z2 * z2);
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

export function sdSphere(px, py, pz, cx, cy, cz, r) {
  const x = px - cx, y = py - cy, z = pz - cz;
  return Math.sqrt(x * x + y * y + z * z) - r;
}

// Capsule from a to b with radius ra at a and rb at b (a cheap "round cone").
export function sdCapsule(px, py, pz, ax, ay, az, bx, by, bz, ra, rb = ra) {
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  const x = pax - bax * h, y = pay - bay * h, z = paz - baz * h;
  return Math.sqrt(x * x + y * y + z * z) - (ra + (rb - ra) * h);
}

// Polynomial smooth min / max.
export function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a, b, k) { return -smin(-a, -b, k); }

export function gradient(f, x, y, z, e = 0.002, out = new THREE.Vector3()) {
  out.set(
    f(x + e, y, z) - f(x - e, y, z),
    f(x, y + e, z) - f(x, y - e, z),
    f(x, y, z + e) - f(x, y, z - e),
  );
  const l = out.length();
  return l > 1e-12 ? out.multiplyScalar(1 / l) : out.set(0, 0, 1);
}

// March from `o` along unit dir `d` until the surface is hit (or tMax passed).
export function trace(f, ox, oy, oz, dx, dy, dz, tMax = 4, eps = 1e-4) {
  let t = 0;
  for (let i = 0; i < 160; i++) {
    const d = f(ox + dx * t, oy + dy * t, oz + dz * t);
    if (d < eps) {
      // refine by bisection against the previous step
      let lo = Math.max(0, t - Math.max(0.02, Math.abs(d) * 2)), hi = t;
      if (f(ox + dx * lo, oy + dy * lo, oz + dz * lo) > 0) {
        for (let k = 0; k < 14; k++) {
          const m = (lo + hi) / 2;
          if (f(ox + dx * m, oy + dy * m, oz + dz * m) > 0) lo = m; else hi = m;
        }
        return (lo + hi) / 2;
      }
      return t;
    }
    t += Math.max(d * 0.8, 0.0015);
    if (t > tMax) return -1;
  }
  return -1;
}

// Surface nets over a box with a narrow band: a coarse pass skips samples far
// from the surface. Returns an indexed BufferGeometry with gradient normals.
export function gridDims(min, max, h) {
  return [Math.ceil((max[0] - min[0]) / h) + 1, Math.ceil((max[1] - min[1]) / h) + 1, Math.ceil((max[2] - min[2]) / h) + 1];
}

// Sample f on a grid, exactly only within a narrow band around the surface.
// `pre(i, j, k)` (optional) supplies a known value to combine instead.
export function sampleGrid(f, min, max, h) {
  const [nx, ny, nz] = gridDims(min, max, h);
  const C = 4;
  const cx = Math.ceil((nx - 1) / C) + 1, cy = Math.ceil((ny - 1) / C) + 1, cz = Math.ceil((nz - 1) / C) + 1;
  const coarse = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    coarse[(k * cy + j) * cx + i] = f(min[0] + i * C * h, min[1] + j * C * h, min[2] + k * C * h);
  }
  const band = C * h * 0.95;
  const vals = new Float32Array(nx * ny * nz);
  const CI = new Int32Array(nx).map((_, i) => Math.min(cx - 1, Math.round(i / C)));
  let o = 0;
  for (let k = 0; k < nz; k++) {
    const z = min[2] + k * h, ck = Math.min(cz - 1, Math.round(k / C));
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * h, cj = Math.min(cy - 1, Math.round(j / C));
      const row = (ck * cy + cj) * cx;
      for (let i = 0; i < nx; i++, o++) {
        const dc = coarse[row + CI[i]];
        vals[o] = dc > band || dc < -band ? dc : f(min[0] + i * h, y, z);
      }
    }
  }
  return { vals, nx, ny, nz };
}

export function surfaceNets(f, min, max, h, opts = {}) {
  const { vals, nx, ny, nz } = sampleGrid(f, min, max, h);
  return meshGrid(vals, nx, ny, nz, min, h, { ...opts, f });
}

// Surface nets over precomputed samples. Returns an indexed BufferGeometry.
export function meshGrid(vals, nx, ny, nz, min, h, opts = {}) {
  const f = opts.f;
  const V = (i, j, k) => vals[(k * ny + j) * nx + i];
  // one vertex per sign-changing cell; normals from the grid's central differences
  const cellIndex = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const pos = [], nrm = [];
  const corner = new Float32Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const off = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const Vc = (i, j, k) => V(Math.max(0, Math.min(nx - 1, i)), Math.max(0, Math.min(ny - 1, j)), Math.max(0, Math.min(nz - 1, k)));
  const gx = new Float32Array(8), gy = new Float32Array(8), gz = new Float32Array(8);
  const skip = h * (opts.skip ?? 6);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v00 = vals[(k * ny + j) * nx + i];
    if (v00 > skip || v00 < -skip) continue;
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = V(i + off[c][0], j + off[c][1], k + off[c][2]);
      corner[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) {
      const da = corner[a], db = corner[b];
      if ((da < 0) === (db < 0)) continue;
      const t = da / (da - db);
      sx += off[a][0] + (off[b][0] - off[a][0]) * t;
      sy += off[a][1] + (off[b][1] - off[a][1]) * t;
      sz += off[a][2] + (off[b][2] - off[a][2]) * t;
      n++;
    }
    const fx = sx / n, fy = sy / n, fz = sz / n;
    cellIndex[(k * (ny - 1) + j) * (nx - 1) + i] = pos.length / 3;
    pos.push(min[0] + (i + fx) * h, min[1] + (j + fy) * h, min[2] + (k + fz) * h);
    let ox = 0, oy = 0, oz = 0;
    for (let c = 0; c < 8; c++) {
      const ci = i + off[c][0], cj = j + off[c][1], ck = k + off[c][2];
      const w = (off[c][0] ? fx : 1 - fx) * (off[c][1] ? fy : 1 - fy) * (off[c][2] ? fz : 1 - fz);
      ox += w * (Vc(ci + 1, cj, ck) - Vc(ci - 1, cj, ck));
      oy += w * (Vc(ci, cj + 1, ck) - Vc(ci, cj - 1, ck));
      oz += w * (Vc(ci, cj, ck + 1) - Vc(ci, cj, ck - 1));
    }
    const l = Math.hypot(ox, oy, oz) || 1;
    nrm.push(ox / l, oy / l, oz / l);
  }
  void gx; void gy; void gz;
  const cell = (i, j, k) => cellIndex[(k * (ny - 1) + j) * (nx - 1) + i];
  const quads = [];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const vv = vals[(k * ny + j) * nx + i];
    const v0 = vv < 0;
    // winding from which side is inside: quads face outward
    if (v0 !== (V(i + 1, j, k) < 0)) { const q = [cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k)]; if (!v0) q.reverse(); quads.push(...q); }
    if (v0 !== (V(i, j + 1, k) < 0)) { const q = [cell(i - 1, j, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i - 1, j, k)]; if (v0) q.reverse(); quads.push(...q); }
    if (v0 !== (V(i, j, k + 1) < 0)) { const q = [cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k)]; if (!v0) q.reverse(); quads.push(...q); }
  }
  // optional: project vertices onto the true surface (costly, sharper features)
  const P = new Float32Array(pos);
  const N = new Float32Array(nrm);
  const g = new THREE.Vector3();
  const iters = opts.project ?? 0;
  if (iters > 0) for (let v = 0; v < P.length; v += 3) {
    let x = P[v], y = P[v + 1], z = P[v + 2];
    for (let it = 0; it < iters; it++) {
      const d = f(x, y, z);
      gradient(f, x, y, z, h * 0.25, g);
      const s = Math.max(-h, Math.min(h, d));
      x -= g.x * s; y -= g.y * s; z -= g.z * s;
    }
    P[v] = x; P[v + 1] = y; P[v + 2] = z;
  }
  if (opts.exactNormals && f) for (let v = 0; v < P.length; v += 3) {
    gradient(f, P[v], P[v + 1], P[v + 2], h * 0.4, g);
    N[v] = g.x; N[v + 1] = g.y; N[v + 2] = g.z;
  }
  // triangulate: orient each triangle along the surface normal, split on the short diagonal
  const idx = [];
  const tri = (a, b, c) => idx.push(a, b, c);
  const d2 = (a, b) => { const x = P[a * 3] - P[b * 3], y = P[a * 3 + 1] - P[b * 3 + 1], z = P[a * 3 + 2] - P[b * 3 + 2]; return x * x + y * y + z * z; };
  for (let q = 0; q < quads.length; q += 4) {
    const a = quads[q], b = quads[q + 1], c = quads[q + 2], d = quads[q + 3];
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    if (d2(a, c) <= d2(b, d)) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
