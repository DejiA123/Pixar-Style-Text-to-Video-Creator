"""Starts the Storyreel server inside a Modal container (server/modal_app.py): lip sync in the
background (its checkpoints on the volume), then the HTTP server, which loads the models
while it already answers /health."""
import os, sys, threading

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault('STORYREEL_DATA', '/data')
os.environ.setdefault('HF_HOME', '/data/hf')
os.environ['STORYREEL_LIPSYNC_ON'] = '1'  # so the app shows "lip sync setting up…"
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'serverless'))
import handler  # noqa: E402  (shares storyreel_server; its start_lipsync knows the image's LatentSync)
import storyreel_server as S  # noqa: E402

threading.Thread(target=handler.start_lipsync, daemon=True).start()
sys.argv = ['storyreel_server.py', '--port', '7860']
S.main()
