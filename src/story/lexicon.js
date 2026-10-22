// Vocabulary the story parser understands. Every entry maps plain English
// words to the visual vocabulary of the 3D engine.

// ---- Characters -----------------------------------------------------------
// kind: which body/head builder to use. role: outfit/accessory hints.
export const CHARACTER_NOUNS = {
  // humans
  girl: { kind: 'human', gender: 'f', age: 'child' },
  boy: { kind: 'human', gender: 'm', age: 'child' },
  kid: { kind: 'human', gender: 'n', age: 'child' },
  child: { kind: 'human', gender: 'n', age: 'child' },
  teenager: { kind: 'human', gender: 'n', age: 'teen' },
  teen: { kind: 'human', gender: 'n', age: 'teen' },
  student: { kind: 'human', gender: 'n', age: 'teen', role: 'student' },
  baby: { kind: 'human', gender: 'n', age: 'baby' },
  woman: { kind: 'human', gender: 'f', age: 'adult' },
  lady: { kind: 'human', gender: 'f', age: 'adult' },
  man: { kind: 'human', gender: 'm', age: 'adult' },
  guy: { kind: 'human', gender: 'm', age: 'adult' },
  gentleman: { kind: 'human', gender: 'm', age: 'adult' },
  mom: { kind: 'human', gender: 'f', age: 'adult' },
  mother: { kind: 'human', gender: 'f', age: 'adult' },
  mum: { kind: 'human', gender: 'f', age: 'adult' },
  dad: { kind: 'human', gender: 'm', age: 'adult' },
  father: { kind: 'human', gender: 'm', age: 'adult' },
  sister: { kind: 'human', gender: 'f', age: 'child' },
  brother: { kind: 'human', gender: 'm', age: 'child' },
  granddaughter: { kind: 'human', gender: 'f', age: 'child' },
  grandson: { kind: 'human', gender: 'm', age: 'child' },
  daughter: { kind: 'human', gender: 'f', age: 'child' },
  son: { kind: 'human', gender: 'm', age: 'child' },
  grandma: { kind: 'human', gender: 'f', age: 'old' },
  granny: { kind: 'human', gender: 'f', age: 'old' },
  grandmother: { kind: 'human', gender: 'f', age: 'old' },
  grandpa: { kind: 'human', gender: 'm', age: 'old' },
  grandfather: { kind: 'human', gender: 'm', age: 'old' },
  princess: { kind: 'human', gender: 'f', age: 'teen', role: 'princess' },
  prince: { kind: 'human', gender: 'm', age: 'teen', role: 'prince' },
  queen: { kind: 'human', gender: 'f', age: 'adult', role: 'queen' },
  king: { kind: 'human', gender: 'm', age: 'adult', role: 'king' },
  knight: { kind: 'human', gender: 'm', age: 'adult', role: 'knight' },
  wizard: { kind: 'human', gender: 'm', age: 'old', role: 'wizard' },
  witch: { kind: 'human', gender: 'f', age: 'adult', role: 'witch' },
  pirate: { kind: 'human', gender: 'm', age: 'adult', role: 'pirate' },
  captain: { kind: 'human', gender: 'm', age: 'adult', role: 'pirate' },
  astronaut: { kind: 'human', gender: 'n', age: 'adult', role: 'astronaut' },
  chef: { kind: 'human', gender: 'n', age: 'adult', role: 'chef' },
  baker: { kind: 'human', gender: 'n', age: 'adult', role: 'chef' },
  cook: { kind: 'human', gender: 'n', age: 'adult', role: 'chef' },
  doctor: { kind: 'human', gender: 'n', age: 'adult', role: 'doctor' },
  scientist: { kind: 'human', gender: 'n', age: 'adult', role: 'scientist' },
  inventor: { kind: 'human', gender: 'n', age: 'adult', role: 'scientist' },
  teacher: { kind: 'human', gender: 'f', age: 'adult', role: 'teacher' },
  farmer: { kind: 'human', gender: 'm', age: 'adult', role: 'farmer' },
  cowboy: { kind: 'human', gender: 'm', age: 'adult', role: 'cowboy' },
  detective: { kind: 'human', gender: 'n', age: 'adult', role: 'detective' },
  explorer: { kind: 'human', gender: 'n', age: 'adult', role: 'explorer' },
  adventurer: { kind: 'human', gender: 'n', age: 'teen', role: 'explorer' },
  superhero: { kind: 'human', gender: 'n', age: 'adult', role: 'superhero' },
  hero: { kind: 'human', gender: 'n', age: 'teen', role: 'superhero' },
  ninja: { kind: 'human', gender: 'n', age: 'adult', role: 'ninja' },
  fairy: { kind: 'human', gender: 'f', age: 'child', role: 'fairy' },
  elf: { kind: 'human', gender: 'n', age: 'child', role: 'elf' },
  mermaid: { kind: 'human', gender: 'f', age: 'teen', role: 'mermaid' },
  musician: { kind: 'human', gender: 'n', age: 'adult', role: 'musician' },
  pastor: { kind: 'human', gender: 'm', age: 'adult', role: 'pastor' },
  priest: { kind: 'human', gender: 'm', age: 'adult', role: 'priest' },
  preacher: { kind: 'human', gender: 'm', age: 'adult', role: 'pastor' },
  minister: { kind: 'human', gender: 'n', age: 'adult', role: 'pastor' },
  bishop: { kind: 'human', gender: 'm', age: 'old', role: 'priest' },
  nun: { kind: 'human', gender: 'f', age: 'adult', role: 'nun' },
  angel: { kind: 'human', gender: 'n', age: 'adult', role: 'angel' },
  believer: { kind: 'human', gender: 'n', age: 'adult' },
  stranger: { kind: 'human', gender: 'm', age: 'adult' },
  neighbor: { kind: 'human', gender: 'n', age: 'adult' },
  neighbour: { kind: 'human', gender: 'n', age: 'adult' },
  nurse: { kind: 'human', gender: 'f', age: 'adult', role: 'doctor' },
  boss: { kind: 'human', gender: 'n', age: 'adult', role: 'office' },
  husband: { kind: 'human', gender: 'm', age: 'adult' },
  wife: { kind: 'human', gender: 'f', age: 'adult' },
  boyfriend: { kind: 'human', gender: 'm', age: 'teen' },
  girlfriend: { kind: 'human', gender: 'f', age: 'teen' },
  uncle: { kind: 'human', gender: 'm', age: 'adult' },
  aunt: { kind: 'human', gender: 'f', age: 'adult' },
  shepherd: { kind: 'human', gender: 'm', age: 'adult', role: 'shepherd' },
  singer: { kind: 'human', gender: 'n', age: 'adult', role: 'musician' },
  artist: { kind: 'human', gender: 'n', age: 'adult', role: 'artist' },
  painter: { kind: 'human', gender: 'n', age: 'adult', role: 'artist' },
  programmer: { kind: 'human', gender: 'n', age: 'adult', role: 'student' },
  friend: { kind: 'human', gender: 'n', age: 'teen' },
  // animals & creatures
  cat: { kind: 'cat' }, kitten: { kind: 'cat', age: 'child' }, kitty: { kind: 'cat', age: 'child' },
  dog: { kind: 'dog' }, puppy: { kind: 'dog', age: 'child' }, pup: { kind: 'dog', age: 'child' },
  bunny: { kind: 'bunny' }, rabbit: { kind: 'bunny' }, hare: { kind: 'bunny' },
  bear: { kind: 'bear' }, teddy: { kind: 'bear' }, cub: { kind: 'bear', age: 'child' },
  panda: { kind: 'panda' },
  fox: { kind: 'fox' },
  wolf: { kind: 'wolf' },
  mouse: { kind: 'mouse' }, mice: { kind: 'mouse' },
  owl: { kind: 'owl' },
  bird: { kind: 'bird' }, sparrow: { kind: 'bird' }, robin: { kind: 'bird' }, parrot: { kind: 'bird' },
  penguin: { kind: 'penguin' },
  duck: { kind: 'duck' }, duckling: { kind: 'duck', age: 'child' }, chick: { kind: 'duck', age: 'child' },
  frog: { kind: 'frog' }, toad: { kind: 'frog' },
  pig: { kind: 'pig' }, piglet: { kind: 'pig', age: 'child' },
  lion: { kind: 'lion' }, tiger: { kind: 'tiger' },
  monkey: { kind: 'monkey' },
  elephant: { kind: 'elephant' },
  koala: { kind: 'koala' },
  raccoon: { kind: 'raccoon' },
  squirrel: { kind: 'squirrel' },
  hedgehog: { kind: 'hedgehog' },
  turtle: { kind: 'turtle' }, tortoise: { kind: 'turtle' },
  unicorn: { kind: 'unicorn' }, horse: { kind: 'horse' }, pony: { kind: 'horse' },
  cow: { kind: 'cow' }, sheep: { kind: 'sheep' }, lamb: { kind: 'sheep', age: 'child' },
  deer: { kind: 'deer' },
  dragon: { kind: 'dragon' },
  dinosaur: { kind: 'dinosaur' }, dino: { kind: 'dinosaur' }, 't-rex': { kind: 'dinosaur' },
  robot: { kind: 'robot' }, bot: { kind: 'robot' }, android: { kind: 'robot' }, droid: { kind: 'robot' },
  alien: { kind: 'alien' }, martian: { kind: 'alien' },
  monster: { kind: 'monster' }, creature: { kind: 'monster' },
  ghost: { kind: 'ghost' },
  snowman: { kind: 'snowman' },
  fish: { kind: 'fish' }, goldfish: { kind: 'fish' },
  octopus: { kind: 'octopus' },
};

