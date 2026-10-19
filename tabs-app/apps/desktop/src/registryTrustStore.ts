import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";
import { Metadata, MetadataKind } from "@tufjs/models";
import type { ExchangeTrustConfiguration } from "./exchangeInstall";
export const DEFAULT_EXCHANGE_ORIGIN = "https://exchange.buildwithtabs.com";
export interface RegistryTrustInput {
  origin: string;
  root: string;
  rootSha256: string;
  trustId: string;
  confirmOrigin: string;
}
interface StoredTrust {
  version: 1;
  origin: string;
  root: string;
  rootSha256: string;
  trustId: string;
}
function assertPublicOnly(value: unknown, depth = 0): void {
  if (depth > 20) throw new Error("Trust file is too deeply nested.");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/private|password|secret|encrypted/i.test(key))
      throw new Error("Only public trust metadata is allowed.");
    assertPublicOnly(child, depth + 1);
  }
}
function validate(value: unknown, fresh: boolean): StoredTrust {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Choose a public trust file and confirm its fingerprint.");
  const item = value as Record<string, unknown>;
  if (
    typeof item.origin !== "string" ||
    typeof item.root !== "string" ||
    typeof item.rootSha256 !== "string" ||
    typeof item.trustId !== "string" ||
    !/^[a-f0-9]{64}$/.test(item.rootSha256) ||
    !/^[a-z0-9-]{1,64}$/.test(item.trustId) ||
    Buffer.byteLength(item.root) > 512 * 1024
  )
    throw new Error("Check the registry address, public trust file, and SHA-256 fingerprint.");
  const url = new URL(item.origin);
  if (url.protocol !== "https:" || url.origin !== item.origin || url.username || url.password)
    throw new Error("Use an HTTPS registry address without a path.");
  if (Crypto.createHash("sha256").update(item.root).digest("hex") !== item.rootSha256)
    throw new Error(
      "The public trust file does not match the fingerprint. Copy it from your registry operator’s release setup.",
    );
  try {
    const parsed = JSON.parse(item.root);
    assertPublicOnly(parsed);
    const root = Metadata.fromJSON(MetadataKind.Root, parsed);
    root.verifyDelegate("root", root);
    if (
      fresh &&
      (!Number.isFinite(Date.parse(root.signed.expires)) ||
        Date.parse(root.signed.expires) <= Date.now())
    )
      throw new Error();
  } catch {
    throw new Error(
      "This public trust file is invalid, unsigned, or expired. Request a current root.json from your registry operator.",
    );
  }
  return {
    version: 1,
    origin: item.origin,
    root: item.root,
    rootSha256: item.rootSha256,
    trustId: item.trustId,
  };
}
/** Public keys only. Catalog responses never establish trust. */
export class RegistryTrustStore {
  private readonly file: string;
  constructor(directory: string) {
    this.file = Path.join(directory, "connection.json");
  }
  read(): StoredTrust | null {
    if (!FS.existsSync(this.file)) return null;
    const stat = FS.lstatSync(this.file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
      throw new Error("Saved Exchange connection is invalid.");
    const stored = JSON.parse(FS.readFileSync(this.file, "utf8"));
    if (stored.version !== 1) throw new Error("Unsupported Exchange connection format.");
    return validate(stored, false);
  }
  configuration(origin: string): ExchangeTrustConfiguration | null {
    const stored = this.read();
    return stored?.origin === origin
      ? { origin, root: Buffer.from(stored.root), trustId: stored.trustId }
      : null;
  }
  save(input: unknown): void {
    const stored = validate(input, true);
    const body = input as RegistryTrustInput;
    if (body.confirmOrigin !== stored.origin)
      throw new Error("Confirm the exact registry address before connecting.");
    const current = this.read();
    if (
      current?.origin === stored.origin &&
      (current.rootSha256 !== stored.rootSha256 || current.trustId !== stored.trustId)
    )
      throw new Error(
        "This registry already has a pinned identity. Signed root rotation is handled by Tabs; a different key cannot replace it here.",
      );
    FS.mkdirSync(Path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${Crypto.randomBytes(12).toString("hex")}.tmp`;
    try {
      FS.writeFileSync(temporary, JSON.stringify(stored), { flag: "wx", mode: 0o600 });
      FS.renameSync(temporary, this.file);
    } finally {
      if (FS.existsSync(temporary)) FS.unlinkSync(temporary);
    }
  }
}
