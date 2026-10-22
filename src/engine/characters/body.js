// Clothed cartoon bodies and accessories, in meters. Every part is a smooth
// primitive or lathe so it shades softly under the film lighting.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { fabric, mat, canvasTexture, knitNormalMap, weaveNormalMap } from '../materials.js';
import { lerp, smoothstep, makeRng } from '../../util.js';
import { sdEllipsoid, sdSphere, sdCapsule, smin, smax, surfaceNets } from './sdf.js';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export function capsule(r, len, mtl, seg = 20) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 8, seg), mtl);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Tapered limb segment from origin down -y by len.
export function limb(r0, r1, len, mtl) {
  const g = new THREE.CylinderGeometry(r0, r1, len, 20, 4, false);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, mtl);
  m.castShadow = true;
  m.receiveShadow = true;
  const cap0 = new THREE.Mesh(new THREE.SphereGeometry(r0, 20, 14), mtl);
  const cap1 = new THREE.Mesh(new THREE.SphereGeometry(r1, 20, 14), mtl);
  cap1.position.y = -len;
  cap0.castShadow = cap1.castShadow = true;
  const grp = new THREE.Group();
  grp.add(m, cap0, cap1);
  return grp;
}

// ---- fabric patterns -----------------------------------------------------------
const patternCache = new Map();
export function patternTexture(kind, c1, c2, seed = 1) {
  const key = [kind, c1, c2, seed].join('|');
  if (patternCache.has(key)) return patternCache.get(key);
  const A = '#' + new THREE.Color(c1).getHexString();
  const B = '#' + new THREE.Color(c2).getHexString();
  const tex = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = A; g.fillRect(0, 0, w, h);
    const rng = makeRng(seed);
    if (kind === 'stripes') {
      g.fillStyle = B;
      for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 26);
    } else if (kind === 'plaid' || kind === 'check') {
      g.globalAlpha = 0.55; g.fillStyle = B;
      for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 48, h);
      for (let y = 0; y < h; y += 128) g.fillRect(0, y, w, 48);
      g.globalAlpha = 0.35; g.fillStyle = '#ffffff';
      for (let x = 70; x < w; x += 128) g.fillRect(x, 0, 6, h);
      for (let y = 70; y < h; y += 128) g.fillRect(0, y, w, 6);
      g.globalAlpha = 1;
    } else if (kind === 'floral') {
      const petals = ['#f3a6b8', '#f7d1dc', '#e86a8a', '#ffffff', B];
      for (let i = 0; i < 60; i++) {
        const x = rng() * w, y = rng() * h, r = 10 + rng() * 16;
        g.fillStyle = '#5f8f5a';
        g.beginPath(); g.ellipse(x + r, y + r * 0.6, r * 0.7, r * 0.3, 0.6, 0, Math.PI * 2); g.fill();
        g.fillStyle = petals[i % petals.length];
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          g.beginPath(); g.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = '#f5d06a';
        g.beginPath(); g.arc(x, y, r * 0.3, 0, Math.PI * 2); g.fill();
      }
    } else if (kind === 'dots') {
      g.fillStyle = B;
      for (let y = 16; y < h; y += 48) for (let x = (y / 48) % 2 ? 40 : 16; x < w; x += 48) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
    } else if (kind === 'denim') {
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
        g.fillRect(rng() * w, rng() * h, 2, 6);
      }
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  patternCache.set(key, tex);
  return tex;
}

export function clothMaterial(color, pattern = 'solid', color2 = 0xffffff, opts = {}) {
  if (pattern === 'solid' || !pattern) return fabric(color, { knit: opts.knit, noCache: false });
  const map = patternTexture(pattern, color, color2, opts.seed ?? 1);
  map.repeat.set(opts.repeat ?? 2, opts.repeat ?? 2);
  return mat(0xffffff, {
    map, roughness: 0.85, sheen: 0.5, sheenColor: 0xffffff, sheenRoughness: 0.8,
    normalMap: opts.knit ? knitNormalMap() : weaveNormalMap(), normalScale: 0.3,
  });
}