// Which species read as small/cute (voice pitch, scale).
export const SMALL_KINDS = new Set(['mouse', 'bird', 'duck', 'frog', 'hedgehog', 'squirrel', 'fish', 'bunny', 'owl']);
export const BIG_KINDS = new Set(['bear', 'elephant', 'dragon', 'dinosaur', 'monster', 'lion', 'tiger', 'horse', 'unicorn', 'cow']);

// Common first names → gender hint (used when no pronoun resolves it).
export const NAMES_F = new Set(('mia emma olivia ava sophia lily luna zoe chloe ella grace ruby rosie rose maya sara sarah anna ' +
  'hannah amelia isla ivy nora penny poppy daisy molly lucy alice bella clara emily sofia leah aria nina tina ' +
  'kate katie jane jenny julia lisa maria mary nala elsa moana sky amara zara aisha fatima priya mei yuki ' +
  'hazel willow iris violet jade pearl stella hope joy coco kiki lola mimi gigi fifi dot').split(' '));
export const NAMES_M = new Set(('leo max sam jack oliver noah liam ethan lucas james ben tom tim finn milo oscar charlie henry ' +
  'theo jake luke mark john mike david daniel alex adam andrew ryan kevin bob bill joe carl paul peter pete ' +
  'arthur george harry louis felix hugo otto rex rocky buddy bolt bruno duke chase marco diego omar ali ' +
  'kai kenji raj arjun tobi tunde deji femi kofi kwame juan pablo carlos ivan igor zack zeke ziggy spike pip ' +
  'rusty sparky gizmo sprocket bob').split(' '));

