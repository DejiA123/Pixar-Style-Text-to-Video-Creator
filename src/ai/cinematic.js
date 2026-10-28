// Cinematic AI renderer: the same story director and soundtrack as the 3D
// engine, but every shot is painted and animated by AI models on fal.ai:
//   1. an LLM director enriches the plan (looks, framing, motion)
//   2. Nano Banana Pro paints a reference sheet per character
//   3. Nano Banana Pro paints each shot from those references
//   4. Kling / Veo animates each shot
import { FalClient, pool } from './fal.js';
import { lineKey } from '../film/timeline.js';
import { clamp, smoothstep } from '../util.js';
import {
  Input, ALL_FORMATS, BlobSource, CanvasSink,
} from '../../vendor/mediabunny/mediabunny.min.mjs';

export const STYLE = 'High-end 3D animated feature film still, Pixar and Disney Animation style: appealing stylized characters with large expressive eyes, soft subsurface skin with natural blush, individually sculpted hair strands with soft sheen, rich fabric textures, cinematic lighting with a warm key light and a soft rim light, volumetric light, shallow depth of field with creamy bokeh, RenderMan quality, crisp 4k detail, vibrant but natural color grading.';
const NEGATIVE = 'photo, live action, 2D drawing, anime, flat shading, low detail, blurry face, deformed hands, extra fingers, extra limbs, text, captions, subtitles, watermark, logo';

const IMAGE_EP = 'fal-ai/nano-banana-pro';
const EDIT_EP = 'fal-ai/nano-banana-pro/edit';
const LLM_EP = 'openrouter/router';
const LLM_MODEL = 'anthropic/claude-sonnet-5.5';
const IMG_PRICE = 0.15;
const VIDEO = {
  'fal-ai/kling-video/v3/pro/image-to-video': { price: 0.112, dur: (s) => String(clamp(Math.round(s), 3, 15)), image: 'start_image_url' },
  'fal-ai/kling-video/v2.6/pro/image-to-video': { price: 0.07, dur: (s) => (s > 6.5 ? '10' : '5'), image: 'start_image_url' },
  'fal-ai/veo3.1/fast/image-to-video': { price: 0.10, dur: (s) => (s > 6.5 ? '8s' : s > 4.5 ? '6s' : '4s'), image: 'image_url', aspect: true },
};

const FRAMING = {
  establishing: 'wide establishing shot showing the whole location, characters small in frame',
  wide: 'wide shot, full bodies visible',
  medium: 'medium shot from the waist up',
  closeup: 'close-up portrait on the face, background softly blurred',
  'over-shoulder': 'over-the-shoulder shot: the listener seen from behind and out of focus in the foreground, the speaker facing the camera in sharp focus',
  tracking: 'side tracking shot following the character in motion',
  lowangle: 'heroic low-angle shot looking up at the character',
  'two-shot': 'two-shot with both characters facing each other',
  title: 'beautiful wide establishing shot of the location, cinematic composition with space for a title',
};
const TIME_LIGHT = { dawn: 'soft golden morning light', day: 'bright natural daylight', sunset: 'warm golden-hour sunset light with long shadows', night: 'night scene with moonlight and glowing practical lights' };

export class CinematicRenderer {
  constructor({ key, videoModel, aspect = '16:9', styleImage = null, base }) {
    if (!key) throw new Error('Add your fal.ai API key under Film settings to use Cinematic AI.');
    this.fal = new FalClient(key, { base });
    this.videoModel = VIDEO[videoModel] ? videoModel : Object.keys(VIDEO)[0];
    this.aspect = aspect;
    this.styleImage = styleImage;
  }

