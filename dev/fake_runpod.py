#!/usr/bin/env python3
"""A local stand-in for RunPod's Serverless API, for testing the app without a GPU or credit.

Runs server/serverless/handler.py in mock mode behind the same routes RunPod uses
(/v2/<endpoint>/run, /status/<job>, /health, /cancel/<job>), with CORS and a
fake API key. In the app, use http://localhost:7865/v2/test as the endpoint and
"test-key" as the API key.

  STORYREEL_MOCK_IMAGES=<folder of pictures> python dev/fake_runpod.py   (needs `pip install runpod`)
"""
import importlib.util, json, os, re, sys, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ['STORYREEL_MOCK'] = '1'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('handler', os.path.join(ROOT, 'server', 'serverless', 'handler.py'))
H = importlib.util.module_from_spec(spec)
spec.loader.exec_module(H)
H.warm_up()
KEY = os.environ.get('FAKE_RUNPOD_KEY', 'test-key')
jobs = {}
lock = threading.Lock()  # one worker: jobs run one at a time, like a single RunPod worker


def work(jid):
    with lock:
        job = jobs[jid]
        if job['status'] == 'CANCELLED':
            return
        job['status'] = 'IN_PROGRESS'
        t = time.time()
        out = H.handler({'id': jid, 'input': job['input']})
        job['executionTime'] = int((time.time() - t) * 1000)
        if isinstance(out, dict) and 'error' in out:
            job.update(status='FAILED', error=out['error'])
        else:
            job.update(status='COMPLETED', output=out)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST,GET,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Authorization,Content-Type')
        self.end_headers()

    def _authorized(self):
        if self.headers.get('Authorization') != f'Bearer {KEY}':
            self._send(401, {'error': 'Unauthorized'})
            return False
        return True

    def do_GET(self):
        if not self._authorized():
            return
        if re.match(r'^/v2/[^/]+/health$', self.path):
            busy = sum(j['status'] in ('IN_QUEUE', 'IN_PROGRESS') for j in jobs.values())
            return self._send(200, {'jobs': {'inQueue': busy, 'completed': sum(j['status'] == 'COMPLETED' for j in jobs.values())},
                                    'workers': {'idle': 1, 'running': 0, 'initializing': 0}})
        m = re.match(r'^/v2/[^/]+/status/([^/]+)$', self.path)
        if m and m.group(1) in jobs:
            j = jobs[m.group(1)]
            return self._send(200, {k: j[k] for k in ('id', 'status', 'output', 'error', 'executionTime') if k in j})
        self._send(404, {'error': 'not found'})

    def do_POST(self):
        if not self._authorized():
            return
        if re.match(r'^/v2/[^/]+/run$', self.path):
            req = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
            jid = uuid.uuid4().hex
            jobs[jid] = {'id': jid, 'status': 'IN_QUEUE', 'input': req.get('input') or {}}
            threading.Thread(target=work, args=(jid,), daemon=True).start()
            return self._send(200, {'id': jid, 'status': 'IN_QUEUE'})
        m = re.match(r'^/v2/[^/]+/cancel/([^/]+)$', self.path)
        if m and m.group(1) in jobs:
            jobs[m.group(1)]['status'] = 'CANCELLED'
            return self._send(200, {'id': m.group(1), 'status': 'CANCELLED'})
        self._send(404, {'error': 'not found'})

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 7865
    print(f'fake RunPod API on http://localhost:{port}/v2/test (key: {KEY})', flush=True)
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
