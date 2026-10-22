// Rule-based story understanding: turns free text into a StoryPlan the film
// engine can stage. No network, no model — just a careful reading of English.
//
// StoryPlan = {
//   title, cast: [CastMember], scenes: [Scene], protagonist
// }
// CastMember = { id, name, noun, kind, gender, age, role, color, size,
//                hair: {color, style}, accessories: [], traits: [], seed }
// Scene = { index, text, setting, time, weather, characters: [id], focus,
//           actions: {id: action}, emotions: {id: emotion}, target,
//           props: [{type, holder}], lines: [{speaker, text}], fx: [],
//           mood, shot, isNewSetting }

import {
  CHARACTER_NOUNS, NAMES_F, NAMES_M, SETTINGS, TIMES, WEATHER, ACTIONS, IRREGULAR,
  EMOTIONS, PROPS, HOLD_VERBS, FX, STOPWORDS_CAPS, SMALL_KINDS, BIG_KINDS,
} from './lexicon.js';
import { hashString } from '../util.js';

const SPEECH_VERBS = /\b(said|says|say|asked|asks|shouted|shouts|yelled|yells|whispered|whispers|replied|replies|answered|exclaimed|called|added|announced|muttered|mumbled|cheered|gasped|screamed|roared|squeaked|beeped|chirped|barked|meowed|giggled|laughed|sang|told|cried|begged|wondered|explained|insisted|declared|promised|grumbled|sighed)\b/i;

const COLORS = {
  red: 0xd9443b, crimson: 0xb81d3a, orange: 0xf08a24, yellow: 0xf5c518, golden: 0xe8b13a, gold: 0xe8b13a,
  green: 0x4caf50, teal: 0x1fa79a, blue: 0x3a7bd5, purple: 0x8a4fd0, violet: 0x8a4fd0, pink: 0xf07ab0,
  white: 0xf3f1ec, black: 0x2a2a31, brown: 0x8b5a2b, gray: 0x8d939b, grey: 0x8d939b, silver: 0xc4cad3,
  rainbow: 0xff6fb5, ginger: 0xe07a30, tabby: 0xd28a3c, spotted: 0xf3f1ec, fluffy: null,
};
const SIZE_WORDS = { little: 0.82, tiny: 0.66, small: 0.82, baby: 0.7, wee: 0.75, big: 1.25, giant: 1.6, huge: 1.5, enormous: 1.6, tall: 1.15, large: 1.25, chubby: 1.05, young: 0.9 };
const TRAIT_WORDS = ['brave', 'shy', 'clever', 'grumpy', 'curious', 'kind', 'silly', 'wise', 'lonely', 'cheerful', 'clumsy', 'tiny', 'friendly', 'smart', 'nerdy', 'cool', 'lazy', 'sleepy', 'happy', 'sad', 'old', 'young', 'magical', 'rusty', 'shiny', 'fluffy'];
const HAIR_COLORS = { black: 0x1d1a1a, brown: 0x5a3a24, chestnut: 0x6b3a1f, blonde: 0xe2c07a, blond: 0xe2c07a, red: 0xa8432a, ginger: 0xc0612b, auburn: 0x8a3b24, gray: 0x9a9a9a, grey: 0x9a9a9a, white: 0xe8e6e1, silver: 0xc9cdd2, pink: 0xf08ab8, blue: 0x3a6fd5, purple: 0x7d4fc0, green: 0x45a25a };
const HAIR_STYLES = ['curly', 'spiky', 'long', 'short', 'wavy', 'messy', 'braided', 'braids', 'ponytail', 'bun', 'pigtails', 'afro', 'bald', 'quiff', 'mohawk', 'straight'];
const ACCESSORY_WORDS = {
  glasses: ['glasses', 'spectacles', 'goggles'],
  backpack: ['backpack', 'rucksack', 'school bag'],
  hoodie: ['hoodie', 'hood'],
  jacket: ['jacket', 'coat'],
  hat: ['hat', 'cap'],
  scarf: ['scarf'],
  cape: ['cape', 'cloak'],
  dress: ['dress', 'gown', 'skirt'],
  bowtie: ['bow tie', 'bowtie'],
  headphones: ['headphones'],
  earrings: ['earrings'],
  beard: ['beard'],
  mustache: ['mustache', 'moustache'],
  freckles: ['freckles'],
  crown: ['crown', 'tiara'],
};

const SHIRT_COLORS = [0x3a6fb5, 0xd9643b, 0x4b8f5a, 0x7d5ab8, 0xc9a43a, 0x4a4f5c, 0xb8455a, 0x3a9a9a, 0xe0e0dc, 0x6f7d8c];

export function normalizeText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[“”„«»]/g, '"')
    .replace(/[‘’‛]/g, "'")
    .replace(/…/g, '...')
    .replace(/[–—]/g, ' - ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function wordRe(src, flags = 'i') {
  return new RegExp(`(?:^|[^a-z'])(?:${src})(?=$|[^a-z])`, flags);
}

// All inflections of a base verb: walk → walk, walks, walked, walking.
export function inflections(base) {
  if (base.includes(' ')) {
    const [v, ...rest] = base.split(' ');
    return inflections(v).map((f) => [f, ...rest].join(' '));
  }
  const out = new Set([base]);
  const last = base[base.length - 1];
  const cvc = /[^aeiou][aeiou][^aeiouwxy]$/.test(base) && base.length <= 4;
  if (/(s|sh|ch|x|z|o)$/.test(base)) out.add(base + 'es'); else if (/[^aeiou]y$/.test(base)) out.add(base.slice(0, -1) + 'ies'); else out.add(base + 's');
  if (last === 'e') { out.add(base + 'd'); out.add(base.slice(0, -1) + 'ing'); }
  else if (/[^aeiou]y$/.test(base)) { out.add(base.slice(0, -1) + 'ied'); out.add(base + 'ing'); }
  else if (cvc) { out.add(base + last + 'ed'); out.add(base + last + 'ing'); out.add(base + 'ed'); out.add(base + 'ing'); }
  else { out.add(base + 'ed'); out.add(base + 'ing'); }
  for (const [irr, b] of Object.entries(IRREGULAR)) if (b === base) out.add(irr);
  return [...out];
}

