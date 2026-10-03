import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { releasePackageFiles } from "./update-release-package-versions.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const workspaceFiles = ["package.json", "bun.lock"] as const;

function workspacePackageManifests(): string[] {
  return ["apps", "packages", "scripts"].flatMap((workspaceDirectory) => {
    const directoryPath = resolve(repoRoot, workspaceDirectory);
    return readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(workspaceDirectory, entry.name, "package.json"))
      .filter((relativePath) => existsSync(resolve(repoRoot, relativePath)));
  });
}

function copyWorkspaceManifestFixture(targetRoot: string): void {
  for (const relativePath of [
    ...workspaceFiles,
    "scripts/package.json",
    ...workspacePackageManifests(),
  ]) {
    const sourcePath = resolve(repoRoot, relativePath);
    const destinationPath = resolve(targetRoot, relativePath);
    mkdirSync(dirname(destinationPath), { recursive: true });
    cpSync(sourcePath, destinationPath);
  }
}

function writeMacManifestFixtures(targetRoot: string): { arm64Path: string; x64Path: string } {
  const assetDirectory = resolve(targetRoot, "release-assets");
  mkdirSync(assetDirectory, { recursive: true });

  const arm64Path = resolve(assetDirectory, "latest-mac.yml");
  const x64Path = resolve(assetDirectory, "latest-mac-x64.yml");

  writeFileSync(
    arm64Path,
    `version: 9.9.9-smoke.0
files:
  - url: Tabs-9.9.9-smoke.0-arm64.zip
    sha512: arm64zip
    size: 125621344
  - url: Tabs-9.9.9-smoke.0-arm64.dmg
    sha512: arm64dmg
    size: 131754935
path: Tabs-9.9.9-smoke.0-arm64.zip
sha512: arm64zip
releaseDate: '2026-03-08T10:32:14.587Z'
`,
  );

  writeFileSync(
    x64Path,
    `version: 9.9.9-smoke.0
files:
  - url: Tabs-9.9.9-smoke.0-x64.zip
    sha512: x64zip
    size: 132000112
  - url: Tabs-9.9.9-smoke.0-x64.dmg
    sha512: x64dmg
    size: 138148807
path: Tabs-9.9.9-smoke.0-x64.zip
sha512: x64zip
releaseDate: '2026-03-08T10:36:07.540Z'
`,
  );

  return { arm64Path, x64Path };
}

function assertContains(haystack: string, needle: string, message: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(message);
  }
}

const tempRoot = mkdtempSync(join(tmpdir(), "tabs-release-smoke-"));

try {
  copyWorkspaceManifestFixture(tempRoot);

  execFileSync(
    process.execPath,
    [
      resolve(repoRoot, "scripts/update-release-package-versions.ts"),
      "9.9.9-smoke.0",
      "--root",
      tempRoot,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );

  execFileSync("bun", ["install", "--lockfile-only", "--ignore-scripts"], {
    cwd: tempRoot,
    stdio: "inherit",
  });

  for (const relativePath of releasePackageFiles) {
    const packageJson = JSON.parse(readFileSync(resolve(tempRoot, relativePath), "utf8")) as {
      version?: unknown;
    };
    if (packageJson.version !== "9.9.9-smoke.0") {
      throw new Error(`Expected ${relativePath} to contain the smoke version.`);
    }
  }

  // Workspace versions are not a stable serialized field in Bun's text lock
  // format (Bun 1.3.14 no longer rewrites them). What matters for a release is
  // that the updated manifests still resolve with the generated frozen lock.
  execFileSync("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], {
    cwd: tempRoot,
    stdio: "inherit",
  });

  const { arm64Path, x64Path } = writeMacManifestFixtures(tempRoot);
  execFileSync(
    process.execPath,
    [resolve(repoRoot, "scripts/merge-mac-update-manifests.ts"), arm64Path, x64Path],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );

  const mergedManifest = readFileSync(arm64Path, "utf8");
  assertContains(
    mergedManifest,
    "Tabs-9.9.9-smoke.0-arm64.zip",
    "Merged manifest is missing the arm64 asset.",
  );
  assertContains(
    mergedManifest,
    "Tabs-9.9.9-smoke.0-x64.zip",
    "Merged manifest is missing the x64 asset.",
  );

  console.log("Release smoke checks passed.");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
