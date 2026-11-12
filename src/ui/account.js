// Your TakeOne account, with nothing to set up: it starts by itself when your first film is backed up.
// Another phone or computer joins it with a 6-digit code from a device that's in. Face ID (a passkey)
// is optional: added to the account, it gets you back in on any device, even if this phone is lost.
// No password, no email.
// The account service (server/library_server.py) runs beside the AI studio on a small CPU, never
// the GPU, at the studio's link with "library" for "serve".
import * as lib from './library.js';

const KEY = 'storyreel:account';            // {session, user, base} on this device
const OFF_KEY = 'storyreel:backup-off';     // signed out on purpose: no new account by itself
const SERVICE_KEY = 'storyreel:library-server';  // another account service (your own computer, tests)

const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// base64url, as WebAuthn and the service speak it
export function enc(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function dec(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

// The service's address from the AI studio's: https://you--storyreel-serve.<…>.modal.run →
// https://you--storyreel-library.<…>.modal.run (and Modal's plain form, should the two differ).
export function serviceCandidates(studio) {
  let o = null;
  try { o = localStorage.getItem(SERVICE_KEY); } catch {}
  if (o) return [o.replace(/\/+$/, '')];
  const m = /^(https:\/\/[^/]+?)--storyreel-serve((?:\.[a-z0-9-]+)*\.modal\.run)\/?$/i.exec((studio || '').trim());
  return m ? [...new Set([`${m[1]}--storyreel-library${m[2]}`, `${m[1]}--storyreel-library.modal.run`])] : [];
}

// WebAuthn options (JSON from the service) → what the browser takes, and its answer back to JSON
const creationOptions = (o) => ({ ...o, challenge: dec(o.challenge), user: { ...o.user, id: dec(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: dec(c.id) })) });
const requestOptions = (o) => ({ ...o, challenge: dec(o.challenge), allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: dec(c.id) })) });
export function credentialJSON(c) {
  const r = c.response;
  const out = { id: c.id, rawId: enc(c.rawId), type: c.type, authenticatorAttachment: c.authenticatorAttachment ?? null, clientExtensionResults: c.getClientExtensionResults?.() || {}, response: { clientDataJSON: enc(r.clientDataJSON) } };
  if (r.attestationObject) { out.response.attestationObject = enc(r.attestationObject); out.response.transports = r.getTransports?.() || []; }
  if (r.authenticatorData) { out.response.authenticatorData = enc(r.authenticatorData); out.response.signature = enc(r.signature); out.response.userHandle = r.userHandle ? enc(r.userHandle) : null; }
  return out;
}

// What unlocks a passkey here, in the words people know
export function lockName() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return 'Face ID';
  if (/Macintosh/.test(ua)) return 'Touch ID';
  if (/Android/.test(ua)) return 'your fingerprint';
  if (/Windows/.test(ua)) return 'Windows Hello';
  return 'your device’s lock';
}

class AccountError extends Error {
  constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}

