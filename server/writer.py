"""Writer and director: a small open language model reads the whole story and
- writes what the characters say out loud in each scene, so a film is acted, not narrated;
- fixes each character's look once (face, hair, skin, age, clothes), so every shot shows
  the same person;
- describes each shot as a picture (who, where, doing what, expression, objects);
- on request, turns a short idea into a fuller story ("Enhance").

  writer: Qwen3-4B-Instruct-2507 (Qwen/Qwen3-4B-Instruct-2507, Apache 2.0)   ~8 GB

The model waits in RAM and borrows the GPU only while it writes (a few seconds
per film), so it fits next to the video and lip-sync models.

Request:  {"title", "story", "cast": [{"id", "name", "about"}],
           "scenes": [{"index", "text", "characters": [id], "quotes": [{"speaker", "text"}], "mood"}]}
Response: {"cast": [{"id", "look"}], "scenes": [{"index", "shot", "lines": [{"speaker": id, "text"}]}]}
Enhance:  {"story"} -> {"story"}
"""
import os, re, threading, time

MODEL = os.environ.get('STORYREEL_WRITER_MODEL', 'Qwen/Qwen3-4B-Instruct-2507')
state = {'model': None, 'tok': None, 'status': 'off', 'error': None}  # off | loading | ready | failed

SYSTEM = """You are the director and writer of a short film. You fix how every character looks, describe every shot for the camera, and write the spoken dialogue. There is no narrator: the audience only hears what the characters say on screen, so their words alone must carry the story.

Looks (the CAST section):
- One line per character: Name: their look, which stays exactly the same in every shot.
- Give age, gender, skin tone, face shape, eye colour, hair (colour, length, style), facial hair if any, and clothes with colours. At most 35 words.
- Follow everything the story says about them; invent the rest so it is specific.
- Clothes and hair fit the story's time and place. Bible stories (Mary and Joseph, baby Jesus, shepherds, disciples, the empty tomb) happen in ancient Israel: simple robes, tunics, head scarves, cloaks and sandals in earthy colours, never modern clothes.
- An angel is a kind, beautiful person with long flowing hair, shining white robes, large soft feathered wings and warm, normal eyes.
- A group (The shepherds): describe them as a group: how many, their ages and clothes.
- If a listed character is not really a person or creature in the story (a place, a word read by mistake), write: Name: none

Shots (a SHOT line in every scene):
- What the camera sees, as a picture description: who is in it (by name), where exactly, what each person is doing, their facial expression, the important objects, the light. At most 40 words.
- Follow the story exactly: the right people, the right place, the right action and objects (if someone plays the drums, show them at a drum kit).
- Only the people who are really there at that moment. "In the story here" lists who the story mentions around the scene, and some of them are elsewhere: someone only talked about, prayed for, remembered, or far away (in hospital, back home, left behind) is not in the shot. Someone who left a place is no longer there.
- Name every person in the shot (never just he or she). Each person appears once. Mention only the people in the shot: never say where anyone else is.
- Places and objects fit the story's time: in Bible times, stone houses, oil lamps, a wooden stable with a manger, a tomb cut into a rocky hillside with a large round stone, and everyone in the shot (friends, crowds, passers-by too) in ancient clothes; nothing modern, no gravestones.
- Do not describe the characters' looks again: those come from CAST.

Dialogue rules:
- For every scene, write 1 or 2 lines that the characters in that scene's SHOT say out loud in that moment.
- Only people in the SHOT speak. A baby or an animal never talks (unless the story makes it talk).
- If a scene already has dialogue, keep those lines word for word, and add at most one more line. If the story shows that someone else says a line than the one given, give it to the person who really says it.
- Never turn the storyteller's sentences into dialogue, not even in the first person: nobody says "Nearby, shepherds were watching their sheep" or "I hurried to the stable". Say what someone would really say in that moment ("Look, there he is!").
- Natural, warm, spoken English in the present moment, like a Pixar film. Short: at most 14 words per line.
- Someone who only hears the words must understand the scene: name the concrete things that happen, the place, the objects and the people
  (say "Look at these drums!" or "This church is so big..." rather than "I feel the rhythm"). Show how the characters feel.
- Use 2 lines in a scene when it helps: a reaction, a question and an answer, or two characters talking to each other.
- A character who is alone thinks out loud, talks to themselves, or prays.
- Characters may call each other by name.
- Never narrate or describe actions. No stage directions, no parentheses, no emojis, no quotation marks.
- Family friendly.

Answer in exactly this format and nothing else:
CAST
Name: look
Name: look
SCENE 1
SHOT: what the camera sees
Name: line
SCENE 2
SHOT: what the camera sees
Name: line
Name: line"""

