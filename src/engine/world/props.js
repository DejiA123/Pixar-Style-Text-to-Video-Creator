// Procedural prop library: everything a story might mention, plus the set
// dressing environments are built from. Sizes are in meters.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat, fabric, canvasTexture, basic, glowTexture, surfaceMat } from '../materials.js';
import { makeRng, lerp, smoothstep } from '../../util.js';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const shadowed = (o) => { o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; };
const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o; };

// Vertex-colored, noise-displaced blob — the building block of stylized foliage.
export function blobGeometry(radius, rng, opts = {}) {
  const g = new THREE.IcosahedronGeometry(radius, opts.detail ?? 3);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(opts.top ?? 0x7cc35a), bottom = new THREE.Color(opts.bottom ?? 0x2f6b34);
  const ph = rng() * 10;
  const v = v3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const bump = 1 + (opts.bump ?? 0.12) * (Math.sin(n.x * 5 + ph) * Math.sin(n.y * 6 + ph * 1.3) * Math.sin(n.z * 5.5 + ph * 0.7));
    v.multiplyScalar(bump);
    if (opts.flatBottom) v.y = Math.max(v.y, -radius * opts.flatBottom);
    pos.setXYZ(i, v.x, v.y, v.z);
    const c = bottom.clone().lerp(top, smoothstep(-0.8, 0.9, n.y) * 0.85 + 0.15 * smoothstep(0, 1, n.x * 0.5 + 0.5));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

const foliageMat = () => mat(0xffffff, { vertexColors: true, roughness: 0.8, sheen: 0.4, sheenColor: 0xd8ffb0, sheenRoughness: 0.6 });
const barkMat = (c = 0x6b4a32) => mat(c, { roughness: 0.9 });

export function tree(rng, opts = {}) {
  const g = new THREE.Group();
  const h = (opts.height ?? rng.range(3.2, 5)) * (opts.scale ?? 1);
  const trunkG = new THREE.CylinderGeometry(h * 0.045, h * 0.075, h * 0.6, 10, 4);
  const tp = trunkG.attributes.position;
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + Math.sin(y * 1.3) * h * 0.02); }
  trunkG.computeVertexNormals();
  g.add(mesh(trunkG, barkMat(opts.bark), 0, h * 0.3, 0));
  const palette = opts.palette || rng.pick([[0x8ccf5e, 0x2f6b34], [0x9ad66a, 0x3a7a3c], [0xb7d860, 0x4f7f2a], [0x6fbf73, 0x2a5e40]]);
  const cl = [];
  const n = opts.blobs ?? rng.int(4, 6);
  for (let i = 0; i < n; i++) {
    const r = h * rng.range(0.2, 0.3);
    const a = (i / n) * Math.PI * 2 + rng() * 0.6;
    const bg = blobGeometry(r, rng, { top: palette[0], bottom: palette[1] });
    bg.translate(Math.cos(a) * h * 0.15, h * (0.68 + rng() * 0.18), Math.sin(a) * h * 0.15);
    cl.push(bg);
  }
  const crown = blobGeometry(h * 0.3, rng, { top: palette[0], bottom: palette[1] });
  crown.translate(0, h * 0.85, 0);
  cl.push(crown);
  g.add(mesh(mergeGeometries(cl), foliageMat()));
  return g;
}

export function pine(rng, opts = {}) {
  const g = new THREE.Group();
  const h = (opts.height ?? rng.range(3.5, 6)) * (opts.scale ?? 1);
  g.add(mesh(new THREE.CylinderGeometry(h * 0.03, h * 0.05, h * 0.3, 8), barkMat(0x5a3d28), 0, h * 0.15, 0));
  const layers = [];
  const snow = opts.snow;
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    const cg = new THREE.ConeGeometry(h * (0.32 - t * 0.06), h * 0.38, 12, 3);
    const p = cg.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k);
      const rr = 1 + 0.08 * Math.sin(Math.atan2(p.getZ(k), p.getX(k)) * 6 + i);
      p.setX(k, p.getX(k) * rr); p.setZ(k, p.getZ(k) * rr);
      const top = y > h * 0.05;
      const c = snow && top ? new THREE.Color(0xf4f8ff) : new THREE.Color(0x2f6b45).lerp(new THREE.Color(0x5aa060), (y / (h * 0.38)) + 0.5);
      col.set([c.r, c.g, c.b], k * 3);
    }
    cg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    cg.computeVertexNormals();
    cg.translate(0, h * (0.35 + t * 0.2), 0);
    layers.push(cg);
  }
  g.add(mesh(mergeGeometries(layers), mat(0xffffff, { vertexColors: true, roughness: 0.85 })));
  return g;
}

export function palm(rng) {
  const g = new THREE.Group();
  const h = rng.range(4, 5.5);
  const segs = [];
  const bend = rng.range(0.3, 0.6) * (rng() < 0.5 ? -1 : 1);
  for (let i = 0; i < 9; i++) {
    const t = i / 9;
    const s = new THREE.CylinderGeometry(0.13 - t * 0.04, 0.15 - t * 0.04, h / 9 + 0.02, 10);
    s.translate(bend * t * t * 1.2, h * t + h / 18, 0);
    segs.push(s);
  }
  g.add(mesh(mergeGeometries(segs), barkMat(0x9a7b55)));
  const top = v3(bend * 1.2, h, 0);
  const leafMat = mat(0x5fae4a, { roughness: 0.7, side: THREE.DoubleSide });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const lg = new THREE.PlaneGeometry(2.4, 0.5, 12, 2);
    const p = lg.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k) + 1.2;
      const w = Math.sin((x / 2.4) * Math.PI);
      p.setY(k, p.getY(k) * w);
      p.setZ(k, -x * x * 0.18);
      p.setX(k, x);
    }
    lg.rotateX(-Math.PI / 2);
    lg.computeVertexNormals();
    const leaf = mesh(lg, leafMat);
    leaf.position.copy(top);
    leaf.rotation.y = a;
    leaf.rotation.z = 0.15;
    g.add(leaf);
  }
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.SphereGeometry(0.16, 12, 10), mat(0x6b4a2a, { roughness: 0.6 }), top.x + Math.cos(i * 2) * 0.2, h - 0.2, Math.sin(i * 2) * 0.2));
  return g;
}