// ---- torso -----------------------------------------------------------------------
// Profile radii keyed by height fraction; returns a lathe with uv + vertex colors.
export function torsoGeometry(dims, opts = {}) {
  const { hipR, waistR, chestR, shoulderR, neckR, height, depth } = dims;
  const pts = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let r;
    if (t < 0.32) r = lerp(hipR, waistR, smoothstep(0, 0.32, t));
    else if (t < 0.7) r = lerp(waistR, chestR, smoothstep(0.32, 0.7, t));
    else if (t < 0.88) r = lerp(chestR, shoulderR, smoothstep(0.7, 0.88, t));
    else {
      const u = (t - 0.88) / 0.12;
      r = lerp(shoulderR, neckR * 1.15, Math.sin(u * Math.PI / 2) ** 1.6);
    }
    pts.push(new THREE.Vector2(Math.max(0.001, r), t * height));
  }
  pts.unshift(new THREE.Vector2(0.001, 0));
  const g = new THREE.LatheGeometry(pts, 48);
  // flatten front-back; slight forward chest
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c1 = new THREE.Color(opts.color ?? 0xffffff);
  const c2 = new THREE.Color(opts.innerColor ?? opts.color ?? 0xffffff);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = y / height;
    const chestPush = smoothstep(0.45, 0.75, t) * (1 - smoothstep(0.85, 1, t)) * (z > 0 ? 0.012 : 0);
    const bust = opts.bust ? opts.bust * Math.exp(-(((t - 0.66) / 0.09) ** 2)) * Math.max(0, z / Math.hypot(x, z) || 0) ** 2 : 0;
    pos.setZ(i, z * depth + (z > 0 ? chestPush + bust : 0));
    const ang = Math.atan2(x, z); // 0 = front
    let c = c1;
    if (opts.openFront && Math.abs(ang) < opts.openFront && t < 0.97) c = c2;
    else if (opts.openFront && Math.abs(ang) < opts.openFront + 0.06 && t < 0.97) c = c1.clone().multiplyScalar(0.72);
    if (opts.vneck && Math.abs(ang) < 0.5 * smoothstep(0.75, 1, t) && t > 0.75) c = c2;
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

