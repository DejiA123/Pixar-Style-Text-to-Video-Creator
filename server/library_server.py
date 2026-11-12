"""TakeOne accounts and film backup (My films): a small web service beside the AI studio.

An account is a passkey: one tap and Face ID, Touch ID, a fingerprint or the phone's own lock.
No password, no email. The passkey lives in the person's iCloud Keychain or Google Password Manager,
so it's on all their devices, and a computer signs in with their phone (a QR code).

It runs on a small CPU container on Modal (server/modal_app.py: library), never on the GPU, and
keeps accounts and films on a Modal Volume. On your own computer:
  pip install "fastapi[standard]" webauthn
  STORYREEL_FILMS=./films uvicorn --factory library_server:local_app --port 7870   (from server/)

API (JSON; CORS for the app's own addresses; films need "Authorization: Bearer <session>"):
  GET  /health                                     -> {ok, service}
  POST /auth/register/options {name}              -> {options, state}   then navigator.credentials.create
  POST /auth/register/verify {state, credential, name?} -> {session, user}
  POST /auth/login/options {}                      -> {options, state}   then navigator.credentials.get
  POST /auth/login/verify {state, credential}      -> {session, user}
  GET  /me                                         -> {user, films, bytes}
  GET  /films                                      -> {films: [record…], deleted: [id…]}
  PUT  /films/{id}  record (JSON)                  -> {ok}    files the record no longer lists are removed
  PUT  /films/{id}/files/{name}  bytes             -> {ok, size}
  GET  /films/{id}/files/{name}                    -> bytes
  DELETE /films/{id}                               -> {ok}    (other devices remove their copy too)
"""
import base64, hashlib, hmac, json, os, re, secrets, shutil, threading, time
from contextlib import asynccontextmanager
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

# the app's own addresses: takeoneai.pages.dev (and its preview links) and a computer running it
ORIGINS = os.environ.get('STORYREEL_ORIGINS', r'^(https://([a-z0-9-]+\.)*takeoneai\.pages\.dev|http://localhost(:\d+)?)$')
SITE = 'takeoneai.pages.dev'
MAX_FILE = int(os.environ.get('STORYREEL_MAX_FILE_MB', '150')) * 2**20     # one picture, clip or voice
QUOTA = int(float(os.environ.get('STORYREEL_QUOTA_GB', '5')) * 2**30)     # all of one person's films (a film is ~20-40 MB)
TOTAL = int(float(os.environ.get('STORYREEL_TOTAL_GB', '100')) * 2**30)   # everyone's films together: a cap on the bill
SIGNUPS_PER_HOUR = int(os.environ.get('STORYREEL_SIGNUPS_PER_HOUR', '6'))  # new accounts from one address (no account farms)
SESSION_DAYS = 400
ID = re.compile(r'^[A-Za-z0-9-]{8,64}$')          # a film
UID = re.compile(r'^[A-Za-z0-9_-]{16,40}$')       # an account (16 random bytes)
NAME = re.compile(r'^[a-z0-9][a-z0-9._-]{0,80}$')
TYPES = {'png': 'image/png', 'jpg': 'image/jpeg', 'webp': 'image/webp', 'mp4': 'video/mp4', 'webm': 'video/webm', 'wav': 'audio/wav'}


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def unb64u(s):
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def clean_name(name):
    return re.sub(r'\s+', ' ', str(name or '')).strip()[:40] or 'TakeOne'


def rp_id_for(origin):
    """The passkey's site: takeoneai.pages.dev for the app and its preview links, else the address itself."""
    host = urlparse(origin).hostname or ''
    return SITE if host == SITE or host.endswith('.' + SITE) else host


