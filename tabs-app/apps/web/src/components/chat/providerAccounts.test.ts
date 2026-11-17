import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import { accountTitle, extraAccounts, providerAccounts } from "./providerAccounts";

function provider(instanceId: string, driver: string, extra: Partial<ServerProvider> = {}) {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-03T11:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...extra,
  } as ServerProvider;
}

describe("providerAccounts", () => {
  const providers = [
    provider("codex_work", "codex", {
      displayName: "Work",
      auth: { status: "authenticated", email: "w@x.com" },
    }),
    provider("codex", "codex"),
    provider("cursor", "cursor"),
  ];

  it("numbers the default instance first, then extras", () => {
    const accounts = providerAccounts(providers);
    expect(accounts.get("codex")).toMatchObject({ ordinal: 1, total: 2, isDefault: true });
    expect(accounts.get("codex_work")).toMatchObject({ ordinal: 2, total: 2, label: "Work" });
    expect(accounts.get("cursor")).toMatchObject({ ordinal: 1, total: 1 });
  });

  it("lists only extra accounts of known providers", () => {
    const extras = extraAccounts(providers, new Set(["codex", "cursor"]));
    expect(extras.map((info) => info.instanceId)).toEqual(["codex_work"]);
  });

  it("titles accounts only when a provider has more than one", () => {
    const accounts = providerAccounts(providers);
    expect(accountTitle("Codex", accounts.get("codex"))).toBe("Codex 1");
    expect(accountTitle("Codex", accounts.get("codex_work"))).toBe("Work 2");
    expect(accountTitle("Cursor", accounts.get("cursor"))).toBe("Cursor");
  });
});
