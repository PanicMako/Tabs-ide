import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@tabs/contracts";

/**
 * Build a fully-shaped {@link ServerProvider} for tests. Defaults to a ready,
 * authenticated `codex` instance; pass `instanceId`/`driver` as plain strings
 * (they are branded internally) plus any field overrides.
 */
export function makeTestServerProvider(
  overrides: Partial<Omit<ServerProvider, "instanceId" | "driver">> & {
    instanceId?: string;
    driver?: string;
  } = {},
): ServerProvider {
  const { instanceId, driver, ...rest } = overrides;
  const id = instanceId ?? "codex";
  return {
    instanceId: ProviderInstanceId.makeUnsafe(id),
    driver: ProviderDriverKind.makeUnsafe(driver ?? id),
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "1970-01-01T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...rest,
  };
}
