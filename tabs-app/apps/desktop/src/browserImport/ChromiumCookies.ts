import * as NodeCrypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  ChromiumKeyError,
  type ChromiumKeyMaterial,
  readWindowsKey,
  resolveChromiumKeys,
} from "./ChromiumKeys";
import {
  bareHost,
  cookieScope,
  type CookieReadResult,
  type ImportedCookie,
  snapshotCookieDatabase,
} from "./CookieDatabase";

/** OSCrypt's CBC mode uses a fixed IV of 16 spaces rather than a per-record one. */
const AES_CBC_IV = Buffer.alloc(16, 0x20);
const AES_GCM_NONCE_LENGTH = 12;
const AES_GCM_TAG_LENGTH = 16;
const WEBKIT_EPOCH_OFFSET_SECONDS = 11_644_473_600;

function sameSiteFromColumn(value: number): ImportedCookie["sameSite"] {
  if (value === 0) return "no_restriction";
  if (value === 1) return "lax";
  if (value === 2) return "strict";
  return "unspecified";
}

function toUnixSeconds(webkitSeconds: number): number | undefined {
  if (!webkitSeconds || webkitSeconds <= 0) return undefined;
  const unix = Math.floor(webkitSeconds - WEBKIT_EPOCH_OFFSET_SECONDS);
  return unix > 0 ? unix : undefined;
}

/**
 * Chromium >= 127 prefixes the plaintext with SHA-256 of the host key, binding
 * a cookie to its domain. Strip it when present.
 */
function stripDomainBinding(
  plaintext: Buffer,
  domain: string,
  schemaVersion: number,
): Buffer | null {
  if (schemaVersion < 24) return plaintext;
  const domainHash = NodeCrypto.createHash("sha256").update(domain).digest();
  return plaintext.length >= 32 && plaintext.subarray(0, 32).equals(domainHash)
    ? plaintext.subarray(32)
    : null;
}

function decryptCbc(
  payload: Buffer,
  key: Buffer,
  domain: string,
  schemaVersion: number,
): string | null {
  try {
    const decipher = NodeCrypto.createDecipheriv("aes-128-cbc", key, AES_CBC_IV);
    decipher.setAutoPadding(true);
    const plaintext = Buffer.concat([decipher.update(payload), decipher.final()]);
    return stripDomainBinding(plaintext, domain, schemaVersion)?.toString("utf8") ?? null;
  } catch {
    return null;
  }
}

function decryptGcm(
  payload: Buffer,
  key: Buffer,
  domain: string,
  schemaVersion: number,
): string | null {
  if (payload.length < AES_GCM_NONCE_LENGTH + AES_GCM_TAG_LENGTH) return null;
  try {
    const nonce = payload.subarray(0, AES_GCM_NONCE_LENGTH);
    const ciphertext = payload.subarray(AES_GCM_NONCE_LENGTH, -AES_GCM_TAG_LENGTH);
    const tag = payload.subarray(-AES_GCM_TAG_LENGTH);
    const decipher = NodeCrypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return stripDomainBinding(plaintext, domain, schemaVersion)?.toString("utf8") ?? null;
  } catch {
    return null;
  }
}

/**
 * Decrypts one stored value, choosing the scheme from its prefix. Returns null
 * when no key covers that scheme — including Windows' app-bound `v20`, which
 * this build has no key for at all.
 */
export function decryptChromiumValue(
  encrypted: Uint8Array | Buffer,
  keys: ChromiumKeyMaterial,
  domain: string,
  schemaVersion = 23,
  platform: NodeJS.Platform = "linux",
): string | null {
  const buffer = Buffer.from(encrypted);
  if (buffer.length === 0) return "";
  const prefix = buffer.subarray(0, 3).toString("latin1");
  const payload = buffer.subarray(3);

  // Windows' legacy v10 format is AES-256-GCM. App-bound records use v20 and
  // intentionally have no key here, so they fall through as undecryptable.
  if (platform === "win32") {
    return prefix === "v10" && keys.gcmV10
      ? decryptGcm(payload, keys.gcmV10, domain, schemaVersion)
      : null;
  }

  // Chromium retries a failed record with a key derived from an empty
  // passphrase, because some Linux clients wrote data that way
  // (crbug.com/1195256). A record whose own key is missing entirely stays
  // skipped, matching Chromium.
  if (prefix === "v10") {
    if (!keys.cbcV10) return null;
    return (
      decryptCbc(payload, keys.cbcV10, domain, schemaVersion) ??
      (keys.cbcEmpty ? decryptCbc(payload, keys.cbcEmpty, domain, schemaVersion) : null)
    );
  }
  if (prefix === "v11") {
    if (!keys.cbcV11) return null;
    return (
      decryptCbc(payload, keys.cbcV11, domain, schemaVersion) ??
      (keys.cbcEmpty ? decryptCbc(payload, keys.cbcEmpty, domain, schemaVersion) : null)
    );
  }

  // No recognised prefix: Chromium on macOS and Linux both treat this as
  // legacy data stored in the clear and return it as-is.
  if (platform === "darwin" || platform === "linux") {
    return stripDomainBinding(buffer, domain, schemaVersion)?.toString("utf8") ?? null;
  }
  return null;
}

