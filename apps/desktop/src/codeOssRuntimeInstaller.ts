/**
 * On-demand installer for the embedded Code-OSS runtime (the `tabs-code-oss`
 * VS Code build). For "thin" installers that do NOT bundle the ~hundreds-of-MB
 * runtime, this downloads it from the GitHub Release on first use, verifies its
 * checksum, and extracts it atomically into the app-support area so
 * `codeHostManager` can resolve it like a normal local checkout.
 *
 * Activation requires a matching `tabs-code-runtime-<version>-<os>-<arch>.zip`
 * asset published on the release (see the release workflow). In dev — or for a
 * "fat" build that bundles the runtime — this is never invoked because the
 * runtime is already resolvable locally.
 */
import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import type { IncomingMessage } from "node:http";
import * as Https from "node:https";
import * as OS from "node:os";
import * as Path from "node:path";
import { pipeline } from "node:stream/promises";

const RUNTIME_ROOT = Path.join(
  process.env.TABS_HOME?.trim() || Path.join(OS.homedir(), ".tabs"),
  "code-oss-runtime",
);

// Repo that publishes the runtime release assets (override for forks/mirrors).
const RUNTIME_REPO = process.env.TABS_RUNTIME_REPO?.trim() || "PanicMako/Tabs-ide";
// Optional fully-qualified base URL override (e.g. a CDN). When set, assets are
// fetched from `${base}/${assetName}`.
const RUNTIME_BASE_URL = process.env.TABS_RUNTIME_BASE_URL?.trim() || null;

export type RuntimeInstallPhase = "downloading" | "verifying" | "extracting" | "done";

export interface RuntimeInstallProgress {
  phase: RuntimeInstallPhase;
  receivedBytes?: number;
  totalBytes?: number | null;
}

function osTag(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "mac";
  if (platform === "win32") return "win";
  return "linux";
}

function runtimeAssetName(version: string, arch: string, platform: NodeJS.Platform): string {
  return `tabs-code-runtime-${version}-${osTag(platform)}-${arch}.zip`;
}

function runtimeAssetUrl(version: string, arch: string, platform: NodeJS.Platform): string {
  const name = runtimeAssetName(version, arch, platform);
  if (RUNTIME_BASE_URL) {
    return `${RUNTIME_BASE_URL.replace(/\/+$/, "")}/${name}`;
  }
  return `https://github.com/${RUNTIME_REPO}/releases/download/v${version}/${name}`;
}

/** The directory a (downloaded or bundled) runtime is installed into. */
export function resolveInstalledRuntimeDir(version: string): string {
  return Path.join(RUNTIME_ROOT, version, "tabs-code-oss");
}

/** True when a usable runtime is already present for this version. */
export function isRuntimeInstalled(version: string): boolean {
  const dir = resolveInstalledRuntimeDir(version);
  return FS.existsSync(
    Path.join(dir, "out", "vs", "code", "electron-browser", "workbench", "workbench-dev.html"),
  );
}

function httpGetFollow(url: string, redirectsLeft = 5): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = Https.get(url, { headers: { "User-Agent": "tabs-desktop" } }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new Error(`Runtime download failed: too many redirects for ${url}`));
          return;
        }
        httpGetFollow(new URL(response.headers.location, url).toString(), redirectsLeft - 1).then(
          resolve,
          reject,
        );
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`Runtime download failed (HTTP ${status}) for ${url}`));
        return;
      }
      resolve(response);
    });
    request.once("error", reject);
    request.setTimeout(30_000, () => request.destroy(new Error("Runtime download timed out.")));
  });
}

async function downloadTo(
  url: string,
  destPath: string,
  onProgress?: (received: number, total: number | null) => void,
): Promise<void> {
  const response = await httpGetFollow(url);
  const totalHeader = response.headers["content-length"];
  const total = typeof totalHeader === "string" ? Number.parseInt(totalHeader, 10) : null;
  let received = 0;
  response.on("data", (chunk: Buffer) => {
    received += chunk.length;
    onProgress?.(received, Number.isFinite(total) ? total : null);
  });
  await pipeline(response, FS.createWriteStream(destPath));
}

