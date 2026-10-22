// Procedural, closed-form character animation: every pose is a pure function
// of time, so any frame can be rendered on demand (scrubbing and export).
//
// Conventions (rest pose: arms hang down, legs straight, facing +z):
//   shoulder: rx<0 raises the arm forward, rz=side*a lifts it out sideways
//   elbow: rx<0 bends the forearm forward; hip: rx<0 swings the leg forward
//   knee: rx>0 bends back; head: rx>0 nods down, ry turns.
import { clamp, smoothstep, lerp, hash01, noise1, easeInOut } from '../../util.js';

const TAU = Math.PI * 2;
const sin = Math.sin, cos = Math.cos, abs = Math.abs;

export function emptyPose() {
  return {
    rootY: 0, rootX: 0, rootZ: 0, rootRx: 0, rootRy: 0, rootRz: 0,
    sx: 1, sy: 1, sz: 1,
    hips: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
    shoulderL: [0, 0, -0.1], shoulderR: [0, 0, 0.1], elbowL: [-0.15, 0, 0], elbowR: [-0.15, 0, 0],
    wristL: [0, 0, 0], wristR: [0, 0, 0], curlL: 0.35, curlR: 0.35, pointR: false, pointL: false,
    hipL: [0, 0, 0], hipR: [0, 0, 0], kneeL: [0, 0, 0], kneeR: [0, 0, 0], ankleL: [0, 0, 0], ankleR: [0, 0, 0],
    eyesClosed: 0, lookUp: 0, lookSide: 0, talkBoost: 1, wings: 0,
  };
}

const add3 = (a, x = 0, y = 0, z = 0) => { a[0] += x; a[1] += y; a[2] += z; };

// Natural blinking at pseudo-random times.
export function blinkAt(t, seed) {
  const period = 3.4;
  const k = Math.floor(t / period);
  let b = 0;
  for (let i = k - 1; i <= k; i++) {
    const at = i * period + hash01(i, seed) * (period - 0.3);
    const d = t - at;
    if (d >= 0 && d < 0.16) b = Math.max(b, sin((d / 0.16) * Math.PI));
    if (hash01(i, seed + 9) < 0.25) { // occasional double blink
      const d2 = d - 0.24;
      if (d2 >= 0 && d2 < 0.14) b = Math.max(b, sin((d2 / 0.14) * Math.PI));
    }
  }
  return b;
}

function idle(p, t, seed, H) {
  const br = sin(t * TAU * 0.25 + seed);
  p.chest[0] += br * 0.015;
  p.sy *= 1 + br * 0.006;
  const sway = noise1(t * 0.35, seed) * 0.03;
  p.hips[2] += sway * 0.5;
  p.spine[2] -= sway * 0.4;
  p.head[1] += noise1(t * 0.3, seed + 3) * 0.12;
  p.head[0] += noise1(t * 0.25, seed + 5) * 0.04;
  p.shoulderL[2] += -0.04 * br; p.shoulderR[2] += 0.04 * br;
  p.lookSide += noise1(t * 0.6, seed + 11) * 0.15;
  p.lookUp += noise1(t * 0.5, seed + 13) * 0.08;
}

function walkCycle(p, phase, amp, H, run = false) {
  const s = sin(phase), c = cos(phase);
  p.hipL[0] += -s * 0.5 * amp; p.hipR[0] += s * 0.5 * amp;
  p.kneeL[0] += Math.max(0, -c) * 0.9 * amp + 0.08; p.kneeR[0] += Math.max(0, c) * 0.9 * amp + 0.08;
  p.ankleL[0] += s * 0.2 * amp; p.ankleR[0] += -s * 0.2 * amp;
  p.shoulderL[0] += s * 0.45 * amp; p.shoulderR[0] += -s * 0.45 * amp;
  p.elbowL[0] += -0.25 - Math.max(0, -s) * 0.4 * amp; p.elbowR[0] += -0.25 - Math.max(0, s) * 0.4 * amp;
  p.rootY += abs(cos(phase)) * 0.035 * H * amp - 0.012 * H;
  p.hips[1] += s * 0.12 * amp; p.chest[1] += -s * 0.16 * amp;
  p.hips[2] += c * 0.04 * amp;
  if (run) {
    p.spine[0] += 0.22; p.head[0] -= 0.15;
    p.elbowL[0] += -1.0; p.elbowR[0] += -1.0;
    p.rootY += abs(cos(phase)) * 0.05 * H;
    p.curlL = p.curlR = 0.9;
  }
}

