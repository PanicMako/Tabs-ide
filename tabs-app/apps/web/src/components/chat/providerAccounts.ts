import type { ServerProvider } from "@tabs/contracts";

export interface ProviderAccountInfo {
  readonly instanceId: string;
  readonly driver: string;
  /** 1 for the first account of a provider, 2 for the next, and so on. */
  readonly ordinal: number;
  /** How many accounts that provider has. */
  readonly total: number;
  readonly isDefault: boolean;
  readonly label: string;
  readonly email: string | undefined;
}

/**
 * Numbers every provider's accounts so the picker can tell them apart. The
 * default instance (id equal to its driver) is always account 1; extra
 * instances follow in the order the server lists them.
 */
export function providerAccounts(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyMap<string, ProviderAccountInfo> {
  const byDriver = new Map<string, ServerProvider[]>();
  for (const provider of providers) {
    if (!provider.enabled) continue;
    const list = byDriver.get(provider.driver) ?? [];
    list.push(provider);
    byDriver.set(provider.driver, list);
  }
  const result = new Map<string, ProviderAccountInfo>();
  for (const [driver, list] of byDriver) {
    const ordered = [
      ...list.filter((provider) => provider.instanceId === driver),
      ...list.filter((provider) => provider.instanceId !== driver),
    ];
    ordered.forEach((provider, index) => {
      result.set(provider.instanceId, {
        instanceId: provider.instanceId,
        driver,
        ordinal: index + 1,
        total: ordered.length,
        isDefault: provider.instanceId === driver,
        label: provider.displayName?.trim() || provider.instanceId,
        email: provider.auth.email,
      });
    });
  }
  return result;
}

/** Extra accounts whose id is not one of the built-in provider ids. */
export function extraAccounts(
  providers: ReadonlyArray<ServerProvider>,
  builtInIds: ReadonlySet<string>,
): ReadonlyArray<ProviderAccountInfo> {
  const accounts = providerAccounts(providers);
  return providers.flatMap((provider) => {
    const info = accounts.get(provider.instanceId);
    return info && !builtInIds.has(provider.instanceId) && builtInIds.has(provider.driver)
      ? [info]
      : [];
  });
}

/** The tab name: the account's own name, numbered quietly only when a provider has several. */
export function accountTitle(baseLabel: string, info: ProviderAccountInfo | undefined): string {
  if (!info || info.total < 2) return baseLabel;
  const name = info.isDefault ? baseLabel : info.label;
  return /\d/.test(name) ? name : `${name} ${info.ordinal}`;
}