  // ---- 1. director ------------------------------------------------------------------
  async direct(text, rulePlan, onMsg = () => {}) {
    onMsg('AI director is reading your story');
    const skeleton = {
      title: rulePlan.title,
      cast: rulePlan.cast.map((c) => ({ id: c.id, name: c.name, noun: c.noun, kind: c.kind, gender: c.gender, age: c.age, role: c.role, accessories: c.accessories })),
      scenes: rulePlan.scenes.map((s, i) => ({ i, text: s.text, setting: s.setting, time: s.time, weather: s.weather, characters: s.characters, focus: s.focus, lines: s.lines, mood: s.mood, shot: s.shot })),
    };
    const system = `You are the director of a Pixar-quality 3D animated short. You receive a story and a draft shot plan (JSON). Return ONLY a JSON object, no prose, with this shape:
{"title": string,
 "cast": [{"id": string, "name": string|null, "kind": "human"|animal kind|"robot"|..., "gender": "f"|"m"|"n", "age": "child"|"teen"|"adult"|"old", "role": string|null,
           "look": "one detailed sentence describing the character's appearance for an artist: age, skin tone, face shape, eye color, hair color and exact hairstyle, outfit with colors and fabrics, accessories"}],
 "scenes": [{"i": number, "setting": string, "time": "dawn"|"day"|"sunset"|"night", "weather": "clear"|"rain"|"snow"|"storm"|"fog"|"rainbow",
             "characters": [ids], "focus": id|null, "lines": [{"speaker": "narrator"|id, "text": string}], "mood": string,
             "shot": "establishing"|"wide"|"medium"|"closeup"|"over-shoulder"|"tracking"|"lowangle"|"two-shot",
             "visual": "a rich, specific image prompt for this shot: who is where, doing what, facial expressions, props, environment details, lighting",
             "motion": "what moves during the shot: body motion, gestures, camera move (one sentence)"}]}
Rules: keep exactly one scene per input scene, same order and "i". Keep line texts exactly as given (you may only fix wrong speakers). Keep existing cast ids; add a cast member only if the story clearly has someone missing (id "c" + next number). Make every character's look vivid, specific and consistent; respect anything the story says about them. Settings can be anything the story implies (e.g. "small brick church with stained glass").`;
    let enriched = null;
    try {
      const res = await this.fal.run(LLM_EP, { model: LLM_MODEL, system_prompt: system, prompt: `STORY:\n${text}\n\nDRAFT PLAN:\n${JSON.stringify(skeleton)}`, temperature: 0.6, max_tokens: 8000 }, { pollMs: 1200 });
      const out = res.output || '';
      const json = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
      enriched = JSON.parse(json);
    } catch (e) {
      console.warn('AI director unavailable, using the built-in reading', e);
      if (e.status === 401 || e.status === 403) throw e;
      onMsg('Using the built-in story reading');
    }
    return mergePlan(rulePlan, enriched);
  }

  estimate(tl) {
    const v = VIDEO[this.videoModel];
    const shots = tl.shots.length;
    const secs = tl.shots.reduce((n, s) => n + parseFloat(v.dur(s.end - s.start)), 0);
    const castN = tl.cast.filter((c) => tl.shots.some((s) => s.ids.includes(c.id))).length;
    return { shots, usd: (castN + shots) * IMG_PRICE + secs * v.price + 0.05 };
  }

