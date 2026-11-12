// node --test tests/account.test.mjs — the account's address and passkey encoding (src/ui/account.js),
// and the motion prompts' guard against extra arms (src/ai/freefilm.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serviceCandidates, enc, dec } from '../src/ui/account.js';

test('the account service sits at the AI studio’s link, with "library" for "serve"', () => {
  assert.deepEqual(serviceCandidates('https://dejiaugustine--storyreel-serve.us-east.modal.run'),
    ['https://dejiaugustine--storyreel-library.us-east.modal.run', 'https://dejiaugustine--storyreel-library.modal.run']);
  assert.deepEqual(serviceCandidates('https://me--storyreel-serve.modal.run/'), ['https://me--storyreel-library.modal.run']);
  assert.deepEqual(serviceCandidates('https://abc123-7860.proxy.runpod.net'), []);  // a pod has no accounts
  assert.deepEqual(serviceCandidates(''), []);
});

test('passkey bytes go to and from base64url unchanged', () => {
  for (const n of [0, 1, 2, 3, 16, 32, 65, 300]) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
    const s = enc(b.buffer);
    assert.match(s, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual([...dec(s)], [...b]);
  }
  assert.equal(enc(new Uint8Array([251, 255]).buffer), '-_8');
});

test('motion prompts don’t ask for arm movements (video models grow an arm to do them)', () => {
  const src = readFileSync(new URL('../src/ai/freefilm.js', import.meta.url), 'utf8');
  const motion = src.slice(src.indexOf('const MOTION = {'), src.indexOf('};', src.indexOf('const MOTION = {')));
  assert.ok(motion.length > 200);
  for (const bad of [/raises? (one|an|his|her|their) arm/i, /arms? (swinging|pumping|raised|waving)/i, /with arms/i, /reaching for/i, /wiping/i, /gestur/i]) {
    assert.doesNotMatch(motion, bad);
  }
});
