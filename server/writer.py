"""Dialogue writer: a small open language model turns a story into what the
characters say out loud in each scene, so a film is acted, not narrated.

  writer: Qwen3-4B-Instruct-2507 (Qwen/Qwen3-4B-Instruct-2507, Apache 2.0)   ~8 GB

The model waits in RAM and borrows the GPU only while it writes (a few seconds
per film), so it fits next to the video and lip-sync models.

Request:  {"title", "story", "cast": [{"id", "name", "about"}],
           "scenes": [{"index", "text", "characters": [id], "quotes": [{"speaker", "text"}], "mood"}]}
Response: {"scenes": [{"index", "lines": [{"speaker": id, "text"}]}]}
"""
import os, re, threading, time

MODEL = os.environ.get('STORYREEL_WRITER_MODEL', 'Qwen/Qwen3-4B-Instruct-2507')
state = {'model': None, 'tok': None, 'status': 'off', 'error': None}  # off | loading | ready | failed

SYSTEM = """You write the spoken dialogue for short animated films. There is no narrator: the audience only hears what the characters say on screen, so their words alone must carry the story.

Rules:
- For every scene, write 1 or 2 lines that the characters on screen in that scene say out loud in that moment.
- Only characters listed as on screen in a scene may speak in it.
- If a scene already has dialogue, keep those lines word for word, and add at most one more line.
- Natural, warm, spoken English in the present moment, like a Pixar film. Short: at most 14 words per line.
- Someone who only hears the words must understand the scene: name the concrete things that happen, the place, the objects and the people
  (say "Look at these drums!" or "This church is so big..." rather than "I feel the rhythm"). Show how the characters feel.
- Use 2 lines in a scene when it helps: a reaction, a question and an answer, or two characters talking to each other.
- A character who is alone thinks out loud, talks to themselves, or prays.
- Characters may call each other by name.
- Never narrate or describe actions. No stage directions, no parentheses, no emojis, no quotation marks.
- Family friendly.

Answer in exactly this format and nothing else:
SCENE 1
Name: line
SCENE 2
Name: line
Name: line"""


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
        out.append(f"  On screen: {on}" + (f"; mood: {sc['mood']}" if sc.get('mood') else ''))
        for q in sc.get('quotes', []):
            out.append(f"  Already says: {names.get(q['speaker'], q['speaker'])}: {q['text']}")
    out += ['', 'Write the dialogue for every scene, from SCENE 1 to SCENE %d.' % len(req.get('scenes', []))]
    return '\n'.join(out)


def parse(text, req):
    """The model's "SCENE n / Name: line" answer → {"scenes": [...]}, keeping only lines
    spoken by a character who is on screen in that scene."""
    by_name = {}
    for c in req.get('cast', []):
        n = c['name'].lower()
        by_name[n] = c['id']
        by_name[re.sub(r'^the\s+', '', n)] = c['id']
    scenes = {sc['index']: set(sc.get('characters', [])) for sc in req.get('scenes', [])}
    out, cur = {}, None
    for raw in text.splitlines():
        line = raw.strip().strip('*').strip()
        m = re.match(r'^(?:#+\s*)?scene\s+(\d+)\b', line, re.I)
        if m:
            cur = int(m.group(1)) - 1
            continue
        m = re.match(r'^([A-Za-z][\w .\'-]{0,40}?)\s*:\s*(.+)$', line)
        if cur is None or cur not in scenes or not m:
            continue
        who = by_name.get(re.sub(r'^the\s+', '', m.group(1).strip().lower()))
        said = re.sub(r'\([^)]*\)|\*[^*]*\*', '', m.group(2)).strip().strip('"“”').strip()
        if not who or who not in scenes[cur] or not re.search(r'[A-Za-z]', said):
            continue
        lines = out.setdefault(cur, [])
        if len(lines) < 3:
            lines.append({'speaker': who, 'text': said[:200]})
    return {'scenes': [{'index': i, 'lines': ls} for i, ls in sorted(out.items())]}


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
        return {'scenes': [{'index': sc['index'], 'lines': [{'speaker': sc['characters'][0], 'text': sc.get('text', '')}]}
                           for sc in req.get('scenes', []) if sc.get('characters')]}
    if state['status'] != 'ready':
        raise RuntimeError(f"dialogue writer is {state['status']}")
    import torch
    tok, model = state['tok'], state['model']
    msgs = [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': describe(req)}]
    ids = tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors='pt', return_dict=True)['input_ids']
    n = len(req.get('scenes', []))
    t0 = time.time()
    with gpu_lock:
        # borrow the GPU when there's room (the video model stays put); otherwise write on the CPU
        dev = 'cpu'
        if torch.cuda.is_available() and torch.cuda.mem_get_info()[0] > 11 * 2**30:
            model.to('cuda'); dev = 'cuda'
        try:
            with torch.no_grad():
                out = model.generate(ids.to(dev), max_new_tokens=min(2400, 60 + 70 * n), do_sample=True,
                                     temperature=0.7, top_p=0.8, top_k=20, pad_token_id=tok.eos_token_id)
        finally:
            if dev == 'cuda':
                model.to('cpu'); torch.cuda.empty_cache()
    text = tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True)
    print(f'[storyreel] dialogue for {n} scenes in {time.time() - t0:.1f}s on {dev}', flush=True)
    return parse(text, req)


def start_loading():
    threading.Thread(target=load, daemon=True).start()
