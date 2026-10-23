// Living pictures: real motion for AI-painted shots, made on the device.
//  1. A small depth AI (Depth Anything V2 small) estimates how far away every
//     pixel is; the picture becomes a 3D relief, so the camera moves through
//     the scene with true parallax.
//  2. A face-tracking AI (MediaPipe Face Landmarker) finds each face's lips,
//     jaw and eyelids; those points drive a warp mesh, so mouths move with the
//     voice, eyes blink, heads breathe and sway.
// Everything runs free and unlimited in the browser (WASM/WebGPU).
import * as THREE from 'three';
import { AiFilm } from './cinematic.js';

const TF = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1';
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const DELAUNATOR = 'https://cdn.jsdelivr.net/npm/delaunator@5.0.1/+esm';

// MediaPipe face mesh landmark groups
const LIP_UPPER_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
const LIP_LOWER_INNER = [95, 88, 178, 87, 14, 317, 402, 318, 324];
const EYE_L_UP = [246, 161, 160, 159, 158, 157, 173], EYE_L_LO = [7, 163, 144, 145, 153, 154, 155];
const EYE_R_UP = [466, 388, 387, 386, 385, 384, 398], EYE_R_LO = [249, 390, 373, 374, 380, 381, 382];
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const CHIN = 152, NOSE_TIP = 1, MOUTH_L = 61, MOUTH_R = 291;
const MOUTH_HOLE = new Set([...LIP_UPPER_INNER, ...LIP_LOWER_INNER]);

let tools = null;
async function loadTools(onMsg = () => {}) {
  if (tools) return tools;
  onMsg('Loading motion AI (one time, ~30 MB)');
  const [tf, mp, dl] = await Promise.all([import(/* @vite-ignore */ TF), import(/* @vite-ignore */ `${MP}/vision_bundle.mjs`), import(/* @vite-ignore */ DELAUNATOR)]);
  const depth = await tf.pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'q8' });
  const fileset = await mp.FilesetResolver.forVisionTasks(`${MP}/wasm`);
  let faces;
  try {
    faces = await mp.FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MP_MODEL, delegate: 'GPU' }, runningMode: 'IMAGE', numFaces: 4 });
  } catch {
    faces = await mp.FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MP_MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 4 });
  }
  tools = { tf, depth, faces, Delaunator: dl.default };
  return tools;
}

// Depth (near = 1) on a small grid + face landmarks (pixel coords).
export async function analyze(canvas, onMsg) {
  const T = await loadTools(onMsg);
  const raw = await T.tf.RawImage.fromCanvas(canvas);
  const out = await T.depth(raw);
  const d = out.depth; // RawImage, 1 channel, larger = nearer
  const dw = d.width, dh = d.height, src = d.data;
  // blur so the relief doesn't tear at sharp outlines
  const a = new Float32Array(dw * dh);
  for (let i = 0; i < a.length; i++) a[i] = src[i] / 255;
  const b = new Float32Array(a.length), r = Math.max(2, Math.round(dw / 90));
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < dw) { s += a[y * dw + xx]; n++; } } b[y * dw + x] = s / n; }
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < dh) { s += b[yy * dw + x]; n++; } } a[y * dw + x] = s / n; }
  }
  let res;
  try { res = T.faces.detect(canvas); } catch (e) { console.warn('face detection failed', e); res = { faceLandmarks: [] }; }
  const faces = (res.faceLandmarks || []).map((lm) => lm.map((p) => ({ x: p.x * canvas.width, y: p.y * canvas.height })))
    .sort((f, g) => f[NOSE_TIP].x - g[NOSE_TIP].x);
  return { depth: a, dw, dh, faces };
}

