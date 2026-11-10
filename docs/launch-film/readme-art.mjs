// Renders the README cover and build diagram from readme-art.html (run `node render.mjs --stills 28.6` first).
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(pathToFileURL(join(here, "../../tabs-code-oss/node_modules/playwright/index.mjs")).href);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 4600 }, deviceScaleFactor: 1.5 });
await page.goto(pathToFileURL(join(here, "readme-art.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
for (const id of ["cover", "folders", "tools", "note", "h-get", "h-build", "h-agents", "h-fine", "steps", "agents"]) await page.locator(`#${id}`).screenshot({ path: join(here, "out", `${id}.png`), omitBackground: true });
await browser.close();