  // ---- 2–4. paint + animate ------------------------------------------------------------
  async render(tl, onProgress = () => {}, confirmCost = async () => true) {
    const est = this.estimate(tl);
    if (!(await confirmCost(est))) throw new DOMException('Cancelled', 'AbortError');
    const aspect = this.aspect;
    const castInShots = tl.cast.filter((c) => tl.shots.some((s) => s.ids.includes(c.id)));
    const total = castInShots.length + tl.shots.length * 2;
    let done = 0;
    const tick = (msg) => onProgress(++done / total, msg);

    // character reference sheets
    const sheets = new Map();
    await pool(castInShots, 3, async (c) => {
      const prompt = `${STYLE} Character design reference sheet of ${c.name || 'the ' + (c.noun || c.kind)}: ${c.look || describe(c)}. Full body, standing in a relaxed pose, facing the camera, friendly natural expression, plain soft gradient studio background, even soft lighting. No text.`;
      const res = this.styleImage
        ? await this.fal.run(EDIT_EP, { prompt: prompt + ' Match the 3D rendering style, materials and lighting quality of the reference image exactly, but design this new character.', image_urls: [this.styleImage], aspect_ratio: '3:4', resolution: '1K', output_format: 'jpeg' })
        : await this.fal.run(IMAGE_EP, { prompt, aspect_ratio: '3:4', resolution: '1K', output_format: 'jpeg' });
      sheets.set(c.id, res.images[0].url);
      tick(`Designing ${c.name || c.noun || 'characters'}`);
    });

    // keyframes
    const frames = await pool(tl.shots, 3, async (s) => {
      const ids = s.ids.slice(0, 4);
      const refs = ids.map((id) => sheets.get(id)).filter(Boolean);
      const cast = ids.map((id, k) => { const c = tl.cast.find((x) => x.id === id); return `reference image ${k + 1} is ${c.name || 'the ' + (c.noun || c.kind)}`; }).join('; ');
      const prompt = shotPrompt(s, tl) + (refs.length ? ` Keep each character's face, hair, body and outfit exactly as in the reference images (${cast}).` : '') + (this.styleImage ? ' Match the rendering style of the last reference image.' : '');
      const urls = [...refs, ...(this.styleImage ? [this.styleImage] : [])];
      const res = urls.length
        ? await this.fal.run(EDIT_EP, { prompt, image_urls: urls, aspect_ratio: aspect, resolution: '1K', output_format: 'jpeg' })
        : await this.fal.run(IMAGE_EP, { prompt, aspect_ratio: aspect, resolution: '1K', output_format: 'jpeg' });
      tick('Painting shots');
      return res.images[0].url;
    });

    // animation
    const vm = VIDEO[this.videoModel];
    const clips = await pool(tl.shots, 3, async (s, i) => {
      const input = { prompt: motionPrompt(s, tl), [vm.image]: frames[i], duration: vm.dur(s.end - s.start), generate_audio: false, negative_prompt: NEGATIVE };
      if (vm.aspect) input.aspect_ratio = aspect === '9:16' ? '9:16' : '16:9';
      try {
        const res = await this.fal.run(this.videoModel, input, { pollMs: 4000 });
        const blob = await (await fetch(res.video.url)).blob();
        tick('Animating shots');
        return { blob };
      } catch (e) {
        if (e.status === 401 || e.status === 403) throw e;
        console.warn('Shot animation failed; using the still frame', e);
        tick('Animating shots');
        return null;
      }
    });
    const stills = await Promise.all(frames.map(async (u) => loadImage(u)));
    return new AiFilm(tl, tl.shots.map((s, i) => ({ still: stills[i], clip: clips[i] })), aspect);
  }
}

function describe(c) {
  const age = { child: 'young child', teen: 'teenager', adult: 'adult', old: 'elderly' }[c.age] || '';
  if (c.kind !== 'human') return `a cute ${c.kind}${c.accessories?.length ? ' with ' + c.accessories.join(', ') : ''}`;
  return `${age} ${c.gender === 'f' ? 'woman' : c.gender === 'm' ? 'man' : 'person'}${c.role ? ', ' + c.role : ''}${c.accessories?.length ? ', with ' + c.accessories.join(', ') : ''}`;
}

function shotPrompt(s, tl) {
  const sc = s.scene;
  const who = s.ids.map((id) => { const c = tl.cast.find((x) => x.id === id); return `${c.name || 'the ' + (c.noun || c.kind)} (${c.look || describe(c)})`; }).join('; ');
  const framing = FRAMING[s.kind === 'title' ? 'title' : s.type] || FRAMING.medium;
  return `${STYLE} ${sc.visual || sc.text} Location: ${sc.settingText || sc.setting}, ${TIME_LIGHT[sc.time] || ''}${sc.weather && sc.weather !== 'clear' ? ', ' + sc.weather : ''}. Camera: ${framing}. ${who ? 'Characters: ' + who + '.' : ''} No text or lettering in the image.`;
}

