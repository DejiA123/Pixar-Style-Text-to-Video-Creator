// Sky dome shader (gradient, sun/moon, stars, soft clouds) and the lighting
// presets for each time of day.
import * as THREE from 'three';

export const TIME_PRESETS = {
  dawn: { zenith: 0x6f93cf, horizon: 0xffc9a3, ground: 0x8a7a70, sun: 0xffc896, sunI: 2.6, elev: 0.22, azim: -0.9, hemiSky: 0xbcd0ee, hemiGround: 0x9a7f6a, hemiI: 0.55, fog: 0xf1cdb5, exposure: 1.0, envI: 0.55, stars: 0, cloud: 0xffe0d0 },
  day: { zenith: 0x3f86de, horizon: 0xcfe6ff, ground: 0x8a8f7a, sun: 0xfff2dc, sunI: 3.2, elev: 0.85, azim: -0.6, hemiSky: 0xc5ddff, hemiGround: 0x8a7a5a, hemiI: 0.6, fog: 0xcfe2f5, exposure: 1.0, envI: 0.6, stars: 0, cloud: 0xffffff },
  sunset: { zenith: 0x34508f, horizon: 0xff9a5c, ground: 0x6a5048, sun: 0xff9a55, sunI: 2.8, elev: 0.1, azim: -1.2, hemiSky: 0x8f9fd0, hemiGround: 0x8a5a48, hemiI: 0.5, fog: 0xe9a07a, exposure: 1.02, envI: 0.5, stars: 0.15, cloud: 0xffb08a },
  night: { zenith: 0x060b22, horizon: 0x24345e, ground: 0x15182a, sun: 0x9db4ff, sunI: 0.9, elev: 0.75, azim: 0.7, hemiSky: 0x3a4a80, hemiGround: 0x1a1a28, hemiI: 0.35, fog: 0x1a2240, exposure: 1.15, envI: 0.35, stars: 1, cloud: 0x3a4670 },
};

export function applyWeather(preset, weather) {
  const p = { ...preset };
  const c = (hex) => new THREE.Color(hex);
  if (weather === 'rain' || weather === 'storm') {
    const gray = c(0x7a8494);
    p.zenith = c(p.zenith).lerp(gray, 0.7).getHex(); p.horizon = c(p.horizon).lerp(c(0xa8b0bc), 0.7).getHex();
    p.sunI *= 0.45; p.fog = c(p.fog).lerp(gray, 0.6).getHex(); p.cloud = 0x9aa3b0; p.clouds = 0.85; p.hemiI *= 0.9;
    if (weather === 'storm') { p.zenith = c(p.zenith).multiplyScalar(0.6).getHex(); p.sunI *= 0.6; }
  } else if (weather === 'snow') {
    p.zenith = c(p.zenith).lerp(c(0xb8c8dc), 0.5).getHex(); p.horizon = c(p.horizon).lerp(c(0xeef3f8), 0.6).getHex();
    p.fog = c(p.fog).lerp(c(0xe8eef5), 0.6).getHex(); p.sunI *= 0.7; p.clouds = 0.6;
  } else if (weather === 'fog') {
    p.fog = c(p.horizon).lerp(c(0xd8dde4), 0.5).getHex(); p.fogDensity = 0.045; p.sunI *= 0.6;
  } else if (weather === 'rainbow') {
    p.rainbow = true;
  }
  return p;
}

