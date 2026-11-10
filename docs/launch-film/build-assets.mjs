// Inlines the logo SVGs into assets/logos.js so index.html plays straight from disk.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "assets/logos");
const out = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith(".svg"))) {
  out[file.replace(".svg", "")] = readFileSync(join(dir, file), "utf8")
    .replace(/\s(width|height)="[^"]*"/, "")
    .replace(/\s(width|height)="[^"]*"/, "")
    .replaceAll("#18181b", "currentColor")
    .trim();
}
writeFileSync(join(here, "assets/logos.js"), `window.LOGOS = ${JSON.stringify(out)};\n`);
console.log("logos:", Object.keys(out).join(", "));
