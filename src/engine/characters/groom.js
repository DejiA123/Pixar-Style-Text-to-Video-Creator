// Grooming: organised rows of locks that follow a coherent flow over the scalp.
// Two flow families cover most hairstyles:
//  - "back-combed": meridians radiating from the face (quiffs, swept, spiky,
//    short back & sides),
//  - "parted": locks leave a part line and run down the sides, then fall under
//    gravity (long, wavy, bob).
import * as THREE from 'three';
import { lerp, smoothstep, clamp } from '../../util.js';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Direction on the unit sphere at polar angle a from the face axis (+z) and
// azimuth psi (0 = right side, π/2 = top, π = left side).
export function faceMeridian(a, psi) {
  const s = Math.sin(a);
  return v3(Math.cos(psi) * s, Math.sin(psi) * s, Math.cos(a));
}

// First polar angle along a meridian where the scalp starts.
export function hairlineAngle(psi, onScalp, from = 0.25, to = 2.9) {
  for (let a = from; a < to; a += 0.02) if (onScalp(faceMeridian(a, psi))) return a;
  return null;
}

// Back-combed groom. surf(d, lift) → point on the hair shell in direction d.
// Returns locks [{pts, w, t}].
export function backCombed({ surf, onScalp, rng, psiFrom, psiTo, rowStep = 0.3, lockLen = 0.85, width = 0.15, thick = 0.045,
  spacing = 0.2, quiff = 0, quiffSide = 0.12, drift = 0, tipLift = 0.03, maxA = 2.55, flat = false, frontLen = 1, jitter = 0.04 }) {
  const locks = [];
  // rows march back from the hairline; each row is a band of constant offset from it
  for (let row = 0; ; row++) {
    let made = 0;
    // estimate circumference at a typical angle to pick the lock count for this row
    const aMid = 1.0 + row * rowStep;
    if (aMid > maxA + 0.3) break;
    const arc = (psiTo - psiFrom) * Math.max(0.35, Math.sin(Math.min(aMid, Math.PI - 0.4)));
    const n = Math.max(3, Math.round(arc / spacing));
    for (let c = 0; c < n; c++) {
      const psi = lerp(psiFrom, psiTo, (c + 0.5 + (row % 2 ? 0.5 : 0) * 0.5) / n) + rng.range(-jitter, jitter);
      const a0 = hairlineAngle(psi, onScalp);
      if (a0 == null) continue;
      const aRoot = a0 + 0.03 + row * rowStep + rng.range(-0.04, 0.04);
      if (aRoot > maxA) continue;
      const top = Math.sin(psi); // 1 on top, 0 at sides
      const front = row === 0 ? 1 : row === 1 ? 0.45 : 0;
      const len = lockLen * (row === 0 ? frontLen : 1) * rng.range(0.85, 1.15) * lerp(0.75, 1, Math.max(0, top));
      const N = 12;
      const pts = [];
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const a = Math.min(aRoot + len * t, maxA + 0.25);
        const ps = psi + drift * t * Math.max(0, top) + (flat ? 0 : Math.sin(t * 3 + c) * 0.02);
        const d = faceMeridian(a, ps);
        // quiff: front locks rise off the forehead and arc back down
        const qLift = quiff * front * Math.max(0, top) * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 + quiffSide * Math.cos(psi));
        const lift = 0.004 + qLift * 0.25 + tipLift * smoothstep(0.6, 1, t);
        // the quiff rises up and back off the forehead rather than pushing forward
        pts.push(surf(d, lift).add(v3(0, qLift, -qLift * 0.35)));
      }
      locks.push({ pts, ...profile(pts.length, width * rng.range(0.85, 1.15) * (row === 0 ? 1.1 : 1), thick) });
      made++;
    }
    if (!made && row > 2) break;
  }
  return locks;
}

