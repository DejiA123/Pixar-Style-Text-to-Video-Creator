// Runs dev/clip-export-test.html in Chromium: frame-exact export of an AI film made of video clips.
//   node dev/clip-export.mjs <clips-dir> <out-dir> compare        old vs new export, frame by frame (NOOLD=1: new only)
//   node dev/clip-export.mjs <clips-dir> <out-dir> export [old]   a whole download (out-dir/film.mp4)
// <clips-dir> holds c0.mp4 … c7.mp4, e.g. made with ffmpeg:
//   ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=24:duration=5 -c:v libx264 -g 250 -bf 2 -pix_fmt yuv420p c0.mp4
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }

const root = fileURLToPath(new URL('..', import.meta.url));
const [, , clipsDir, outDir = '.', mode = 'compare', old = ''] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mp4': 'video/mp4', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = p.startsWith('/dev/clips/') ? path.join(clipsDir, path.basename(p)) : path.join(root, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(0, 'localhost');
await new Promise((r) => server.on('listening', r));
const port = server.address().port;

const browser = await pw.chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
const qs = new URLSearchParams({ mode, ...(process.env.NOOLD ? { noold: '1' } : {}), ...(old ? { old: '1' } : {}), ...(process.env.STOP_AT ? { stopAt: process.env.STOP_AT } : {}) });
await page.goto(`http://localhost:${port}/dev/clip-export-test.html?${qs}`);
await page.waitForFunction(() => window.__ready, null, { timeout: 1800000, polling: 1000 });
const r = await page.evaluate(() => window.__result);
if (r.b64) { fs.writeFileSync(path.join(outDir, 'film.mp4'), Buffer.from(r.b64, 'base64')); delete r.b64; }
console.log(JSON.stringify(r, null, 1));
await browser.close();
server.close();