function jumpCycle(p, t, H, period = 1.3) {
  const u = (t % period) / period;
  let y = 0, sy = 1;
  if (u < 0.22) { const k = u / 0.22; sy = 1 - 0.16 * sin(k * Math.PI / 2); p.kneeL[0] += 0.7 * k; p.kneeR[0] += 0.7 * k; p.hipL[0] -= 0.5 * k; p.hipR[0] -= 0.5 * k; p.rootY -= 0.06 * H * k; p.shoulderL[0] += 0.5 * k; p.shoulderR[0] += 0.5 * k; }
  else if (u < 0.78) {
    const k = (u - 0.22) / 0.56;
    y = 4 * k * (1 - k) * 0.42 * H;
    sy = 1 + 0.12 * (1 - abs(2 * k - 1)) * (k < 0.5 ? 1 : 0.6);
    p.shoulderL[2] -= 2.4 * sin(k * Math.PI) ; p.shoulderR[2] += 2.4 * sin(k * Math.PI);
    p.kneeL[0] += 0.6 * sin(k * Math.PI); p.kneeR[0] += 0.6 * sin(k * Math.PI);
    p.hipL[0] -= 0.4 * sin(k * Math.PI); p.hipR[0] -= 0.4 * sin(k * Math.PI);
    p.curlL = p.curlR = 0.1;
  } else { const k = (u - 0.78) / 0.22; sy = 1 - 0.14 * sin(k * Math.PI); p.kneeL[0] += 0.6 * sin(k * Math.PI); p.kneeR[0] += 0.6 * sin(k * Math.PI); p.hipL[0] -= 0.45 * sin(k * Math.PI); p.hipR[0] -= 0.45 * sin(k * Math.PI); p.rootY -= 0.05 * H * sin(k * Math.PI); }
  p.rootY += y;
  p.sy *= sy; p.sx *= 1 / Math.sqrt(sy); p.sz *= 1 / Math.sqrt(sy);
  return u;
}

