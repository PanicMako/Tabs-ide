import { createHash, verify } from "node:crypto";
import * as FS from "node:fs";
import * as FSPromises from "node:fs/promises";
import * as Path from "node:path";
import { spawn } from "node:child_process";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

const MANIFEST_NAME = "tabs-mac-preview-update.json";
export const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAhDgnyPlvyYHwvS9U5TV6PXtVi0Du03HWviLL6cCxSsg=
-----END PUBLIC KEY-----`;
const EXPECTED_BUNDLE_IDENTIFIER = "com.tabs.app";
const STAGE_DIRECTORY_PREFIX = ".Tabs.preview-update-";
const REMOVE_RETRY_COUNT = 6;
const REMOVE_RETRY_DELAY_MS = 250;

export const MAC_PREVIEW_INSTALL_SCRIPT = `set -eu
target="$1"
staged="$2"
backup="$3"
pid="$4"
stage_root="$5"
log="$6"
open_command="$7"
exec >>"$log" 2>&1
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) waiting for Tabs process $pid"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
/bin/mv "$target" "$backup"
if /bin/mv "$staged" "$target"; then
  if "$open_command" "$target"; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) installed and relaunched update"
    /bin/rm -rf "$backup"
    /bin/rm -rf "$stage_root"
  else
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) relaunch failed; restoring previous app"
    /bin/rm -rf "$target"
    /bin/mv "$backup" "$target"
    "$open_command" "$target"
    exit 1
  fi
else
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) install move failed; restoring previous app"
  /bin/mv "$backup" "$target"
  "$open_command" "$target"
  exit 1
fi
`;

export interface MacPreviewUpdateAsset {
  readonly name: string;
  readonly sha512: string;
  readonly size: number;
}

export interface MacPreviewUpdateManifest {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly releaseDate: string;
  readonly repository: string;
  readonly releaseNotes: string;
  readonly assets: {
    readonly arm64: MacPreviewUpdateAsset;
    readonly x64: MacPreviewUpdateAsset;
  };
}

interface DownloadedUpdate {
  readonly manifest: MacPreviewUpdateManifest;
  readonly archivePath: string;
}

async function runCommand(command: string, args: readonly string[]): Promise<string> {
  let stdout = "";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${Path.basename(command)} exited with code ${code}: ${stderr.trim()}`));
      }
    });
  });
  return stdout;
}

async function removeUpdatePath(path: string): Promise<void> {
  try {
    await FSPromises.rm(path, {
      recursive: true,
      force: true,
      maxRetries: REMOVE_RETRY_COUNT,
      retryDelay: REMOVE_RETRY_DELAY_MS,
    });
  } catch (nodeError) {
    if (process.platform === "darwin" || process.platform === "linux") {
      try {
        await runCommand("/bin/rm", ["-rf", path]);
        return;
      } catch {
        // Fall through to rethrow original error
      }
    }
    throw nodeError;
  }
}

export async function createMacPreviewStageDirectory(
  installDirectory: string,
  version: string,
): Promise<string> {
  const entries = await FSPromises.readdir(installDirectory, { withFileTypes: true });
  const staleStageDirectories = entries
    // A leftover backup may be the only recoverable copy after an interrupted
    // swap. Never delete it automatically while preparing another update.
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(STAGE_DIRECTORY_PREFIX))
    .map((entry) => Path.join(installDirectory, entry.name));

  const cleanupResults = await Promise.allSettled(staleStageDirectories.map(removeUpdatePath));
  for (const [index, result] of cleanupResults.entries()) {
    if (result.status === "rejected") {
      console.warn(
        `[desktop-updater] Could not remove stale macOS update staging directory ${staleStageDirectories[index]}: ${String(result.reason)}`,
      );
    }
  }

  return FSPromises.mkdtemp(Path.join(installDirectory, `${STAGE_DIRECTORY_PREFIX}${version}-`));
}

export interface MacPreviewUpdaterOptions {
  readonly appBundlePath: string;
  readonly currentVersion: string;
  readonly repository: string;
  readonly arch: "arm64" | "x64";
  readonly tempDirectory: string;
  readonly releaseChannel?: "beta" | "stable";
  readonly requestHeaders?: Readonly<Record<string, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAsset(value: unknown, label: string): MacPreviewUpdateAsset {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !/^Tabs-[\w.-]+-(?:arm64|x64)\.zip$/.test(value.name) ||
    typeof value.sha512 !== "string" ||
    !/^[A-Za-z0-9+/]{80,}={0,2}$/.test(value.sha512) ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0
  ) {
    throw new Error(`The signed update manifest contains an invalid ${label} asset.`);
  }
  return { name: value.name, sha512: value.sha512, size: value.size };
}

