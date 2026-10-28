// Free online AI film: every shot is painted by a free public image model
// (Pollinations, no key, works on any phone), and — when the viewer's free
// Hugging Face quota allows — animated into a real AI video clip by the public
// LTX-Video Space. Shots that can't be animated play as the painted still with
// slow camera drift. Playback/export reuse AiFilm from the cinematic renderer.
import { LivingFilm } from './living.js';
import { shotSpeech, lipsyncClip, blobToDataUrl } from './servervoice.js';
import { waitForServer } from './aiserver.js';

const IMG = 'https://image.pollinations.ai/prompt/';
const GRADIO = 'https://cdn.jsdelivr.net/npm/@gradio/client@2.5.0/dist/browser.js';
const LTX_SPACE = 'Lightricks/ltx-video-distilled';
const FLUX_SPACE = 'black-forest-labs/FLUX.1-schnell';
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

// what the story says happens here, in its own words ("a young guy begins to play the drums")
function storyWords(sc) {
  const t = (sc.text || '').replace(/"[^"]*"/g, ' ').replace(/[.!?]+\s*$/, '').replace(/\s+/g, ' ').trim();
  const words = t.split(' ');
  return words.length >= 3 ? words.slice(0, 22).join(' ') : '';
}
const PROP_LOOK = { drum: 'playing a drum kit', guitar: 'playing a guitar', piano: 'playing a piano', microphone: 'holding a microphone', bible: 'holding a bible' };
function propWords(sc) {
  const extra = /\bpreach/i.test(sc.text || '') ? ['preaching passionately at a church pulpit'] : [];
  return [...new Set([...extra, ...(sc.props || []).map((p) => PROP_LOOK[p.type] || `with a ${p.type}`)])].slice(0, 2).join(', ');
}

export function freeShotPrompt(shot, castById) {
  const sc = shot.scene;
  const ids = shot.kind === 'title' ? [] : (shot.ids || sc.characters || []).slice(0, 3);
  const who = ids.map((id) => castById.get(id)).filter(Boolean).map((c) => `${person(c)}${sc.actions?.[c.id] && ACT[sc.actions[c.id]] ? ' ' + ACT[sc.actions[c.id]] : ''}`).join(' and ');
  const frame = FRAMING[shot.kind === 'title' ? 'title' : shot.type] || FRAMING.medium;
  const story = shot.kind === 'title' ? '' : storyWords(sc);
  const props = shot.kind === 'title' ? '' : propWords(sc);
  // the picture model reads about 75 words: what happens comes before the style details
  return [frame, who, props, story, 'pixar 3d animation', `in a ${PLACE[sc.setting] || sc.setting}`, LIGHT[sc.time] || '', STYLE, 'no text'].filter(Boolean).join(', ').slice(0, 900);
}

// What moves in an AI video shot: each character's whole-body action, the
// background and the camera. Video models move as much as the prompt asks.
const MOTION = {
  walk: 'walks forward with natural strides, arms swinging, hair and clothes moving with each step',
  run: 'runs fast, arms pumping, hair flying', dance: 'dances with full body movement, spinning and swaying',
  wave: 'raises an arm and waves happily', talk: 'talks with lively expressions, mouth moving, hands gesturing',
  sit: 'sits, leans forward and gestures while talking', hug: 'steps forward and hugs warmly',
  pray: 'bows the head in prayer, then slowly looks up', groom: 'brushes her hair with long strokes, turning her head',
  cry: 'sobs, shoulders shaking, wiping tears', laugh: 'laughs, head tilting back, shoulders shaking',
  sing: 'sings with feeling, mouth moving, swaying to the music', cook: 'stirs a pot and moves around the kitchen',
  eat: 'eats and chews, reaching for food', read: 'reads, turning a page, eyes moving', play: 'plays energetically, moving around',
  cheer: 'cheers, jumping with arms raised', jump: 'jumps up and lands', fly: 'flies through the air', sleep: 'sleeps, chest rising and falling',
};
const SCENE_MOTION = {
  city: 'cars and people pass in the background, lights flicker', forest: 'leaves and branches sway in the wind, sunlight flickers',
  meadow: 'grass and trees sway in the breeze, birds fly past', beach: 'waves roll onto the shore, palm trees sway',
  church: 'candles flicker, people in the pews move', home: 'curtains sway gently, light shifts', school: 'classmates move in the background',
  market: 'busy crowd moves between the stalls', village: 'people walk by, smoke drifts', space: 'stars drift, planets slowly turn',
  farm: 'animals move, crops sway in the wind', castle: 'flags flutter, torches flicker', stage: 'stage lights sweep, the crowd moves',
  hospital: 'staff walk past in the background', underwater: 'fish swim by, seaweed sways, bubbles rise',
};
const CAMERA = {
  establishing: 'the camera glides slowly forward', title: 'the camera glides slowly forward', wide: 'the camera slowly dollies in',
  medium: 'the camera moves slightly', closeup: 'the camera slowly pushes in', 'over-shoulder': 'the camera drifts over the shoulder',
  tracking: 'the camera tracks alongside', lowangle: 'the camera slowly tilts up', 'two-shot': 'the camera slowly arcs around them',
};
export function motionPrompt(shot, castById) {
  const sc = shot.scene;
  const ids = shot.kind === 'title' ? [] : (shot.ids || sc.characters || []).slice(0, 3);
  const speaking = new Set((shot.lines || []).map((l) => l.speaker));
  const people = ids.map((id) => {
    const c = castById.get(id);
    if (!c) return '';
    const a = sc.actions?.[id];
    const act = MOTION[a] || (speaking.has(id) ? MOTION.talk : 'moves naturally, turning the head and gesturing with the hands');
    return `the ${c.kind === 'human' ? person(c) : c.noun || c.kind} ${act}`;
  }).filter(Boolean);
  const bg = SCENE_MOTION[sc.setting] || 'the background is alive with movement';
  const cam = CAMERA[shot.kind === 'title' ? 'title' : shot.type] || CAMERA.medium;
  const story = shot.kind === 'title' ? '' : storyWords(sc);
  return [story, people.join(', while '), bg, cam, 'smooth realistic motion, everything moves, not a still image'].filter(Boolean).join('; ');
}