// action: string; t: seconds since the action began; ctx: {seed, H, speed, emotion, talking}
export function computePose(action, t, ctx) {
  const p = emptyPose();
  const { seed = 1, H = 1.7 } = ctx;
  idle(p, t, seed, H);
  const e = ctx.emotion || 'neutral';
  // emotional posture
  if (e === 'sad' || e === 'tired') { p.spine[0] += 0.12; p.head[0] += 0.18; p.shoulderL[2] += 0.06; p.shoulderR[2] -= 0.06; }
  if (e === 'happy' || e === 'excited' || e === 'proud') { p.spine[0] -= 0.04; p.head[0] -= 0.06; p.chest[0] -= 0.04; }
  if (e === 'scared') { p.spine[0] += 0.08; p.shoulderL[0] -= 0.4; p.shoulderR[0] -= 0.4; p.elbowL[0] -= 1.2; p.elbowR[0] -= 1.2; p.rootY += sin(t * 40) * 0.002 * H; }
  if (e === 'angry') { p.curlL = p.curlR = 1; p.shoulderL[2] -= 0.15; p.shoulderR[2] += 0.15; p.head[0] += 0.08; }
  if (e === 'excited') { p.rootY += abs(sin(t * 7)) * 0.015 * H; }

  switch (action) {
    case 'walk': case 'chase-walk': {
      const speed = ctx.speed ?? 1.1;
      walkCycle(p, (t * speed / (0.42 * H)) * Math.PI, 1, H);
      break;
    }
    case 'sneak': {
      walkCycle(p, (t * 0.5 / (0.35 * H)) * Math.PI, 0.6, H);
      p.rootY -= 0.07 * H; p.kneeL[0] += 0.4; p.kneeR[0] += 0.4; p.hipL[0] -= 0.3; p.hipR[0] -= 0.3; p.spine[0] += 0.25; p.head[0] -= 0.2;
      p.shoulderL[0] -= 0.9; p.shoulderR[0] -= 0.9; p.elbowL[0] -= 1.2; p.elbowR[0] -= 1.2; p.curlL = p.curlR = 0.6;
      break;
    }
    case 'run': case 'chase': {
      const speed = ctx.speed ?? 3.2;
      walkCycle(p, (t * speed / (0.65 * H)) * Math.PI, 1.5, H, true);
      break;
    }
    case 'jump': case 'play': {
      jumpCycle(p, t, H, action === 'play' ? 1.0 : 1.3);
      break;
    }
    case 'dance': {
      const b = t * TAU * 1.0;
      p.rootX += sin(b * 0.5) * 0.06 * H;
      p.rootY += abs(sin(b)) * 0.035 * H - 0.02 * H;
      p.hips[2] += sin(b * 0.5) * 0.18; p.chest[2] -= sin(b * 0.5) * 0.22;
      p.hips[1] += sin(b * 0.25) * 0.4;
      p.shoulderL[2] -= 1.6 + sin(b) * 0.7; p.shoulderR[2] += 1.6 + sin(b + Math.PI) * 0.7;
      p.elbowL[0] -= 0.6 + sin(b) * 0.5; p.elbowR[0] -= 0.6 + cos(b) * 0.5;
      p.kneeL[0] += Math.max(0, sin(b)) * 0.5; p.kneeR[0] += Math.max(0, -sin(b)) * 0.5;
      p.head[2] += sin(b) * 0.12; p.head[0] += sin(b * 2) * 0.05;
      p.curlL = p.curlR = 0.15;
      break;
    }
    case 'groom': {
      // brushing long hair: brush hand strokes from the crown down the side
      const k = (t * 0.9) % 1, stroke = k < 0.7 ? k / 0.7 : 1 - (k - 0.7) / 0.3;
      p.shoulderR[2] += 1.55 - stroke * 0.35; p.shoulderR[0] -= 0.35;
      p.elbowR[0] -= 2.45 - stroke * 0.25; p.elbowR[1] = -0.5; p.wristR[0] = 0.5; p.wristR[2] = 0.6;
      p.curlR = 0.8;
      p.shoulderL[0] -= 0.35; p.elbowL[0] -= 0.9; p.curlL = 0.3;
      p.head[2] += 0.12 + stroke * 0.05; p.head[1] -= 0.08; p.hips[2] -= 0.03;
      break;
    }
    case 'wave': {
      p.shoulderR[2] += 2.5; p.shoulderR[0] -= 0.3;
      p.elbowR[0] -= 0.4; p.elbowR[2] = sin(t * TAU * 1.6) * 0.5;
      p.curlR = 0.0; p.head[2] -= 0.08; p.hips[2] += 0.03;
      break;
    }
    case 'talk': {
      const g = t * 1.1 + seed;
      const amt = 0.6 + 0.4 * noise1(g * 0.5, seed);
      p.shoulderR[0] -= (0.5 + noise1(g, seed + 2) * 0.3) * amt; p.elbowR[0] -= (1.1 + noise1(g * 1.3, seed + 4) * 0.4) * amt;
      p.shoulderR[2] += 0.15; p.wristR[2] = noise1(g * 2, seed) * 0.3; p.curlR = 0.2;
      p.shoulderL[0] -= Math.max(0, noise1(g * 0.8, seed + 7)) * 0.6; p.elbowL[0] -= Math.max(0, noise1(g * 0.8, seed + 7)) * 1.2;
      p.head[0] += noise1(t * 2.2, seed + 1) * 0.08; p.head[2] += noise1(t * 0.9, seed + 2) * 0.08;
      break;
    }
    case 'sing': {
      p.shoulderL[0] -= 0.7; p.shoulderL[2] -= 0.6; p.elbowL[0] -= 1.6; p.curlL = 0.1; // hand on heart
      p.shoulderR[2] += 1.1 + sin(t * 1.5) * 0.15; p.shoulderR[0] -= 0.6; p.elbowR[0] -= 0.3; p.curlR = 0;
      p.head[0] -= 0.18; p.head[2] += sin(t * 1.2) * 0.1; p.rootY += sin(t * 2.5) * 0.008 * H;
      break;
    }
    case 'think': {
      p.shoulderR[0] -= 1.15; p.shoulderR[2] -= 0.35; p.elbowR[0] -= 2.3; p.curlR = 0.6; p.wristR[0] = 0.3;
      p.shoulderL[0] -= 0.5; p.shoulderL[2] += 0.35; p.elbowL[0] -= 1.5; // arm across body
      p.head[2] += 0.15; p.head[0] -= 0.1; p.lookUp += 0.35; p.lookSide += 0.3;
      break;
    }
    case 'look': case 'discover': {
      const k = smoothstep(0, 0.6, t);
      if (action === 'discover') { p.spine[0] -= 0.12 * k; p.shoulderR[0] -= 1.3 * k; p.elbowR[0] -= 0.1; p.curlR = 0.8; p.pointR = true; p.rootY += sin(Math.min(1, t * 2) * Math.PI) * 0.03 * H; }
      p.head[1] += sin(t * 0.8) * 0.35 * (action === 'look' ? 1 : 0.3);
      p.lookSide += sin(t * 0.8) * 0.3;
      break;
    }
    case 'point': {
      p.shoulderR[0] -= 1.4; p.shoulderR[2] += 0.25; p.elbowR[0] -= 0.05; p.curlR = 0.85; p.pointR = true;
      p.head[1] += 0.2;
      break;
    }
    case 'hug': {
      const k = smoothstep(0.3, 1.2, t);
      p.shoulderL[0] -= 1.35 * k; p.shoulderR[0] -= 1.35 * k; p.shoulderL[2] += 0.25 * k; p.shoulderR[2] -= 0.25 * k;
      p.elbowL[0] -= 1.1 * k; p.elbowR[0] -= 1.1 * k; p.elbowL[1] -= 0.4 * k; p.elbowR[1] += 0.4 * k;
      p.head[2] += 0.2 * k; p.eyesClosed = 0.85 * k; p.spine[0] += 0.08 * k;
      p.rootY += sin(t * 3) * 0.004 * H * k;
      break;
    }
    case 'cheer': {
      const u = jumpCycle(p, t, H, 0.9);
      p.shoulderL[2] -= 2.7; p.shoulderR[2] += 2.7; p.elbowL[0] -= 0.25; p.elbowR[0] -= 0.25;
      p.curlL = p.curlR = 1; p.head[0] -= 0.15;
      void u;
      break;
    }
    case 'laugh': {
      p.spine[0] -= 0.12 + abs(sin(t * 9)) * 0.06; p.head[0] -= 0.25;
      p.shoulderL[0] -= 0.5; p.shoulderR[0] -= 0.5; p.elbowL[0] -= 1.4; p.elbowR[0] -= 1.4; // hands on belly
      p.shoulderL[2] += 0.35; p.shoulderR[2] -= 0.35;
      p.rootY += abs(sin(t * 9)) * 0.012 * H;
      p.talkBoost = 0;
      break;
    }
    case 'cry': {
      p.shoulderL[0] -= 1.25; p.shoulderR[0] -= 1.25; p.elbowL[0] -= 2.2; p.elbowR[0] -= 2.2;
      p.shoulderL[2] += 0.45; p.shoulderR[2] -= 0.45; p.curlL = p.curlR = 0.5;
      p.head[0] += 0.3; p.spine[0] += 0.18;
      p.rootY += abs(sin(t * 6)) * 0.008 * H; p.chest[0] += sin(t * 6) * 0.03;
      break;
    }
    case 'sit': case 'ride': {
      const seat = ctx.seatHeight ?? null;
      if (seat != null) {
        p.rootY += seat - ctx.hipHeight;
        p.hipL[0] -= 1.55; p.hipR[0] -= 1.55; p.kneeL[0] += 1.55; p.kneeR[0] += 1.55;
        p.shoulderL[0] -= 0.35; p.shoulderR[0] -= 0.35; p.elbowL[0] -= 0.7; p.elbowR[0] -= 0.7;
      } else {
        // on the ground, knees up, arms around them
        p.rootY += -ctx.hipHeight + 0.09 * H;
        p.hipL[0] -= 1.95; p.hipR[0] -= 1.95; p.kneeL[0] += 2.1; p.kneeR[0] += 2.1;
        p.hipL[2] -= 0.12; p.hipR[2] += 0.12;
        p.spine[0] += 0.18;
        p.shoulderL[0] -= 0.9; p.shoulderR[0] -= 0.9; p.elbowL[0] -= 0.7; p.elbowR[0] -= 0.7;
        p.shoulderL[2] += 0.2; p.shoulderR[2] -= 0.2;
      }
      if (action === 'ride') { p.shoulderL[0] -= 0.6; p.shoulderR[0] -= 0.6; p.curlL = p.curlR = 0.9; }
      break;
    }
    case 'sleep': {
      p.rootRx = -Math.PI / 2 + 0.05;
      p.rootY += 0.1 * H - ctx.hipHeight * 0;
      p.rootZ -= ctx.hipHeight * 0.4;
      p.eyesClosed = 1;
      p.chest[0] += sin(t * 1.2) * 0.04;
      p.shoulderL[2] -= 0.25; p.shoulderR[2] += 0.25; p.elbowL[0] -= 0.4; p.elbowR[0] -= 0.4;
      p.head[2] = 0.25;
      p.lying = true;
      break;
    }
    case 'pray': {
      p.shoulderL[0] -= 0.55; p.shoulderR[0] -= 0.55; p.shoulderL[2] += 0.28; p.shoulderR[2] -= 0.28;
      p.elbowL[0] -= 1.95; p.elbowR[0] -= 1.95; p.elbowL[1] += 0.25; p.elbowR[1] -= 0.25;
      p.wristL[1] = 0.6; p.wristR[1] = -0.6; p.wristL[2] = -0.3; p.wristR[2] = 0.3;
      p.curlL = p.curlR = 0.05;
      p.head[0] += 0.38; p.eyesClosed = 1; p.spine[0] += 0.05;
      if (ctx.kneel) {
        p.rootY -= ctx.shinLen ?? 0.35 * H * 0.5; p.kneeL[0] += 1.57; p.kneeR[0] += 1.57; p.ankleL[0] -= 0.4; p.ankleR[0] -= 0.4;
      }
      break;
    }
    case 'fly': {
      const lift = smoothstep(0, 1.2, t);
      p.rootY += lift * (0.9 + sin(t * 1.6) * 0.12) * H * (ctx.canFly ? 1 : 0.55);
      p.rootRx += 0.35 * lift;
      if (ctx.canFly) { p.wings = 1; p.shoulderL[2] -= 1.2; p.shoulderR[2] += 1.2; p.shoulderL[0] += sin(t * 9) * 0.5; p.shoulderR[0] += sin(t * 9) * 0.5; }
      else { p.shoulderL[2] -= 1.5 + sin(t * 2) * 0.15; p.shoulderR[2] += 1.5 + sin(t * 2) * 0.15; p.curlL = p.curlR = 0.05; }
      p.kneeL[0] += 0.4; p.kneeR[0] += 0.6; p.hipL[0] += 0.15; p.hipR[0] += 0.05;
      p.head[0] -= 0.35 * lift;
      break;
    }
    case 'swim': {
      p.rootRx += 1.35; p.rootY += 0.6 * H + sin(t * 2) * 0.05 * H;
      const ph = t * TAU * 0.9;
      p.shoulderL[0] += -Math.PI + (ph % TAU) * 1.0; p.shoulderR[0] += -Math.PI + ((ph + Math.PI) % TAU) * 1.0;
      p.hipL[0] += sin(ph * 2) * 0.3; p.hipR[0] -= sin(ph * 2) * 0.3;
      p.head[0] -= 0.8;
      break;
    }
    case 'eat': {
      const u = (sin(t * TAU * 0.6) + 1) / 2;
      p.shoulderR[0] -= 0.8 + u * 0.3; p.elbowR[0] -= 1.6 + u * 0.6; p.shoulderR[2] -= 0.2; p.curlR = 0.7;
      p.talkBoost = 0; p.chew = true;
      break;
    }
    case 'build': case 'cook': case 'paint': {
      const f = action === 'build' ? 2.2 : action === 'cook' ? 1.2 : 1.6;
      const u = sin(t * TAU * f);
      p.spine[0] += 0.18; p.head[0] += 0.25;
      if (action === 'build') { p.shoulderR[0] -= 1.0 + u * 0.5; p.elbowR[0] -= 0.9 + u * 0.4; p.curlR = 1; }
      else { p.shoulderR[0] -= 0.9 + u * 0.15; p.shoulderR[2] += cos(t * TAU * f) * 0.15; p.elbowR[0] -= 1.0; p.curlR = 0.8; }
      p.shoulderL[0] -= 0.7; p.elbowL[0] -= 0.9; p.curlL = 0.4;
      break;
    }
    case 'read': case 'hold': {
      p.shoulderL[0] -= 0.65; p.shoulderR[0] -= 0.65; p.elbowL[0] -= 1.3; p.elbowR[0] -= 1.3;
      p.shoulderL[2] += 0.2; p.shoulderR[2] -= 0.2; p.curlL = p.curlR = 0.55;
      if (action === 'read') { p.head[0] += 0.35; p.lookUp -= 0.3; }
      break;
    }
    case 'hide': {
      p.rootY -= 0.25 * H; p.kneeL[0] += 1.6; p.kneeR[0] += 1.6; p.hipL[0] -= 1.3; p.hipR[0] -= 1.3; p.spine[0] += 0.4;
      p.shoulderL[0] -= 2.2; p.shoulderR[0] -= 2.2; p.elbowL[0] -= 1.4; p.elbowR[0] -= 1.4;
      p.rootY += sin(t * 30) * 0.002 * H;
      break;
    }
    case 'magic': {
      const u = t * 1.4;
      p.shoulderL[0] -= 1.3 + sin(u) * 0.2; p.shoulderR[0] -= 1.3 + cos(u) * 0.2;
      p.shoulderL[2] -= 0.4; p.shoulderR[2] += 0.4; p.elbowL[0] -= 0.3; p.elbowR[0] -= 0.3;
      p.curlL = p.curlR = 0; p.head[0] -= 0.1;
      p.rootY += smoothstep(0, 1, t) * sin(t * 2) * 0.01 * H;
      break;
    }
    case 'bow': {
      const k = sin(clamp(t / 1.6) * Math.PI);
      p.spine[0] += 0.7 * k; p.head[0] += 0.3 * k; p.shoulderR[0] -= 0.6 * k; p.elbowR[0] -= 1.5 * k;
      break;
    }
    case 'shiver': {
      p.shoulderL[0] -= 0.7; p.shoulderR[0] -= 0.7; p.elbowL[0] -= 1.9; p.elbowR[0] -= 1.9; p.shoulderL[2] += 0.5; p.shoulderR[2] -= 0.5;
      p.rootX += sin(t * 45) * 0.004 * H; p.head[0] += 0.12;
      break;
    }
    case 'stomp': {
      const ph = t * TAU * 1.2;
      p.hipL[0] -= Math.max(0, sin(ph)) * 0.6; p.kneeL[0] += Math.max(0, sin(ph)) * 0.8;
      p.hipR[0] -= Math.max(0, -sin(ph)) * 0.6; p.kneeR[0] += Math.max(0, -sin(ph)) * 0.8;
      p.curlL = p.curlR = 1; p.shoulderL[2] -= 0.3; p.shoulderR[2] += 0.3; p.elbowL[0] -= 0.8; p.elbowR[0] -= 0.8;
      p.spine[0] += 0.1; p.head[0] += 0.12;
      break;
    }
    case 'climb': {
      const ph = t * TAU * 0.8;
      p.shoulderL[0] -= 2.6 + sin(ph) * 0.3; p.shoulderR[0] -= 2.6 - sin(ph) * 0.3;
      p.hipL[0] -= Math.max(0, sin(ph)) * 1.0; p.kneeL[0] += Math.max(0, sin(ph)) * 1.2;
      p.hipR[0] -= Math.max(0, -sin(ph)) * 1.0; p.kneeR[0] += Math.max(0, -sin(ph)) * 1.2;
      p.rootY += (t * 0.25 * H) % (0.5 * H);
      p.head[0] -= 0.4;
      break;
    }
    case 'fall': {
      const k = smoothstep(0, 0.55, t);
      p.rootY -= k * (ctx.hipHeight - 0.08 * H);
      p.spine[0] -= 0.3 * k * (1 - smoothstep(0.55, 1.2, t)); p.rootRx -= 0.25 * k;
      p.hipL[0] -= 1.5 * k; p.hipR[0] -= 1.4 * k; p.kneeL[0] += 0.2 * k; p.kneeR[0] += 0.4 * k;
      p.shoulderL[2] -= 1.0 * (1 - k * 0.5); p.shoulderR[2] += 1.0 * (1 - k * 0.5);
      p.head[2] += sin(t * 4) * 0.1 * k;
      break;
    }
    case 'stand': default:
      break;
  }
  return p;
}

// Mouth shape over time while talking: amplitude a (0..1) → open/round.
export function visemeAt(t, a, seed) {
  const open = clamp(a * (0.6 + 0.4 * noise1(t * 9, seed)));
  const round = clamp(0.5 + 0.5 * noise1(t * 4.5, seed + 3)) * 0.6 * a;
  const width = 1 + noise1(t * 6, seed + 5) * 0.12 * a;
  return { open, round, width };
}

export { easeInOut };