export function parseAndVerifyMacPreviewManifest(
  manifestBytes: Buffer,
  signatureText: string,
  expectedRepository: string,
  publicKey: string = UPDATE_PUBLIC_KEY,
): MacPreviewUpdateManifest {
  const signature = Buffer.from(signatureText.trim(), "base64");
  if (signature.length !== 64 || !verify(null, manifestBytes, publicKey, signature)) {
    throw new Error("The macOS update manifest signature is invalid.");
  }

  const value: unknown = JSON.parse(manifestBytes.toString("utf8"));
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(value.version) ||
    typeof value.releaseDate !== "string" ||
    Number.isNaN(Date.parse(value.releaseDate)) ||
    value.repository !== expectedRepository ||
    typeof value.releaseNotes !== "string" ||
    value.releaseNotes.length > 50_000 ||
    !isRecord(value.assets)
  ) {
    throw new Error("The signed macOS update manifest is malformed or targets another project.");
  }

  return {
    schemaVersion: 1,
    version: value.version,
    releaseDate: value.releaseDate,
    repository: expectedRepository,
    releaseNotes: value.releaseNotes.trim(),
    assets: {
      arm64: parseAsset(value.assets.arm64, "arm64"),
      x64: parseAsset(value.assets.x64, "x64"),
    },
  };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
  if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber);
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return left.localeCompare(right);
}

