import { DatabaseSync } from "node:sqlite";
import { cookieScope, type ImportedCookie, snapshotCookieDatabase } from "./CookieDatabase";

const SAMESITE_NONE = 0;
const SAMESITE_LAX = 1;
const SAMESITE_STRICT = 2;
const FIREFOX_RAW_SAMESITE_FIRST_SCHEMA = 10;
const FIREFOX_RAW_SAMESITE_LAST_SCHEMA = 14;
const FIREFOX_EXPIRY_MILLISECONDS_SCHEMA = 16;

function sameSiteFromColumn(
  value: number | null,
  rawValue: number | null,
): ImportedCookie["sameSite"] {
  if (value === null) return "unspecified";
  if (value === SAMESITE_LAX && rawValue === SAMESITE_NONE) return "unspecified";
  if (value === SAMESITE_NONE) return "no_restriction";
  if (value === SAMESITE_LAX) return "lax";
  if (value === SAMESITE_STRICT) return "strict";
  return "unspecified";
}

function expiryToSeconds(expiry: number, schemaVersion: number): number | undefined {
  if (!expiry || expiry <= 0) return undefined;
  const sec =
    schemaVersion >= FIREFOX_EXPIRY_MILLISECONDS_SCHEMA ? Math.floor(expiry / 1000) : expiry;
  return sec > 0 ? sec : undefined;
}

export async function readFirefoxCookies(cookieDatabasePath: string): Promise<ImportedCookie[]> {
  const snapshot = await snapshotCookieDatabase(cookieDatabasePath);
  try {
    const db = new DatabaseSync(snapshot.path, { readOnly: true });
    try {
      let schemaVersion = 0;
      try {
        const versionRow = db.prepare("PRAGMA user_version").get() as
          | { user_version?: number }
          | undefined;
        schemaVersion = versionRow?.user_version ?? 0;
      } catch {
        schemaVersion = 0;
      }

      const hasRawSameSite =
        schemaVersion >= FIREFOX_RAW_SAMESITE_FIRST_SCHEMA &&
        schemaVersion <= FIREFOX_RAW_SAMESITE_LAST_SCHEMA;

      const query = hasRawSameSite
        ? `SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite, rawSameSite
             FROM moz_cookies
            WHERE originAttributes = ''`
        : `SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite, null as rawSameSite
             FROM moz_cookies
            WHERE originAttributes = ''`;

      interface MozCookieRow {
        host: string;
        name: string;
        value: string;
        path: string;
        expiry: number;
        isSecure: number;
        isHttpOnly: number;
        sameSite: number | null;
        rawSameSite: number | null;
      }

      const rows = db.prepare(query).all() as unknown as MozCookieRow[];
      const cookies: ImportedCookie[] = [];

      for (const row of rows) {
        const secure = row.isSecure === 1;
        const scope = cookieScope(row.host, row.path, secure);

        cookies.push({
          url: scope.url,
          name: row.name,
          value: row.value,
          domain: scope.domain,
          path: row.path || "/",
          secure,
          httpOnly: row.isHttpOnly === 1,
          expirationDate: expiryToSeconds(row.expiry, schemaVersion),
          sameSite: sameSiteFromColumn(row.sameSite, row.rawSameSite),
        });
      }

      return cookies;
    } finally {
      db.close();
    }
  } finally {
    await snapshot.cleanup();
  }
}
