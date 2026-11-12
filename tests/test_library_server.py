"""python3 tests/test_library_server.py — accounts (passkeys) and film backup (server/library_server.py).

Needs: pip install "fastapi[standard]" webauthn httpx. A small software passkey (an EC P-256 key,
like the one in a phone's secure chip) signs real registration and sign-in answers, so the
server's checks run exactly as they do for Face ID.
"""
import base64, hashlib, json, os, shutil, sys, tempfile, time, unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server'))
import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

import library_server

ORIGIN = 'https://takeoneai.pages.dev'


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def unb64u(s):
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


class Passkey:
    """A passkey on a phone: makes a key pair when created, signs each sign-in."""

    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.cid = os.urandom(32)
        self.user = None
        self.count = 0

    def create(self, options, origin=ORIGIN):
        self.user = unb64u(options['user']['id'])
        rp = options['rp']['id']
        cdj = json.dumps({'type': 'webauthn.create', 'challenge': options['challenge'], 'origin': origin, 'crossOrigin': False}).encode()
        nums = self.key.public_key().public_numbers()
        cose = cbor2.dumps({1: 2, 3: -7, -1: 1, -2: nums.x.to_bytes(32, 'big'), -3: nums.y.to_bytes(32, 'big')})
        auth = hashlib.sha256(rp.encode()).digest() + bytes([0x45]) + self.count.to_bytes(4, 'big') + bytes(16) + len(self.cid).to_bytes(2, 'big') + self.cid + cose
        att = cbor2.dumps({'fmt': 'none', 'attStmt': {}, 'authData': auth})
        return {'id': b64u(self.cid), 'rawId': b64u(self.cid), 'type': 'public-key', 'authenticatorAttachment': 'platform', 'clientExtensionResults': {},
                'response': {'clientDataJSON': b64u(cdj), 'attestationObject': b64u(att), 'transports': ['internal', 'hybrid']}}

    def get(self, options, origin=ORIGIN, rp=None):
        cdj = json.dumps({'type': 'webauthn.get', 'challenge': options['challenge'], 'origin': origin, 'crossOrigin': False}).encode()
        auth = hashlib.sha256((rp or options['rpId']).encode()).digest() + bytes([0x05]) + self.count.to_bytes(4, 'big')
        sig = self.key.sign(auth + hashlib.sha256(cdj).digest(), ec.ECDSA(hashes.SHA256()))
        return {'id': b64u(self.cid), 'rawId': b64u(self.cid), 'type': 'public-key', 'authenticatorAttachment': 'platform', 'clientExtensionResults': {},
                'response': {'clientDataJSON': b64u(cdj), 'authenticatorData': b64u(auth), 'signature': b64u(sig), 'userHandle': b64u(self.user)}}


