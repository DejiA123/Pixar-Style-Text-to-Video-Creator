// TakeOne's service worker: the app opens instantly and even without a connection (films still
// need the internet: they are made on the AI server).
//
// It never serves an old version while you're online:
// - the page, scripts and styles come from the network first; the saved copy is only a fallback
//   when the network doesn't answer (offline, or very slow);
// - version.json is never saved, so "a new version is ready" is always the truth;
// - pictures, voices, fonts and the bundled libraries come from the saved copy at once and are
//   refreshed in the background.
// Only this site's own files are handled: requests to the AI server pass straight through.
const CACHE = 'takeone-v1';
const SHELL = ['./', 'manifest.webmanifest', 'assets/brand/takeone.svg', 'assets/brand/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// saved under the address without its "?v=…" part, so each file is kept once
const keyOf = (url) => url.origin + (url.pathname.endsWith('/index.html') ? url.pathname.slice(0, -10) : url.pathname);
const save = async (key, res) => { if (res && res.ok && res.type === 'basic') { const c = await caches.open(CACHE); await c.put(key, res.clone()); } return res; };
const saved = async (key) => (await caches.open(CACHE)).match(key);

async function networkFirst(req, key) {
  const fresh = fetch(req).then((res) => save(key, res));
  // a very slow network: after 5 s use the saved copy if there is one (the fresh one is still saved when it arrives)
  const slow = new Promise((r) => setTimeout(r, 5000)).then(() => saved(key));
  try { return (await Promise.race([fresh, slow.then((c) => c || fresh)])) || (await fresh); }
  catch { const c = await saved(key); if (c) return c; throw new Error('offline'); }
}

async function savedFirst(req, key) {
  const c = await saved(key);
  const fresh = fetch(req).then((res) => save(key, res)).catch(() => null);
  return c || (await fresh) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // the AI server, fonts, anything else: untouched
  if (url.pathname.endsWith('/version.json') || url.pathname.endsWith('/sw.js')) return;  // always from the network
  const key = keyOf(url);
  const code = req.mode === 'navigate' || /\.(?:html|js|mjs|css|json|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');
  const library = url.pathname.includes('/vendor/');
  e.respondWith(code && !library ? networkFirst(req, key) : savedFirst(req, key));
});
