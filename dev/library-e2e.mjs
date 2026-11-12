// My films, Redo and the account, end to end in Chromium, on a phone-sized screen:
//   node dev/library-e2e.mjs <out-dir>
// It starts the AI server in mock mode (server/storyreel_server.py --mock: real API, placeholder
// pictures and clips; needs ffmpeg), the account service (server/library_server.py: pip install
// "fastapi[standard]" webauthn) and serves the app. Passkeys come from Chromium's virtual
// authenticator, which signs like a phone's: device C gets a copy of device A's passkey, as iCloud
// Keychain would. Steps: make a film → it's kept and backed up by itself (no sign-up) → redo two shots
// → reload and open it → device B joins with a 6-digit code and opens it → A adds Face ID (refused once
// by the phone's passwords app, then added) → device C signs in with Face ID → B deletes the film → A
// lets go too → A signs out: backup stays off.
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.resolve(process.argv[2] || '.');
fs.mkdirSync(out, { recursive: true });
const films = fs.mkdtempSync(path.join(os.tmpdir(), 'takeone-films-'));
const AI = 17861, LIB = 17870;
const procs = [];
// the servers write to log files in <out-dir> (not to this process, so they never depend on it), and
// they stop with it, however it ends
const start = (cmd, args, opts, log) => { const fd = fs.openSync(path.join(out, log), 'w'); const p = spawn(cmd, args, { stdio: ['ignore', fd, fd], ...opts }); procs.push(p); return p; };
const stopAll = () => { for (const p of procs) { try { p.kill(); } catch {} } };
process.on('exit', stopAll);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
process.on('uncaughtException', (e) => { console.error(e); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); process.exit(1); });
for (const u of [`http://localhost:${AI}/health`, `http://localhost:${LIB}/health`]) {
  try { await fetch(u); throw new Error(`something already answers ${u}: stop it first`); } catch (e) { if (/already/.test(e.message)) throw e; }
}
start('python3', ['storyreel_server.py', '--mock', '--port', String(AI)], { cwd: path.join(root, 'server') }, 'ai-server.log');
start('python3', ['-m', 'uvicorn', '--factory', 'library_server:local_app', '--port', String(LIB)], { cwd: path.join(root, 'server'), env: { ...process.env, STORYREEL_FILMS: films } }, 'library.log');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.png': 'image/png', '.wasm': 'application/wasm' };
const site = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  fs.readFile(path.join(root, p === '/' ? 'index.html' : p), (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data);
  });
}).listen(0, 'localhost');
await new Promise((r) => site.on('listening', r));
const APP = `http://localhost:${site.address().port}/index.html`;
for (const u of [`http://localhost:${AI}/health`, `http://localhost:${LIB}/health`]) {
  for (let k = 0; ; k++) { try { if ((await fetch(u)).ok) break; } catch {} if (k > 60) throw new Error(`${u} didn't start`); await new Promise((r) => setTimeout(r, 500)); }
}

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failed++; };
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' };

