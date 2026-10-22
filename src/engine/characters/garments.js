// Sculpted, skinned clothing. The body is described as smooth-blended
// primitives placed on the rig's rest (A-pose) joint positions; every garment
// is an offset of the body parts it covers, with sleeves, hems, necklines and
// openings cut in, ribbed collars and cuffs added, and fabric folds displaced
// into the surface. Each garment is meshed with surface nets and bound to the
// skeleton with smooth weights, so shirts, sleeves and trousers stay one
// continuous piece of cloth as the character moves.
import * as THREE from 'three';
import { sdEllipsoid, sdSphere, sdCapsule, smin, smax, surfaceNets } from './sdf.js';
import { lerp, smoothstep, clamp } from '../../util.js';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Cheap 3D value noise (deterministic), for fabric folds.
function hash3(i, j, k) {
  let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = x - i, fy = y - j, fz = z - k;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  return L(
    L(L(hash3(i, j, k), hash3(i + 1, j, k), u), L(hash3(i, j + 1, k), hash3(i + 1, j + 1, k), u), v),
    L(L(hash3(i, j, k + 1), hash3(i + 1, j, k + 1), u), L(hash3(i, j + 1, k + 1), hash3(i + 1, j + 1, k + 1), u), v),
    w,
  ) * 2 - 1;
}

// Distance from p to the plane through c with normal n (positive on the n side).
const plane = (x, y, z, c, n) => (x - c.x) * n.x + (y - c.y) * n.y + (z - c.z) * n.z;

// Body primitives in the rest pose. W: joint world positions (root space).
export function bodyModel(W, dims, opts) {
  const { hipR, waistR, chestR, neckR, armR, legR, depth: D, height: Ht } = dims;
  const f = opts.female, kid = opts.kid;
  const hy = W.hips.y;
  const sy = (W.shoulderL.y + W.shoulderR.y) / 2;
  const sx = Math.abs(W.shoulderR.x);
  const torso = (x, y, z) => {
    let d = sdEllipsoid(x, y, z, 0, hy + 0.01, -0.005, hipR * 1.02, hipR * 0.8, hipR * D * 1.12);
    d = smin(d, sdEllipsoid(x, y, z, 0, hy + Ht * 0.33, 0, waistR, Ht * 0.27, waistR * D * 1.08), 0.08);
    d = smin(d, sdEllipsoid(x, y, z, 0, hy + Ht * 0.64, 0.004, chestR, Ht * 0.3, chestR * D * 1.1), 0.08);
    // shoulders and trapezius slope
    d = smin(d, sdCapsule(x, y, z, -sx * 0.92, sy + armR * 0.15, -0.012, sx * 0.92, sy + armR * 0.15, -0.012, armR * 1.25), 0.06);
    const ax = Math.abs(x);
    d = smin(d, sdCapsule(ax, y, z, neckR * 0.9, W.neck.y - 0.005, -0.012, sx * 0.75, sy + armR * 0.55, -0.012, neckR * 0.75, armR * 0.7), 0.05);
    if (f && !kid) d = smin(d, sdEllipsoid(ax, y, z, chestR * 0.42, hy + Ht * 0.66, chestR * D * 0.62, chestR * 0.36, chestR * 0.34, chestR * 0.36), 0.05);
    // shoulder balls
    d = smin(d, sdSphere(x, y, z, W.shoulderL.x, W.shoulderL.y, W.shoulderL.z, armR * 1.15), 0.04);
    d = smin(d, sdSphere(x, y, z, W.shoulderR.x, W.shoulderR.y, W.shoulderR.z, armR * 1.15), 0.04);
    return d;
  };
  const cap = (a, b, ra, rb) => (x, y, z) => sdCapsule(x, y, z, a.x, a.y, a.z, b.x, b.y, b.z, ra, rb);
  const upperArm = { L: cap(W.shoulderL, W.elbowL, armR * 1.04, armR * 0.86), R: cap(W.shoulderR, W.elbowR, armR * 1.04, armR * 0.86) };
  const foreArm = { L: cap(W.elbowL, W.wristL, armR * 0.88, armR * 0.68), R: cap(W.elbowR, W.wristR, armR * 0.88, armR * 0.68) };
  const thigh = { L: cap(W.hipL, W.kneeL, legR * 1.08, legR * 0.8), R: cap(W.hipR, W.kneeR, legR * 1.08, legR * 0.8) };
  const shin = { L: cap(W.kneeL, W.ankleL, legR * 0.8, legR * 0.52), R: cap(W.kneeR, W.ankleR, legR * 0.8, legR * 0.52) };
  const calf = (s) => { const k = W['knee' + s], a = W['ankle' + s]; return (x, y, z) => sdEllipsoid(x, y, z, lerp(k.x, a.x, 0.3), lerp(k.y, a.y, 0.3), lerp(k.z, a.z, 0.3) - legR * 0.12, legR * 0.82, legR * 1.6, legR * 0.85); };
  const neck = cap(W.neck.clone().add(v3(0, -0.03, -0.01)), W.head, neckR, neckR * 0.95);
  return { torso, upperArm, foreArm, thigh, shin, calf: { L: calf('L'), R: calf('R') }, neck, hy, sy, sx, W, dims };
}

