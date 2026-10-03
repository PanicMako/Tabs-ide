import * as ChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as Util from "node:util";

const execFileAsync = Util.promisify(ChildProcess.execFile);

const KEY_SALT = "saltysalt";
const KEY_LENGTH = 16;
/** macOS stretches the keychain secret; Linux uses a single iteration. */
const MAC_KEY_ITERATIONS = 1003;
const LINUX_KEY_ITERATIONS = 1;
/** Chromium's documented fallback passphrase when no Linux keyring is present. */
const LINUX_FALLBACK_PASSPHRASE = "peanuts";

export type ChromiumKeyFailure =
  | "needsKeychainApproval"
  | "keychainItemMissing"
  | "keychainUnavailable"
  | "unsupportedPlatform"
  | "readFailed";

export class ChromiumKeyError extends Error {
  override name = "ChromiumKeyError";
  readonly reason: ChromiumKeyFailure;
  override readonly cause?: unknown;

  constructor(reason: ChromiumKeyFailure, cause?: unknown) {
    super(`Could not obtain the Chromium cookie key: ${reason}.`);
    this.reason = reason;
    this.cause = cause;
  }
}

export interface ChromiumKeyMaterial {
  /** AES-128-CBC on macOS, and the keyring-free Linux fallback. */
  readonly cbcV10?: Buffer;
  /** AES-128-CBC, Linux keyring-derived. */
  readonly cbcV11?: Buffer;
  /** Retained so an import that needs this key can report why it is missing. */
  readonly cbcV11Error?: ChromiumKeyError;
  /**
   * AES-128-CBC from an empty passphrase. Some Linux clients wrote records
   * with it (crbug.com/1195256), so Chromium — and this import — retry with it
   * after a record's own key fails.
   */
  readonly cbcEmpty?: Buffer;
  /** AES-256-GCM key used by pre-App-Bound Chromium on Windows. */
  readonly gcmV10?: Buffer;
}

export function deriveKey(passphrase: string, iterations: number): Buffer {
  return NodeCrypto.pbkdf2Sync(passphrase, KEY_SALT, iterations, KEY_LENGTH, "sha1");
}

/**
 * Reads the macOS OSCrypt secret from the login keychain.
 *
 * Tries @napi-rs/keyring first if available, and falls back to /usr/bin/security.
 */
async function readKeychainSecret(service: string, account: string): Promise<string> {
  // 1. Try @napi-rs/keyring if installed
  try {
    // Dynamic import to prevent startup failure if native binding is absent
    // @ts-expect-error optional peer dependency
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keyringModule: any = await import("@napi-rs/keyring");
    if (keyringModule && keyringModule.Entry) {
      const entry = new keyringModule.Entry(service, account);
      const secret = entry.getPassword();
      if (typeof secret === "string" && secret.length > 0) {
        return secret;
      }
    }
  } catch {
    // Fall back to /usr/bin/security
  }

  // 2. Shell out to /usr/bin/security
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/security",
      ["find-generic-password", "-w", "-s", service, "-a", account],
      { timeout: 30000, maxBuffer: 8192 },
    );
    const secret = stdout.replace(/\r?\n$/, "");
    if (!secret) {
      throw new ChromiumKeyError("keychainItemMissing");
    }
    return secret;
  } catch (err) {
    if (err instanceof ChromiumKeyError) throw err;
    const msg = String(
      (err as { message?: string; stderr?: string })?.stderr || (err as Error)?.message || "",
    );
    if (/The specified item could not be found|not found/i.test(msg)) {
      throw new ChromiumKeyError("keychainItemMissing", err);
    }
    if (/User canceled|canceled|denied/i.test(msg)) {
      throw new ChromiumKeyError("needsKeychainApproval", err);
    }
    throw new ChromiumKeyError("keychainUnavailable", err);
  }
}

const DPAPI_PREFIX = Buffer.from("DPAPI");
const WINDOWS_KEY_LENGTH = 32;
const WINDOWS_DPAPI_SCRIPT =
  "Add-Type -AssemblyName System.Security;" +
  "$value=[Console]::In.ReadToEnd();" +
  "$encrypted=[Convert]::FromBase64String($value);" +
  "$plain=[Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);" +
  "[Console]::Out.Write([Convert]::ToBase64String($plain))";