async function device(name, credential = null) {
  const ctx = await browser.newContext(phone);
  await ctx.addInitScript((lib) => { localStorage.setItem('storyreel:library-server', lib); }, `http://localhost:${LIB}`);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  if (credential) await cdp.send('WebAuthn.addCredential', { authenticatorId, credential });
  page.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message));
  page.on('console', (m) => { if ((m.type() === 'error' || (process.env.VERBOSE && m.type() === 'warning')) && !/Failed to load resource|fonts\.g/.test(m.text())) console.log(`[${name} ${m.type()}]`, m.text().slice(0, 300)); });
  await page.goto(APP);
  await page.waitForFunction(() => !!window.__storyreel);
  return { ctx, page, cdp, authenticatorId };
}
const kept = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('takeone-films');
  r.onsuccess = () => {
    const q = r.result.transaction('films').objectStore('films').getAll();
    q.onsuccess = () => { res(q.result.map((f) => ({ id: f.id, title: f.title, media: f.media, files: Object.keys(f.files), cloud: f.cloud, updated: f.updated }))); r.result.close(); };
  };
}));
const filesOf = (page, id) => page.evaluate((id) => new Promise((res) => {
  const r = indexedDB.open('takeone-films');
  r.onsuccess = () => { const q = r.result.transaction('files').objectStore('files').getAllKeys(IDBKeyRange.bound(`${id}/`, `${id}/￿`)); q.onsuccess = () => { res(q.result.map((k) => k.slice(id.length + 1))); r.result.close(); }; };
}), id);
// waits until fn (run in the page, may be async) answers true; page.waitForFunction would take a
// returned Promise itself as "true" without waiting for it
async function until(page, fn, arg, timeout = 60000) {
  for (const t0 = Date.now(); ;) {
    if (await page.evaluate(fn, arg)) return;
    if (Date.now() - t0 > timeout) throw new Error(`waited ${timeout / 1000} s: ${fn.toString().slice(0, 120)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
const toastText = (page) => page.evaluate(() => document.getElementById('toast').textContent);

// ---- device A: make a film ----
const A = await device('A');
await A.page.evaluate((ai) => {
  const set = (id, v) => { const el = document.getElementById(id); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('ai-server', ai); set('review-first', false); set('speed', 'best'); set('look', 'pixar');
  const box = document.getElementById('story');
  box.value = 'Mia met Leo in the sunny park. "Hi Leo! Want to fly my kite?" Mia asked. "Yes!" Leo said, and they ran across the grass together.';
  box.dispatchEvent(new Event('input', { bubbles: true }));
}, `http://localhost:${AI}`);
const t0 = Date.now();
await A.page.click('#make');
await A.page.waitForFunction(() => window.__storyreel.player && !window.__storyreel.busy, null, { timeout: 600000, polling: 1000 });
console.log(`film made in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await A.page.waitForFunction(() => /kept in My films/.test(document.getElementById('board-meta').textContent), null, { timeout: 60000 });
let recs = await kept(A.page);
const shots = await A.page.evaluate(() => window.__storyreel.timeline.shots.length);
check(recs.length === 1 && recs[0].media.length === shots && recs[0].media.every((m) => m.still && m.clip), `the film is kept on the device: ${shots} shots, each with its picture and clip`);
check(recs[0].files.some((f) => f.startsWith('voice-')) && recs[0].files.some((f) => f.startsWith('portrait-')), 'its voices and character portraits are kept too');
check(await A.page.locator('.card-redo').count() === shots, 'every shot on the board has Redo');
const id = recs[0].id;
const backedUp = (page) => until(page, () => new Promise((res) => { const r = indexedDB.open('takeone-films'); r.onsuccess = () => { const q = r.result.transaction('films').objectStore('films').getAll(); q.onsuccess = () => { res(q.result.length > 0 && q.result.every((f) => f.cloud?.at === f.updated)); r.result.close(); }; }; }), null, 120000);
await backedUp(A.page);
const users = fs.readdirSync(path.join(films, 'users'));
const onServer = path.join(films, 'users', users[0], 'films', id);
check(users.length === 1 && fs.existsSync(path.join(onServer, 'film.json')), `nothing to set up: the film is backed up to an account that started by itself${users.length === 1 && fs.existsSync(path.join(onServer, 'film.json')) ? '' : ` (accounts: ${users.join(', ')}; ${JSON.stringify(fs.readdirSync(path.join(films, 'users', users[0] || '.'), { recursive: true }))})`}`);

// ---- redo: a new take of shot 2, then a repaint of shot 1 with a note ----
const before = recs[0].media;
await A.page.evaluate(() => { window.__clip1 = window.__storyreel.filmData.media[1].clipBlob; window.__still0 = window.__storyreel.filmData.media[0].stillBlob; });
await A.page.locator('.card-redo').nth(1).click();
check(await A.page.locator('#redo').isVisible(), 'Redo opens a small sheet for that shot');
await A.page.screenshot({ path: path.join(out, 'redo-sheet.png') });
await A.page.click('#redo-take');
// done = redone, on screen and kept (the redo waits for the save)
await A.page.waitForFunction(() => window.__storyreel.redoing == null && !window.__storyreel.busy && window.__storyreel.filmData.media[1].clipBlob !== window.__clip1, null, { timeout: 300000, polling: 500 });
check(/Shot redone and kept/.test(await toastText(A.page)), 'it says when the shot is redone and kept');
check(await A.page.evaluate(() => window.__storyreel.filmData.media[1].clipBlob !== window.__clip1 && window.__storyreel.filmData.media[1].stillBlob === window.__storyreel.filmData.media[1].stillBlob), 'a new take: shot 2 has a new clip of the same picture');
await until(A.page, (u) => new Promise((res) => { const r = indexedDB.open('takeone-films'); r.onsuccess = () => { const q = r.result.transaction('films').objectStore('films').get(window.__storyreel.filmData.id); q.onsuccess = () => { res(q.result.updated > u); r.result.close(); }; }; }), recs[0].updated, 30000);
recs = await kept(A.page);
check(recs[0].media[1].clip !== before[1].clip && recs[0].media[1].still === before[1].still && recs[0].media[2].clip === before[2].clip, 'kept again: only shot 2’s clip changed');
check(!(await filesOf(A.page, id)).includes(before[1].clip), 'the replaced clip is gone from the device');
await A.page.locator('.card-redo').nth(0).click();
await A.page.fill('#redo-note', 'at sunset');
await A.page.click('#redo-paint');
await A.page.waitForFunction(() => window.__storyreel.redoing == null && !window.__storyreel.busy && window.__storyreel.filmData.media[0].stillBlob !== window.__still0, null, { timeout: 300000, polling: 500 });
check(await A.page.evaluate(() => window.__storyreel.filmData.media[0].stillBlob !== window.__still0 && /sunset/.test(window.__storyreel.filmData.notes[0])), 'repaint: shot 1 has a new picture that follows the note');
await A.page.screenshot({ path: path.join(out, 'film-after-redo.png') });

// ---- reload: the film is in My films and opens as it was ----
await A.page.reload();
await A.page.waitForFunction(() => !!window.__storyreel);
await A.page.click('#my-films');
await A.page.waitForSelector('.film');
check(await A.page.locator('.film').count() === 1 && (await A.page.locator('.film-title').first().textContent()) === recs[0].title, `after a reload, My films lists the film (“${recs[0].title}”)`);
await A.page.waitForFunction(() => /Your films are backed up/.test(document.getElementById('account-card').textContent) && !/Backing up/.test(document.getElementById('account-card').textContent), null, { timeout: 60000 });
check(/Nothing to set up/.test(await A.page.locator('#account-card').textContent()) && await A.page.locator('[data-code]').isVisible(), 'My films: “Your films are backed up”, with Use on another device');
recs = await kept(A.page);
check(fs.readdirSync(path.join(onServer, 'files')).sort().join() === [...recs[0].files].sort().join(), 'the account has the redone film and exactly its files');
await A.page.screenshot({ path: path.join(out, 'my-films.png') });
await A.page.locator('.film-open').first().click();
await A.page.waitForFunction(() => window.__storyreel.player && !window.__storyreel.busy && window.__storyreel.filmData, null, { timeout: 120000 });
check(await A.page.evaluate((id) => window.__storyreel.filmData.id === id && window.__storyreel.timeline.shots.length > 0, id), 'it opens from My films, with no AI studio needed');
check(await A.page.locator('.card-redo').count() === shots, '…and its shots can still be redone');
check(await A.page.evaluate(() => /sunset/.test(window.__storyreel.filmData.notes[0])), '…with its notes kept');
await A.page.screenshot({ path: path.join(out, 'film-reopened.png') });

// ---- device B joins with a 6-digit code from A, and opens the film ----
await A.page.click('#my-films');
await A.page.waitForSelector('.film-on');
check(/On screen/.test(await A.page.locator('.film-on').textContent()), 'My films marks the film that is on screen');
await A.page.click('[data-code]');
await A.page.waitForSelector('.acct-codebox:not([hidden])');
const code = (await A.page.locator('.acct-code').textContent()).replace(/\D/g, '');
check(/^\d{6}$/.test(code), `Use on another device shows a 6-digit code (${code.slice(0, 3)} ${code.slice(3)})`);
await A.page.screenshot({ path: path.join(out, 'code.png') });
const B = await device('B');
await B.page.click('#my-films');
await B.page.waitForSelector('#account-card [data-enter]');
check(await B.page.locator('.film').count() === 0 && /Backed up automatically/.test(await B.page.locator('#account-card').textContent()), 'device B starts with no films: “Backed up automatically”');
await B.page.click('#account-card [data-enter]');
await B.page.fill('[data-digits]', `${code.slice(0, 3)} ${code.slice(3)}`);
await B.page.screenshot({ path: path.join(out, 'enter-code.png') });
await B.page.click('[data-use]');
await B.page.waitForFunction(() => /Your films are backed up/.test(document.getElementById('account-card').textContent), null, { timeout: 60000 });
await B.page.waitForSelector('.film');
check(/In your account/.test(await B.page.locator('.film-where').first().textContent()), 'code typed on device B: it’s in the same account, the film is there');
await B.page.locator('.film-open').first().click();
await B.page.waitForFunction(() => window.__storyreel.player && !window.__storyreel.busy && window.__storyreel.filmData, null, { timeout: 180000, polling: 500 });
check(await B.page.evaluate((id) => window.__storyreel.filmData.id === id && /sunset/.test(window.__storyreel.filmData.notes[0]), id), 'device B downloads it and plays it, notes and all');
check((await kept(B.page))[0]?.cloud?.at === recs[0].updated, '…and keeps it, marked as backed up');
await B.page.screenshot({ path: path.join(out, 'device-b-film.png') });
check(fs.readdirSync(path.join(films, 'users')).length === 1, 'still one account (B joined it rather than starting its own)');

// ---- A adds Face ID (optional): refused once by the phone's passwords app, then added ----
await A.page.evaluate(() => {
  const real = navigator.credentials.create.bind(navigator.credentials);
  navigator.credentials.create = async () => { navigator.credentials.create = real; throw new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'); };
});
await A.page.click('[data-face]');
await A.page.waitForFunction(() => /More Options/.test(document.querySelector('#account-card .acct-msg')?.textContent || ''), null, { timeout: 30000 });
check(/More Options, and choose Passwords/.test(await A.page.locator('#account-card .acct-msg').textContent()) && !(await A.page.locator('[data-face]').isDisabled()), 'Face ID the phone’s app couldn’t keep (like Microsoft Authenticator): the card says what to do, ready to try again');
await A.page.screenshot({ path: path.join(out, 'face-id-not-added.png') });
await A.page.click('[data-face]');
await A.page.waitForFunction(() => /Face ID gets you back in/.test(document.getElementById('account-card').textContent), null, { timeout: 60000 });
check(await A.page.locator('[data-face]').count() === 0, 'Face ID added to the account (and no longer offered)');
const { credentials } = await A.cdp.send('WebAuthn.getCredentials', { authenticatorId: A.authenticatorId });
check(credentials.length === 1 && credentials[0].isResidentCredential, 'one passkey, kept on the device (it syncs like iCloud Keychain)');

// ---- device C: signs in with Face ID alone (as on a new phone) ----
const C = await device('C', credentials[0]);
await C.page.click('#my-films');
await C.page.waitForSelector('#account-card [data-in]');
await C.page.click('#account-card [data-in]');
await C.page.waitForFunction(() => /Your films are backed up/.test(document.getElementById('account-card').textContent), null, { timeout: 60000 });
await C.page.waitForSelector('.film');
check(/In your account/.test(await C.page.locator('.film-where').first().textContent()), 'device C signs in with Face ID: the same account, the film is there');

// ---- B deletes it: gone from the account, and A lets go of its copy ----
await B.page.click('#my-films');
await B.page.waitForSelector('.film-del');
await B.page.locator('.film-del').first().click();
check(/all your devices/.test(await B.page.locator('.film-confirm').textContent()), 'deleting asks first, saying it goes from all devices');
await B.page.locator('.film-confirm [data-yes]').click();
await B.page.waitForFunction(() => !document.querySelector('.film'), null, { timeout: 30000 });
check(!fs.existsSync(onServer) && (await kept(B.page)).length === 0, 'deleted on B: gone from the account and from B');
await A.page.evaluate(() => document.getElementById('films-close').click());
await A.page.click('#my-films');
await A.page.waitForFunction(() => !document.querySelector('.film'), null, { timeout: 30000 });
await until(A.page, () => new Promise((res) => { const r = indexedDB.open('takeone-films'); r.onsuccess = () => { const q = r.result.transaction('films').objectStore('films').count(); q.onsuccess = () => { res(q.result === 0); r.result.close(); }; }; }), null, 30000);
check(true, 'device A no longer lists it and lets go of its copy');

// ---- A signs out: backup stays off on A (no new account by itself), until it's turned on ----
await A.page.click('[data-out]');
check(/Tap again to sign out/.test(await A.page.locator('[data-out]').textContent()), 'signing out asks for a second tap');
await A.page.click('[data-out]');
await A.page.waitForFunction(() => /Backup is off on this device/.test(document.getElementById('account-card').textContent), null, { timeout: 30000 });
await A.page.reload();
await A.page.waitForFunction(() => !!window.__storyreel);
await new Promise((r) => setTimeout(r, 1500));
await A.page.click('#my-films');
await A.page.waitForFunction(() => /Backup is off on this device/.test(document.getElementById('account-card').textContent), null, { timeout: 30000 });
check(fs.readdirSync(path.join(films, 'users')).length === 1, 'signed out: backup stays off after a reload, and no new account was made');

await browser.close();
site.close();
for (const p of procs) p.kill();
fs.rmSync(films, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
