import { parseBlockedDigestBatch } from "../../../src/publisherBatch.js";

function reason(value: string): string {
  if (!value.trim() || value.length > 2000)
    throw new Error("Enter a reason of 1 to 2000 characters.");
  return value.trim();
}
function digest(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Enter the exact lowercase SHA-256 digest.");
  return value;
}
export function namespaceVerification(
  namespace: string,
  verified: boolean,
  proof: string,
  explanation: string,
) {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(namespace))
    throw new Error("Enter a valid publisher namespace.");
  const body: { verified: boolean; reason: string; proofUrl?: string } = {
    verified,
    reason: reason(explanation),
  };
  if (verified) {
    let url: URL;
    try {
      url = new URL(proof);
    } catch {
      throw new Error("Enter an HTTPS ownership proof URL.");
    }
    if (
      proof.length > 2000 ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error("Ownership proof must be an HTTPS URL without credentials or a fragment.");
    body.proofUrl = url.toString();
  }
  return { path: `/v1/review/namespaces/${namespace}/verification`, body };
}
export function digestBlock(value: string, explanation: string) {
  return {
    path: "/v1/review/blocked-digests",
    body: { digest: digest(value), reason: reason(explanation) },
  };
}
export function digestBlockBatch(value: string) {
  return {
    path: "/v1/review/blocked-digests/batch",
    body: JSON.parse(parseBlockedDigestBatch(value)) as {
      entries: Array<{ digest: string; reason: string }>;
    },
  };
}
export function digestUnblock(value: string, explanation: string) {
  return {
    path: `/v1/review/blocked-digests/${digest(value)}/remove`,
    body: { reason: reason(explanation) },
  };
}
export function blockedDigestEvidence(
  value: unknown,
): Array<{ digest: string; reason: string; createdAt: string }> {
  const entries = (value as { blockedDigests?: unknown } | null)?.blockedDigests;
  if (!Array.isArray(entries) || entries.length > 500)
    throw new Error("Invalid digest blocklist response.");
  const seen = new Set<string>();
  return entries.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.digest) ||
      seen.has(entry.digest) ||
      typeof entry.reason !== "string" ||
      !entry.reason.trim() ||
      entry.reason.length > 2000 ||
      typeof entry.created_at !== "string" ||
      entry.created_at.length > 64 ||
      !/^\d{4}-\d{2}-\d{2}T/.test(entry.created_at) ||
      !Number.isFinite(Date.parse(entry.created_at))
    )
      throw new Error("Invalid digest blocklist evidence.");
    seen.add(entry.digest);
    return {
      digest: entry.digest,
      reason: entry.reason,
      createdAt: new Date(entry.created_at).toISOString(),
    };
  });
}
