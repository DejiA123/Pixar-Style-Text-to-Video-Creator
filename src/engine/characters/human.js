// Assemble a stylized human: sculpted head, hair, clothed body, accessories,
// and a joint hierarchy the animation system drives.
import * as THREE from 'three';
import { skinMaterial, mat, fabric } from '../materials.js';
import { makeRng, lerp } from '../../util.js';
import { faceParams, headShape, sculpt, FaceField, buildHeadGeometry, buildEye, Mouth, Brow } from './head.js';
import { buildHair, pickHairStyle } from './hair.js';
import { paintFace } from './skin.js';
import { buildGarments, bodyModel } from './garments.js';
import { torsoGeometry, clothMaterial, buildHand, buildShoe, limb, capsule, buildGlasses, buildBackpack, buildBeard, buildHat } from './body.js';

export const SKIN_TONES = [0xf3d6c6, 0xeac3aa, 0xddb092, 0xcd9c7e, 0xb98466, 0xa06c50, 0x87573f, 0x6c4431, 0x553426];
export const HAIR_COLORS = [0x2a1d17, 0x3b261a, 0x4a2f1f, 0x5a3a24, 0x6e4529, 0x7a4a2a, 0x8a5530, 0x9c5a2e, 0xc98a4a, 0xd8b27a, 0x241a16];
export const EYE_COLORS = [0x6b3f1f, 0x4a2a15, 0x8a6a2e, 0x4f8a4b, 0x4f86c6, 0x6f8494, 0x5c3a1e];
const SHIRT = [0x3a6fb5, 0xd9643b, 0x4b8f5a, 0x7d5ab8, 0xc9a43a, 0x4a4f5c, 0xb8455a, 0x3a9a9a, 0xe8e4dc, 0x6f7d8c, 0xe07a5f, 0x2f4858, 0xf2cc8f, 0x9c6644];
const PANTS = [0x2e4a7a, 0x34495e, 0x3d3d45, 0x6b5b4b, 0x23324d, 0x4a5a3a, 0x2b2b30, 0x55657a];

