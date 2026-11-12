// My films: every AI film made here is kept on this device (IndexedDB), with its pictures, clips,
// voices and timeline, so it can be watched, downloaded or have a shot redone later without making
// it again. With an account (src/ui/account.js) films are also backed up and reach your other devices.
//
// A film as the app works with it ("film data"):
//   { id, title, story, created, updated, aspect, look, speed, tl, voices: Map speaker → voice,
//     usedNeural, sfx, seed, clips: Map lineKey → {samples, sampleRate} (the voice lines),
//     media: [{stillBlob, clipBlob}] per shot, portraits: Map castId → data URL, notes: [] per shot }
// It is stored as a small record (what the My films list shows) plus one file per picture, clip,
// voice line and portrait. A file keeps its name while it's unchanged, so saving a film again
// (after a shot is redone) stores, and backs up, only what's new.
import { wavBlob, wavClip, blobToDataUrl } from '../ai/servervoice.js';

const DB_NAME = 'takeone-films';
let dbp = null;

function db() {
  return (dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('films')) d.createObjectStore('films', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');  // key `${filmId}/${name}` → Blob
    };
    r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); dbp = null; }; resolve(r.result); };
    r.onerror = () => { dbp = null; reject(r.error); };
  }));
}

// one request in its own transaction, as a promise
async function req(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    let out;
    const r = fn(tx.objectStore(store));
    if (r) r.onsuccess = () => { out = r.result; };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error || r?.error);
    tx.onabort = () => reject(tx.error || new Error('saving was interrupted'));
  });
}

const range = (id) => IDBKeyRange.bound(`${id}/`, `${id}/￿`);
export const getRecord = (id) => req('films', 'readonly', (s) => s.get(id));
export const putRecord = (rec) => req('films', 'readwrite', (s) => s.put(rec));
export const getFile = (id, name) => req('files', 'readonly', (s) => s.get(`${id}/${name}`));
export const putFile = (id, name, blob) => req('files', 'readwrite', (s) => s.put(blob, `${id}/${name}`));
export const hasFile = async (id, name) => (await req('files', 'readonly', (s) => s.count(`${id}/${name}`))) > 0;
const fileNames = async (id) => (await req('files', 'readonly', (s) => s.getAllKeys(range(id)))).map((k) => k.slice(id.length + 1));

// newest first
export async function listFilms() {
  try { return ((await req('films', 'readonly', (s) => s.getAll())) || []).sort((a, b) => b.updated - a.updated); } catch (e) { console.warn('My films unavailable', e); return []; }
}

export async function deleteFilm(id) {
  await req('files', 'readwrite', (s) => s.delete(range(id)));
  await req('films', 'readwrite', (s) => s.delete(id));
}

