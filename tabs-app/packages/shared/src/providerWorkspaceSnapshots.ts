import type { ServerProvider, ServerProviderUpdatedPayload } from "@tabs/contracts";

/** Keep the global model/status catalog, but load workspace capabilities on use. */
export function omitProviderWorkspaceSnapshots(
  providers: readonly ServerProvider[],
): ServerProvider[] {
  return providers.map(({ workspaceSnapshots: _snapshots, ...provider }) => provider);
}

export function scopedProviderWorkspaceSnapshots(
  providers: readonly ServerProvider[],
  scope: NonNullable<ServerProviderUpdatedPayload["workspaceSnapshotScope"]>,
): ServerProviderUpdatedPayload {
  const provider = providers.find((candidate) => candidate.instanceId === scope.instanceId);
  return {
    workspaceSnapshotScope: scope,
    providers: provider
      ? [
          {
            ...provider,
            workspaceSnapshots:
              provider.workspaceSnapshots?.filter((snapshot) => snapshot.cwd === scope.cwd) ?? [],
          },
        ]
      : [],
  };
}

/** Omission, an explicit empty snapshot and a removed provider have distinct meanings. */
export function mergeProviderWorkspaceSnapshots(
  previous: readonly ServerProvider[],
  payload: ServerProviderUpdatedPayload & { workspaceSnapshotsOmitted?: boolean | undefined },
): ServerProvider[] {
  const scope = payload.workspaceSnapshotScope;
  if (scope) {
    const next = previous.map((provider) =>
      scope.fresh || provider.instanceId === scope.instanceId
        ? {
            ...provider,
            workspaceSnapshots:
              provider.workspaceSnapshots?.filter((snapshot) => snapshot.cwd !== scope.cwd) ?? [],
          }
        : provider,
    );
    for (const incoming of payload.providers) {
      const index = next.findIndex((provider) => provider.instanceId === incoming.instanceId);
      const merged = {
        ...incoming,
        workspaceSnapshots: [
          ...(index < 0 ? [] : (next[index]!.workspaceSnapshots ?? [])),
          ...(incoming.workspaceSnapshots ?? []),
        ],
      };
      if (index < 0) next.push(merged);
      else next[index] = merged;
    }
    return next;
  }
  if (!payload.workspaceSnapshotsOmitted) return [...payload.providers];
  return payload.providers.map((provider) => {
    const snapshots = previous.find(
      (candidate) => candidate.instanceId === provider.instanceId,
    )?.workspaceSnapshots;
    return snapshots ? { ...provider, workspaceSnapshots: snapshots } : provider;
  });
}
