# Tabs launch film

The launch film and the README artwork are generated from the code in this folder.

- `index.html`, `film.css`, `film.js`: the film. Open `index.html` in a browser to play and scrub it. Timings and copy live in `film.js`.
- `render.mjs`: renders every frame with headless Chromium and encodes `out/tabs-launch.mp4` with ffmpeg. It uses the Playwright copy in `tabs-code-oss/node_modules`, so run `npm install` there first.
- `score.py`: synthesises the soundtrack to `out/score.wav` (needs Python 3 and numpy).
- `readme-art.html`, `readme-art.mjs`: the README cover, note box, section banners, step cards and diagrams.
- `round.py`: rounds the corners of the README clips and screenshots (needs Pillow).
- `build-assets.mjs`: inlines the logos in `assets/logos` into `assets/logos.js`.

```sh
node render.mjs
python3 score.py
ffmpeg -i out/tabs-launch.mp4 -i out/score.wav -c:v copy -c:a aac -b:a 192k -shortest out/tabs-launch-with-sound.mp4
```

Fonts are Hebdomadal and Overused Grotesk, both under the SIL Open Font License (see `assets/fonts`).
