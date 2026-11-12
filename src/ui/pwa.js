// TakeOne as an app: installable on the home screen, and able to open without a connection.
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent || '') || (/Macintosh/.test(navigator.userAgent || '') && navigator.maxTouchPoints > 1);

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // on the real site (and on a test machine only when asked: local files change under your hands)
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (location.protocol !== 'https:' && !local) return;
  if (local && !/[?&]sw=1/.test(location.search)) return;
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e)));
}

// The "Install TakeOne" button in Settings: Android and computers get the browser's install prompt;
// an iPhone has no such prompt, so it gets the two taps to do it by hand.
export function setupInstall({ toast = () => {} } = {}) {
  const btn = document.getElementById('install-app');
  if (!btn) return;
  let prompt = null;
  const refresh = () => { btn.hidden = standalone() || !(prompt || isIOS()); };
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); prompt = e; refresh(); });
  addEventListener('appinstalled', () => { prompt = null; btn.hidden = true; toast('TakeOne is installed. Find it on your home screen.'); });
  btn.addEventListener('click', async () => {
    if (prompt) { const p = prompt; prompt = null; p.prompt(); await p.userChoice.catch(() => null); refresh(); return; }
    toast('To install: tap the Share button in your browser, then “Add to Home Screen”.', false, 12000);
  });
  refresh();
}
