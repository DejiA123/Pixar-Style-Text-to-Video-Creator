import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStory } from '../src/story/parser.js';
import { applyDialogue, dialogueRequest } from '../src/ai/dialogue.js';
import { SAMPLES } from '../src/story/samples.js';

const plan = (id) => parseStory(SAMPLES.find((s) => s.id === id).text);
const idOf = (p, n) => p.cast.find((c) => c.name === n || c.noun === n).id;

test('a shot shows only the people the director put in it', () => {
  const p = plan('grandma');
  const zoe = idOf(p, 'Zoe'), grandma = idOf(p, 'Grandma'), daddy = idOf(p, 'Daddy');
  const i = p.scenes.findIndex((s) => s.text.includes('Dear God'));
  p.scenes[i].characters.push(daddy);  // as if the story had put him there
  applyDialogue(p, { cast: [], scenes: [
    { index: i, shot: "Zoe kneels by her bed with Grandma, eyes closed, a candle glowing", lines: [
      { speaker: zoe, text: 'Dear God, please make my daddy strong again.' },
      { speaker: daddy, text: 'I can hear you, Zoe.' }] },
  ] });
  assert.deepEqual(p.scenes[i].characters, [zoe, grandma]);
  assert.deepEqual(p.scenes[i].lines.map((l) => l.speaker), [zoe], 'someone who is not there does not speak');
});

test('an empty place stays empty, and a crowd is named by its plural', () => {
  const p = plan('christmas');
  const shepherds = p.cast.find((c) => c.crowd).id, baby = idOf(p, 'baby');
  const i = p.scenes.findIndex((s) => s.text.includes('hurried to the stable'));
  applyDialogue(p, { cast: [], scenes: [{ index: i, shot: 'The shepherds kneel beside the baby in the manger', lines: [{ speaker: shepherds, text: 'A Savior, here in a stable!' }] }] });
  assert.deepEqual(p.scenes[i].characters, [shepherds, baby]);
  const req = dialogueRequest(p, '');
  assert.match(req.cast.find((c) => c.id === shepherds).name, /shepherds/i);
  assert.match(req.cast.find((c) => c.id === baby).about, /cannot talk/);

  const e = plan('easter');
  const j = e.scenes.findIndex((s) => s.text.includes('tomb was empty'));
  applyDialogue(e, { cast: [], scenes: [{ index: j, shot: 'The heavy stone is rolled away from the empty rock tomb, morning light pouring in', lines: [] }] });
  assert.deepEqual(e.scenes[j].characters, []);
});

test('people the director places somewhere else are not in the shot', () => {
  const p = plan('christmas');
  const i = p.scenes.findIndex((s) => s.text.includes('watching their sheep'));
  applyDialogue(p, { cast: [], scenes: [{ index: i, shot: 'On a quiet hillside, the shepherds watch sheep under a starry sky. Mary and Joseph are in the stable. A distant light glows.', lines: [] }] });
  const names = p.scenes[i].characters.map((id) => p.cast.find((c) => c.id === id).noun || p.cast.find((c) => c.id === id).name);
  assert.ok(!names.includes('Mary') && !names.includes('Joseph'), names.join(','));
  assert.ok(names.includes('shepherd'));
});
