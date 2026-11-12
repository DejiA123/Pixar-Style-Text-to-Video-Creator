// Free online AI film: every shot is painted by a free public image model
// (Pollinations, no key, works on any phone), and — when the viewer's free
// Hugging Face quota allows — animated into a real AI video clip by the public
// LTX-Video Space. Shots that can't be animated play as the painted still with
// slow camera drift. Playback/export reuse AiFilm from the cinematic renderer.
import { LivingFilm } from './living.js';
import { shotSpeech, lipsyncClip, blobToDataUrl } from './servervoice.js';
import { waitForServer, waitForModel, wakeServer } from './aiserver.js';

const IMG = 'https://image.pollinations.ai/prompt/';
const GRADIO = 'https://cdn.jsdelivr.net/npm/@gradio/client@2.5.0/dist/browser.js';
const LTX_SPACE = 'Lightricks/ltx-video-distilled';
const FLUX_SPACE = 'black-forest-labs/FLUX.1-schnell';
// the film's look: Pixar-style 3D animation, or live action that looks filmed
const STYLE = {
  pixar: 'hyper realistic 3d pixar disney animation style, appealing cartoon characters with big expressive eyes, natural anatomy, two arms and two hands each, soft skin, detailed hair, rich fabric, cinematic lighting, shallow depth of field, 4k render',
  real: 'photorealistic cinematic film still, live action, shot on 35mm film with an anamorphic lens, real people with natural skin texture, realistic proportions and natural anatomy, two arms and two hands each, natural light, soft film grain, shallow depth of field, color graded, 4k',
};
const LOOK_TAG = { pixar: 'pixar 3d animation', real: 'photorealistic live-action movie scene' };

const FRAMING = {
  establishing: 'wide establishing shot', wide: 'wide shot, full body', medium: 'medium shot, waist up',
  closeup: 'close-up portrait', 'over-shoulder': 'over the shoulder shot', tracking: 'side tracking shot',
  lowangle: 'low angle shot', 'two-shot': 'two characters facing each other', title: 'beautiful wide establishing shot, no people',
};
const PLACE = { home: 'cozy bedroom', church: 'church interior with wooden pews and stained glass windows', city: 'city street', school: 'school classroom', meadow: 'sunny park', forest: 'forest', beach: 'beach', market: 'busy outdoor market', village: 'village', space: 'outer space', farm: 'farm', castle: 'castle', stage: 'stage', hospital: 'hospital', underwater: 'underwater coral reef' };
const LIGHT = { dawn: 'soft morning light', day: 'bright daylight', sunset: 'golden hour sunset', night: 'night, glowing warm lights' };
const ACT = { pray: 'praying with eyes closed', groom: 'brushing her hair in a mirror', dance: 'dancing', walk: 'walking', run: 'running', cry: 'crying', laugh: 'laughing', sing: 'singing', cook: 'cooking', eat: 'eating', read: 'reading', play: 'playing', wave: 'waving', hug: 'hugging', sit: 'sitting', talk: 'talking', cheer: 'cheering', jump: 'jumping', fly: 'flying', sleep: 'sleeping' };

