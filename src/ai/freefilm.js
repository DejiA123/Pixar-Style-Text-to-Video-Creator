// Free online AI film: every shot is painted by a free public image model
// (Pollinations, no key, works on any phone), and — when the viewer's free
// Hugging Face quota allows — animated into a real AI video clip by the public
// LTX-Video Space. Shots that can't be animated play as the painted still with
// slow camera drift. Playback/export reuse AiFilm from the cinematic renderer.
import { AiFilm } from './cinematic.js';

const IMG = 'https://image.pollinations.ai/prompt/';
const GRADIO = 'https://cdn.jsdelivr.net/npm/@gradio/client@2.5.0/dist/browser.js';
const LTX_SPACE = 'Lightricks/ltx-video-distilled';
const STYLE = 'hyper realistic 3d pixar disney animation style, appealing cartoon characters with big expressive eyes, soft skin, detailed hair, rich fabric, cinematic lighting, shallow depth of field, 4k render';

const FRAMING = {
  establishing: 'wide establishing shot', wide: 'wide shot, full body', medium: 'medium shot, waist up',
  closeup: 'close-up portrait', 'over-shoulder': 'over the shoulder shot', tracking: 'side tracking shot',
  lowangle: 'low angle shot', 'two-shot': 'two characters facing each other', title: 'beautiful wide establishing shot, no people',
};
const PLACE = { home: 'cozy bedroom', church: 'church interior with wooden pews and stained glass windows', city: 'city street', school: 'school classroom', meadow: 'sunny park', forest: 'forest', beach: 'beach', market: 'busy outdoor market', village: 'village', space: 'outer space', farm: 'farm', castle: 'castle', stage: 'stage', hospital: 'hospital', underwater: 'underwater coral reef' };
const LIGHT = { dawn: 'soft morning light', day: 'bright daylight', sunset: 'golden hour sunset', night: 'night, glowing warm lights' };
const ACT = { pray: 'praying with eyes closed', groom: 'brushing her hair in a mirror', dance: 'dancing', walk: 'walking', run: 'running', cry: 'crying', laugh: 'laughing', sing: 'singing', cook: 'cooking', eat: 'eating', read: 'reading', play: 'playing', wave: 'waving', hug: 'hugging', sit: 'sitting', talk: 'talking', cheer: 'cheering', jump: 'jumping', fly: 'flying', sleep: 'sleeping' };

function person(c) {
  if (c.kind !== 'human') return `a cute cartoon ${c.noun || c.kind}`;
  const who = { child: c.gender === 'f' ? 'little girl' : 'little boy', teen: c.gender === 'f' ? 'teenage girl' : 'teenage boy', old: c.gender === 'f' ? 'grandmother' : 'grandfather' }[c.age] || (c.gender === 'f' ? 'young woman' : 'young man');
  const tone = { dark: 'black', brown: 'brown-skinned', tan: 'latino', 'light-warm': 'asian', light: 'fair-skinned' }[c.skinTone] || '';
  const hair = c.hair?.style ? `${c.hair.style} hair` : '';
  const acc = (c.accessories || []).join(', ');
  return [tone, c.role && c.role !== 'student' ? c.role : who, hair && `with ${hair}`, acc && `wearing ${acc}`, c.style === 'glam' ? 'glamorous fashion doll look' : ''].filter(Boolean).join(' ');
}

export function freeShotPrompt(shot, castById) {
  const sc = shot.scene;
  const ids = shot.kind === 'title' ? [] : (shot.ids || sc.characters || []).slice(0, 3);
  const who = ids.map((id) => castById.get(id)).filter(Boolean).map((c) => `${person(c)}${sc.actions?.[c.id] && ACT[sc.actions[c.id]] ? ' ' + ACT[sc.actions[c.id]] : ''}`).join(' and ');
  const frame = FRAMING[shot.kind === 'title' ? 'title' : shot.type] || FRAMING.medium;
  return [frame, who, `in a ${PLACE[sc.setting] || sc.setting}`, LIGHT[sc.time] || '', STYLE, 'no text'].filter(Boolean).join(', ').slice(0, 900);
}