// ---- Settings ---------------------------------------------------------------
// Each setting has trigger patterns (regex sources, matched on lowercase text).
export const SETTINGS = {
  meadow: ['meadow', 'field', 'park', 'garden', 'hills?', 'grass', 'valley', 'countryside', 'backyard', 'yard', 'flowers'],
  forest: ['forest', 'woods', 'woodland', 'jungle', 'grove', 'among the trees'],
  beach: ['beach', 'shore', 'seaside', 'island', 'coast', 'sand'],
  underwater: ['underwater', 'under the sea', 'under the ocean', 'ocean floor', 'sea floor', 'coral reef', 'reef', 'deep sea'],
  city: ['city', 'street', 'downtown', 'skyscrapers?', 'traffic', 'sidewalk', 'neon', 'subway', 'times square', 'mall'],
  village: ['village', 'town', 'cottage', 'neighbou?rhood'],
  farm: ['farm', 'barn', 'ranch', 'tractor'],
  home: ['house', 'home', 'bedroom', 'kitchen', 'living room', 'room', 'attic', 'inside', 'indoors'],
  school: ['school', 'classroom', 'library', 'office', 'lab', 'laboratory', 'studio', 'cafe', 'café', 'coffee shop', 'bakery', 'shop', 'store', 'restaurant'],
  space: ['space', 'outer space', 'galaxy', 'planets?', 'spaceship', 'space ?station', 'on the moon', 'to the moon', 'mars', 'universe', 'orbit'],
  desert: ['desert', 'dunes?', 'sahara', 'oasis', 'pyramids?'],
  snow: ['arctic', 'north pole', 'south pole', 'igloo', 'glacier', 'frozen', 'icy', 'winter wonderland', 'snowy'],
  mountain: ['mountains?', 'peak', 'cliffs?', 'summit', 'canyon'],
  castle: ['castle', 'kingdom', 'palace', 'throne', 'tower', 'royal'],
  cave: ['cave', 'cavern', 'underground', 'tunnel', 'mine', 'dungeon'],
  lake: ['lake', 'pond', 'river', 'stream', 'waterfall', 'creek'],
  candy: ['candy ?land', 'land of sweets', 'candy kingdom', 'gingerbread', 'lollipop forest', 'chocolate river'],
  sky: ['above the clouds', 'in the sky', 'through the sky', 'among the clouds', 'up in the air', 'cloud kingdom'],
  stage: ['stage', 'concert', 'theater', 'theatre', 'talent show', 'party hall'],
  church: ['church', 'chapel', 'cathedral', 'altar', 'pews?', 'sanctuary', 'worship service', 'sunday service', 'congregation', 'temple', 'mosque'],
  market: ['market', 'bazaar', 'marketplace', 'street market', 'stalls?', 'vendors?'],
  hospital: ['hospital', 'clinic', 'doctor\'s office', 'ward'],
};

