import type { ServerProvider } from "@tabs/contracts";

export interface ProviderUpdateCandidate {
  readonly instanceId: string;
  readonly displayName: string;
  readonly currentVersion: string | null;
  readonly latestVersion: string;
}

export function collectProviderUpdateCandidates(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ProviderUpdateCandidate> {
  return providers
    .filter(
      (provider) =>
        provider.enabled &&
        provider.installed &&
        provider.versionAdvisory?.status === "behind_latest" &&
        Boolean(provider.versionAdvisory.latestVersion),
    )
    .map((provider) => ({
      instanceId: provider.instanceId,
      displayName: provider.displayName?.trim() || provider.driver,
      currentVersion: provider.versionAdvisory?.currentVersion ?? provider.version,
      latestVersion: provider.versionAdvisory!.latestVersion!,
    }))
    .sort((left, right) => left.instanceId.localeCompare(right.instanceId));
}

export function providerUpdateNotificationKey(
  candidates: ReadonlyArray<ProviderUpdateCandidate>,
): string | null {
  if (candidates.length === 0) return null;
  return candidates
    .map((candidate) => `${candidate.instanceId}:${candidate.latestVersion}`)
    .join("|");
}
