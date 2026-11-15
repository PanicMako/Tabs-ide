import { DEFAULT_SERVER_SETTINGS } from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import { deriveProviderInstanceConfigMap } from "./ProviderInstanceRegistryHydration.ts";

describe("deriveProviderInstanceConfigMap", () => {
  it("synthesizes default instances only for drivers that have one", () => {
    const map = deriveProviderInstanceConfigMap(DEFAULT_SERVER_SETTINGS);
    expect(Object.keys(map)).toContain("pi");
    expect(Object.keys(map)).not.toContain("acpRegistry");
  });

  it("keeps an explicitly configured ACP instance", () => {
    const map = deriveProviderInstanceConfigMap({
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        kiro: { driver: "acpRegistry", displayName: "Kiro", config: { source: "local" } },
      } as unknown as typeof DEFAULT_SERVER_SETTINGS.providerInstances,
    });
    expect(map["kiro" as keyof typeof map]?.driver).toBe("acpRegistry");
  });
});