// ---- hands ---------------------------------------------------------------------
// Sculpted palm (knuckles, thumb mound, wrist) and tapered fingers with soft
// knuckle bulges; fingers stay separate groups so they can curl.
const handGeoCache = new Map();
function sdfMesh(key, f, box, h) {
  if (handGeoCache.has(key)) return handGeoCache.get(key);
  const g = surfaceNets(f, box[0], box[1], h, { project: 1, exactNormals: true });
  handGeoCache.set(key, g);
  return g;
}
export function buildHand(skinMat, s, side) {
  const hand = new THREE.Group();
  const k = Math.round(s * 100);
  const palmG = sdfMesh('palm' + k + side, (x, y, z) => {
    let d = sdEllipsoid(x, y, z, 0, -0.045 * s, 0, 0.04 * s, 0.045 * s, 0.017 * s);
    d = smin(d, sdCapsule(x, y, z, -0.032 * s, -0.08 * s, 0.001 * s, 0.032 * s, -0.082 * s, 0.001 * s, 0.012 * s), 0.012 * s);
    d = smin(d, sdEllipsoid(x, y, z, side * 0.024 * s, -0.03 * s, 0.01 * s, 0.017 * s, 0.026 * s, 0.014 * s), 0.01 * s);
    d = smin(d, sdCapsule(x, y, z, 0, 0.012 * s, 0, 0, -0.02 * s, 0, 0.022 * s, 0.026 * s), 0.02 * s);
    return d;
  }, [[-0.06 * s, -0.11 * s, -0.035 * s], [0.06 * s, 0.03 * s, 0.035 * s]], 0.0022 * s);
  const palm = new THREE.Mesh(palmG, skinMat);
  palm.castShadow = true;
  hand.add(palm);
  const fingers = [];
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Group();
    const len = (i === 1 ? 0.056 : i === 2 ? 0.052 : i === 0 ? 0.048 : 0.04) * s;
    const r = (i === 3 ? 0.0085 : 0.0098) * s;
    const fg = sdfMesh('finger' + k + i, (x, y, z) => {
      let d = sdCapsule(x, y, z, 0, 0, 0, 0, -len, 0, r, r * 0.78);
      d = smin(d, sdSphere(x, y, z, 0, -len * 0.45, 0.002 * s, r * 1.05), 0.006 * s);
      // nail bed: a slight flattening on the back of the tip
      d = smax(d, (z - r * 0.85) - 0.0, 0.004 * s);
      return d;
    }, [[-0.02 * s, -len - 0.02 * s, -0.02 * s], [0.02 * s, 0.02 * s, 0.02 * s]], 0.0018 * s);
    const seg = new THREE.Mesh(fg, skinMat);
    seg.castShadow = true;
    f.add(seg);
    f.position.set((i - 1.5) * 0.019 * s, -0.082 * s, 0);
    hand.add(f);
    fingers.push(f);
  }
  const thumb = new THREE.Group();
  const tg = sdfMesh('thumb' + k, (x, y, z) => smin(sdCapsule(x, y, z, 0, 0, 0, 0, -0.045 * s, 0, 0.0115 * s, 0.009 * s), sdSphere(x, y, z, 0, -0.022 * s, 0, 0.012 * s), 0.006 * s),
    [[-0.02 * s, -0.065 * s, -0.02 * s], [0.02 * s, 0.02 * s, 0.02 * s]], 0.0018 * s);
  const tseg = new THREE.Mesh(tg, skinMat);
  tseg.castShadow = true;
  thumb.add(tseg);
  thumb.position.set(side * 0.03 * s, -0.04 * s, 0.012 * s);
  thumb.rotation.z = side * 0.65;
  thumb.rotation.y = side * -0.5;
  hand.add(thumb);
  hand.userData.fingers = fingers;
  hand.userData.thumb = thumb;
  hand.userData.side = side;
  return hand;
}

export function setHandCurl(hand, curl, spread = 0) {
  const side = hand.userData.side;
  hand.userData.fingers.forEach((f, i) => {
    f.rotation.x = curl * 1.5 + (i === 3 ? curl * 0.15 : 0);
    f.rotation.z = (i - 1.5) * 0.08 * (1 + spread * 2) * -side;
  });
  hand.userData.thumb.rotation.x = curl * 0.6;
}

