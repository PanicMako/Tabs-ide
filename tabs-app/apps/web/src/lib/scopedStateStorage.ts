/**
 * Scoped State Persistence & Serialization Layer for Tabs IDE
 *
 * Provides:
 * - Schema versioning with safe fallback
 * - Set <-> Array serialization/deserialization helpers
 * - Tiered persistence (localStorage for durable drafts, sessionStorage for session state)
 * - Namespaced storage keys: tabs:<tool>:v<version>:<projectId>
 */

export const SCOPED_STORAGE_SCHEMA_VERSION = 1;

export interface PersistedEnvelope<T> {
  schemaVersion: number;
  timestamp: number;
  data: T;
}

/**
 * Converts a Set to a JSON-serializable array.
 */
export function serializeSet<T>(set: ReadonlySet<T> | undefined | null): T[] {
  if (!set || !(set instanceof Set)) {
    return [];
  }
  return Array.from(set);
}

/**
 * Converts an array back into a Set, safely handling invalid/null inputs.
 */
export function deserializeSet<T>(arr: unknown): Set<T> {
  if (!Array.isArray(arr)) {
    return new Set<T>();
  }
  return new Set<T>(arr as T[]);
}

/**
 * Generates a standard namespaced storage key.
 * Example: "tabs:testing:v1:project-123"
 */
export function createScopedStorageKey(
  tool: string,
  projectIdOrKey: string,
  version: number = SCOPED_STORAGE_SCHEMA_VERSION,
): string {
  const sanitizedKey = projectIdOrKey.replace(/[:\s]/g, "_");
  return `tabs:${tool}:v${version}:${sanitizedKey}`;
}

/**
 * Saves state with an envelope containing schemaVersion and timestamp.
 */
export function saveScopedState<T>(
  storage: Storage | undefined,
  key: string,
  data: T,
  schemaVersion: number = SCOPED_STORAGE_SCHEMA_VERSION,
): boolean {
  if (!storage) return false;
  try {
    const envelope: PersistedEnvelope<T> = {
      schemaVersion,
      timestamp: Date.now(),
      data,
    };
    storage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch (error) {
    console.warn(`[scopedStateStorage] Failed to save ${key}:`, error);
    return false;
  }
}

/**
 * Loads state from storage, verifying schemaVersion matches.
 * Returns null if missing, version mismatch, or parse error.
 */
export function loadScopedState<T>(
  storage: Storage | undefined,
  key: string,
  expectedVersion: number = SCOPED_STORAGE_SCHEMA_VERSION,
  validator?: (data: unknown) => data is T,
): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("schemaVersion" in parsed) ||
      !("data" in parsed)
    ) {
      // Discard invalid format
      storage.removeItem(key);
      return null;
    }

    if (parsed.schemaVersion !== expectedVersion) {
      // Schema version mismatch -> discard stale version
      storage.removeItem(key);
      return null;
    }

    if (validator && !validator(parsed.data)) {
      storage.removeItem(key);
      return null;
    }

    return parsed.data as T;
  } catch (error) {
    console.warn(`[scopedStateStorage] Failed to load ${key}:`, error);
    try {
      storage.removeItem(key);
    } catch {}
    return null;
  }
}

/**
 * Safely removes a persisted key.
 */
export function clearScopedState(storage: Storage | undefined, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {}
}
