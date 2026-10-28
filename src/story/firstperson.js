// Characters tell the story: every narration line is handed to the character
// it's about and rewritten in their own words, in the first person.
//   "Luna climbed into her rocket."     → Luna: "I climbed into my rocket."
//   "Luna and Max made a wish."         → Luna: "Max and I made a wish."
//   "They laughed together."            → (the hero): "We laughed together."
//   "There lived a robot named Bolt."   → Bolt: "My name is Bolt. I'm a robot."
// Sentences about no one in particular ("The sun set.") go to the hero on screen.
// Only a story with no characters at all keeps the narrator.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DET = '(?:the|a|an|his|her|their|our|my|this|that)';
// a name at the start of a clause is the subject ("I"), anywhere else the object ("me")
const CLAUSE = /(?:^|[,;:—–-]|\b(?:then|when|while|because|until|so|but|if|once|that|where|suddenly|soon|finally))\s*$/i;
const VERBISH = /^(?:was|is|were|are|had|has|have|did|does|could|would|will|can|should|might|must|felt|got|went|ran|saw|said|made|took|came|knew|thought|found|gave|told|sat|stood|fell|flew|swam|ate|drank|began|left|kept|held|heard|met|grew|wore|won|lost|built|caught|brought|bought|taught|slept|woke|became|[a-z]+ed|[a-z]+s)$/i;
const ADVERB = /^(?:always|never|often|also|still|just|really|quickly|slowly|suddenly|then|finally|soon|now|even|only|[a-z]+ly)$/i;
const STRONG_VERB = /^(?:was|is|were|are|had|has|did|does|could|would|will|can|felt|got|went|ran|saw|said|made|took|came|knew|thought|found|gave|told|sat|stood|fell|flew|swam|ate|began|left|kept|held|heard|met|grew|became|[a-z]{3,}ed)$/i;
const PREPOSITION = /\b(?:to|at|with|for|from|on|in|into|onto|by|of|about|like|than|behind|beside|near|toward|towards|past|around|over|under|after|before)\s*$/i;
const OBJECT_NEXT = /^(?:to|and|or|up|down|away|back|out|in|on|off|over|with|at|from|for|by|into|onto|again|too|so|tight|close|goodbye|hello|home|there|here|that|the|a|an|but|as|very|$)$/i;
const SUBJECT_PRONOUNS = { f: /\bshe\b/gi, m: /\bhe\b/gi };

export function tellByCharacters(plan) {
  const cast = plan.cast || [];
  if (!cast.length) return plan;
  const byId = new Map(cast.map((c) => [c.id, c]));
  const last = { f: null, m: null, any: null };
  for (const sc of plan.scenes) {
    const lines = [];
    for (const l of sc.lines) {
      if (l.speaker !== 'narrator') { lines.push(l); continue; }  // dialogue: already theirs
      const said = retell(l.text, sc, plan, cast, byId, last);
      if (said) { lines.push({ ...l, speaker: said.speaker, text: said.text }); remember(byId.get(said.speaker)); }
      else lines.push(l);
    }
    sc.lines = lines;
    for (const l of lines) if (l.speaker !== 'narrator' && !sc.characters.includes(l.speaker)) sc.characters.push(l.speaker);
  }
  plan.titleVoice = false;  // the title is on screen; nobody reads it out
  plan.toldByCharacters = true;
  return plan;

  function remember(c) {
    if (!c) return;
    if (c.gender === 'f' || c.gender === 'm') last[c.gender] = c;
    last.any = c;
  }
}

// How a character is referred to: optional "the little dog" before a name, "a fox named Pip", "the dragon".
function referencePattern(c) {
  const noun = c.noun ? `(?:${[c.noun, c.noun + 's', c.noun + 'es'].map(escapeRe).join('|')})` : null;
  if (c.name) {
    const name = escapeRe(c.name);
    const before = noun ? `(?:${DET}\\s+(?:[a-z-]+\\s+){0,2}${noun}\\s+(?:(?:named|called)\\s+)?)?` : '';
    return new RegExp(`\\b${before}${name}\\b('s)?`, 'gi');
  }
  if (noun) return new RegExp(`\\b${DET}\\s+(?:[a-z-]+\\s+){0,2}${noun}\\b('s)?`, 'gi');
  return null;
}

