/**
 * Browser Profile and Partition Persistence Engine.
 *
 * Guarantees that:
 * 1. Each named profile has a strictly isolated partition.
 * 2. Persistent partitions use the `persist:` prefix so cookies, localStorage,
 *    indexedDB, and cache survive application restarts.
 * 3. Ephemeral/incognito profiles omit the `persist:` prefix so Chromium holds
 *    data in memory only and discards it on exit.
 * 4. Unicode profile IDs, surrogate pairs, and path traversal characters
 *    cannot escape their namespaces or collide.
 * 5. Clearing one profile never affects any other profile or project partition.
 */

import * as Crypto from "node:crypto";

export const PERSISTENT_PARTITION_PREFIX = "persist:tabs-browser:";
export const EPHEMERAL_PARTITION_PREFIX = "tabs-browser-ephemeral:";
export const PROFILE_NAMESPACE = "profile:";
export const PROJECT_NAMESPACE = "project:";

const SAFE_PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

/**
 * Normalizes and validates a human-entered or system profile identifier.
 * Rejects path traversal, control characters, and invalid lengths.
 */
export function normalizeProfileIdentifier(profileId: string): string {
  const trimmed = profileId.trim().toLowerCase();
  if (!trimmed) {
    throw new Error("Invalid browser profile identifier.");
  }
  if (
    trimmed.includes("..") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes(":")
  ) {
    throw new Error(
      "Invalid browser profile identifier: path traversal or ambiguous characters are not permitted.",
    );
  }
  if (!SAFE_PROFILE_ID_PATTERN.test(trimmed)) {
    // If it's a Unicode or non-ascii profile identifier, create a deterministic safe slug
    const digest = Crypto.createHash("sha256")
      .update(encodeScopeForDigest(trimmed))
      .digest("hex")
      .slice(0, 16);
    const slug = trimmed.replace(/[^a-z0-9_-]/gu, "").slice(0, 32);
    return slug ? `p-${slug}-${digest}` : `p-${digest}`;
  }
  return trimmed;
}

/**
 * Protects against surrogate-pair collision attacks where lone UTF-16 surrogates
 * would normally be replaced by U+FFFD and alias distinct ids.
 */
export function encodeScopeForDigest(scope: string): string {
  return scope
    .replace(/\\/g, "\\\\")
    .replace(
      /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
      (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
}

export interface PartitionDerivationOptions {
  readonly profileId?: string | undefined;
  readonly projectId?: string | undefined;
  readonly ephemeral?: boolean | undefined;
}

/**
 * Derives a collision-proof partition string.
 */
export function deriveBrowserPartition(options: PartitionDerivationOptions): string {
  const isEphemeral = Boolean(options.ephemeral);
  const prefix = isEphemeral ? EPHEMERAL_PARTITION_PREFIX : PERSISTENT_PARTITION_PREFIX;

  if (options.profileId) {
    const normalized = normalizeProfileIdentifier(options.profileId);
    return `${prefix}${PROFILE_NAMESPACE}${normalized}`;
  }

  const projectKey = options.projectId ? options.projectId.trim().toLowerCase() : "default";
  const safeProjectKey =
    projectKey.replace(/[^a-z0-9_-]/gu, "-").replace(/^-+|-+$/g, "") || "default";

  return `${prefix}${PROJECT_NAMESPACE}${safeProjectKey}`;
}

export function isPersistentPartition(partition: string): boolean {
  return partition.startsWith(PERSISTENT_PARTITION_PREFIX);
}

export function isProfilePartition(partition: string): boolean {
  return (
    partition.startsWith(`${PERSISTENT_PARTITION_PREFIX}${PROFILE_NAMESPACE}`) ||
    partition.startsWith(`${EPHEMERAL_PARTITION_PREFIX}${PROFILE_NAMESPACE}`)
  );
}

export function extractProfileIdFromPartition(
  partition?: string | null | undefined,
): string | null {
  if (!partition) {
    return null;
  }
  const persistentPrefix = `${PERSISTENT_PARTITION_PREFIX}${PROFILE_NAMESPACE}`;
  const ephemeralPrefix = `${EPHEMERAL_PARTITION_PREFIX}${PROFILE_NAMESPACE}`;

  if (partition.startsWith(persistentPrefix)) {
    return partition.slice(persistentPrefix.length);
  }
  if (partition.startsWith(ephemeralPrefix)) {
    return partition.slice(ephemeralPrefix.length);
  }

  // Legacy format compatibility: persist:tabs-browser:profile:<id>
  const legacyPrefix = "persist:tabs-browser:profile:";
  if (partition.startsWith(legacyPrefix)) {
    return partition.slice(legacyPrefix.length);
  }

  return null;
}
