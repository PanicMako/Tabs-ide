import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { writeWindowsNsisScripts } from "./lib/windows-nsis.ts";
import { writeWindowsPackedInventory } from "./lib/windows-packed-inventory.ts";
import { verifyDesktopUpdateArtifact } from "./lib/desktop-update-artifact.ts";
import { readReleaseNotes } from "./verify-desktop-update-metadata.ts";

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.resolve(process.argv[2] ?? path.join(repo, "release"));
const originalManifest = fs.readFileSync(path.join(assets, "latest.yml"), "utf8");
const version = /^version:\s*['"]?([\w.-]+)/m.exec(originalManifest)?.[1];
if (!version) throw new Error("The input Windows artifact has no version.");
const { artifactPath } = await verifyDesktopUpdateArtifact(assets, "win", version);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-installer-repack-"));

function run(command: string, args: string[], cwd = temporary): void {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
      ELECTRON_BUILDER_7Z_FILTER: "BCJ",
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}.`);
}
function archives(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? archives(filename) : entry.name === "app-64.7z" ? [filename] : [];
  });
}
try {
  const embedded = path.join(temporary, "embedded");
  const app = path.join(temporary, "app");
  run("7z", ["x", artifactPath, `-o${embedded}`, "-y"]);
  const packages = archives(embedded);
  if (packages.length !== 1)
    throw new Error("Expected exactly one embedded full-fat x64 application archive.");
  run("7z", ["x", packages[0]!, `-o${app}`, "-y"]);
  const largest: Array<{ name: string; bytes: number }> = [];
  function inspect(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) inspect(filename);
      else if (entry.isFile()) largest.push({ name: path.relative(app, filename), bytes: fs.statSync(filename).size });
    }
  }
  inspect(app);
  console.info("Largest packaged Windows files:", largest.sort((a, b) => b.bytes - a.bytes).slice(0, 12));
  const runtime = path.join(app, "resources", "tabs-code-oss");
  writeWindowsPackedInventory(runtime);
  const project = path.join(temporary, "project");
  const build = path.join(project, "build");
  writeWindowsNsisScripts(build);
  for (const name of [
    "installer.nsh",
    "close-windows-install-processes.ps1",
    "verify-staged-runtime.ps1",
  ]) {
    fs.copyFileSync(path.join(repo, "scripts", name), path.join(build, name));
  }
  const builderRequire = createRequire(require.resolve("electron-builder/package.json"));
  const packagerRequire = createRequire(builderRequire.resolve("app-builder-lib/package.json"));
  const { extractFile } = packagerRequire("@electron/asar") as {
    extractFile: (archive: string, filename: string) => Buffer;
  };
  const packedPackage = extractFile(path.join(app, "resources", "app.asar"), "package.json");
  if ((JSON.parse(packedPackage.toString()) as { version: string }).version !== version)
    throw new Error("Packaged app version differs from its update manifest.");
  fs.writeFileSync(path.join(project, "package.json"), packedPackage);
  const config = {
    electronVersion: JSON.parse(fs.readFileSync(path.join(repo, "apps/desktop/package.json"), "utf8")).dependencies.electron,
    appId: "com.tabs.app",
    productName: "Tabs",
    artifactName: "Tabs-${version}-${arch}.${ext}",
    directories: { output: assets },
    releaseInfo: { releaseNotes: readReleaseNotes(originalManifest) },
    win: { target: ["nsis"], icon: path.join(repo, "apps/desktop/resources/icon.ico") },
    nsis: {
      differentialPackage: true,
      oneClick: true,
      perMachine: false,
      runAfterFinish: false,
      include: "./build/installer.nsh",
      script: "./build/windows-installer.nsi",
    },
    publish: [{ provider: "github", owner: "PanicMako", repo: "Tabs-ide", channel: "latest" }],
  };
  fs.writeFileSync(path.join(project, "builder.json"), JSON.stringify(config));
  run(process.execPath, [
    require.resolve("electron-builder/cli.js"),
    "--win",
    "nsis",
    "--x64",
    "--prepackaged",
    app,
    "--projectDir",
    project,
    "--config",
    path.join(project, "builder.json"),
    "--publish",
    "never",
  ]);
  // The Windows beta/stable feeds reference the same immutable EXE.
  if (fs.existsSync(path.join(assets, "beta.yml")))
    fs.copyFileSync(path.join(assets, "latest.yml"), path.join(assets, "beta.yml"));
  await verifyDesktopUpdateArtifact(assets, "win", version);
  console.info(`Repacked and verified full-fat Windows installer ${version}.`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
