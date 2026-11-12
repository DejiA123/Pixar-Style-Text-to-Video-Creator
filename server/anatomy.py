"""Anatomy check: finds people with more hands or arms than they should have in a picture or a
video frame, so the server can redo it with another seed before anyone sees it.

  detector: Grounding DINO tiny (IDEA-Research/grounding-dino-tiny, Apache 2.0)   ~0.7 GB

It finds every "person", "hand" and "face", and in a second look every "arm"; a hand or an arm
belongs to the person whose box holds it. Someone with three or more hands or arms of their own,
or more in the picture than two per person, counts as a glitch. To keep false alarms down, hands
and arms at the very edge of the picture (someone out of frame), near-copies (one arm found twice,
a forearm inside its arm) and boxes as big as a body are left out, and when there are more faces
than bodies found (a group on a sofa), only the total is trusted. If the detector can't load,
nothing is checked and films are made as before.
"""
import os, threading

MODEL = os.environ.get('STORYREEL_ANATOMY_MODEL', 'IDEA-Research/grounding-dino-tiny')
state = {'model': None, 'proc': None, 'dev': 'cpu', 'status': 'off', 'error': None,  # off | ready | failed
         'flags': {'hands': 0, 'arms': 0}}  # pictures and frames found with a hand / an arm too many
lock = threading.Lock()
PROMPT = 'a person. a hand. a face.'
ARM_PROMPT = 'an arm.'  # a look of its own, so the hand check stays exactly as it was


def load(dev='cuda'):
    try:
        from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
        state['proc'] = AutoProcessor.from_pretrained(MODEL)
        state['model'] = AutoModelForZeroShotObjectDetection.from_pretrained(MODEL).eval().to(dev)
        state['dev'], state['status'] = dev, 'ready'
        print(f'[storyreel] anatomy check ready ({MODEL})', flush=True)
    except Exception as e:  # films are still made, just unchecked
        state['status'], state['error'] = 'failed', str(e)[:200]
        print(f'[storyreel] anatomy check unavailable ({e})', flush=True)


def _area(r):
    return max(0, r[2] - r[0]) * max(0, r[3] - r[1])


def _overlap(a, b):
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    return max(0, x2 - x1) * max(0, y2 - y1)


def _iou(a, b):
    inter = _overlap(a, b)
    return inter / (_area(a) + _area(b) - inter + 1e-9)


def _dedupe(boxes, centres=False, contained=0.0):
    """boxes: [(box, score)] → the same without near-copies of a better-scored box
    (centres: also drop a box whose centre lies inside a better one: one hand found twice;
    contained: also drop a box when at least this share of the smaller of the two lies inside the
    other: a forearm inside its arm, or two crossed arms, which then count once)."""
    out = []
    for b, s in sorted(boxes, key=lambda x: -x[1]):
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        if any(_iou(b, o) >= 0.5 or (centres and o[0] <= cx <= o[2] and o[1] <= cy <= o[3])
               or (contained and _overlap(b, o) >= contained * min(_area(b), _area(o)) > 0) for o, _ in out):
            continue
        out.append((b, s))
    return out


def _off_edge(boxes, size):
    """Leaves out boxes touching the edge of the picture (someone mostly out of frame)."""
    if not size:
        return boxes
    W, H = size
    ex, ey = 0.015 * W, 0.015 * H
    return [h for h in boxes if h[0] > ex and h[1] > ey and h[2] < W - ex and h[3] < H - ey]


def _owners(box, persons):
    """The people whose box (a little wider) holds this box's centre."""
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    out = []
    for k, p in enumerate(persons):
        mx, my = 0.04 * (p[2] - p[0]), 0.04 * (p[3] - p[1])
        if p[0] - mx <= cx <= p[2] + mx and p[1] - my <= cy <= p[3] + my:
            out.append(k)
    return out


def _too_many(own, shared, persons, faces):
    people = max(len(persons), len(faces))
    extra_all = max(0, sum(own) + shared - 2 * people)
    if len(faces) > len(persons):  # bodies were missed: whose is whose can't be told
        return extra_all
    return max(sum(max(0, n - 2) for n in own), extra_all)


