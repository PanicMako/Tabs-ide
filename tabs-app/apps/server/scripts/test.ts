#!/usr/bin/env bun
/**
 * test.ts — test runner shim for apps/server
 *
 * The server test suite requires Node ≥22.5 for the `node:sqlite` built-in.
 * When the PATH `node` binary is older (e.g. v20 via nvm), this script finds
 * a compatible binary from nvm, prepends its bin/ to PATH, and re-executes
 * vitest so that all forked worker processes inherit the upgraded PATH and
 * therefore use the correct node binary.
 *
 * On CI, Node ≥22 is already active, so no PATH change is made.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, execSync } from "node:child_process";

// Resolve vitest binary: monorepo root is 3 levels up from
// apps/server/scripts/test.ts (scripts → apps/server → apps → root).
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const vitestBin = path.join(repoRoot, "node_modules", ".bin", "vitest");

/** Return the major version of the `node` binary currently on PATH. */
function nodePathMajor(): number {
  try {
    const raw = execSync("node --version", { encoding: "utf8" }).trim(); // e.g. "v20.20.2"
    return parseInt(raw.replace(/^v/, "").split(".")[0]!, 10);
  } catch {
    return 0;
  }
}

/** Find the bin/ directory of a nvm-installed Node ≥22, newest first. */
function findNvm22PlusBinDir(): string | null {
  const nvmDir = process.env.NVM_DIR ?? path.join(os.homedir(), ".nvm");
  const candidates = ["v24.18.0", "v24.16.0", "v22.22.1", "v22.17.0", "v22.16.0"];
  for (const version of candidates) {
    const binDir = path.join(nvmDir, "versions", "node", version, "bin");
    if (fs.existsSync(path.join(binDir, "node"))) return binDir;
  }
  return null;
}

// Extra CLI args forwarded verbatim to vitest (e.g. a test file filter).
const extraArgs = process.argv.slice(2);

const currentMajor = nodePathMajor();

if (currentMajor >= 22) {
  // node in PATH is already ≥22 — run vitest normally.
  execFileSync(vitestBin, ["run", ...extraArgs], { stdio: "inherit" });
} else {
  // node in PATH is too old. Try to find a compatible one via nvm.
  const binDir = findNvm22PlusBinDir();

  if (binDir === null) {
    console.warn(
      `[test.ts] WARNING: active node is v${currentMajor} (<22) and no nvm Node ≥22 was found.\n` +
        "  Some SQLite-backed tests may fail.  Install Node 22+ via: nvm install 22",
    );
    // Fall through and run anyway — the user will see the real error.
    execFileSync(vitestBin, ["run", ...extraArgs], { stdio: "inherit" });
  } else {
    // Prepend the nvm node bin dir to PATH so vitest's forked workers pick up
    // the ≥22 binary automatically.
    const newPath = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;
    console.log(
      `[test.ts] PATH node is v${currentMajor}; prepending ${binDir} (Node 22+) for vitest workers`,
    );
    execFileSync(vitestBin, ["run", ...extraArgs], {
      stdio: "inherit",
      env: { ...process.env, PATH: newPath },
    });
  }
}
