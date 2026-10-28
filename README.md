# Storyreel — type a story, get a 3D animated film

Everything runs in the browser, built in code: no paid AI services needed.

- **Story → film:** the parser finds characters, settings, actions, emotions and dialogue, and a director turns them into shots.
- **Characters:** sculpted SDF heads with eyelids and a real nose, groomed strand hair, and skinned sculpted clothing (shirts, jackets, hoodies, dresses, jeans). Hands and shoes are sculpted too.
- **Look:** real CC0 photo-scanned materials from Poly Haven (denim, knit, cotton, fleece, wood, plaster, marble, asphalt, grass), HDRI lighting, ambient occlusion, depth of field, bloom and film grading.
- **Sound:** neural voices (Kokoro, runs locally in the browser), with browser voices as a fallback. Plus a procedural music score, sound effects and subtitles.
- **AI painted style (free):** an image model (SD-Turbo) runs on your own device through WebGPU and repaints each shot of the 3D film in a rich animated-movie look. There's no server and no cost. It's a one-time ~2.6 GB download, needs a recent Chrome/Edge/Safari with WebGPU, and falls back to 3D automatically otherwise.
- **Never stops:** free online AI first, then your own AI server if you have one (unlimited AI video on [your own GPU](server/README.md) or a rented RunPod GPU: [Serverless](server/SERVERLESS.md), which starts a GPU only while you make films, or [a pod](server/RUNPOD.md), at a few cents a film), then on-device painting, then 3D. Every film finishes.
- **Export:** download as MP4 (or WebM where MP4 isn't available).

## Try it

### On your phone / any browser (GitHub Pages)
1. In the GitHub repo: **Settings → Pages → Source: GitHub Actions**.
2. Push. The included workflow deploys the site.
3. Open `https://<your-user>.github.io/Pixar-Style-Text-to-Video-Creator/`.

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

Story tips: name your characters and describe them with words like *glasses*, *backpack*, *curly hair*, *beard*, *dress*, *hoodie*, or roles like *pastor*, *chef*, *doctor*. Mention places (*church, city, beach, forest, school, kitchen…*), times (*night, sunset*) and feelings (*happy, sad, surprised*). Put dialogue in quotes.

## Tests
```bash
npm test                                         # story parser tests
node dev/e2e.mjs out neural dev/demo-story.txt   # full app: make + export (needs Playwright)
```
Visual labs: `dev/lab.html` (characters) and `dev/film.html` (film frames).

## Credits
HDRIs and textures: [Poly Haven](https://polyhaven.com) (CC0). three.js (MIT), Mediabunny (MPL-2.0), Kokoro TTS (Apache-2.0).