export function humanLook(c) {
  const rng = makeRng(c.seed || 1);
  const look = {};
  look.skin = c.skin ?? SKIN_TONES[rng.int(0, SKIN_TONES.length - 1)];
  look.eyeColor = c.eyeColor ?? (look.skin < 0xc00000 ? rng.pick([0x5c3a1e, 0x4a2a15, 0x3e2414]) : EYE_COLORS[rng.int(0, EYE_COLORS.length - 1)]);
  const old = c.age === 'old';
  look.hairColor = c.hair?.color ?? (old ? rng.pick([0xb8b8b8, 0xd8d6d0, 0x8f8f8f]) : HAIR_COLORS[rng.int(0, HAIR_COLORS.length - 1)]);
  look.hairStyle = pickHairStyle({ hairStyle: c.hair?.style, gender: c.gender, age: c.age }, rng);
  const acc = new Set(c.accessories || []);
  const role = c.role;
  const o = { top: 'tshirt', topColor: c.outfitColor ?? SHIRT[rng.int(0, SHIRT.length - 1)], innerColor: 0xf2efe8, pattern: 'solid', pattern2: 0xffffff,
    bottom: 'jeans', bottomColor: PANTS[rng.int(0, PANTS.length - 1)], shoes: 'sneaker', shoeColor: rng.pick([0xf2f2f2, 0x2b2b30, 0xd9443b, 0x3a6fb5, 0x8b5a2b]),
    hat: null, cape: null, collar: 'crew', backpack: acc.has('backpack') ? rng.pick([0xc0502e, 0x3a5a8a, 0x8b5a2b, 0x2f2f35]) : null };
  // casual defaults by gender/age
  if (c.gender === 'f') {
    o.top = rng.pick(['tshirt', 'cardigan', 'blouse', 'tshirt', 'dress', 'sweater']);
    if (c.age === 'child') o.top = rng.pick(['tshirt', 'dress', 'sweater']);
    o.bottom = o.top === 'dress' ? 'none' : rng.pick(['jeans', 'jeans', 'skirt', 'pants']);
  } else {
    o.top = rng.pick(['tshirt', 'shirt', 'hoodie', 'jacket', 'sweater', 'shirt']);
  }
  if (rng.chance(0.2) && o.top !== 'dress') o.pattern = rng.pick(['stripes', 'plaid', 'floral']);
  if (acc.has('hoodie')) o.top = 'hoodie';
  if (acc.has('jacket')) o.top = 'jacket';
  if (acc.has('dress')) { o.top = 'dress'; o.bottom = 'none'; }
  if (acc.has('cape')) o.cape = 0xc0392b;
  if (acc.has('hat')) o.hat = 'cap';
  if (acc.has('crown')) o.hat = 'crown';
  if (o.top === 'cardigan' || o.top === 'jacket') o.innerColor = rng.pick([0xf2efe8, 0xe8d7b8, 0x3a3a40, 0xd9e2ec]);
  if (o.top === 'shirt' || o.top === 'blouse') o.collar = 'collar';
  if (o.top === 'hoodie') o.collar = 'hood';
  const roles = {
    astronaut: () => Object.assign(o, { top: 'suit', topColor: 0xeef0f2, bottom: 'pants', bottomColor: 0xeef0f2, shoes: 'boot', shoeColor: 0x9aa3ad, hat: 'helmet', collar: 'crew', pattern: 'solid' }),
    chef: () => Object.assign(o, { top: 'jacket', topColor: 0xfafafa, innerColor: 0xfafafa, hat: 'chef', pattern: 'solid', bottom: 'pants', bottomColor: 0x2b2b30 }),
    doctor: () => Object.assign(o, { top: 'coat', topColor: 0xf6f6f6, innerColor: 0x6f9fd8, pattern: 'solid', bottom: 'pants', collar: 'collar' }),
    scientist: () => Object.assign(o, { top: 'coat', topColor: 0xf6f6f6, innerColor: 0x7d5ab8, pattern: 'solid' }),
    pastor: () => Object.assign(o, { top: 'suit', topColor: 0x2c2f3a, innerColor: 0xf4f4f4, tie: 0x7a2335, collar: 'collar', pattern: 'solid', bottom: 'pants', bottomColor: 0x2c2f3a, shoes: 'dress', shoeColor: 0x1a1a1a }),
    priest: () => Object.assign(o, { top: 'robe', topColor: 0x1d1d22, innerColor: 0x1d1d22, collar: 'clerical', pattern: 'solid', bottom: 'none', shoes: 'dress', shoeColor: 0x111111 }),
    nun: () => Object.assign(o, { top: 'robe', topColor: 0x1d1d22, pattern: 'solid', bottom: 'none', hat: 'veil', hatColor: 0x1d1d22 }),
    angel: () => Object.assign(o, { top: 'robe', topColor: 0xfbf8f0, pattern: 'solid', bottom: 'none', hat: 'halo', wings: true }),
    shepherd: () => Object.assign(o, { top: 'robe', topColor: 0x9a7b55, pattern: 'solid', bottom: 'none', shoes: 'boot', shoeColor: 0x5a3a24 }),
    princess: () => Object.assign(o, { top: 'gown', topColor: rng.pick([0xf2a7c3, 0x8ec5f2, 0xf5d36b, 0xc7a3f0]), pattern: 'solid', bottom: 'none', hat: 'crown', shoes: 'dress', shoeColor: 0xf0c0d0 }),
    prince: () => Object.assign(o, { top: 'jacket', topColor: 0x2d4f8f, innerColor: 0xf2efe8, hat: 'crown', pattern: 'solid', bottom: 'pants', bottomColor: 0xf2efe8, shoes: 'boot', shoeColor: 0x3a2a20 }),
    king: () => Object.assign(o, { top: 'robe', topColor: 0x9b1d2a, hat: 'crown', cape: 0x9b1d2a, pattern: 'solid', bottom: 'none' }),
    queen: () => Object.assign(o, { top: 'gown', topColor: 0x6a2c8a, hat: 'crown', cape: 0x6a2c8a, pattern: 'solid', bottom: 'none' }),
    wizard: () => Object.assign(o, { top: 'robe', topColor: 0x4b3a8f, hat: 'wizard', hatColor: 0x4b3a8f, pattern: 'solid', bottom: 'none' }),
    witch: () => Object.assign(o, { top: 'robe', topColor: 0x2a2233, hat: 'witch', hatColor: 0x1d1a22, pattern: 'solid', bottom: 'none' }),
    pirate: () => Object.assign(o, { top: 'shirt', topColor: 0xf2ece0, collar: 'collar', bottom: 'pants', bottomColor: 0x3a2a20, shoes: 'boot', shoeColor: 0x2a1a10, pattern: 'stripes', pattern2: 0xc0392b }),
    knight: () => Object.assign(o, { top: 'armor', topColor: 0xb7bec7, bottom: 'pants', bottomColor: 0x8e969f, shoes: 'boot', shoeColor: 0x8e969f, pattern: 'solid', cape: 0x2d4f8f }),
    cowboy: () => Object.assign(o, { top: 'shirt', topColor: 0xb8455a, pattern: 'plaid', pattern2: 0x2b2b30, hat: 'cowboy', hatColor: 0x8b5a2b, shoes: 'boot', shoeColor: 0x6b3f1f }),
    farmer: () => Object.assign(o, { top: 'shirt', topColor: 0xc94f3b, pattern: 'plaid', pattern2: 0xf2ece0, hat: 'cap', hatColor: 0x4b8f5a }),
    superhero: () => Object.assign(o, { top: 'suit', topColor: rng.pick([0xd9443b, 0x3a6fb5, 0x2bb3a0]), bottom: 'pants', bottomColor: 0x23324d, cape: 0xd9443b, pattern: 'solid', shoes: 'boot', shoeColor: 0xd9443b }),
    ninja: () => Object.assign(o, { top: 'suit', topColor: 0x1d1d22, bottom: 'pants', bottomColor: 0x1d1d22, pattern: 'solid' }),
    detective: () => Object.assign(o, { top: 'coat', topColor: 0xb59a6d, innerColor: 0xf2efe8, pattern: 'solid', hat: 'cowboy', hatColor: 0x5a4a3a }),
    student: () => Object.assign(o, { top: rng.pick(['hoodie', 'tshirt', 'jacket']), backpack: o.backpack ?? rng.pick([0xc0502e, 0x3a5a8a, 0x2f2f35]) }),
    teacher: () => Object.assign(o, { top: 'cardigan', topColor: rng.pick([0x6b8f71, 0xb07a5a, 0x5a6f9a]), innerColor: 0xf2efe8 }),
    office: () => Object.assign(o, { top: 'suit', topColor: 0x3a3f4a, innerColor: 0xf4f4f4, tie: 0x2d4f8f, collar: 'collar', pattern: 'solid', bottom: 'pants', bottomColor: 0x3a3f4a, shoes: 'dress', shoeColor: 0x1a1a1a }),
    musician: () => Object.assign(o, { top: 'jacket', topColor: 0x2b2b30, innerColor: 0xd9443b }),
    artist: () => Object.assign(o, { top: 'shirt', topColor: 0xf2efe8, hat: 'beanie', hatColor: 0xd9643b }),
    explorer: () => Object.assign(o, { top: 'shirt', topColor: 0xb59a6d, collar: 'collar', bottom: 'pants', bottomColor: 0x6b5b4b, shoes: 'boot', shoeColor: 0x5a3a24, backpack: 0x6b5b4b, pattern: 'solid' }),
    mermaid: () => Object.assign(o, { top: 'tshirt', topColor: 0x8a4fd0, bottom: 'tail', bottomColor: 0x1fa79a, pattern: 'solid' }),
    fairy: () => Object.assign(o, { top: 'dress', topColor: 0x9fe0c8, bottom: 'none', wings: true, pattern: 'solid' }),
    elf: () => Object.assign(o, { top: 'jacket', topColor: 0x3f8a4a, innerColor: 0xc0392b, hat: 'beanie', hatColor: 0xc0392b }),
  };
  if (role && roles[role]) roles[role]();
  if (c.age === 'old' && !role) { o.top = c.gender === 'f' ? 'cardigan' : rng.pick(['sweater', 'cardigan', 'shirt']); o.bottom = c.gender === 'f' ? 'skirt' : 'pants'; o.pattern = 'solid'; }
  look.outfit = o;
  look.glasses = acc.has('glasses') ? { color: rng.pick([0x1b1b1f, 0x3a2418, 0x1d3a6b, 0x8a1d2a]), style: rng.pick(['round', 'rect']) } : (c.age === 'old' && rng.chance(0.6) ? { color: 0x9a7b55, style: 'round' } : null);
  look.beard = acc.has('beard') ? 'full' : acc.has('mustache') ? 'mustache' : (c.gender === 'm' && (c.age === 'adult' || c.age === 'old') && rng.chance(0.35) ? rng.pick(['stubble', 'full', 'stubble']) : (role === 'wizard' ? 'full' : null));
  if (role === 'wizard') look.beard = 'full';
  look.earrings = acc.has('earrings') || (c.gender === 'f' && c.age !== 'child' && rng.chance(0.4));
  look.freckles = acc.has('freckles') || rng.chance(0.15);
  return look;
}