export function makeSkyMaterial(preset) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(preset.zenith) },
      horizon: { value: new THREE.Color(preset.horizon) },
      ground: { value: new THREE.Color(preset.ground) },
      sunDir: { value: new THREE.Vector3() },
      sunColor: { value: new THREE.Color(preset.sun) },
      night: { value: preset.stars },
      clouds: { value: preset.clouds ?? 0.35 },
      cloudColor: { value: new THREE.Color(preset.cloud) },
      time: { value: 0 },
      rainbow: { value: preset.rainbow ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith, horizon, ground, sunDir, sunColor, cloudColor;
      uniform float night, clouds, time, rainbow;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x) { vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizon, zenith, pow(smoothstep(0.0, 0.75, h), 0.7));
        col = mix(col, ground, smoothstep(0.0, -0.12, h));
        float sd = max(dot(d, normalize(sunDir)), 0.0);
        col += sunColor * (pow(sd, 6.0) * 0.35 + pow(sd, 64.0) * 0.8) * (1.0 - night * 0.6);
        col += sunColor * smoothstep(0.9993, 0.9997, sd) * (night > 0.5 ? 1.6 : 4.0);
        // clouds on a dome
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.18);
          float c = fbm(vec3(uv * 1.2 + vec2(time * 0.01, 0.0), time * 0.005));
          c = smoothstep(0.62 - clouds * 0.3, 0.9 - clouds * 0.2, c) * smoothstep(0.0, 0.25, h);
          vec3 cc = cloudColor * (0.85 + 0.25 * pow(sd, 3.0));
          col = mix(col, cc, c * 0.85);
        }
        // stars
        if (night > 0.0 && h > 0.0) {
          vec3 sp = floor(d * 380.0);
          float s = hash(sp);
          float tw = 0.7 + 0.3 * sin(time * 2.0 + s * 50.0);
          col += vec3(step(0.9975, s) * tw * night * smoothstep(0.0, 0.3, h));
          col += vec3(0.5, 0.6, 1.0) * fbm(d * 3.0 + 4.0) * 0.06 * night * smoothstep(0.1, 0.6, h);
        }
        if (rainbow > 0.5) {
          float a = acos(dot(d, normalize(vec3(-sunDir.x, -0.15, -sunDir.z))));
          float band = smoothstep(0.66, 0.7, a) * smoothstep(0.78, 0.74, a) * smoothstep(-0.02, 0.15, h);
          vec3 rb = 0.5 + 0.5 * cos(6.2831 * ((a - 0.66) / 0.12) + vec3(0.0, 2.1, 4.2));
          col = mix(col, col + rb * 0.6, band * 0.55);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export function sunDirection(preset) {
  const e = preset.elev, a = preset.azim;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).normalize();
}

// Instanced grass blades that sway in the wind (closed-form in time).
export function grassField(rng, opts) {
  const count = opts.count ?? 9000;
  const blade = new THREE.BufferGeometry();
  const h = 1, w = 0.06;
  blade.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, -w * 0.6, h * 0.5, 0.02, w * 0.6, h * 0.5, 0.02, 0, h, 0.08], 3));
  blade.setAttribute('color', new THREE.Float32BufferAttribute([0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 1.15, 1.15, 1.1], 3));
  blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
  blade.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ color: opts.color ?? 0x6fae45, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const uTime = { value: 0 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sway = sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.25) * 0.5 + sin(uTime * 3.1 + wp.x * 1.1) * 0.15;
        transformed.x += sway * position.y * position.y * 0.35;
        transformed.z += sway * position.y * position.y * 0.15;`);
  };
  m.customProgramCacheKey = () => 'grass-wind';
  const im = new THREE.InstancedMesh(blade, m, count);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const r0 = opts.inner ?? 0.0, r1 = opts.outer ?? 26;
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(r0 * r0 + rng() * (r1 * r1 - r0 * r0));
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    dummy.position.set(x, opts.heightAt ? opts.heightAt(x, z) : 0, z);
    dummy.rotation.set(rng.range(-0.15, 0.15), rng() * Math.PI, rng.range(-0.15, 0.15));
    const s = rng.range(0.6, 1.2) * (opts.height ?? 0.28);
    dummy.scale.set(s * 1.4, s, s);
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
    col.setHSL(rng.range(0.22, 0.3), rng.range(0.45, 0.65), rng.range(0.35, 0.55));
    im.setColorAt(i, col);
  }
  im.receiveShadow = true;
  im.userData.update = (t) => { uTime.value = t; };
  return im;
}
