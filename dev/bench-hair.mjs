// node dev/bench-hair.mjs <style> — times head + hair construction outside the browser
import { faceParams, headShape, buildHeadGeometry } from '../src/engine/characters/head.js';
import { buildHair } from '../src/engine/characters/hair.js';
import { makeRng } from '../src/util.js';
const style = process.argv[2] || 'wavy';
const rng = makeRng(23);
const P = faceParams({ age: 'teen', gender: 'f' }, rng);
let t = performance.now();
headShape(P);
const hg = buildHeadGeometry(P);
console.log('head', (performance.now() - t).toFixed(0), 'ms', hg.attributes.position.count, 'verts');
t = performance.now();
const g = buildHair(P, { style, color: 0x4a2f1f }, rng, { shoulderY: -2.4, shoulderHalfW: 2.6, chestDepth: 1.1 });
let v = 0; g.traverse((o) => { if (o.geometry) v += o.geometry.attributes.position.count; });
console.log('hair', style, (performance.now() - t).toFixed(0), 'ms', v, 'verts');
