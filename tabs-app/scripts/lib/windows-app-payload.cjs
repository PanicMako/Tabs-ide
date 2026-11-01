"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const WINDOWS_APP_FILE_EXCLUSIONS = [
  "!apps/desktop/resources/tabs-code-oss",
  "!apps/desktop/resources/tabs-code-oss/**/*",
  "!apps/desktop/dist-electron/**/*.map",
  "!apps/server/dist/**/*.map",
];

function excludedWindowsAppFile(filename) {
  return (
    filename === "apps/desktop/resources/tabs-code-oss" ||
    filename.startsWith("apps/desktop/resources/tabs-code-oss/") ||
    (filename.endsWith(".map") &&
      (filename.startsWith("apps/desktop/dist-electron/") ||
        filename.startsWith("apps/server/dist/")))
  );
}

function readAsarHeader(filename) {
  const descriptor = fs.openSync(filename, "r");
  try {
    const prefix = Buffer.alloc(16);
    if (fs.readSync(descriptor, prefix, 0, 16, 0) !== 16 || prefix.readUInt32LE(0) !== 4)
      throw new Error("Invalid ASAR prefix.");
    const headerLength = prefix.readUInt32LE(4);
    const jsonLength = prefix.readUInt32LE(12);
    if (jsonLength < 2 || jsonLength > 64 * 1024 * 1024 || headerLength < jsonLength + 8)
      throw new Error("Invalid ASAR header length.");
    const json = Buffer.alloc(jsonLength);
    if (fs.readSync(descriptor, json, 0, jsonLength, 16) !== jsonLength)
      throw new Error("Truncated ASAR header.");
    return { header: JSON.parse(json.toString("utf8")), dataOffset: 8 + headerLength };
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertWindowsAppArchiveLean(filename) {
  const { header } = readAsarHeader(filename);
  function visit(node, prefix) {
    for (const [name, child] of Object.entries(node.files || {})) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (excludedWindowsAppFile(relative))
        throw new Error(`Redundant Windows app payload: ${relative}`);
      if (child.files) visit(child, relative);
    }
  }
  visit(header, "");
}

/** Repack diagnostics only. Keeps file bytes, native-unpack flags and integrity
 * records unchanged; normal builds exclude these paths before creating ASAR. */
function trimWindowsAppArchive(filename) {
  const { header, dataOffset } = readAsarHeader(filename);
  const packed = [];
  const removedUnpacked = [];
  let removedBytes = 0;
  function visit(node, prefix, parentUnpacked) {
    for (const [name, child] of Object.entries(node.files || {})) {
      if (name === ".." || name === "." || name.includes("/") || name.includes("\\"))
        throw new Error("Unsafe ASAR path component.");
      const relative = prefix ? `${prefix}/${name}` : name;
      const unpacked = parentUnpacked || !!child.unpacked;
      if (child.files) {
        visit(child, relative, unpacked);
        if (excludedWindowsAppFile(relative)) delete node.files[name];
      } else if (excludedWindowsAppFile(relative)) {
        removedBytes += child.size || 0;
        if (unpacked) removedUnpacked.push(relative);
        delete node.files[name];
      } else if (child.offset !== undefined && !unpacked) {
        const offset = Number(child.offset);
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          !Number.isSafeInteger(child.size) ||
          child.size < 0
        )
          throw new Error("Invalid ASAR file extent.");
        packed.push({ node: child, offset, size: child.size });
      } else if (child.link && excludedWindowsAppFile(child.link)) {
        throw new Error("ASAR link targets an excluded payload.");
      }
    }
  }
  visit(header, "", false);
  packed.sort((a, b) => a.offset - b.offset);
  let offset = 0;
  for (const entry of packed) {
    entry.node.offset = String(offset);
    offset += entry.size;
  }
  if (offset > fs.statSync(filename).size - dataOffset)
    throw new Error("Invalid ASAR packed data size.");
  const json = Buffer.from(JSON.stringify(header));
  const payloadLength = Math.ceil((json.length + 4) / 4) * 4;
  const pickle = Buffer.alloc(payloadLength + 4);
  pickle.writeUInt32LE(payloadLength, 0);
  pickle.writeUInt32LE(json.length, 4);
  json.copy(pickle, 8);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0);
  size.writeUInt32LE(pickle.length, 4);
  const temporary = `${filename}.tabs-${randomUUID()}`;
  const input = fs.openSync(filename, "r");
  let inputOpen = true;
  let output;
  try {
    output = fs.openSync(temporary, "wx");
    function write(buffer) {
      let position = 0;
      while (position < buffer.length) {
        const bytes = fs.writeSync(output, buffer, position, buffer.length - position);
        if (!bytes) throw new Error("Could not write ASAR contents.");
        position += bytes;
      }
    }
    write(size);
    write(pickle);
    const buffer = Buffer.alloc(4 * 1024 * 1024);
    const sourceSize = fs.fstatSync(input).size;
    for (const entry of packed) {
      if (dataOffset + entry.offset + entry.size > sourceSize)
        throw new Error("ASAR file exceeds archive bounds.");
      let remaining = entry.size;
      let position = dataOffset + entry.offset;
      while (remaining) {
        const bytes = fs.readSync(input, buffer, 0, Math.min(buffer.length, remaining), position);
        if (!bytes) throw new Error("Truncated ASAR file contents.");
        write(buffer.subarray(0, bytes));
        position += bytes;
        remaining -= bytes;
      }
    }
    fs.fsyncSync(output);
    fs.closeSync(output);
    output = undefined;
    fs.closeSync(input);
    inputOpen = false;
    fs.renameSync(temporary, filename);
    for (const relative of removedUnpacked)
      fs.rmSync(path.join(`${filename}.unpacked`, relative), { force: true });
  } catch (error) {
    if (output !== undefined) fs.closeSync(output);
    if (inputOpen) fs.closeSync(input);
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  assertWindowsAppArchiveLean(filename);
  return removedBytes;
}

module.exports = {
  WINDOWS_APP_FILE_EXCLUSIONS,
  excludedWindowsAppFile,
  assertWindowsAppArchiveLean,
  trimWindowsAppArchive,
};