const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// One shot's picture as an animatable 3D warp mesh.
export class LivingPicture {
  constructor(image, info, Delaunator) {
    const W = image.width, H = image.height;
    this.W = W; this.H = H; this.info = info;
    const pts = [], kind = []; // kind: -1 grid, else face index
    const fidx = [];            // landmark index for face points
    // face exclusion polygons (oval, slightly expanded)
    const ovals = info.faces.map((f) => {
      const cx = f[NOSE_TIP].x, cy = f[NOSE_TIP].y;
      return FACE_OVAL.map((i) => ({ x: cx + (f[i].x - cx) * 1.08, y: cy + (f[i].y - cy) * 1.08 }));
    });
    const inside = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
    const cols = 72, rows = Math.round(72 * H / W);
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const x = (i / cols) * W, y = (j / rows) * H;
      if (ovals.some((p) => inside(p, x, y))) continue;
      pts.push(x, y); kind.push(-1); fidx.push(-1);
    }
    info.faces.forEach((f, fi) => f.forEach((p, li) => { pts.push(p.x, p.y); kind.push(fi); fidx.push(li); }));
    const del = new Delaunator(pts);
    const tri = [];
    for (let t = 0; t < del.triangles.length; t += 3) {
      const a = del.triangles[t], b = del.triangles[t + 1], c = del.triangles[t + 2];
      // leave the mouth opening empty so the dark mouth shows through when it opens
      if (kind[a] >= 0 && kind[a] === kind[b] && kind[b] === kind[c] && MOUTH_HOLE.has(fidx[a]) && MOUTH_HOLE.has(fidx[b]) && MOUTH_HOLE.has(fidx[c])) continue;
      tri.push(a, b, c);
    }
    const n = pts.length / 2;
    this.n = n; this.base = Float32Array.from(pts); this.kind = kind; this.fidx = fidx;
    this.z = new Float32Array(n);
    const { depth, dw, dh } = info;
    for (let v = 0; v < n; v++) {
      const dx = Math.min(dw - 1, Math.max(0, Math.round((pts[v * 2] / W) * (dw - 1))));
      const dy = Math.min(dh - 1, Math.max(0, Math.round((pts[v * 2 + 1] / H) * (dh - 1))));
      this.z[v] = depth[dy * dw + dx];
    }
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    for (let v = 0; v < n; v++) { uv[v * 2] = pts[v * 2] / W; uv[v * 2 + 1] = 1 - pts[v * 2 + 1] / H; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(tri);
    const tex = new THREE.CanvasTexture(image);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex }));
    // dark mouth interiors, one per face
    this.mouths = info.faces.map(() => {
      const mg = new THREE.BufferGeometry();
      const k = LIP_UPPER_INNER.length * 2 - 2;
      mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(k * 3), 3));
      const idx = []; for (let i = 1; i < k - 1; i++) idx.push(0, i, i + 1);
      mg.setIndex(idx);
      const m = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: 0x3a1214 }));
      m.renderOrder = -1;
      return m;
    });
    this.group = new THREE.Group();
    this.group.add(this.mesh, ...this.mouths);
    // per-face measurements
    this.faceInfo = info.faces.map((f) => {
      const upper = Math.min(...LIP_UPPER_INNER.map((i) => f[i].y)), lower = Math.max(...LIP_LOWER_INNER.map((i) => f[i].y));
      return { f, upperY: upper, chinY: f[CHIN].y, cx: (f[MOUTH_L].x + f[MOUTH_R].x) / 2, halfW: Math.abs(f[MOUTH_R].x - f[MOUTH_L].x) / 2, faceH: f[CHIN].y - f[10].y, lowerY: lower };
    });
    this.relief = Math.min(W, H) * 0.22;
  }

  // talk[i] 0..1 per face, blink[i] 0..1, t seconds
  pose(t, talk, blink) {
    const pos = this.mesh.geometry.attributes.position.array;
    const W = this.W, H = this.H, R = this.relief;
    const disp = new Float32Array(this.n * 2);
    this.faceInfo.forEach((F, fi) => {
      const open = Math.max(0, Math.min(1, talk[fi] || 0));
      const J = F.faceH * 0.075 * open;
      const bl = blink[fi] || 0;
      const sway = Math.sin(t * 0.9 + fi * 1.7) * F.faceH * 0.006, nod = Math.sin(t * 1.3 + fi) * F.faceH * 0.004;
      const lids = [[EYE_L_UP, EYE_L_LO], [EYE_R_UP, EYE_R_LO]];
      const lidDrop = new Map();
      for (const [up, lo] of lids) up.forEach((u, k) => { const l = lo[Math.min(k, lo.length - 1)]; lidDrop.set(u, (F.f[l].y - F.f[u].y) * 0.92 * bl); });
      for (let v = 0; v < this.n; v++) {
        if (this.kind[v] !== fi) continue;
        const x = this.base[v * 2], y = this.base[v * 2 + 1], li = this.fidx[v];
        let dy = 0;
        // jaw: the lower lip and everything below it drop; less toward the cheeks
        if (y > F.upperY - 1 && !LIP_UPPER_INNER.includes(li)) {
          const s = smooth(F.upperY, F.lowerY + F.faceH * 0.02, y);
          const wx = 1 - 0.55 * smooth(F.halfW * 0.9, F.halfW * 2.4, Math.abs(x - F.cx));
          dy += J * Math.max(s, smooth(F.lowerY, F.chinY, y)) * wx;
        }
        if (lidDrop.has(li)) dy += lidDrop.get(li);
        disp[v * 2] = sway; disp[v * 2 + 1] = dy + nod;
      }
      // mouth interior: only the gap the jaw opens (zero area when closed),
      // just behind the lips at the face's own depth
      const mp = this.mouths[fi].geometry.attributes.position.array;
      const up = LIP_UPPER_INNER.map((li) => F.f[li]);
      const zFace = this.depthAt(F.cx, F.upperY) * R - 2;
      const ring = [...up.map((p) => ({ x: p.x, y: p.y })), ...up.slice(1, -1).reverse().map((p, k, arr) => {
        const u = (k + 1) / (arr.length + 1), bulge = Math.sin(Math.PI * (1 - u));
        return { x: p.x, y: p.y + J * (0.35 + 0.65 * bulge) };
      })];
      ring.forEach((p, k) => {
        mp[k * 3] = p.x + sway - W / 2; mp[k * 3 + 1] = H / 2 - (p.y + nod); mp[k * 3 + 2] = zFace;
      });
      this.mouths[fi].geometry.attributes.position.needsUpdate = true;
    });
    // gentle breathing of near subjects
    const breath = Math.sin(t * 1.7) * H * 0.0025;
    for (let v = 0; v < this.n; v++) {
      const z = this.z[v];
      pos[v * 3] = this.base[v * 2] + disp[v * 2] - W / 2;
      pos[v * 3 + 1] = H / 2 - (this.base[v * 2 + 1] + disp[v * 2 + 1] - breath * smooth(0.55, 0.9, z));
      pos[v * 3 + 2] = z * R;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  depthAt(x, y) {
    const { depth, dw, dh } = this.info;
    const dx = Math.min(dw - 1, Math.max(0, Math.round((x / this.W) * (dw - 1)))), dy = Math.min(dh - 1, Math.max(0, Math.round((y / this.H) * (dh - 1))));
    return depth[dy * dw + dx];
  }

  dispose() {
    this.mesh.geometry.dispose(); this.mesh.material.map.dispose(); this.mesh.material.dispose();
    for (const m of this.mouths) { m.geometry.dispose(); m.material.dispose(); }
  }
}

// An AiFilm whose still shots are brought to life.
export class LivingFilm extends AiFilm {
  constructor(tl, media, aspect) {
    super(tl, media, aspect);
    // one WebGL context shared by every film (browsers cap how many exist)
    if (!LivingFilm.shared) {
      const glc = document.createElement('canvas');
      const r = new THREE.WebGLRenderer({ canvas: glc, antialias: true, preserveDrawingBuffer: true });
      r.outputColorSpace = THREE.SRGBColorSpace;
      LivingFilm.shared = { glc, r };
    }
    this.glc = LivingFilm.shared.glc;
    this.renderer = LivingFilm.shared.r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 1, 100000);
    this.active = null;
  }

  // Analyse every still (depth + faces) and build its living mesh.
  async bringToLife(onProgress = () => {}) {
    const T = await loadTools((m) => onProgress(0, m));
    let k = 0;
    for (const m of this.media) {
      if (m.still && !m.clip && !m.living) {
        try {
          const info = await analyze(m.still);
          m.living = new LivingPicture(m.still, info, T.Delaunator);
        } catch (e) { console.warn('could not bring shot to life', e); }
      }
      onProgress(++k / this.media.length, `Bringing shot ${k} of ${this.media.length} to life`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  talkFor(shot, t) {
    const out = [0, 0, 0, 0];
    for (const l of shot.lines) {
      if (l.speaker === 'narrator' || t < l.start || t > l.end) continue;
      let fi = Math.max(0, (shot.ids || []).indexOf(l.speaker));
      const env = this.envelopes.get(`${l.speaker}::${l.text}`);
      let a;
      if (env) { const i = Math.floor((t - l.start) * env.rate); a = i >= 0 && i < env.data.length ? env.data[i] : 0; }
      else { const u = t - l.start; a = Math.max(0, 0.3 + 0.7 * Math.abs(Math.sin(u * 11 + Math.sin(u * 3.1) * 2))); }
      out[Math.min(3, fi)] = Math.max(out[Math.min(3, fi)], a);
    }
    return out;
  }

  blinkFor(t, n) {
    return Array.from({ length: n }, (_, i) => {
      const period = 3.1 + (i % 3) * 0.9, ph = (t + i * 1.37) % period;
      return ph < 0.16 ? Math.sin((ph / 0.16) * Math.PI) : 0;
    });
  }

  drawLiving(m, shot, index, t) {
    const L = m.living, W = this.canvas.width, H = this.canvas.height;
    if (this.glc.width !== W || this.glc.height !== H) this.renderer.setSize(W, H, false);
    if (this.active !== L) { if (this.active) this.scene.remove(this.active.group); this.scene.add(L.group); this.active = L; }
    this.renderer.setClearColor(0x000000, 1);
    const u = Math.max(0, Math.min(1, (t - shot.start) / Math.max(0.01, shot.end - shot.start)));
    L.pose(t, this.talkFor(shot, t), this.blinkFor(t, L.faceInfo.length));
    // camera: cover the frame, then drift through the relief for parallax
    const cam = this.camera;
    cam.aspect = W / H;
    const fovY = THREE.MathUtils.degToRad(cam.fov);
    const cover = Math.max(L.H, L.W / cam.aspect) / 1.12;
    const dist = cover / 2 / Math.tan(fovY / 2) + L.relief * 0.5;
    const dir = index % 2 ? 1 : -1, ease = u * u * (3 - 2 * u);
    cam.position.set(dir * (ease - 0.5) * L.W * 0.05, (0.5 - ease) * L.H * 0.02, dist * (1 - 0.07 * ease));
    cam.lookAt(0, 0, L.relief * 0.35);
    cam.updateProjectionMatrix();
    this.renderer.render(this.scene, cam);
    this.ctx.drawImage(this.glc, 0, 0, W, H);
  }

  renderAt(t) {
    const r = this.renderLivingIfAny(t);
    return r || super.renderAt(t);
  }

  async renderAtExact(t) {
    if (!this.renderLivingIfAny(t)) await super.renderAtExact(t);
  }

  renderLivingIfAny(t) {
    t = Math.max(0, Math.min(this.tl.duration, t));
    const { shot, index } = this.shotAt(Math.min(t, this.tl.endCard.start - 1e-3));
    const m = this.media[index];
    if (!m || m.clip || !m.living) return null;
    this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawLiving(m, shot, index, t);
    this.applyFade(this.fade(t, shot, index));
    return { shot, index };
  }
}
