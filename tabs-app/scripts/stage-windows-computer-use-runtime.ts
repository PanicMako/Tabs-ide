import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(repo, "apps/server/src/computerUse/windowsRuntime.ps1");
const manifest = path.join(repo, "apps/server/src/computerUse/windowsRuntime.ts");
const output = path.resolve(process.argv[2] ?? path.join(repo, "release"));
const bytes = await fs.readFile(source);
const digest = createHash("sha256").update(bytes).digest("hex");
const manifestSource = await fs.readFile(manifest, "utf8");
const expectedHash = manifestSource.match(
  /export const WINDOWS_RUNTIME_SHA256 =\s*"([a-f0-9]{64})";/,
)?.[1];
if (!expectedHash || digest !== expectedHash) {
  throw new Error("Windows computer-use runtime source does not match its pinned SHA-256.");
}
await fs.mkdir(output, { recursive: true });
await fs.copyFile(source, path.join(output, "tabs-computer-use-windows.ps1"));
console.log(`Staged verified Windows computer-use runtime (${bytes.byteLength} bytes).`);
