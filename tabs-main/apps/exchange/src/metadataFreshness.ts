export interface StoredMetadataRow {
  readonly name: string;
  readonly bytes: Buffer;
}

export interface MetadataFreshness {
  readonly role: "root" | "timestamp" | "snapshot" | "targets";
  readonly status: "missing" | "invalid" | "expired" | "expiring" | "valid";
  readonly expiresAt: string | null;
}

const ROLES = ["root", "timestamp", "snapshot", "targets"] as const;
const WARNING_WINDOW_MS = 48 * 60 * 60 * 1_000;

/** Advisory only: publication verifies signatures; this reads stored expiry fields. */
export function metadataFreshness(
  rows: ReadonlyArray<StoredMetadataRow>,
  now = Date.now(),
): ReadonlyArray<MetadataFreshness> {
  const byName = new Map(rows.map((row) => [row.name, row.bytes]));
  return ROLES.map((role) => {
    const bytes = byName.get(`${role}.json`);
    if (!bytes) return { role, status: "missing", expiresAt: null };
    try {
      const parsed: unknown = JSON.parse(bytes.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || !("signed" in parsed)) {
        throw new Error("Missing signed metadata.");
      }
      const signed = parsed.signed;
      if (
        !signed ||
        typeof signed !== "object" ||
        !("_type" in signed) ||
        signed._type !== role ||
        !("expires" in signed) ||
        typeof signed.expires !== "string"
      ) {
        throw new Error("Invalid signed metadata expiry.");
      }
      const expiry = Date.parse(signed.expires);
      if (!Number.isFinite(expiry)) throw new Error("Invalid signed metadata date.");
      return {
        role,
        status:
          expiry <= now ? "expired" : expiry <= now + WARNING_WINDOW_MS ? "expiring" : "valid",
        expiresAt: new Date(expiry).toISOString(),
      };
    } catch {
      return { role, status: "invalid", expiresAt: null };
    }
  });
}