// Human-readable slugline names (screenplay style).
export const SETTING_LABEL = {
  meadow: 'MEADOW', forest: 'FOREST', beach: 'BEACH', underwater: 'UNDER THE SEA', city: 'CITY STREET',
  village: 'VILLAGE', farm: 'FARM', home: 'HOUSE', school: 'SCHOOL', space: 'OUTER SPACE', desert: 'DESERT',
  snow: 'ARCTIC', mountain: 'MOUNTAINS', castle: 'CASTLE', cave: 'CAVE', lake: 'LAKESIDE', candy: 'CANDY LAND',
  sky: 'ABOVE THE CLOUDS', stage: 'STAGE', church: 'CHURCH', market: 'MARKET', hospital: 'HOSPITAL',
};
export const INTERIOR_SETTINGS = new Set(['home', 'school', 'cave', 'stage', 'church', 'hospital']);

export const TIMES = {
  dawn: ['morning', 'sunrise', 'dawn', 'woke up', 'breakfast', 'early'],
  day: ['one day', 'afternoon', 'noon', 'daytime', 'sunny', 'bright day', 'lunch'],
  sunset: ['evening', 'sunset', 'dusk', 'twilight', 'golden hour', 'dinner'],
  night: ['night', 'midnight', 'moonlight', 'moonlit', 'dark', 'bedtime', 'starry', 'stars', 'nighttime', 'fireworks'],
};

export const WEATHER = {
  rain: ['rain', 'raining', 'rainy', 'drizzl', 'puddle', 'umbrella'],
  storm: ['storm', 'thunder', 'lightning', 'stormy', 'hurricane'],
  snow: ['snow', 'snowing', 'snowflake', 'blizzard', 'snowy'],
  fog: ['fog', 'foggy', 'mist', 'misty'],
  rainbow: ['rainbow'],
  clear: ['sun came out', 'rain stopped', 'storm passed', 'clear sky', 'sunshine', 'skies cleared'],
};

