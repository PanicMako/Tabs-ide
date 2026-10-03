import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ProviderInstanceId } from "./providerInstance.ts";
import {
  BrowserProfileDefinition,
  ClientSettingsSchema,
  DEFAULT_BROWSER_PROFILES,
  DEFAULT_SERVER_SETTINGS,
  ProjectBrowserSettings,
  ProjectCustomEmbedDefinition,
  ProjectWorkspaceSettings,
  ServerSettings,
  ServerSettingsPatch,
  resolveBrowserPartition,
  ClientSettingsPatch,
} from "./settings.ts";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const encodeServerSettings = Schema.encodeSync(ServerSettings);

describe("ProjectWorkspaceSettings tools", () => {
  it("decodes persisted Testing tools without crashing workspace startup", () => {
    const decodeWorkspaceSettings = Schema.decodeUnknownSync(ProjectWorkspaceSettings);

    expect(
      decodeWorkspaceSettings({
        tools: [{ id: "testing", kind: "testing", label: "Testing", visible: true }],
      }).tools,
    ).toEqual([{ id: "testing", kind: "testing", label: "Testing", visible: true }]);
  });
});

describe("ClientSettings word wrap", () => {
  it("defaults word wrap on", () => {
    expect(decodeClientSettings({}).wordWrap).toBe(true);
  });

  it("ignores obsolete wrapping preferences", () => {
    const decoded = decodeClientSettings({
      chatWordWrap: false,
    });

    expect(decoded.wordWrap).toBe(true);
    expect(decoded).not.toHaveProperty("chatWordWrap");
  });
});

describe("ClientSettings diffColorScheme", () => {
  it("defaults to red-green", () => {
    expect(decodeClientSettings({}).diffColorScheme).toBe("red-green");
  });

  it.each(["red-green", "blue-orange"] as const)("accepts the %s palette", (diffColorScheme) => {
    const settings = decodeClientSettings({ diffColorScheme });
    expect(settings.diffColorScheme).toBe(diffColorScheme);
    expect(decodeClientSettingsPatch({ diffColorScheme }).diffColorScheme).toBe(diffColorScheme);
  });

  it("rejects unknown diff palettes", () => {
    expect(() => decodeClientSettings({ diffColorScheme: "purple-yellow" })).toThrow();
    expect(() => decodeClientSettingsPatch({ diffColorScheme: "purple-yellow" })).toThrow();
  });
});

describe("ClientSettings motion and panel animations", () => {
  it("defaults panelAnimationDurationMs to 150 and reducedMotion to system", () => {
    const settings = decodeClientSettings({});
    expect(settings.panelAnimationDurationMs).toBe(150);
    expect(settings.reducedMotion).toBe("system");
  });

  it("accepts valid panelAnimationDurationMs within 0-400ms", () => {
    const settings = decodeClientSettings({ panelAnimationDurationMs: 250 });
    expect(settings.panelAnimationDurationMs).toBe(250);
    expect(
      decodeClientSettingsPatch({ panelAnimationDurationMs: 0 }).panelAnimationDurationMs,
    ).toBe(0);
  });

  it("rejects panelAnimationDurationMs out of bounds", () => {
    expect(() => decodeClientSettings({ panelAnimationDurationMs: -1 })).toThrow();
    expect(() => decodeClientSettings({ panelAnimationDurationMs: 450 })).toThrow();
  });

  it.each(["system", "always", "never"] as const)("accepts reducedMotion mode %s", (mode) => {
    expect(decodeClientSettings({ reducedMotion: mode }).reducedMotion).toBe(mode);
    expect(decodeClientSettingsPatch({ reducedMotion: mode }).reducedMotion).toBe(mode);
  });
});

describe("ClientSettings typography and environment themes", () => {
  it("defaults font sizes and empty font families", () => {
    const settings = decodeClientSettings({});
    expect(settings.fontSizeInterface).toBe(13);
    expect(settings.fontSizeCode).toBe(12);
    expect(settings.fontSizePrompt).toBe(13);
    expect(settings.fontFamilySans).toBe("");
    expect(settings.fontFamilyCode).toBe("");
    expect(settings.fontFamilyComposer).toBe("");
    expect(settings.environmentThemeOverrides).toEqual({});
  });

  it("accepts custom font settings and environment theme overrides", () => {
    const patch = {
      fontFamilySans: "Inter",
      fontFamilyCode: "JetBrains Mono",
      fontSizeInterface: 14,
      fontSizeCode: 13,
      environmentThemeOverrides: { "env-prod": "tabs-dark" },
    };
    const settings = decodeClientSettings(patch);
    expect(settings.fontFamilySans).toBe("Inter");
    expect(settings.fontFamilyCode).toBe("JetBrains Mono");
    expect(settings.fontSizeInterface).toBe(14);
    expect(settings.fontSizeCode).toBe(13);
    expect(settings.environmentThemeOverrides).toEqual({ "env-prod": "tabs-dark" });
  });
});