// A note is read by the picture model, which follows descriptions, not questions:
// "where is the drum kit?" → "the drum kit clearly visible"; "add a dog" → "a dog".
export function noteToPrompt(note) {
  let n = (note || '').trim().replace(/\s+/g, ' ');
  const where = n.match(/^(?:where(?:'s| is| are)|i (?:can't|cannot|don't) see|show(?: me)?|add|include|put in)\s+(.+?)[?.!]*$/i);
  if (where) return `${where[1].replace(/^(?:the|a|an)\s+/i, (d) => d.toLowerCase())} clearly visible`;
  return n.replace(/[?]+$/, '');
}

function sizeFor(aspect) {
  if (aspect === '9:16') return { w: 576, h: 1024 };
  if (aspect === '1:1') return { w: 832, h: 832 };
  return { w: 1024, h: 576 };
}

const sleep = (ms, signal) => new Promise((r, j) => {
  const t = setTimeout(r, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); j(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

// One free image; retries politely when the free tier asks us to slow down.
async function paintFree(prompt, { w, h, seed }, signal, onWait, maxWaitMs = 75000) {
  const t0 = Date.now();
  const url = `${IMG}${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true&enhance=false`;
  for (let attempt = 0; attempt < 18; attempt++) {
    const sig = AbortSignal.any ? AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])]) : signal;
    const res = await fetch(url, { signal: sig }).catch((e) => ({ ok: false, status: 0, err: e }));
    if (res.ok && (res.headers.get('content-type') || '').startsWith('image/')) {
      const blob = await res.blob();
      const img = await createImageBitmap(blob);
      return { img, blob };
    }
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    if (Date.now() - t0 > maxWaitMs) break;
    // the free tier answers "busy, retry in ~10 s" when it's crowded
    const wait = +(res.headers?.get?.('retry-after') || 0) * 1000 || 9000 + Math.random() * 4000;
    onWait?.(attempt + 1);
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

// ---- your AI server (a pod/PC link or a RunPod Serverless endpoint; see aiserver.js) ----
async function serverImage(server, prompt, { w, h, seed }, signal) {
  const blob = await server.image({ prompt, width: w, height: h, seed }, signal);
  return { img: await createImageBitmap(blob), blob };
}
async function serverVideo(server, blob, prompt, shot, size, signal) {
  return server.video({ prompt, image: await blobToDataUrl(blob), width: Math.round(size.w * 0.75), height: Math.round(size.h * 0.75),
    seconds: Math.max(2, Math.min(10, shot.end - shot.start)), seed: 7 }, signal);
}

// Second free image source: the public FLUX.1-schnell Space (Hugging Face free GPU quota).
async function fluxImage(gr, prompt, { w, h, seed }) {
  const res = await gr.flux.predict('/infer', { prompt, seed, randomize_seed: false, width: Math.round(w / 64) * 64, height: Math.round(h / 64) * 64, num_inference_steps: 4 });
  const out = res.data?.[0];
  const url = out?.url || (typeof out === 'string' ? out : null);
  if (!url) throw new Error('FLUX returned nothing');
  const blob = await (await fetch(url)).blob();
  return { img: await createImageBitmap(blob), blob };
}

// Never-stop chain for every shot:
//   image: your AI server → free online AI → on-device AI painter / 3D frame (fallbackStill)
//   video: your AI server (unlimited) → free online AI video (daily quota) → moving painting
// server: your AI server client (aiserver.js) or null; voice: {clips, voices} of the
// film's dialogue, for lip sync on your server.
// review({shots, blobs, notes, repaint}): called once every shot is painted and before
// anything is animated; the film continues when it resolves (repaint(i, note) redraws a shot).
export async function renderFreeFilm(tl, { aspect = '16:9', hfToken = '', animate = true, server = null, fallbackStill = null, voice = null, review = null, onShot = () => {}, onProgress = () => {}, signal } = {}) {
  const castById = new Map(tl.cast.map((c) => [c.id, c]));
  const size = sizeFor(aspect);
  const shots = tl.shots;
  const media = shots.map(() => ({ still: null, clip: null }));
  const total = shots.length * (animate ? 2 : 1);
  let done = 0;
  const srv = server;
  let health = srv ? await srv.health() : null;
  if (health?.ok === false) health = null;  // e.g. a serverless endpoint without its API key
  if (health) health = await waitForServer(srv, health, onProgress, signal);
  const useSrv = !!(health && health.image);
  const usedBefore = useSrv ? await srv.usage() : null;
  console.log('[storyreel] AI server', srv?.label || '(none)', health ? 'connected' : 'not reachable');
  const srvVideo = !!(health && health.video);
  const seedOf = (s) => 1000 + ([...(s.scene.text || '')].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % 90000);
  const blobs = [];
  const sources = { server: 0, online: 0, flux: 0, device: 0 };
  // gradio client (for FLUX images and LTX video) loads once, lazily
  const gr = { mod: null, flux: null, fluxDown: false };
  const gradio = async () => (gr.mod ||= await import(/* @vite-ignore */ GRADIO));
  const tryFlux = async (prompt, opts) => {
    if (gr.fluxDown) return null;
    try {
      if (!gr.flux) gr.flux = await (await gradio()).Client.connect(FLUX_SPACE, hfToken ? { hf_token: hfToken } : {});
      const r = await fluxImage(gr, prompt, opts); sources.flux++; return r;
    } catch (e) { console.warn('FLUX unavailable', e); if (/quota|exceeded/i.test(String(e?.message || e))) gr.fluxDown = true; return null; }
  };
  // AI only, never a 3D frame: try every free AI source in turn
  const notes = shots.map(() => '');  // your changes from the review, first in the prompt so they win
  const paintShot = async (i, waitMs, seed = seedOf(shots[i])) => {
    const prompt = [notes[i], freeShotPrompt(shots[i], castById)].filter(Boolean).join(', ').slice(0, 900);
    const opts = { ...size, seed };
    if (useSrv) { try { const r = await serverImage(srv, prompt, opts, signal); sources.server++; return r; } catch (e) { console.warn(e); } }
    try {
      const r = await paintFree(prompt, opts, signal, (n) => onProgress(done / total, `Painting shot ${i + 1} of ${shots.length} — free AI is busy, waiting (${n})…`), waitMs);
      sources.online++; return r;
    } catch (e) { if (e?.name === 'AbortError') throw e; }
    const f = await tryFlux(prompt, opts);
    if (f) return f;
    if (fallbackStill) {
      onProgress(done / total, `Painting shot ${i + 1} of ${shots.length} with AI on this device`);
      const c = await fallbackStill(i, prompt).catch(() => null);
      if (c) { sources.device++; return { img: c, blob: await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92)) }; }
    }
    return null;
  };
  const place = async (i, r) => { media[i].still = await toImage(r.img); blobs[i] = r.blob; onShot(i, r.blob, 'painted'); };
  for (let i = 0; i < shots.length; i++) {
    const r = await paintShot(i, 75000);
    if (r) await place(i, r);
    onProgress(++done / total, `Painting shot ${i + 1} of ${shots.length}`);
  }
  // second pass for any shot the busy services missed
  for (let i = 0; i < shots.length; i++) if (!blobs[i]) { const r = await paintShot(i, 120000); if (r) await place(i, r); }
  // still nothing at all? keep waiting for a free AI — never fall back to 3D
  for (let tries = 1; !blobs.some(Boolean); tries++) {
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    onProgress(done / total, `All free AI services are busy — retrying (${tries})… you can leave this running`);
    const r = await paintShot(0, 180000);
    if (r) await place(0, r);
  }
  // any remaining gaps reuse the nearest AI-painted shot
  for (let i = 0; i < shots.length; i++) {
    if (media[i].still) continue;
    for (let d = 1; d < shots.length; d++) {
      const j = [i - d, i + d].find((k) => k >= 0 && k < shots.length && blobs[k]);
      if (j != null) { media[i].still = media[j].still; break; }
    }
  }
  if (review) {
    const repaint = async (i, note = '') => {
      notes[i] = noteToPrompt(note);
      const r = await paintShot(i, 75000, 1 + Math.floor(Math.random() * 999999));
      if (r) await place(i, r);
      return r ? blobs[i] : null;
    };
    await review({ shots, blobs, notes, repaint });
  }
  let reason = '';
  let lipsynced = 0;
  if (animate) {
    let client = null, handle_file = null, quotaLeft = !srvVideo;
    if (!srvVideo) {
      try {
        const mod = await gradio();
        handle_file = mod.handle_file;
        client = await mod.Client.connect(LTX_SPACE, hfToken ? { hf_token: hfToken } : {});
      } catch (e) { quotaLeft = false; reason = 'the free video server is unavailable'; console.warn(e); }
    }
    for (let i = 0; i < shots.length; i++) {
      // with your own server every shot is animated, the opening title too
      if (blobs[i] && (srvVideo || shots[i].kind !== 'title')) {
        const mp = [notes[i], `${motionPrompt(shots[i], castById)}. ${freeShotPrompt(shots[i], castById)}`].filter(Boolean).join('. ').slice(0, 1400);
        try {
          if (srvVideo) {
            const blob = await serverVideo(srv, blobs[i], mp, shots[i], size, signal);
            media[i].clip = { blob };
            onShot(i, null, 'animated');
            // lip sync: the on-screen speakers' words, on the clip's clock as the player will show it
            const len = shots[i].end - shots[i].start;
            if (health.lipsync && voice && len <= 11) {
              const clipDur = (Math.floor(Math.max(2, Math.min(10, len)) * 24 / 8) * 8 + 1) / 24;  // as the server makes it
              const wav = shotSpeech(shots[i], voice.clips, voice.voices, clipDur, Math.min(1.5, Math.max(0.65, clipDur / len)));
              if (wav) {
                onProgress(done / total, `Syncing lips in shot ${i + 1} of ${shots.length}`);
                const synced = await lipsyncClip(srv, blob, wav, signal).catch((e) => { if (e?.name === 'AbortError') throw e; return null; });
                if (synced) { media[i].clip = { blob: synced }; lipsynced++; onShot(i, null, 'synced'); }
              }
            }
          }
          else if (quotaLeft) { const vb = await animateFree(client, blobs[i], mp, shots[i], size, handle_file); if (vb) { media[i].clip = { blob: vb }; onShot(i, null, 'animated'); } }
        } catch (e) {
          const msg = String(e?.message || e);
          console.warn('Animation failed', msg);
          if (!srvVideo && /quota|exceeded|GPU|token/i.test(msg)) { quotaLeft = false; reason = 'today’s free video quota is used up'; }
        }
      }
      onProgress(++done / total, srvVideo ? `Animating shot ${i + 1} of ${shots.length} on your AI server` : quotaLeft ? `Animating shot ${i + 1} of ${shots.length} with free AI video` : `Finishing shots as moving paintings`);
    }
  }
  const film = new LivingFilm(tl, media, aspect);
  // shots without an AI video clip come to life on the device: depth parallax,
  // talking mouths, blinking eyes, breathing
  if (media.some((m) => m.still && !m.clip)) {
    try { await film.bringToLife((p, msg) => onProgress(Math.min(0.999, done / total), msg)); } catch (e) { console.warn('motion AI unavailable', e); }
  }
  const W = aspect === '9:16' ? 720 : aspect === '1:1' ? 1024 : 1280, H = aspect === '9:16' ? 1280 : aspect === '1:1' ? 1024 : 720;
  film.canvas.width = W; film.canvas.height = H;
  film.animatedCount = media.filter((m) => m.clip).length;
  film.reason = reason;
  film.sources = sources;
  film.usedServer = useSrv;
  film.lipsynced = lipsynced;
  film.serverDown = !!srv && !health;  // a link is set but nothing answers (pod deleted or stopped)
  // what this film used of your server: GPU busy time and, if the server knows its price, the cost
  if (useSrv && usedBefore != null) {
    const after = await srv.usage();
    if (after != null) {
      film.serverSeconds = after - usedBefore;
      const price = await srv.price();
      film.serverCost = price ? film.serverSeconds / 3600 * price : null;
    }
  }
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
