import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlobAssembler } from '../src/film/blobsink.js';

const bytes = async (b) => new Uint8Array(await b.arrayBuffer());

test('a file written in pieces, with headers filled in afterwards, comes out byte for byte', async () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let round = 0; round < 6; round++) {
    const want = new Uint8Array(11 * 1024 * 1024 + rnd(50000));
    for (let i = 0; i < want.length; i += 1 + rnd(7)) want[i] = rnd(256);
    const a = new BlobAssembler();
    // mostly appends of odd sizes…
    const wrong = [];
    for (let pos = 0; pos < want.length;) {
      const n = Math.min(want.length - pos, 1 + rnd(700000));
      const piece = want.slice(pos, pos + n);
      if (rnd(4) === 0) { wrong.push([pos, n]); piece.fill(0); }  // …some written as placeholders first
      a.write(piece, pos);
      pos += n;
    }
    // …then the placeholders are filled in, in any order, some in two halves, across piece borders
    wrong.sort(() => rnd(3) - 1);
    for (const [pos, n] of wrong) {
      const h = rnd(n + 1);
      a.write(want.slice(pos + h, pos + n), pos + h);
      a.write(want.slice(pos, pos + h), pos);
    }
    // a rewrite spanning several pieces, and one that runs past the end
    a.write(want.slice(3_000_000, 9_500_000), 3_000_000);
    const got = await bytes(a.blob('video/mp4'));
    assert.equal(got.length, want.length);
    assert.ok(Buffer.from(got).equals(Buffer.from(want)), `round ${round}`);
  }
});

test('writes past the end leave zeros in between, and a rewrite may extend the file', async () => {
  const a = new BlobAssembler();
  a.write(Uint8Array.of(1, 2, 3), 0);
  a.write(Uint8Array.of(9, 9), 6);
  a.write(Uint8Array.of(7, 7, 7, 7), 5);  // overlaps the end and adds one byte
  assert.deepEqual([...(await bytes(a.blob('x/y')))], [1, 2, 3, 0, 0, 7, 7, 7, 7]);
  assert.equal(a.blob('x/y').type, 'x/y');
});

test('it works as a stream target', async () => {
  const a = new BlobAssembler();
  const w = a.writable().getWriter();
  await w.write({ type: 'write', data: Uint8Array.of(0, 0, 5, 6), position: 0 });
  await w.write({ type: 'write', data: Uint8Array.of(3, 4), position: 0 });
  await w.close();
  assert.deepEqual([...(await bytes(a.blob('')))], [3, 4, 5, 6]);
});