// Weight segments: [boneName, a, b, radius]
function weightSegments(W, dims) {
  const { hipR, waistR, chestR, neckR, armR, legR, height: Ht } = dims;
  const hy = W.hips.y;
  const S = [
    ['hips', v3(0, hy - 0.04, 0), v3(0, hy + Ht * 0.2, 0), hipR],
    ['spine', v3(0, hy + Ht * 0.22, 0), v3(0, hy + Ht * 0.48, 0), waistR],
    ['chest', v3(0, hy + Ht * 0.5, 0), v3(0, W.neck.y, 0), chestR],
    ['neck', W.neck, W.head, neckR * 1.1],
  ];
  for (const s of ['L', 'R']) {
    const out = W['shoulder' + s].clone();
    S.push(['chest', v3(Math.sign(out.x) * neckR, W.neck.y - 0.02, 0), out.clone().multiplyScalar(0.85), armR * 1.5]);
    S.push(['shoulder' + s, W['shoulder' + s], W['elbow' + s], armR]);
    S.push(['elbow' + s, W['elbow' + s], W['wrist' + s], armR * 0.82]);
    S.push(['wrist' + s, W['wrist' + s], W['wrist' + s].clone().add(W['wrist' + s].clone().sub(W['elbow' + s]).setLength(0.08)), armR * 0.7]);
    S.push(['hip' + s, W['hip' + s], W['knee' + s], legR]);
    S.push(['knee' + s, W['knee' + s], W['ankle' + s], legR * 0.72]);
    S.push(['ankle' + s, W['ankle' + s], W['ankle' + s].clone().add(v3(0, -0.04, 0.1)), legR * 0.6]);
  }
  return S;
}

function segInfo(p, a, b) {
  const ab = b.clone().sub(a);
  const L2 = ab.lengthSq();
  const h = clamp(p.clone().sub(a).dot(ab) / L2, 0, 1);
  const c = a.clone().addScaledVector(ab, h);
  return { d: p.distanceTo(c), h, c, len: Math.sqrt(L2), dir: ab.normalize() };
}