def count_extra(persons, hands, faces=(), size=None):
    """How many hands too many: persons, hands and faces are [x1, y1, x2, y2] boxes, size is (width, height).
    A hand counts for the one person whose box holds its centre; a hand inside two people's boxes
    (a hug, a handshake) counts for the group. Hands with nobody around them, and hands touching the
    edge of the picture, are left out (someone mostly out of frame)."""
    if not persons or not hands:
        return 0
    biggest = max(_area(p) for p in persons)
    hands = [h for h in hands if _area(h) < 0.2 * biggest]  # a "hand" as big as a person is no hand
    hands = _off_edge(hands, size)
    own = [0] * len(persons)
    shared = 0
    for h in hands:
        inside = _owners(h, persons)
        if len(inside) == 1:
            own[inside[0]] += 1
        elif inside:
            shared += 1
    return _too_many(own, shared, persons, faces)


def count_extra_arms(persons, arms, faces=(), size=None):
    """How many arms too many, by the same rules as hands; arms are boxes, best-scored first.
    An "arm" box covering half its person or more is both arms and the body, not one arm, and is left
    out first (so it can't hide the arms inside it); then a forearm inside its arm, or two crossed
    arms, count once."""
    if not persons or not arms:
        return 0

    def body_sized(a):
        owners = _owners(a, persons)
        return bool(owners) and all(_area(a) >= 0.5 * _area(persons[k]) for k in owners)
    arms = _off_edge([a for a in arms if not body_sized(a)], size)
    arms = [b for b, _ in _dedupe([(a, -i) for i, a in enumerate(arms)], contained=0.6)]
    own = [0] * len(persons)
    shared = 0
    for a in arms:
        inside = _owners(a, persons)
        if len(inside) == 1:
            own[inside[0]] += 1
        elif inside:
            shared += 1
    return _too_many(own, shared, persons, faces)


def _run(images, prompt, threshold, text_threshold):
    import torch
    proc, model = state['proc'], state['model']
    with lock, torch.no_grad():
        inp = proc(images=images, text=[prompt] * len(images), return_tensors='pt').to(state['dev'])
        out = model(**inp)
        return proc.post_process_grounded_object_detection(out, inp.input_ids, threshold=threshold, text_threshold=text_threshold,
                                                            target_sizes=[im.size[::-1] for im in images])


def detect(images):
    """PIL images → for each, (person boxes, hand boxes, face boxes)."""
    found = []
    for r in _run(images, PROMPT, 0.28, 0.25):
        labels = r.get('text_labels', r.get('labels'))
        persons, hands, faces = [], [], []
        for box, score, label in zip(r['boxes'].tolist(), r['scores'].tolist(), labels):
            kinds = [k for k in ('person', 'hand', 'face') if k in str(label)]
            if len(kinds) != 1:
                continue
            (persons if kinds[0] == 'person' else hands if kinds[0] == 'hand' else faces).append((box, score))
        found.append(([b for b, _ in _dedupe(persons)], [b for b, _ in _dedupe(hands, centres=True)], [b for b, _ in _dedupe(faces)]))
    return found


def detect_arms(images):
    """PIL images → for each, the arm boxes, best-scored first (a higher bar than hands: arms are found
    less surely). Near-copies are merged by count_extra_arms, once boxes as big as a body are out."""
    found = []
    for r in _run(images, ARM_PROMPT, 0.35, 0.3):
        labels = r.get('text_labels', r.get('labels'))
        arms = [(box, score) for box, score, label in zip(r['boxes'].tolist(), r['scores'].tolist(), labels) if 'arm' in str(label)]
        found.append([b for b, _ in sorted(arms, key=lambda x: -x[1])])
    return found


def extra_limbs(images):
    """The most hands or arms too many found in any of the images (0 when all is well, or when there is no check)."""
    if state['status'] != 'ready' or not images:
        return 0
    try:
        images = list(images)
        worst = 0
        for im, (p, h, f), arms in zip(images, detect(images), detect_arms(images)):
            hands_extra, arms_extra = count_extra(p, h, f, im.size), count_extra_arms(p, arms, f, im.size)
            state['flags']['hands'] += hands_extra > 0
            state['flags']['arms'] += arms_extra > 0
            worst = max(worst, hands_extra, arms_extra)
        return worst
    except Exception as e:
        print('[storyreel] anatomy check failed:', e, flush=True)
        return 0


extra_hands = extra_limbs  # the earlier name
