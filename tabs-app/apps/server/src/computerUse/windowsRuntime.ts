import { createHash, randomUUID } from "node:crypto";
import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../../package.json" with { type: "json" };

export const WINDOWS_RUNTIME_SHA256 =
  "a6e759fd22369ee61acc7389c861bf1b564827e29d2c5696dfab519883e0f4c6";

const MAX_RUNTIME_BYTES = 128 * 1024;
const pendingInstalls = new Map<string, Promise<string>>();

export interface WindowsRuntimeInstallOptions {
  readonly directory?: string;
  readonly version?: string;
  readonly fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Set to null to disable the source-checkout fallback in tests. */
  readonly sourcePath?: string | null;
}

function cacheDirectory(): string {
  const localAppData =
    process.env.LOCALAPPDATA ?? NodePath.join(NodeOS.homedir(), "AppData", "Local");
  return NodePath.join(localAppData, "Tabs", "computer-use");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// UI Automation adapter based on the design of Orca's Windows runtime
// (MIT, © 2026 Lovecast Inc.), implemented for Tabs' request protocol.
export function windowsRuntimeSourcePath(moduleUrl: string): string | null {
  if (!moduleUrl.startsWith("file:")) return null;
  const entry = new URL(moduleUrl);
  if (entry.pathname.endsWith(".ts")) return fileURLToPath(new URL("./windowsRuntime.ps1", entry));
  // dev:desktop executes the built server from apps/server/dist. Release
  // installations omit src and use the integrity-checked release asset.
  if (entry.pathname.includes("/dist/")) {
    const source = new URL(entry);
    source.pathname =
      entry.pathname.slice(0, entry.pathname.lastIndexOf("/dist/")) +
      "/src/computerUse/windowsRuntime.ps1";
    return fileURLToPath(source);
  }
  return null;
}

async function writeAtomically(filename: string, bytes: Uint8Array): Promise<void> {
  await NodeFS.mkdir(NodePath.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await NodeFS.writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await NodeFS.rename(temporary, filename);
  } finally {
    await NodeFS.rm(temporary, { force: true });
  }
}

async function installRuntime(
  filename: string,
  options: WindowsRuntimeInstallOptions,
): Promise<string> {
  const expectedHash = WINDOWS_RUNTIME_SHA256;
  try {
    const cached = await NodeFS.readFile(filename);
    if (sha256(cached) === expectedHash) return filename;
    await NodeFS.rm(filename, { force: true });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  const sourcePath =
    options.sourcePath === undefined
      ? windowsRuntimeSourcePath(import.meta.url)
      : options.sourcePath;
  if (sourcePath) {
    try {
      const source = await NodeFS.readFile(sourcePath);
      if (sha256(source) !== expectedHash) {
        throw new Error("The Windows computer-use runtime source does not match its pinned hash.");
      }
      await writeAtomically(filename, source);
      return filename;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }

  const version = options.version ?? packageJson.version;
  const url = `https://github.com/PanicMako/Tabs-ide/releases/download/v${version}/tabs-computer-use-windows.ps1`;
  const response = await (options.fetcher ?? fetch)(url, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Could not download the Windows computer-use runtime (${response.status}).`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RUNTIME_BYTES) {
    throw new Error("The Windows computer-use runtime is larger than expected.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RUNTIME_BYTES) {
    throw new Error("The Windows computer-use runtime has an invalid size.");
  }
  if (sha256(bytes) !== expectedHash) {
    throw new Error("The downloaded Windows computer-use runtime failed its integrity check.");
  }
  await writeAtomically(filename, bytes);
  return filename;
}

/**
 * Download and cache the Windows-only computer-use script after the feature is enabled.
 * The release asset is pinned by SHA-256; source checkouts use their local file after the same
 * integrity check, while packaged builds never carry the script inside the installer.
 */
export async function ensureWindowsRuntime(
  options: WindowsRuntimeInstallOptions = {},
): Promise<string> {
  const directory = options.directory ?? cacheDirectory();
  const filename = NodePath.join(
    directory,
    `v${options.version ?? packageJson.version}`,
    "windows.ps1",
  );
  const existing = pendingInstalls.get(filename);
  if (existing) return existing;
  const install = installRuntime(filename, options);
  pendingInstalls.set(filename, install);
  try {
    return await install;
  } finally {
    if (pendingInstalls.get(filename) === install) pendingInstalls.delete(filename);
  }
}