// Mesh an SDF in root space and turn it into a SkinnedMesh bound to `skeleton`.
// opts: { box: [min, max], h, force: boneName (rigidly weight everything), uvScale }
export function skinnedFromSDF(f, material, bones, W, dims, opts = {}) {
  const geo = surfaceNets(f, opts.box[0], opts.box[1], opts.h ?? 0.007, { project: 1, exactNormals: true });
  const pos = geo.attributes.position.array, nrm = geo.attributes.normal.array;
  const n = pos.length / 3;
  const segs = weightSegments(W, dims);
  const boneIndex = new Map(bones.map((b, i) => [b.name, i]));
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), uv = new Float32Array(n * 2);
  const p = v3();
  const uvS = opts.uvScale ?? 4; // uv units per meter
  for (let v = 0; v < n; v++) {
    p.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    const cand = [];
    let best = null;
    for (const [bone, a, b, r] of segs) {
      if (!boneIndex.has(bone)) continue;
      const s = segInfo(p, a, b);
      const dn = s.d / r;
      cand.push([bone, dn]);
      if (!best || dn < best.dn) best = { dn, s, r };
    }
    let ws;
    if (opts.force) ws = [[opts.force, 1]];
    else {
      const m = Math.min(...cand.map((c) => c[1]));
      ws = cand.map(([b, dn]) => [b, Math.exp(-7 * (dn - m))]).filter((w) => w[1] > 0.02);
      // merge duplicates (several segments drive the same bone)
      const acc = new Map();
      for (const [b, w] of ws) acc.set(b, (acc.get(b) || 0) + w);
      ws = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4);
    }
    const tot = ws.reduce((s, w) => s + w[1], 0);
    ws.forEach(([b, w], k) => { si[v * 4 + k] = boneIndex.get(b); sw[v * 4 + k] = w / tot; });
    // cylindrical uv around the nearest segment, in meters
    const s = best.s;
    const ref = Math.abs(s.dir.y) > 0.9 ? v3(0, 0, 1) : v3(0, 1, 0);
    const e1 = ref.clone().addScaledVector(s.dir, -ref.dot(s.dir)).normalize();
    const e2 = s.dir.clone().cross(e1);
    const o = p.clone().sub(s.c);
    const ang = Math.atan2(o.dot(e2), o.dot(e1));
    uv[v * 2] = ang * Math.max(0.04, best.r) * uvS;
    uv[v * 2 + 1] = (s.h * s.len + (best.r > dims.chestR * 0.9 ? p.y : 0)) * uvS;
    void nrm;
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

// Fabric folds: soft noise wrinkles plus bunching rings near joints.
function folds(amp, freq, seed) {
  return (x, y, z) => amp * (vnoise(x * freq + seed, y * freq * 0.55, z * freq) * 0.7 + vnoise(x * freq * 2.3, y * freq * 1.4 + seed, z * freq * 2.3) * 0.3);
}