describe("ClientSettings startup animation", () => {
  it("defaults the legacy startup hold preference to two seconds", () => {
    expect(decodeClientSettings({}).splashMinimumHoldSeconds).toBe(2);
  });

  it.each([0, 1, 2, 3] as const)("accepts a %s second minimum hold", (seconds) => {
    expect(
      decodeClientSettings({ splashMinimumHoldSeconds: seconds }).splashMinimumHoldSeconds,
    ).toBe(seconds);
  });

  it("rejects unsupported minimum holds", () => {
    expect(() => decodeClientSettings({ splashMinimumHoldSeconds: 4 })).toThrow();
  });
});

describe("ServerSettings.providerInstances (slice-2 invariant)", () => {
  it("defaults to an empty record so legacy configs without the key still decode", () => {
    expect(DEFAULT_SERVER_SETTINGS.providerInstances).toEqual({});
  });

  it("decodes a fully empty config (legacy on-disk shape) without complaint", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.providerInstances).toEqual({});
    // Legacy `providers` struct is still hydrated with its per-driver defaults
    // so existing call sites keep working through the migration.
    expect(decoded.providers.codex.enabled).toBe(true);
  });

  it("decodes a multi-instance map mixing first-party and fork drivers", () => {
    const decoded = decodeServerSettings({
      providerInstances: {
        codex_personal: {
          driver: "codex",
          displayName: "Codex (personal)",
          config: { homePath: "~/.codex_personal" },
        },
        codex_work: {
          driver: "codex",
          config: { homePath: "~/.codex_work" },
        },
        ollama_local: {
          driver: "ollama",
          displayName: "Ollama (local)",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const personalId = ProviderInstanceId.make("codex_personal");
    const workId = ProviderInstanceId.make("codex_work");
    const ollamaId = ProviderInstanceId.make("ollama_local");

    expect(decoded.providerInstances[personalId]?.driver).toBe("codex");
    expect(decoded.providerInstances[workId]?.config).toEqual({ homePath: "~/.codex_work" });
    // Critical: a config naming a driver this build does not know about
    // (`ollama` is not in `ProviderDriverKind`) must round-trip without loss.
    // The runtime handles "driver not installed" — the schema must not.
    expect(decoded.providerInstances[ollamaId]?.driver).toBe("ollama");
    expect(decoded.providerInstances[ollamaId]?.config).toEqual({
      endpoint: "http://localhost:11434",
    });
  });

  it("rejects instance keys that violate the slug pattern", () => {
    expect(() =>
      decodeServerSettings({
        providerInstances: { "1bad": { driver: "codex" } },
      }),
    ).toThrow();
  });
});

describe("ServerSettings worktree defaults", () => {
  it("defaults start-from-origin off for legacy configs", () => {
    expect(decodeServerSettings({}).newWorktreesStartFromOrigin).toBe(false);
  });

  it("accepts start-from-origin updates", () => {
    expect(
      decodeServerSettingsPatch({ newWorktreesStartFromOrigin: true }).newWorktreesStartFromOrigin,
    ).toBe(true);
  });
});

describe("ServerSettingsPatch.providerInstances", () => {
  it("treats providerInstances as an optional whole-map replacement", () => {
    const patch = decodeServerSettingsPatch({});
    expect(patch.providerInstances).toBeUndefined();

    const replacement = decodeServerSettingsPatch({
      providerInstances: {
        codex_personal: { driver: "codex", config: { homePath: "~/.codex" } },
      },
    });
    expect(replacement.providerInstances).toBeDefined();
    expect(replacement.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
  });

  it("preserves a fork-defined driver entry through patch decoding", () => {
    const patch = decodeServerSettingsPatch({
      providerInstances: {
        ollama_local: {
          driver: "ollama",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const ollamaId = ProviderInstanceId.make("ollama_local");
    expect(patch.providerInstances?.[ollamaId]?.driver).toBe("ollama");
  });
});

describe("ServerSettingsPatch string normalization", () => {
  it("trims string settings while decoding patches", () => {
    const patch = decodeServerSettingsPatch({
      addProjectBaseDirectory: "  ~/Development  ",
      textGenerationModelSelection: { model: "  gpt-5.4-mini  " },
      observability: {
        otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
      },
      providers: {
        codex: {
          binaryPath: "  /opt/homebrew/bin/codex  ",
          homePath: "  ~/.codex  ",
        },
      },
      providerInstances: {
        codex_personal: {
          driver: "  codex  ",
          displayName: "  Codex Personal  ",
          config: { homePath: "  ~/.codex-personal  " },
        },
      },
    });

    expect(patch.addProjectBaseDirectory).toBe("~/Development");
    expect(patch.textGenerationModelSelection?.model).toBe("gpt-5.4-mini");
    expect(patch.observability?.otlpTracesUrl).toBe("http://localhost:4318/v1/traces");
    expect(patch.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(patch.providers?.codex?.homePath).toBe("~/.codex");
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.displayName).toBe(
      "Codex Personal",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.config).toEqual({
      homePath: "  ~/.codex-personal  ",
    });
  });

  it("trims encoded server settings values before validation", () => {
    const defaultSettings = decodeServerSettings({});
    const encoded = encodeServerSettings({
      ...defaultSettings,
      addProjectBaseDirectory: "  ~/Development  ",
      providers: {
        ...defaultSettings.providers,
        codex: {
          ...defaultSettings.providers.codex,
          binaryPath: "  /opt/homebrew/bin/codex  ",
        },
      },
    });

    expect(encoded.addProjectBaseDirectory).toBe("~/Development");
    expect(encoded.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
  });

  it("encodes provider secrets as empty write-only values", () => {
    const settings = decodeServerSettings({
      providers: {
        copilot: { token: "copilot-token", byokApiKey: "copilot-byok-key" },
        gemini: { apiKey: "gemini-key" },
        opencode: { serverPassword: "opencode-password" },
        kilo: { serverPassword: "kilo-password" },
      },
    });
    const encoded = encodeServerSettings(settings);

    expect(encoded.providers?.copilot?.token).toBe("");
    expect(encoded.providers?.copilot?.byokApiKey).toBe("");
    expect(encoded.providers?.gemini?.apiKey).toBe("");
    expect(encoded.providers?.opencode?.serverPassword).toBe("");
    expect(encoded.providers?.kilo?.serverPassword).toBe("");
  });
});

describe("Browser Session Partitioning", () => {
  it("resolves default shared partition per project", () => {
    expect(
      resolveBrowserPartition({
        projectId: "proj-123",
      }),
    ).toBe("persist:tabs-browser:proj-123");

    expect(
      resolveBrowserPartition({
        projectId: "proj-123",
        partitionMode: "shared",
      }),
    ).toBe("persist:tabs-browser:proj-123");
  });

  it("resolves isolated partition per tab/embed session", () => {
    expect(
      resolveBrowserPartition({
        projectId: "proj-123",
        sessionId: "custom-figma",
        partitionMode: "isolated",
      }),
    ).toBe("persist:tabs-browser:proj-123:custom-figma");

    expect(
      resolveBrowserPartition({
        projectId: "proj-123",
        partitionMode: "isolated",
      }),
    ).toBe("persist:tabs-browser:proj-123:browser");
  });

  it("resolves named profile partition across tabs/projects", () => {
    expect(
      resolveBrowserPartition({
        projectId: "proj-123",
        sessionId: "custom-figma",
        partitionMode: "profile",
        partitionProfile: "work",
      }),
    ).toBe("persist:tabs-browser:profile:work");

    expect(
      resolveBrowserPartition({
        projectId: "proj-456",
        partitionMode: "profile",
        partitionProfile: "personal",
      }),
    ).toBe("persist:tabs-browser:profile:personal");

    expect(
      resolveBrowserPartition({
        projectId: "proj-123",
        partitionMode: "profile",
        partitionProfile: "   ",
      }),
    ).toBe("persist:tabs-browser:profile:default");
  });

  it("decodes ProjectBrowserSettings and ProjectCustomEmbedDefinition with partition defaults", () => {
    const decodeBrowser = Schema.decodeUnknownSync(ProjectBrowserSettings);
    const decodeEmbed = Schema.decodeUnknownSync(ProjectCustomEmbedDefinition);

    const defaultBrowser = decodeBrowser({});
    expect(defaultBrowser.partitionMode).toBe("shared");
    expect(defaultBrowser.partitionProfile).toBeUndefined();

    const customBrowser = decodeBrowser({
      partitionMode: "profile",
      partitionProfile: "work-profile",
    });
    expect(customBrowser.partitionMode).toBe("profile");
    expect(customBrowser.partitionProfile).toBe("work-profile");

    const defaultEmbed = decodeEmbed({
      id: "embed-1",
      label: "Figma",
      url: "https://figma.com",
    });
    expect(defaultEmbed.partitionMode).toBe("shared");

    const isolatedEmbed = decodeEmbed({
      id: "embed-2",
      label: "ChatGPT",
      url: "https://chatgpt.com",
      partitionMode: "isolated",
    });
    expect(isolatedEmbed.partitionMode).toBe("isolated");
  });

  it("decodes ClientSettings with default and custom browserProfiles", () => {
    const settings = decodeClientSettings({});
    expect(settings.browserProfiles).toEqual(DEFAULT_BROWSER_PROFILES);

    const customSettings = decodeClientSettings({
      browserProfiles: [
        {
          id: "client-a",
          label: "Client Alpha",
          color: "#8b5cf6",
          description: "Staging and linear accounts",
          createdAt: 123456789,
        },
      ],
    });
    expect(customSettings.browserProfiles).toHaveLength(1);
    expect(customSettings.browserProfiles[0]?.id).toBe("client-a");
    expect(customSettings.browserProfiles[0]?.label).toBe("Client Alpha");
    expect(customSettings.browserProfiles[0]?.color).toBe("#8b5cf6");
  });
});

describe("ClientSettings onboardingCompletedAt", () => {
  it("defaults to null", () => {
    const settings = decodeClientSettings({});
    expect(settings.onboardingCompletedAt).toBeNull();
  });

  it("decodes valid ISO timestamp string", () => {
    const timestamp = "2026-09-12T00:00:00.000Z";
    const settings = decodeClientSettings({ onboardingCompletedAt: timestamp });
    expect(settings.onboardingCompletedAt).toBe(timestamp);
  });

  it("allows setting and resetting via ClientSettingsPatch", () => {
    const patch = decodeClientSettingsPatch({
      onboardingCompletedAt: "2026-09-12T00:00:00.000Z",
    });
    expect(patch.onboardingCompletedAt).toBe("2026-09-12T00:00:00.000Z");

    const resetPatch = decodeClientSettingsPatch({
      onboardingCompletedAt: null,
    });
    expect(resetPatch.onboardingCompletedAt).toBeNull();
  });
});

describe("Browser resumeLastVisitedPage defaults and migrations", () => {
  const decodeBrowser = Schema.decodeSync(ProjectBrowserSettings);
  const decodeEmbed = Schema.decodeSync(ProjectCustomEmbedDefinition);

  it("defaults resumeLastVisitedPage to true for standard project browser", () => {
    const browser = decodeBrowser({});
    expect(browser.resumeLastVisitedPage).toBe(true);
  });

  it("defaults resumeLastVisitedPage to true for newly created or legacy custom embeds without the field", () => {
    const legacyEmbed = decodeEmbed({
      id: "embed-legacy",
      label: "Legacy Tab",
      url: "https://example.com",
    });
    expect(legacyEmbed.resumeLastVisitedPage).toBe(true);
  });

  it("preserves explicit false for custom embeds", () => {
    const optOutEmbed = decodeEmbed({
      id: "embed-opt-out",
      label: "Opt Out Tab",
      url: "https://example.com",
      resumeLastVisitedPage: false,
    });
    expect(optOutEmbed.resumeLastVisitedPage).toBe(false);
  });

  it("preserves explicit true for custom embeds", () => {
    const optInEmbed = decodeEmbed({
      id: "embed-opt-in",
      label: "Opt In Tab",
      url: "https://example.com",
      resumeLastVisitedPage: true,
    });
    expect(optInEmbed.resumeLastVisitedPage).toBe(true);
  });
});