// a newborn is carried, held or lying down: never walking, running or dancing with the others
const isBaby = (c) => c?.age === 'baby' || /^(baby|infant|newborn)$/.test(c?.noun || '') || /\b(newborn|infant)\b/i.test(c?.lookText || '');
// Bible stories (Bethlehem, the disciples, the empty tomb): everyone on screen, extras too, in ancient dress
const BIBLE = /\b(Bethlehem|Nazareth|Galilee|Jerusalem|Judea|disciples?|apostles?|Pharaoh|Moses|manger|Pharisees?|garden tomb|Pontius|Herod|Goliath|Noah's ark)\b/i;
// (it says what people wear, not that there are people: "everyone in robes" filled empty places with crowds)
const ERA = 'ancient Israel in Bible times, simple ancient robes, tunics, cloaks and sandals, no modern clothes or objects, no crowd unless described';

function person(c, look = 'pixar') {
  // the AI director's description, fixed once for the whole film, wins: the same person in every shot
  if (c.lookText) return `${c.name || (c.crowd ? `the ${c.noun}s` : `the ${c.noun || c.kind}`)}, ${c.lookText}`;
  if (c.crowd) return `a few ${c.noun}s`;
  if (isBaby(c)) return 'a newborn baby';
  if (c.kind !== 'human') return `${look === 'real' ? 'a real' : 'a cute cartoon'} ${c.noun || c.kind}`;
  const who = { child: c.gender === 'f' ? 'little girl' : 'little boy', teen: c.gender === 'f' ? 'teenage girl' : 'teenage boy', old: c.gender === 'f' ? 'grandmother' : 'grandfather' }[c.age] || (c.gender === 'f' ? 'young woman' : 'young man');
  const tone = { dark: 'black', brown: 'brown-skinned', tan: 'latino', 'light-warm': 'asian', light: 'fair-skinned' }[c.skinTone] || '';
  const hair = c.hair?.style ? `${c.hair.style} hair` : '';
  const acc = (c.accessories || []).join(', ');
  return [tone, c.role && c.role !== 'student' ? c.role : who, hair && `with ${hair}`, acc && `wearing ${acc}`, c.style === 'glam' ? 'glamorous fashion doll look' : ''].filter(Boolean).join(' ');
}

// what happens here: the AI director's shot description, else the story's own words
// ("a young guy begins to play the drums")
function storyWords(sc) {
  if (sc.shotText) return sc.shotText.split(/\s+/).slice(0, 45).join(' ');
  const t = (sc.text || '').replace(/"[^"]*"/g, ' ').replace(/[.!?]+\s*$/, '').replace(/\s+/g, ' ').trim();
  const words = t.split(' ');
  return words.length >= 3 ? words.slice(0, 22).join(' ') : '';
}
const PROP_LOOK = { drum: 'playing a drum kit', guitar: 'playing a guitar', piano: 'playing a piano', microphone: 'holding a microphone', bible: 'holding a bible' };
function propWords(sc) {
  const extra = /\bpreach/i.test(sc.text || '') ? ['preaching passionately at a church pulpit'] : [];
  return [...new Set([...extra, ...(sc.props || []).map((p) => PROP_LOOK[p.type] || `with a ${p.type}`)])].slice(0, 2).join(', ');
}

// "in ancient Rome" when the story names the place; the engine's own setting only when the story chose it
function where(sc) {
  if (sc.place) return `in ${sc.place}`;
  return sc.settingKnown === false ? '' : `in a ${PLACE[sc.setting] || sc.setting}`;
}

const callName = (c) => c.name || (c.crowd ? `the ${c.noun}s` : `the ${c.noun || c.kind}`);
// "over the shoulder" names whose shoulder, so nobody is painted twice (once from behind, once facing us)
function framing(shot, ids, castById) {
  const type = shot.kind === 'title' ? 'title' : shot.type;
  if (type === 'over-shoulder') {
    const focus = ids.includes(shot.focus) ? shot.focus : ids[0];
    const other = ids.find((id) => id !== focus && !isBaby(castById.get(id)));
    if (other && castById.get(focus)) return `over the shoulder of ${callName(castById.get(other))}, looking at ${callName(castById.get(focus))}`;
    return 'medium close-up';
  }
  return FRAMING[type] || FRAMING.medium;
}
const doing = (sc, c) => (isBaby(c) ? 'wrapped in a blanket' : sc.actions?.[c.id] && ACT[sc.actions[c.id]] ? ACT[sc.actions[c.id]] : '');

export function freeShotPrompt(shot, castById, look = 'pixar', era = '') {
  const sc = shot.scene;
  const ids = shot.kind === 'title' ? [] : (shot.ids || sc.characters || []).slice(0, 3);
  const who = ids.map((id) => castById.get(id)).filter(Boolean).map((c) => [person(c, look), doing(sc, c)].filter(Boolean).join(' ')).join(' and ');
  const frame = framing(shot, ids, castById);
  const story = shot.kind === 'title' ? '' : storyWords(sc);
  const props = shot.kind === 'title' ? '' : propWords(sc);
  // the picture model reads about 75 words: what happens comes before the style details
  return [frame, who, props, story, LOOK_TAG[look] || LOOK_TAG.pixar, where(sc), era, LIGHT[sc.time] || '', STYLE[look] || STYLE.pixar, 'no text'].filter(Boolean).join(', ').slice(0, 1000);
}

// What moves in an AI video shot: each character's whole-body action, the
// background and the camera. Video models move as much as the prompt asks, and they
// grow a new arm to do an arm movement the picture's arms aren't in place for
// ("raises one arm", "arms pumping"): actions are told by the body, the face and the
// clothes instead (the picture model already drew the arms where they belong).
const MOTION = {
  walk: 'walks forward with natural strides, hair and clothes moving with each step',
  run: 'runs fast, hair flying', dance: 'dances, swaying and turning to the music',
  wave: 'waves hello with a big smile', talk: 'talks with lively expressions, mouth moving naturally',
  sit: 'sits, leaning forward a little while talking', hug: 'they hold each other in a warm hug, swaying gently',
  pray: 'bows the head in prayer, then slowly looks up', groom: 'brushes her hair with long strokes, turning her head',
  cry: 'sobs, shoulders shaking, tears running down', laugh: 'laughs, head tilting back, shoulders shaking',
  sing: 'sings with feeling, mouth moving, swaying to the music', cook: 'stirs a pot, looking into it',
  eat: 'eats and chews happily', read: 'reads, eyes moving along the page', play: 'plays happily, moving around',
  cheer: 'cheers with joy, bouncing on the spot', jump: 'jumps up and lands', fly: 'flies through the air', sleep: 'sleeps, chest rising and falling',
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
export function motionPrompt(shot, castById, look = 'pixar') {
  const sc = shot.scene;
  const ids = shot.kind === 'title' ? [] : (shot.ids || sc.characters || []).slice(0, 3);
  const speaking = new Set((shot.lines || []).map((l) => l.speaker));
  const people = ids.map((id) => {
    const c = castById.get(id);
    if (!c) return '';
    const a = sc.actions?.[id];
    const act = isBaby(c) ? 'lies wrapped in a blanket, tiny hands moving gently' : MOTION[a] || (speaking.has(id) ? MOTION.talk : 'moves naturally, turning the head, arms relaxed');
    // "Samuel, young man in a leather jacket, walks…" / "the grandmother walks…" / "the dog runs…"
    const who = c.lookText || c.crowd || isBaby(c) ? person(c, look) : `the ${c.kind === 'human' ? person(c, look) : c.noun || c.kind}`;
    return `${who} ${act}`;
  }).filter(Boolean);
  const bg = SCENE_MOTION[sc.setting] || 'the background is alive with movement';
  const cam = CAMERA[shot.kind === 'title' ? 'title' : shot.type] || CAMERA.medium;
  const story = shot.kind === 'title' ? '' : storyWords(sc);
  return [story, people.join(', while '), bg, cam, look === 'real' ? 'live-action cinematic footage, natural human motion, everything moves, not a still image' : 'smooth realistic motion, everything moves, not a still image',
    // video models like to grow things: say what must stay as it is in the picture
    people.length ? 'the same people from start to finish, each with two arms and two hands all the way through, arms and hands keep their shape' : ''].filter(Boolean).join('; ');
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
// A request that fails on the way (a dropped connection, a server busy waking up) gets two more tries;
// if the server has stopped answering (it restarted), the next try waits until it is back (up to 4 minutes).
async function tries(fn, signal, n = 3, srv = null) {
  for (let k = 1; ; k++) {
    try { return await fn(); } catch (e) {
      if (e?.name === 'AbortError' || k >= n) throw e;
      console.warn(`AI server request failed (try ${k} of ${n}), trying again`, e?.message || e);
      await new Promise((r, j) => { const t = setTimeout(r, 2500 * k); signal?.addEventListener('abort', () => { clearTimeout(t); j(new DOMException('Aborted', 'AbortError')); }, { once: true }); });
      if (srv && !(await srv.health(8000))) await wakeServer(srv, { maxMs: 6 * 60000, signal });
    }
  }
}
async function serverImage(server, prompt, { w, h, seed }, signal, refs = []) {
  const blob = await server.image({ prompt, width: w, height: h, seed, ...(refs.length ? { refs } : {}) }, signal);
  return { img: await createImageBitmap(blob), blob };
}
// Best: clips at the picture's full size (sharper faces and hands, better lip sync), as long as the shot (up to 10 s).
// Fast & cheap: 0.6 of the size and at most 6 s (the player stretches longer shots): about half the GPU time.
// seed: the same picture with another seed moves differently (a new take).
const VIDEO = { best: { scale: 1, max: 10 }, fast: { scale: 0.6, max: 6 } };
async function serverVideo(server, blob, prompt, shot, size, signal, speed = 'best', seed = 7) {
  const v = VIDEO[speed] || VIDEO.best;
  return server.video({ prompt, image: await blobToDataUrl(blob), width: Math.round(size.w * v.scale), height: Math.round(size.h * v.scale),
    seconds: Math.max(2, Math.min(v.max, shot.end - shot.start)), seed }, signal);
}

// ---- one shot, from words to a moving picture: shared by a new film and a redone shot ----
const nameOf = (c) => c.name || `the ${c.noun || c.kind}`;
const filmEra = (tl) => (BIBLE.test(tl.shots.map((s) => s.scene.text || '').join(' ')) ? ERA : '');
// your changes (a note from the review or a redo) come first, so they win
const picturePrompt = (shot, castById, look, era, note) => [note, freeShotPrompt(shot, castById, look, era)].filter(Boolean).join(', ').slice(0, 1000);
const shotMotion = (shot, castById, look, era, note) => [note, `${motionPrompt(shot, castById, look)}. ${freeShotPrompt(shot, castById, look, era)}`].filter(Boolean).join('. ').slice(0, 1400);
// the portraits of the people in a shot (up to 3), so their faces stay the same
const refIds = (shot, portraits) => (shot.kind === 'title' ? [] : (shot.ids || shot.scene.characters || [])).filter((id) => portraits.has(id)).slice(0, 3);
// e.g. "Daniel is the person in image 1. Keep exactly the same face, hair and clothes. New picture: …"
const refLead = (ids, castById) => (ids.length ? `${ids.map((id, k) => `${nameOf(castById.get(id))} is the person in image ${k + 1}`).join(', ')}. Keep exactly the same face, hair and clothes. Each person appears only once. New picture: ` : '');
function paintOnServer(srv, shot, castById, portraits, prompt, opts, signal) {
  const ids = refIds(shot, portraits);
  return tries(() => serverImage(srv, (refLead(ids, castById) + prompt).slice(0, 1400), opts, signal, ids.map((id) => portraits.get(id))), signal, 3, srv);
}
// Lip sync only where the face is big enough to see the mouth (wide shots aren't worth the GPU time),
// in Best quality, for shots the server can make in one clip.
const FACE_SHOTS = ['closeup', 'medium', 'over-shoulder', 'two-shot', 'lowangle'];
export const wantsLipsync = (shot, speed, voice) => speed !== 'fast' && !!voice && shot.end - shot.start <= 11 && FACE_SHOTS.includes(shot.type);
// the on-screen speakers' words, on the clip's clock as the player will show it (null: nobody on screen speaks)
function shotWav(shot, voice) {
  const len = shot.end - shot.start;
  const clipDur = (Math.floor(Math.max(2, Math.min(10, len)) * 24 / 8) * 8 + 1) / 24;  // as the server makes it
  return shotSpeech(shot, voice.clips, voice.voices, clipDur, Math.min(1.5, Math.max(0.65, clipDur / len)));
}

// The film itself: shots without an AI video clip come to life on the device (depth parallax,
// talking mouths, blinking eyes, breathing); the frame is drawn at the film's size.
async function finishFilm(tl, media, aspect, onProgress = () => {}) {
  const film = new LivingFilm(tl, media, aspect);
  if (media.some((m) => m.still && !m.clip)) {
    try { await film.bringToLife(onProgress); } catch (e) { console.warn('motion AI unavailable', e); }
  }
  const W = aspect === '9:16' ? 720 : aspect === '1:1' ? 1024 : 1280, H = aspect === '9:16' ? 1280 : aspect === '1:1' ? 1024 : 720;
  film.canvas.width = W; film.canvas.height = H;
  return film;
}

// A film from its saved pictures and clips (My films): media is [{stillBlob, clipBlob}].
export async function filmFromBlobs(tl, media, aspect, onProgress = () => {}) {
  const decoded = new Map();  // shots that share a picture share it here too
  const still = (b) => { if (!decoded.has(b)) decoded.set(b, createImageBitmap(b).then(toImage)); return decoded.get(b); };
  const m = await Promise.all(media.map(async (x) => ({ still: x.stillBlob ? await still(x.stillBlob) : null, clip: x.clipBlob ? { blob: x.clipBlob } : null })));
  return finishFilm(tl, m, aspect, onProgress);
}

// Redo one shot of a finished film on your AI server. A new take keeps the picture and moves it
// again (another seed: an arm or a hand that grew while it moved is gone); repaint paints a new
// picture first, following your note. Either way the shot gets its lip sync again where it had one.
// data: the film as My films keeps it (src/ui/library.js); data.media[i] and data.notes[i] are updated.
export async function redoShot(data, i, { repaint = false, note = '', server, signal, onProgress = () => {} } = {}) {
  const tl = data.tl, shot = tl.shots[i];
  const castById = new Map(tl.cast.map((c) => [c.id, c]));
  const look = data.look || 'pixar', era = filmEra(tl), size = sizeFor(data.aspect);
  const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  onProgress('Connecting to your AI studio…');
  let health = await server.health(8000);
  if (!health || health.ok === false) {
    health = await wakeServer(server, { signal, onWait: (s) => onProgress(`Waking up your AI studio… ${clock(s)} (2–4 minutes after a quiet spell)`) });
  }
  if (!health) throw new Error('Your AI studio isn’t answering right now. Please try again in a minute.');
  health = await waitForModel(server, health, 'video', (p, msg) => onProgress(msg), signal);
  if (!health?.video) throw new Error('The video AI isn’t ready yet. Please try again in a minute.');
  if (note.trim()) data.notes[i] = noteToPrompt(note);
  const nt = data.notes[i] || '';
  let still = data.media[i].stillBlob;
  if (repaint || !still) {
    onProgress('Painting a new picture…');
    const r = await paintOnServer(server, shot, castById, data.portraits, picturePrompt(shot, castById, look, era, nt), { ...size, seed: 1 + Math.floor(Math.random() * 999999) }, signal);
    still = r.blob;
  }
  onProgress('Bringing it to life…');
  let clip = await tries(() => serverVideo(server, still, shotMotion(shot, castById, look, era, nt), shot, size, signal, data.speed, 8 + Math.floor(Math.random() * 999990)), signal, 3, server);
  const voice = data.clips?.size ? { clips: data.clips, voices: data.voices } : null;
  if (wantsLipsync(shot, data.speed, voice)) {
    const wav = shotWav(shot, voice);
    const lips = wav && (health.lipsync || (await server.health().catch(() => null))?.lipsync);
    if (lips) {
      onProgress('Syncing lips…');
      clip = (await lipsyncClip(server, clip, wav, signal, 20)) || clip;
    }
  }
  data.media[i] = { ...data.media[i], stillBlob: still, clipBlob: clip };
  return data.media[i];
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
export async function renderFreeFilm(tl, { speed = 'best', look = 'pixar', aspect = '16:9', hfToken = '', animate = true, server = null, fallbackStill = null, voice = null, review = null, onShot = () => {}, onProgress = () => {}, signal } = {}) {
  const castById = new Map(tl.cast.map((c) => [c.id, c]));
  const era = filmEra(tl);
  const size = sizeFor(aspect);
  const shots = tl.shots;
  const media = shots.map(() => ({ still: null, clip: null }));
  const total = shots.length * (animate ? 2 : 1);
  let done = 0;
  const srv = server;
  let health = srv ? await srv.health() : null;
  if (health?.ok === false) health = null;  // e.g. a serverless endpoint without its API key
  // painting starts as soon as the picture model is ready; the video model finishes loading meanwhile
  if (health) health = await waitForModel(srv, health, 'image', onProgress, signal);
  const useSrv = !!(health && health.image);
  const usedBefore = useSrv ? await srv.usage() : null;
  console.log('[storyreel] AI server', srv?.label || '(none)', health ? 'connected' : 'not reachable');
  let srvVideo = !!(health && health.video);
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
  // Same faces in every shot: your server first paints a portrait of each main character (up to 3),
  // then paints every shot from the portraits of the people in it.
  const portraits = new Map();
  if (useSrv) {
    const seen = new Map();
    for (const s of shots) if (s.kind !== 'title') for (const id of s.ids || s.scene.characters || []) if (castById.has(id)) seen.set(id, (seen.get(id) || 0) + 1);
    // one portrait per person: a crowd ("the shepherds") isn't one face
    const main = [...seen].filter(([id]) => !castById.get(id).crowd).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => castById.get(id));
    // all asked for at once: the server paints them back to back, with no waiting in between
    onProgress(done / total, `Creating ${main.map(nameOf).join(', ')}'s look`);
    await Promise.all(main.map(async (c) => {
      try {
        const p = `portrait of ${person(c, look)}, head and shoulders, facing the camera, natural expression, plain soft background, ${era ? `${era}, ` : ''}${LOOK_TAG[look] || LOOK_TAG.pixar}, ${STYLE[look] || STYLE.pixar}`;
        const blob = await tries(() => srv.image({ prompt: p.slice(0, 900), width: 768, height: 768, seed: 4242 }, signal), signal, 3, srv);
        portraits.set(c.id, await blobToDataUrl(blob));
      } catch (e) { if (e?.name === 'AbortError') throw e; console.warn('portrait skipped', e); }
    }));
  }
  const paintShot = async (i, waitMs, seed = seedOf(shots[i])) => {
    const prompt = picturePrompt(shots[i], castById, look, era, notes[i]);
    const opts = { ...size, seed };
    if (useSrv) {
      try { const r = await paintOnServer(srv, shots[i], castById, portraits, prompt, opts, signal); sources.server++; return r; } catch (e) { if (e?.name === 'AbortError') throw e; console.warn(e); }
    }
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
  // with your server, the next two pictures are already being painted while one comes back
  const ahead = useSrv ? 2 : 0;
  const painting = [];
  const paintJob = (i) => { if (!painting[i]) { painting[i] = paintShot(i, 75000); painting[i].catch(() => {}); } return painting[i]; };
  for (let i = 0; i < shots.length; i++) {
    for (let k = 1; k <= ahead && i + k < shots.length; k++) paintJob(i + k);
    const r = await paintJob(i);
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
    // A sleepy server (Modal) stops 2 minutes after its last request. While you look at your shots it is
    // kept awake for up to about 4 more minutes (cheaper than starting it again); after a longer look
    // it is woken up again before the shots come to life.
    let pings = 0;
    const keepAwake = useSrv ? setInterval(() => { if (++pings <= 4) srv.health(20000).catch(() => null); }, 50000) : null;
    try { await review({ shots, blobs, notes, repaint }); } finally { if (keepAwake) clearInterval(keepAwake); }
    if (useSrv && animate) {
      let h = await srv.health(8000).catch(() => null);
      if (!h || h.ok === false) {
        h = await wakeServer(srv, { signal, onWait: (s) => onProgress(done / total, `Waking up your AI studio… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} (2–4 minutes after a quiet spell)`) });
      }
      if (h) health = await waitForServer(srv, h, onProgress, signal);
    }
  }
  let reason = '';
  let lipsynced = 0;
  // lip sync starts a few minutes after the rest of the server: ask again before each shot until it's ready
  let lipsReady = !!health?.lipsync;
  const lipsNow = async () => lipsReady || (lipsReady = !!(await srv.health().catch(() => null))?.lipsync);
  if (animate && useSrv && !srvVideo && health?.loading) {  // the video model was still loading: wait for it now
    health = await waitForModel(srv, health, 'video', onProgress, signal);
    srvVideo = !!health?.video;
  }
  if (animate) {
    let client = null, handle_file = null, quotaLeft = !srvVideo;
    if (!srvVideo) {
      try {
        const mod = await gradio();
        handle_file = mod.handle_file;
        client = await mod.Client.connect(LTX_SPACE, hfToken ? { hf_token: hfToken } : {});
      } catch (e) { quotaLeft = false; reason = 'the free video server is unavailable'; console.warn(e); }
    }
    const motionOf = (i) => shotMotion(shots[i], castById, look, era, notes[i]);
    // with your server, the next two clips are already being made while one comes back
    const clips = [];
    const syncing = [];  // lip sync of finished clips, running alongside
    const clipJob = (i) => {
      if (!clips[i]) { clips[i] = tries(() => serverVideo(srv, blobs[i], motionOf(i), shots[i], size, signal, speed), signal, 3, srv); clips[i].catch(() => {}); }
      return clips[i];
    };
    for (let i = 0; i < shots.length; i++) {
      if (srvVideo) for (let k = 1; k <= 2 && i + k < shots.length; k++) if (blobs[i + k]) clipJob(i + k);
      // with your own server every shot is animated, the opening title too
      if (blobs[i] && (srvVideo || shots[i].kind !== 'title')) {
        const mp = motionOf(i);
        try {
          if (srvVideo) {
            const blob = await clipJob(i);
            media[i].clip = { blob };
            onShot(i, null, 'animated');
            // lip sync: the on-screen speakers' words, on the clip's clock as the player will show it
            if (wantsLipsync(shots[i], speed, voice) && await lipsNow()) {
              const wav = shotWav(shots[i], voice);
              if (wav) {
                // lip sync runs in its own process: it works on this shot while the next clips are made
                syncing.push(lipsyncClip(srv, blob, wav, signal, 20)
                  .then((synced) => { if (synced) { media[i].clip = { blob: synced }; lipsynced++; onShot(i, null, 'synced'); } })
                  .catch((e) => { if (e?.name === 'AbortError') throw e; }));
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
    if (syncing.length) {
      let left = syncing.length;
      onProgress(Math.min(0.999, done / total), `Syncing lips (${left} shot${left > 1 ? 's' : ''} left)`);
      await Promise.all(syncing.map((p) => p.then(() => { left--; if (left) onProgress(Math.min(0.999, done / total), `Syncing lips (${left} shot${left > 1 ? 's' : ''} left)`); })));
    }
  }
  const film = await finishFilm(tl, media, aspect, (p, msg) => onProgress(Math.min(0.999, done / total), msg));
  // what My films keeps: each shot's own picture (a shot that borrowed a neighbour's has that one),
  // the character portraits (the same faces when a shot is redone) and your notes
  film.stillBlobs = media.map((m, i) => blobs[i] || blobs[media.findIndex((x, k) => blobs[k] && x.still === m.still)] || null);
  film.portraits = portraits;
  film.notes = notes;
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