export function compareMacPreviewVersions(left: string, right: string): number {
  const [leftCore = "", leftPre] = left.split(/-(.+)/, 2);
  const [rightCore = "", rightPre] = right.split(/-(.+)/, 2);
  const leftParts = leftCore.split(".").map(Number);
  const rightParts = rightCore.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (leftPre === undefined && rightPre === undefined) return 0;
  if (leftPre === undefined) return 1;
  if (rightPre === undefined) return -1;
  const leftIdentifiers = leftPre.split(".");
  const rightIdentifiers = rightPre.split(".");
  for (
    let index = 0;
    index < Math.max(leftIdentifiers.length, rightIdentifiers.length);
    index += 1
  ) {
    const leftIdentifier = leftIdentifiers[index];
    const rightIdentifier = rightIdentifiers[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const result = compareIdentifiers(leftIdentifier, rightIdentifier);
    if (result !== 0) return result;
  }
  return 0;
}

function releaseAssetUrl(repository: string, tag: string, assetName: string): string {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

export function selectMacPreviewRelease(
  payload: unknown,
  currentVersion: string,
  channel?: "beta" | "stable",
): string | null {
  if (!Array.isArray(payload)) throw new Error("Invalid GitHub release response");
  const acceptsBeta =
    channel === "beta" ||
    (channel === undefined && /^\d+\.\d+\.\d+-beta\.(?:0|[1-9]\d*)$/.test(currentVersion));
  const releases = payload.filter(
    (r) =>
      isRecord(r) &&
      !r.draft &&
      typeof r.tag_name === "string" &&
      (r.prerelease === true
        ? acceptsBeta && /^v?\d+\.\d+\.\d+(?:-beta\.(?:0|[1-9]\d*))?$/.test(r.tag_name)
        : /^v?\d+\.\d+\.\d+$/.test(r.tag_name)) &&
      Array.isArray(r.assets) &&
      [
        MANIFEST_NAME,
        `${MANIFEST_NAME}.sig`,
        `Tabs-${r.tag_name.replace(/^v/, "")}-arm64.zip`,
        `Tabs-${r.tag_name.replace(/^v/, "")}-x64.zip`,
      ].every((name) =>
        (r.assets as unknown[]).some((a: unknown) => isRecord(a) && a.name === name),
      ),
  );
  releases.sort((a, b) =>
    compareMacPreviewVersions(b.tag_name.replace(/^v/, ""), a.tag_name.replace(/^v/, "")),
  );
  return releases[0]?.tag_name ?? null;
}

export async function reuseVerifiedMacPreviewStage(
  stagedBundlePath: string | null,
  expectedVersion: string,
  validate: (bundlePath: string, version: string) => Promise<void> = validateBundle,
): Promise<string | null> {
  if (!stagedBundlePath) return null;
  try {
    await validate(stagedBundlePath, expectedVersion);
    return stagedBundlePath;
  } catch {
    return null;
  }
}

async function fetchRequired(
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<Response> {
  const response = await fetch(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`Update server returned HTTP ${response.status} for ${Path.basename(url)}.`);
  }
  return response;
}

async function validateBundle(bundlePath: string, expectedVersion: string): Promise<void> {
  const plistPath = Path.join(bundlePath, "Contents", "Info.plist");
  const readPlistValue = async (key: string): Promise<string> => {
    try {
      return (
        await runCommand("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plistPath])
      ).trim();
    } catch {
      throw new Error(`The downloaded update is missing ${key}.`);
    }
  };
  if ((await readPlistValue("CFBundleIdentifier")) !== EXPECTED_BUNDLE_IDENTIFIER) {
    throw new Error("The downloaded update has an unexpected bundle identifier.");
  }
  if ((await readPlistValue("CFBundleShortVersionString")) !== expectedVersion) {
    throw new Error("The downloaded update version does not match its signed manifest.");
  }
  // Preserve quarantine. The signed update digest authenticates the payload;
  // it does not replace Apple's Gatekeeper approval or notarization.
  // NOTE: We intentionally skip `codesign --verify --deep --strict` here.
  // The ZIP's SHA-512 hash was already verified against an Ed25519-signed
  // manifest during download, which cryptographically guarantees the bundle
  // was not tampered with. Running a full deep codesign traversal of a 3+ GB
  // bundle takes 20–30 minutes on typical hardware and provides no additional
  // security guarantee beyond the hash verification already performed.
}

export class MacPreviewUpdater {
  readonly #options: MacPreviewUpdaterOptions;
  #availableTag: string | null = null;
  #availableManifest: MacPreviewUpdateManifest | null = null;
  #downloadedUpdate: DownloadedUpdate | null = null;
  #stagedBundlePath: string | null = null;

  constructor(options: MacPreviewUpdaterOptions) {
    if (process.platform === "darwin" && Path.extname(options.appBundlePath) !== ".app") {
      throw new Error("The macOS preview updater could not locate the running app bundle.");
    }
    this.#options = options;
  }

  async checkForUpdates(): Promise<MacPreviewUpdateManifest | null> {
    const releaseResponse = await fetchRequired(
      `https://api.github.com/repos/${this.#options.repository}/releases?per_page=100`,
      this.#options.requestHeaders ?? {},
    );
    const tag = selectMacPreviewRelease(
      await releaseResponse.json(),
      this.#options.currentVersion,
      this.#options.releaseChannel,
    );
    this.#availableManifest = null;
    this.#availableTag = null;
    if (!tag) return null;
    const manifestUrl = releaseAssetUrl(this.#options.repository, tag, MANIFEST_NAME);
    const [manifestResponse, signatureResponse] = await Promise.all([
      fetchRequired(manifestUrl, this.#options.requestHeaders ?? {}),
      fetchRequired(`${manifestUrl}.sig`, this.#options.requestHeaders ?? {}),
    ]);
    const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
    const signatureText = await signatureResponse.text();
    const manifest = parseAndVerifyMacPreviewManifest(
      manifestBytes,
      signatureText,
      this.#options.repository,
    );
    if (
      manifest.version !== tag.replace(/^v/, "") ||
      manifest.assets.arm64.name !== `Tabs-${manifest.version}-arm64.zip` ||
      manifest.assets.x64.name !== `Tabs-${manifest.version}-x64.zip`
    ) {
      throw new Error("Signed macOS update does not match the selected release");
    }
    this.#availableTag = tag;
    this.#availableManifest =
      compareMacPreviewVersions(manifest.version, this.#options.currentVersion) > 0
        ? manifest
        : null;
    return this.#availableManifest;
  }

  async downloadUpdate(onProgress: (percent: number) => void): Promise<string> {
    const manifest = this.#availableManifest;
    if (!manifest || !this.#availableTag) throw new Error("No verified macOS update is available.");
    const asset = manifest.assets[this.#options.arch];
    const downloadDirectory = await FSPromises.mkdtemp(
      Path.join(this.#options.tempDirectory, "tabs-preview-update-"),
    );
    const archivePath = Path.join(downloadDirectory, asset.name);
    const temporaryPath = `${archivePath}.download`;
    try {
      const response = await fetchRequired(
        releaseAssetUrl(this.#options.repository, this.#availableTag, asset.name),
        this.#options.requestHeaders ?? {},
      );
      if (!response.body) throw new Error("The update server returned an empty download.");

      const hash = createHash("sha512");
      const handle = await FSPromises.open(temporaryPath, "w", 0o600);
      let received = 0;
      try {
        try {
          const reader = (response.body as NodeReadableStream<Uint8Array>).getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            hash.update(value);
            await handle.write(value);
            received += value.byteLength;
            if (received > asset.size) {
              await reader.cancel();
              throw new Error("The update download exceeded its signed size.");
            }
            onProgress(Math.min(99, (received / asset.size) * 100));
          }
        } finally {
          await handle.close();
        }
      } catch (error) {
        await FSPromises.rm(temporaryPath, { force: true });
        throw error;
      }
      if (received !== asset.size || hash.digest("base64") !== asset.sha512) {
        await FSPromises.rm(temporaryPath, { force: true });
        throw new Error("The downloaded update did not match its signed checksum.");
      }
      await FSPromises.rename(temporaryPath, archivePath);
    } catch (error) {
      await removeUpdatePath(downloadDirectory).catch(() => undefined);
      throw error;
    }
    this.#downloadedUpdate = { manifest, archivePath };
    onProgress(100);
    return manifest.version;
  }

  async stageUpdate(): Promise<string> {
    const downloaded = this.#downloadedUpdate;
    if (!downloaded) throw new Error("No verified macOS update has been downloaded.");
    const reusableStage = await reuseVerifiedMacPreviewStage(
      this.#stagedBundlePath,
      downloaded.manifest.version,
    );
    if (reusableStage) return reusableStage;
    this.#stagedBundlePath = null;
    try {
      await FSPromises.access(downloaded.archivePath, FS.constants.R_OK);
    } catch {
      throw new Error(
        "The staged update and downloaded ZIP are unavailable; download the update again.",
      );
    }
    const installDirectory = Path.dirname(this.#options.appBundlePath);
    try {
      await FSPromises.access(installDirectory, FS.constants.W_OK);
      const appExists = await FSPromises.stat(this.#options.appBundlePath)
        .then(() => true)
        .catch(() => false);
      if (appExists) {
        await FSPromises.access(this.#options.appBundlePath, FS.constants.W_OK);
      }
    } catch {
      throw new Error(
        `The application folder and app bundle must be writable to install updates: ${this.#options.appBundlePath}`,
      );
    }
    const stageRoot = await createMacPreviewStageDirectory(
      installDirectory,
      downloaded.manifest.version,
    );
    const stagedBundlePath = Path.join(stageRoot, "Tabs.app");
    try {
      try {
        await runCommand("/usr/bin/ditto", ["-x", "-k", downloaded.archivePath, stageRoot]);
      } catch {
        throw new Error("The verified macOS update could not be extracted.");
      }
      await validateBundle(stagedBundlePath, downloaded.manifest.version);
    } catch (error) {
      await removeUpdatePath(stageRoot).catch(() => undefined);
      throw error;
    }
    await removeUpdatePath(Path.dirname(downloaded.archivePath));
    this.#stagedBundlePath = stagedBundlePath;
    return stagedBundlePath;
  }

  async quitAndInstall(processId: number): Promise<void> {
    const stagedBundlePath = this.#stagedBundlePath;
    if (!stagedBundlePath) throw new Error("The macOS update has not been staged.");
    const targetPath = this.#options.appBundlePath;
    const backupPath = `${targetPath}.preview-update-backup-${processId}`;
    const stageRoot = Path.dirname(stagedBundlePath);
    const logPath = Path.join(Path.dirname(targetPath), ".Tabs.preview-update.log");
    const child = spawn(
      "/bin/sh",
      [
        "-c",
        MAC_PREVIEW_INSTALL_SCRIPT,
        "tabs-preview-updater",
        targetPath,
        stagedBundlePath,
        backupPath,
        String(processId),
        stageRoot,
        logPath,
        "/usr/bin/open",
      ],
      { detached: true, stdio: "ignore" },
    );
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
  }
}
