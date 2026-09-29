"use strict";

/**
 * electron-builder afterPack hook.
 *
 * electron-builder drops nested `node_modules` from the `extraFiles` copy of
 * `tabs-code-main`, which removes dependencies used by native main-process
 * services and built-in extensions.
 *
 * This hook runs after the app directory is packed but before platform signing
 * and installer assembly, and restores the runtime `node_modules` into the
 * packaged `resources/tabs-code-main`.
 *
 * On macOS this must happen here, before electron-builder applies the Developer
 * ID signature. Mutating and ad-hoc signing the app during DMG assembly changes
 * its Keychain identity and triggers a login-password prompt on startup.
 */

const fs = require("node:fs");
const path = require("node:path");
const { sanitizeMacAppSymlinks } = require("./mac-symlink-sanitizer.cjs");

/** @param {{ appOutDir: string, electronPlatformName: string, packager: any }} context */
module.exports = async function afterPack(context) {
  const platform = context.electronPlatformName; // 'darwin' | 'win32' | 'linux' | 'mas'
  const productFilename = context.packager?.appInfo?.productFilename;
  const resourcesDir =
    platform === "darwin" || platform === "mas"
      ? path.join(context.appOutDir, `${productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  const runtimeDir = path.join(resourcesDir, "tabs-code-main");

  // Thin builds (or any build without the bundled runtime) have no
  // tabs-code-main directory — nothing to restore.
  if (!fs.existsSync(runtimeDir)) {
    if (platform === "darwin" || platform === "mas") {
      const appPath = path.join(context.appOutDir, `${productFilename}.app`);
      if (fs.existsSync(appPath)) {
        sanitizeMacAppSymlinks(appPath);
      }
    }
    return;
  }

  const projectDir =
    (context.packager && context.packager.info && context.packager.info.projectDir) ||
    process.cwd();
  const sourceRuntimeDir = path.join(projectDir, "apps", "desktop", "resources", "tabs-code-main");
  const requiredDependencies = [
    ["node_modules", "minimist/index.js"],
    ["extensions/node_modules", "typescript/lib/typescript.js"],
    [
      "extensions/git/node_modules",
      platform === "darwin" || platform === "mas"
        ? "@vscode/fs-copyfile/build/Release/vscode_fs.node"
        : "@vscode/fs-copyfile/lib/native.js",
    ],
    ["extensions/copilot/node_modules", "@anthropic-ai/sdk/package.json"],
  ];
  for (const [directory, marker] of requiredDependencies) {
    const source = path.join(sourceRuntimeDir, directory);
    const target = path.join(runtimeDir, directory);
    const relativeMarker = path.join(directory, marker);
    if (!fs.existsSync(path.join(source, marker))) {
      throw new Error(`[afterPack] Staged Code OSS runtime is missing ${relativeMarker}.`);
    }
    if (!fs.existsSync(path.join(target, marker))) {
      console.log(`[afterPack] Restoring ${directory} into packaged Code OSS runtime...`);
      // Copy symlinks as-is so native extension dependencies keep their layout.
      fs.cpSync(source, target, { recursive: true });
    }
    if (!fs.existsSync(path.join(target, marker))) {
      throw new Error(`[afterPack] Packaged Code OSS runtime is missing ${relativeMarker}.`);
    }
  }

  if (platform === "darwin" || platform === "mas") {
    const appPath = path.join(context.appOutDir, `${productFilename}.app`);
    if (fs.existsSync(appPath)) {
      sanitizeMacAppSymlinks(appPath);
    }
  }
};