export function bush(rng, opts = {}) {
  const g = new THREE.Group();
  const r = opts.r ?? rng.range(0.4, 0.8);
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const bg = blobGeometry(r * rng.range(0.6, 1), rng, { top: opts.top ?? 0x86c95f, bottom: opts.bottom ?? 0x2f6b34, flatBottom: 0.4 });
    bg.translate((i - 1) * r * 0.7, r * 0.5, rng.range(-0.2, 0.2) * r);
    parts.push(bg);
  }
  g.add(mesh(mergeGeometries(parts), foliageMat()));
  if (opts.flowers) {
    for (let i = 0; i < 10; i++) {
      const a = rng() * Math.PI * 2, y = rng.range(0.4, 1.0) * r;
      g.add(mesh(new THREE.SphereGeometry(r * 0.08, 8, 6), mat(rng.pick([0xff8fb1, 0xffffff, 0xffd84d, 0xff6f61]), { roughness: 0.6 }), Math.cos(a) * r * 1.1, y + r * 0.3, Math.sin(a) * r * 0.9));
    }
  }
  return g;
}

export function rock(rng, opts = {}) {
  const r = opts.r ?? rng.range(0.3, 0.9);
  const g = blobGeometry(r, rng, { top: opts.top ?? 0x9a9a92, bottom: opts.bottom ?? 0x6a6a66, bump: 0.25, detail: 2, flatBottom: 0.3 });
  g.scale(1, rng.range(0.5, 0.8), rng.range(0.8, 1.2));
  const m = mesh(g, mat(0xffffff, { vertexColors: true, roughness: 0.9, flat: !!opts.flat }));
  m.position.y = r * 0.15;
  const grp = new THREE.Group(); grp.add(m); return grp;
}

export function flowerPatch(rng, count = 24, radius = 1.5, colors = [0xff8fb1, 0xffffff, 0xffd84d, 0xff6f61, 0xb388ff]) {
  const g = new THREE.Group();
  const stemM = mat(0x4f8f3a, { roughness: 0.8 });
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * radius;
    const x = Math.cos(a) * d, z = Math.sin(a) * d, h = rng.range(0.15, 0.35);
    g.add(mesh(new THREE.CylinderGeometry(0.008, 0.01, h, 4), stemM, x, h / 2, z));
    const head = mesh(new THREE.SphereGeometry(0.045, 8, 6), mat(rng.pick(colors), { roughness: 0.6, sheen: 0.5 }), x, h, z);
    head.scale.set(1, 0.5, 1);
    g.add(head);
    g.add(mesh(new THREE.SphereGeometry(0.018, 6, 4), mat(0xffd34d), x, h + 0.015, z));
  }
  return g;
}

// ---- architecture -----------------------------------------------------------------
const signWords = ['CAFE', 'BOOKS', 'NOODLES', 'OPEN', 'PIZZA', 'BAKERY', 'TOYS', 'MUSIC', 'FLOWERS', 'TEA', 'DONUTS', 'ARCADE', 'SUSHI', 'MARKET', 'HOTEL', 'COFFEE', 'GELATO', 'RAMEN'];

export function windowTexture(rng, cols, rows, night, wall = '#d9c7a8') {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = wall; g.fillRect(0, 0, w, h);
    const cw = w / cols, ch = h / rows;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const lit = night ? rng() < 0.55 : false;
      g.fillStyle = lit ? rng.pick(['#ffd98a', '#ffe7b0', '#ffc46b', '#bfe3ff']) : rng.pick(['#5d7d9a', '#6f8fb0', '#4f6e8a']);
      g.fillRect(x * cw + cw * 0.2, y * ch + ch * 0.18, cw * 0.6, ch * 0.62);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(x * cw + cw * 0.2, y * ch + ch * 0.18, cw * 0.6, ch * 0.08);
    }
  });
}

export function building(rng, opts = {}) {
  const g = new THREE.Group();
  const w = opts.w ?? rng.range(4, 7), d = opts.d ?? rng.range(4, 6), h = opts.h ?? rng.range(6, 16);
  const night = !!opts.night;
  const wall = opts.wall ?? rng.pick(['#e6c8a0', '#d9a37a', '#c9d3d8', '#e8dcc8', '#b58a7a', '#a6b8c8', '#f0d9b5', '#c97b63']);
  const tex = windowTexture(rng, Math.max(2, Math.round(w / 1.4)), Math.max(2, Math.round(h / 2.2)), night, wall);
  const m = mat(0xffffff, { map: tex, roughness: 0.85, emissive: night ? 0xffffff : 0x000000, emissiveIntensity: night ? 0.55 : 0 });
  if (night) m.emissiveMap = tex;
  const body = mesh(new RoundedBoxGeometry(w, h, d, 2, 0.08), m, 0, h / 2, 0);
  g.add(body);
  g.add(mesh(new THREE.BoxGeometry(w * 1.04, 0.25, d * 1.04), mat(new THREE.Color(wall).multiplyScalar(0.75).getHex(), { roughness: 0.8 }), 0, h + 0.1, 0));
  // storefront with awning + sign
  const awning = mesh(new THREE.BoxGeometry(w * 0.85, 0.08, 1.1), mat(rng.pick([0xd9443b, 0x2f8f6a, 0x3a6fb5, 0xf2b33d, 0x8a4fd0]), { roughness: 0.7 }), 0, 2.9, d / 2 + 0.5);
  awning.rotation.x = 0.25;
  g.add(awning);
  if (opts.sign !== false) {
    const word = rng.pick(signWords);
    const neon = rng.pick(['#ff4fa3', '#4fd8ff', '#ffd84f', '#7dff6a', '#ff7a3d', '#b38cff']);
    const st = canvasTexture(512, 128, (c, W, H) => {
      c.fillStyle = night ? '#160c22' : '#2a2a35'; c.fillRect(0, 0, W, H);
      c.font = 'bold 84px "Trebuchet MS", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = neon; c.shadowBlur = night ? 26 : 6; c.fillStyle = night ? '#fff' : neon;
      c.fillText(word, W / 2, H / 2 + 4);
      c.strokeStyle = neon; c.lineWidth = 6; c.strokeRect(8, 8, W - 16, H - 16);
    });
    const signM = new THREE.MeshStandardMaterial({ map: st, emissive: 0xffffff, emissiveMap: st, emissiveIntensity: night ? 2.2 : 0.4, roughness: 0.5 });
    const sign = mesh(new THREE.PlaneGeometry(Math.min(w * 0.7, 3.2), Math.min(w * 0.7, 3.2) / 4), signM, 0, 3.6, d / 2 + 0.03);
    g.add(sign);
    if (opts.vertical) {
      const vt = canvasTexture(128, 512, (c, W, H) => {
        c.fillStyle = '#120a1c'; c.fillRect(0, 0, W, H);
        c.font = 'bold 70px sans-serif'; c.textAlign = 'center'; c.fillStyle = '#fff'; c.shadowColor = neon; c.shadowBlur = 24;
        const wd = rng.pick(signWords).slice(0, 5);
        for (let i = 0; i < wd.length; i++) c.fillText(wd[i], W / 2, 90 + i * 90);
      });
      const vs = mesh(new THREE.BoxGeometry(0.15, 3.2, 0.9), [mat(0x222222), mat(0x222222), mat(0x222222), mat(0x222222), new THREE.MeshStandardMaterial({ map: vt, emissive: 0xffffff, emissiveMap: vt, emissiveIntensity: night ? 2.5 : 0.5 }), new THREE.MeshStandardMaterial({ map: vt, emissive: 0xffffff, emissiveMap: vt, emissiveIntensity: night ? 2.5 : 0.5 })], w / 2 - 0.3, 6, d / 2 + 0.5);
      vs.rotation.y = Math.PI / 2;
      g.add(vs);
    }
  }
  g.add(mesh(new THREE.BoxGeometry(1.2, 2.2, 0.1), mat(0x6b4a32, { roughness: 0.6 }), -w * 0.25, 1.1, d / 2 + 0.02));
  return g;
}

