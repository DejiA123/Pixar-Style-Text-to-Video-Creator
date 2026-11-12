// My films: every film kept on this device and in your account, to watch again, download or redo a
// shot; and the account card: films are backed up by themselves, another device joins with a 6-digit
// code, and Face ID (optional) gets you back in anywhere.
import { account, lockName } from './account.js';
import { deleteFilm } from './library.js';

const $ = (id) => document.getElementById(id);
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
function when(t) {
  const d = new Date(t), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
const WHERE = { 'backed-up': '☁︎ Backed up', device: 'On this device', cloud: '☁︎ In your account' };

// What to do when a passkey wasn't saved or used. An iPhone offers the passwords app you picked in
// Settings, and some can't keep passkeys for websites (Microsoft Authenticator keeps only work accounts').
const apple = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent || '');
const lockShort = () => { const l = lockName(); return l.startsWith('your device') ? 'a passkey' : l.replace(/^your /, ''); };
const faceNotAdded = () => (apple()
  ? `${lockShort()} wasn’t added. Tap Add ${lockShort()} again, then More Options, and choose Passwords.\nMicrosoft Authenticator can’t keep passkeys for websites. No Passwords option? Turn it on in Settings → General → AutoFill & Passwords.`
  : `${lockShort()} wasn’t added. Tap Add ${lockShort()} again and keep the passkey on this device or in Google Password Manager (some apps can’t keep passkeys for websites).`);
const notSignedIn = () => (apple()
  ? 'Not signed in. Tap again and choose your TakeOne passkey (it’s in Passwords), or enter a code from a device that’s signed in.'
  : 'Not signed in. Tap again and choose your TakeOne passkey, or enter a code from a device that’s signed in.');

