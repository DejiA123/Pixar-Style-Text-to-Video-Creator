// My films: every film kept on this device and in your account, to watch again, download or redo a
// shot; and the one-tap account (Face ID) that backs them up and brings them to your other devices.
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

// openFilm(id): shows a kept film; isBusy(): a film is being made, redone or downloaded;
// currentId(): the film on screen; onDeleted(id): a film was deleted.
export function setupMyFilms({ openFilm, isBusy, toast, currentId = () => null, onDeleted = () => {} }) {
  const sheet = $('films'), grid = $('films-grid'), acct = $('account-card');
  let shown = [], seq = 0;
  const show = () => {
    sheet.hidden = false;
    document.body.classList.add('sheet-open');
    render();
    account.prepare();  // Face ID needs the passkey request ready the moment you tap
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
    renderFilms();
  }

  // ---- the account card ----
  function renderAccount(msg = '') {
    acct.hidden = !account.available;
    if (acct.hidden) return;
    acct.innerHTML = '';
    if (account.signedIn) {
      acct.className = 'account-card in';
      const backing = !!account.syncing;
      acct.innerHTML = `<span class="acct-icon" aria-hidden="true">${backing ? '⟳' : '✓'}</span><div class="acct-text"><b></b><span></span></div><button class="link" type="button" data-out>Sign out</button>`;
      acct.querySelector('b').textContent = `Hi ${account.user?.name && account.user.name !== 'TakeOne' ? account.user.name : 'there'}`;
      acct.querySelector('.acct-text span').textContent = msg || (backing ? 'Backing up your films…' : 'Your films are backed up and on all your devices.');
      acct.querySelector('[data-out]').onclick = () => { account.signOut(); renderAccount('Signed out. Your films stay on this device.'); render(); };
      return;
    }
    const lock = lockName();
    acct.className = 'account-card';
    acct.innerHTML = `<span class="acct-icon" aria-hidden="true">☁︎</span><div class="acct-text"><b>Keep your films safe</b><span></span></div>
      <div class="acct-row"><input type="text" data-name placeholder="Your name (optional)" autocomplete="given-name" maxlength="40" aria-label="Your name (optional)"><button class="btn-primary" type="button" data-up>Create my account</button></div>
      <button class="link" type="button" data-in>I already have an account</button><p class="acct-msg" aria-live="polite"></p>`;
    acct.querySelector('.acct-text span').textContent = `Back them up and watch them on your other devices. No password: just ${lock}.`;
    const say = (t, err = false) => { const p = acct.querySelector('.acct-msg'); p.textContent = t; p.classList.toggle('err', err); };
    if (msg) say(msg);
    const busy = (on) => acct.querySelectorAll('button, input').forEach((b) => { b.disabled = on; });
    const go = (fn, waiting) => async () => {
      busy(true); say(waiting);
      try {
        const user = await fn();
        toast(`✓ Your account is ready${user?.name && user.name !== 'TakeOne' ? `, ${user.name}` : ''}. Your films are being backed up.`, false, 7000);
        render();
      } catch (e) {
        busy(false);
        if (e?.code === 'cancelled') say('');
        else if (e?.code === 'tap-again') say(e.message);
        else say(e?.message || 'That didn’t work. Please try again.', true);
      }
    };
    acct.querySelector('[data-up]').onclick = go(() => account.signUp(acct.querySelector('[data-name]').value), `Waiting for ${lock}…`);
    acct.querySelector('[data-in]').onclick = go(() => account.signIn(), `Waiting for ${lock}…`);
    acct.querySelector('[data-name]').addEventListener('keydown', (e) => { if (e.key === 'Enter') acct.querySelector('[data-up]').click(); });
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
