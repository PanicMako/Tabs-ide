"use strict";

const fs = require("node:fs");
const path = require("node:path");

function isWithin(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

function sanitizeMacAppSymlinks(appPath) {
  const resolvedAppPath = fs.realpathSync(appPath);
  const queue = [resolvedAppPath];

  while (queue.length > 0) {
    const currentDir = queue.shift();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isSymbolicLink()) continue;

      const linkTarget = fs.readlinkSync(fullPath);
      const resolvedTarget = path.resolve(currentDir, linkTarget);
      if (!fs.existsSync(resolvedTarget)) {
        fs.unlinkSync(fullPath);
        continue;
      }

      let realTarget;
      try {
        realTarget = fs.realpathSync(resolvedTarget);
      } catch (error) {
        throw new Error(`Could not resolve symlink ${fullPath} -> ${linkTarget}`, { cause: error });
      }
      if (isWithin(resolvedAppPath, realTarget)) continue;

      const workDir = fs.mkdtempSync(path.join(currentDir, ".tabs-symlink-"));
      const replacement = path.join(workDir, "replacement");
      const original = path.join(workDir, "original");
      try {
        const isDirectory = fs.statSync(realTarget).isDirectory();
        if (isDirectory) {
          fs.cpSync(realTarget, replacement, { recursive: true, dereference: true });
        } else {
          fs.copyFileSync(realTarget, replacement);
        }
        fs.renameSync(fullPath, original);
        try {
          fs.renameSync(replacement, fullPath);
        } catch (error) {
          fs.renameSync(original, fullPath);
          throw error;
        }
        if (isDirectory) queue.push(fullPath);
      } catch (error) {
        throw new Error(`Could not package symlink ${fullPath} -> ${realTarget}`, { cause: error });
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    }
  }
}

module.exports = { sanitizeMacAppSymlinks };