export const account = {
  user: null, session: null, base: null, candidates: [], prepared: {}, off: false, problem: '',
  syncing: null, onChange: () => {},

  init(studio) {
    this.candidates = serviceCandidates(studio);
    const saved = ls.get(KEY);
    if (saved?.session) Object.assign(this, { session: saved.session, user: saved.user, base: saved.base || null });
    this.off = !this.session && !!ls.get(OFF_KEY);
  },
  // the service only answers the app's own addresses (and a computer running it); passkeys need a secure page
  get available() {
    return !!(this.candidates.length && window.PublicKeyCredential && window.isSecureContext && navigator.credentials
      && /(^|\.)takeoneai\.pages\.dev$|^localhost$/.test(location.hostname));
  },
  get signedIn() { return !!this.session; },

  // The service's address that answers (it sleeps when unused: the first answer can take a few seconds)
  async service() {
    if (this.base) return this.base;
    for (const b of this.candidates) {
      try {
        const r = await fetch(`${b}/health`, { signal: AbortSignal.timeout(30000) });
        if (r.ok && (await r.json()).service === 'takeone-library') { this.base = b; this.keep(); return b; }
      } catch {}
    }
    throw new AccountError('Couldn’t reach TakeOne accounts right now. Please try again in a minute.', 'offline');
  },

  async call(path, { method = 'GET', json, body, blob = false, auth = true, timeout = 60000 } = {}) {
    const base = await this.service();
    const headers = {};
    if (auth) { if (!this.session) throw new AccountError('Sign in first.', 'signed-out'); headers.Authorization = `Bearer ${this.session}`; }
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    else if (body instanceof Blob) headers['Content-Type'] = body.type || 'application/octet-stream';
    let res;
    try { res = await fetch(`${base}${path}`, { method, headers, body, signal: AbortSignal.timeout(timeout) }); } catch (e) {
      this.base = null;  // asked again next time (maybe it moved)
      throw new AccountError('Couldn’t reach TakeOne accounts right now. Please try again in a minute.', 'offline');
    }
    if (res.status === 401 && auth) { this.drop(); throw new AccountError('Please sign in again.', 'signed-out', 401); }
    if (!res.ok) {
      const why = await res.json().then((j) => j.error).catch(() => '');
      throw new AccountError(why || `TakeOne accounts answered ${res.status}`, 'refused', res.status);
    }
    return blob ? res.blob() : res.json();
  },

  keep() {
    ls.set(KEY, this.session ? { session: this.session, user: this.user, base: this.base } : null);
    ls.set(OFF_KEY, this.off ? 1 : null);
  },

  // Fetched before the tap: Safari only shows Face ID when it's asked for right away. Signed in: Face ID
  // for this account (if it has none yet); signed out: signing in with Face ID.
  async prepare() {
    if (!this.available) return;
    const fresh = (p) => p && Date.now() - p.at < 4 * 60000 && p.session === this.session;
    const get = async (kind) => {
      if (fresh(this.prepared[kind])) return;
      const session = this.session;
      try { this.prepared[kind] = { ...(await this.call(`/auth/${kind}/options`, { method: 'POST', json: {}, auth: kind === 'register' && !!session })), at: Date.now(), session }; } catch {}
    };
    if (!this.signedIn) await get('login');
    else if (!this.user?.passkeys) await get('register');
  },

  async ceremony(kind, name) {
    const auth = kind === 'register' && this.signedIn;  // Face ID added to the account this device is in
    let p = this.prepared[kind];
    this.prepared[kind] = null;
    const late = !p || Date.now() - p.at > 4 * 60000 || p.session !== this.session;
    if (late) p = await this.call(`/auth/${kind}/options`, { method: 'POST', json: {}, auth });
    let cred;
    try {
      if (kind === 'register') {
        const publicKey = creationOptions(p.options);
        if (name) publicKey.user = { ...publicKey.user, name, displayName: name };  // the name shown in your passwords list
        cred = await navigator.credentials.create({ publicKey });
      } else cred = await navigator.credentials.get({ publicKey: requestOptions(p.options) });
    } catch (e) {
      console.warn(`passkey ${kind}:`, e?.name, e?.message);
      this.prepare();  // ready for the next tap
      const refused = e?.name === 'NotAllowedError' || e?.name === 'AbortError';
      // after a slow start the browser may have wanted a fresh tap
      if (refused && late) throw new AccountError('Tap the button once more to finish.', 'tap-again');
      // cancelled, or the app that was to keep the passkey couldn't (Microsoft Authenticator keeps only
      // passkeys for Microsoft work accounts, and an iPhone offers it for every site all the same)
      throw new AccountError('', refused ? 'cancelled' : 'failed');
    }
    if (!cred) throw new AccountError('', 'cancelled');
    const res = await this.call(`/auth/${kind}/verify`, { method: 'POST', json: { state: p.state, credential: credentialJSON(cred), ...(name ? { name } : {}) }, auth });
    await this.enter(res);
    return res.user;
  },

  // In an account now: started, joined with a code, or signed in with Face ID. This device's films go to
  // that account too (a different account than before has none of them yet).
  async enter(res) {
    if (res.user?.id !== this.user?.id) await lib.forgetCloud();
    this.session = res.session; this.user = res.user; this.off = false; this.prepared = {}; this.problem = '';
    this.keep();
    this.onChange();
    this.sync();
  },
  // An account with nothing to set up: made by itself when the first film is backed up.
  async start() {
    const res = await this.call('/auth/start', { method: 'POST', json: {}, auth: false });
    await this.enter(res);
    return res.user;
  },
  // 6 digits for another phone or computer to join this account (works once, for 10 minutes)
  newCode() { return this.call('/auth/link/new', { method: 'POST', json: {} }); },
  async useCode(code) {
    const res = await this.call('/auth/link/use', { method: 'POST', json: { code: String(code || '') }, auth: false });
    await this.enter(res);
    return res.user;
  },
  addFaceId(name = '') { return this.ceremony('register', String(name).replace(/\s+/g, ' ').trim().slice(0, 40)); },
  signIn() { return this.ceremony('login'); },
  // Signed out on purpose: films stay on this device and backup waits until it's turned on again.
  signOut() { this.session = null; this.user = null; this.off = true; this.prepared = {}; this.keep(); this.onChange(); },
  // the session no longer works (the next film backed up starts a new account)
  drop() { this.session = null; this.user = null; this.prepared = {}; this.keep(); this.onChange(); },
  async refresh() {
    if (!this.signedIn) return;
    try { this.user = (await this.call('/me')).user; this.keep(); } catch {}
  },

  // ---- films in the account ----
  async list() { return this.call('/films'); },
  async remove(id) { return this.call(`/films/${encodeURIComponent(id)}`, { method: 'DELETE' }); },

  async upload(rec) {
    const sent = { ...(rec.cloud?.files || {}) };
    for (const name of Object.keys(rec.files)) {
      if (sent[name]) continue;
      const blob = await lib.getFile(rec.id, name);
      if (!blob) continue;
      await this.call(`/films/${rec.id}/files/${encodeURIComponent(name)}`, { method: 'PUT', body: blob, timeout: 10 * 60000 });
      sent[name] = 1;
      await lib.markCloud(rec.id, sent);  // an interrupted backup goes on from here next time
    }
    const { cloud, ...record } = rec;
    await this.call(`/films/${rec.id}`, { method: 'PUT', json: record });
    await lib.markCloud(rec.id, Object.fromEntries(Object.keys(rec.files).map((n) => [n, 1])), rec.updated);
  },

  // A film from the account onto this device (then it opens like any other).
  async download(rec, onProgress = () => {}) {
    const names = Object.keys(rec.files || {});
    let k = 0;
    for (const name of names) {
      if (!(await lib.hasFile(rec.id, name))) await lib.putFile(rec.id, name, await this.call(`/films/${rec.id}/files/${encodeURIComponent(name)}`, { blob: true, timeout: 10 * 60000 }));
      onProgress(++k / names.length);
    }
    await lib.putRecord({ ...rec, cloud: { files: Object.fromEntries(names.map((n) => [n, 1])), at: rec.updated } });
  },

  // Backs up every film not backed up yet (or changed since), one at a time, and lets go of films
  // deleted on another device. Safe to call any time: a run already going is reused.
  sync() {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      if (!this.signedIn) {
        // nothing to set up: the first film to back up starts the account
        if (!this.available || this.off || !(await lib.listFilms()).length) return;
        try { await this.start(); } catch (e) { this.problem = e?.message || 'offline'; console.warn('backup: no account yet', e?.message || e); return; }
      }
      let cloud;
      try { cloud = await this.list(); this.problem = ''; } catch (e) { this.problem = e?.message || 'offline'; console.warn('backup: account unavailable', e?.message || e); return; }
      const gone = new Set(cloud.deleted || []);
      for (const rec of await lib.listFilms()) {
        if (gone.has(rec.id) && rec.cloud) { await lib.deleteFilm(rec.id); this.onChange(); continue; }
        if (rec.cloud?.at === rec.updated) continue;
        this.onChange();
        try { await this.upload(rec); } catch (e) {
          if (e.status === 410) { await lib.deleteFilm(rec.id); continue; }
          console.warn('backup paused', e?.message || e);
          break;
        } finally { this.onChange(); }
      }
    })().finally(() => { this.syncing = null; this.onChange(); });
    return this.syncing;
  },

  // My films: this device's films and the account's, newest first. where: 'device' (only here),
  // 'backed-up' (here and in the account), 'cloud' (in the account, not on this device yet).
  async films() {
    const local = await lib.listFilms();
    let cloud = { films: [], deleted: [] };
    if (this.signedIn) { try { cloud = await this.list(); } catch (e) { console.warn('account films unavailable', e?.message || e); } }
    const here = new Set(local.map((r) => r.id));
    const gone = new Set(cloud.deleted || []);
    return [
      ...local.filter((r) => !(gone.has(r.id) && r.cloud)).map((r) => ({ ...r, where: r.cloud?.at === r.updated ? 'backed-up' : 'device' })),
      ...(cloud.films || []).filter((r) => !here.has(r.id)).map((r) => ({ ...r, where: 'cloud' })),
    ].sort((a, b) => (b.updated || 0) - (a.updated || 0));
  },
};
