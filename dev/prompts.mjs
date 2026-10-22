// Prompt-accuracy check: node dev/prompts.mjs
import { parseStory } from '../src/story/parser.js';
const P = [
  "I want a 'Bratz' style cartoon girl brushing her hair in the mirror",
  'A church boy goes to church drums and gets saved',
  'make a video of a little boy praying with his mum before school',
  'Two kids praying at the kitchen table',
  'a teenage boy with glasses and a backpack walking through a neon city at night',
  'Create a cartoon of a dog chasing a cat in the park',
  'A grandma baking cookies in the kitchen with her granddaughter',
  'A pastor preaching to the congregation on Sunday',
  'Show me a superhero flying over the city',
  'a woman with curly hair drinking coffee by the window',
  'A man and a woman dancing at a wedding',
  'a black boy with afro hair in a green hoodie smiling',
  'princess in a pink dress holding a candle',
  'a robot cooking breakfast',
  'kids playing football at school',
  'A girl crying because she lost her teddy bear',
  'An astronaut walking on the moon',
  'a family having a picnic on the beach at sunset',
];
for (const t of P) {
  const p = parseStory(t);
  const sc = p.scenes[0] || {};
  const bad = !p.cast.length ? '  <-- NO CHARACTER' : '';
  console.log(`${t}\n   cast=${p.cast.map((c) => `${c.noun || c.name}(${c.age},${c.gender}${c.style ? ',' + c.style : ''}${(c.accessories || []).length ? ',' + c.accessories.join('/') : ''}${c.hair ? ',' + JSON.stringify(c.hair) : ''})`).join(' ')} set=${sc.setting}/${sc.time} acts=${JSON.stringify(sc.actions)} props=${(sc.props || []).map((x) => x.type + (x.holder ? '@' + x.holder : '')).join(',')}${bad}`);
}