// ---- shoes -------------------------------------------------------------------------
// Sculpted shoes: a foot-shaped last with a rounded toe, a sole band, and
// laces / a toe cap depending on the style.
export function buildShoe(color, s, style = 'sneaker') {
  const g = new THREE.Group();
  const upperMat = mat(color, { roughness: style === 'boot' ? 0.5 : 0.62, clearcoat: style === 'dress' ? 0.7 : 0.1, clearcoatRoughness: 0.25 });
  const key = 'shoe' + style + Math.round(s * 100);
  const boot = style === 'boot', dress = style === 'dress';
  const last = (x, y, z) => {
    let d = sdEllipsoid(x, y, z, 0, 0.04 * s, 0.12 * s, 0.047 * s, 0.04 * s, 0.085 * s); // toe box
    d = smin(d, sdEllipsoid(x, y, z, 0, 0.05 * s, 0.0, 0.044 * s, 0.055 * s, 0.075 * s), 0.04 * s); // heel & instep
    if (boot) d = smin(d, sdCapsule(x, y, z, 0, 0.05 * s, -0.005 * s, 0, 0.16 * s, -0.01 * s, 0.05 * s, 0.047 * s), 0.03 * s);
    else d = smax(d, -sdCapsule(x, y, z, 0, 0.1 * s, 0.0, 0, 0.2 * s, -0.01 * s, 0.032 * s), 0.01 * s); // ankle opening
    return smax(d, 0.022 * s - y, 0.006 * s);
  };
  const upperG = sdfMesh(key + 'u', last, [[-0.07 * s, 0.0, -0.1 * s], [0.07 * s, (boot ? 0.22 : 0.13) * s, 0.23 * s]], 0.003 * s);
  const upper = new THREE.Mesh(upperG, upperMat);
  upper.castShadow = true;
  g.add(upper);
  const sole = (x, y, z) => {
    const r = sdEllipsoid(x, y, z, 0, 0.02 * s, 0.055 * s, 0.053 * s, 0.03 * s, 0.17 * s);
    return Math.max(r, Math.abs(y - 0.016 * s) - (dress ? 0.008 : 0.016) * s);
  };
  const soleG = sdfMesh(key + 's', sole, [[-0.07 * s, -0.01 * s, -0.13 * s], [0.07 * s, 0.05 * s, 0.24 * s]], 0.003 * s);
  const soleM = new THREE.Mesh(soleG, mat(dress ? 0x1a1414 : boot ? 0x3a2a20 : 0xf4f2ee, { roughness: 0.7 }));
  soleM.castShadow = true;
  g.add(soleM);
  if (!dress && !boot) {
    const lm = mat(0xf8f8f6, { roughness: 0.8 });
    for (let i = 0; i < 4; i++) {
      const lace = new THREE.Mesh(new THREE.CapsuleGeometry(0.0035 * s, 0.03 * s, 4, 8), lm);
      lace.rotation.z = Math.PI / 2;
      lace.rotation.x = 0.5;
      lace.position.set(0, (0.088 - i * 0.008) * s, (0.03 + i * 0.022) * s);
      g.add(lace);
    }
  }
  return g;
}

// ---- accessories ----------------------------------------------------------------------
export function buildGlasses(P, color = 0x1b1b1f, style = 'round') {
  // head units
  const g = new THREE.Group();
  const frameMat = mat(color, { roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  const lensMat = new THREE.MeshPhysicalMaterial({ color: 0xdfeeff, transparent: true, opacity: 0.1, roughness: 0.02, clearcoat: 1, depthWrite: false });
  const R = P.eyeR * 1.32;
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    const w = style === 'round' ? R : R * 1.18, h = style === 'round' ? R : R * 0.88, rr = style === 'round' ? R * 0.98 : R * 0.42;
    roundedRect(shape, -w, -h, w * 2, h * 2, rr);
    const hole = new THREE.Path();
    const t = 0.035;
    roundedRect(hole, -w + t, -h + t, (w - t) * 2, (h - t) * 2, Math.max(0.01, rr - t));
    shape.holes.push(hole);
    const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2, curveSegments: 24 }), frameMat);
    frame.position.set(side * P.eyeSpacing * 1.04, P.eyeY + 0.02, 0);
    frame.rotation.y = side * 0.12;
    g.add(frame);
    const lensShape = new THREE.Shape();
    roundedRect(lensShape, -w + t, -h + t, (w - t) * 2, (h - t) * 2, Math.max(0.01, rr - t));
    const lens = new THREE.Mesh(new THREE.ShapeGeometry(lensShape, 24), lensMat);
    lens.position.copy(frame.position).add(v3(0, 0, 0.02));
    lens.rotation.y = frame.rotation.y;
    lens.renderOrder = 5;
    g.add(lens);
    // temple arm back toward the ear
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.045, 0.95), frameMat);
    arm.position.set(side * (P.eyeSpacing + R) * 1.02 + side * 0.03, P.eyeY + 0.06, -0.47);
    arm.rotation.y = side * 0.06;
    g.add(arm);
  }
  const bridge = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.022, 8, 16, Math.PI), frameMat);
  bridge.position.set(0, P.eyeY + 0.05, 0.02);
  g.add(bridge);
  g.userData.radius = R;
  return g;
}

function roundedRect(path, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
}

