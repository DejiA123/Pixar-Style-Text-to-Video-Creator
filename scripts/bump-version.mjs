#!/usr/bin/env node
// Marks a new version of the app, so open copies offer "Update now":
//   node scripts/bump-version.mjs "What's new in a few words"      (1.2.3 → 1.2.4)
//   node scripts/bump-version.mjs --minor "…"                      (1.2.3 → 1.3.0)
// It writes the version and build number into index.html (also onto the script and stylesheet
// addresses, so browsers fetch them afresh), version.json and package.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const minor = args.includes('--minor');
const notes = args.filter((a) => !a.startsWith('--')).join(' ').trim();
const pkg = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
const [a, b, c] = pkg.version.split('.').map(Number);
const version = minor ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
const build = Math.floor(Date.now() / 1000);

let html = readFileSync(root + 'index.html', 'utf8');
const set = (name, value) => {
  const re = new RegExp(`<meta name="${name}" content="[^"]*">`);
  if (!re.test(html)) throw new Error(`index.html has no <meta name="${name}">`);
  html = html.replace(re, `<meta name="${name}" content="${value}">`);
};
set('app-version', version); set('app-build', build);
html = html.replace(/(app\.js|styles\.css)\?v=\d+/g, `$1?v=${build}`);
writeFileSync(root + 'index.html', html);
writeFileSync(root + 'version.json', JSON.stringify({ version, build, notes }, null, 2) + '\n');
pkg.version = version;
writeFileSync(root + 'package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(`TakeOne v${version} (build ${build})${notes ? ': ' + notes : ''}`);