async function sha256(filePath: string): Promise<string> {
  const hash = Crypto.createHash("sha256");
  await pipeline(FS.createReadStream(filePath), hash);
  return hash.digest("hex");
}

function extractZip(zipPath: string, destDir: string): void {
  FS.mkdirSync(destDir, { recursive: true });
  const result =
    process.platform === "darwin"
      ? ChildProcess.spawnSync("ditto", ["-x", "-k", zipPath, destDir], { stdio: "ignore" })
      : process.platform === "win32"
        ? ChildProcess.spawnSync(
            "powershell",
            [
              "-NoProfile",
              "-Command",
              // Single-quote the paths and escape embedded quotes (PowerShell
              // escapes `'` by doubling it) so a quote in the home/TABS_HOME path
              // can't break or inject into the command.
              `Expand-Archive -Force -LiteralPath '${zipPath.replace(/'/g, "''")}' ` +
                `-DestinationPath '${destDir.replace(/'/g, "''")}'`,
            ],
            { stdio: "ignore" },
          )
        : ChildProcess.spawnSync("unzip", ["-q", "-o", zipPath, "-d", destDir], {
            stdio: "ignore",
          });
  if (result.status !== 0) {
    throw new Error(`Failed to extract runtime archive: ${zipPath}`);
  }
}

/**
 * Ensure the Code-OSS runtime for `version` is installed, downloading it if
 * necessary. Returns the runtime directory. Safe to call repeatedly (no-op when
 * already installed). Downloads to a temp dir and renames into place so a
 * partial/failed download never leaves a half-installed runtime.
 */
export async function ensureRuntimeInstalled(input: {
  version: string;
  arch?: string;
  onProgress?: (progress: RuntimeInstallProgress) => void;
}): Promise<string> {
  const finalDir = resolveInstalledRuntimeDir(input.version);
  if (isRuntimeInstalled(input.version)) {
    return finalDir;
  }

  const arch = input.arch ?? process.arch;
  const url = runtimeAssetUrl(input.version, arch, process.platform);
  const tmpRoot = Path.join(RUNTIME_ROOT, `.tmp-${input.version}-${process.pid}-${Date.now()}`);
  FS.mkdirSync(tmpRoot, { recursive: true });

  try {
    const zipPath = Path.join(tmpRoot, "runtime.zip");
    input.onProgress?.({ phase: "downloading", receivedBytes: 0, totalBytes: null });
    await downloadTo(url, zipPath, (received, total) =>
      input.onProgress?.({ phase: "downloading", receivedBytes: received, totalBytes: total }),
    );

    // Best-effort checksum verification against a sibling `.sha256` asset.
    input.onProgress?.({ phase: "verifying" });
    try {
      const sumZip = Path.join(tmpRoot, "runtime.zip.sha256");
      await downloadTo(`${url}.sha256`, sumZip);
      const expected = FS.readFileSync(sumZip, "utf8").trim().split(/\s+/)[0]?.toLowerCase();
      if (expected) {
        const actual = (await sha256(zipPath)).toLowerCase();
        if (actual !== expected) {
          throw new Error(`Runtime checksum mismatch (expected ${expected}, got ${actual}).`);
        }
      }
    } catch (error) {
      // A missing `.sha256` asset is tolerated; a real mismatch is not.
      if (error instanceof Error && error.message.includes("checksum mismatch")) {
        throw error;
      }
    }

    input.onProgress?.({ phase: "extracting" });
    const extractDir = Path.join(tmpRoot, "extracted");
    extractZip(zipPath, extractDir);

    // The asset's top level is the `tabs-code-oss` directory.
    const extractedRuntime = FS.existsSync(Path.join(extractDir, "tabs-code-oss", "out"))
      ? Path.join(extractDir, "tabs-code-oss")
      : extractDir;

    FS.mkdirSync(Path.dirname(finalDir), { recursive: true });
    FS.rmSync(finalDir, { recursive: true, force: true });
    FS.renameSync(extractedRuntime, finalDir);
    input.onProgress?.({ phase: "done" });
    return finalDir;
  } finally {
    FS.rmSync(tmpRoot, { recursive: true, force: true });
  }
}
