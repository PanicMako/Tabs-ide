// Renders the film frame by frame with headless Chromium and encodes it with ffmpeg.
//   node render.mjs                      → out/tabs-beta-film-silent.mp4 (1920×1080, 60 fps, 4× temporal samples for motion blur)
//   node render.mjs --stills 1,5,9       → out/stills/still-<t>.jpg for review
//   node render.mjs --sheet 0,12,0.5     → out/stills/sheet-0-12.jpg (contact sheet from t0 to t1 every step)
//   node render.mjs --samples 1 --fps 30 --name draft.mp4 [--from 10 --to 14]   → fast draft
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(pathToFileURL(join(here, "../../tabs-code-oss/node_modules/playwright/index.mjs")).href);
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const fps = Number(arg("fps", 60));
const samples = Number(arg("samples", 4));      // sub-frames blended per output frame
const shutter = Number(arg("shutter", 0.6));    // fraction of the frame interval the shutter stays open
const stills = arg("stills"), sheet = arg("sheet");
const out = join(here, "out");
mkdirSync(join(out, "stills"), { recursive: true });

const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--font-render-hinting=none"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => { console.error("page error:", e.message); process.exitCode = 1; });
page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });
await page.goto(pathToFileURL(join(here, "index.html")).href + "?render");
await page.waitForFunction("window.READY === true", null, { timeout: 20000 });
const duration = await page.evaluate("window.DURATION");
const shot = async (t, type = "jpeg") => { await page.evaluate((x) => window.seek(x), t); return page.screenshot(type === "png" ? { type } : { type, quality: 97 }); };
const run = (cmd, args, input) => new Promise((res, rej) => { const p = spawn(cmd, args, { stdio: [input ? "pipe" : "ignore", "inherit", "inherit"] }); p.on("close", (c) => (c ? rej(new Error(cmd + " " + c)) : res())); if (input) input(p.stdin); });

if (stills) {
  for (const t of stills.split(",").map(Number)) writeFileSync(join(out, "stills", `still-${t.toFixed(2).padStart(5, "0")}.jpg`), await shot(t));
} else if (sheet) {
  const [t0, t1, step] = sheet.split(",").map(Number);
  const cols = Number(arg("cols", 4));
  const times = []; for (let t = t0; t <= t1 + 1e-6; t += step) times.push(t);
  const file = join(out, "stills", `sheet-${t0}-${t1}.jpg`);
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", "1", "-i", "-",
    "-vf", `scale=${Math.round(1920 / cols * (cols > 4 ? 1.2 : 1))}:-1,tile=${cols}x${Math.ceil(times.length / cols)}:padding=6:color=0x777777`, "-frames:v", "1", "-q:v", "3", file],
    async (stdin) => { for (const t of times) stdin.write(await shot(t)); stdin.end(); });
  console.log("wrote", file);
} else {
  const from = Number(arg("from", 0)), to = Number(arg("to", duration));
  const file = join(out, arg("name", "tabs-beta-film-silent.mp4"));
  const total = Math.round((to - from) * fps);
  const vf = [];
  if (samples > 1) vf.push(`tmix=frames=${samples}`, `select='eq(mod(n\\,${samples})\\,${samples - 1})'`, `setpts=N/(${fps}*TB)`);
  // a whisper of film grain keeps the big flat fields from banding
  vf.push("noise=alls=5:allf=t", "format=yuv420p");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps * samples), "-i", "-",
    "-vf", vf.join(","), "-r", String(fps), "-c:v", "libx264", "-preset", "slow", "-crf", arg("crf", "14"),
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-movflags", "+faststart", file],
    async (stdin) => {
      const t0 = Date.now();
      for (let f = 0; f < total; f++) {
        for (let s = 0; s < samples; s++) {
          const t = from + (f + (samples > 1 ? (s / samples) * shutter : 0)) / fps;
          if (!stdin.write(await shot(t))) await new Promise((r) => stdin.once("drain", r));
        }
        if (f % 120 === 0) console.log(`frame ${f}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
      stdin.end();
    });
  console.log("wrote", file);
}
await browser.close();