ENHANCE = """You help people turn an idea into a short film story that an AI film studio can make well.

Rewrite the user's idea as a clear story of 6 to 10 short sentences, each under 22 words:
- Keep everything the user wrote: their characters, places, events, order and any dialogue, word for word where they quoted it.
- Give each character a first name (keep the user's names) and say briefly how they look the first time they appear.
- Say clearly where each part happens and what each person does: one visual moment per sentence.
- Add a few short lines of dialogue in quotation marks, so the characters talk.
- One moment per sentence: what someone does, where, or what they say. Put dialogue in its own sentence.
- Simple, vivid English. No headings, no lists, no notes, no asterisks, no sound effects like *bang*.

Answer with a short title on the first line, then the story, and nothing else."""


def describe(req):
    """The story and its scenes as the model reads them."""
    names = {c['id']: c['name'] for c in req.get('cast', [])}
    out = [f"Title: {req.get('title', '')}", '', 'Story:', req.get('story', '').strip(), '', 'Characters:']
    for c in req.get('cast', []):
        out.append(f"- {c['name']}: {c.get('about', '')}".rstrip(': '))
    out += ['', 'Scenes:']
    for sc in req.get('scenes', []):
        on = ', '.join(names.get(i, i) for i in sc.get('characters', [])) or 'nobody'
        out.append(f"SCENE {sc['index'] + 1}: {sc.get('text', '').strip()}")
        out.append(f"  In the story here: {on}" + (f"; mood: {sc['mood']}" if sc.get('mood') else ''))
        for q in sc.get('quotes', []):
            out.append(f"  Already says: {names.get(q['speaker'], q['speaker'])}: {q['text']}")
    out += ['', 'Write the CAST, then the SHOT and the dialogue for every scene, from SCENE 1 to SCENE %d.' % len(req.get('scenes', []))]
    return '\n'.join(out)


def parse(text, req):
    """The model's answer → {"cast": [...], "scenes": [...]}: CAST looks, each scene's SHOT, and only
    the lines spoken by a character who is on screen in that scene."""
    by_name = {}
    for c in req.get('cast', []):
        n = c['name'].lower()
        bare = re.sub(r'^the\s+', '', n)
        for k in (n, bare, bare[:-1] if bare.endswith('s') else bare + 's'):  # "The shepherds" / "Shepherd"
            by_name.setdefault(k, c['id'])
    scenes = {sc['index']: set(sc.get('characters', [])) for sc in req.get('scenes', [])}
    out, shots, looks, cur = {}, {}, {}, None
    for raw in text.splitlines():
        line = raw.strip().strip('*').strip()
        m = re.match(r'^(?:#+\s*)?scene\s+(\d+)\b', line, re.I)
        if m:
            cur = int(m.group(1)) - 1
            continue
        m = re.match(r'^shot\s*:\s*(.+)$', line, re.I)
        if m:
            if cur in scenes:
                shots[cur] = m.group(1).strip()[:320]
            continue
        m = re.match(r'^([A-Za-z][\w .\'-]{0,40}?)\s*:\s*(.+)$', line)
        if cur is None and m:  # the CAST section, before the first scene
            who = by_name.get(re.sub(r'^the\s+', '', m.group(1).strip().lower()))
            if who:
                looks[who] = m.group(2).strip()[:260]
            continue
        if cur is None or cur not in scenes or not m:
            continue
        who = by_name.get(re.sub(r'^the\s+', '', m.group(1).strip().lower()))
        said = re.sub(r'\([^)]*\)|\*[^*]*\*', '', m.group(2)).strip().strip('"“”').strip()
        if not who or who not in scenes[cur] or not re.search(r'[A-Za-z]', said):
            continue
        lines = out.setdefault(cur, [])
        if len(lines) < 3:
            lines.append({'speaker': who, 'text': said[:200]})
    return {'cast': [{'id': i, 'look': l} for i, l in looks.items()],
            'scenes': [{'index': i, 'shot': shots.get(i, ''), 'lines': out.get(i, [])} for i in sorted(set(out) | set(shots))]}


