// Which version of TakeOne this page is, and a pop-up when a newer one has been published.
// The page carries its own version in two <meta> tags; version.json on the site always says what the
// newest one is (scripts/bump-version.mjs writes both). The app looks shortly after opening, every
// few minutes, and whenever you come back to it.
const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.content || '';
export const VERSION = meta('app-version') || '0';
export const BUILD = +meta('app-build') || 0;

const EVERY = 5 * 60000;   // look again every 5 minutes while the page is open
const SNOOZE = 30 * 60000; // "Later" keeps quiet for half an hour
const snoozed = () => { try { return +sessionStorage.getItem('takeone:update-later') || 0; } catch { return 0; } };

export async function latestVersion() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const j = await res.json();
    return j && +j.build ? { version: String(j.version || ''), build: +j.build, notes: String(j.notes || '') } : null;
  } catch { return null; }
}

// Load the newest version: a fresh address, so no cached copy of the page can come back.
export function updateNow(build) {
  const u = new URL(location.href);
  u.searchParams.set('u', String(build || Date.now()));
  location.replace(u.toString());
}

// isBusy(): a film is being made or downloaded (never interrupted); hasFilm(): a finished film is on screen.
export function setupVersion({ isBusy = () => false, hasFilm = () => false, toast = () => {} } = {}) {
  // tidy the address after an update
  try {
    const u = new URL(location.href);
    if (u.searchParams.has('u')) { u.searchParams.delete('u'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
  } catch {}
  const label = document.getElementById('app-version');
  if (label) label.textContent = `TakeOne v${VERSION}`;
  let found = null, lastLook = 0;

  const show = () => {
    if (!found || document.getElementById('update-sheet')) return;
    const box = document.createElement('div');
    box.id = 'update-sheet'; box.className = 'share-sheet update-sheet'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Update available');
    const title = document.createElement('p'); title.className = 'share-title'; title.textContent = 'A new version of TakeOne is ready ✨';
    const what = document.createElement('p'); what.className = 'update-notes';
    what.textContent = [`v${found.version}`, found.notes].filter(Boolean).join(' · ');
    const warn = document.createElement('p'); warn.className = 'update-notes';
    warn.textContent = hasFilm() ? 'Updating reloads the page. Download your film first if you want to keep it. Your story text stays.' : 'It takes a second. Your story text stays.';
    const row = document.createElement('div'); row.className = 'share-row';
    const go = document.createElement('button'); go.type = 'button'; go.className = 'btn-primary'; go.textContent = 'Update now';
    const later = document.createElement('button'); later.type = 'button'; later.className = 'btn-ghost'; later.textContent = 'Later';
    go.onclick = () => { go.disabled = true; go.textContent = 'Updating…'; updateNow(found.build); };
    later.onclick = () => { try { sessionStorage.setItem('takeone:update-later', String(Date.now())); } catch {} box.remove(); };
    row.append(go, later); box.append(title, what, warn, row);
    document.body.appendChild(box);
  };

  // asked: you tapped the version in Settings (always answers); otherwise a quiet look in the background
  const look = async (asked = false) => {
    if (!asked && Date.now() - lastLook < 60000) return;
    lastLook = Date.now();
    const v = await latestVersion();
    if (v && v.build > BUILD) {
      found = v;
      if (label) { label.textContent = `TakeOne v${VERSION} · update ready`; label.classList.add('has-update'); }
      if (isBusy()) { if (asked) toast(`Version ${v.version} is ready. You can update when your film is done.`); return; }
      if (asked || Date.now() - snoozed() > SNOOZE) show();
    } else if (asked) toast(v ? `You're on the latest version (v${VERSION}).` : 'Couldn’t check for updates right now. Please try again in a moment.');
  };

  label?.addEventListener('click', () => look(true));
  setTimeout(look, 15000);
  setInterval(() => { if (document.visibilityState === 'visible') look(); }, EVERY);
  // a film just finished while an update was waiting: offer it within a few seconds
  setInterval(() => { if (found && !isBusy() && document.visibilityState === 'visible' && Date.now() - snoozed() > SNOOZE) show(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') look(); });
  return { look };
}