function sizeFor(aspect) {
  if (aspect === '9:16') return { w: 576, h: 1024 };
  if (aspect === '1:1') return { w: 832, h: 832 };
  return { w: 1024, h: 576 };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One free image; retries politely when the free tier asks us to slow down.
async function paintFree(prompt, { w, h, seed }, signal) {
  const url = `${IMG}${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true&enhance=false`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const sig = AbortSignal.any ? AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])]) : signal;
    const res = await fetch(url, { signal: sig }).catch((e) => ({ ok: false, status: 0, err: e }));
    if (res.ok && (res.headers.get('content-type') || '').startsWith('image/')) {
      const blob = await res.blob();
      const img = await createImageBitmap(blob);
      return { img, blob };
    }
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    const wait = +(res.headers?.get?.('retry-after') || 0) * 1000 || 4000 * (attempt + 1);
    await sleep(Math.min(30000, wait));
  }
  throw new Error('The free image service is busy right now — try again in a minute.');
}

// Animate a painted still with the public LTX-Video Space. Returns a Blob or null.
async function animateFree(client, blob, prompt, shot, size, handle_file) {
  const dur = Math.max(2, Math.min(5, shot.end - shot.start));
  const res = await client.predict('/image_to_video', {
    prompt, negative_prompt: 'worst quality, inconsistent motion, blurry, jittery, distorted, text',
    input_image_filepath: handle_file(blob), input_video_filepath: null,
    height_ui: Math.min(768, Math.round(size.h * 0.75 / 32) * 32), width_ui: Math.min(768, Math.round(size.w * 0.75 / 32) * 32),
    mode: 'image-to-video', duration_ui: dur, ui_frames_to_use: 9, seed_ui: 7, randomize_seed: false, ui_guidance_scale: 1, improve_texture_flag: true,
  });
  const out = res.data?.[0];
  const url = out?.video?.url || out?.url || (typeof out === 'string' ? out : null);
  if (!url) return null;
  return (await fetch(url)).blob();
}

export async function renderFreeFilm(tl, { aspect = '16:9', hfToken = '', animate = true, onProgress = () => {}, signal } = {}) {
  const castById = new Map(tl.cast.map((c) => [c.id, c]));
  const size = sizeFor(aspect);
  const shots = tl.shots;
  const media = shots.map(() => ({ still: null, clip: null }));
  const total = shots.length * (animate ? 2 : 1);
  let done = 0;
  // the same seed for a scene keeps its look (and its people) steadier across shots
  const seedOf = (s) => 1000 + ([...(s.scene.text || '')].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % 90000);
  const blobs = [];
  for (let i = 0; i < shots.length; i++) {
    const { img, blob } = await paintFree(freeShotPrompt(shots[i], castById), { ...size, seed: seedOf(shots[i]) }, signal);
    media[i].still = await toImage(img);
    blobs[i] = blob;
    onProgress(++done / total, `Painting shot ${i + 1} of ${shots.length} with free AI`);
  }
  if (animate) {
    let client = null, handle_file = null, quotaLeft = true, reason = '';
    try {
      const mod = await import(/* @vite-ignore */ GRADIO);
      handle_file = mod.handle_file;
      client = await mod.Client.connect(LTX_SPACE, hfToken ? { hf_token: hfToken } : {});
    } catch (e) { quotaLeft = false; reason = 'the free video server is unavailable'; console.warn(e); }
    for (let i = 0; i < shots.length; i++) {
      if (quotaLeft && shots[i].kind !== 'title') {
        try {
          const vb = await animateFree(client, blobs[i], `${freeShotPrompt(shots[i], castById)}, gentle natural motion, characters breathe, blink and move`, shots[i], size, handle_file);
          if (vb) media[i].clip = { blob: vb };
        } catch (e) {
          const msg = String(e?.message || e);
          console.warn('Free animation failed', msg);
          if (/quota|exceeded|GPU|token/i.test(msg)) { quotaLeft = false; reason = 'today’s free video quota is used up'; }
        }
      }
      onProgress(++done / total, quotaLeft ? `Animating shot ${i + 1} of ${shots.length} with free AI video` : `Finishing shots (${reason})`);
    }
    if (!quotaLeft) media.reason = reason;
  }
  const film = new AiFilm(tl, media, aspect);
  const W = aspect === '9:16' ? 720 : aspect === '1:1' ? 1024 : 1280, H = aspect === '9:16' ? 1280 : aspect === '1:1' ? 1024 : 720;
  film.canvas.width = W; film.canvas.height = H;
  film.animatedCount = media.filter((m) => m.clip).length;
  film.reason = media.reason || '';
  return film;
}

async function toImage(bitmap) {
  // AiFilm draws `still` with naturalWidth/naturalHeight
  const c = document.createElement('canvas');
  c.width = bitmap.width; c.height = bitmap.height;
  c.getContext('2d').drawImage(bitmap, 0, 0);
  c.naturalWidth = c.width; c.naturalHeight = c.height;
  return c;
}
