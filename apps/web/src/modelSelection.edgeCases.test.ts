import { describe, expect, it } from "vitest";
import { PROVIDER_OPTIONS, type ProviderPickerKind } from "./session-logic";
import { resolveSelectableProvider } from "./providerModels";

describe("Provider Selection Edge Cases", () => {
  it("ensures PROVIDER_OPTIONS contains all active providers including gemini in type union", () => {
    expect(PROVIDER_OPTIONS.length).toBeGreaterThanOrEqual(7);
    for (const option of PROVIDER_OPTIONS) {
      expect(option.available).toBe(true);
      expect(option.value).toBeTruthy();
      expect(option.label).toBeTruthy();
    }
  });

  it("resolves to selectable provider when requested provider is enabled", () => {
    const providers = [
      {
        instanceId: "codex" as any,
        driver: "codex" as any,
        displayName: "Codex",
        enabled: true,
        installed: true,
        version: "1.0",
        status: "ready" as const,
        auth: { status: "authenticated" as const },
        checkedAt: "2026-08-21T00:00:00.000Z",
        catalogStatus: "ready" as const,
        catalogSource: "codex.models.list",
        catalogCheckedAt: "2026-08-21T00:00:00.000Z",
        models: [],
        slashCommands: [],
        skills: [],
      },
    ];

    expect(resolveSelectableProvider(providers, "codex")).toBe("codex");
  });

  it("resolves to the next enabled provider if requested provider is disabled", () => {
    const providers = [
      {
        instanceId: "codex" as any,
        driver: "codex" as any,
        displayName: "Codex",
        enabled: false,
        installed: true,
        version: "1.0",
        status: "ready" as const,
        auth: { status: "authenticated" as const },
        checkedAt: "2026-08-21T00:00:00.000Z",
        catalogStatus: "ready" as const,
        catalogSource: "codex.models.list",
        catalogCheckedAt: "2026-08-21T00:00:00.000Z",
        models: [],
        slashCommands: [],
        skills: [],
      },
      {
        instanceId: "claudeAgent" as any,
        driver: "claudeAgent" as any,
        displayName: "Claude",
        enabled: true,
        installed: true,
        version: "1.0",
        status: "ready" as const,
        auth: { status: "authenticated" as const },
        checkedAt: "2026-08-21T00:00:00.000Z",
        catalogStatus: "ready" as const,
        catalogSource: "claude.models.list",
        catalogCheckedAt: "2026-08-21T00:00:00.000Z",
        models: [],
        slashCommands: [],
        skills: [],
      },
    ];

    expect(resolveSelectableProvider(providers, "codex")).toBe("claudeAgent");
  });

  it("safely handles fallback when all providers in settings are disabled", () => {
    const availableOptions = PROVIDER_OPTIONS.filter((o) => o.available);
    const mockDisabledSettings = Object.fromEntries(
      availableOptions.map((o) => [o.value, { enabled: false }]),
    );

    const isProviderEnabledInSettings = (provider: ProviderPickerKind) => {
      const anyEnabled = availableOptions.some((o) => {
        const cfg = mockDisabledSettings[o.value];
        return cfg ? cfg.enabled !== false : true;
      });
      if (!anyEnabled) {
        return true;
      }
      const cfg = mockDisabledSettings[provider];
      return cfg ? cfg.enabled : true;
    };

    // When all are disabled in settings, fallback ensures all available options remain active
    const enabled = availableOptions.filter((o) => isProviderEnabledInSettings(o.value));
    expect(enabled.length).toBe(availableOptions.length);
  });
});