class Store:
    """Accounts and films on disk (a Modal Volume): users/<uid>/user.json, users/<uid>/films/<id>/film.json
    and files/<name>; credentials/<passkey id>.json says whose a passkey is."""

    def __init__(self, root, commit=None):
        self.root = root
        os.makedirs(os.path.join(root, 'users'), exist_ok=True)
        os.makedirs(os.path.join(root, 'credentials'), exist_ok=True)
        self.lock = threading.RLock()
        self._commit, self._dirty = commit, threading.Event()
        key = os.path.join(root, 'secret.key')
        if not os.path.exists(key):
            self.write(key, secrets.token_bytes(32))
        with open(key, 'rb') as f:
            self.secret = f.read()
        if commit:  # saved to the volume a moment after each change, and when the container stops
            threading.Thread(target=self._committer, daemon=True).start()

    def changed(self):
        self._dirty.set()

    def _committer(self):
        while True:
            self._dirty.wait()
            time.sleep(1.5)
            self._dirty.clear()
            self.flush()

    def flush(self):
        if self._commit:
            try:
                self._commit()
            except Exception as e:
                print('[library] volume commit failed:', e, flush=True)
                self._dirty.set()

    def write(self, path, data):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f'{path}.tmp-{secrets.token_hex(4)}'
        with open(tmp, 'wb') as f:
            f.write(data if isinstance(data, bytes) else json.dumps(data, separators=(',', ':')).encode())
        os.replace(tmp, path)
        self.changed()

    def read(self, path):
        try:
            with open(path, 'rb') as f:
                return json.loads(f.read())
        except (OSError, ValueError):
            return None

    def user_dir(self, uid):
        return os.path.join(self.root, 'users', uid)

    def film_dir(self, uid, fid):
        return os.path.join(self.user_dir(uid), 'films', fid)

    def user(self, uid):
        return self.read(os.path.join(self.user_dir(uid), 'user.json')) if UID.match(uid or '') else None

    def save_user(self, u):
        self.write(os.path.join(self.user_dir(u['id']), 'user.json'), u)

    def all_bytes(self):
        """Everyone's films together (counted again every 10 minutes, kept up to date between)."""
        if time.time() - getattr(self, '_all_t', 0) > 600:
            self._all = sum(self.bytes_used(u) for u in os.listdir(os.path.join(self.root, 'users')))
            self._all_t = time.time()
        return self._all

    def bytes_used(self, uid):
        total = 0
        for dirpath, _, names in os.walk(os.path.join(self.user_dir(uid), 'films')):
            for n in names:
                try:
                    total += os.path.getsize(os.path.join(dirpath, n))
                except OSError:
                    pass
        return total

    # ---- signed tokens: the passkey ceremony's state between its two calls, and sessions ----
    def sign(self, obj):
        body = b64u(json.dumps(obj, separators=(',', ':')).encode())
        return f'{body}.{b64u(hmac.new(self.secret, body.encode(), hashlib.sha256).digest())}'

    def unsign(self, token, kind):
        try:
            body, mac = str(token).split('.')
            good = hmac.compare_digest(mac, b64u(hmac.new(self.secret, body.encode(), hashlib.sha256).digest()))
            obj = json.loads(unb64u(body)) if good else None
        except (ValueError, TypeError):
            obj = None
        if not obj or obj.get('k') != kind or obj.get('exp', 0) < time.time():
            raise HTTPException(401, 'sign in again' if kind == 'session' else 'that took too long: please try again')
        return obj


