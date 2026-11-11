"""Anatomy check: finds people with more hands than they should have in a picture or a video
frame, so the server can redo it with another seed before anyone sees it.

  detector: Grounding DINO tiny (IDEA-Research/grounding-dino-tiny, Apache 2.0)   ~0.7 GB

It finds every "person", "hand" and "face"; a hand belongs to the person whose box holds it.
Someone with three or more hands of their own, or more hands in the picture than two per
person, counts as a glitch. To keep false alarms down, hands at the very edge of the picture
(someone out of frame) and near-copies of a hand are left out, and when there are more faces
than bodies found (a group on a sofa), only the total is trusted. If the detector can't load, nothing is checked and films are made
as before.
"""
import os, threading

MODEL = os.environ.get('STORYREEL_ANATOMY_MODEL', 'IDEA-Research/grounding-dino-tiny')
state = {'model': None, 'proc': None, 'dev': 'cpu', 'status': 'off', 'error': None}  # off | ready | failed
lock = threading.Lock()
PROMPT = 'a person. a hand. a face.'


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


def _iou(a, b):
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    area = lambda r: max(0, r[2] - r[0]) * max(0, r[3] - r[1])
    return inter / (area(a) + area(b) - inter + 1e-9)


def _dedupe(boxes, centres=False):
    """boxes: [(box, score)] → the same without near-copies of a better-scored box
    (centres: also drop a box whose centre lies inside a better one: one hand found twice)."""
    out = []
    for b, s in sorted(boxes, key=lambda x: -x[1]):
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        if any(_iou(b, o) >= 0.5 or (centres and o[0] <= cx <= o[2] and o[1] <= cy <= o[3]) for o, _ in out):
            continue
        out.append((b, s))
    return out


def count_extra(persons, hands, faces=(), size=None):
    """How many hands too many: persons, hands and faces are [x1, y1, x2, y2] boxes, size is (width, height).
    A hand counts for the one person whose box holds its centre; a hand inside two people's boxes
    (a hug, a handshake) counts for the group. Hands with nobody around them, and hands touching the
    edge of the picture, are left out (someone mostly out of frame)."""
    if not persons or not hands:
        return 0
    area = lambda r: max(0, r[2] - r[0]) * max(0, r[3] - r[1])
    biggest = max(area(p) for p in persons)
    hands = [h for h in hands if area(h) < 0.2 * biggest]  # a "hand" as big as a person is no hand
    if size:
        W, H = size
        ex, ey = 0.015 * W, 0.015 * H
        hands = [h for h in hands if h[0] > ex and h[1] > ey and h[2] < W - ex and h[3] < H - ey]
    own = [0] * len(persons)
    shared = 0
    for h in hands:
        cx, cy = (h[0] + h[2]) / 2, (h[1] + h[3]) / 2
        inside = []
        for k, p in enumerate(persons):
            mx, my = 0.04 * (p[2] - p[0]), 0.04 * (p[3] - p[1])
            if p[0] - mx <= cx <= p[2] + mx and p[1] - my <= cy <= p[3] + my:
                inside.append(k)
        if len(inside) == 1:
            own[inside[0]] += 1
        elif inside:
            shared += 1
    people = max(len(persons), len(faces))
    extra_all = max(0, sum(own) + shared - 2 * people)
    if len(faces) > len(persons):  # bodies were missed: whose hand is whose can't be told
        return extra_all
    return max(sum(max(0, n - 2) for n in own), extra_all)


def detect(images):
    """PIL images → for each, (person boxes, hand boxes, face boxes)."""
    import torch
    proc, model = state['proc'], state['model']
    with lock, torch.no_grad():
        inp = proc(images=images, text=[PROMPT] * len(images), return_tensors='pt').to(state['dev'])
        out = model(**inp)
        res = proc.post_process_grounded_object_detection(out, inp.input_ids, threshold=0.28, text_threshold=0.25,
                                                          target_sizes=[im.size[::-1] for im in images])
    found = []
    for r in res:
        labels = r.get('text_labels', r.get('labels'))
        persons, hands, faces = [], [], []
        for box, score, label in zip(r['boxes'].tolist(), r['scores'].tolist(), labels):
            kinds = [k for k in ('person', 'hand', 'face') if k in str(label)]
            if len(kinds) != 1:
                continue
            (persons if kinds[0] == 'person' else hands if kinds[0] == 'hand' else faces).append((box, score))
        found.append(([b for b, _ in _dedupe(persons)], [b for b, _ in _dedupe(hands, centres=True)], [b for b, _ in _dedupe(faces)]))
    return found


def extra_hands(images):
    """The most hands-too-many found in any of the images (0 when all is well, or when there is no check)."""
    if state['status'] != 'ready' or not images:
        return 0
    try:
        images = list(images)
        return max(count_extra(p, h, f, im.size) for im, (p, h, f) in zip(images, detect(images)))
    except Exception as e:
        print('[storyreel] anatomy check failed:', e, flush=True)
        return 0