export function house(rng, opts = {}) {
  const g = new THREE.Group();
  const w = opts.w ?? rng.range(4, 5.5), d = opts.d ?? rng.range(4, 5), h = opts.h ?? rng.range(2.8, 3.4);
  const wall = opts.wall ?? rng.pick([0xf2e3c9, 0xf6d7b0, 0xd8e8f0, 0xf2c4b3, 0xe5f0d0, 0xfff1d6]);
  g.add(mesh(new RoundedBoxGeometry(w, h, d, 2, 0.06), mat(wall, { roughness: 0.85 }), 0, h / 2, 0));
  const roofC = opts.roof ?? rng.pick([0xc0503a, 0x8a4a3a, 0x4a5f7a, 0x6a3f2f, 0x3f6b5a]);
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-w / 2 - 0.35, 0); roofShape.lineTo(0, h * 0.55); roofShape.lineTo(w / 2 + 0.35, 0); roofShape.lineTo(-w / 2 - 0.35, 0);
  const roof = mesh(new THREE.ExtrudeGeometry(roofShape, { depth: d + 0.6, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05 }), mat(roofC, { roughness: 0.75 }), 0, h, -d / 2 - 0.3);
  g.add(roof);
  const winM = mat(opts.night ? 0xffd98a : 0x8fb5d8, { roughness: 0.15, clearcoat: 1, emissive: opts.night ? 0xffb85a : 0x000000, emissiveIntensity: opts.night ? 1.6 : 0 });
  for (const x of [-w * 0.27, w * 0.27]) {
    g.add(mesh(new THREE.BoxGeometry(0.9, 0.9, 0.08), winM, x, h * 0.55, d / 2 + 0.01));
    g.add(mesh(new THREE.BoxGeometry(1.05, 0.08, 0.14), mat(0xffffff), x, h * 0.55 - 0.5, d / 2 + 0.04));
  }
  g.add(mesh(new THREE.BoxGeometry(0.9, 1.8, 0.1), mat(rng.pick([0x3a6fb5, 0xd9443b, 0x2f8f6a, 0x8b5a2b]), { roughness: 0.5 }), 0, 0.9, d / 2 + 0.02));
  g.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), mat(0xe8c060, { metalness: 0.9, roughness: 0.3 }), 0.3, 0.9, d / 2 + 0.09));
  g.add(mesh(new THREE.BoxGeometry(0.5, 1.0, 0.5), mat(0xb0705a, { roughness: 0.9 }), w * 0.3, h + h * 0.4, -d * 0.1));
  return g;
}

export function lampPost(night, opts = {}) {
  const g = new THREE.Group();
  const m = mat(0x2b2f36, { metalness: 0.6, roughness: 0.4 });
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.6, 10), m, 0, 1.8, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.25, 10), m, 0, 0.12, 0));
  const lamp = mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0xffd28a, emissiveIntensity: night ? 4 : 0.3 }), 0, 3.75, 0);
  lamp.castShadow = false;
  g.add(lamp);
  g.add(mesh(new THREE.ConeGeometry(0.3, 0.25, 12), m, 0, 4.0, 0));
  if (night && opts.light !== false) {
    const pl = new THREE.PointLight(0xffc77a, 6, 9, 1.6);
    pl.position.set(0, 3.6, 0);
    g.add(pl);
  }
  return g;
}

export function bench(opts = {}) {
  const g = new THREE.Group();
  const w = opts.w ?? 1.8;
  const wood = surfaceMat('oak_wood_planks', 1, 1, { tint: opts.color ?? 0xc8925a, brighten: 1.1 });
  for (let i = 0; i < 3; i++) g.add(mesh(new RoundedBoxGeometry(w, 0.05, 0.13, 2, 0.02), wood, 0, 0.45, -0.15 + i * 0.15));
  for (let i = 0; i < 2; i++) { const b = mesh(new RoundedBoxGeometry(w, 0.05, 0.12, 2, 0.02), wood, 0, 0.65 + i * 0.16, -0.27); b.rotation.x = -0.15; g.add(b); }
  const iron = mat(0x2b2f36, { metalness: 0.6, roughness: 0.4 });
  for (const x of [-w / 2 + 0.15, w / 2 - 0.15]) { g.add(mesh(new THREE.BoxGeometry(0.06, 0.45, 0.4), iron, x, 0.22, -0.05)); g.add(mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), iron, x, 0.7, -0.27)); }
  g.userData.seatHeight = 0.47;
  return g;
}

export function pew(w = 3.2) {
  const g = new THREE.Group();
  const wood = surfaceMat('oak_wood_planks', 1, 1, { tint: 0xb07a52, brighten: 1.0, clearcoat: 0.35 });
  g.add(mesh(new RoundedBoxGeometry(w, 0.08, 0.45, 2, 0.03), wood, 0, 0.45, 0));
  const back = mesh(new RoundedBoxGeometry(w, 0.55, 0.06, 2, 0.02), wood, 0, 0.75, -0.22);
  back.rotation.x = -0.08;
  g.add(back);
  for (const x of [-w / 2, w / 2]) g.add(mesh(new RoundedBoxGeometry(0.08, 1.0, 0.55, 2, 0.03), wood, x, 0.5, -0.02));
  g.add(mesh(new RoundedBoxGeometry(w, 0.05, 0.12, 2, 0.02), wood, 0, 0.62, -0.42));
  g.userData.seatHeight = 0.49;
  return g;
}