def create_app(root, commit=None):
    store = Store(root, commit)
    used = {}  # passkey challenges already answered (each works once), until they expire
    signups = {}  # address → times of its new accounts in the last hour

    def address(request):
        fwd = request.headers.get('x-forwarded-for', '')
        return fwd.split(',')[0].strip() or (request.client.host if request.client else '?')

    def may_sign_up(request):
        now, ip = time.time(), address(request)
        recent = [t for t in signups.get(ip, []) if t > now - 3600]
        if len(recent) >= SIGNUPS_PER_HOUR:
            raise HTTPException(429, 'Too many new accounts from here: please try again in an hour.')
        signups[ip] = recent + [now]

    def once(challenge, exp):
        now = time.time()
        for c in [c for c, t in used.items() if t < now]:
            used.pop(c, None)
        if challenge in used:
            raise HTTPException(401, 'please try again')
        used[challenge] = exp

    @asynccontextmanager
    async def lifespan(_):
        yield
        store.flush()  # the last changes, before the container stops

    app = FastAPI(title='TakeOne library', lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origin_regex=ORIGINS, allow_methods=['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
                       allow_headers=['Authorization', 'Content-Type'], max_age=86400)

    @app.exception_handler(HTTPException)
    async def errors(_, e):
        return JSONResponse({'error': e.detail}, status_code=e.status_code)

    def origin_of(request):
        o = request.headers.get('origin') or ''
        if not re.match(ORIGINS, o):
            raise HTTPException(403, 'accounts work on the TakeOne app itself')
        return o

    def session_for(uid):
        now = int(time.time())
        return store.sign({'k': 'session', 'u': uid, 'iat': now, 'exp': now + SESSION_DAYS * 86400})

    def who(request):
        auth = request.headers.get('authorization') or ''
        tok = store.unsign(auth[7:] if auth.lower().startswith('bearer ') else '', 'session')
        u = store.user(tok['u'])
        if not u:
            raise HTTPException(401, 'sign in again')
        return u

    async def body(request, limit=4 * 2**20):
        raw = await request.body()
        if len(raw) > limit:
            raise HTTPException(413, 'too big')
        try:
            return json.loads(raw or b'{}')
        except ValueError:
            raise HTTPException(400, 'not JSON')

    @app.get('/health')
    def health():
        return {'ok': True, 'service': 'takeone-library'}

    # ---- passkeys ----
    @app.post('/auth/register/options')
    async def register_options(request: Request):
        from webauthn import generate_registration_options, options_to_json
        from webauthn.helpers.structs import AuthenticatorSelectionCriteria, ResidentKeyRequirement, UserVerificationRequirement
        origin = origin_of(request)
        name = clean_name((await body(request)).get('name'))
        uid = secrets.token_bytes(16)
        opts = generate_registration_options(
            rp_id=rp_id_for(origin), rp_name='TakeOne', user_id=uid, user_name=name, user_display_name=name, timeout=180000,
            authenticator_selection=AuthenticatorSelectionCriteria(resident_key=ResidentKeyRequirement.REQUIRED, require_resident_key=True,
                                                                   user_verification=UserVerificationRequirement.PREFERRED))
        exp = int(time.time()) + 600
        return {'options': json.loads(options_to_json(opts)),
                'state': store.sign({'k': 'reg', 'c': b64u(opts.challenge), 'u': b64u(uid), 'n': name, 'o': origin, 'exp': exp})}

    @app.post('/auth/register/verify')
    async def register_verify(request: Request):
        from webauthn import verify_registration_response
        origin = origin_of(request)
        req = await body(request)
        st = store.unsign(req.get('state'), 'reg')
        if st['o'] != origin:
            raise HTTPException(403, 'please try again')
        may_sign_up(request)
        once(st['c'], st['exp'])
        try:
            v = verify_registration_response(credential=req.get('credential'), expected_challenge=unb64u(st['c']),
                                             expected_rp_id=rp_id_for(origin), expected_origin=origin)
        except Exception as e:
            raise HTTPException(400, f'the passkey wasn’t accepted ({e})')
        cid = b64u(v.credential_id)
        with store.lock:
            if store.user(st['u']) or os.path.exists(os.path.join(root, 'credentials', f'{cid}.json')):
                raise HTTPException(409, 'please try again')
            now = int(time.time())
            name = clean_name(req.get('name')) if req.get('name') else st['n']  # the app asks for the passkey before you finish typing
            store.save_user({'id': st['u'], 'name': name, 'created': now, 'deleted': {},
                             'credentials': [{'id': cid, 'key': b64u(v.credential_public_key), 'count': v.sign_count, 'created': now}]})
            store.write(os.path.join(root, 'credentials', f'{cid}.json'), {'u': st['u']})
        return {'session': session_for(st['u']), 'user': {'id': st['u'], 'name': name}}

    @app.post('/auth/login/options')
    async def login_options(request: Request):
        from webauthn import generate_authentication_options, options_to_json
        from webauthn.helpers.structs import UserVerificationRequirement
        origin = origin_of(request)
        opts = generate_authentication_options(rp_id=rp_id_for(origin), user_verification=UserVerificationRequirement.PREFERRED, timeout=180000)
        exp = int(time.time()) + 600
        return {'options': json.loads(options_to_json(opts)),
                'state': store.sign({'k': 'login', 'c': b64u(opts.challenge), 'o': origin, 'exp': exp})}

    @app.post('/auth/login/verify')
    async def login_verify(request: Request):
        from webauthn import verify_authentication_response
        origin = origin_of(request)
        req = await body(request)
        st = store.unsign(req.get('state'), 'login')
        if st['o'] != origin:
            raise HTTPException(403, 'please try again')
        cred = req.get('credential') or {}
        cid = str(cred.get('id') or cred.get('rawId') or '').rstrip('=')
        if not re.match(r'^[A-Za-z0-9_-]{8,1400}$', cid):
            raise HTTPException(400, 'not a passkey')
        owner = store.read(os.path.join(root, 'credentials', f'{cid}.json'))
        u = store.user(owner['u']) if owner else None
        c = next((c for c in (u or {}).get('credentials', []) if c['id'] == cid), None)
        if not c:
            raise HTTPException(404, 'that passkey isn’t a TakeOne account any more')
        handle = (cred.get('response') or {}).get('userHandle')
        if handle and unb64u(handle) != unb64u(u['id']):
            raise HTTPException(401, 'that passkey belongs to someone else')
        once(st['c'], st['exp'])
        try:
            v = verify_authentication_response(credential=cred, expected_challenge=unb64u(st['c']), expected_rp_id=rp_id_for(origin),
                                               expected_origin=origin, credential_public_key=unb64u(c['key']), credential_current_sign_count=c['count'])
        except Exception as e:
            raise HTTPException(401, f'the passkey wasn’t accepted ({e})')
        with store.lock:
            u = store.user(u['id'])
            for x in u['credentials']:
                if x['id'] == cid:
                    x['count'], x['used'] = v.new_sign_count, int(time.time())
            store.save_user(u)
        return {'session': session_for(u['id']), 'user': {'id': u['id'], 'name': u['name']}}

    # ---- films ----
    def film_id(fid):
        if not ID.match(fid):
            raise HTTPException(400, 'not a film')
        return fid

    def not_deleted(u, fid):
        if fid in (u.get('deleted') or {}):
            raise HTTPException(410, 'this film was deleted')

    @app.get('/me')
    def me(request: Request):
        u = who(request)
        films = os.path.join(store.user_dir(u['id']), 'films')
        return {'user': {'id': u['id'], 'name': u['name']}, 'films': len(os.listdir(films)) if os.path.isdir(films) else 0, 'bytes': store.bytes_used(u['id'])}

    @app.get('/films')
    def films(request: Request):
        u = who(request)
        out, d = [], os.path.join(store.user_dir(u['id']), 'films')
        for fid in (os.listdir(d) if os.path.isdir(d) else []):
            rec = store.read(os.path.join(d, fid, 'film.json'))
            if rec:
                out.append(rec)
        out.sort(key=lambda r: -(r.get('updated') or 0))
        return {'films': out, 'deleted': list((u.get('deleted') or {}).keys())}

    @app.put('/films/{fid}')
    async def put_film(fid: str, request: Request):
        u = who(request)
        film_id(fid)
        not_deleted(u, fid)
        rec = await body(request)
        if rec.get('id') != fid or not isinstance(rec.get('files'), dict):
            raise HTTPException(400, 'not a film')
        rec.pop('cloud', None)
        d = store.film_dir(u['id'], fid)
        with store.lock:
            store.write(os.path.join(d, 'film.json'), rec)
            files = os.path.join(d, 'files')
            for n in (os.listdir(files) if os.path.isdir(files) else []):
                if n not in rec['files']:  # a picture or clip a redone shot replaced, or one left half-sent
                    os.remove(os.path.join(files, n))
                    store.changed()
        return {'ok': True}

    @app.put('/films/{fid}/files/{name}')
    async def put_file(fid: str, name: str, request: Request):
        u = who(request)
        film_id(fid)
        not_deleted(u, fid)
        if not NAME.match(name) or '..' in name:
            raise HTTPException(400, 'not a file name')
        room = min(QUOTA - store.bytes_used(u['id']), TOTAL - store.all_bytes())
        if room <= 0:
            raise HTTPException(413, 'your account is full: delete some films first')
        path = os.path.join(store.film_dir(u['id'], fid), 'files', name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp, size = f'{path}.tmp-{secrets.token_hex(4)}', 0
        try:
            with open(tmp, 'wb') as f:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > MAX_FILE or size > room:
                        raise HTTPException(413, 'that file is too big' if size > MAX_FILE else 'your account is full: delete some films first')
                    f.write(chunk)
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        store._all = store.all_bytes() + size
        store.changed()
        return {'ok': True, 'size': size}

    @app.get('/films/{fid}/files/{name}')
    def get_file(fid: str, name: str, request: Request):
        u = who(request)
        film_id(fid)
        if not NAME.match(name) or '..' in name:
            raise HTTPException(400, 'not a file name')
        path = os.path.join(store.film_dir(u['id'], fid), 'files', name)
        if not os.path.isfile(path):
            raise HTTPException(404, 'not found')
        return FileResponse(path, media_type=TYPES.get(name.rsplit('.', 1)[-1], 'application/octet-stream'), headers={'Cache-Control': 'private, max-age=86400'})

    @app.delete('/films/{fid}')
    def delete_film(fid: str, request: Request):
        u = who(request)
        film_id(fid)
        with store.lock:
            shutil.rmtree(store.film_dir(u['id'], fid), ignore_errors=True)
            u = store.user(u['id'])
            deleted = u.get('deleted') or {}
            deleted[fid] = int(time.time())
            u['deleted'] = dict(sorted(deleted.items(), key=lambda kv: kv[1])[-2000:])  # remembered so other devices let it go too
            store.save_user(u)
        return {'ok': True}

    return app


def local_app():
    return create_app(os.environ.get('STORYREEL_FILMS', 'films'))
