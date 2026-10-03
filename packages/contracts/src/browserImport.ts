/**
 * Browser Import contracts for importing cookies and active sessions
 * into isolated Tabs browser profile partitions.
 *
 * Passwords, history, and autofill are never accessed or imported.
 */
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const BROWSER_IMPORT_SOURCE_IDS = [
  "chrome",
  "edge",
  "brave",
  "chromium",
  "arc",
  "firefox",
  "safari",
] as const;

export const BrowserImportSourceId = Schema.Literals(BROWSER_IMPORT_SOURCE_IDS);
export type BrowserImportSourceId = typeof BrowserImportSourceId.Type;

export const BrowserImportUnavailableReason = Schema.Literals([
  "notInstalled",
  "browserRunning",
  "databaseLocked",
  "corruptDatabase",
  "needsKeychainApproval",
  "needsFullDiskAccess",
  "unsupportedPlatform",
]);
export type BrowserImportUnavailableReason = typeof BrowserImportUnavailableReason.Type;

export const BrowserImportFailureReason = Schema.Literals([
  ...BrowserImportUnavailableReason.literals,
  "unknownSource",
  "unknownSourceProfile",
  "sessionUnavailable",
  "readFailed",
  "noCookies",
]);
export type BrowserImportFailureReason = typeof BrowserImportFailureReason.Type;

export const BrowserImportSourceProfile = Schema.Struct({
  directory: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  cookieCount: Schema.optional(Schema.Int),
});
export type BrowserImportSourceProfile = typeof BrowserImportSourceProfile.Type;

export const BrowserImportSource = Schema.Struct({
  id: BrowserImportSourceId,
  name: TrimmedNonEmptyString,
  profiles: Schema.Array(BrowserImportSourceProfile),
  unavailable: Schema.optional(BrowserImportUnavailableReason),
});
export type BrowserImportSource = typeof BrowserImportSource.Type;

export const BrowserImportInput = Schema.Struct({
  requestId: Schema.optional(TrimmedNonEmptyString),
  sourceId: BrowserImportSourceId,
  sourceProfileDirectory: TrimmedNonEmptyString,
  targetProfileId: TrimmedNonEmptyString,
});
export type BrowserImportInput = typeof BrowserImportInput.Type;

export const BrowserImportResult = Schema.Struct({
  cancelled: Schema.optional(Schema.Boolean),
  imported: Schema.Int,
  skipped: Schema.Int,
  skippedDomains: Schema.Array(Schema.String),
  warnings: Schema.optional(Schema.Array(Schema.String)),
});
export type BrowserImportResult = typeof BrowserImportResult.Type;

export const BROWSER_IMPORT_FAILURE_COPY: Readonly<Record<BrowserImportFailureReason, string>> = {
  notInstalled: "Browser is not installed on this system.",
  browserRunning:
    "Please quit the browser first so its cookie database can be safely read without lock contention.",
  databaseLocked: "The browser's cookie database is locked by another process.",
  corruptDatabase: "The cookie database appears corrupt or unreadable.",
  needsKeychainApproval: "Keychain approval required to decrypt cookies.",
  needsFullDiskAccess: "Full Disk Access required to access browser profile storage.",
  unsupportedPlatform: "Browser import is not supported on this platform.",
  unknownSource: "Selected browser source was not found.",
  unknownSourceProfile: "Selected profile was not found.",
  sessionUnavailable: "Target browser profile partition could not be opened.",
  readFailed: "Could not read or decrypt browser cookies.",
  noCookies: "No cookies were found in the selected profile.",
};