def load():
    """Load into RAM (in the background, after the other models)."""
    state['status'] = 'loading'
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        state['tok'] = AutoTokenizer.from_pretrained(MODEL)
        state['model'] = AutoModelForCausalLM.from_pretrained(MODEL, torch_dtype=torch.bfloat16, low_cpu_mem_usage=True).eval()
        state['status'] = 'ready'
        print(f'[storyreel] dialogue writer ready ({MODEL})', flush=True)
    except Exception as e:
        state['status'], state['error'] = 'failed', str(e)
        print(f'[storyreel] dialogue writer unavailable ({e})', flush=True)


def write(req, gpu_lock, mock=False):
    if mock:  # each scene: its first character says the scene's sentence
        return {'cast': [{'id': c['id'], 'look': f"{c.get('about', '')}, short brown hair, blue jacket".strip(', ')} for c in req.get('cast', [])],
                'scenes': [{'index': sc['index'], 'shot': sc.get('text', ''), 'lines': [{'speaker': sc['characters'][0], 'text': sc.get('text', '')}]}
                           for sc in req.get('scenes', []) if sc.get('characters')]}
    n, nc = len(req.get('scenes', [])), len(req.get('cast', []))
    msgs = [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': describe(req)}]
    text = generate(msgs, min(3200, 150 + 50 * nc + 120 * n), gpu_lock, f'direction for {n} scenes')
    return parse(text, req)


def enhance(req, gpu_lock, mock=False):
    """A short idea → a fuller story the studio understands (title on the first line)."""
    idea = re.sub(r'\s+\n', '\n', str(req.get('story', ''))).strip()[:4000]
    if mock:
        return {'story': f'The Story\n{idea} "Here we go!" she said.'}
    msgs = [{'role': 'system', 'content': ENHANCE}, {'role': 'user', 'content': idea}]
    text = generate(msgs, 600, gpu_lock, 'story enhanced').strip()
    text = re.sub(r'^(?:title\s*:\s*)', '', text, flags=re.I).replace('*', '').replace('#', '').strip()
    return {'story': text or idea}


def generate(msgs, max_new, gpu_lock, what):
    if state['status'] != 'ready':
        raise RuntimeError(f"the writer is {state['status']}")
    import torch
    tok, model = state['tok'], state['model']
    ids = tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors='pt', return_dict=True)['input_ids']
    t0 = time.time()
    with gpu_lock:
        # borrow the GPU when there's room (the video model stays put); otherwise write on the CPU
        dev = 'cpu'
        if torch.cuda.is_available() and torch.cuda.mem_get_info()[0] > 11 * 2**30:
            model.to('cuda'); dev = 'cuda'
        try:
            with torch.no_grad():
                out = model.generate(ids.to(dev), max_new_tokens=max_new, do_sample=True,
                                     temperature=0.7, top_p=0.8, top_k=20, pad_token_id=tok.eos_token_id)
        finally:
            if dev == 'cuda':
                model.to('cpu'); torch.cuda.empty_cache()
    text = tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True)
    print(f'[storyreel] {what} in {time.time() - t0:.1f}s on {dev}', flush=True)
    return text


def start_loading():
    threading.Thread(target=load, daemon=True).start()
