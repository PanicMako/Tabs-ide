// Usage: node --experimental-strip-types verify-appx-package.ts <AppxManifest.xml> <version> [x64]
// The workflow extracts the .appx (a zip) first; identity is read from the same env as the build.
import { readFileSync } from "node:fs";
import { resolveAppxIdentity, verifyAppxManifest } from "./lib/windows-appx.ts";

const [manifestPath, version, arch = "x64"] = process.argv.slice(2);
if (!manifestPath || !version || arch !== "x64") {
  console.error("usage: verify-appx-package.ts <AppxManifest.xml> <version> [x64]");
  process.exit(2);
}
const problems = verifyAppxManifest(readFileSync(manifestPath, "utf8"), {
  ...resolveAppxIdentity(process.env),
  version,
  arch,
});
if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(1);
}
console.log(`AppX manifest verified (${arch}, ${version}).`);
