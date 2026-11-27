#!/usr/bin/env node
// Records what one packaging job produced, for the run summary.
//
//   node .github/scripts/installer-manifest.cjs <out.json> <file-or-dir>...
//
// Directories contribute the files directly inside them. Missing inputs are
// skipped, so a failed job still writes a (possibly empty) manifest. The job's
// label, key and artifact name come from LABEL, KEY and ARTIFACT.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const [out, ...inputs] = process.argv.slice(2);
if (!out) {
  console.error("usage: installer-manifest.cjs <out.json> <file-or-dir>...");
  process.exit(2);
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

const files = [];
for (const input of inputs) {
  if (!fs.existsSync(input)) continue;
  const candidates = fs.statSync(input).isDirectory()
    ? fs.readdirSync(input).map((entry) => path.join(input, entry))
    : [input];
  for (const file of candidates) {
    const stat = fs.statSync(file);
    if (!stat.isFile()) continue;
    files.push({ name: path.basename(file), bytes: stat.size, sha256: sha256(file) });
  }
}
files.sort((a, b) => a.name.localeCompare(b.name));

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  `${JSON.stringify(
    {
      key: process.env.KEY ?? "",
      label: process.env.LABEL ?? "",
      artifact: process.env.ARTIFACT ?? "",
      files,
    },
    null,
    2,
  )}\n`,
);
console.log(`Described ${files.length} file(s) in ${out}`);