// ---- Actions ----------------------------------------------------------------
// base verb → action. Inflections are generated by the parser.
export const ACTIONS = {
  walk: ['walk', 'stroll', 'wander', 'march', 'step', 'travel', 'explore', 'hike', 'journey', 'head', 'tiptoe', 'go', 'come', 'arrive', 'enter', 'leave', 'return', 'visit', 'follow', 'approach'],
  sneak: ['sneak', 'creep'],
  run: ['run', 'race', 'rush', 'dash', 'hurry', 'sprint', 'flee', 'escape', 'zoom', 'scurry'],
  chase: ['chase'],
  jump: ['jump', 'leap', 'hop', 'bounce', 'skip', 'spring'],
  dance: ['dance', 'twirl', 'boogie', 'groove', 'spin', 'party'],
  wave: ['wave', 'greet', 'hello', 'hi'],
  sit: ['sit', 'rest', 'relax', 'settle'],
  sleep: ['sleep', 'nap', 'snooze', 'dream', 'doze'],
  fly: ['fly', 'soar', 'float', 'glide', 'hover', 'flap', 'launch', 'blast off', 'take off', 'lift off'],
  swim: ['swim', 'dive', 'splash', 'paddle'],
  eat: ['eat', 'munch', 'bite', 'taste', 'nibble', 'drink', 'sip', 'chew', 'feast', 'gobble'],
  laugh: ['laugh', 'giggle', 'chuckle', 'snicker'],
  cry: ['cry', 'sob', 'weep', 'tear'],
  talk: ['say', 'ask', 'tell', 'reply', 'answer', 'talk', 'speak', 'explain', 'call', 'announce', 'whisper', 'shout', 'yell', 'exclaim', 'promise', 'agree', 'chat'],
  sing: ['sing', 'hum', 'whistle'],
  think: ['think', 'wonder', 'imagine', 'ponder', 'remember', 'wish', 'plan', 'decide', 'realize', 'realise', 'idea'],
  look: ['look', 'see', 'watch', 'gaze', 'stare', 'notice', 'spot', 'peek', 'search', 'observe'],
  point: ['point', 'show'],
  discover: ['discover', 'find', 'uncover', 'stumble upon', 'come across'],
  hug: ['hug', 'embrace', 'cuddle', 'kiss'],
  play: ['play', 'kick', 'throw', 'catch', 'toss', 'juggle'],
  climb: ['climb', 'clamber', 'scramble'],
  fall: ['fall', 'trip', 'slip', 'tumble', 'crash', 'stumble'],
  cheer: ['cheer', 'celebrate', 'hooray', 'win', 'victory', 'triumph', 'clap'],
  build: ['build', 'make', 'create', 'fix', 'repair', 'craft', 'invent', 'code', 'type', 'work'],
  cook: ['cook', 'bake', 'stir', 'mix'],
  paint: ['paint', 'draw', 'sketch', 'write'],
  read: ['read', 'study'],
  hide: ['hide'],
  hold: ['hold', 'carry', 'lift', 'grab', 'pick', 'give', 'bring', 'take', 'hand'],
  magic: ['cast', 'conjure', 'enchant', 'sparkle', 'glow', 'shine', 'transform', 'appear', 'vanish', 'disappear'],
  bow: ['bow', 'curtsy', 'thank'],
  shiver: ['shiver', 'shake', 'tremble', 'freeze'],
  stomp: ['stomp', 'roar', 'growl', 'grumble'],
  ride: ['ride', 'drive', 'pilot', 'steer', 'sail'],
  stand: ['stand', 'wait', 'stay', 'meet'],
  pray: ['pray', 'kneel', 'worship', 'bless', 'repent', 'confess', 'praise', 'baptize', 'baptise', 'preach'],
};

// Irregular past forms → base verb.
export const IRREGULAR = {
  ran: 'run', flew: 'fly', flown: 'fly', swam: 'swim', sat: 'sit', slept: 'sleep', ate: 'eat', eaten: 'eat',
  fell: 'fall', fallen: 'fall', sang: 'sing', sung: 'sing', saw: 'see', seen: 'see', went: 'go', gone: 'go',
  came: 'come', found: 'find', held: 'hold', threw: 'throw', caught: 'catch', built: 'build', drew: 'draw',
  rode: 'ride', wrote: 'write', gave: 'give', took: 'take', made: 'make', told: 'tell', said: 'say',
  thought: 'think', felt: 'feel', hid: 'hide', spun: 'spin', dove: 'dive', drank: 'drink', brought: 'bring',
  leapt: 'leap', crept: 'creep', stood: 'stand', met: 'meet', drove: 'drive', bit: 'bite', shook: 'shake',
  froze: 'freeze', won: 'win', taught: 'teach', left: 'leave', woke: 'wake', lay: 'lie', knew: 'know',
  began: 'begin', sprang: 'spring', slid: 'slide', stuck: 'stick', swung: 'swing', wept: 'weep', kept: 'keep',
};