// The backup's bookkeeping (account.js): which files the account has, and up to which save.
// Read and written in one go, so a film saved meanwhile is noticed (and backed up) next time.
export async function markCloud(id, files, at) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('films', 'readwrite');
    const s = tx.objectStore('films');
    const g = s.get(id);
    g.onsuccess = () => { if (g.result) s.put({ ...g.result, cloud: { files, at: at ?? g.result.cloud?.at ?? null } }); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// This device joined another account: none of its films are in that one yet (they're backed up again).
export async function forgetCloud() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('films', 'readwrite');
    const s = tx.objectStore('films');
    const all = s.getAll();
    all.onsuccess = () => { for (const r of all.result) if (r.cloud) s.put({ ...r, cloud: null }); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const tag = () => Math.random().toString(36).slice(2, 7);
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/wav': 'wav' };
const ext = (blob) => EXT[(blob.type || '').split(';')[0]] || 'bin';

// A small picture for the list: the first shot after the title, about 240 px across.
async function thumbnail(data) {
  const shots = data.tl.shots;
  const i = shots.length > 1 && shots[0].kind === 'title' ? 1 : 0;
  const blob = data.media[i]?.stillBlob || data.media.find((m) => m.stillBlob)?.stillBlob;
  if (!blob) return '';
  try {
    const bm = await createImageBitmap(blob);
    const k = Math.min(1, 240 / Math.max(bm.width, bm.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k);
    c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
    bm.close?.();
    return c.toDataURL('image/jpeg', 0.72);
  } catch (e) { console.warn('thumbnail failed', e); return ''; }
}

// Keeps a film (new, or with a shot redone). Returns its record. Saves run one at a time, so two
// quick redos can't interleave their files.
let queue = Promise.resolve();
export function saveFilm(data) {
  const run = queue.then(() => save(data));
  queue = run.catch(() => {});
  return run;
}

async function save(data) {
  data.id ||= newId();
  data.created ||= Date.now();
  data.names ||= new Map();  // picture / clip / voice line / portrait → its file name
  const prev = await getRecord(data.id).catch(() => null);
  const files = {};
  // stores something once, under a name that stays as long as it's unchanged
  const keep = async (thing, base, toBlob) => {
    let name = data.names.get(thing);
    if (!name) {
      const blob = await toBlob();
      name = `${base}-${tag()}.${ext(blob)}`;
      await putFile(data.id, name, blob);
      files[name] = { size: blob.size, type: blob.type };
      data.names.set(thing, name);
    } else if (!files[name]) files[name] = prev?.files?.[name] || { size: 0, type: '' };
    return name;
  };
  try { navigator.storage?.persist?.(); } catch {}
  const media = [];
  for (const [i, m] of data.media.entries()) {
    media.push({
      still: m.stillBlob ? await keep(m.stillBlob, `still-${i}`, async () => m.stillBlob) : null,
      clip: m.clipBlob ? await keep(m.clipBlob, `clip-${i}`, async () => m.clipBlob) : null,
    });
  }
  const lines = [];
  let k = 0;
  for (const [key, clip] of data.clips || []) lines.push([key, await keep(clip, `voice-${k++}`, async () => wavBlob(clip.samples, clip.sampleRate))]);
  const portraits = [];
  for (const [id, url] of data.portraits || []) portraits.push([id, await keep(url, `portrait-${String(id).replace(/[^\w-]/g, '')}`, async () => (await fetch(url)).blob())]);
  const tl = data.tl;
  const rec = {
    id: data.id, v: 1, title: tl.title || data.title || 'My film', story: data.story || '', created: data.created, updated: Date.now(),
    aspect: data.aspect, look: data.look, speed: data.speed, duration: tl.duration, shotCount: tl.shots.length,
    thumb: await thumbnail(data), tl, voices: [...(data.voices || [])], usedNeural: !!data.usedNeural, sfx: data.sfx !== false, seed: data.seed ?? 0,
    lines, media, portraits, notes: data.notes || [], files, cloud: prev?.cloud || null,
  };
  await putRecord(rec);
  data.updated = rec.updated;
  // the pictures and clips a redone shot replaced
  for (const name of await fileNames(data.id)) if (!files[name]) await req('files', 'readwrite', (s) => s.delete(`${data.id}/${name}`));
  return rec;
}

// A kept film, ready to show again (see "film data" above).
export async function loadFilm(id) {
  const rec = await getRecord(id);
  if (!rec) throw new Error('That film isn’t on this device any more.');
  const names = new Map();
  const blobs = new Map();
  const file = async (name) => {
    if (!name) return null;
    if (!blobs.has(name)) {
      const b = await getFile(id, name);
      if (!b) throw new Error('Part of this film is missing on this device.');
      blobs.set(name, b);
      names.set(b, name);
    }
    return blobs.get(name);
  };
  const media = [];
  for (const m of rec.media) media.push({ stillBlob: await file(m.still), clipBlob: await file(m.clip) });
  const clips = new Map();
  for (const [key, name] of rec.lines || []) {
    try { const c = await wavClip(await file(name)); clips.set(key, c); names.set(c, name); } catch (e) { console.warn('a voice line is missing', key, e); }
  }
  const portraits = new Map();
  for (const [cid, name] of rec.portraits || []) {
    try { const url = await blobToDataUrl(await file(name)); portraits.set(cid, url); names.set(url, name); } catch (e) { console.warn('a portrait is missing', cid, e); }
  }
  return {
    id, title: rec.title, story: rec.story, created: rec.created, updated: rec.updated, aspect: rec.aspect, look: rec.look, speed: rec.speed,
    tl: rec.tl, voices: new Map(rec.voices || []), usedNeural: rec.usedNeural, sfx: rec.sfx, seed: rec.seed,
    clips, media, portraits, notes: rec.notes || rec.media.map(() => ''), names,
  };
}
