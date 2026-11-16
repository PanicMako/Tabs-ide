# Tabs — public beta film

A 42-second launch film, generated entirely from the code in this folder. It is separate from the app and from the earlier film in `docs/launch-film`.

**The idea.** A row of project tabs sits on a single line. The camera pulls back with a dolly-zoom and the flat tab strip turns out to be a drawer of folders, one per project. The front folder soaks dark and becomes the Tabs window. Inside it one small task runs through every tool (write, hand off, run, see, ship), Quick Actions opens on ⌘⌥K, then the camera flies through to two other projects. It ends where it began: the tab piece of the Tabs mark falls once more and finds its body.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `film.css`, `film.js` | The film. Every frame is a pure function of time, `render(t)`. Timings, camera keys and copy live at the top of `film.js`. |
| `ui.js`, `ui.css` | The Tabs interface rebuilt as DOM (project tabs, tool pills, Code, Agents, Dock, Browser, Git, Quick Actions) so it can be lit and moved. |
| `render.mjs` | Renders frames with headless Chromium and encodes with ffmpeg. Blends several sub-frames per frame for real motion blur. |
| `score.py` | Synthesises the score and sound design to `out/score.wav` (numpy + scipy). Cut on the same 100 BPM grid as the picture. |
| `assets/` | Fonts (Overused Grotesk, Instrument Serif, Hebdomadal, all OFL) and agent logos. |
| `out/` | Renders. `tabs-beta-film.mp4` is the full-quality master (about 360 MB, git-ignored), `tabs-beta-film-share.mp4` is the 17 MB encode for posting, `poster.jpg` is a still. |

## Preview

Open `index.html` in a browser. It plays in real time, and the bar at the bottom scrubs. `index.html?t=12` starts at 12 s.

## Render

Needs Node, ffmpeg, Python 3 with numpy and scipy, and the Playwright copy in `tabs-code-oss/node_modules`.

```sh
node render.mjs --fps 24 --samples 12 --shutter 0.5
```

```sh
python3 score.py
```

```sh
ffmpeg -y -i out/tabs-beta-film-silent.mp4 -i out/score.wav -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -af loudnorm=I=-15:TP=-1.5:LRA=11 -c:a aac -b:a 256k -shortest out/tabs-beta-film.mp4
```

```sh
ffmpeg -y -i out/tabs-beta-film.mp4 -c:v libx264 -preset slow -crf 23 -maxrate 14M -bufsize 28M -c:a aac -b:a 192k out/tabs-beta-film-share.mp4
```

Useful while editing:

```sh
node render.mjs --stills 6.9,16.5,26
```

```sh
node render.mjs --sheet 12,24,0.8 --cols 3
```

```sh
node render.mjs --fps 24 --samples 1 --from 8 --to 12 --name draft.mp4
```

## Structure (seconds)

| Time | Beat |
| --- | --- |
| 0 – 4.8 | A tab falls onto a line. Four more pop up. “You’re never building just one thing.” |
| 4.8 – 8.5 | Dolly-zoom: the tab strip is a drawer of project folders. |
| 8.5 – 12 | The front folder becomes the Tabs window. |
| 12 – 24 | Write it, hand it off, run it, see it, ship it. One task through five tools. |
| 24 – 27.6 | Quick Actions, ⌘⌥K. |
| 27.6 – 32.4 | Switch projects by flying through them; pull back to the stack. |
| 32.4 – 36 | Bring your own agents. |
| 36 – 42.6 | The mark assembles and blinks. Public beta, buildwithtabs.com. |
