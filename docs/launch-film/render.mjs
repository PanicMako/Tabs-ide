// Renders the film frame by frame with headless Chromium and encodes it with ffmpeg.
//   node render.mjs                 → out/tabs-launch.mp4 (1920×1080, 60 fps)
//   node render.mjs --stills 1,5,9  → out/still-<t>.jpg for review
//   node render.mjs --fps 30
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(pathToFileURL(join(here, "../../tabs-code-oss/node_modules/playwright/index.mjs")).href);
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const fps = Number(arg("fps", 60));
const stills = arg("stills");
const out = join(here, "out");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => { console.error("page error:", e.message); process.exitCode = 1; });
await page.goto(pathToFileURL(join(here, "index.html")).href + "?render");
await page.waitForFunction("window.READY === true", null, { timeout: 15000 });
const duration = await page.evaluate("window.DURATION");
const shot = async (t) => { await page.evaluate((x) => window.seek(x), t); return page.screenshot({ type: "jpeg", quality: 96 }); };

if (stills) {
  const { writeFileSync } = await import("node:fs");
  for (const t of stills.split(",").map(Number)) writeFileSync(join(out, `still-${t.toFixed(2).padStart(5, "0")}.jpg`), await shot(t));
} else {
  const file = join(out, arg("name", "tabs-launch.mp4"));
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  const total = Math.round(duration * fps);
  for (let f = 0; f < total; f++) {
    if (!ff.stdin.write(await shot(f / fps))) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % 300 === 0) console.log(`frame ${f}/${total}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log("wrote", file);
}
await browser.close();
