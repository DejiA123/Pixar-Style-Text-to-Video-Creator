// Painted face textures. The head's UVs are a straight front projection of
// the undeformed sphere (u = 0.5 + x/2, v = 0.5 + y/2), so features can be
// painted in "face space": x,y in -1..1 with +y up.
import * as THREE from 'three';
import { makeRng, clamp, smoothstep } from '../../util.js';

const SIZE = 1024;

// Face space → texture: u = 0.5 + x/2, v = 0.55 + 0.4y (covers chin to crown).
export const UV_SY = 0.4, UV_OY = 0.55;
function toPx(x, y) { return [(0.5 + x * 0.5) * SIZE, (1 - (UV_OY + y * UV_SY)) * SIZE]; }

// Hash noise for pores.
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// P: face params; look: { skin, lipColor, female, freckles, stubble: {color, amount} | null, age }
export function paintFace(P, look, seed = 1) {
  const rng = makeRng(seed);
  const base = new THREE.Color(look.skin);
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  // base: white multiplier (material color carries the skin tone)
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, SIZE, SIZE);
  const radial = (x, y, r, color, alpha, sx = 1, sy = 1) => {
    const [px, py] = toPx(x, y);
    g.save();
    g.translate(px, py); g.scale(sx, sy * (UV_SY / 0.5));
    const R = r * SIZE * 0.5;
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, R);
    grd.addColorStop(0, rgba(color, alpha)); grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
    g.restore();
  };
  const warm = '#ff8f7a', rose = '#ff6f6f', shadow = '#b07a6a';
  // subtle mottling
  for (let i = 0; i < 160; i++) radial(rng.range(-0.75, 0.75), rng.range(-1.1, 0.7), rng.range(0.05, 0.16), rng() < 0.5 ? '#ffd2c4' : '#f2dccf', 0.07);
  // cheeks, nose, chin, forehead warmth
  const blush = look.female ? 0.3 : 0.18;
  for (const s of [-1, 1]) radial(s * 0.47, -0.25, 0.34, rose, blush, 1, 0.75);
  radial(0, -0.18, 0.12, warm, 0.25);
  radial(0, -0.82, 0.2, warm, 0.18);
  
  // eyelid crease & under-eye softness
  for (const s of [-1, 1]) {
    radial(s * P.eyeSpacing, P.eyeY + P.eyeR * 0.95, P.eyeR * 1.4, shadow, 0.25, 1.2, 0.45);
    radial(s * P.eyeSpacing, P.eyeY - P.eyeR * 1.05, P.eyeR * 1.2, '#c99a8f', 0.18, 1.2, 0.4);
  }
  // nostril shadow and philtrum
  radial(0, P.mouthY + 0.22, 0.09, shadow, 0.25, 0.6, 1);
  // lips
  const lip = new THREE.Color(look.lipColor);
  const lipCss = '#' + lip.getHexString();
  const mw = 0.2 * (look.child ? 0.92 : 1);
  const my = P.mouthY;
  g.save();
  g.fillStyle = lipCss;
  g.globalAlpha = look.female ? 0.85 : 0.55;
  // upper lip with a cupid's bow
  g.beginPath();
  let [x0, y0] = toPx(-mw, my + 0.005); g.moveTo(x0, y0);
  const up = (x, y) => { const [px, py] = toPx(x, y); return [px, py]; };
  g.bezierCurveTo(...up(-mw * 0.6, my + 0.035), ...up(-mw * 0.25, my + 0.06), ...up(-0.04, my + 0.055));
  g.quadraticCurveTo(...up(0, my + 0.04), ...up(0.04, my + 0.055));
  g.bezierCurveTo(...up(mw * 0.25, my + 0.06), ...up(mw * 0.6, my + 0.035), ...up(mw, my + 0.005));
  g.bezierCurveTo(...up(mw * 0.5, my - 0.004), ...up(-mw * 0.5, my - 0.004), x0, y0);
  g.fill();
  // lower lip, fuller
  g.beginPath();
  g.moveTo(...up(-mw * 0.92, my - 0.004));
  g.bezierCurveTo(...up(-mw * 0.55, my - 0.075), ...up(mw * 0.55, my - 0.075), ...up(mw * 0.92, my - 0.004));
  g.bezierCurveTo(...up(mw * 0.4, my - 0.012), ...up(-mw * 0.4, my - 0.012), ...up(-mw * 0.92, my - 0.004));
  g.fill();
  g.restore();
  radial(0, my - 0.035, 0.07, '#ffffff', look.female ? 0.25 : 0.12, 1.6, 0.6); // lower lip highlight
  radial(0, my - 0.11, 0.08, shadow, 0.18, 1.4, 0.6); // shadow under the lower lip
  // freckles
  if (look.freckles) {
    for (let i = 0; i < 55; i++) {
      const s = rng() < 0.5 ? -1 : 1;
      const x = s * rng.range(0.1, 0.5), y = rng.range(-0.3, -0.1) + (Math.abs(x) < 0.2 ? 0.06 : 0);
      radial(x, y, rng.range(0.006, 0.012), '#b0704a', rng.range(0.12, 0.28));
    }
  }
  // stubble: thousands of tiny dots over the jaw
  if (look.stubble) {
    const sc = '#' + new THREE.Color(look.stubble.color).getHexString();
    for (let i = 0; i < 9000; i++) {
      const x = rng.range(-0.9, 0.9), y = rng.range(-1, -0.15);
      const jaw = smoothstep(-0.2, -0.5, y + Math.abs(x) * 0.3) * (1 - smoothstep(0.75, 0.95, Math.abs(x)));
      const mouthHole = Math.exp(-((x / 0.22) ** 2 + ((y - my + 0.01) / 0.06) ** 2));
      const must = Math.exp(-((x / 0.27) ** 2 + ((y - (my + 0.11)) / 0.05) ** 2));
      const p = clamp((jaw + must) * look.stubble.amount - mouthHole * 2);
      if (rng() < p) {
        const [px, py] = toPx(x, y);
        g.fillStyle = rgba(sc, rng.range(0.25, 0.55));
        g.fillRect(px, py, 1.6, 1.6);
      }
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  // normal + roughness: pores, lip creases, glossy lips and T-zone
  const N = 512;
  const nd = new Uint8Array(N * N * 4);
  const rd = new Uint8Array(N * N * 4);
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = (x / N) * 2 - 1, fy = (1 - y / N - UV_OY) / UV_SY;
    let v = ((hash2(x, y) - 0.5) * 0.6 + (hash2(x >> 1, y >> 1) - 0.5) * 0.5) * (1 - smoothstep(0.7, 0.9, Math.abs(fx)));
    const onLip = Math.abs(fx) < mw && fy < my + 0.06 && fy > my - 0.08;
    if (onLip) v += Math.sin(fx * 260) * 0.25;
    h[y * N + x] = v;
    const nose = Math.exp(-((fx / 0.18) ** 2 + ((fy + 0.2) / 0.2) ** 2));
    const fore = Math.exp(-((fx / 0.4) ** 2 + ((fy - 0.6) / 0.25) ** 2));
    let rough = 0.56 - nose * 0.12 - fore * 0.06 - (onLip ? 0.2 : 0);
    rd[(y * N + x) * 4 + 1] = clamp(rough) * 255;
    rd[(y * N + x) * 4 + 3] = 255;
  }
  // soften the pore noise so it reads as skin, not streaks
  for (let pass = 0; pass < 2; pass++) {
    const t = h.slice();
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const i = y * N + x;
      h[i] = (t[i] * 4 + t[i - 1] + t[i + 1] + t[i - N] + t[i + N]) / 8;
    }
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h[y * N + Math.min(N - 1, x + 1)] - h[y * N + Math.max(0, x - 1)];
    const dy = h[Math.min(N - 1, y + 1) * N + x] - h[Math.max(0, y - 1) * N + x];
    const nx = -dx * 0.6, ny = dy * 0.6, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const i = (y * N + x) * 4;
    nd[i] = (nx / l * 0.5 + 0.5) * 255; nd[i + 1] = (ny / l * 0.5 + 0.5) * 255; nd[i + 2] = (nz / l * 0.5 + 0.5) * 255; nd[i + 3] = 255;
  }
  const normalMap = new THREE.DataTexture(nd, N, N); normalMap.needsUpdate = true;
  normalMap.wrapS = normalMap.wrapT = THREE.ClampToEdgeWrapping; normalMap.generateMipmaps = true; normalMap.minFilter = THREE.LinearMipmapLinearFilter; normalMap.magFilter = THREE.LinearFilter;
  const roughnessMap = new THREE.DataTexture(rd, N, N); roughnessMap.needsUpdate = true;
  roughnessMap.generateMipmaps = true; roughnessMap.minFilter = THREE.LinearMipmapLinearFilter; roughnessMap.magFilter = THREE.LinearFilter;
  void base;
  return { map, normalMap, roughnessMap };
}

function rgba(color, a) {
  const c = new THREE.Color(color);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}

// Front-projection UVs from head-space positions. Surfaces facing away from
// the camera get a neutral texel so nothing paints the back of the head.
export function faceUVs(pos, nrm) {
  const n = pos.length / 3;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    // behind the ears the projection keeps going outward past the texture edge
    // (clamped to the clean border), so there is no seam
    const back = z < 0 ? Math.atan2(-z, Math.abs(x) + 1e-6) * 0.8 : 0;
    uv[i * 2] = 0.5 + 0.5 * Math.sign(x || 1) * (Math.abs(x) + back);
    uv[i * 2 + 1] = Math.min(0.995, Math.max(0.005, UV_OY + y * UV_SY));
  }
  return uv;
}