// Build the outfit. Returns { meshes, skinParts }.
export function buildGarments(model, o, mats, bones, opts = {}) {
  const { W, dims, hy } = model;
  const { neckR, armR, legR, height: Ht } = dims;
  const meshes = [];
  const H = opts.h ?? 0.0075;
  const seed = (opts.seed ?? 1) * 7.13;
  const box = (y0, y1, wx = 0.75) => [[-wx, y0, -0.32], [wx, y1, 0.36]];
  const armDir = (s, part) => (part === 'upper' ? W['elbow' + s].clone().sub(W['shoulder' + s]) : W['wrist' + s].clone().sub(W['elbow' + s])).normalize();
  const along = (s, part, t) => (part === 'upper' ? W['shoulder' + s].clone().lerp(W['elbow' + s], t) : W['elbow' + s].clone().lerp(W['wrist' + s], t));
  const legDir = (s, part) => (part === 'thigh' ? W['knee' + s].clone().sub(W['hip' + s]) : W['ankle' + s].clone().sub(W['knee' + s])).normalize();
  const legAt = (s, part, t) => (part === 'thigh' ? W['hip' + s].clone().lerp(W['knee' + s], t) : W['knee' + s].clone().lerp(W['ankle' + s], t));
  const neckAxisD = (x, y, z) => sdCapsule(x, y, z, W.neck.x, W.neck.y - 0.08, W.neck.z - 0.006, W.head.x, W.head.y + 0.1, W.head.z, 0);

  // ---- top --------------------------------------------------------------------
  const top = o.top;
  const longTop = ['robe', 'gown', 'coat'].includes(top);
  const openFront = ['jacket', 'cardigan', 'coat', 'suit'].includes(top);
  const shortSleeve = ['tshirt', 'blouse', 'dress'].includes(top);
  const sleeveless = top === 'gown';
  const knitTop = ['sweater', 'cardigan', 'hoodie'].includes(top);

  // a shirt-like garment over the torso and arms
  const makeTop = ({ thick, sleeveEnd, hemY, nr, vneck = 0, open = 0, hood = false, pocket = false, rib = true, amp = 0.0035 }) => {
    const fold = folds(amp, 16, seed + thick * 100);
    const cuts = [];
    for (const s of ['L', 'R']) {
      if (sleeveEnd == null) continue;
      const part = sleeveEnd <= 1 ? 'upper' : 'fore';
      const t = sleeveEnd <= 1 ? sleeveEnd : sleeveEnd - 1;
      cuts.push({ c: along(s, part, t), n: armDir(s, part) });
    }
    return (x, y, z) => {
      let d = model.torso(x, y, z) - thick;
      if (sleeveEnd !== null && !sleeveless) {
        ['L', 'R'].forEach((s, i) => {
          let a = model.upperArm[s](x, y, z);
          if (sleeveEnd > 1) a = smin(a, model.foreArm[s](x, y, z), 0.02);
          // the sleeve ends where it's cut; the cut only applies to the sleeve
          a = smax(a - thick * 0.9, plane(x, y, z, cuts[i].c, cuts[i].n), 0.006);
          d = smin(d, a, 0.03);
        });
      }
      // bunching near elbows and the waist
      d += fold(x, y, z);
      if (sleeveless) for (const s of ['L', 'R']) d = smax(d, -(sdSphere(x, y, z, W['shoulder' + s].x, W['shoulder' + s].y, W['shoulder' + s].z, armR * 1.6)), 0.02);
      // hem
      d = smax(d, hemY - y, 0.008);
      // neckline
      let nk = neckAxisD(x, y, z) - nr;
      if (vneck) nk = smin(nk, Math.max(Math.abs(x) - vneck * smoothstep(W.neck.y - Ht * 0.28, W.neck.y, y), -z, y - W.neck.y - 0.02, W.neck.y - Ht * 0.28 - y), 0.01);
      d = smax(d, -nk, 0.01);
      // front opening
      if (open) {
        const w = open * (0.55 + 0.45 * smoothstep(hy + Ht * 0.45, W.neck.y, y));
        d = smax(d, -Math.max(Math.abs(x) - w, -z + 0.02), 0.006);
      }
      // ribbed collar / cuffs / hem band
      if (rib) {
        const nc = neckAxisD(x, y, z) - nr;
        const band = Math.max(Math.abs(nc) - 0.008, Math.abs(y - (W.neck.y - 0.005)) - 0.016);
        if (!open && !vneck) d = smin(d, band, 0.006);
      }
      if (hood) {
        const hd = sdEllipsoid(x, y, z, 0, W.neck.y + 0.01, W.neck.z - neckR * 1.55, neckR * 2.5, neckR * 1.7, neckR * 1.35);
        d = smin(d, smax(hd, -sdEllipsoid(x, y, z, 0, W.neck.y + 0.03, W.neck.z - neckR * 0.8, neckR * 1.7, neckR * 1.4, neckR * 1.3), 0.01), 0.03);
      }
      if (pocket) {
        const pk = sdEllipsoid(x, y, z, 0, hy + Ht * 0.16, dims.waistR * dims.depth * 1.12, dims.waistR * 0.8, Ht * 0.1, 0.012);
        d = smin(d, pk, 0.008);
      }
      return d;
    };
  };

  const topMesh = (f, mat, y0, y1, name) => {
    const m = skinnedFromSDF(f, mat, bones, W, dims, { box: box(y0, y1), h: H });
    m.name = name;
    meshes.push(m);
    return m;
  };
  const chestTopY = W.head.y + 0.05;
  const sleeveFull = 1.93;
  {
    if (openFront) {
      // inner shirt then the open outer layer
      const inner = makeTop({ thick: 0.004, sleeveEnd: 0.4, hemY: hy - 0.02, nr: neckR * 1.18, rib: top !== 'suit', amp: 0.002 });
      topMesh(inner, mats.inner, hy - 0.06, chestTopY, 'shirt');
      if (o.collar === 'collar' || top === 'suit') meshes.push(shirtCollar(model, mats.inner, bones));
      const hem = top === 'coat' ? W.kneeL.y + 0.08 : hy - (top === 'suit' ? 0.09 : 0.05);
      const outer = makeTop({ thick: 0.016, sleeveEnd: sleeveFull, hemY: hem, nr: neckR * 1.5, open: top === 'suit' ? 0.07 : 0.085, rib: false, amp: 0.004 });
      const fOuter = top === 'coat' ? (x, y, z) => smin(outer(x, y, z), coatSkirt(model, hem)(x, y, z), 0.04) : outer;
      topMesh(fOuter, mats.top, hem - 0.03, chestTopY, top);
      if (top === 'suit' || top === 'jacket' || top === 'coat') meshes.push(lapels(model, mats.top, bones, top));
    } else if (longTop || top === 'dress') {
      const len = top === 'dress' ? W.kneeL.y + 0.02 : W.ankleL.y + 0.03;
      const body = makeTop({ thick: 0.008, sleeveEnd: top === 'dress' ? 0.38 : top === 'gown' ? null : sleeveFull, hemY: hy - 0.1, nr: neckR * (top === 'robe' ? 1.3 : 1.45), vneck: top === 'gown' ? 0.06 : 0, rib: false, amp: 0.003 });
      const skirt = flaredSkirt(model, top === 'dress' ? hy + Ht * 0.12 : hy + Ht * 0.08, len, top === 'gown' || top === 'robe' ? 1.9 : 1.6, seed);
      topMesh((x, y, z) => smin(body(x, y, z), skirt(x, y, z), 0.05), mats.top, len - 0.04, chestTopY, top);
    } else {
      const cfg = {
        tshirt: { thick: 0.007, sleeveEnd: 0.45, hemY: hy - 0.03, nr: neckR * 1.3 },
        blouse: { thick: 0.006, sleeveEnd: 0.5, hemY: hy - 0.02, nr: neckR * 1.3, vneck: 0.045, rib: false },
        shirt: { thick: 0.007, sleeveEnd: sleeveFull, hemY: hy - 0.04, nr: neckR * 1.2, rib: false },
        sweater: { thick: 0.012, sleeveEnd: sleeveFull, hemY: hy - 0.03, nr: neckR * 1.25, amp: 0.004 },
        hoodie: { thick: 0.014, sleeveEnd: sleeveFull, hemY: hy - 0.05, nr: neckR * 1.35, hood: true, pocket: true, amp: 0.0045 },
        suit: { thick: 0.01, sleeveEnd: sleeveFull, hemY: hy - 0.06, nr: neckR * 1.2 },
        armor: { thick: 0.022, sleeveEnd: sleeveFull, hemY: hy - 0.08, nr: neckR * 1.35, rib: false, amp: 0.0005 },
      }[top] || { thick: 0.007, sleeveEnd: 0.45, hemY: hy - 0.03, nr: neckR * 1.3 };
      topMesh(makeTop(cfg), mats.top, hy - 0.1, chestTopY, top);
      if (o.collar === 'collar') meshes.push(shirtCollar(model, mats.top, bones));
    }
  }

  // ---- bottoms -------------------------------------------------------------------
  const bottom = o.bottom;
  if (['jeans', 'pants', 'shorts'].includes(bottom) && !(longTop && top !== 'coat')) {
    const shorts = bottom === 'shorts';
    const fold = folds(0.003, 14, seed + 3);
    const cuts = ['L', 'R'].map((s) => shorts ? { c: legAt(s, 'thigh', 0.8), n: legDir(s, 'thigh') } : { c: legAt(s, 'shin', 0.93), n: legDir(s, 'shin') });
    const waistTop = hy + Ht * 0.2;
    const pf = (x, y, z) => {
      let legs = Math.min(model.thigh.L(x, y, z), model.thigh.R(x, y, z));
      if (!shorts) legs = Math.min(legs, smin(model.shin.L(x, y, z), model.calf.L(x, y, z), 0.04), smin(model.shin.R(x, y, z), model.calf.R(x, y, z), 0.04));
      let d = smin(model.torso(x, y, z), legs, 0.05);
      d -= bottom === 'jeans' ? 0.009 : 0.011;
      d += fold(x, y, z) * smoothstep(hy - 0.1, hy - 0.4, y);
      for (const c of cuts) d = smax(d, plane(x, y, z, c.c, c.n), 0.006);
      d = smax(d, y - waistTop, 0.006);
      // waistband
      const wb = Math.max(model.torso(x, y, z) - 0.014, Math.abs(y - (waistTop - 0.018)) - 0.016);
      d = smin(d, wb, 0.004);
      return d;
    };
    const y0 = shorts ? W.kneeL.y - 0.04 : W.ankleL.y - 0.05;
    const m = skinnedFromSDF(pf, mats.pants, bones, W, dims, { box: box(y0, waistTop + 0.04, 0.45), h: H });
    m.name = 'pants';
    meshes.push(m);
  }
  if (bottom === 'skirt') {
    const skirt = flaredSkirt(model, hy + Ht * 0.16, W.kneeL.y - 0.02, 1.55, seed);
    const sf = (x, y, z) => smin(skirt(x, y, z), Math.max(model.torso(x, y, z) - 0.01, y - (hy + Ht * 0.18), hy - 0.02 - y), 0.03);
    const m = skinnedFromSDF(sf, mats.skirt, bones, W, dims, { box: box(W.kneeL.y - 0.08, hy + Ht * 0.22, 0.5), h: H, force: 'hips' });
    m.name = 'skirt';
    meshes.push(m);
  }

  // ---- backpack straps hugging the clothes over the shoulders
  if (o.backpack && mats.strap) {
    const outerT = openFront ? 0.016 : top === 'hoodie' ? 0.014 : 0.012;
    const xs = (y) => lerp(model.sx * 0.5, neckR * 1.9, smoothstep(hy + Ht * 0.3, W.neck.y, y));
    const sf = (x, y, z) => {
      const ax = Math.abs(x);
      const shell = Math.abs(model.torso(x, y, z) - outerT - 0.012) - 0.006;
      let d = Math.max(shell, Math.abs(ax - xs(y)) - 0.021, hy + Ht * 0.3 - y);
      return d;
    };
    const m = skinnedFromSDF(sf, mats.strap, bones, W, dims, { box: [[-0.3, hy + Ht * 0.25, -0.3], [0.3, W.neck.y + 0.08, 0.3]], h: 0.004, force: 'chest' });
    m.name = 'straps';
    meshes.push(m);
  }

  // ---- exposed skin ----------------------------------------------------------------
  const skinParts = [];
  const sleeveCut = top === 'armor' ? 1.9 : longTop && top !== 'gown' ? 1.85 : openFront || ['shirt', 'sweater', 'hoodie', 'suit'].includes(top) ? 1.85 : top === 'gown' ? 0 : top === 'dress' ? 0.3 : 0.38;
  const legsBare = bottom === 'skirt' || bottom === 'shorts' || bottom === 'none' || top === 'dress';
  if (sleeveCut != null && sleeveCut < 1.8) {
    const part = sleeveCut <= 1 ? 'upper' : 'fore';
    for (const s of ['L', 'R']) {
      const c = along(s, part, sleeveCut <= 1 ? sleeveCut : sleeveCut - 1), n = armDir(s, part);
      skinParts.push((x, y, z) => smax(smin(model.upperArm[s](x, y, z), model.foreArm[s](x, y, z), 0.03), -plane(x, y, z, c, n), 0.004));
    }
  }
  if (legsBare && !longTop) {
    for (const s of ['L', 'R']) {
      const c = legAt(s, 'thigh', 0.2), n = legDir(s, 'thigh');
      skinParts.push((x, y, z) => smax(smin(model.thigh[s](x, y, z), smin(model.shin[s](x, y, z), model.calf[s](x, y, z), 0.04), 0.04), -plane(x, y, z, c, n), 0.004));
    }
  }
  if (top === 'gown') {
    // shoulders and arms show
    for (const s of ['L', 'R']) skinParts.push((x, y, z) => smin(model.upperArm[s](x, y, z), model.foreArm[s](x, y, z), 0.03));
  }
  if (skinParts.length && mats.skin) {
    const sk = (x, y, z) => { let d = 1e3; for (const g of skinParts) d = Math.min(d, g(x, y, z)); return d; };
    const m = skinnedFromSDF(sk, mats.skin, bones, W, dims, { box: [[-0.9, W.ankleL.y - 0.06, -0.3], [0.9, W.neck.y + 0.02, 0.3]], h: H * 1.1 });
    m.name = 'skin';
    meshes.push(m);
  }
  if (typeof window !== 'undefined' && window.__hairLog) console.log('garments', o.top, o.bottom, meshes.map((m) => m.name + ':' + m.geometry.attributes.position.count).join(' '));
  return { meshes };
}

