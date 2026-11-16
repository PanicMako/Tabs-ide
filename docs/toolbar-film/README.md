# Tabs — “Play it” (the toolbar film)

A second, separate film for the public beta. 51.5 seconds, 1080p, 24 fps, generated from the code in this folder. The first film (`docs/beta-film`) is about projects; this one is about the toolbar.

**The idea.** The toolbar is an instrument. Every tool owns one note of a D-major pentatonic scale, so pressing keys plays the tune.

| Time | Beat |
| --- | --- |
| 0 – 8 s | Prologue. Seven separate app windows pile up: “Too many windows.” The Tabs mascot hops in, gathers them into itself and leaves: “Tabs puts them in one.” |
| 8 – 12 s | In the dark, a macro camera tracks along six keys as they light: Code, Agents, Dock, Git, Browser, Testing. |
| 12 – 16 s | “Six tools, built in.” then “Now add your own.” |
| 16 – 21.5 s | “Any URL.” A browser tab is a name and a URL: Figma, then Vercel, snap onto the toolbar. |
| 21.5 – 26.5 s | “Any CLI.” A terminal tab is a name and a command: `claude`, then `codex`. |
| 26.5 – 28 s | All ten keys played in one run. “Ten tools. One toolbar.” |
| 28 – 39 s | The window arrives and the keys are played on the beat: editor, Claude Code, Figma, Dock, preview, Vercel, Agents, Git. |
| 39 – 44 s | The camera climbs to the project tabs: “Tabs up top. One per project.” Each tab is pressed and the toolbar underneath flips to that project’s tools. |
| 44 – 46 s | Back out; a Quick Actions cameo on ⌘⌥K. |
| 46 – 51.5 s | The camera dives into the lit key until its colour fills the frame, and the mark wakes up there. |

In `film.js` the prologue runs on film time and everything after it on main-film time (`t - S`, with `S = 8`).

## Files

| File | What it is |
| --- | --- |
| `index.html`, `film.css`, `film.js` | The film. `render(t)` draws any moment; schedules, camera shots and copy are at the top of `film.js`. |
| `ui.js`, `ui.css` | The Tabs interface rebuilt as DOM (shared with the first film). |
| `ui2.js` | Tools a project pins to its own toolbar: Claude Code and Codex as terminal tabs, Figma and Vercel as browser tabs. |
| `render.mjs` | Headless Chromium → ffmpeg, with several blended sub-frames per frame for motion blur. |
| `score.py` | Synthesises the score to `out/score.wav` (numpy + scipy), 120 BPM. |
| `assets/` | Fonts and logos. Headlines are Balbes, interface text is Seenonim (the pairing the app itself offers). Seenonim is CC BY; Balbes ships with a single-seat desktop licence readme, so check it covers publishing. An earlier render in Funnel Display is kept as `out/tabs-toolbar-film-funnel.mp4`. |

## Preview and render

Open `index.html` in a browser to play and scrub. To render:

```sh
node render.mjs --fps 24 --samples 12 --shutter 0.5
```

```sh
python3 score.py
```

```sh
ffmpeg -y -i out/tabs-toolbar-film-silent.mp4 -i out/score.wav -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -af loudnorm=I=-15:TP=-1.5:LRA=11 -c:a aac -b:a 256k -shortest out/tabs-toolbar-film.mp4
```

```sh
ffmpeg -y -i out/tabs-toolbar-film.mp4 -c:v libx264 -preset slow -crf 23 -maxrate 14M -bufsize 28M -c:a aac -b:a 192k out/tabs-toolbar-film-share.mp4
```