// Pre-build regexes for actions (verb → action).
const ACTION_MATCHERS = [];
for (const [action, verbs] of Object.entries(ACTIONS)) {
  for (const v of verbs) {
    const forms = inflections(v).map(escapeRe).join('|');
    ACTION_MATCHERS.push({ action, re: new RegExp(`(?:^|[^a-z'])(${forms})(?=$|[^a-z])`, 'gi') });
  }
}
// More visual actions win when a character has several verbs in one sentence.
const ACTION_PRIORITY = ['fly', 'swim', 'chase', 'run', 'dance', 'jump', 'climb', 'fall', 'hug', 'cheer', 'magic', 'sleep', 'cry', 'laugh', 'ride', 'sneak', 'walk', 'play', 'eat', 'build', 'cook', 'paint', 'read', 'sing', 'discover', 'hold', 'wave', 'point', 'bow', 'shiver', 'stomp', 'hide', 'sit', 'think', 'look', 'talk', 'stand'];

function settingMatchers() {
  const out = [];
  for (const [setting, pats] of Object.entries(SETTINGS)) {
    for (const p of pats) out.push({ setting, re: wordRe(p), weight: p.includes(' ') ? 2 : 1, src: p });
  }
  return out;
}
const SETTING_MATCHERS = settingMatchers();