export function stainedGlassTexture(rng, palette) {
  return canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#1a1410'; g.fillRect(0, 0, w, h);
    const cols = palette || ['#d9443b', '#3a6fd5', '#f2c94c', '#3fb37f', '#8a4fd0', '#ff8a3d'];
    // arched window of glass shards
    g.save();
    g.beginPath(); g.moveTo(16, h - 16); g.lineTo(16, w / 2); g.arc(w / 2, w / 2, w / 2 - 16, Math.PI, 0); g.lineTo(w - 16, h - 16); g.closePath(); g.clip();
    for (let i = 0; i < 70; i++) {
      g.fillStyle = rng.pick(cols);
      g.beginPath();
      const x = rng() * w, y = rng() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) g.lineTo(x + rng.range(-60, 60), y + rng.range(-60, 60));
      g.closePath(); g.fill();
      g.strokeStyle = '#1a1410'; g.lineWidth = 5; g.stroke();
    }
    // a central cross motif
    g.fillStyle = '#fff2c4';
    g.fillRect(w / 2 - 10, h * 0.25, 20, h * 0.5);
    g.fillRect(w / 2 - 50, h * 0.38, 100, 20);
    g.restore();
    g.strokeStyle = '#2a2018'; g.lineWidth = 14;
    g.beginPath(); g.moveTo(16, h - 16); g.lineTo(16, w / 2); g.arc(w / 2, w / 2, w / 2 - 16, Math.PI, 0); g.lineTo(w - 16, h - 16); g.closePath(); g.stroke();
  });
}

export function cross(color = 0xd9b26a, h = 1.6) {
  const g = new THREE.Group();
  const m = mat(color, { metalness: 0.75, roughness: 0.3 });
  g.add(mesh(new RoundedBoxGeometry(0.14, h, 0.1, 2, 0.03), m, 0, h / 2, 0));
  g.add(mesh(new RoundedBoxGeometry(h * 0.6, 0.14, 0.1, 2, 0.03), m, 0, h * 0.68, 0));
  return g;
}

export function candle(lit = true) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.3, 12), mat(0xfff4dc, { roughness: 0.5, sheen: 0.4 }), 0, 0.15, 0));
  if (lit) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffcf6a, toneMapped: false }));
    f.scale.set(0.7, 1.6, 0.7);
    f.position.y = 0.34;
    g.add(f);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb04a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(0.35, 0.35, 1);
    glow.position.y = 0.34;
    g.add(glow);
    g.userData.flame = f;
  }
  return g;
}

export function stall(rng) {
  const g = new THREE.Group();
  const wood = surfaceMat('oak_wood_planks', 1, 1, { tint: 0xc8925a, brighten: 1.1 });
  g.add(mesh(new RoundedBoxGeometry(2.4, 0.9, 1.1, 2, 0.04), wood, 0, 0.45, 0));
  for (const [x, z] of [[-1.1, -0.5], [1.1, -0.5], [-1.1, 0.5], [1.1, 0.5]]) g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 8), wood, x, 1.2, z));
  const cloth = mat(rng.pick([0xd9443b, 0xf2b33d, 0x2f8f6a, 0x3a6fb5, 0xe86aa0, 0xff8a3d]), { roughness: 0.75, sheen: 0.4, side: THREE.DoubleSide });
  const canopy = mesh(new THREE.CylinderGeometry(0.01, 1.7, 0.6, 4, 1, true), cloth, 0, 2.6, 0);
  canopy.rotation.y = Math.PI / 4;
  canopy.scale.set(1.0, 1, 0.7);
  g.add(canopy);
  const fruitCols = [0xd9443b, 0xf2b33d, 0x6fbf3a, 0xff8a3d, 0x8a2f5a, 0xffd84d];
  for (let i = 0; i < 40; i++) {
    const f = mesh(new THREE.SphereGeometry(rng.range(0.05, 0.08), 10, 8), mat(rng.pick(fruitCols), { roughness: 0.45, clearcoat: 0.4 }), rng.range(-1.0, 1.0), 0.95 + rng() * 0.08, rng.range(-0.45, 0.45));
    g.add(f);
  }
  return g;
}

export function stringLights(from, to, count, night, colors = [0xffe2a8, 0xffc46b, 0xfff1d0]) {
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    pts.push(from.clone().lerp(to, t).add(v3(0, -Math.sin(t * Math.PI) * 0.6, 0)));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.008, 4), mat(0x222222)));
  for (let i = 0; i < count; i++) {
    const p = curve.getPoint((i + 0.5) / count);
    const c = colors[i % colors.length];
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(night ? 3 : 1.2), toneMapped: !night }));
    b.position.copy(p);
    g.add(b);
  }
  return g;
}

export function bunting(from, to, count, rng) {
  const g = new THREE.Group();
  const cols = [0xd9443b, 0xf2b33d, 0x2f8f6a, 0x3a6fb5, 0xe86aa0, 0xffffff];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const p = from.clone().lerp(to, t).add(v3(0, -Math.sin(t * Math.PI) * 0.5, 0));
    const tri = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.35, 3), mat(cols[i % cols.length], { roughness: 0.7, side: THREE.DoubleSide }));
    tri.rotation.z = Math.PI;
    tri.scale.z = 0.1;
    tri.position.copy(p).add(v3(0, -0.18, 0));
    g.add(tri);
  }
  return g;
}

export function fence(len = 6, color = 0xf6f1e8) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.7 });
  const n = Math.round(len / 0.35);
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + i * 0.35;
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.9, 0.04), m, x, 0.45, 0));
    const tip = mesh(new THREE.ConeGeometry(0.07, 0.12, 4), m, x, 0.96, 0);
    tip.rotation.y = Math.PI / 4;
    g.add(tip);
  }
  for (const y of [0.3, 0.7]) g.add(mesh(new THREE.BoxGeometry(len, 0.07, 0.03), m, -0.175 + 0, y, -0.03));
  return g;
}

