// Headless screenshot helper: node dev/shot.mjs <url-path> <out.png> [w] [h]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }
const { chromium } = pw;
const [, , path, out, w = '720', h = '900', wait = '0'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:8123/${path}`, { waitUntil: 'commit', timeout: 120000 });
let failed = false;
page.on('pageerror', () => { failed = true; });
const t0 = Date.now();
while (!failed && Date.now() - t0 < 240000) {
  if (await page.evaluate(() => window.__ready === true).catch(() => false)) break;
  await page.waitForTimeout(250);
}
if (failed) logs.push('FAILED (page error)');
if (+wait) await page.waitForTimeout(+wait);
await page.screenshot({ path: out, timeout: 180000 });
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 40).join('\n'));
await browser.close();