function splitSentences(text) {
  // Split on paragraph breaks first, then on sentence terminators outside quotes.
  const paragraphs = text.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const p of paragraphs) {
    let buf = '';
    let inQuote = false;
    let quoteStartInBuf = -1;
    for (let i = 0; i < p.length; i++) {
      const ch = p[i];
      buf += ch;
      if (ch === '"') {
        if (!inQuote) { inQuote = true; quoteStartInBuf = buf.length - 1; }
        else {
          inQuote = false;
          // A closing quote ending in a terminator, with a lead-in tag before it,
          // ends the sentence: Mia said, "Let's go!" They ran...
          const inner = buf.slice(quoteStartInBuf + 1, -1).trim();
          const leadIn = buf.slice(0, quoteStartInBuf).trim();
          const next = p.slice(i + 1).trimStart();
          if (/[.!?]$/.test(inner) && leadIn.length > 0 && /^[A-Z"]/.test(next)) {
            out.push(buf.trim()); buf = '';
          }
        }
        continue;
      }
      if (!inQuote && /[.!?]/.test(ch)) {
        // swallow runs like "!!" or "?!" or "..."
        while (i + 1 < p.length && /[.!?]/.test(p[i + 1])) { buf += p[++i]; }
        const next = p.slice(i + 1);
        if (next.length === 0 || /^\s+["A-Za-z0-9(]/.test(next) || /^\s*$/.test(next)) {
          // avoid splitting titles like "Mr. Smith"
          if (/\b(Mr|Mrs|Ms|Dr|St|Prof)\.$/.test(buf)) continue;
          out.push(buf.trim()); buf = '';
        }
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.filter((s) => /[A-Za-z0-9]/.test(s));
}

function extractTitle(text) {
  const lines = text.split('\n');
  const first = lines[0].trim();
  const m = first.match(/^title\s*:\s*(.+)$/i);
  if (m) return { title: m[1].trim(), body: lines.slice(1).join('\n').trim() };
  if (lines.length > 1 && first.length > 0 && first.length <= 70 && !/[.!?"]$/.test(first) && first.split(' ').length <= 10) {
    return { title: first.replace(/^#+\s*/, ''), body: lines.slice(1).join('\n').trim() };
  }
  return { title: null, body: text };
}

function makeTitleFromCast(cast, setting) {
  const hero = cast[0];
  if (!hero) return 'A Little Story';
  const who = hero.name || `The ${cap(hero.noun)}`;
  const where = { space: 'in Space', forest: 'and the Enchanted Forest', city: 'and the Big City', underwater: 'Under the Sea', castle: 'and the Castle', beach: 'at the Beach', snow: 'and the Winter Wonder' }[setting];
  return where ? `${who} ${where}` : hero.name ? `The Adventures of ${hero.name}` : `The ${cap(hero.noun)}'s Big Day`;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---------------------------------------------------------------------------
// Cast detection
// ---------------------------------------------------------------------------
function detectCast(sentences) {
  const cast = [];
  const byName = new Map();
  const byNoun = new Map();
  const nounKeys = Object.keys(CHARACTER_NOUNS).sort((a, b) => b.length - a.length);
  const nounAlt = nounKeys.map(escapeRe).join('|');

  const addMember = (props) => {
    const id = `c${cast.length + 1}`;
    const m = {
      id, name: null, noun: null, kind: 'human', gender: 'n', age: 'adult', role: null, color: null, size: 1,
      hair: { color: null, style: null }, accessories: [], traits: [], mentions: 0, firstSentence: 0, ...props,
    };
    cast.push(m);
    if (m.name) byName.set(m.name, m);
    if (m.noun && !m.name) byNoun.set(m.noun, m);
    return m;
  };

  const nounInfo = (noun) => CHARACTER_NOUNS[noun] || CHARACTER_NOUNS[noun.replace(/s$/, '')];
  const adjectivesBefore = (lowerText, idx) => {
    const before = lowerText.slice(Math.max(0, idx - 48), idx).split(/[^a-z-]+/).filter(Boolean).slice(-4);
    return before;
  };
  const applyAdjectives = (m, adjs) => {
    for (const a of adjs) {
      if (a in COLORS && COLORS[a] != null && !m.color) m.color = COLORS[a];
      if (a in SIZE_WORDS) m.size = SIZE_WORDS[a];
      if (TRAIT_WORDS.includes(a) && !m.traits.includes(a)) m.traits.push(a);
      if (a === 'old' && m.kind === 'human' && m.age === 'adult') m.age = 'old';
      if (a === 'young' && m.kind === 'human' && m.age === 'adult') m.age = 'teen';
    }
  };

  sentences.forEach((s, si) => {
    const lower = s.toLowerCase();
    // 1) "a little robot named Bolt" / "a girl called Mia"
    const reNamed = new RegExp(`\\b(${nounAlt})\\s+(?:named|called|whose name was)\\s+([A-Z][a-zA-Z'-]+)`, 'g');
    let m;
    while ((m = reNamed.exec(s.replace(/\b([A-Z])([a-z]+)\b/g, (w) => w)))) {
      const noun = m[1].toLowerCase();
      const name = m[2];
      if (byName.has(name)) continue;
      const info = nounInfo(noun);
      if (!info) continue;
      const mem = addMember({ name, noun, ...info, firstSentence: si });
      applyAdjectives(mem, adjectivesBefore(lower, lower.indexOf(m[0].toLowerCase())));
    }
    // case-insensitive fallback for nouns that start the sentence ("Robot named Bolt")
    const reNamedI = new RegExp(`\\b(${nounAlt})\\s+(?:named|called)\\s+([A-Za-z][a-zA-Z'-]+)`, 'gi');
    while ((m = reNamedI.exec(s))) {
      const name = cap(m[2]);
      if (byName.has(name)) continue;
      const noun = m[1].toLowerCase();
      const info = nounInfo(noun);
      if (!info) continue;
      const mem = addMember({ name, noun, ...info, firstSentence: si });
      applyAdjectives(mem, adjectivesBefore(lower, m.index));
    }
    // 2) "Bolt the robot" / "Mia, a curious girl,"
    const reTitled = new RegExp(`\\b([A-Z][a-z]+)(?:,\\s+(?:a|an|the)\\s+(?:[a-z-]+\\s+){0,3}|\\s+the\\s+(?:[a-z-]+\\s+){0,2})(${nounAlt})\\b`, 'g');
    while ((m = reTitled.exec(s))) {
      const name = m[1];
      if (STOPWORDS_CAPS.has(name)) continue;
      const noun = m[2].toLowerCase();
      const info = nounInfo(noun);
      if (!info) continue;
      if (byName.has(name)) {
        const ex = byName.get(name);
        if (!ex.noun) Object.assign(ex, { noun, ...info, gender: info.gender && info.gender !== 'n' ? info.gender : ex.gender });
        continue;
      }
      const mem = addMember({ name, noun, ...info, firstSentence: si });
      applyAdjectives(mem, m[0].toLowerCase().split(/[^a-z-]+/));
    }
  });

  // 2b) "Luna was a brave astronaut" / "Leo is a nerdy teenager"
  sentences.forEach((s) => {
    const re = new RegExp(`\\b([A-Z][a-z]+)\\s+(?:was|is)\\s+(?:a|an)\\s+((?:[a-z-]+\\s+){0,4})(${nounAlt})\\b`, 'g');
    let m;
    while ((m = re.exec(s))) {
      const name = m[1];
      if (STOPWORDS_CAPS.has(name)) continue;
      const noun = m[3].toLowerCase();
      const info = nounInfo(noun);
      if (!info) continue;
      const ex = byName.get(name);
      if (ex) {
        if (!ex.noun) { ex.noun = noun; ex.kind = info.kind; ex.role = info.role || ex.role; if (info.age) ex.age = info.age; if (info.gender && info.gender !== 'n' && ex.gender === 'n') ex.gender = info.gender; }
        applyAdjectives(ex, m[2].trim().split(/\s+/));
      } else {
        const mem = addMember({ name, noun, ...info, firstSentence: sentences.indexOf(s) });
        applyAdjectives(mem, m[2].trim().split(/\s+/));
      }
    }
  });

  // 2c) Kinship / title words used as names: "Grandpa laughed", "Mom said".
  sentences.forEach((s, si) => {
    const re = /(^|[^A-Za-z])(Grandpa|Grandma|Granny|Grandmother|Grandfather|Mom|Mum|Dad|Mother|Father|Princess|Prince|King|Queen|Captain|Wizard|Witch)(?=[^A-Za-z]|$)/g;
    let m;
    while ((m = re.exec(s))) {
      const word = m[2];
      const before = s.slice(0, m.index + m[1].length).toLowerCase();
      if (/\b(the|a|an|his|her|their|my|our|your)\s+$/.test(before)) continue;
      if (byName.has(word)) continue;
      const info = nounInfo(word.toLowerCase());
      addMember({ name: word, noun: word.toLowerCase(), ...info, firstSentence: si });
    }
  });

  // 3) Bare capitalized names (Mia smiled.) — must look like a name.
  const capCounts = new Map();
  sentences.forEach((s, si) => {
    const stripped = s.replace(/"[^"]*"/g, (q) => q); // keep quotes: names can appear in dialogue
    const tokens = stripped.match(/[A-Za-z'-]+/g) || [];
    tokens.forEach((tok, ti) => {
      if (!/^[A-Z][a-z]{1,14}$/.test(tok)) return;
      if (STOPWORDS_CAPS.has(tok)) return;
      if (CHARACTER_NOUNS[tok.toLowerCase()]) return;
      const prev = (tokens[ti - 1] || '').toLowerCase();
      if (['in', 'to', 'at', 'from', 'of', 'visit', 'visited', 'near'].includes(prev)) return; // places
      const e = capCounts.get(tok) || { n: 0, nonInitial: 0, first: si };
      e.n++;
      if (ti > 0 && !/^"/.test(tok)) e.nonInitial++;
      capCounts.set(tok, e);
    });
  });
  for (const [name, e] of capCounts) {
    if (byName.has(name)) continue;
    const lname = name.toLowerCase();
    const knownName = NAMES_F.has(lname) || NAMES_M.has(lname);
    if (e.n >= 2 || e.nonInitial >= 1 || knownName) {
      addMember({ name, noun: null, kind: 'human', gender: NAMES_F.has(lname) ? 'f' : NAMES_M.has(lname) ? 'm' : 'n', age: 'teen', firstSentence: e.first });
    }
  }

  // 4) Unnamed characters by noun: "a dragon", "the old wizard".
  sentences.forEach((s, si) => {
    const lower = s.toLowerCase();
    const re = new RegExp(`\\b(a|an|the|one|his|her|their|my|our)\\s+((?:[a-z-]+\\s+){0,3})(${nounAlt})\\b(?!\\s+(?:named|called))`, 'g');
    let m;
    while ((m = re.exec(lower))) {
      const noun = m[3];
      if (noun === 'friend' || noun === 'kid' || noun === 'child') continue; // too generic to spawn on their own
      const info = nounInfo(noun);
      if (!info) continue;
      // Already covered by a named member with this noun?
      const named = cast.find((c) => c.noun === noun);
      if (named) { applyAdjectives(named, m[2].trim().split(/\s+/)); continue; }
      if (byNoun.has(noun)) continue;
      const mem = addMember({ noun, ...info, firstSentence: si });
      applyAdjectives(mem, m[2].trim().split(/\s+/));
    }
  });

  // Attribute details: hair, glasses, clothing — given to the character
  // mentioned closest before the words ("Bolt met a girl named Mia with glasses").
  sentences.forEach((s) => {
    const lower = s.toLowerCase();
    const marks = [];
    for (const c of cast) {
      const keys = [c.name, c.noun].filter(Boolean).map((k) => k.toLowerCase());
      for (const k of keys) {
        const re = new RegExp(`\\b${escapeRe(k)}\\b`, 'g');
        let mm;
        while ((mm = re.exec(lower))) marks.push({ c, idx: mm.index + k.length });
      }
    }
    // pronouns point at the last-mentioned character of that gender
    if (!marks.length) return;
    const ownerAt = (idx) => {
      const before = marks.filter((m) => m.idx <= idx).sort((a, b) => b.idx - a.idx);
      return (before[0] || marks.slice().sort((a, b) => a.idx - b.idx)[0]).c;
    };
    const hm = /\b((?:[a-z]+\s+){0,3})hair\b/g;
    let m;
    while ((m = hm.exec(lower))) {
      const c = ownerAt(m.index);
      for (const w of m[1].split(/\s+/)) {
        if (w in HAIR_COLORS) c.hair.color = HAIR_COLORS[w];
        if (HAIR_STYLES.includes(w)) c.hair.style = w;
      }
    }
    for (const style of ['braids', 'braided', 'ponytail', 'bun', 'pigtails', 'afro', 'bald', 'mohawk']) {
      const i = lower.search(new RegExp(`\\b${style}\\b`));
      if (i >= 0) { const c = ownerAt(i); c.hair.style = c.hair.style || style; }
    }
    const bl = lower.search(/\b(blonde|blond)\b/);
    if (bl >= 0) ownerAt(bl).hair.color = HAIR_COLORS.blonde;
    const rh = lower.search(/\bredhead\b/);
    if (rh >= 0) ownerAt(rh).hair.color = HAIR_COLORS.red;
    if (!/\b(wear|wore|wearing|with|had|has|in a|in an|in his|in her|carried|carrying|put on|and)\b/.test(lower)) return;
    for (const [acc, words] of Object.entries(ACCESSORY_WORDS)) {
      for (const w of words) {
        const i = lower.search(new RegExp(`\\b${escapeRe(w)}s?\\b`));
        if (i < 0) continue;
        const c = ownerAt(i);
        if (!c.accessories.includes(acc)) c.accessories.push(acc);
        break;
      }
    }
    const cm = /\b(red|orange|yellow|green|blue|purple|pink|white|black|brown|gray|grey|teal)\s+(shirt|hoodie|jacket|sweater|dress|coat|t-shirt|sweatshirt)\b/g;
    while ((m = cm.exec(lower))) ownerAt(m.index).outfitColor = COLORS[m[1]];
  });

  // Pronoun-based gender inference: "Mia ... She"
  sentences.forEach((s, si) => {
    const mentioned = cast.filter((c) => mentionIndex(s, c) >= 0);
    if (mentioned.length !== 1) return;
    const c = mentioned[0];
    if (c.gender !== 'n') return;
    const window = (s + ' ' + (sentences[si + 1] || '')).toLowerCase();
    const she = (window.match(/\b(she|her|hers|herself)\b/g) || []).length;
    const he = (window.match(/\b(he|him|his|himself)\b/g) || []).length;
    if (she > he) c.gender = 'f';
    else if (he > she) c.gender = 'm';
  });

  // Mentions & stable per-character seeds / colors.
  for (const c of cast) {
    c.mentions = sentences.reduce((n, s) => n + (mentionIndex(s, c) >= 0 ? 1 : 0), 0);
    c.seed = hashString(`${c.name || ''}|${c.noun || ''}|${c.kind}`);
    if (c.kind === 'human') {
      if (c.gender === 'n') c.gender = c.seed % 2 ? 'f' : 'm';
      if (!c.outfitColor) c.outfitColor = c.color || SHIRT_COLORS[c.seed % SHIRT_COLORS.length];
    }
    if (SMALL_KINDS.has(c.kind) && c.size === 1) c.size = 0.85;
    if (BIG_KINDS.has(c.kind) && c.size === 1) c.size = 1.2;
  }
  // Order: main characters first (by first appearance, then mentions).
  cast.sort((a, b) => a.firstSentence - b.firstSentence || b.mentions - a.mentions);
  cast.forEach((c, i) => { c.id = `c${i + 1}`; });
  return cast;
}

function mentionIndex(sentence, c) {
  if (c.name) {
    const i = sentence.search(new RegExp(`\\b${escapeRe(c.name)}\\b`));
    if (i >= 0) return i;
  }
  if (c.noun) {
    const forms = [c.noun, c.noun + 's', c.noun + 'es'].map(escapeRe).join('|');
    const re = new RegExp(`\\b(?:the|a|an|little|${c.name ? '' : 'his|her|their|our|my|'}old|young)\\s+(?:[a-z-]+\\s+){0,2}(?:${forms})\\b`, 'i');
    const i = sentence.search(re);
    if (i >= 0) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Per-sentence analysis
// ---------------------------------------------------------------------------
function findActions(lowerNoQuotes) {
  const hits = [];
  for (const { action, re } of ACTION_MATCHERS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(lowerNoQuotes))) {
      const word = m[1];
      const idx = m.index + m[0].indexOf(word);
      // skip noun-ish uses: "a wave", "the fall", "a hug" still fine; skip "to the left"
      const before = lowerNoQuotes.slice(Math.max(0, idx - 12), idx);
      if (/\b(a|an|the)\s+$/.test(before) && !['hug', 'dance', 'jump'].includes(action)) continue;
      if (/\b(not|n't|never)\s+(?:\w+\s+)?$/.test(before)) continue;
      if (/\b(of|about|wanted to|wants to|want to|wish to|wished to|hoped to|dreamed to|dreamt of|learn to|learned to|could|couldn't|can't|cannot|would)\s+$/.test(before)) continue;
      if (/^going\s+to\b/.test(lowerNoQuotes.slice(idx)) || /^gonna\b/.test(lowerNoQuotes.slice(idx))) continue;
      hits.push({ action, idx, word });
    }
  }
  hits.sort((a, b) => a.idx - b.idx);
  return hits;
}

function scoreSettings(lower) {
  const scores = {};
  for (const { setting, re, weight } of SETTING_MATCHERS) {
    const m = lower.match(re);
    if (!m) continue;
    let w = weight;
    const idx = lower.indexOf(m[0]);
    const before = lower.slice(Math.max(0, idx - 22), idx + 1);
    if (/\b(in|into|at|to|through|across|inside|on|near|toward|towards|reached|entered|explored|visited|arrived|from)\s+(the\s+|a\s+|an\s+|their\s+|his\s+|her\s+|my\s+|our\s+)?(?:[a-z-]+\s+)?$/.test(before.trimEnd() + ' ')) w += 2;
    scores[setting] = (scores[setting] || 0) + w;
  }
  return scores;
}

function matchAny(lower, words) {
  return words.some((w) => wordRe(escapeRe(w).replace(/\\\?/g, '?')).test(lower) || (w.length > 5 && lower.includes(w)));
}

function detectEmotion(text) {
  const lower = text.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const [emo, words] of Object.entries(EMOTIONS)) {
    let s = 0;
    for (const w of words) if (new RegExp(`\\b${escapeRe(w)}`).test(lower)) s++;
    if (s > bestScore) { bestScore = s; best = emo; }
  }
  return best;
}

function moodFor(emotions, setting, time, weather, actions) {
  const set = new Set(Object.values(emotions));
  const acts = new Set(Object.values(actions));
  if (set.has('scared') || weather === 'storm') return 'tense';
  if (set.has('sad')) return 'sad';
  if (set.has('angry')) return 'tense';
  if (acts.has('magic') || setting === 'space' || setting === 'underwater' || setting === 'candy' || setting === 'sky') return 'magical';
  if (acts.has('run') || acts.has('chase') || acts.has('fly') || set.has('excited') || set.has('proud')) return 'adventure';
  if (acts.has('dance') || acts.has('cheer') || set.has('happy') || set.has('love')) return 'happy';
  if (set.has('curious') || set.has('surprised')) return 'curious';
  if (time === 'night' || set.has('calm') || set.has('tired') || acts.has('sleep')) return 'calm';
  return 'happy';
}

export function parseStory(rawText, opts = {}) {
  const normalized = normalizeText(rawText || '');
  const { title: explicitTitle, body } = extractTitle(normalized);
  const sentences = splitSentences(body);
  const cast = detectCast(sentences);

  const scenes = [];
  let setting = null;
  let time = 'day';
  let weather = 'clear';
  let lastByGender = { f: null, m: null, n: null };
  let lastMentioned = [];
  let onStage = [];
  let lastSpeakers = [];
  const heldProps = new Map(); // holder id → prop type, persists until another
  let prevNarrationSubject = null;

  // Pre-scan for an initial setting so scene 1 isn't generic.
  for (const s of sentences) {
    const sc = scoreSettings(s.toLowerCase());
    const best = Object.entries(sc).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 2) { setting = best[0]; break; }
  }
  if (!setting) {
    const kinds = new Set(cast.map((c) => c.kind));
    setting = kinds.has('robot') || kinds.has('alien') ? 'city' : kinds.has('fish') || kinds.has('octopus') ? 'underwater' : 'meadow';
  }
  const initialSetting = setting;
  let prevSetting = null;

  sentences.forEach((sentence, si) => {
    const quotes = [...sentence.matchAll(/"([^"]+)"/g)].map((m) => ({ text: m[1].trim(), index: m.index, end: m.index + m[0].length }));
    const noQuotes = sentence.replace(/"[^"]*"/g, ' ').replace(/\s+/g, ' ').trim();
    const lower = sentence.toLowerCase();
    const lowerNQ = noQuotes.toLowerCase();

    // --- setting / time / weather
    const sc = scoreSettings(lowerNQ);
    const best = Object.entries(sc).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 2) setting = best[0];
    else if (best && si === 0) setting = best[0];
    // the moon only means space when you're on it
    if (setting === 'space' && !/space|galaxy|planet|spaceship|rocket|on the moon|to the moon|mars|orbit|universe|station/.test(lowerNQ) && sc.space == null) { /* keep */ }

    for (const [t, words] of Object.entries(TIMES)) if (matchAny(lowerNQ, words)) time = t;
    if (/\bnext morning|the next day|in the morning\b/.test(lowerNQ)) time = /morning/.test(lowerNQ) ? 'dawn' : 'day';
    const isNewSetting = setting !== prevSetting;
    if (isNewSetting && prevSetting !== null) weather = 'clear';
    for (const [w, words] of Object.entries(WEATHER)) if (matchAny(lowerNQ, words)) weather = w;
    if (setting === 'space' || setting === 'underwater' || setting === 'cave' || setting === 'home' || setting === 'school' || setting === 'stage') {
      if (weather !== 'clear') weather = 'clear';
    }
    if (setting === 'snow' && weather === 'clear' && si % 2 === 0) weather = 'snow';
    if (setting === 'space') time = 'night';

    // --- characters mentioned
    const mentions = [];
    for (const c of cast) {
      const idx = mentionIndex(sentence, c);
      if (idx >= 0) mentions.push({ c, idx });
    }
    // pronouns (outside quotes)
    const pronounHits = [];
    const pr = /\b(he|him|his|she|her|hers|it|its|they|them|their|everyone|together|both|friends)\b/gi;
    let pm;
    while ((pm = pr.exec(noQuotes))) pronounHits.push({ p: pm[1].toLowerCase(), idx: pm.index });
    const resolved = new Map(mentions.map((m) => [m.c.id, m.idx]));
    for (const { p, idx } of pronounHits) {
      let targets = [];
      if (['he', 'him', 'his'].includes(p)) targets = [lastByGender.m || lastMentioned.find((c) => c.gender !== 'f')];
      else if (['she', 'her', 'hers'].includes(p)) targets = [lastByGender.f || lastMentioned.find((c) => c.gender !== 'm')];
      else if (['it', 'its'].includes(p)) targets = [lastMentioned.find((c) => c.kind !== 'human')];
      else targets = (lastMentioned.length > 1 ? lastMentioned : onStage.map((id) => cast.find((c) => c.id === id)));
      for (const t of targets) if (t && !resolved.has(t.id)) resolved.set(t.id, idx + 1000); // pronoun positions (in no-quote text)
    }
    // Map mention positions into no-quote space roughly: use order only.
    const mentionedIds = [...resolved.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    const mentionedCast = mentionedIds.map((id) => cast.find((c) => c.id === id)).filter(Boolean);

    // --- dialogue attribution
    const lines = [];
    let narration = noQuotes;
    if (quotes.length) {
      const tagMatch = noQuotes.match(SPEECH_VERBS);
      let speaker = null;
      if (mentions.length === 1) speaker = mentions[0].c;
      else if (mentions.length > 1) {
        // the character nearest a speech verb
        const verbIdx = sentence.search(SPEECH_VERBS);
        if (verbIdx >= 0) {
          speaker = mentions.slice().sort((a, b) => Math.abs(a.idx - verbIdx) - Math.abs(b.idx - verbIdx))[0].c;
        } else speaker = mentions[0].c;
      } else if (mentionedCast.length >= 1 && pronounHits.some((h) => !['they', 'them', 'their', 'everyone', 'together', 'both', 'friends'].includes(h.p))) {
        speaker = mentionedCast[0];
      } else if (prevNarrationSubject && quotes[0].index < 2) {
        speaker = prevNarrationSubject;
      } else if (lastSpeakers.length >= 2) {
        speaker = lastSpeakers[lastSpeakers.length - 2]; // conversational turn-taking
      } else {
        speaker = mentionedCast[0] || cast.find((c) => onStage.includes(c.id)) || cast[0] || null;
      }
      const speakerId = speaker ? speaker.id : 'narrator';
      // Narration that is only a dialogue tag gets dropped; real narration stays.
      const narrWords = noQuotes.split(/\s+/).filter(Boolean);
      const isOnlyTag = tagMatch && narrWords.length <= 9;
      const quoteFirst = quotes[0].index < 2;
      if (isOnlyTag || narrWords.length === 0) narration = '';
      else if (tagMatch) {
        // Keep the part of the narration after the tag clause: '"Hi," said Mia, and waved.' → 'Mia waved'
        narration = '';
      }
      const qLines = quotes.map((q) => ({ speaker: speakerId, text: q.text }));
      if (narration && !quoteFirst) lines.push({ speaker: 'narrator', text: narration }, ...qLines);
      else { lines.push(...qLines); if (narration) lines.push({ speaker: 'narrator', text: narration }); }
      if (speaker) { lastSpeakers = lastSpeakers.filter((x) => x !== speaker); lastSpeakers.push(speaker); }
    } else {
      lines.push({ speaker: 'narrator', text: sentence });
    }

    // --- who is on stage
    let characters = mentionedIds.slice();
    for (const l of lines) if (l.speaker !== 'narrator' && !characters.includes(l.speaker)) characters.push(l.speaker);
    if (characters.length === 0) {
      characters = isNewSetting && prevSetting !== null ? onStage.slice(0, 1) : onStage.slice();
      if (characters.length === 0 && cast.length) characters = [cast[0].id];
    } else if (!isNewSetting) {
      // characters who were just here stay in the background unless the story moved on
      for (const id of onStage) if (!characters.includes(id) && characters.length < 4) characters.push(id);
    }
    characters = characters.slice(0, 5);

    // --- actions
    const actionHits = findActions(lowerNQ);
    const actions = {};
    const mentionPos = mentions.map((m) => ({ id: m.c.id, idx: noQuotes.toLowerCase().indexOf((m.c.name || m.c.noun || '').toLowerCase()) })).filter((m) => m.idx >= 0);
    for (const hit of actionHits) {
      // subject = nearest character mention before the verb; else first mentioned
      let subj = null;
      const prior = mentionPos.filter((m) => m.idx < hit.idx).sort((a, b) => b.idx - a.idx);
      const from = prior.length ? prior[0].idx : 0;
      const between = lowerNQ.slice(from, hit.idx);
      const np = between.match(/\b(?:and|while|as|but|then|when)\s+(?:the|a|an|his|her|their|its)\s+(?:[a-z-]+\s+)?([a-z-]+)\s*$/);
      if (np && !CHARACTER_NOUNS[np[1]] && !cast.some((c) => c.noun === np[1])) continue;
      if (prior.length) subj = prior[0].id;
      else if (mentionedIds.length) subj = mentionedIds[0];
      else if (characters.length) subj = characters[0];
      if (!subj) continue;
      const plural = /\b(they|both|together|everyone|all)\b/.test(lowerNQ.slice(Math.max(0, hit.idx - 30), hit.idx));
      let targets = plural ? characters : [subj];
      if (!plural && prior.length >= 2) {
        const gap = lowerNQ.slice(prior[1].idx, prior[0].idx);
        if (/^[a-z'-]+\s+and\s+$/.test(gap) || /^\S+\s+and\s+(the\s+)?$/.test(gap)) targets = [prior[1].id, prior[0].id];
      }
      for (const id of targets) {
        const cur = actions[id];
        if (!cur || ACTION_PRIORITY.indexOf(hit.action) < ACTION_PRIORITY.indexOf(cur)) actions[id] = hit.action;
      }
    }
    if (/\b(they|both|everyone|together)\b/.test(lowerNQ)) {
      const groupAct = Object.values(actions)[0];
      if (groupAct && ['dance', 'cheer', 'run', 'walk', 'jump', 'laugh', 'fly', 'swim', 'sing', 'hug', 'play', 'eat', 'sit', 'sleep'].includes(groupAct)) {
        for (const id of characters) actions[id] = actions[id] || groupAct;
      }
    }
    // Speakers talk unless doing something more visual.
    for (const l of lines) {
      if (l.speaker !== 'narrator' && (!actions[l.speaker] || ['look', 'stand', 'think'].includes(actions[l.speaker]))) actions[l.speaker] = actions[l.speaker] === 'think' ? 'think' : 'talk';
    }
    // "talk" verbs in narration don't override visual verbs from the same sentence
    // Interaction target (hug, chase, talk to, look at).
    let target = null;
    const actors = Object.keys(actions);
    if (characters.length >= 2) {
      const a0 = actors[0] || characters[0];
      target = characters.find((id) => id !== a0) || null;
    }

    // --- emotions
    const emotions = {};
    const sentenceEmotion = detectEmotion(noQuotes);
    for (const id of characters) {
      const act = actions[id];
      let emo = null;
      if (mentionedIds.includes(id) || lines.some((l) => l.speaker === id)) emo = sentenceEmotion;
      for (const l of lines) {
        if (l.speaker !== id) continue;
        const qe = detectEmotion(l.text);
        if (qe) emo = qe;
        else if (!emo && /!/.test(l.text)) emo = 'excited';
        else if (!emo && /\?/.test(l.text)) emo = 'curious';
      }
      if (!emo) {
        emo = { laugh: 'happy', cry: 'sad', dance: 'happy', cheer: 'excited', hug: 'love', sleep: 'tired', shiver: 'scared', stomp: 'angry', discover: 'surprised', think: 'curious', fall: 'surprised', hide: 'scared', sneak: 'curious' }[act] || null;
      }
      emotions[id] = emo || 'neutral';
    }

    // --- props
    const props = [];
    for (const [type, words] of Object.entries(PROPS)) {
      const re = new RegExp(`\\b(${words.map(escapeRe).join('|')})(s|es)?\\b`, 'i');
      const m = lowerNQ.match(re) || lower.match(re);
      if (!m) continue;
      if (type === 'house' && (setting === 'home' || setting === 'village')) continue;
      if (type === 'tree' && (setting === 'forest' || setting === 'meadow')) continue;
      if (type === 'star' && /\bstars\b/.test(lowerNQ) && !/shooting|wish|catch|caught|found|hold/.test(lowerNQ)) continue;
      if (type === 'heart' && !/\b(a|the|big|red|pink)\s+heart\b/.test(lowerNQ)) continue;
      if (type === 'gift' && m[1] === 'box' && !/\bbox\b/.test(lowerNQ)) continue;
      if (type === 'rocket' && setting === 'space' && !/rocket|spaceship/.test(lowerNQ)) continue;
      if (type === 'note' || type === 'letter') { if (/\bnote(s)?\b/.test(lowerNQ) && /music|sing|song/.test(lowerNQ)) continue; }
      let holder = null;
      const holdNear = new RegExp(`\\b(${HOLD_VERBS.flatMap(inflections).map(escapeRe).join('|')})\\b[^.,;]{0,30}\\b(${words.map(escapeRe).join('|')})`, 'i');
      if (holdNear.test(lowerNQ) || /\b(with|holding|carrying)\s+(a|an|the|his|her|their)\s+/.test(lowerNQ.slice(Math.max(0, lowerNQ.indexOf(m[0]) - 20), lowerNQ.indexOf(m[0]) + 1))) {
        holder = Object.keys(actions).find((id) => ['hold', 'discover', 'wave', 'play', 'eat', 'read', 'walk', 'run', 'look', 'stand', 'talk'].includes(actions[id])) || mentionedIds[0] || characters[0] || null;
        if (['car', 'house', 'rocket', 'boat', 'tree', 'bench', 'piano', 'tent', 'campfire', 'bridge', 'door', 'snowman', 'ufo', 'bike', 'telescope', 'sign'].includes(type)) holder = null;
      }
      if (holder) heldProps.set(holder, type);
      props.push({ type, holder });
    }
    // Carried props persist with their holder within the same setting.
    if (!isNewSetting) {
      for (const [holder, type] of heldProps) {
        if (characters.includes(holder) && !props.some((p) => p.holder === holder)) props.push({ type, holder, carried: true });
      }
    } else heldProps.clear();
    const byType = new Map();
    for (const p of props) { const ex = byType.get(p.type); if (!ex || (!ex.holder && p.holder)) byType.set(p.type, p); }
    props.length = 0; props.push(...byType.values());

    // --- fx
    const fx = [];
    for (const [name, words] of Object.entries(FX)) if (matchAny(lower, words)) fx.push(name);
    if (Object.values(actions).includes('sleep')) fx.push('zzz');
    if (Object.values(actions).includes('cry')) fx.push('tears');
    if (Object.values(actions).includes('magic') && !fx.includes('sparkles')) fx.push('sparkles');
    if (setting === 'underwater' && !fx.includes('bubbles')) fx.push('bubbles');

    // --- focus & shot
    const speakingChars = lines.filter((l) => l.speaker !== 'narrator').map((l) => l.speaker);
    const focus = speakingChars[0] || mentionedIds[0] || characters[0] || null;
    const mainAct = focus ? actions[focus] : null;
    const emo = focus ? emotions[focus] : null;
    let shot = 'medium';
    if (isNewSetting) shot = 'establishing';
    else if (speakingChars.length && characters.length >= 2) shot = 'over-shoulder';
    else if (speakingChars.length) shot = 'closeup';
    else if (['run', 'chase', 'walk', 'sneak', 'ride'].includes(mainAct)) shot = 'tracking';
    else if (['fly', 'climb'].includes(mainAct)) shot = 'lowangle';
    else if (['dance', 'cheer', 'jump', 'play', 'hug', 'magic'].includes(mainAct)) shot = 'wide';
    else if (['cry', 'laugh', 'think', 'surprised', 'scared', 'love', 'sad'].includes(mainAct) || ['surprised', 'scared', 'sad', 'love'].includes(emo)) shot = 'closeup';
    else if (characters.length >= 3) shot = 'wide';

    scenes.push({
      index: si,
      text: sentence,
      setting, time, weather,
      characters,
      focus,
      actions,
      emotions,
      target,
      props,
      lines: lines.filter((l) => l.text && /[A-Za-z0-9]/.test(l.text)),
      fx: [...new Set(fx)],
      mood: moodFor(emotions, setting, time, weather, actions),
      shot,
      isNewSetting,
    });

    // --- update memory for pronouns
    if (mentionedCast.length) lastMentioned = mentionedCast.concat(lastMentioned.filter((c) => !mentionedCast.includes(c))).slice(0, 4);
    for (const c of mentionedCast.slice().reverse()) {
      if (c.gender === 'f') lastByGender.f = c;
      else if (c.gender === 'm') lastByGender.m = c;
      lastByGender.n = c;
    }
    onStage = characters;
    prevSetting = setting;
    prevNarrationSubject = !quotes.length && mentions.length === 1 ? mentions[0].c : null;
  });

  // Mark the opening scene as establishing even if setting was pre-scanned.
  if (scenes[0]) { scenes[0].isNewSetting = true; scenes[0].shot = 'establishing'; }

  const title = explicitTitle || opts.title || makeTitleFromCast(cast, initialSetting);
  for (const c of cast) delete c.mentions;
  return { title, cast, scenes, protagonist: cast[0] ? cast[0].id : null, source: 'rules' };
}

// Display name used in subtitles and the storyboard.
export function displayName(c) {
  if (!c) return 'Narrator';
  if (c.name) return c.name;
  return `The ${c.noun || c.kind}`;
}