export function cloudPuff(rng, scale = 1, color = 0xffffff) {
  const parts = [];
  const n = rng.int(5, 8);
  for (let i = 0; i < n; i++) {
    const r = rng.range(0.6, 1.2) * scale;
    const g = new THREE.SphereGeometry(r, 16, 12);
    g.translate((i - n / 2) * 0.8 * scale + rng.range(-0.2, 0.2), rng.range(0, 0.5) * scale, rng.range(-0.4, 0.4) * scale);
    parts.push(g);
  }
  const m = new THREE.Mesh(mergeGeometries(parts), mat(color, { roughness: 1, sheen: 1, sheenColor: 0xffffff, emissive: color, emissiveIntensity: 0.15 }));
  return m;
}

// ---- story props ---------------------------------------------------------------------
export function makeProp(type, rng = makeRng(1), opts = {}) {
  const g = new THREE.Group();
  g.name = 'prop:' + type;
  const add = (o) => (g.add(o), o);
  const M = (c, o = {}) => mat(c, { roughness: 0.5, ...o });
  switch (type) {
    case 'ball': add(mesh(new THREE.SphereGeometry(0.12, 24, 16), M(0xd9443b, { clearcoat: 0.6 }), 0, 0.12, 0)); add(mesh(new THREE.TorusGeometry(0.121, 0.012, 8, 32), M(0xffffff), 0, 0.12, 0)); break;
    case 'balloon': {
      const c = rng.pick([0xd9443b, 0xf2b33d, 0x3a6fb5, 0xe86aa0, 0x2f8f6a]);
      const b = add(mesh(new THREE.SphereGeometry(0.22, 24, 18), M(c, { clearcoat: 1, roughness: 0.2 }), 0, 1.6, 0)); b.scale.set(1, 1.18, 1);
      add(mesh(new THREE.CylinderGeometry(0.003, 0.003, 1.4, 4), M(0xeeeeee), 0, 0.75, 0));
      break;
    }
    case 'kite': {
      const sh = new THREE.Shape(); sh.moveTo(0, 0.5); sh.lineTo(0.35, 0); sh.lineTo(0, -0.6); sh.lineTo(-0.35, 0); sh.lineTo(0, 0.5);
      add(mesh(new THREE.ShapeGeometry(sh), M(0xd9443b, { side: THREE.DoubleSide }), 0, 2.6, 0));
      for (let i = 0; i < 5; i++) add(mesh(new THREE.ConeGeometry(0.05, 0.1, 4), M([0xf2b33d, 0x3a6fb5][i % 2]), 0, 2.0 - i * 0.18, 0));
      add(mesh(new THREE.CylinderGeometry(0.003, 0.003, 2.4, 4), M(0xffffff), 0, 1.2, 0));
      break;
    }
    case 'cake': case 'cupcake': {
      const s = type === 'cake' ? 1 : 0.35;
      add(mesh(new THREE.CylinderGeometry(0.3 * s, 0.3 * s, 0.25 * s, 32), M(0xf6d7b0), 0, 0.125 * s, 0));
      add(mesh(new THREE.CylinderGeometry(0.31 * s, 0.31 * s, 0.06 * s, 32), M(0xf7a8c4, { clearcoat: 0.5 }), 0, 0.27 * s, 0));
      if (type === 'cake') for (let i = 0; i < 5; i++) { const c = candle(true); c.scale.setScalar(0.5); c.position.set(Math.cos(i * 1.25) * 0.18, 0.3, Math.sin(i * 1.25) * 0.18); add(c); }
      else add(mesh(new THREE.SphereGeometry(0.04, 10, 8), M(0xd9443b), 0, 0.12, 0));
      if (opts.onTable !== false && type === 'cake') g.position.y = 0;
      break;
    }
    case 'gift': {
      add(mesh(new RoundedBoxGeometry(0.4, 0.35, 0.4, 2, 0.03), M(rng.pick([0xd9443b, 0x3a6fb5, 0x8a4fd0, 0x2f8f6a])), 0, 0.175, 0));
      add(mesh(new THREE.BoxGeometry(0.42, 0.36, 0.06), M(0xf2c94c, { clearcoat: 0.5 }), 0, 0.175, 0));
      add(mesh(new THREE.BoxGeometry(0.06, 0.36, 0.42), M(0xf2c94c, { clearcoat: 0.5 }), 0, 0.175, 0));
      add(mesh(new THREE.TorusKnotGeometry(0.05, 0.015, 32, 6), M(0xf2c94c), 0, 0.38, 0));
      break;
    }
    case 'book': case 'bible': {
      add(mesh(new RoundedBoxGeometry(0.2, 0.05, 0.28, 2, 0.01), M(type === 'bible' ? 0x2a1a14 : rng.pick([0x3a6fb5, 0xd9443b, 0x2f8f6a])), 0, 0.025, 0));
      add(mesh(new THREE.BoxGeometry(0.19, 0.04, 0.26), M(0xfaf6ea), 0.008, 0.025, 0));
      if (type === 'bible') add(mesh(new THREE.BoxGeometry(0.02, 0.003, 0.08), M(0xe8c060, { metalness: 0.9 }), 0, 0.052, 0));
      break;
    }
    case 'flower': { const f = flowerPatch(rng, 7, 0.08); f.scale.setScalar(1.3); add(f); break; }
    case 'tree': add(tree(rng)); break;
    case 'house': add(house(rng, opts)); break;
    case 'car': {
      const c = rng.pick([0xd9443b, 0x3a6fb5, 0xf2b33d, 0x2f8f6a, 0xf2f2f2]);
      add(mesh(new RoundedBoxGeometry(1.8, 0.55, 3.6, 4, 0.2), M(c, { clearcoat: 1, clearcoatRoughness: 0.05, roughness: 0.3 }), 0, 0.6, 0));
      add(mesh(new RoundedBoxGeometry(1.5, 0.55, 1.9, 4, 0.22), M(0x9fc6e8, { roughness: 0.05, clearcoat: 1, metalness: 0.2 }), 0, 1.1, -0.2));
      for (const [x, z] of [[-0.85, 1.15], [0.85, 1.15], [-0.85, -1.15], [0.85, -1.15]]) { const w = add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.25, 20), M(0x1d1d1f, { roughness: 0.8 }), x, 0.35, z)); w.rotation.z = Math.PI / 2; }
      for (const x of [-0.6, 0.6]) add(mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xfff2c0, emissiveIntensity: opts.night ? 1.4 : 0.4 }), x, 0.65, 1.8));
      break;
    }
    case 'rocket': {
      const body = add(mesh(new THREE.CylinderGeometry(0.45, 0.6, 3, 24), M(0xf2f2f2, { clearcoat: 0.6 }), 0, 1.9, 0));
      void body;
      add(mesh(new THREE.ConeGeometry(0.45, 1.2, 24), M(0xd9443b, { clearcoat: 0.6 }), 0, 4.0, 0));
      add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 24), M(0x7fb6e6, { roughness: 0.05, clearcoat: 1 }), 0, 2.6, 0.5)).rotation.x = Math.PI / 2;
      for (let i = 0; i < 3; i++) { const fin = add(mesh(new THREE.BoxGeometry(0.06, 1.0, 0.7), M(0xd9443b), Math.cos(i * 2.1) * 0.6, 0.7, Math.sin(i * 2.1) * 0.6)); fin.rotation.y = -i * 2.1; }
      const flame = add(new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.2, 16), new THREE.MeshBasicMaterial({ color: 0xffa040, toneMapped: false, transparent: true, opacity: 0.9 })));
      flame.position.y = -0.3; flame.rotation.x = Math.PI; flame.visible = !!opts.flame;
      g.userData.flame = flame;
      break;
    }
    case 'ufo': {
      add(mesh(new THREE.SphereGeometry(1.2, 32, 12), M(0xc4cad3, { metalness: 0.8, roughness: 0.25 }), 0, 1.5, 0)).scale.set(1, 0.25, 1);
      add(mesh(new THREE.SphereGeometry(0.55, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), M(0x9fe0ff, { transparent: true, opacity: 0.6, roughness: 0.05 }), 0, 1.6, 0));
      for (let i = 0; i < 8; i++) add(mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: [0xff4fa3, 0x4fd8ff, 0xffd84f][i % 3], toneMapped: false }), Math.cos(i * 0.785) * 1.15, 1.5, Math.sin(i * 0.785) * 1.15));
      break;
    }
    case 'star': {
      const sh = new THREE.Shape();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.12 : 0.28; const a = (i / 10) * Math.PI * 2 + Math.PI / 2; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? sh.lineTo(x, y) : sh.moveTo(x, y); }
      const s = add(mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03 }), new THREE.MeshStandardMaterial({ color: 0xffd84d, emissive: 0xffc030, emissiveIntensity: 1.5, roughness: 0.3 }), 0, 1.2, 0));
      s.geometry.center();
      break;
    }
    case 'heart': {
      const sh = new THREE.Shape(); sh.moveTo(0, -0.25); sh.bezierCurveTo(0.35, 0.0, 0.25, 0.3, 0, 0.15); sh.bezierCurveTo(-0.25, 0.3, -0.35, 0.0, 0, -0.25);
      const h = add(mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04 }), M(0xe8435a, { clearcoat: 1 }), 0, 1.2, 0));
      h.geometry.center();
      break;
    }
    case 'crown': add(mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.08, 16, 1, true), M(0xf0c040, { metalness: 0.9, roughness: 0.25, side: THREE.DoubleSide }), 0, 0.04, 0)); break;
    case 'treasure': {
      add(mesh(new RoundedBoxGeometry(0.8, 0.45, 0.5, 2, 0.04), M(0x8b5a2b), 0, 0.225, 0));
      const lid = add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.8, 16, 1, false, 0, Math.PI), M(0x8b5a2b), 0, 0.45, 0)); lid.rotation.z = Math.PI / 2; lid.rotation.y = Math.PI / 2;
      for (let i = 0; i < 18; i++) add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 12), M(0xf0c040, { metalness: 0.9, roughness: 0.2 }), rng.range(-0.3, 0.3), 0.46 + rng() * 0.05, rng.range(-0.15, 0.15)));
      break;
    }
    case 'map': case 'letter': {
      const t = canvasTexture(256, 192, (c, W, H) => { c.fillStyle = type === 'map' ? '#e8d5a8' : '#fbf8f0'; c.fillRect(0, 0, W, H); c.strokeStyle = type === 'map' ? '#8b5a2b' : '#7a8aa0'; c.lineWidth = 3; if (type === 'map') { c.setLineDash([8, 6]); c.beginPath(); c.moveTo(30, 150); c.bezierCurveTo(90, 40, 160, 160, 220, 50); c.stroke(); c.setLineDash([]); c.strokeStyle = '#c0392b'; c.lineWidth = 6; c.beginPath(); c.moveTo(205, 35); c.lineTo(235, 65); c.moveTo(235, 35); c.lineTo(205, 65); c.stroke(); } else { for (let y = 40; y < 170; y += 22) { c.beginPath(); c.moveTo(24, y); c.lineTo(232, y); c.stroke(); } } });
      add(mesh(new THREE.PlaneGeometry(0.32, 0.24), mat(0xffffff, { map: t, side: THREE.DoubleSide, roughness: 0.9 }), 0, 0.01, 0)).rotation.x = -Math.PI / 2;
      break;
    }
    case 'lantern': {
      add(mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.25, 8), new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffb050, emissiveIntensity: 2.5, transparent: true, opacity: 0.9 }), 0, 0.15, 0));
      add(mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 16), M(0x2b2f36, { metalness: 0.7 }), 0, 0.32, 0));
      const pl = new THREE.PointLight(0xffb050, 2.5, 4, 2); pl.position.y = 0.15; add(pl);
      break;
    }
    case 'campfire': {
      for (let i = 0; i < 5; i++) { const l = add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 8), mat(0x6b4a32, { roughness: 0.9 }), 0, 0.08, 0)); l.rotation.z = Math.PI / 2; l.rotation.y = (i / 5) * Math.PI; }
      for (let i = 0; i < 10; i++) add(rock(rng, { r: 0.12 })).position.set(Math.cos(i * 0.63) * 0.55, 0, Math.sin(i * 0.63) * 0.55);
      const flames = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.16 - i * 0.03, 0.5 - i * 0.06, 12), new THREE.MeshBasicMaterial({ color: [0xff5a1f, 0xff8a2a, 0xffc04a, 0xfff0a0][i], toneMapped: false, transparent: true, opacity: 0.85, depthWrite: false }));
        f.position.y = 0.3 + i * 0.02;
        flames.add(f);
      }
      add(flames);
      const pl = new THREE.PointLight(0xff8a3a, 8, 7, 1.5); pl.position.y = 0.5; add(pl);
      g.userData.flames = flames; g.userData.light = pl;
      break;
    }
    case 'tent': {
      const t = add(mesh(new THREE.ConeGeometry(1.1, 1.5, 4, 1), M(rng.pick([0xf2b33d, 0x3a6fb5, 0x2f8f6a]), { roughness: 0.8 }), 0, 0.75, 0)); t.rotation.y = Math.PI / 4;
      add(mesh(new THREE.PlaneGeometry(0.5, 0.9), mat(0x2a2018, { side: THREE.DoubleSide }), 0, 0.45, 0.79));
      break;
    }
    case 'boat': {
      const hull = add(mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M(0xa0522d, { side: THREE.DoubleSide }), 0, 0.5, 0)); hull.scale.set(0.7, 0.5, 1.8);
      add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8), M(0x6b4a32), 0, 1.5, 0));
      const sail = add(mesh(new THREE.PlaneGeometry(1.0, 1.5), M(0xfaf6ea, { side: THREE.DoubleSide }), 0.02, 1.6, 0.4)); sail.rotation.y = Math.PI / 2;
      break;
    }
    case 'apple': add(mesh(new THREE.SphereGeometry(0.06, 16, 12), M(0xd9443b, { clearcoat: 0.6 }), 0, 0.06, 0)); add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 4), M(0x5a3d28), 0, 0.13, 0)); break;
    case 'cookie': add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 20), M(0xc8924f), 0, 0.01, 0)); break;
    case 'icecream': add(mesh(new THREE.ConeGeometry(0.045, 0.14, 16), M(0xd9a35f), 0, 0.07, 0)).rotation.x = Math.PI; add(mesh(new THREE.SphereGeometry(0.055, 16, 12), M(0xf7a8c4, { clearcoat: 0.3 }), 0, 0.16, 0)); break;
    case 'pizza': add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 24, 1, false, 0, 1.0), M(0xf2c14e), 0, 0.01, 0)); break;
    case 'lollipop': add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), M(0xffffff), 0, 0.15, 0)); add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 24), M(0xe86aa0, { clearcoat: 1 }), 0, 0.33, 0)).rotation.x = Math.PI / 2; break;
    case 'snowman': {
      const w = M(0xf8fbff, { roughness: 0.9, sheen: 0.4 });
      add(mesh(new THREE.SphereGeometry(0.5, 24, 18), w, 0, 0.45, 0)); add(mesh(new THREE.SphereGeometry(0.36, 24, 18), w, 0, 1.1, 0)); add(mesh(new THREE.SphereGeometry(0.26, 24, 18), w, 0, 1.6, 0));
      add(mesh(new THREE.ConeGeometry(0.05, 0.25, 10), M(0xff8a3d), 0, 1.6, 0.35)).rotation.x = Math.PI / 2;
      for (const x of [-0.09, 0.09]) add(mesh(new THREE.SphereGeometry(0.03, 8, 6), M(0x111111), x, 1.68, 0.23));
      break;
    }
    case 'umbrella': {
      add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.0, 6), M(0x333333), 0, 0.5, 0));
      add(mesh(new THREE.SphereGeometry(0.55, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), M(rng.pick([0xd9443b, 0x3a6fb5, 0xf2b33d]), { side: THREE.DoubleSide }), 0, 0.75, 0));
      break;
    }
    case 'guitar': {
      const b = add(mesh(new THREE.SphereGeometry(0.17, 20, 14), M(0xc0763a, { clearcoat: 0.8 }), 0, 0.2, 0)); b.scale.set(1, 1.2, 0.35);
      add(mesh(new THREE.BoxGeometry(0.05, 0.5, 0.03), M(0x5a3d28), 0, 0.6, 0));
      add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16), M(0x2a1a14), 0, 0.24, 0.06)).rotation.x = Math.PI / 2;
      break;
    }
    case 'piano': {
      add(mesh(new RoundedBoxGeometry(1.5, 1.1, 0.6, 2, 0.04), M(0x1d1d22, { clearcoat: 1, roughness: 0.2 }), 0, 0.55, 0));
      add(mesh(new THREE.BoxGeometry(1.3, 0.04, 0.2), M(0xf6f6f2), 0, 0.75, 0.38));
      break;
    }
    case 'telescope': {
      const t = add(mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.0, 16), M(0xe8e4dc, { clearcoat: 0.5 }), 0, 1.2, 0)); t.rotation.x = -0.7;
      for (let i = 0; i < 3; i++) { const l = add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.1, 6), M(0x5a3d28), Math.cos(i * 2.1) * 0.2, 0.5, Math.sin(i * 2.1) * 0.2)); l.rotation.z = Math.cos(i * 2.1) * 0.35; l.rotation.x = -Math.sin(i * 2.1) * 0.35; }
      break;
    }
    case 'wand': add(mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.35, 8), M(0x2a1a14), 0, 0.17, 0)); add(mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1a8, toneMapped: false }), 0, 0.36, 0)); break;
    case 'sword': add(mesh(new THREE.BoxGeometry(0.05, 0.75, 0.01), M(0xd8dde4, { metalness: 0.9, roughness: 0.2 }), 0, 0.5, 0)); add(mesh(new THREE.BoxGeometry(0.2, 0.03, 0.04), M(0xe8c060, { metalness: 0.9 }), 0, 0.12, 0)); add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 8), M(0x5a3d28), 0, 0.05, 0)); break;
    case 'key': add(mesh(new THREE.TorusGeometry(0.035, 0.01, 8, 16), M(0xe8c060, { metalness: 0.9, roughness: 0.25 }), 0, 0.12, 0)); add(mesh(new THREE.BoxGeometry(0.012, 0.1, 0.01), M(0xe8c060, { metalness: 0.9 }), 0, 0.04, 0)); break;
    case 'egg': add(mesh(new THREE.SphereGeometry(0.06, 16, 12), M(0xfff6e8), 0, 0.075, 0)).scale.set(1, 1.3, 1); break;
    case 'shell': add(mesh(new THREE.ConeGeometry(0.07, 0.12, 12, 1, true), M(0xf7c6b8, { side: THREE.DoubleSide }), 0, 0.03, 0)).rotation.x = Math.PI / 2; break;
    case 'mushroom': {
      const s = opts.scale ?? 1;
      add(mesh(new THREE.CylinderGeometry(0.08 * s, 0.11 * s, 0.35 * s, 12), M(0xf6efe0), 0, 0.17 * s, 0));
      add(mesh(new THREE.SphereGeometry(0.25 * s, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M(0xd9443b, { clearcoat: 0.4 }), 0, 0.3 * s, 0)).scale.set(1, 0.7, 1);
      for (let i = 0; i < 6; i++) add(mesh(new THREE.SphereGeometry(0.03 * s, 8, 6), M(0xffffff), Math.cos(i) * 0.14 * s, 0.4 * s, Math.sin(i) * 0.14 * s));
      break;
    }
    case 'bench': add(bench()); break;
    case 'trophy': add(mesh(new THREE.CylinderGeometry(0.12, 0.05, 0.2, 20, 1, true), M(0xf0c040, { metalness: 0.9, roughness: 0.2, side: THREE.DoubleSide }), 0, 0.3, 0)); add(mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.12, 8), M(0xf0c040, { metalness: 0.9 }), 0, 0.14, 0)); add(mesh(new THREE.BoxGeometry(0.14, 0.06, 0.14), M(0x3a2a20), 0, 0.03, 0)); break;
    case 'gem': add(mesh(new THREE.OctahedronGeometry(0.1, 0), new THREE.MeshPhysicalMaterial({ color: rng.pick([0x4fd8ff, 0xff4fa3, 0x7dff6a]), roughness: 0.05, transmission: 0.6, thickness: 0.2, emissive: 0x2050a0, emissiveIntensity: 0.4 }), 0, 0.1, 0)); break;
    case 'laptop': {
      add(mesh(new RoundedBoxGeometry(0.34, 0.02, 0.24, 2, 0.008), M(0xb8bec7, { metalness: 0.7, roughness: 0.3 }), 0, 0.01, 0));
      const scr = canvasTexture(256, 160, (c, W, H) => { const gr = c.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#1d3b6b'); gr.addColorStop(1, '#5a2f7a'); c.fillStyle = gr; c.fillRect(0, 0, W, H); c.fillStyle = '#9fe0ff'; for (let i = 0; i < 8; i++) c.fillRect(20, 20 + i * 16, 60 + (i * 37) % 140, 6); });
      const lid = add(mesh(new THREE.BoxGeometry(0.34, 0.22, 0.012), [M(0xb8bec7), M(0xb8bec7), M(0xb8bec7), M(0xb8bec7), new THREE.MeshStandardMaterial({ map: scr, emissive: 0xffffff, emissiveMap: scr, emissiveIntensity: 0.8 }), M(0xb8bec7)], 0, 0.12, -0.12)); lid.rotation.x = -0.25;
      break;
    }
    case 'phone': add(mesh(new RoundedBoxGeometry(0.075, 0.15, 0.01, 2, 0.008), M(0x1d1d22, { clearcoat: 1 }), 0, 0.075, 0)); add(mesh(new THREE.PlaneGeometry(0.065, 0.13), new THREE.MeshBasicMaterial({ color: 0x6fb6ff }), 0, 0.075, 0.006)); break;
    case 'backpack': add(mesh(new RoundedBoxGeometry(0.35, 0.45, 0.18, 3, 0.05), M(0xc0502e), 0, 0.22, 0)); break;
    case 'coffee': add(mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 16), M(0xf6f2ea, { clearcoat: 0.5 }), 0, 0.05, 0)); add(mesh(new THREE.TorusGeometry(0.025, 0.008, 6, 12), M(0xf6f2ea), 0.05, 0.05, 0)); break;
    case 'bike': {
      for (const z of [-0.5, 0.5]) add(mesh(new THREE.TorusGeometry(0.33, 0.03, 8, 24), M(0x222222), 0, 0.35, z)).rotation.y = Math.PI / 2;
      add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6), M(0xd9443b), 0, 0.55, 0)).rotation.x = Math.PI / 2;
      break;
    }
    case 'door': add(mesh(new RoundedBoxGeometry(1.1, 2.2, 0.12, 2, 0.04), M(0x8b5a2b), 0, 1.1, 0)); add(mesh(new THREE.SphereGeometry(0.05, 8, 6), M(0xe8c060, { metalness: 0.9 }), 0.4, 1.1, 0.08)); break;
    case 'bridge': { const b = add(mesh(new THREE.CylinderGeometry(4, 4, 1.4, 24, 1, true, -0.5, 1.0), M(0x8b5a2b, { side: THREE.DoubleSide }), 0, -3.5, 0)); b.rotation.z = Math.PI / 2; break; }
    case 'sign': add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6), M(0x6b4a32), 0, 0.7, 0)); add(mesh(new RoundedBoxGeometry(0.8, 0.4, 0.05, 2, 0.02), M(0xc8a06a), 0, 1.3, 0)); break;
    case 'basket': add(mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.2, 16, 1, true), M(0xc8924f, { side: THREE.DoubleSide }), 0, 0.1, 0)); add(mesh(new THREE.TorusGeometry(0.18, 0.012, 6, 20, Math.PI), M(0xc8924f), 0, 0.2, 0)); break;
    case 'drum': add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.3, 24), M(0xd9443b, { clearcoat: 0.6 }), 0, 0.15, 0)); add(mesh(new THREE.CylinderGeometry(0.255, 0.255, 0.02, 24), M(0xfaf6ea), 0, 0.31, 0)); break;
    case 'microphone': add(mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.18, 8), M(0x222222), 0, 0.09, 0)); add(mesh(new THREE.SphereGeometry(0.035, 12, 10), M(0x9a9a9a, { metalness: 0.8, roughness: 0.4 }), 0, 0.2, 0)); break;
    case 'camera': add(mesh(new RoundedBoxGeometry(0.16, 0.1, 0.08, 2, 0.015), M(0x222222), 0, 0.05, 0)); add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 16), M(0x333333), 0, 0.05, 0.06)).rotation.x = Math.PI / 2; break;
    case 'skateboard': add(mesh(new RoundedBoxGeometry(0.22, 0.02, 0.8, 2, 0.01), M(0xd9443b), 0, 0.08, 0)); for (const z of [-0.28, 0.28]) for (const x of [-0.08, 0.08]) add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10), M(0xf2f2f2), x, 0.035, z)).rotation.z = Math.PI / 2; break;
    case 'cross': add(cross(0xd9b26a, 0.4)); break;
    case 'candle': add(candle(true)); break;
    default: add(mesh(new RoundedBoxGeometry(0.3, 0.3, 0.3, 2, 0.04), M(0xc8a06a), 0, 0.15, 0));
  }
  shadowed(g);
  return g;
}

// Small props that can be carried in a hand.
export const HANDHELD = new Set(['ball', 'balloon', 'kite', 'cupcake', 'book', 'bible', 'flower', 'star', 'heart', 'crown', 'map', 'letter', 'lantern', 'apple', 'cookie', 'icecream', 'pizza', 'lollipop', 'umbrella', 'guitar', 'wand', 'sword', 'key', 'egg', 'shell', 'trophy', 'gem', 'phone', 'coffee', 'basket', 'microphone', 'camera', 'gift', 'candle', 'cross', 'laptop']);