class Library(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.commits = 0
        self.app = library_server.create_app(self.dir, commit=self.count_commit)
        self.c = TestClient(self.app, headers={'Origin': ORIGIN})

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def count_commit(self):
        self.commits += 1

    def sign_up(self, name='Deji', key=None):
        key = key or Passkey()
        r = self.c.post('/auth/register/options', json={'name': name}).json()
        self.assertEqual(r['options']['rp']['id'], 'takeoneai.pages.dev')
        self.assertEqual(r['options']['authenticatorSelection']['residentKey'], 'required')
        res = self.c.post('/auth/register/verify', json={'state': r['state'], 'credential': key.create(r['options'])})
        self.assertEqual(res.status_code, 200, res.text)
        return key, res.json()

    def sign_in(self, key, origin=ORIGIN):
        r = self.c.post('/auth/login/options', json={}, headers={'Origin': origin}).json()
        return self.c.post('/auth/login/verify', json={'state': r['state'], 'credential': key.get(r['options'], origin)}, headers={'Origin': origin})

    def auth(self, session):
        return {'Authorization': f'Bearer {session}'}

    def test_health(self):
        self.assertEqual(self.c.get('/health').json(), {'ok': True, 'service': 'takeone-library'})

    def test_sign_up_then_sign_in_on_another_device(self):
        key, me = self.sign_up('  Deji   A ')
        self.assertEqual(me['user']['name'], 'Deji A')
        self.assertEqual(self.c.get('/me', headers=self.auth(me['session'])).json()['user']['name'], 'Deji A')
        key.count = 0  # an iPhone passkey always says 0
        r = self.sign_in(key)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['user']['id'], me['user']['id'])
        # a preview link of the app is the same site, so the same passkey works there
        r = self.sign_in(key, 'https://claude-bold-brahmagupta-0ydy.takeoneai.pages.dev')
        self.assertEqual(r.status_code, 200, r.text)

    def test_a_name_is_optional(self):
        _, me = self.sign_up('')
        self.assertEqual(me['user']['name'], 'TakeOne')

    def test_the_name_typed_after_the_passkey_was_prepared_counts(self):
        key = Passkey()
        r = self.c.post('/auth/register/options', json={}).json()  # fetched before the tap
        res = self.c.post('/auth/register/verify', json={'state': r['state'], 'credential': key.create(r['options']), 'name': ' Deji '}).json()
        self.assertEqual(res['user']['name'], 'Deji')
        self.assertEqual(self.c.get('/me', headers=self.auth(res['session'])).json()['user']['name'], 'Deji')

    def test_an_answer_works_once(self):
        key = Passkey()
        r = self.c.post('/auth/register/options', json={}).json()
        cred = key.create(r['options'])
        self.assertEqual(self.c.post('/auth/register/verify', json={'state': r['state'], 'credential': cred}).status_code, 200)
        self.assertEqual(self.c.post('/auth/register/verify', json={'state': r['state'], 'credential': cred}).status_code, 401)

    def test_other_sites_cant_use_it(self):
        r = self.c.post('/auth/register/options', json={}, headers={'Origin': 'https://evil.example'})
        self.assertEqual(r.status_code, 403)
        self.assertNotIn('access-control-allow-origin', r.headers)
        self.assertEqual(self.c.options('/films', headers={'Origin': ORIGIN, 'Access-Control-Request-Method': 'PUT'}).headers['access-control-allow-origin'], ORIGIN)

    def test_a_forged_signature_is_refused(self):
        key, _ = self.sign_up()
        other = Passkey()
        other.cid, other.user = key.cid, key.user  # same passkey id, someone else's key
        self.assertEqual(self.sign_in(other).status_code, 401)

    def test_an_answer_for_another_site_is_refused(self):
        key, _ = self.sign_up()
        r = self.c.post('/auth/login/options', json={}).json()
        cred = key.get(r['options'], rp='evil.example')
        self.assertEqual(self.c.post('/auth/login/verify', json={'state': r['state'], 'credential': cred}).status_code, 401)

    def test_a_tampered_session_is_refused(self):
        _, me = self.sign_up()
        bad = me['session'][:-3] + ('AAA' if not me['session'].endswith('AAA') else 'BBB')
        self.assertEqual(self.c.get('/films', headers=self.auth(bad)).status_code, 401)
        self.assertEqual(self.c.get('/films').status_code, 401)

    def test_back_up_a_film_redo_a_shot_and_delete_it(self):
        _, me = self.sign_up()
        h = self.auth(me['session'])
        clip, still = os.urandom(300_000), os.urandom(50_000)
        self.assertEqual(self.c.put('/films/film-0001/files/clip-0-abcde.mp4', content=clip, headers=h).json(), {'ok': True, 'size': len(clip)})
        self.c.put('/films/film-0001/files/still-0-fghij.png', content=still, headers=h)
        rec = {'id': 'film-0001', 'title': 'Born Again', 'updated': 2, 'files': {'clip-0-abcde.mp4': {}, 'still-0-fghij.png': {}}, 'cloud': {'at': 1}}
        self.assertEqual(self.c.put('/films/film-0001', json=rec, headers=h).json(), {'ok': True})
        listed = self.c.get('/films', headers=h).json()
        self.assertEqual([f['title'] for f in listed['films']], ['Born Again'])
        self.assertNotIn('cloud', listed['films'][0])  # this device's own bookkeeping stays on the device
        got = self.c.get('/films/film-0001/files/clip-0-abcde.mp4', headers=h)
        self.assertEqual((got.content, got.headers['content-type']), (clip, 'video/mp4'))
        # a redone shot: a new clip, and the record without the old one
        self.c.put('/films/film-0001/files/clip-0-zzzzz.mp4', content=b'new', headers=h)
        self.c.put('/films/film-0001', json={**rec, 'updated': 3, 'files': {'clip-0-zzzzz.mp4': {}, 'still-0-fghij.png': {}}}, headers=h)
        self.assertEqual(self.c.get('/films/film-0001/files/clip-0-abcde.mp4', headers=h).status_code, 404)
        self.assertEqual(self.c.get('/films/film-0001/files/clip-0-zzzzz.mp4', headers=h).content, b'new')
        for _ in range(40):  # changes reach the volume a moment later, all in one commit
            if self.commits:
                break
            time.sleep(0.1)
        self.assertGreater(self.commits, 0)
        # deleted: gone for good, and other devices hear about it
        self.assertEqual(self.c.delete('/films/film-0001', headers=h).json(), {'ok': True})
        listed = self.c.get('/films', headers=h).json()
        self.assertEqual((listed['films'], listed['deleted']), ([], ['film-0001']))
        self.assertEqual(self.c.put('/films/film-0001', json=rec, headers=h).status_code, 410)
        self.assertEqual(self.c.put('/films/film-0001/files/x.mp4', content=b'1', headers=h).status_code, 410)

    def test_nobody_sees_anyone_elses_films(self):
        _, a = self.sign_up('A')
        _, b = self.sign_up('B')
        self.c.put('/films/film-0001/files/clip-0-abcde.mp4', content=b'mine', headers=self.auth(a['session']))
        self.c.put('/films/film-0001', json={'id': 'film-0001', 'files': {'clip-0-abcde.mp4': {}}}, headers=self.auth(a['session']))
        self.assertEqual(self.c.get('/films', headers=self.auth(b['session'])).json()['films'], [])
        self.assertEqual(self.c.get('/films/film-0001/files/clip-0-abcde.mp4', headers=self.auth(b['session'])).status_code, 404)

    def test_no_account_farms(self):
        old = library_server.SIGNUPS_PER_HOUR
        library_server.SIGNUPS_PER_HOUR = 2
        try:
            key, _ = self.sign_up('A')
            self.sign_up('B')
            r = self.c.post('/auth/register/options', json={}).json()
            res = self.c.post('/auth/register/verify', json={'state': r['state'], 'credential': Passkey().create(r['options'])})
            self.assertEqual(res.status_code, 429)
            self.assertEqual(self.sign_in(key).status_code, 200)  # signing in is never limited
        finally:
            library_server.SIGNUPS_PER_HOUR = old

    def test_everyones_films_together_have_a_cap(self):
        _, me = self.sign_up()
        old = library_server.TOTAL
        library_server.TOTAL = 10_000
        try:
            h = self.auth(me['session'])
            self.assertEqual(self.c.put('/films/film-0001/files/a.mp4', content=os.urandom(6000), headers=h).status_code, 200)
            self.assertEqual(self.c.put('/films/film-0001/files/b.mp4', content=os.urandom(6000), headers=h).status_code, 413)
        finally:
            library_server.TOTAL = old

    # ---- nothing to set up: an account by itself, codes for other devices, Face ID later ----
    def start(self):
        r = self.c.post('/auth/start', json={})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_an_account_starts_by_itself_and_backs_up(self):
        me = self.start()
        self.assertEqual(me['user']['passkeys'], 0)
        h = self.auth(me['session'])
        self.c.put('/films/film-0001/files/clip-0-abcde.mp4', content=b'clip', headers=h)
        self.assertEqual(self.c.put('/films/film-0001', json={'id': 'film-0001', 'title': 'T', 'files': {'clip-0-abcde.mp4': {}}}, headers=h).status_code, 200)
        self.assertEqual(self.c.get('/me', headers=h).json()['films'], 1)

    def test_another_device_joins_with_a_code_once(self):
        a = self.start()
        code = self.c.post('/auth/link/new', json={}, headers=self.auth(a['session'])).json()
        self.assertRegex(code['code'], r'^\d{6}$')
        self.assertEqual(code['expires_in'], 600)
        b = self.c.post('/auth/link/use', json={'code': f"{code['code'][:3]} {code['code'][3:]}"})  # typed with a space
        self.assertEqual(b.status_code, 200, b.text)
        self.assertEqual(b.json()['user']['id'], a['user']['id'])
        self.assertEqual(self.c.get('/films', headers=self.auth(b.json()['session'])).status_code, 200)
        self.assertEqual(self.c.post('/auth/link/use', json={'code': code['code']}).status_code, 404)  # works once

    def test_codes_run_out_and_wrong_ones_dont_work(self):
        a = self.start()
        code = self.c.post('/auth/link/new', json={}, headers=self.auth(a['session'])).json()['code']
        path = os.path.join(self.dir, 'codes', f'{code}.json')
        with open(path) as f:
            c = json.load(f)
        c['exp'] = int(time.time()) - 1
        with open(path, 'w') as f:
            json.dump(c, f)
        self.assertEqual(self.c.post('/auth/link/use', json={'code': code}).status_code, 404)
        self.assertEqual(self.c.post('/auth/link/use', json={'code': '12345'}).status_code, 400)
        self.assertEqual(self.c.post('/auth/link/new', json={}).status_code, 401)  # only a device that's in makes codes

    def test_guessing_codes_is_stopped(self):
        a = self.start()
        real = self.c.post('/auth/link/new', json={}, headers=self.auth(a['session'])).json()['code']
        wrong = [f'{(int(real) + k) % 10**6:06d}' for k in range(1, 12)]
        codes = [self.c.post('/auth/link/use', json={'code': w}).status_code for w in wrong]
        self.assertEqual(codes[:10], [404] * 10)
        self.assertEqual(codes[10], 429)
        self.assertEqual(self.c.post('/auth/link/use', json={'code': real}).status_code, 429)  # even the right one, for a while

    def test_face_id_added_later_signs_in_anywhere(self):
        a = self.start()
        key = Passkey()
        r = self.c.post('/auth/register/options', json={}, headers=self.auth(a['session'])).json()
        self.assertEqual(unb64u(r['options']['user']['id']), unb64u(a['user']['id']))  # the passkey is this account's
        res = self.c.post('/auth/register/verify', json={'state': r['state'], 'credential': key.create(r['options']), 'name': 'Deji'},
                          headers=self.auth(a['session']))
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((res.json()['user']['id'], res.json()['user']['name'], res.json()['user']['passkeys']), (a['user']['id'], 'Deji', 1))
        r = self.sign_in(key)  # a new phone, every other device lost
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['user']['id'], a['user']['id'])
        # the next passkey request leaves out the one it has
        again = self.c.post('/auth/register/options', json={}, headers=self.auth(a['session'])).json()
        self.assertEqual([c['id'] for c in again['options']['excludeCredentials']], [b64u(key.cid)])

    def test_face_id_for_one_account_cant_be_added_to_another(self):
        a, b = self.start(), self.start()
        r = self.c.post('/auth/register/options', json={}, headers=self.auth(a['session'])).json()
        res = self.c.post('/auth/register/verify', json={'state': r['state'], 'credential': Passkey().create(r['options'])}, headers=self.auth(b['session']))
        self.assertEqual(res.status_code, 403)

    def test_bad_names_and_big_files_are_refused(self):
        _, me = self.sign_up()
        h = self.auth(me['session'])
        self.assertEqual(self.c.put('/films/film-0001/files/..secret', content=b'1', headers=h).status_code, 400)
        self.assertEqual(self.c.put('/films/x/files/a.mp4', content=b'1', headers=h).status_code, 400)
        self.assertEqual(self.c.put('/films/film-0001', json={'id': 'film-0002', 'files': {}}, headers=h).status_code, 400)
        old = library_server.MAX_FILE
        library_server.MAX_FILE = 1000
        try:
            self.assertEqual(self.c.put('/films/film-0001/files/a.mp4', content=os.urandom(5000), headers=h).status_code, 413)
        finally:
            library_server.MAX_FILE = old
        self.assertFalse(any('tmp' in n for _, _, ns in os.walk(self.dir) for n in ns))  # nothing half-written left behind


if __name__ == '__main__':
    unittest.main()