function bodyDims(c) {
  const a = c.age, f = c.gender === 'f';
  const size = c.size || 1;
  let H, hs;
  if (a === 'baby') { H = 0.82; hs = 0.125; }
  else if (a === 'child') { H = 1.18; hs = 0.13; }
  else if (a === 'teen') { H = f ? 1.6 : 1.66; hs = 0.13; }
  else if (a === 'old') { H = f ? 1.6 : 1.7; hs = 0.13; }
  else { H = f ? 1.68 : 1.8; hs = f ? 0.13 : 0.135; }
  H *= Math.min(1.3, Math.max(0.75, size));
  const kid = a === 'child' || a === 'baby';
  const k = H / 1.75;
  const dims = {
    H, hs,
    hipR: (f ? 0.165 : 0.155) * k * (kid ? 1.1 : 1),
    waistR: (f ? 0.125 : 0.15) * k * (kid ? 1.15 : 1),
    chestR: (f ? 0.15 : 0.18) * k * (kid ? 1.05 : 1),
    shoulderR: (f ? 0.168 : 0.205) * k * (kid ? 1.05 : 1),
    neckR: (f ? 0.052 : 0.066) * k * (kid ? 1.25 : 1),
    depth: 0.7,
    armR: (f ? 0.04 : 0.047) * k * (kid ? 1.25 : 1),
    legR: (f ? 0.068 : 0.074) * k * (kid ? 1.2 : 1),
  };
  const headCenter = H - hs * 1.1;
  dims.shoulderY = headCenter - hs * (kid ? 1.12 : f ? 1.24 : 1.3);
  dims.hipY = H * (kid ? 0.38 : 0.47);
  dims.height = dims.shoulderY - dims.hipY + 0.04;
  dims.headPivotY = headCenter - hs * 0.85;
  dims.headCenter = headCenter;
  dims.upperArm = (dims.shoulderY - dims.hipY) * 0.52;
  dims.foreArm = dims.upperArm * 0.92;
  dims.thigh = dims.hipY * 0.5;
  dims.shin = dims.hipY * 0.44;
  return dims;
}

