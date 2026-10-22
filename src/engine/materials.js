// Materials tuned for a soft, feature-animation look: physically based
// shading with a skin variant that fakes subsurface scattering.
import * as THREE from 'three';
import { makeRng } from '../util.js';

const cache = new Map();

// Patch the physical lighting so light "wraps" past the terminator with a warm
// tint — the soft, glowing skin of animated features.
const SSS_CHUNK = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
  'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );',
  `reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
	float wrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + uSSSWrap ) / ( 1.0 + uSSSWrap ) );
	float scatter = max( wrapNL - dotNL, 0.0 );
	reflectedLight.directDiffuse += scatter * directLight.color * BRDF_Lambert( material.diffuseContribution ) * uSSSColor;`
);

export function skinMaterial(color, opts = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    roughness: opts.roughness ?? 0.52,
    metalness: 0,
    sheen: 0.35,
    sheenColor: new THREE.Color(0xff9a7a),
    sheenRoughness: 0.55,
    clearcoat: 0.06,
    clearcoatRoughness: 0.6,
    vertexColors: !!opts.vertexColors,
    specularIntensity: 0.45,
    map: opts.map || null,
    normalMap: opts.normalMap || null,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughnessMap: opts.roughnessMap || null,
  });
  const sssColor = new THREE.Color(opts.sssColor ?? 0xff5a3c).multiplyScalar(opts.sssStrength ?? 0.85);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSSSColor = { value: sssColor };
    shader.uniforms.uSSSWrap = { value: opts.wrap ?? 0.55 };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSSSColor;\nuniform float uSSSWrap;')
      .replace('#include <lights_physical_pars_fragment>', SSS_CHUNK);
  };
  mat.customProgramCacheKey = () => 'skin-sss' + (opts.map ? '-mapped' : '');
  return mat;
}

// Generic "plastic/fabric/painted" surfaces.
export function mat(color, opts = {}) {
  const key = opts.noCache ? null : JSON.stringify([color, opts]);
  if (key && cache.has(key)) return cache.get(key);
  const m = new THREE.MeshPhysicalMaterial({
    color,
    roughness: opts.roughness ?? 0.6,
    metalness: opts.metalness ?? 0,
    clearcoat: opts.clearcoat ?? 0,
    clearcoatRoughness: opts.clearcoatRoughness ?? 0.3,
    sheen: opts.sheen ?? 0,
    sheenColor: opts.sheenColor != null ? new THREE.Color(opts.sheenColor) : new THREE.Color(0xffffff),
    sheenRoughness: opts.sheenRoughness ?? 0.6,
    emissive: opts.emissive != null ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    flatShading: !!opts.flat,
    vertexColors: !!opts.vertexColors,
    map: opts.map || null,
    normalMap: opts.normalMap || null,
    normalScale: opts.normalScale ? new THREE.Vector2(opts.normalScale, opts.normalScale) : new THREE.Vector2(1, 1),
    roughnessMap: opts.roughnessMap || null,
    depthWrite: opts.depthWrite ?? true,
    anisotropy: opts.anisotropy ?? 0,
    anisotropyRotation: opts.anisotropyRotation ?? 0,
    transmission: opts.transmission ?? 0,
    thickness: opts.thickness ?? 0,
    ior: opts.ior ?? 1.5,
    specularIntensity: opts.specularIntensity ?? 1,
  });
  if (opts.polygonOffset) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = opts.polygonOffset;
    m.polygonOffsetUnits = opts.polygonOffset;
  }
  if (key) cache.set(key, m);
  return m;
}

export function fabric(color, opts = {}) {
  return mat(color, {
    roughness: 0.85,
    sheen: 0.6,
    sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45).getHex(),
    sheenRoughness: 0.75,
    normalMap: opts.knit ? knitNormalMap() : weaveNormalMap(),
    normalScale: opts.normalScale ?? (opts.knit ? 0.22 : 0.3),
    ...opts,
  });
}

export function hairMaterial(color) {
  const c = new THREE.Color(color);
  const hsl = {};
  c.getHSL(hsl);
  const sheen = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.8), Math.min(0.85, hsl.l + 0.3));
  return new THREE.MeshPhysicalMaterial({
    color: c,
    roughness: 0.58,
    metalness: 0,
    sheen: 0.45,
    sheenColor: sheen,
    sheenRoughness: 0.45,
    anisotropy: 0.35,
    anisotropyRotation: 0,
    specularIntensity: 0.45,
    normalMap: hairStrandNormalMap(),
    normalScale: new THREE.Vector2(0.18, 0.18),
    vertexColors: true,
  });
}

export const basic = (color, opts = {}) => new THREE.MeshBasicMaterial({ color, ...opts });

// ---- procedural textures ----------------------------------------------------
let _weave = null, _knit = null, _hairN = null;

function normalFromHeight(w, h, heightFn) {
  const data = new Uint8Array(w * h * 4);
  const H = (x, y) => heightFn(((x % w) + w) % w, ((y % h) + h) % h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = H(x + 1, y) - H(x - 1, y);
      const dy = H(x, y + 1) - H(x, y - 1);
      const nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function weaveNormalMap() {
  if (_weave) return _weave;
  const rng = makeRng(7);
  const noise = new Float32Array(128 * 128).map(() => rng());
  _weave = normalFromHeight(128, 128, (x, y) => {
    const warp = Math.sin((x / 128) * Math.PI * 32) * (Math.floor(y / 4) % 2 ? 1 : -1);
    const weft = Math.sin((y / 128) * Math.PI * 32) * (Math.floor(x / 4) % 2 ? 1 : -1);
    return (warp + weft) * 0.6 + noise[y * 128 + x] * 0.8;
  });
  _weave.repeat.set(10, 10);
  return _weave;
}

export function knitNormalMap() {
  if (_knit) return _knit;
  _knit = normalFromHeight(128, 128, (x, y) => {
    const col = x % 16;
    const v = Math.abs(col - 8) / 8;
    const row = ((y + (col < 8 ? col : 16 - col)) % 12) / 12;
    return (1 - v) * 1.5 + Math.sin(row * Math.PI * 2) * 0.8;
  });
  _knit.repeat.set(10, 10);
  return _knit;
}

export function hairStrandNormalMap() {
  if (_hairN) return _hairN;
  const rng = makeRng(11);
  const cols = new Float32Array(256).map(() => rng());
  // u runs along the strand, v across it: grooves vary with v only
  _hairN = normalFromHeight(64, 256, (x, y) => cols[y] * 2.2 + Math.sin(y * 0.9) * 0.5 + x * 0);
  _hairN.repeat.set(1, 6);
  return _hairN;
}

// Radial gradient sprite (bokeh / glow / particles).
let _glow = null;
export function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  _glow = new THREE.CanvasTexture(c);
  _glow.colorSpace = THREE.SRGBColorSpace;
  return _glow;
}

let _disc = null;
export function discTexture() {
  if (_disc) return _disc;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 20, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(32, 32, 32, 0, Math.PI * 2); g.fill();
  _disc = new THREE.CanvasTexture(c);
  _disc.colorSpace = THREE.SRGBColorSpace;
  return _disc;
}

// Canvas texture helper for signs, posters, screens.
export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