function flaredSkirt(model, topY, bottomY, flare, seed) {
  const { dims } = model;
  const r0 = dims.waistR * 1.04, r1 = dims.hipR * flare;
  const fold = folds(0.006, 9, seed + 11);
  return (x, y, z) => {
    const t = clamp((topY - y) / (topY - bottomY), 0, 1);
    const ang = Math.atan2(x, z);
    const r = lerp(r0, r1, Math.pow(t, 0.8)) * (1 + 0.05 * Math.sin(ang * 9 + seed) * t);
    const rho = Math.sqrt(x * x + (z / (dims.depth * lerp(1.08, 1.0, t))) ** 2);
    let d = (rho - r) * 0.9 + fold(x, y, z) * t;
    d = smax(d, y - topY, 0.01);
    d = smax(d, bottomY - y, 0.01);
    return d;
  };
}

function coatSkirt(model, hemY) {
  const { dims, hy } = model;
  return (x, y, z) => {
    const t = clamp((hy - y) / (hy - hemY), 0, 1);
    const r = lerp(dims.hipR * 1.12, dims.hipR * 1.38, t);
    const rho = Math.sqrt(x * x + (z / (dims.depth * 1.1)) ** 2);
    let d = rho - r;
    d = smax(d, y - hy, 0.03);
    d = smax(d, hemY - y, 0.01);
    // the coat is open below the waist
    d = smax(d, -Math.max(Math.abs(x) - 0.05 - t * 0.04, -z + 0.02), 0.006);
    return d;
  };
}