function motionPrompt(s, tl) {
  const sc = s.scene;
  const talkers = [...new Set(s.lines.filter((l) => l.speaker !== 'narrator').map((l) => l.speaker))]
    .map((id) => tl.cast.find((c) => c.id === id)).filter(Boolean).map((c) => c.name || 'the ' + (c.noun || c.kind));
  const talk = talkers.length ? ` ${talkers.join(' and ')} ${talkers.length > 1 ? 'talk' : 'talks'} expressively with natural mouth movement.` : '';
  return `${sc.motion || 'Gentle natural motion, characters breathe and blink, subtle camera push-in.'}${talk} Pixar-style 3D animation, consistent characters, smooth cinematic camera, no text.`;
}

function mergePlan(rule, ai) {
  if (!ai || !Array.isArray(ai.scenes)) return rule;
  const plan = { ...rule, title: ai.title || rule.title, cast: rule.cast.map((c) => ({ ...c })), scenes: rule.scenes.map((s) => ({ ...s })), source: 'ai' };
  const byId = new Map(plan.cast.map((c) => [c.id, c]));
  for (const c of ai.cast || []) {
    const ex = byId.get(c.id);
    if (ex) { Object.assign(ex, { look: c.look, name: ex.name || c.name, gender: c.gender || ex.gender, age: c.age || ex.age }); }
    else if (c.id && c.look) { const n = { id: c.id, name: c.name || null, noun: null, kind: c.kind || 'human', gender: c.gender || 'n', age: c.age || 'adult', role: c.role || null, accessories: [], traits: [], hair: {}, size: 1, seed: c.id.length * 997, look: c.look }; plan.cast.push(n); byId.set(n.id, n); }
  }
  for (const a of ai.scenes) {
    const s = plan.scenes[a.i];
    if (!s) continue;
    if (a.visual) s.visual = a.visual;
    if (a.motion) s.motion = a.motion;
    if (a.setting) s.settingText = a.setting;
    if (['dawn', 'day', 'sunset', 'night'].includes(a.time)) s.time = a.time;
    if (a.shot) s.shot = a.shot;
    if (a.mood) s.mood = a.mood;
    if (Array.isArray(a.characters)) s.characters = a.characters.filter((id) => byId.has(id));
    if (a.focus && byId.has(a.focus)) s.focus = a.focus;
    if (Array.isArray(a.lines) && a.lines.length === s.lines.length) {
      s.lines = s.lines.map((l, k) => ({ ...l, speaker: a.lines[k].speaker === 'narrator' || byId.has(a.lines[k].speaker) ? a.lines[k].speaker : l.speaker }));
      for (const l of s.lines) if (l.speaker !== 'narrator' && !s.characters.includes(l.speaker)) s.characters.push(l.speaker);
    }
  }
  return plan;
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ---- playback & export ------------------------------------------------------------------
// Same interface the player/compositor/exporter use for the 3D Film.
export class AiFilm {
  constructor(tl, media, aspect) {
    this.tl = tl;
    this.media = media;
    this.aspect = aspect;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280; this.canvas.height = 720;
    this.ctx = this.canvas.getContext('2d');
    this.envelopes = new Map();
    this.talkOverride = null;
    this.playing = false;
    for (const old of document.querySelectorAll('video.sr-clip')) { URL.revokeObjectURL(old.src); old.remove(); }  // the last film's clips
    this.videos = media.map((m) => {
      if (!m.clip) return null;
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
      v.src = URL.createObjectURL(m.clip.blob);
      // phones (iPhone Safari especially) only play and decode videos that are in the page
      v.className = 'sr-clip';
      v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
      document.body.appendChild(v);
      v.load();
      return v;
    });
    this.sinks = null;
    this.current = -1;
  }

  setPlaying(p) {
    this.playing = p;
    const v = this.videos[this.current];
    if (v) p ? v.play().catch(() => {}) : v.pause();
  }

  shotAt(t) {
    const shots = this.tl.shots;
    for (let i = shots.length - 1; i >= 0; i--) if (t >= shots[i].start) return { shot: shots[i], index: i };
    return { shot: shots[0], index: 0 };
  }
  lineAt(t) { const { shot } = this.shotAt(t); return shot.lines.find((l) => t >= l.start && t <= l.end + 0.15) || null; }

  // Map shot-local time onto the clip, stretching slightly when lengths differ.
  clipTime(shot, local, clipDur) {
    const len = shot.end - shot.start;
    const rate = clamp(clipDur / len, 0.65, 1.5);
    return Math.min(clipDur - 0.04, local * rate);
  }

  fade(t, shot, index) {
    let f = 0;
    if (t < 0.8) f = 1 - t / 0.8;
    const next = this.tl.shots[index + 1];
    const changes = (a, b) => a && b && a.scene.setting !== b.scene.setting;
    if (changes(shot, next) && shot.end - t < 0.45) f = Math.max(f, 1 - (shot.end - t) / 0.45);
    if (changes(this.tl.shots[index - 1], shot) && t - shot.start < 0.45) f = Math.max(f, 1 - (t - shot.start) / 0.45);
    if (t > this.tl.endCard.start - 0.6) f = Math.max(f, clamp((t - (this.tl.endCard.start - 0.6)) / 0.9));
    return f;
  }

  drawCover(src, sw, sh, zoom = 1) {
    const { width: W, height: H } = this.canvas;
    const k = Math.max(W / sw, H / sh) * zoom;
    const w = sw * k, h = sh * k;
    this.ctx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
  }

  renderAt(t) {
    t = clamp(t, 0, this.tl.duration);
    const { shot, index } = this.shotAt(Math.min(t, this.tl.endCard.start - 1e-3));
    const local = t - shot.start;
    const m = this.media[index];
    const v = this.videos[index];
    if (index !== this.current) {
      const old = this.videos[this.current];
      if (old) old.pause();
      this.current = index;
    }
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (v && v.readyState >= 2 && v.duration) {
      const want = this.clipTime(shot, local, v.duration);
      v.playbackRate = clamp(v.duration / (shot.end - shot.start), 0.65, 1.5);
      if (!this.playing || Math.abs(v.currentTime - want) > 0.25) v.currentTime = want;
      if (this.playing && v.paused) v.play().catch(() => {});
      this.drawCover(v, v.videoWidth, v.videoHeight);
    } else if (m.still) {
      const u = clamp(local / (shot.end - shot.start));
      this.drawCover(m.still, m.still.naturalWidth, m.still.naturalHeight, 1 + 0.07 * u);
    }
    this.applyFade(this.fade(t, shot, index));
    return { shot, index };
  }

  applyFade(f) {
    if (f <= 0) return;
    this.ctx.fillStyle = `rgba(0,0,0,${f})`;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  async prepareExport(W, H) {
    this.canvas.width = W; this.canvas.height = H;
    this.sinks = await Promise.all(this.media.map(async (m) => {
      if (!m.clip) return null;
      const input = new Input({ source: new BlobSource(m.clip.blob), formats: ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (!track) return null;
      const dur = await input.computeDuration();
      return { sink: new CanvasSink(track, { poolSize: 2 }), dur };
    }));
  }

  // Frame-accurate drawing for export (decodes the exact frame).
  async renderAtExact(t) {
    t = clamp(t, 0, this.tl.duration);
    const { shot, index } = this.shotAt(Math.min(t, this.tl.endCard.start - 1e-3));
    const local = t - shot.start;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const s = this.sinks && this.sinks[index];
    const m = this.media[index];
    let drawn = false;
    if (s) {
      const wc = await s.sink.getCanvas(this.clipTime(shot, local, s.dur));
      if (wc) { this.drawCover(wc.canvas, wc.canvas.width, wc.canvas.height); drawn = true; }
    }
    if (!drawn && m.still) {
      const u = clamp(local / (shot.end - shot.start));
      this.drawCover(m.still, m.still.naturalWidth, m.still.naturalHeight, 1 + 0.07 * u);
    }
    this.applyFade(this.fade(t, shot, index));
  }
}

export { lineKey, smoothstep };