export function buildBackpack(color, dims, opts = {}) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.7, sheen: 0.3 });
  const bag = new THREE.Mesh(new RoundedBoxGeometry(dims.shoulderR * 1.45, dims.height * 0.62, dims.shoulderR * 0.7, 5, 0.05), m);
  bag.position.set(0, dims.height * 0.58, -dims.shoulderR * dims.depth - dims.shoulderR * 0.33);
  bag.castShadow = true;
  g.add(bag);
  const pocket = new THREE.Mesh(new RoundedBoxGeometry(dims.shoulderR * 1.1, dims.height * 0.25, dims.shoulderR * 0.25, 4, 0.03), mat(new THREE.Color(color).multiplyScalar(0.8).getHex(), { roughness: 0.7 }));
  pocket.position.set(0, dims.height * 0.44, bag.position.z - dims.shoulderR * 0.42);
  g.add(pocket);
  const strapMat = mat(new THREE.Color(color).multiplyScalar(0.75).getHex(), { roughness: 0.65 });
  const H = dims.height, Z = dims.shoulderR * dims.depth;
  for (const side of opts.noStraps ? [] : [-1, 1]) {
    const x = side * dims.shoulderR * 0.45;
    const curve = new THREE.CatmullRomCurve3([
      v3(x * 1.1, H * 0.35, Z * 0.98),
      v3(x, H * 0.62, dims.chestR * dims.depth * 1.05 + 0.01),
      v3(x * 0.95, H * 0.85, dims.shoulderR * dims.depth * 0.95),
      v3(x * 0.95, H * 0.99, 0.0),
      v3(x, H * 0.9, -Z * 1.05),
    ]);
    const strap = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.018, 6), strapMat);
    strap.scale.set(1, 1, 1);
    strap.castShadow = true;
    g.add(strap);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.012), mat(0xb0b4ba, { metalness: 0.8, roughness: 0.3 }));
    buckle.position.set(x * 1.05, H * 0.46, dims.waistR * dims.depth + 0.03);
    g.add(buckle);
  }
  return g;
}

export function buildBeard(P, color, style, sculptFn) {
  // a shell over the jaw that tapers into the skin; head units
  const g = new THREE.SphereGeometry(1, 120, 90);
  const pos = g.attributes.position;
  const d = v3(), p = v3();
  const keep = new Uint8Array(pos.count);
  const full = style === 'full';
  const rgba = new Float32Array(pos.count * 4);
  const bc = new THREE.Color(color);
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    const jaw = smoothstep(full ? -0.32 : -0.45, full ? -0.55 : -0.65, d.y + Math.abs(d.x) * 0.12) * smoothstep(-0.55, -0.1, d.z);
    const sideburn = smoothstep(0.78, 0.92, Math.abs(d.x)) * smoothstep(0.05, -0.25, d.y) * smoothstep(-0.35, 0.05, d.z) * smoothstep(0.55, 0.2, d.z);
    const mouthHole = Math.exp(-0.5 * ((d.x / 0.2) ** 2 + ((d.y - P.mouthY + 0.02) / 0.075) ** 2)) * (d.z > 0.5 ? 1 : 0);
    const mustache = style !== 'stubble' ? Math.exp(-0.5 * ((d.x / 0.26) ** 2 + ((d.y - (P.mouthY + 0.11)) / 0.05) ** 2)) * (d.z > 0.6 ? 1 : 0) : 0;
    let m = Math.max(jaw, sideburn * 0.8, mustache) - mouthHole * 1.6;
    if (style === 'mustache') m = mustache - mouthHole;
    const noise = 0.06 * Math.sin(d.x * 23) * Math.sin(d.y * 19);
    m = Math.min(1, Math.max(0, m + noise * (m > 0 && m < 0.6 ? 1 : 0)));
    keep[i] = m > 0.05 ? 1 : 0;
    const sh = 0.85 + 0.3 * Math.abs(Math.sin(d.x * 61) * Math.sin(d.y * 53));
    rgba.set([bc.r * sh, bc.g * sh, bc.b * sh, smoothstep(0.05, 0.55, m)], i * 4);
    sculptFn(d, P, p);
    const thick = full ? 0.045 : style === 'mustache' ? 0.04 : 0.03;
    p.addScaledVector(d, 0.006 + thick * smoothstep(0.1, 0.7, m));
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  const idx = g.index.array;
  const kept = [];
  for (let i = 0; i < idx.length; i += 3) if (keep[idx[i]] && keep[idx[i + 1]] && keep[idx[i + 2]]) kept.push(idx[i], idx[i + 1], idx[i + 2]);
  g.setIndex(kept);
  g.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  g.computeVertexNormals();
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, alphaHash: true, roughness: 0.75, sheen: 0.6, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35), sheenRoughness: 0.5, normalMap: weaveNormalMap(), normalScale: new THREE.Vector2(1.2, 1.2) });
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

