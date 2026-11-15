import type { SecretReference } from "@tabs/contracts";

/**
 * A secret slot that holds a secret-provider reference instead of a secret. Stores that only keep
 * strings (the OS keychain, the server's secret store) keep the reference as JSON behind this
 * marker; the secret it names stays with its provider and is read when it is used.
 */
const REFERENCE_MARKER = "tabs-secret-reference:";

export function encodeStoredReference(reference: SecretReference): string {
  return `${REFERENCE_MARKER}${JSON.stringify({ provider: reference.provider, reference: reference.reference })}`;
}

/** The reference a stored value holds in place of a secret, or null when it holds a secret. */
export function parseStoredReference(stored: string | null | undefined): SecretReference | null {
  if (!stored?.startsWith(REFERENCE_MARKER)) return null;
  try {
    const value = JSON.parse(stored.slice(REFERENCE_MARKER.length)) as Record<string, unknown>;
    return typeof value.provider === "string" && typeof value.reference === "string"
      ? (value as unknown as SecretReference)
      : null;
  } catch {
    return null;
  }
}
