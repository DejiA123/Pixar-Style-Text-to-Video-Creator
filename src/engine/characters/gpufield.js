// GPU evaluation of a LockField on a regular grid (WebGL2 + float render
// targets). The lock segments, the bucket table and the bucket index lists go
// into float textures; a fragment shader evaluates four z-slices per pixel of a
// tiled atlas and the result is read back in one go. Returns null when the
// platform can't do it, so callers fall back to the CPU path.

let ctx = null; // { gl, prog, vao, ok }

const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D segs, buckets, list;
uniform vec3 gmin; uniform float h; uniform ivec3 gdim; uniform int tilesPerRow;
uniform vec3 bmin; uniform float bcell; uniform ivec3 bdim;
uniform float K; uniform float CELLV;
out vec4 outv;
vec4 seg(int id, int c) { int t = id * 5 + c; return texelFetch(segs, ivec2(t & 1023, t >> 10), 0); }
float smin(float a, float b, float k) { float q = max(k - abs(a - b), 0.0) / k; return min(a, b) - q * q * k * 0.25; }
float field(vec3 p) {
  ivec3 b = ivec3(floor((p - bmin) / bcell));
  if (any(lessThan(b, ivec3(0))) || any(greaterThanEqual(b, bdim))) return CELLV;
  int bi = (b.z * bdim.y + b.y) * bdim.x + b.x;
  vec4 bt = texelFetch(buckets, ivec2(bi & 2047, bi >> 11), 0);
  int off = int(bt.r), cnt = int(bt.g);
  if (cnt == 0) return CELLV;
  float acc = 1e3, cm = 1e3, cur = -1.0;
  for (int q = 0; q < 65536; q++) {
    if (q >= cnt) break;
    int li = off + q;
    int id = int(texelFetch(list, ivec2(li & 2047, li >> 11), 0).r);
    vec4 D = seg(id, 1);
    if (D.w != cur) { if (cm < 1e3) acc = acc >= 1e3 ? cm : smin(acc, cm, K); cur = D.w; cm = 1e3; }
    vec4 A = seg(id, 0), N = seg(id, 2), L = seg(id, 3), T = seg(id, 4);
    float thr = min(cm, acc + K);
    vec3 pp = p - A.xyz;
    float on = dot(pp, N.xyz); if (abs(on) - T.w > thr) continue;
    float al = dot(pp, D.xyz); if (al < -T.w - thr || al > A.w + T.w + thr) continue;
    float ol = dot(pp, L.xyz); if (abs(ol) - T.z > thr) continue;
    float hh = clamp(al / A.w, 0.0, 1.0);
    vec3 o = pp - D.xyz * (A.w * hh);
    float w = mix(N.w, L.w, hh), t = mix(T.x, T.y, hh);
    vec3 e = vec3(dot(o, L.xyz) / w, dot(o, N.xyz) / t, dot(o, D.xyz) / t);
    float k0 = length(e), k1 = length(e / vec3(w, t, t));
    float d = k1 < 1e-9 ? -t : k0 * (k0 - 1.0) / k1;
    cm = min(cm, d);
  }
  if (cm < 1e3) acc = acc >= 1e3 ? cm : smin(acc, cm, K);
  return acc >= 1e3 ? CELLV : acc;
}
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  int tile = (px.y / gdim.y) * tilesPerRow + (px.x / gdim.x);
  int i = px.x - (px.x / gdim.x) * gdim.x, j = px.y - (px.y / gdim.y) * gdim.y;
  vec4 r;
  for (int c = 0; c < 4; c++) {
    int k = tile * 4 + c;
    r[c] = k < gdim.z ? field(gmin + vec3(float(i), float(j), float(k)) * h) : CELLV;
  }
  outv = r;
}`;

function init() {
  if (ctx) return ctx.ok ? ctx : null;
  ctx = { ok: false };
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : (typeof document !== 'undefined' ? document.createElement('canvas') : null);
    if (!canvas) return null;
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    Object.assign(ctx, { gl, prog, vao, ok: true, maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) });
    return ctx;
  } catch (e) {
    console.warn('GPU hair field unavailable:', e.message);
    return null;
  }
}

function floatTex(gl, width, data, channels) {
  const rows = Math.max(1, Math.ceil(data.length / channels / width));
  const full = new Float32Array(width * rows * channels);
  full.set(data);
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  if (channels === 4) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, rows, 0, gl.RGBA, gl.FLOAT, full);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, rows, 0, gl.RED, gl.FLOAT, full);
  return t;
}

// field: a LockField. Returns Float32Array of nx*ny*nz lock-field values (no mass), or null.
export function gpuLockGrid(field, min, nx, ny, nz, h) {
  const c = init();
  if (!c) return null;
  const { gl, prog, vao } = c;
  const segs = field.segs;
  if (!segs.length) return null;
  try {
    const sd = new Float32Array(segs.length * 20);
    segs.forEach((s, i) => {
      sd.set([s.ax, s.ay, s.az, s.len, s.dx, s.dy, s.dz, s.lock, s.nx, s.ny, s.nz, s.wa, s.lx, s.ly, s.lz, s.wb, s.ta, s.tb, s.wm, s.tm], i * 20);
    });
    const nb = field.nx * field.ny * field.nz;
    const table = new Float32Array(nb * 4);
    const ids = [];
    for (let b = 0; b < nb; b++) {
      const l = field.buckets.get(b);
      table[b * 4] = ids.length;
      table[b * 4 + 1] = l ? l.length : 0;
      if (l) for (const id of l) ids.push(id);
    }
    if (Math.ceil(ids.length / 2048) > c.maxTex || Math.ceil(nb / 2048) > c.maxTex) return null;
    const tSeg = floatTex(gl, 1024, sd, 4);
    const tBuck = floatTex(gl, 2048, table, 4);
    const tList = floatTex(gl, 2048, new Float32Array(ids), 1);
    // atlas of 4-slice tiles
    const slabs = Math.ceil(nz / 4);
    const tilesPerRow = Math.max(1, Math.min(slabs, Math.floor(Math.min(c.maxTex, 8192) / nx)));
    const W = tilesPerRow * nx, H = Math.ceil(slabs / tilesPerRow) * ny;
    if (H > c.maxTex) return null;
    const rt = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rt);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    const U = (n) => gl.getUniformLocation(prog, n);
    [[tSeg, 'segs'], [tBuck, 'buckets'], [tList, 'list']].forEach(([t, n], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(U(n), i); });
    gl.uniform3f(U('gmin'), min[0], min[1], min[2]);
    gl.uniform1f(U('h'), h);
    gl.uniform3i(U('gdim'), nx, ny, nz);
    gl.uniform1i(U('tilesPerRow'), tilesPerRow);
    gl.uniform3f(U('bmin'), field.min.x, field.min.y, field.min.z);
    gl.uniform1f(U('bcell'), field.cell);
    gl.uniform3i(U('bdim'), field.nx, field.ny, field.nz);
    gl.uniform1f(U('K'), field.k);
    gl.uniform1f(U('CELLV'), field.cell);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.SCISSOR_TEST);
    // draw in bands so a slow GPU never trips the driver watchdog
    const band = 64;
    for (let y = 0; y < H; y += band) {
      gl.scissor(0, y, W, Math.min(band, H - y));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.flush();
    }
    gl.disable(gl.SCISSOR_TEST);
    const out = new Float32Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, out);
    const vals = new Float32Array(nx * ny * nz);
    for (let tile = 0; tile < slabs; tile++) {
      const tx = (tile % tilesPerRow) * nx, ty = Math.floor(tile / tilesPerRow) * ny;
      for (let c4 = 0; c4 < 4; c4++) {
        const k = tile * 4 + c4;
        if (k >= nz) break;
        for (let j = 0; j < ny; j++) {
          const src = ((ty + j) * W + tx) * 4 + c4;
          const dst = (k * ny + j) * nx;
          for (let i = 0; i < nx; i++) vals[dst + i] = out[src + i * 4];
        }
      }
    }
    [tSeg, tBuck, tList, rt].forEach((t) => gl.deleteTexture(t));
    gl.deleteFramebuffer(fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return vals;
  } catch (e) {
    console.warn('GPU hair field failed:', e.message);
    return null;
  }
}