// openFilm(id): shows a kept film; isBusy(): a film is being made, redone or downloaded;
// currentId(): the film on screen; onDeleted(id): a film was deleted.
export function setupMyFilms({ openFilm, isBusy, toast, currentId = () => null, onDeleted = () => {} }) {
  const sheet = $('films'), grid = $('films-grid'), acct = $('account-card');
  let shown = [], seq = 0;
  const show = async () => {
    sheet.hidden = false;
    document.body.classList.add('sheet-open');
    render();
    await account.refresh();  // Face ID may have been added on another device
    renderAccount();
    account.prepare();  // Face ID needs the passkey request ready the moment you tap
    account.sync();  // films deleted on another device go from here too; anything not backed up yet goes up
  };
  const hide = () => { sheet.hidden = true; document.body.classList.remove('sheet-open'); };
  $('my-films').addEventListener('click', show);
  $('films-close').addEventListener('click', hide);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) hide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) hide(); });
  let soon = 0;  // a backup reports each film: one refresh for a burst of them
  account.onChange = () => { if (!sheet.hidden) { clearTimeout(soon); soon = setTimeout(render, 250); } };

  async function render() {
    renderAccount();
    const mine = ++seq;
    const list = await account.films();
    if (mine !== seq) return;
    shown = list;
    const now = currentId();
    if (now && !list.some((r) => r.id === now)) onDeleted(now);  // the film on screen was deleted on another device
    renderFilms();
  }

  // ---- the account card ----
  // Drawn again only when it changes (signed in or out, Face ID added): a backup in progress just updates
  // its line, so a code being read or typed stays put.
  let drawn = '', code = null;  // code: the one shown for another device, while it lasts
  function renderAccount(msg = '') {
    acct.hidden = !account.available;
    if (acct.hidden) return;
    const mode = `${account.signedIn}|${account.user?.passkeys || 0}|${account.off}`;
    if (mode !== drawn || msg) { drawn = mode; draw(); }
    status();
    if (msg) say(msg);
  }
  const say = (t, err = false) => { const p = acct.querySelector('.acct-msg'); if (p) { p.textContent = t; p.classList.toggle('err', err); } };
  const busy = (on) => acct.querySelectorAll('button, input').forEach((b) => { b.disabled = on; });
  // one account step: says it's working, then what happened (the card is drawn again when it worked)
  const step = (fn, waiting, done, tip) => async () => {
    busy(true); say(waiting);
    try {
      const r = await fn();
      if (done) toast(done(r), false, 7000);
      drawn = ''; render();
    } catch (e) {
      busy(false);
      if (e?.code === 'tap-again') say(e.message);
      else if (tip && (e?.code === 'cancelled' || e?.code === 'failed')) say(tip());
      else say(e?.message || 'That didn’t work. Please try again.', true);
    }
  };
  function status() {
    const icon = acct.querySelector('.acct-icon'), line = acct.querySelector('.acct-text span'), lock = lockShort();
    if (!icon || !line) return;
    if (account.signedIn) {
      icon.textContent = account.syncing ? '⟳' : '✓';
      line.textContent = account.syncing ? 'Backing up your films…' : account.user?.passkeys
        ? `They’re in your account. ${lock[0].toUpperCase() + lock.slice(1)} gets you back in on any device.`
        : 'They’re in your account, ready for your other devices. Nothing to set up.';
    } else if (account.off) line.textContent = 'Your films stay on this device. Turn backup on to keep them safe and on your other devices.';
    else line.textContent = account.problem && shown.length ? 'Couldn’t reach your backup just now. It will try again.' : 'Every film you make here is backed up as soon as it’s ready. Nothing to set up.';
  }
  function draw() {
    const lock = lockShort();
    const entry = `<div class="acct-entry" hidden><input type="text" data-digits inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="6-digit code" aria-label="Code from your other device"><button class="btn-primary" type="button" data-use>Open my films</button></div>`;
    if (account.signedIn) {
      acct.className = 'account-card in';
      acct.innerHTML = `<span class="acct-icon" aria-hidden="true">✓</span><div class="acct-text"><b>Your films are backed up</b><span></span></div>
        <div class="acct-row"><button class="btn-primary" type="button" data-code>Use on another device</button></div>
        <div class="acct-codebox" hidden><span class="acct-code"></span><span class="acct-codehint">On your other phone or computer: open TakeOne, tap My films → Enter a code, and type these numbers. Works once, for 10 minutes.</span></div>
        ${entry}
        <div class="acct-links"><button class="link" type="button" data-enter>Got a code? Enter it</button>${account.user?.passkeys ? '' : `<button class="link" type="button" data-face>Add ${lock}</button>`}<button class="link" type="button" data-out>Sign out</button></div>
        <p class="acct-msg" aria-live="polite"></p>`;
      const showCode = () => {
        if (!code || code.until < Date.now()) return;
        const box = acct.querySelector('.acct-codebox');
        box.hidden = false;
        box.querySelector('.acct-code').textContent = `${code.code.slice(0, 3)} ${code.code.slice(3)}`;
      };
      showCode();
      acct.querySelector('[data-code]').onclick = async () => {
        busy(true); say('Getting a code…');
        try {
          const r = await account.newCode();
          code = { code: r.code, until: Date.now() + (r.expires_in || 600) * 1000 };
          busy(false); say(''); showCode();
        } catch (e) { busy(false); say(e?.message || 'Couldn’t get a code right now. Please try again.', true); }
      };
      acct.querySelector('[data-face]')?.addEventListener('click', step(() => account.addFaceId(), `Waiting for ${lock}…`, () => `✓ ${lock[0].toUpperCase() + lock.slice(1)} added. It gets you back in on any device.`, faceNotAdded));
      const out = acct.querySelector('[data-out]');
      out.onclick = () => {
        if (out.dataset.sure) { account.signOut(); code = null; toast('Signed out. Your films stay on this device, and backup is off here.', false, 6000); render(); return; }
        out.dataset.sure = '1'; out.textContent = 'Tap again to sign out';
        if (!account.user?.passkeys) say(`To get back in you’ll need ${lock} or a code from another device. If this is your only device, add ${lock} first.`);
        setTimeout(() => { if (out.isConnected) { delete out.dataset.sure; out.textContent = 'Sign out'; } }, 8000);
      };
    } else {
      acct.className = 'account-card';
      acct.innerHTML = `<span class="acct-icon" aria-hidden="true">☁︎</span><div class="acct-text"><b>${account.off ? 'Backup is off on this device' : 'Backed up automatically'}</b><span></span></div>
        ${account.off ? '<div class="acct-row"><button class="btn-primary" type="button" data-on>Turn backup on</button></div>' : ''}
        <div class="acct-row"><button class="${account.off ? 'btn-ghost' : 'btn-primary'}" type="button" data-enter>Enter a code from another device</button></div>
        ${entry}
        <div class="acct-links"><button class="link" type="button" data-in>Sign in with ${lock}</button></div>
        <p class="acct-msg" aria-live="polite"></p>`;
      acct.querySelector('[data-on]')?.addEventListener('click', step(() => account.start(), 'Turning backup on…', () => '✓ Backup is on. Your films are being backed up.'));
      acct.querySelector('[data-in]').onclick = step(() => account.signIn(), `Waiting for ${lock}…`, () => '✓ Signed in. Your films are coming to this device.', notSignedIn);
    }
    // a code from another device: this device joins that account (its own films go there too)
    const box = acct.querySelector('.acct-entry'), digits = box.querySelector('[data-digits]');
    acct.querySelector('[data-enter]').onclick = (e) => {
      box.hidden = false;
      const row = e.currentTarget.closest('.acct-row');
      if (row) row.hidden = true;  // the box takes the button's place
      digits.focus();
    };
    acct.querySelector('[data-use]').onclick = step(() => account.useCode(digits.value), 'Opening your films…', () => '✓ You’re in. Your films are on this device now.');
    digits.addEventListener('keydown', (e) => { if (e.key === 'Enter') acct.querySelector('[data-use]').click(); });
  }

  // ---- the films ----
  function renderFilms() {
    grid.innerHTML = '';
    $('films-empty').hidden = shown.length > 0;
    const now = currentId();
    for (const rec of shown) {
      const item = document.createElement('div');
      item.className = 'film'; item.setAttribute('role', 'listitem');
      const open = document.createElement('button');
      open.type = 'button'; open.className = 'film-open';
      const thumb = document.createElement('span'); thumb.className = 'film-thumb';
      thumb.style.aspectRatio = rec.aspect === '9:16' ? '9 / 16' : rec.aspect === '1:1' ? '1 / 1' : '16 / 9';
      if (rec.thumb) thumb.style.backgroundImage = `url(${rec.thumb})`;
      const title = document.createElement('span'); title.className = 'film-title'; title.textContent = rec.title || 'My film';
      const meta = document.createElement('span'); meta.className = 'film-meta';
      meta.textContent = `${clock(rec.duration || 0)} · ${rec.shotCount || rec.tl?.shots?.length || 0} shots · ${when(rec.updated || rec.created)}`;
      const where = document.createElement('span'); where.className = `film-where ${rec.where}`;
      where.textContent = (account.signedIn || rec.where === 'cloud') ? WHERE[rec.where] : '';
      const state = document.createElement('span'); state.className = 'film-state';
      thumb.append(state);
      if (rec.id === now) { const on = document.createElement('span'); on.className = 'film-on'; on.textContent = '▶ On screen'; thumb.append(on); }
      open.append(thumb, title, meta, where);
      open.setAttribute('aria-label', `Open ${rec.title || 'my film'}`);
      open.onclick = () => openOne(rec, item, state);
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'film-del'; del.setAttribute('aria-label', `Delete ${rec.title || 'this film'}`);
      del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      del.onclick = () => askDelete(rec, item);
      item.append(open, del);
      grid.append(item);
    }
  }

  async function openOne(rec, item, state) {
    if (isBusy()) { toast('Wait until the film being made is ready, then open this one.'); return; }
    if (rec.where === 'cloud') {
      item.classList.add('busy');
      state.textContent = 'Downloading…';
      try {
        await account.download(rec, (p) => { state.textContent = `Downloading ${Math.round(p * 100)}%`; });
      } catch (e) {
        item.classList.remove('busy'); state.textContent = '';
        toast(e?.message || 'Couldn’t download that film right now. Please try again.', true);
        return;
      }
    }
    hide();
    openFilm(rec.id);
  }

  function askDelete(rec, item) {
    item.querySelector('.film-confirm')?.remove();
    const box = document.createElement('div');
    box.className = 'film-confirm';
    const everywhere = account.signedIn && rec.where !== 'device';
    box.innerHTML = `<p></p><div class="row"><button type="button" class="btn-danger" data-yes>Delete</button><button type="button" class="btn-ghost" data-no>Keep</button></div>`;
    box.querySelector('p').textContent = everywhere ? 'Delete this film from all your devices?' : 'Delete this film?';
    box.querySelector('[data-no]').onclick = () => box.remove();
    box.querySelector('[data-yes]').onclick = async () => {
      box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        if (everywhere) await account.remove(rec.id);
        await deleteFilm(rec.id);
        onDeleted(rec.id);
        render();
      } catch (e) {
        box.remove();
        toast(e?.message || 'Couldn’t delete it right now. Please try again.', true);
      }
    };
    item.append(box);
    box.querySelector('[data-no]').focus();
  }

  return { show, hide, refresh: () => { if (!sheet.hidden) render(); } };
}