export async function readWindowsKey(localStatePath: string): Promise<Buffer> {
  let contentStr: string;
  try {
    contentStr = await FS.readFile(localStatePath, "utf8");
  } catch (err) {
    throw new ChromiumKeyError("readFailed", err);
  }

  let parsed: { os_crypt?: { encrypted_key?: string; app_bound_encrypted_key?: string } };
  try {
    parsed = JSON.parse(contentStr);
  } catch (err) {
    throw new ChromiumKeyError("readFailed", err);
  }

  if (parsed.os_crypt?.app_bound_encrypted_key && !parsed.os_crypt.encrypted_key) {
    // Windows Chromium with App-Bound Encryption cannot be decrypted outside the browser
    throw new ChromiumKeyError("unsupportedPlatform");
  }

  const encryptedKeyBase64 = parsed.os_crypt?.encrypted_key;
  if (!encryptedKeyBase64) {
    throw new ChromiumKeyError("readFailed");
  }

  const rawEncrypted = Buffer.from(encryptedKeyBase64, "base64");
  if (!rawEncrypted.subarray(0, DPAPI_PREFIX.length).equals(DPAPI_PREFIX)) {
    throw new ChromiumKeyError("readFailed");
  }

  const wrapped = rawEncrypted.subarray(DPAPI_PREFIX.length);

  try {
    const proc = ChildProcess.spawn("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      WINDOWS_DPAPI_SCRIPT,
    ]);

    const stdoutChunks: Buffer[] = [];
    proc.stderr.resume();
    proc.stdin.on("error", () => undefined);
    const timeout = setTimeout(() => proc.kill(), 15000);
    proc.once("close", () => clearTimeout(timeout));
    proc.once("error", () => clearTimeout(timeout));
    proc.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    proc.stdin.write(wrapped.toString("base64"));
    proc.stdin.end();

    const exitCode = await new Promise<number>((resolve) => {
      proc.on("close", resolve);
      proc.on("error", () => resolve(1));
    });

    if (exitCode !== 0) {
      throw new ChromiumKeyError("readFailed");
    }

    const unprotectB64 = Buffer.concat(stdoutChunks).toString("utf8").trim();
    const plain = Buffer.from(unprotectB64, "base64");
    if (plain.length !== WINDOWS_KEY_LENGTH) {
      throw new ChromiumKeyError("readFailed");
    }
    return plain;
  } catch (err) {
    if (err instanceof ChromiumKeyError) throw err;
    throw new ChromiumKeyError("readFailed", err);
  }
}

export type LinuxSecretLookup = (application: string) => Promise<string>;

/** Match Chromium's v2 libsecret schema and application attribute. */
export async function readLinuxSecret(application: string): Promise<string> {
  if (!/^[a-z0-9_-]+$/.test(application)) throw new ChromiumKeyError("keychainItemMissing");
  try {
    const { stdout } = await execFileAsync(
      "secret-tool",
      ["lookup", "xdg:schema", "chrome_libsecret_os_crypt_password_v2", "application", application],
      { timeout: 30000, maxBuffer: 8192 },
    );
    const secret = stdout.replace(/\r?\n$/, "");
    if (!secret) throw new ChromiumKeyError("keychainItemMissing");
    return secret;
  } catch (error) {
    if (error instanceof ChromiumKeyError) throw error;
    // Do not attach subprocess stderr/stdout: either could contain private data.
    throw new ChromiumKeyError("keychainUnavailable");
  }
}

export interface ChromiumKeyRequest {
  readonly platform: NodeJS.Platform;
  readonly keychainService?: string | undefined;
  readonly keychainAccount?: string | undefined;
  readonly linuxSecretApplication?: string | undefined;
}

export async function resolveChromiumKeys(
  request: ChromiumKeyRequest,
  lookupLinuxSecret: LinuxSecretLookup = readLinuxSecret,
): Promise<ChromiumKeyMaterial> {
  if (request.platform === "darwin") {
    if (!request.keychainService || !request.keychainAccount) {
      throw new ChromiumKeyError("unsupportedPlatform");
    }
    const secret = await readKeychainSecret(request.keychainService, request.keychainAccount);
    return {
      cbcV10: deriveKey(secret, MAC_KEY_ITERATIONS),
    };
  }

  if (request.platform === "linux") {
    const fallback = {
      cbcV10: deriveKey(LINUX_FALLBACK_PASSPHRASE, LINUX_KEY_ITERATIONS),
      cbcEmpty: deriveKey("", LINUX_KEY_ITERATIONS),
    };
    try {
      if (!request.linuxSecretApplication) throw new ChromiumKeyError("keychainItemMissing");
      const secret = await lookupLinuxSecret(request.linuxSecretApplication);
      if (!secret) throw new ChromiumKeyError("keychainItemMissing");
      return { ...fallback, cbcV11: deriveKey(secret, LINUX_KEY_ITERATIONS) };
    } catch (error) {
      return {
        ...fallback,
        cbcV11Error:
          error instanceof ChromiumKeyError ? error : new ChromiumKeyError("keychainUnavailable"),
      };
    }
  }

  throw new ChromiumKeyError("unsupportedPlatform");
}
