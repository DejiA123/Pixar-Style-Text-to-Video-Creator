# TakeOne — type a story, get an AI film

**Live: [takeoneai.pages.dev](https://takeoneai.pages.dev)**

Everything runs in the browser, built in code: no paid AI services needed.

- **Story → film:** the parser finds characters, settings, actions, emotions and dialogue, and a director turns them into shots.
- **Characters:** sculpted SDF heads with eyelids and a real nose, groomed strand hair, and skinned sculpted clothing (shirts, jackets, hoodies, dresses, jeans). Hands and shoes are sculpted too.
- **Look:** real CC0 photo-scanned materials from Poly Haven (denim, knit, cotton, fleece, wood, plaster, marble, asphalt, grass), HDRI lighting, ambient occlusion, depth of field, bloom and film grading.
- **Sound:** neural voices (Kokoro, runs locally in the browser), with browser voices as a fallback. Plus a procedural music score, sound effects and subtitles.
- **AI painted style (free):** an image model (SD-Turbo) runs on your own device through WebGPU and repaints each shot of the 3D film in a rich animated-movie look. There's no server and no cost. It's a one-time ~2.6 GB download, needs a recent Chrome/Edge/Safari with WebGPU, and falls back to 3D automatically otherwise.
- **Never stops:** free online AI first, then your own AI server if you have one (unlimited AI video on [your own GPU](server/README.md) or a rented RunPod GPU: [Serverless](server/SERVERLESS.md), which starts a GPU only while you make films, or [a pod](server/RUNPOD.md), at a few cents a film), then on-device painting, then 3D. Every film finishes.
- **Export:** download as MP4 (or WebM where MP4 isn't available).

## Try it

### On your phone / any browser
Open **[takeoneai.pages.dev](https://takeoneai.pages.dev)**. It's hosted free on Cloudflare Pages, which
deploys this branch automatically on every push (no build step, output directory `/`). The old
GitHub Pages address forwards there.

Desktop Chrome or Edge gives the fastest renders and MP4 export. Phones work, but rendering is slower.

### Locally
```bash
npx http-server -p 8080 -c-1 .
# open http://localhost:8080
```
Use `localhost` (a secure context): video export needs WebCodecs.

## Using it
1. Type or paste a story, or pick a sample. For example: *Leo was a shy boy with glasses and a backpack. Mia waved at him. "Hi! I'm Mia," she said.*
2. Press **Make movie**. Characters, sets, voices and music are generated.
3. Press play to watch. Use the storyboard to jump between shots.
4. Press **Export video** and the file downloads.
5. **Settings** (optional): voice engine, narrator, aspect ratio (16:9 / 9:16 / 1:1), quality, music, effects and subtitles.

### My films, redoing a shot, and your account
- **My films** (top right) keeps every AI film you make on your device: pictures, clips, voices
  and all. Open one to watch it again, download it or redo a shot, with no waiting for the AI
  studio. A film you delete there is deleted from all your devices.
- **↻ Redo** on any shot of the board makes that shot again on the AI studio, and the film is kept
  with it. **New take** moves the same picture again (for an arm or a hand that went wrong while
  it moved); **Repaint** paints a new picture that follows your note ("she wears a red dress").
- **Backed up by themselves:** films go to your account as soon as they're made, with nothing to
  set up (no password, no email). To watch them on another phone or computer, tap **Use on another
  device** in My films and type the 6-digit code there. **Add Face ID** (optional, a passkey) gets
  you back in on any device, even if you lose your phone. **Sign out** turns backup off on that
  device. The account service is `server/library_server.py`, a small CPU container beside the AI
  studio on Modal (`server/modal_app.py`, "library"), with its own volume.

Story tips: name your characters and describe them with words like *glasses*, *backpack*, *curly hair*, *beard*, *dress*, *hoodie*, or roles like *pastor*, *chef*, *doctor*. Mention places (*church, city, beach, forest, school, kitchen…*), times (*night, sunset*) and feelings (*happy, sad, surprised*). Put dialogue in quotes.

## Tests
```bash
npm test                                         # story parser, versions, account address tests
python3 tests/test_anatomy.py                    # the extra hand / arm rules
python3 tests/test_library_server.py             # accounts (real passkey signatures) and film backup
node dev/e2e.mjs out neural dev/demo-story.txt   # full app: make + export (needs Playwright)
node dev/library-e2e.mjs out                     # My films, Redo, account + a second device (mock AI server)
node dev/clip-export.mjs <clips> out compare     # downloads: every frame against the earlier export
```
Visual labs: `dev/lab.html` (characters) and `dev/film.html` (film frames).

## Versions and updates

The version is shown at the bottom of Settings (tap it to check for a newer one). Open copies of
the app look for a newer version shortly after opening, every few minutes and whenever you come
back to them, and offer **Update now** (never while a film is being made or downloaded).

To publish a new version, run this before committing a change to the app:

```
node scripts/bump-version.mjs "What's new in a few words"     # 1.2.3 → 1.2.4 (--minor for 1.3.0)
```

It sets the version and build number in `index.html`, `version.json` and `package.json`.

## Credits
HDRIs and textures: [Poly Haven](https://polyhaven.com) (CC0). three.js (MIT), Mediabunny (MPL-2.0), Kokoro TTS (Apache-2.0).