// Folded shirt collar: a band around the neck with two points on the chest.
function shirtCollar(model, material, bones) {
  const { W, dims } = model;
  const { neckR } = dims;
  const cy = W.neck.y - 0.01;
  const f = (x, y, z) => {
    const ax = Math.abs(x);
    const rho = Math.sqrt(x * x + ((z - W.neck.z + 0.004) / 0.95) ** 2);
    let band = Math.max(Math.abs(rho - neckR * 1.32) - 0.006, Math.abs(y - cy - 0.012) - 0.02);
    band = smax(band, -Math.max(ax - 0.012, -z), 0.004); // open at the front
    const pt = sdEllipsoid(ax, y, z, neckR * 0.75, cy - 0.03, neckR * 1.25, neckR * 0.55, 0.03, 0.006);
    return smin(band, pt, 0.008);
  };
  const m = skinnedFromSDF(f, material, bones, W, dims, { box: [[-0.14, cy - 0.08, -0.12], [0.14, cy + 0.06, 0.14]], h: 0.0035, force: 'chest' });
  m.name = 'collar';
  return m;
}

// Jacket lapels: two folded flaps along the front opening.
function lapels(model, material, bones, kind) {
  const { W, dims, hy } = model;
  const { height: Ht } = dims;
  const f = (x, y, z) => {
    const ax = Math.abs(x);
    const t = clamp((W.neck.y - y) / (Ht * 0.42), 0, 1);
    const cx = lerp(dims.neckR * 1.25, 0.075, t);
    const w = lerp(0.03, 0.006, Math.pow(t, 1.4)) * (kind === 'coat' ? 1.3 : 1);
    const zf = model.torso(x, y, z) - 0.024;
    let d = Math.max(Math.abs(zf) - 0.004, Math.abs(ax - cx - w * 0.6) - w, 0.02 - z);
    d = smax(d, y - W.neck.y, 0.004);
    d = smax(d, hy + Ht * 0.48 - y, 0.004);
    return d;
  };
  const m = skinnedFromSDF(f, material, bones, W, dims, { box: [[-0.2, hy + Ht * 0.4, -0.05], [0.2, W.neck.y + 0.03, 0.2]], h: 0.004, force: 'chest' });
  m.name = 'lapels';
  return m;
}
