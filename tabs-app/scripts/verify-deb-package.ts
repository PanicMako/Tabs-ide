// Usage: node --experimental-strip-types verify-deb-package.ts <file.deb> <version> [x64|arm64]
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { missingDebPayloadPaths, parseDebControl, verifyDebControl } from "./lib/linux-deb.ts";

const [debPath, version, arch = "x64"] = process.argv.slice(2);
if (!debPath || !version || (arch !== "x64" && arch !== "arm64")) {
  console.error("usage: verify-deb-package.ts <file.deb> <version> [x64|arm64]");
  process.exit(2);
}

function dpkg(...args: string[]): string {
  const result = spawnSync("dpkg-deb", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`dpkg-deb ${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}

const problems = verifyDebControl(parseDebControl(dpkg("--info", debPath)), { version, arch });
const expectedName = `Tabs-${version}-${arch === "x64" ? "amd64" : "arm64"}.deb`;
if (basename(debPath) !== expectedName)
  problems.push(`File is named ${basename(debPath)}; expected ${expectedName}.`);
for (const missing of missingDebPayloadPaths(dpkg("--contents", debPath))) {
  problems.push(`Payload is missing ${missing}.`);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(1);
}
console.log(`${basename(debPath)} verified (${arch}, ${version}).`);
