// End-to-end check: make a movie in the real app and export it.
// node dev/e2e.mjs <outdir> [voice=browser|neural] [story-file] [export=1]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }
const [, , outDir = '.', voice = 'browser', storyFile = '', doExport = '1', aspect = '16:9'] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
// serve via the container IP: loopback requests would otherwise be sent to the proxy
// localhost is a secure context (needed for WebCodecs); a PAC script sends
// only external traffic through the HTTPS proxy.
const host = 'localhost';
const px = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;
const pac = px ? `function FindProxyForURL(url, h) { if (h === 'localhost' || h === '127.0.0.1') return 'DIRECT'; return 'PROXY ${px.host}'; }` : null;
const pacArgs = pac ? [`--proxy-pac-url=data:application/x-javascript-config;base64,${Buffer.from(pac).toString('base64')}`] : [];
const browser = await pw.chromium.launch({ args: [...pacArgs, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true, acceptDownloads: true });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (!/GPU stall|Automatic fallback/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://${host}:8123/index.html`);
await page.waitForFunction(() => !!window.__storyreel);
console.log('secure:', await page.evaluate(() => ({ secure: isSecureContext, vc: typeof VideoEncoder, ac: typeof AudioEncoder })));
if (storyFile) await page.fill('#story', fs.readFileSync(storyFile, 'utf8'));
await page.evaluate(() => { document.getElementById('settings').open = true; });
await page.selectOption('#voice-engine', voice);
await page.selectOption('#aspect', aspect);
await page.selectOption('#quality', 'low');
const t0 = Date.now();
await page.click('#make');
let ok = false;
while (Date.now() - t0 < 900000) {
  const st = await page.evaluate(() => ({ player: !!window.__storyreel.player, busy: window.__storyreel.busy, steps: [...document.querySelectorAll('#steps li')].map((l) => l.className + ':' + l.textContent).join(' | '), toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent }));
  if (st.player && !st.busy) { ok = true; break; }
  if (!st.busy && !st.player) { logs.push('FAILED: ' + st.steps + ' ' + st.toast); break; }
  await page.waitForTimeout(2000);
}
console.log('make:', ok, ((Date.now() - t0) / 1000).toFixed(1) + 's');
if (ok) {
  const info = await page.evaluate(() => { const s = window.__storyreel; s.player.pause(); return { dur: s.timeline.duration, shots: s.timeline.shots.length, voice: s.hasVoiceAudio, sr: s.soundtrack.sampleRate, peak: Math.max(...Array.from(s.soundtrack.getChannelData(0).filter((_, i) => i % 97 === 0)).map(Math.abs)) }; });
  console.log('info', JSON.stringify(info));
  for (const f of [0.08, 0.35, 0.6]) {
    await page.evaluate((f) => window.__storyreel.player.seek(window.__storyreel.timeline.duration * f), f);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/app_${Math.round(f * 100)}.png`, timeout: 300000 });
  }
  if (doExport === '1') {
    await page.selectOption('#export-res', '720');
    await page.evaluate(() => { const f = window.__storyreel.film; const orig = f.renderAt.bind(f); window.__frames = 0; f.renderAt = (t, o) => { window.__frames++; return orig(t, o); }; });
    const dlP = page.waitForEvent('download', { timeout: 7000000 });
    const te = Date.now();
    await page.click('#export');
    const dl = await dlP;
    const file = `${outDir}/${dl.suggestedFilename()}`;
    await dl.saveAs(file);
    console.log('export:', file, ((Date.now() - te) / 1000).toFixed(1) + 's', 'frames rendered', await page.evaluate(() => window.__frames));
    await page.waitForTimeout(500);
    console.log('toast:', await page.evaluate(() => document.getElementById('toast').textContent));
  }
}
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
