"use strict";

const fs = require("node:fs");
const path = require("node:path");

function countWindowsRuntimeFiles(runtimeDir) {
  const manifestPath = path.join(runtimeDir, "tabs-payload.json");
  let packedFiles = 0;
  function count(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) count(filename);
      else if (entry.isFile() && filename !== manifestPath) packedFiles++;
    }
  }
  count(runtimeDir);
  return packedFiles;
}

function writeWindowsPackedInventory(runtimeDir) {
  const manifestPath = path.join(runtimeDir, "tabs-payload.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const packedFiles = countWindowsRuntimeFiles(runtimeDir);
  if (packedFiles < 1 || packedFiles > 50_000)
    throw new Error(`Invalid Windows packed editor inventory: ${packedFiles}`);
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, packedFiles }, null, 2) + "\n");
  return packedFiles;
}

function verifyWindowsStagedRuntime(appDir) {
  const runtimeDir = path.join(appDir, "resources", "tabs-code-oss");
  const manifestPath = path.join(runtimeDir, "tabs-payload.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (
    !Number.isInteger(manifest.packedFiles) ||
    manifest.packedFiles < 1 ||
    manifest.packedFiles > 50_000
  )
    throw new Error("The staged editor has no valid packed file inventory.");
  const files = countWindowsRuntimeFiles(runtimeDir);
  if (files !== manifest.packedFiles)
    throw new Error(
      `Incomplete editor extraction: expected ${manifest.packedFiles} files, got ${files}.`,
    );
  for (const relative of [
    "Tabs.exe",
    "resources/app.asar",
    "resources/tabs-code-oss/out/vs/code/electron-browser/workbench/workbench-dev.html",
    "resources/tabs-code-oss/out/nls.messages.json",
    "resources/tabs-code-oss/out-build/nls.messages.json",
    "resources/tabs-code-oss/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs",
    "resources/tabs-code-oss/extensions/node_modules/typescript/lib/typescript.js",
    "resources/tabs-code-oss/extensions/node_modules/typescript/lib/lib.d.ts",
    "resources/tabs-code-oss/extensions/node_modules/typescript/lib/lib.es5.d.ts",
    "resources/tabs-code-oss/extensions/node_modules/typescript/lib/lib.dom.d.ts",
  ]) {
    if (!fs.statSync(path.join(appDir, relative)).isFile())
      throw new Error(`Incomplete full-fat application extraction: ${relative}`);
  }
  return files;
}

module.exports = { writeWindowsPackedInventory, verifyWindowsStagedRuntime };

if (require.main === module) {
  try {
    console.info(
      `Verified full-fat staged editor: ${verifyWindowsStagedRuntime(process.argv[2])} files.`,
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 2;
  }
}
