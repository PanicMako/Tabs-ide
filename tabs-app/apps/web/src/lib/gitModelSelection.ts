import type { ProviderInstanceEntry } from "../providerInstances";

/** Retain a selected custom account when choosing another model on its driver tab. */
export function pickGitProviderInstance(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  driver: string,
  currentId: string,
): ProviderInstanceEntry | undefined {
  const candidates = entries.filter(
    (entry) => entry.driverKind === driver && entry.enabled && entry.isAvailable,
  );
  return (
    candidates.find((entry) => entry.instanceId === currentId) ??
    candidates.find((entry) => entry.isDefault) ??
    candidates[0]
  );
}