export function buildHuman(c) {
  const rng = makeRng((c.seed || 1) + 17);
  const look = c.look || humanLook(c);
  const dims = bodyDims(c);
  const { hs } = dims;
  const f = c.gender === 'f';
  const kid = c.age === 'child' || c.age === 'baby';
  const o = look.outfit;
  const skin = skinMaterial(look.skin, { vertexColors: true });
  const skinPlain = skinMaterial(look.skin);
  const knit = o.top === 'sweater' || o.top === 'cardigan';
  let topMat;
  if (o.top === 'armor') topMat = mat(0xffffff, { metalness: 0.85, roughness: 0.32, vertexColors: true });
  else if (o.top === 'suit' && o.topColor > 0xe00000) topMat = mat(0xffffff, { roughness: 0.55, clearcoat: 0.2, vertexColors: true });
  else if (o.pattern === 'solid') topMat = fabric(0xffffff, { knit, vertexColors: true });
  else topMat = clothMaterial(o.topColor, o.pattern, o.pattern2, { seed: c.seed, knit, repeat: 2 });
  const torsoTint = o.pattern === 'solid' ? o.topColor : 0xffffff;
  const pantsMat = o.bottom === 'jeans' ? clothMaterial(o.bottomColor, 'denim', 0xffffff, { repeat: 3 }) : fabric(o.bottomColor);
  const sleeveMat = o.top === 'armor' ? mat(o.topColor, { metalness: 0.85, roughness: 0.32 }) : o.pattern === 'solid' ? fabric(o.topColor, { knit }) : topMat;

  const root = new THREE.Group();
  root.name = c.name || c.noun || 'human';
  const J = {};
  const mk = (name, parent, x = 0, y = 0, z = 0) => { const g = new THREE.Bone(); g.name = name; g.position.set(x, y, z); parent.add(g); J[name] = g; return g; };

  const hips = mk('hips', root, 0, dims.hipY, 0);
  const spine = mk('spine', hips, 0, 0.02, 0);
  const chest = mk('chest', spine, 0, (dims.height) * 0.45, 0);

  // pelvis (pants)
  if (o.bottom !== 'none' && o.bottom !== 'tail') {
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), pantsMat);
    pelvis.scale.set(dims.hipR * 1.02, dims.hipR * 0.85, dims.hipR * dims.depth * 1.08);
    pelvis.position.y = 0.0;
    pelvis.castShadow = true;
    void pelvis; // replaced by sculpted garments
    const belt = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 40), mat(0x3a2a20, { roughness: 0.5 }));
    belt.rotation.x = Math.PI / 2;
    belt.scale.set(dims.hipR * 1.0, dims.hipR * dims.depth * 1.05, dims.hipR);
    belt.position.y = dims.hipR * 0.45;
    if (o.top === 'tshirt' || o.top === 'shirt' || o.top === 'blouse') void belt; // sculpted garments replace the primitive belt
  }

  // torso (top)
  const longTop = ['robe', 'gown', 'coat', 'dress'].includes(o.top);
  const tGeo = torsoGeometry({ ...dims, height: dims.height + 0.06 }, {
    color: torsoTint, innerColor: o.innerColor,
    openFront: ['jacket', 'cardigan', 'coat', 'suit'].includes(o.top) && !(o.top === 'suit' && !o.tie && !o.innerColor) ? (o.top === 'suit' ? 0.28 : 0.36) : 0,
    vneck: o.top === 'blouse' || o.top === 'sweater',
    bust: f && !kid ? 0.03 : 0,
  });
  tGeo.translate(0, -0.06, 0);
  const torso = new THREE.Mesh(tGeo, topMat);
  torso.castShadow = true;
  torso.receiveShadow = true;
  torso.position.y = -dims.height * 0.45 - 0.02;
  void torso; // replaced by sculpted garments
  if (o.pattern === 'solid' && topMat.vertexColors) { /* torso colored via vertex colors */ }

  // long garments: skirt / dress / robe / coat tails
  if (longTop || o.bottom === 'skirt' || o.bottom === 'tail') {
    const toAnkle = o.top === 'robe' || o.top === 'gown';
    const len = o.bottom === 'tail' ? dims.hipY * 0.95 : toAnkle ? dims.hipY * 0.94 : o.top === 'coat' ? dims.hipY * 0.55 : dims.hipY * 0.5;
    const r0 = dims.waistR * 1.06, r1 = o.bottom === 'tail' ? dims.hipR * 0.5 : toAnkle ? dims.hipR * 1.85 : dims.hipR * 1.55;
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const r = o.bottom === 'tail' ? lerp(dims.hipR * 1.05, r1, t * t) : lerp(r0, r1, Math.pow(t, 0.85));
      pts.push(new THREE.Vector2(r, -t * len));
    }
    pts.reverse(); // bottom→top so the lathe faces outward
    const sg = new THREE.LatheGeometry(pts, 48);
    const sp = sg.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
      const a = Math.atan2(x, z), t = -y / len;
      const pleat = 1 + 0.035 * Math.sin(a * 10) * t;
      sp.setXYZ(i, x * pleat, y, z * pleat * (0.78 + 0.22 * t));
    }
    sg.computeVertexNormals();
    const skirtColor = o.bottom === 'skirt' ? o.bottomColor : o.bottom === 'tail' ? o.bottomColor : o.topColor;
    const skirtMat = o.bottom === 'tail' ? mat(skirtColor, { roughness: 0.3, clearcoat: 0.8, iridescence: 0.5 }) : o.pattern !== 'solid' && longTop ? topMat : fabric(skirtColor);
    if (skirtMat.vertexColors) skirtMat.vertexColors = false;
    const skirt = new THREE.Mesh(sg, o.pattern !== 'solid' && longTop ? clothMaterial(0xffffff, o.pattern, o.pattern2, { seed: c.seed }) : skirtMat);
    skirt.position.y = dims.hipR * 0.5;
    skirt.castShadow = true;
    skirt.receiveShadow = true;
    if (o.bottom === 'tail') hips.add(skirt);
    J.skirt = skirt;
  }

  // collar details
  const neckBaseY = dims.height * 0.55 - 0.02;
  if (o.collar === 'crew' || o.collar === 'clerical') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(dims.neckR * 1.2, dims.neckR * 0.13, 10, 32), o.collar === 'clerical' ? mat(0xffffff, { roughness: 0.4 }) : fabric(new THREE.Color(o.topColor).multiplyScalar(0.88).getHex(), { knit: true }));
    ring.rotation.x = Math.PI / 2 - 0.15;
    ring.scale.set(1, 0.85, 1);
    ring.position.set(0, neckBaseY, 0.004);
    void ring; // replaced by sculpted garments
  } else if (o.collar === 'collar') {
    const cm = fabric(o.innerColor && ['suit', 'coat'].includes(o.top) ? o.innerColor : o.topColor);
    // stand-up band around the back and sides of the neck
    const band = new THREE.Mesh(new THREE.CylinderGeometry(dims.neckR * 1.22, dims.neckR * 1.32, dims.neckR * 0.9, 28, 1, true, Math.PI * 0.18, Math.PI * 1.64), cm);
    band.material = cm.clone(); band.material.side = THREE.DoubleSide;
    band.position.set(0, neckBaseY + dims.neckR * 0.25, 0);
    band.scale.z = 0.95;
    void band; // replaced by sculpted garments
    // two pointed flaps folded down onto the chest
    for (const side of [-1, 1]) {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.lineTo(side * dims.neckR * 1.25, 0.004); sh.lineTo(side * dims.neckR * 0.35, -dims.neckR * 1.5); sh.lineTo(0, 0);
      const flap = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 }), cm);
      flap.position.set(side * dims.neckR * 0.12, neckBaseY + dims.neckR * 0.2, dims.neckR * 1.05);
      flap.rotation.x = -0.45;
      flap.rotation.y = side * 0.35;
      flap.castShadow = true;
      void flap; // replaced by sculpted garments
    }
    if (o.top === 'shirt' || o.top === 'blouse') {
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 8, 6), mat(0xeeeae0, { roughness: 0.3, clearcoat: 0.5 }));
        const y = neckBaseY - 0.06 - i * dims.height * 0.17;
        const t = (y + dims.height * 0.45 + 0.04) / dims.height;
        const r = lerp(dims.waistR, dims.chestR, Math.min(1, Math.max(0, (t - 0.32) / 0.38)));
        b.position.set(0, y, r * dims.depth + 0.012);
        chest.add(b);
      }
    }
    if (o.tie) {
      const tie = new THREE.Mesh(new THREE.ConeGeometry(dims.neckR * 0.55, dims.height * 0.55, 4, 1), mat(o.tie, { roughness: 0.45, sheen: 0.4 }));
      tie.rotation.z = Math.PI;
      tie.scale.set(1, 1, 0.25);
      tie.position.set(0, neckBaseY - dims.height * 0.3, dims.chestR * dims.depth + 0.018);
      chest.add(tie);
      const knot = new THREE.Mesh(new THREE.SphereGeometry(dims.neckR * 0.42, 10, 8), mat(o.tie, { roughness: 0.45 }));
      knot.position.set(0, neckBaseY - 0.012, dims.neckR * 1.1);
      chest.add(knot);
    }
  } else if (o.collar === 'hood') {
    const hm = fabric(o.topColor, { knit: true });
    const hood = new THREE.Mesh(new THREE.TorusGeometry(dims.neckR * 2.0, dims.neckR * 0.8, 14, 32, Math.PI * 1.3), hm);
    hood.rotation.x = Math.PI / 2 - 0.35;
    hood.rotation.z = -Math.PI * 0.15 + Math.PI;
    hood.rotation.z = Math.PI / 2 + Math.PI * 0.35 - Math.PI * 1.3 / 2 + Math.PI / 2;
    hood.position.set(0, neckBaseY + 0.0, -dims.neckR * 0.6);
    hood.castShadow = true;
    void hood; // replaced by sculpted garments
    const back = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), hm);
    back.scale.set(dims.shoulderR * 0.7, dims.neckR * 1.8, dims.neckR * 1.2);
    back.position.set(0, neckBaseY - dims.neckR * 0.8, -dims.chestR * dims.depth * 0.95);
    void back; // replaced by sculpted garments
    for (const side of [-1, 1]) {
      const str = capsule(0.004, dims.height * 0.28, mat(0xf2efe8, { roughness: 0.6 }), 6);
      str.position.set(side * dims.neckR * 0.7, neckBaseY - dims.height * 0.16, dims.chestR * dims.depth + 0.012);
      chest.add(str);
    }
    const pocket = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), fabric(new THREE.Color(o.topColor).multiplyScalar(0.9).getHex(), { knit: true }));
    pocket.scale.set(dims.waistR * 0.8, dims.height * 0.13, 0.02);
    pocket.rotation.x = Math.PI / 2;
    pocket.position.set(0, -dims.height * 0.28, dims.waistR * dims.depth + 0.004);
    chest.add(pocket);
  }

  // neck + head
  const neck = mk('neck', chest, 0, neckBaseY - 0.01, 0);
  const neckMesh = capsule(dims.neckR, hs * 0.55, skinPlain, 16);
  neckMesh.position.y = hs * 0.3;
  neck.add(neckMesh);
  const head = mk('head', neck, 0, dims.headPivotY - (dims.shoulderY + neckBaseY - dims.height * 0.45 + 0.02 - 0.01) + 0.0, 0);
  // place head pivot correctly in world terms
  head.position.y = dims.headPivotY - (dims.hipY + 0.02 + dims.height * 0.45 + neckBaseY - 0.01);
  const headModel = new THREE.Group();
  headModel.name = 'headModel';
  headModel.position.set(0, hs * 0.85, hs * 0.05);
  headModel.scale.setScalar(hs);
  head.add(headModel);
  J.headModel = headModel;

  const P = faceParams({ age: c.age, gender: c.gender }, rng);
  P.neckR = dims.neckR / hs;
  const shape = headShape(P);
  const headGeo = buildHeadGeometry(P, { blush: 0, stubble: null });
  const lipColor = new THREE.Color(look.skin).lerp(new THREE.Color(f ? 0xa82a44 : 0x9a4840), f ? 0.78 : 0.45).getHex();
  const painted = paintFace(P, {
    skin: look.skin, lipColor, female: f, child: kid, freckles: look.freckles,
    stubble: look.beard === 'stubble' || look.beard === 'full' ? { color: look.hairColor, amount: look.beard === 'full' ? 0.5 : 0.8 } : (c.gender === 'm' && c.age !== 'child' ? { color: look.hairColor, amount: 0.25 } : null),
  }, c.seed || 1);
  const faceSkin = skinMaterial(look.skin, { map: painted.map, normalMap: painted.normalMap, roughnessMap: painted.roughnessMap });
  const headMesh = new THREE.Mesh(headGeo, faceSkin);
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  headModel.add(headMesh);

  // face field for decals
  const field = new FaceField(P, -0.65, 0.65, -0.95, 0.6, 41, 41);
  const mouthField = new FaceField(P, -0.34, 0.34, P.mouthY - 0.22, P.mouthY + 0.16, 69, 49);
  const mouth = new Mouth(P, mouthField, { width: kid ? 0.19 : f ? 0.2 : 0.21, lipColor, lipU: f ? 0.03 : 0.022, lipL: f ? 0.046 : 0.036 });
  headModel.add(mouth.group);
  const browColor = new THREE.Color(look.hairColor).multiplyScalar(c.age === 'old' ? 1 : 0.85).getHex();
  const browR = new Brow(P, field, 1, browColor, P.browThick);
  const browL = new Brow(P, field, -1, browColor, P.browThick);
  headModel.add(browR.mesh, browL.mesh);

  // eyes
  const eyes = [];
  for (const side of [-1, 1]) {
    const e = buildEye(P.eyeR, look.eyeColor, faceSkin, { female: f, side: side < 0 ? 'L' : 'R', center: shape.eyeC[side < 0 ? 0 : 1] });
    e.eye.position.copy(shape.eyeC[side < 0 ? 0 : 1]);
    headModel.add(e.eye);
    eyes.push(e);
  }
  // ears
  for (const side of [-1, 1]) {
    const ear = { position: shape.earPos(side) };
    if (look.earrings) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 8, 20), mat(0xe8c060, { metalness: 0.9, roughness: 0.25 }));
      ring.position.copy(ear.position).add(new THREE.Vector3(side * 0.02, -0.25, 0.03));
      ring.rotation.y = Math.PI / 2;
      headModel.add(ring);
    }
  }
  // freckles are painted into the face texture now
  if (false) {
    const fm = new THREE.MeshBasicMaterial({ color: new THREE.Color(look.skin).multiplyScalar(0.72), transparent: true, opacity: 0.55 });
    for (let i = 0; i < 18; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (0.2 + rng() * 0.28), y = -0.18 - rng() * 0.14;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.012 + rng() * 0.008, 8), fm);
      dot.position.set(x, y, field.zAt(x, y) + 0.003);
      headModel.add(dot);
    }
  }

  // hair (head units). Body proxy in head space for long-hair collisions.
  const bodyProxy = {
    shoulderY: (dims.shoulderY - dims.headCenter) / hs,
    shoulderHalfW: dims.shoulderR / hs,
    chestDepth: (dims.chestR * dims.depth) / hs,
  };
  const hair = buildHair(P, { style: look.hairStyle, color: look.hairColor, tieColor: rng.pick([0xe0457b, 0xd9443b, 0x3a6fb5, 0xf5c518]) }, rng, bodyProxy);
  headModel.add(hair);
  if (look.glasses) {
    const gl = buildGlasses(P, look.glasses.color, look.glasses.style);
    gl.position.z = shape.eyeC[1].z + P.eyeR * 1.1 + 0.07;
    headModel.add(gl);
  }
  if (look.beard && look.beard !== 'stubble') headModel.add(buildBeard(P, look.hairColor, look.beard, sculpt));
  if (o.hat) {
    const hat = buildHat(o.hat, o.hatColor ?? o.topColor, P);
    if (o.hat === 'helmet') hat.position.y = 0.0;
    headModel.add(hat);
  }

  // arms
  const armY = neckBaseY - dims.neckR * 0.9 - dims.armR * 0.8;
  const shortSleeve = ['tshirt', 'blouse', 'dress'].includes(o.top);
  for (const side of [-1, 1]) {
    const S = side < 0 ? 'L' : 'R';
    const shoulder = mk('shoulder' + S, chest, side * (dims.shoulderR - dims.armR * 0.4), armY, 0);
    const delt = new THREE.Mesh(new THREE.SphereGeometry(dims.armR * 1.08, 20, 14), sleeveMat);
    delt.position.set(-side * dims.armR * 0.45, -dims.armR * 0.3, 0);
    delt.castShadow = true;
    void delt; // replaced by sculpted garments
    const upper = limb(dims.armR * (shortSleeve ? 1.25 : 1.12), dims.armR * (shortSleeve ? 1.15 : 1.0), dims.upperArm * (shortSleeve ? 0.5 : 1), sleeveMat);
    void upper; // replaced by sculpted garments
    if (shortSleeve) {
      const bare = limb(dims.armR * 0.92, dims.armR * 0.85, dims.upperArm * 0.55, skinPlain);
      bare.position.y = -dims.upperArm * 0.45;
      void bare; // replaced by sculpted garments
    }
    const elbow = mk('elbow' + S, shoulder, 0, -dims.upperArm, 0);
    const fore = limb(shortSleeve ? dims.armR * 0.85 : dims.armR * 1.0, shortSleeve ? dims.armR * 0.7 : dims.armR * 0.92, dims.foreArm, shortSleeve ? skinPlain : sleeveMat);
    void fore; // replaced by sculpted garments
    if (!shortSleeve) {
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(dims.armR * 1.0, dims.armR * 1.0, 0.03, 16), sleeveMat);
      cuff.position.y = -dims.foreArm + 0.01;
      void cuff; // replaced by sculpted garments
    }
    const wrist = mk('wrist' + S, elbow, 0, -dims.foreArm, 0);
    const hand = buildHand(skinPlain, (dims.H / 1.75) * (kid ? 1.3 : 1.05), side);
    hand.rotation.y = -side * Math.PI * 0.42;
    wrist.add(hand);
    J['hand' + S] = hand;
    // a grip point for held props
    const grip = new THREE.Group();
    grip.position.set(0, -0.07 * (dims.H / 1.75), 0.02);
    hand.add(grip);
    J['grip' + S] = grip;
  }

  // legs
  for (const side of [-1, 1]) {
    const S = side < 0 ? 'L' : 'R';
    const hip = mk('hip' + S, hips, side * dims.hipR * 0.5, -0.02, 0);
    const bare = o.bottom === 'none' || o.bottom === 'skirt' || o.bottom === 'tail';
    const legMat = bare ? skinPlain : pantsMat;
    const thigh = limb(dims.legR * (bare ? 0.85 : 1.0), dims.legR * (bare ? 0.7 : 0.88), dims.thigh, legMat);
    void thigh; // replaced by sculpted garments
    const knee = mk('knee' + S, hip, 0, -dims.thigh, 0);
    const shin = limb(dims.legR * (bare ? 0.68 : 0.86), dims.legR * (bare ? 0.55 : 0.78), dims.shin, legMat);
    void shin; // replaced by sculpted garments
    if (!bare && o.bottom === 'jeans') {
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(dims.legR * 0.85, dims.legR * 0.85, 0.04, 16), pantsMat);
      cuff.position.y = -dims.shin + 0.02;
      void cuff; // replaced by sculpted garments
    }
    const ankle = mk('ankle' + S, knee, 0, -dims.shin, 0);
    const shoe = buildShoe(o.shoeColor, (dims.H / 1.75) * (kid ? 1.25 : 1), o.shoes);
    shoe.position.y = -(dims.hipY - 0.02 - dims.thigh - dims.shin);
    ankle.add(shoe);
    if (o.bottom === 'tail') { thigh.visible = false; shin.visible = false; shoe.visible = false; }
  }

  if (o.backpack) {
    const bp = buildBackpack(o.backpack, dims);
    bp.position.y = -dims.height * 0.45 - 0.02;
    chest.add(bp);
  }
  if (o.cape) {
    const cg = new THREE.CylinderGeometry(dims.shoulderR * 0.9, dims.shoulderR * 1.6, dims.H * 0.62, 24, 8, true, Math.PI * 0.6, Math.PI * 0.8);
    const cape = new THREE.Mesh(cg, mat(o.cape, { roughness: 0.6, sheen: 0.6, side: THREE.DoubleSide }));
    cape.rotation.y = Math.PI;
    cape.position.set(0, neckBaseY - dims.H * 0.31, -dims.chestR * 0.35);
    cape.castShadow = true;
    chest.add(cape);
    J.cape = cape;
  }
  if (o.wings) {
    const wm = mat(0xffffff, { roughness: 0.5, sheen: 1, sheenColor: 0xbfe6ff, transparent: o.top === 'dress', opacity: 0.85, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), wm);
      w.scale.set(dims.shoulderR * 1.6, dims.height * 0.5, 0.02);
      w.position.set(side * dims.shoulderR * 1.1, neckBaseY - dims.height * 0.2, -dims.chestR * 0.9);
      w.rotation.z = side * -0.5;
      w.rotation.y = side * 0.5;
      chest.add(w);
      J['wing' + (side < 0 ? 'L' : 'R')] = w;
    }
  }

  // ---- sculpted, skinned clothing: mesh in an A-pose, bind, then relax the arms
  if (o.bottom !== 'tail') {
    const A = { shoulderL: -0.5, shoulderR: 0.5, hipL: -0.05, hipR: 0.05 };
    for (const [k, a] of Object.entries(A)) J[k].rotation.z = a;
    root.updateMatrixWorld(true);
    const W = {};
    for (const [k, j] of Object.entries(J)) if (j.isBone) W[k] = j.getWorldPosition(new THREE.Vector3());
    const model = bodyModel(W, dims, { female: f, kid });
    const bones = Object.values(J).filter((j) => j.isBone);
    const skeleton = new THREE.Skeleton(bones);
    const topMatG = o.pattern === 'solid' ? (o.top === 'armor' ? mat(o.topColor, { metalness: 0.85, roughness: 0.32 }) : fabric(o.topColor, { knit })) : clothMaterial(o.topColor, o.pattern, o.pattern2, { seed: c.seed, knit, repeat: 2 });
    const mats = { top: topMatG, inner: fabric(o.innerColor ?? 0xf2efe8), pants: pantsMat, skirt: fabric(o.bottomColor), skin: skinPlain };
    const { meshes } = buildGarments(model, o, mats, bones, { seed: c.seed || 1 });
    for (const m of meshes) { root.add(m); m.bind(skeleton); }
    for (const k of Object.keys(A)) J[k].rotation.z = 0;
    root.updateMatrixWorld(true);
  }
  root.traverse((o2) => { if (o2.isMesh) { o2.castShadow = o2.castShadow || false; } });

  return {
    root, joints: J, dims, look, kind: 'human',
    height: dims.H,
    face: { P, mouth, browL, browR, eyes, field, headMesh, hair },
    swingParts: hair.userData.swingParts || [],
    headScale: hs,
  };
}