export interface ChromiumCookieSource {
  readonly cookieDatabasePath: string;
  readonly keychainService?: string | undefined;
  readonly keychainAccount?: string | undefined;
  readonly linuxSecretApplication?: string | undefined;
  readonly windowsLocalStatePath?: string | undefined;
  readonly platform: NodeJS.Platform;
}

export async function readChromiumCookies(
  source: ChromiumCookieSource,
  overrideKeys?: ChromiumKeyMaterial,
): Promise<CookieReadResult> {
  let windowsWarning: string | undefined;
  const windowsKeys = async (): Promise<ChromiumKeyMaterial> => {
    try {
      return { gcmV10: await readWindowsKey(source.windowsLocalStatePath!) };
    } catch (error) {
      if (!(error instanceof ChromiumKeyError) || error.reason !== "unsupportedPlatform")
        throw error;
      windowsWarning =
        "Windows App-Bound (v20) cookies cannot be imported. Sign in directly in Tabs for those sites.";
      return {};
    }
  };
  const keys =
    overrideKeys ??
    (source.platform === "win32" && source.windowsLocalStatePath
      ? await windowsKeys()
      : await resolveChromiumKeys({
          platform: source.platform,
          keychainService: source.keychainService,
          keychainAccount: source.keychainAccount,
          linuxSecretApplication: source.linuxSecretApplication,
        }));

  const snapshot = await snapshotCookieDatabase(source.cookieDatabasePath);
  try {
    const db = new DatabaseSync(snapshot.path, { readOnly: true });
    try {
      let schemaVersion = 23;
      try {
        const metaStmt = db.prepare("SELECT value FROM meta WHERE key = 'version' LIMIT 1");
        const metaRow = metaStmt.get() as { value?: string | number } | undefined;
        if (metaRow?.value !== undefined) {
          schemaVersion = Number(metaRow.value) || 23;
        }
      } catch {
        schemaVersion = 23;
      }

      // Check whether top_frame_site_key column exists
      let hasTopFrame = false;
      try {
        const columns = db.prepare("PRAGMA table_info(cookies)").all() as Array<{ name?: string }>;
        hasTopFrame = columns.some((col) => col.name === "top_frame_site_key");
      } catch {
        hasTopFrame = schemaVersion >= 15;
      }

      const query = hasTopFrame
        ? `SELECT host_key, name, value, encrypted_value, path,
                  expires_utc / 1000000 as expires_seconds, is_secure, is_httponly,
                  samesite, top_frame_site_key FROM cookies`
        : `SELECT host_key, name, value, encrypted_value, path,
                  expires_utc / 1000000 as expires_seconds, is_secure, is_httponly,
                  samesite, '' as top_frame_site_key FROM cookies`;

      interface RawRow {
        host_key: string;
        name: string;
        value: string;
        encrypted_value: Uint8Array | Buffer;
        path: string;
        expires_seconds: number;
        is_secure: number;
        is_httponly: number;
        samesite: number;
        top_frame_site_key?: string;
      }

      const rows = db.prepare(query).all() as unknown as RawRow[];
      const cookies: ImportedCookie[] = [];
      let undecryptable = 0;
      const undecryptableHosts = new Set<string>();

      for (const row of rows) {
        if (row.top_frame_site_key && row.top_frame_site_key !== "") {
          undecryptable++;
          undecryptableHosts.add(bareHost(row.host_key));
          continue;
        }

        const value =
          row.encrypted_value && row.encrypted_value.length > 0
            ? decryptChromiumValue(
                row.encrypted_value,
                keys,
                row.host_key,
                schemaVersion,
                source.platform,
              )
            : row.value;

        if (value === null) {
          undecryptable++;
          undecryptableHosts.add(bareHost(row.host_key));
          continue;
        }

        const secure = row.is_secure === 1;
        const scope = cookieScope(row.host_key, row.path, secure);

        cookies.push({
          url: scope.url,
          name: row.name,
          value,
          domain: scope.domain,
          path: row.path || "/",
          secure,
          httpOnly: row.is_httponly === 1,
          expirationDate: toUnixSeconds(row.expires_seconds),
          sameSite: sameSiteFromColumn(row.samesite),
        });
      }

      return {
        cookies,
        undecryptable,
        undecryptableHosts: Array.from(undecryptableHosts),
        warnings: [
          ...(keys.cbcV11Error && undecryptable > 0
            ? [
                "Some Linux cookies require Secret Service access. Install secret-tool (libsecret tools), unlock the desktop keyring, and retry.",
              ]
            : []),
          ...(source.platform === "win32" && undecryptable > 0
            ? [
                windowsWarning ??
                  "Some Windows cookies use unsupported encryption, including App-Bound (v20). Sign in directly in Tabs for those sites.",
              ]
            : []),
        ],
      };
    } finally {
      db.close();
    }
  } finally {
    await snapshot.cleanup();
  }
}