// ---- Emotions ---------------------------------------------------------------
export const EMOTIONS = {
  happy: ['happy', 'smile', 'joy', 'joyful', 'glad', 'cheerful', 'delight', 'grin', 'pleased', 'beam', 'content', 'fun', 'wonderful', 'great', 'friend'],
  excited: ['excited', 'thrill', 'eager', 'hooray', 'yay', 'woohoo', 'amazing', 'awesome', 'adventure', 'can\'t wait', 'couldn\'t wait'],
  sad: ['sad', 'unhappy', 'lonely', 'alone', 'miss', 'upset', 'gloomy', 'heartbroken', 'sigh', 'sorrow', 'lost', 'tears'],
  angry: ['angry', 'mad', 'furious', 'grumpy', 'annoyed', 'frown', 'rage', 'cross'],
  scared: ['scared', 'afraid', 'frighten', 'terrified', 'nervous', 'worried', 'fear', 'spooky', 'creepy', 'scary', 'panic', 'danger'],
  surprised: ['surprise', 'amazed', 'astonish', 'shock', 'gasp', 'wow', 'suddenly', 'unexpected', 'whoa', 'oh no'],
  curious: ['curious', 'puzzle', 'confused', 'strange', 'mysterious', 'mystery', 'wonder', 'secret', 'hmm'],
  tired: ['tired', 'sleepy', 'exhausted', 'yawn', 'weary'],
  love: ['love', 'adore', 'heart', 'kiss', 'darling', 'sweetheart', 'best friend'],
  proud: ['proud', 'brave', 'determined', 'courage', 'confident', 'strong', 'hero'],
  calm: ['peaceful', 'calm', 'quiet', 'gentle', 'softly', 'still', 'cozy', 'cosy', 'pray', 'peace'],
  hopeful: ['hope', 'faith', 'grace', 'born again', 'new life', 'forgiven', 'saved', 'redeemed', 'blessed', 'grateful', 'thankful', 'glory', 'hallelujah', 'amen'],
};

// ---- Props ------------------------------------------------------------------
export const PROPS = {
  ball: ['ball', 'football', 'soccer ball', 'basketball'],
  balloon: ['balloon'],
  kite: ['kite'],
  cake: ['cake', 'birthday cake'],
  cupcake: ['cupcake', 'muffin'],
  gift: ['gift', 'present', 'box'],
  book: ['book', 'diary', 'notebook', 'storybook'],
  flower: ['flower', 'rose', 'tulip', 'daisy', 'sunflower', 'bouquet'],
  tree: ['tree', 'oak'],
  house: ['house', 'cottage', 'cabin', 'hut'],
  car: ['car', 'taxi', 'truck', 'bus'],
  rocket: ['rocket', 'spaceship', 'spacecraft'],
  ufo: ['ufo', 'flying saucer'],
  star: ['star', 'shooting star', 'wishing star'],
  heart: ['heart'],
  crown: ['crown', 'tiara'],
  treasure: ['treasure', 'chest', 'gold', 'coins'],
  map: ['map', 'treasure map'],
  lantern: ['lantern', 'lamp', 'flashlight', 'torch'],
  campfire: ['campfire', 'fire', 'bonfire'],
  tent: ['tent', 'camp'],
  boat: ['boat', 'ship', 'canoe', 'raft'],
  apple: ['apple', 'fruit'],
  cookie: ['cookie', 'biscuit'],
  icecream: ['ice cream', 'ice-cream', 'icecream'],
  pizza: ['pizza'],
  lollipop: ['lollipop', 'candy', 'sweets'],
  snowman: ['snowman'],
  umbrella: ['umbrella'],
  guitar: ['guitar', 'ukulele'],
  piano: ['piano'],
  telescope: ['telescope'],
  wand: ['wand', 'magic wand', 'staff'],
  sword: ['sword'],
  key: ['key'],
  egg: ['egg'],
  shell: ['shell', 'seashell'],
  mushroom: ['mushroom', 'toadstool'],
  bench: ['bench'],
  trophy: ['trophy', 'medal', 'prize'],
  gem: ['gem', 'crystal', 'diamond', 'jewel'],
  letter: ['letter', 'note', 'envelope'],
  laptop: ['laptop', 'computer'],
  phone: ['phone', 'smartphone'],
  backpack: ['backpack', 'bag', 'rucksack'],
  coffee: ['coffee', 'tea', 'mug', 'cup'],
  bike: ['bike', 'bicycle'],
  door: ['door', 'gate', 'portal'],
  bridge: ['bridge'],
  sign: ['sign'],
  basket: ['basket'],
  drum: ['drum'],
  microphone: ['microphone', 'mic'],
  camera: ['camera'],
  skateboard: ['skateboard'],
  bible: ['bible', 'scripture', 'hymn book', 'hymnal'],
  cross: ['cross', 'crucifix'],
  candle: ['candle', 'candles'],
};

