import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStory, inflections } from '../src/story/parser.js';
import { SAMPLES } from '../src/story/samples.js';

const byName = (plan, name) => plan.cast.find((c) => c.name === name);

test('inflections cover common forms', () => {
  assert.ok(inflections('run').includes('running'));
  assert.ok(inflections('run').includes('ran'));
  assert.ok(inflections('dance').includes('danced'));
  assert.ok(inflections('dance').includes('dancing'));
  assert.ok(inflections('cry').includes('cried'));
  assert.ok(inflections('hop').includes('hopped'));
});

test('robot story: cast, names, kinds, accessories', () => {
  const plan = parseStory(SAMPLES[0].text);
  assert.equal(plan.title, 'The Robot Who Wanted to Fly');
  const bolt = byName(plan, 'Bolt');
  const mia = byName(plan, 'Mia');
  assert.ok(bolt, 'Bolt found');
  assert.equal(bolt.kind, 'robot');
  assert.equal(bolt.color, 0x3a7bd5);
  assert.ok(mia, 'Mia found');
  assert.equal(mia.kind, 'human');
  assert.equal(mia.gender, 'f');
  assert.ok(mia.accessories.includes('glasses'));
  assert.ok(mia.accessories.includes('backpack'));
  assert.equal(plan.cast.length, 2, JSON.stringify(plan.cast.map((c) => c.name || c.noun)));
  assert.ok(!bolt.accessories.includes('glasses'), 'glasses belong to Mia, not Bolt');
  assert.notEqual(plan.scenes[1].actions[bolt.id], 'fly', 'dreaming of flying is not flying');
});

test('robot story: settings, time, dialogue, actions', () => {
  const plan = parseStory(SAMPLES[0].text);
  const s = plan.scenes;
  assert.equal(s[0].setting, 'city');
  assert.equal(s[1].time, 'night');
  const why = s.find((x) => x.text.startsWith('"Why'));
  assert.equal(why.lines[0].speaker, byName(plan, 'Mia').id);
  assert.equal(why.lines.length, 1);
  const iwant = s.find((x) => x.text.startsWith('"I want'));
  assert.equal(iwant.lines[0].speaker, byName(plan, 'Bolt').id);
  const fly = s.find((x) => /flew over/.test(x.text));
  assert.equal(fly.actions[byName(plan, 'Bolt').id], 'fly');
  assert.equal(fly.time, 'sunset');
  const work = s.find((x) => /worked together/.test(x.text));
  assert.equal(work.setting, 'meadow');
  const build = s.find((x) => x.text.startsWith('"Let\'s build'));
  assert.equal(build.lines[0].speaker, byName(plan, 'Mia').id);
});

test('school story: three humans, classroom', () => {
  const plan = parseStory(SAMPLES[1].text);
  const leo = byName(plan, 'Leo');
  assert.ok(leo);
  assert.equal(leo.gender, 'm');
  assert.ok(leo.accessories.includes('glasses'));
  assert.ok(leo.accessories.includes('hoodie'));
  assert.equal(leo.hair.style, 'spiky');
  assert.ok(byName(plan, 'Sam'));
  assert.ok(byName(plan, 'Ava'));
  assert.ok(plan.scenes.some((s) => s.setting === 'school'));
  const stare = plan.scenes.find((s) => s.text.includes('stared'));
  assert.equal(stare.actions[byName(plan, 'Sam').id], 'look');
  assert.equal(stare.actions[byName(plan, 'Ava').id], 'look');
  assert.notEqual(plan.scenes.at(-1).actions[leo.id], 'walk');
  const ask = plan.scenes.find((s) => s.text.includes('video games?'));
  assert.equal(ask.lines[0].speaker, byName(plan, 'Ava').id);
});

test('dragon story: unnamed dragon and fox', () => {
  const plan = parseStory(SAMPLES[2].text);
  const pip = byName(plan, 'Pip');
  assert.equal(pip.kind, 'fox');
  const dragon = plan.cast.find((c) => c.kind === 'dragon');
  assert.ok(dragon);
  assert.equal(plan.scenes[0].setting, 'forest');
  const night = plan.scenes[plan.scenes.length - 1];
  assert.equal(night.time, 'night');
  assert.ok(night.props.some((p) => p.type === 'campfire'));
});

test('space story', () => {
  const plan = parseStory(SAMPLES[3].text);
  assert.ok(plan.scenes.some((s) => s.setting === 'space'));
  const zib = byName(plan, 'Zib');
  assert.equal(zib.kind, 'alien');
  assert.equal(byName(plan, 'Luna').role, 'astronaut');
});

test('beach story: kite is held', () => {
  const plan = parseStory(SAMPLES.find((s) => s.id === 'beach').text);
  assert.equal(plan.scenes[0].setting, 'beach');
  const carry = plan.scenes.find((s) => /carrying/.test(s.text));
  assert.ok(carry.props.some((p) => p.type === 'kite' && p.holder));
  const gp = plan.cast.find((c) => c.name === 'Grandpa');
  assert.ok(gp && gp.age === 'old' && gp.gender === 'm');
  const ofc = plan.scenes.find((x) => x.text.startsWith('"Of course'));
  assert.equal(ofc.lines[0].speaker, gp.id);
  const soar = plan.scenes.find((x) => /soared/.test(x.text));
  assert.equal(soar.actions[byName(plan, 'Rosie').id], 'run');
});

test('handles empty and plain text robustly', () => {
  const plan = parseStory('');
  assert.equal(plan.scenes.length, 0);
  const p2 = parseStory('a cat sat on a mat. it was happy');
  assert.equal(p2.cast[0].kind, 'cat');
  assert.equal(p2.scenes.length, 2);
});

test('church story: setting, pastor, prayer, godrays', () => {
  const plan = parseStory(SAMPLES.find((s) => s.id === 'church').text);
  assert.ok(plan.scenes.some((s) => s.setting === 'church'));
  const daniel = byName(plan, 'Daniel');
  assert.equal(daniel.gender, 'm');
  assert.ok(daniel.accessories.includes('beard'));
  assert.ok(daniel.accessories.includes('jacket'));
  const pastor = plan.cast.find((c) => c.role === 'pastor');
  assert.ok(pastor, JSON.stringify(plan.cast.map((c) => [c.name, c.noun, c.role])));
  const pray = plan.scenes.find((s) => /prayed/.test(s.text));
  assert.equal(pray.actions[daniel.id], 'pray');
  assert.ok(plan.scenes.some((s) => s.fx.includes('godrays')));
  const love = plan.scenes.find((s) => s.text.includes('God loves'));
  assert.equal(love.lines.find((l) => l.speaker !== 'narrator').speaker, pastor.id);
  assert.ok(byName(plan, 'Grace'));
});
