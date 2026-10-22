// The film renderer: one scene render into an MSAA HDR target, then a
// cinematic post chain (bokeh depth of field → bloom → grade → ACES output).
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const DOF_SHADER = {
  uniforms: {
    tColor: { value: null },
    tDepth: { value: null },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 200 },
    focusDist: { value: 5 },
    focusScale: { value: 1 },
    maxBlur: { value: 12 },
    radScale: { value: 0.6 },
    pixelSize: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tColor;
    uniform sampler2D tDepth;
    uniform float cameraNear, cameraFar, focusDist, focusScale, maxBlur, radScale;
    uniform vec2 pixelSize;
    varying vec2 vUv;
    const float GOLDEN_ANGLE = 2.39996323;
    float linDepth(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      return -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
    }
    float blurSize(float depth) {
      float coc = clamp((1.0 / focusDist - 1.0 / depth) * focusScale, -1.0, 1.0);
      // a small in-focus zone keeps the whole face crisp
      return max(0.0, abs(coc) - 0.04) / 0.96 * maxBlur;
    }
    void main() {
      float centerDepth = linDepth(vUv);
      float centerSize = blurSize(centerDepth);
      vec3 color = min(texture2D(tColor, vUv).rgb, vec3(5.0));
      float tot = 1.0;
      float radius = radScale;
      float ang = 0.0;
      for (int i = 0; i < 640; i++) {
        if (radius >= maxBlur) break;
        vec2 tc = vUv + vec2(cos(ang), sin(ang)) * pixelSize * radius;
        vec3 sampleColor = min(texture2D(tColor, tc).rgb, vec3(5.0));
        float sampleDepth = linDepth(tc);
        float sampleSize = blurSize(sampleDepth);
        if (sampleDepth > centerDepth) sampleSize = clamp(sampleSize, 0.0, centerSize * 2.0);
        float m = smoothstep(radius - 0.5, radius + 0.5, sampleSize);
        color += mix(color / tot, sampleColor, m);
        tot += 1.0;
        radius += radScale / radius;
        ang += GOLDEN_ANGLE;
      }
      gl_FragColor = vec4(color / tot, 1.0);
    }`,
};

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    vignette: { value: 0.35 },
    grain: { value: 0.025 },
    saturation: { value: 1.08 },
    contrast: { value: 1.04 },
    shadowTint: { value: new THREE.Color(0.92, 0.97, 1.08) },
    highlightTint: { value: new THREE.Color(1.06, 1.0, 0.92) },
    fade: { value: 0 },
    aspect: { value: 16 / 9 },
  },
  vertexShader: DOF_SHADER.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time, vignette, grain, saturation, contrast, fade, aspect;
    uniform vec3 shadowTint, highlightTint;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= mix(shadowTint, highlightTint, smoothstep(0.0, 0.9, lum));
      lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(lum), c, saturation);
      c = max(vec3(0.0), (c - 0.18) * contrast + 0.18);
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0) / max(aspect, 1.0);
      float v = smoothstep(0.85, 0.2, length(d) * 1.25);
      c *= mix(1.0, v, vignette);
      float n = hash(vUv * 1000.0 + fract(time * 13.7)) - 0.5;
      c += n * grain * (0.35 + lum);
      c *= (1.0 - fade);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export const QUALITY = {
  low: { pixelRatio: 0.75, samples: 0, shadows: 1024, dofIters: 0, bloom: true, ao: false },
  medium: { pixelRatio: 1, samples: 4, shadows: 2048, dofIters: 70, bloom: true, ao: true },
  high: { pixelRatio: 1.5, samples: 4, shadows: 2048, dofIters: 140, bloom: true, ao: true },
  export: { pixelRatio: 1, samples: 8, shadows: 4096, dofIters: 260, bloom: true, ao: true },
};

export class FilmRenderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.qualityName = opts.quality || 'medium';
    this.q = QUALITY[this.qualityName];
    this.width = 2;
    this.height = 2;

    this.dofQuad = new FullScreenQuad(new THREE.ShaderMaterial({ ...DOF_SHADER, uniforms: THREE.UniformsUtils.clone(DOF_SHADER.uniforms) }));
    this.gradeQuad = new FullScreenQuad(new THREE.ShaderMaterial({ ...GRADE_SHADER, uniforms: THREE.UniformsUtils.clone(GRADE_SHADER.uniforms) }));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.55, 0.85);
    this.output = new OutputPass();
    this.output.renderToScreen = true;
    this._makeTargets(2, 2);
  }

  _makeTargets(w, h) {
    for (const t of [this.rtScene, this.rtA, this.rtB]) t && t.dispose();
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    this.rtScene = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: this.q.samples,
      depthTexture,
      depthBuffer: true,
    });
    this.rtA = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtB = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.bloom.setSize(w, h);
    if (this.gtao) this.gtao.setSize(w, h);
  }

  setQuality(name) {
    if (!QUALITY[name] || name === this.qualityName) return;
    this.qualityName = name;
    this.q = QUALITY[name];
    this.setSize(this.cssW || this.width, this.cssH || this.height, this.extraScale);
  }

  // cssW/cssH: display size; the drawing buffer is scaled by quality pixel ratio.
  setSize(cssW, cssH, extraScale = 1) {
    this.cssW = cssW; this.cssH = cssH; this.extraScale = extraScale;
    const pr = this.q.pixelRatio * extraScale;
    const w = Math.max(2, Math.round(cssW * pr));
    const h = Math.max(2, Math.round(cssH * pr));
    if (w === this.width && h === this.height && this._samples === this.q.samples) return;
    this.width = w; this.height = h; this._samples = this.q.samples;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this._makeTargets(w, h);
  }

  get shadowMapSize() { return this.q.shadows; }

  // fx: { focusDist, aperture (0 = off), bloom, exposure, vignette, fade, time, grade:{...} }
  render(scene, camera, fx = {}) {
    const r = this.renderer;
    camera.aspect = this.width / this.height;
    camera.updateProjectionMatrix();
    r.toneMappingExposure = fx.exposure ?? 1.0;

    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);

    let src = this.rtScene;
    // ambient occlusion: contact shadows in folds, under chins, around feet
    if (this.q.ao && fx.ao !== false) {
      if (!this.gtao) {
        this.gtao = new GTAOPass(scene, camera, this.width, this.height);
        this.gtao.output = GTAOPass.OUTPUT.Default;
      }
      const ao = this.gtao;
      ao.scene = scene; ao.camera = camera;
      ao.updateGtaoMaterial({ radius: fx.aoRadius ?? 0.35, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: 16, distanceFallOff: 1.0 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      ao.blendIntensity = fx.aoIntensity ?? 0.85;
      ao.render(r, this.rtB, this.rtScene);
      src = this.rtB;
    }
    const aperture = this.q.dofIters > 0 ? fx.aperture ?? 0 : 0;
    {
      // always runs: clamps HDR outliers (tiny specular peaks would otherwise
      // bloom across the whole frame); blurs only when aperture > 0
      const u = this.dofQuad.material.uniforms;
      u.tColor.value = src.texture;
      u.tDepth.value = this.rtScene.depthTexture;
      u.cameraNear.value = camera.near;
      u.cameraFar.value = camera.far;
      u.focusDist.value = Math.max(0.3, fx.focusDist ?? 5);
      // focusScale: how fast blur grows away from focus; aperture is ~f-stop-ish 0..1
      // scale with focus distance so close-ups keep the subject sharp
      u.focusScale.value = aperture * 6.0 * Math.min(1.6, Math.max(0.35, u.focusDist.value / 3.0));
      const maxBlur = aperture > 0.001 ? Math.max(2, this.height * (fx.maxBlurFrac ?? 0.018)) : 0;
      u.maxBlur.value = maxBlur;
      // keep iteration count bounded: iterations ≈ maxBlur² / (2·radScale)
      u.radScale.value = Math.max(0.5, (maxBlur * maxBlur) / (2 * Math.max(1, this.q.dofIters)));
      u.pixelSize.value.set(1 / this.width, 1 / this.height);
      r.setRenderTarget(this.rtA);
      this.dofQuad.render(r);
      src = this.rtA;
    }

    if (this.q.bloom && (fx.bloom ?? 0.35) > 0) {
      this.bloom.strength = (fx.bloom ?? 0.35) * 0.8;
      this.bloom.radius = fx.bloomRadius ?? 0.6;
      this.bloom.threshold = fx.bloomThreshold ?? 2.2;
      this.bloom.render(r, null, src, 0, false);
    }

    const g = this.gradeQuad.material.uniforms;
    g.tDiffuse.value = src.texture;
    g.time.value = fx.time ?? 0;
    g.vignette.value = fx.vignette ?? 0.38;
    g.grain.value = fx.grain ?? 0.02;
    g.fade.value = fx.fade ?? 0;
    g.aspect.value = this.width / this.height;
    g.saturation.value = fx.saturation ?? 1.08;
    g.contrast.value = fx.contrast ?? 1.04;
    if (fx.shadowTint) g.shadowTint.value.copy(fx.shadowTint); else g.shadowTint.value.setRGB(0.93, 0.97, 1.07);
    if (fx.highlightTint) g.highlightTint.value.copy(fx.highlightTint); else g.highlightTint.value.setRGB(1.06, 1.0, 0.93);
    const dst = src === this.rtA ? this.rtB : this.rtA;
    r.setRenderTarget(dst);
    this.gradeQuad.render(r);

    this.output.render(r, null, dst);
    r.setRenderTarget(null);
  }

  dispose() {
    for (const t of [this.rtScene, this.rtA, this.rtB]) t && t.dispose();
    this.renderer.dispose();
  }
}
