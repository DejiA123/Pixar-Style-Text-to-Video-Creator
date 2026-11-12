import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// scripts/bump-version.mjs keeps these together; if they drift, open copies never hear of an update
test('the page, version.json and package.json agree on the version', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const v = JSON.parse(readFileSync(new URL('../version.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const meta = (n) => html.match(new RegExp(`<meta name="${n}" content="([^"]*)">`))?.[1];
  assert.equal(meta('app-version'), v.version);
  assert.equal(+meta('app-build'), v.build);
  assert.equal(pkg.version, v.version);
  assert.ok(v.build > 1700000000, 'a real build number');
  for (const f of ['app.js', 'styles.css']) assert.equal(html.match(new RegExp(`${f.replace('.', '\\.')}\\?v=(\\d+)`))?.[1], String(v.build), `${f} is fetched afresh with this build`);
});