// Parted groom: locks start along a part line (x = partX on top) and run down the
// sides; below the widest part of the head they fall with gravity and a shared
// wave so neighbouring locks move together.
export function parted({ surf, onScalp, collide, rng, partX = 0, length = 2.4, width = 0.17, thick = 0.045,
  rows = 9, perSide = 9, wave = 0, waveLen = 0.62, frontShort = 0.7, tuck = false, faceOpen = 0.62 }) {
  const locks = [];
  const zs = [];
  for (let r = 0; r < rows; r++) zs.push(lerp(0.56, -0.95, r / (rows - 1)));
  for (const side of [-1, 1]) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < perSide; c++) {
        const z0 = zs[r] + rng.range(-0.05, 0.05);
        // roots: from the part outward along this z-slice
        const th0 = 0.04 + (c / perSide) * 0.42 + rng.range(-0.03, 0.03); // angle from the top in the x-y plane
        const s = Math.sqrt(Math.max(0.05, 1 - z0 * z0));
        const dRoot = v3(partX * 0.6 + side * Math.sin(th0) * s, Math.cos(th0) * s, z0).normalize();
        if (!onScalp(dRoot)) continue;
        // a lock that starts deeper along the slice than the part only needs to be visible on the outside
        const pts = [];
        const L = length * lerp(frontShort, 1, smoothstep(0.75, 0.2, z0)) * rng.range(0.92, 1.08);
        const steps = Math.max(14, Math.round(L / 0.09));
        const seg = L / (steps - 1);
        let th = th0;
        let p = surf(dRoot, 0.005);
        pts.push(p.clone());
        const phase = rng.range(-0.25, 0.25);
        let hanging = false, hangStart = 0;
        const dir = v3();
        for (let i = 1; i < steps; i++) {
          const t = i / (steps - 1);
          if (!hanging) {
            // slide down the side of the head along the slice
            th += seg / Math.max(0.6, p.length());
            const zz = z0 > 0.2 ? z0 - Math.min(1, (th - th0) * 0.9) * (z0 - 0.2) : z0 * lerp(1, 0.9, Math.min(1, (th - th0) / 1.5));
            const ss = Math.sqrt(Math.max(0.02, 1 - zz * zz));
            const d = v3(side * Math.sin(th) * ss, Math.cos(th) * ss, zz).normalize();
            const np = surf(d, 0.002 + 0.025 * smoothstep(1.4, 2.0, th));
            dir.subVectors(np, p).normalize();
            p = np;
            if (th > Math.PI * 0.55 || d.y < -0.15) hanging = true;
          } else {
            // fall: blend toward straight down, keep a little outward push
            const out = v3(p.x, 0, p.z).normalize();
            dir.lerp(v3(0, -1, 0).addScaledVector(out, 0.12), 0.35).normalize();
            p = p.clone().addScaledVector(dir, seg);
            if (!hangStart) hangStart = i;
            if (tuck && t > 0.82) p.addScaledVector(out, -seg * 0.6);
          }
          collide(p, 1.04, true);
          // keep the face open
          if (hanging && p.z > 0.2 && p.y < 0.3 && p.y > -1.3 && Math.abs(p.x) < faceOpen + 0.18) p.x = Math.sign(p.x || side) * lerp(Math.abs(p.x), faceOpen + 0.18, 0.8);
          pts.push(p.clone());
        }
        // broad S-waves shared by neighbouring locks, growing toward the ends
        if (wave && hangStart) {
          for (let i = hangStart; i < pts.length; i++) {
            const q = pts[i];
            const sArc = (i - hangStart) * seg;
            const out = v3(q.x, 0, q.z).normalize();
            const lateral = v3(-out.z, 0, out.x);
            const amp = wave * smoothstep(0, 0.5, sArc);
            const ph = (sArc / waveLen + phase * 0.3) * Math.PI * 2;
            q.addScaledVector(lateral, Math.sin(ph) * amp * 0.35).addScaledVector(out, Math.cos(ph) * amp);
          }
        }
        const frontK = lerp(0.5, 1, smoothstep(0.5, 0.15, z0));
        locks.push({ pts, ...profile(pts.length, width * frontK * rng.range(0.85, 1.15), thick * lerp(0.6, 1, frontK), { endTaper: 0.85 }) });
      }
    }
  }
  return locks;
}

export function profile(n, width, thick, opts = {}) {
  const w = [], t = [];
  const endT = opts.endTaper ?? 0.7;
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    const root = lerp(0.55, 1, smoothstep(0, 0.12, s));
    const tip = s > endT ? lerp(1, 0.18, smoothstep(endT, 1, s)) : 1;
    const belly = 1 + 0.12 * Math.sin(Math.PI * clamp(s * 1.3));
    w.push(Math.max(0.024, width * root * tip * belly));
    t.push(Math.max(0.022, thick * lerp(1, 0.75, s) * tip));
  }
  return { w, t };
}
