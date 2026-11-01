"use strict";

const fs = require("node:fs");
const path = require("node:path");

function writeWindowsPackedInventory(runtimeDir) {
  const manifestPath = path.join(runtimeDir, "tabs-payload.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  let packedFiles = 0;
  function count(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) count(filename);
      else if (entry.isFile() && filename !== manifestPath) packedFiles++;
    }
  }
  count(runtimeDir);
  if (packedFiles < 1 || packedFiles > 50_000)
    throw new Error(`Invalid Windows packed editor inventory: ${packedFiles}`);
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, packedFiles }, null, 2) + "\n");
  return packedFiles;
}

module.exports = { writeWindowsPackedInventory };