export function buildHat(kind, color, P) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.7, sheen: 0.3 });
  if (kind === 'cap') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.08, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), m);
    dome.scale.set(0.92, 0.75, 1.0);
    dome.position.y = 0.25;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.05, 32, 1, false, -Math.PI / 2, Math.PI), m);
    brim.scale.set(1, 1, 1.1);
    brim.position.set(0, 0.32, 0.55);
    brim.rotation.x = 0.12;
    g.add(dome, brim);
  } else if (kind === 'wizard' || kind === 'witch') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.2, 32, 6), m);
    cone.position.y = 1.65;
    cone.rotation.z = 0.15;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.06, 40), m);
    brim.position.y = 0.6;
    g.add(cone, brim);
  } else if (kind === 'crown') {
    const gold = mat(0xf0c040, { metalness: 0.9, roughness: 0.25 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.3, 32, 1, true), gold);
    band.position.y = 0.95;
    g.add(band);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 8), gold);
      spike.position.set(Math.sin(a) * 0.62, 1.25, Math.cos(a) * 0.62);
      g.add(spike);
      const gem = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), mat([0xe0304a, 0x3060e0, 0x30c060][i % 3], { roughness: 0.1, clearcoat: 1 }));
      gem.position.set(Math.sin(a) * 0.66, 0.95, Math.cos(a) * 0.66);
      g.add(gem);
    }
  } else if (kind === 'chef') {
    const white = mat(0xfafafa, { roughness: 0.8 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.45, 32), white);
    band.position.y = 0.7;
    const puff = new THREE.Mesh(new THREE.SphereGeometry(1.0, 24, 16), white);
    puff.scale.set(1.05, 0.7, 1.05);
    puff.position.y = 1.2;
    g.add(band, puff);
  } else if (kind === 'cowboy') {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.78, 0.7, 32), m);
    crown.position.y = 0.95;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.06, 40), m);
    brim.position.y = 0.62;
    brim.scale.set(1, 1, 0.85);
    g.add(crown, brim);
  } else if (kind === 'helmet') {
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xaad4ff, transparent: true, opacity: 0.18, roughness: 0.02, clearcoat: 1, depthWrite: false });
    const h = new THREE.Mesh(new THREE.SphereGeometry(1.55, 40, 30), glass);
    h.position.y = -0.1;
    h.renderOrder = 6;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.15, 12, 40), mat(0xe8ecf0, { roughness: 0.4 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -1.35;
    g.add(h, ring);
  } else if (kind === 'beanie') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(1.1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), fabric(color, { knit: true }));
    b.scale.set(0.92, 0.95, 1.0);
    b.position.y = 0.1;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), fabric(0xffffff, { knit: true }));
    pom.position.y = 1.15;
    g.add(b, pom);
  } else if (kind === 'halo') {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.06, 10, 40), new THREE.MeshBasicMaterial({ color: 0xfff1a8, toneMapped: false }));
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 1.5;
    g.add(halo);
  } else if (kind === 'veil') {
    const v = new THREE.Mesh(new THREE.SphereGeometry(1.12, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.62), fabric(color));
    v.position.y = 0.05;
    v.scale.set(0.95, 1.05, 1.02);
    const drape = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.25, 1.4, 32, 1, true, Math.PI * 0.35, Math.PI * 1.3), fabric(color));
    drape.position.set(0, -0.55, -0.1);
    drape.rotation.y = Math.PI;
    g.add(v, drape);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