// Words that signal a held/carried prop.
export const HOLD_VERBS = ['hold', 'carry', 'grab', 'pick', 'give', 'bring', 'take', 'find', 'hand', 'lift', 'clutch', 'wave'];

// Visual effects triggered by words.
export const FX = {
  sparkles: ['magic', 'magical', 'sparkle', 'glitter', 'glow', 'shine', 'shimmer', 'spell', 'wish', 'enchant', 'twinkle', 'appear', 'vanish', 'transform'],
  hearts: ['love', 'hug', 'kiss', 'heart', 'adore'],
  confetti: ['celebrate', 'party', 'birthday', 'hooray', 'congratulations', 'victory', 'win', 'won', 'cheer', 'festival'],
  notes: ['sing', 'song', 'music', 'melody', 'hum', 'guitar', 'piano', 'dance', 'concert'],
  bubbles: ['bubble', 'underwater', 'soap'],
  fireflies: ['firefly', 'fireflies', 'glowworm'],
  leaves: ['autumn', 'fall leaves', 'leaves', 'wind', 'breeze', 'windy'],
  fireworks: ['fireworks', 'firework'],
  poof: ['poof', 'boom', 'explode', 'explosion', 'smoke', 'puff'],
  shootingstar: ['shooting star', 'wishing star', 'comet', 'wish upon'],
  godrays: ['light', 'heaven', 'heavenly', 'glory', 'holy', 'spirit', 'born again', 'saved', 'grace', 'faith', 'god', 'jesus', 'lord', 'blessing', 'miracle', 'angel', 'sunbeam', 'sunlight'],
};

export const STOPWORDS_CAPS = new Set(('The A An And But Or So Then When While After Before Once One Two Three Every Each ' +
  'Suddenly Finally Later Soon Meanwhile Today Tomorrow Yesterday Tonight Long Far Deep High Up Down In On At To ' +
  'Of For With Without From Into Onto Under Over Above Below Behind Beside Near Through Across Around Inside Outside ' +
  'This That These Those There Here It Its He She They We You I Me My Your Our Their His Her Him Them Us ' +
  'Hello Hi Hey Oh Wow Yes No Please Thank Thanks Goodbye Bye Look Come Let Lets What Why How Who Where Which ' +
  'Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August ' +
  'September October November December Christmas Halloween Easter Earth Moon Mars Sun God Mr Mrs Ms Dr Sir Miss ' +
  'Not Just Even Still Also Only All Some Every Nobody Everyone Someone Something Nothing Everything Maybe Okay OK ' +
  'Good Great Little Big Old New Happy Sad Dear Once The End Title Chapter Scene Narrator Can Will Would Could Should ' +
  'Did Do Does Is Are Was Were Be Been Being Have Has Had Am Wait Stop Go Run Help Watch Listen See Yay Hooray Whoa Ah Ahh Hmm Uh').split(' '));