function retell(text, sc, plan, cast, byId, last) {
  // who is this sentence about? the first character it names (not one it's only introducing)…
  const mentions = [];
  for (const c of cast) {
    const re = referencePattern(c);
    if (!re) continue;
    for (const m of text.matchAll(re)) {
      const intro = /\b(?:named|called)\s+\S+$/i.test(m[0]) || /\b(?:named|called)\s+(?:[A-Z][\w'-]*\s*(?:,|and)\s*)*$/.test(text.slice(0, m.index));
      mentions.push({ c, index: m.index, intro });
    }
  }
  mentions.sort((a, b) => a.index - b.index);
  const lead = text.replace(/^[^,]{0,40},\s*/, '');  // skip "One night, "
  let speaker = null, how = 'named';
  const introduced = text.match(/\bthere\s+(?:once\s+)?(?:was|lived)\s+(an?\s+[^.,!?]*?)\s+(?:named|called)\s+([A-Z][\w'-]*)/);
  if (introduced) speaker = cast.find((c) => c.name === introduced[2]) || null;
  if (!speaker) speaker = (mentions.find((m) => !m.intro) || {}).c || null;
  // …or the one a leading he / she / they means
  if (!speaker) {
    const re = /^(?:\w+\s+){0,3}?(she|he|her|his|they|their)\b/i;
    const p = ((text.match(re) || lead.match(re) || [])[1] || '').toLowerCase();
    if (p === 'she' || p === 'her') { speaker = last.f; how = 'pronoun'; }
    else if (p === 'he' || p === 'his') { speaker = last.m; how = 'pronoun'; }
    else if (p === 'they' || p === 'their') { speaker = hero(sc, plan, byId, last); how = 'group'; }
  }
  // …or, for a sentence about no one ("A star fell."), the hero on screen
  if (!speaker) { speaker = hero(sc, plan, byId, last); how = 'scene'; }
  if (!speaker) return null;

  let out = text;
  if (introduced && speaker.name === introduced[2]) {
    const np = introduced[1].replace(/^an?\s+/i, (a) => a.toLowerCase());
    const before = text.slice(0, introduced.index).replace(/[,\s]+$/, '');
    const after = text.slice(introduced.index + introduced[0].length).replace(/[.!?]+$/, '');
    const where = /^(?:in|on|at|deep|far|high|under|near|by|inside|outside|across|beyond|up|down)\b/i.test(before) ? ` ${before[0].toLowerCase()}${before.slice(1)}` : '';
    out = `My name is ${speaker.name}. I'm ${np}${after}${where}.`;
  } else {
    const sameGender = cast.filter((c) => c !== speaker && c.gender === speaker.gender && (c.gender === 'f' || c.gender === 'm'))
      .some((c) => { const re = referencePattern(c); return re && re.test(text); });
    // "her" / "his" are this character's only if the last she / he in the story was them
    const g = speaker.gender, prev = last[g];
    const owns = how === 'pronoun' || !prev || prev === speaker || !(sc.characters || []).includes(prev.id);
    out = firstPerson(text, speaker, { how, sameGender: sameGender || !owns });
  }
  return { speaker: speaker.id, text: tidy(out) };
}

function hero(sc, plan, byId, last) {
  const on = sc.characters || [];
  if (plan.protagonist && on.includes(plan.protagonist)) return byId.get(plan.protagonist);
  if (last.any && on.includes(last.any.id)) return last.any;
  return byId.get(on[0]) || byId.get(plan.protagonist) || last.any || null;
}

function firstPerson(text, c, { how, sameGender }) {
  let s = text;
  // the character's own name or description → I / me / my
  const re = referencePattern(c);
  if (re) {
    s = s.replace(re, (m, poss, offset, whole) => {
      if (poss) return 'my';
      const before = whole.slice(0, offset);
      const next = (whole.slice(offset + m.length).match(/^\s*([A-Za-z']+)/) || [])[1] || '';
      const after2 = (whole.slice(offset + m.length).match(/^\s*[A-Za-z']+\s+([A-Za-z']+)/) || [])[1] || '';
      const subject = CLAUSE.test(before) || (/\band\s*$/i.test(before) && VERBISH.test(next)) ||
        (STRONG_VERB.test(next) && !PREPOSITION.test(before)) ||
        (/^and$/i.test(next) && (VERBISH.test(after2) || /^[A-Z]/.test(after2)) && CLAUSE.test(before));
      return subject ? 'I' : 'me';
    });
  }
  const g = c.gender;
  if (how === 'group') {
    s = s.replace(/\bthey\b/gi, 'we').replace(/\bthemselves\b/gi, 'ourselves').replace(/\btheir\b/gi, 'our').replace(/\bthem\b/gi, 'us');
  }
  if ((g === 'f' || g === 'm') && !sameGender) {
    const he = g === 'f' ? 'she' : 'he';
    s = s.replace(new RegExp(`\\b${he}('s|'d|'ll)?\\b`, 'gi'), (m, k) => (k === "'s" ? "I'm" : 'I' + (k || '')));
    s = s.replace(new RegExp(`\\b${g === 'f' ? 'herself' : 'himself'}\\b`, 'gi'), 'myself');
    if (g === 'm') {
      s = s.replace(/\bhis\b(?=\s*[.,!?;]|\s*$)/gi, 'mine').replace(/\bhis\b/gi, 'my');
      // "him" is someone else unless the sentence never names its speaker as the subject
      if (how === 'scene') s = s.replace(/\bhim\b/gi, 'me');
    } else {
      s = s.replace(/\bhers\b/gi, 'mine');
      s = s.replace(/\bher\b(\s+([A-Za-z']+))?/gi, (m, sp, w) => {
        const object = !w || OBJECT_NEXT.test(w);
        if (object) return how === 'scene' ? 'me' + (sp || '') : m;
        return 'my' + sp;
      });
    }
  } else if (how === 'scene' && (g === 'f' || g === 'm')) {
    // someone else is the subject here, so "him" / "her" is the one telling it
    s = s.replace(g === 'm' ? /\bhim\b/gi : /\bher\b(?=\s*(?:[.,!?;]|$))/gi, 'me');
  }
  return agree(s.replace(/\bI,\s+(?=[a-z]+(?:s|ed)\b)/g, 'I '));  // "A young guy, goes" → "I go"
}

// I is / I has / we was … → I am / I have / we were; "I loves" → "I love"
function agree(s) {
  s = s.replace(/\bI\s+(isn't|is not)\b/g, "I'm not").replace(/\bI\s+is\b/g, 'I am').replace(/\bI\s+has\b/g, 'I have')
    .replace(/\bI\s+hasn't\b/g, "I haven't").replace(/\bI\s+does\b/g, 'I do').replace(/\bI\s+doesn't\b/g, "I don't")
    .replace(/\bwe\s+was\b/gi, (m) => m.replace(/was/i, 'were')).replace(/\bwe\s+wasn't\b/gi, (m) => m.replace(/wasn't/i, "weren't"))
    .replace(/\bwe\s+is\b/gi, (m) => m.replace(/is/i, 'are')).replace(/\bwe\s+has\b/gi, (m) => m.replace(/has/i, 'have'));
  let present = false;
  s = s.replace(/\b(I|we)\s+((?:[A-Za-z]+ly|always|never|often|also|still|just|even|only|then|now|soon)\s+)?([a-z]+)\b/gi, (m, who, adv, w) => {
    if (adv && !ADVERB.test(adv.trim())) return m;
    if (!/s$/.test(w) || /(?:ss|us|is|was|has|does|always|perhaps|yes|news|across|less|unless|its)$/i.test(w) || w.length < 4) return m;
    present = true;
    return `${who} ${adv || ''}${base(w)}`;
  });
  // "I wake up early and feeds my chickens" → "and feed my chickens"
  if (present) s = s.replace(/\b(and|then|but)\s+([a-z]{3,}s)\b(?=\s+(?:my|the|a|an|his|her|their|our|to|up|down|out|away|back|home|in|on|at|with|for|into|onto|around|over)\b)/g,
    (m, k, w) => (/(?:ss|us|is|was|has)$/.test(w) ? m : `${k} ${base(w)}`));
  return s;
}

function base(w) {
  return /ies$/.test(w) ? w.slice(0, -3) + 'y' : /(?:ch|sh|x|ss|zz|o)es$/.test(w) ? w.slice(0, -2) : w.slice(0, -1);
}

function tidy(s) {
  s = s
    .replace(/\b(I|me) and ((?:(?:my|the|his|her|a|an)\s+(?:[a-z-]+\s+){0,2}?)?[A-Z][\w'-]*|(?:my|the|his|her)\s+[a-z-]+)/g, (m, p, x) => `${x} and ${p}`)
    .replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
