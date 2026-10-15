import { describe, expect, it } from "vitest";
import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@tabs/contracts";

import { getAppModelOptions, resolveNewDraftModelSeed } from "./modelSelection";
import { deriveEffectiveComposerModelState } from "./composerDraftStore";
import { makeAppModelSelection } from "./modelSelection";
import { getDefaultServerModel, getProviderModels } from "./providerModels";

const copilotProvider: ServerProvider = {
  instanceId: ProviderInstanceId.makeUnsafe("copilot"),
  driver: ProviderDriverKind.make("copilot"),
  displayName: "GitHub Copilot",
  enabled: true,
  installed: true,
  version: "1.0.80",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-21T00:00:00.000Z",
  catalogStatus: "ready",
  catalogSource: "copilot.models.list",
  catalogCheckedAt: "2026-08-21T00:00:00.000Z",
  models: [
    {
      slug: "account-advertised-model",
      name: "Account Advertised Model",
      isCustom: false,
      capabilities: null,
    },
  ],
  slashCommands: [],
  skills: [],
};

describe("Copilot model selection", () => {
  it("uses only the live account catalog", () => {
    const settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providers: {
        ...DEFAULT_UNIFIED_SETTINGS.providers,
        copilot: {
          ...DEFAULT_UNIFIED_SETTINGS.providers.copilot,
          customModels: ["saved-arbitrary-model"],
        },
      },
    };

    expect(
      getAppModelOptions(
        settings,
        [copilotProvider],
        "copilot",
        "removed-or-undiscovered-model",
      ).map((model) => model.slug),
    ).toEqual(["account-advertised-model"]);
  });
});

describe.each(["claudeAgent", "cursor", "grok"] as const)(
  "%s authoritative model catalog",
  (provider) => {
    it("does not replace or augment an empty live catalog", () => {
      const snapshot: ServerProvider = {
        ...copilotProvider,
        instanceId: ProviderInstanceId.makeUnsafe(provider),
        driver: ProviderDriverKind.make(provider),
        displayName: provider,
        catalogStatus: "failed",
        models: [],
      };
      const settings = {
        ...DEFAULT_UNIFIED_SETTINGS,
        providers: {
          ...DEFAULT_UNIFIED_SETTINGS.providers,
          [provider]: {
            ...DEFAULT_UNIFIED_SETTINGS.providers[provider],
            customModels: ["configured-model"],
          },
        },
      };

      expect(getProviderModels([snapshot], provider)).toEqual([]);
      expect(getAppModelOptions(settings, [snapshot], provider, "previous-model")).toEqual([]);
      expect(getDefaultServerModel([snapshot], provider)).toBe("");
    });
  },
);

describe("hidden model filtering", () => {
  const codexSnapshot: ServerProvider = {
    ...copilotProvider,
    instanceId: ProviderInstanceId.makeUnsafe("codex"),
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    models: [
      { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, capabilities: null },
      { slug: "gpt-5.3", name: "GPT-5.3", isCustom: false, capabilities: null },
      { slug: "custom-1", name: "Custom 1", isCustom: true, capabilities: null },
    ],
  };

  it("filters out hidden models while preserving custom models and actively selected models", () => {
    const settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerModelPreferences: {
        codex: {
          hiddenModels: ["gpt-5.3", "custom-1"],
          modelOrder: [],
        },
      },
    };

    // When active model is gpt-5.4
    const options = getAppModelOptions(settings, [codexSnapshot], "codex", "gpt-5.4");
    // gpt-5.3 is hidden; custom-1 is custom so it is never hidden; gpt-5.4 is visible
    expect(options.map((m) => m.slug)).toEqual(["gpt-5.4", "custom-1"]);

    // If active model is gpt-5.3, it is preserved even though it is in hiddenModels
    const optionsWithActiveHidden = getAppModelOptions(
      settings,
      [codexSnapshot],
      "codex",
      "gpt-5.3",
    );
    expect(optionsWithActiveHidden.map((m) => m.slug)).toContain("gpt-5.3");
  });
});

describe("new Codex draft model seed", () => {
  const provider: ServerProvider = {
    ...copilotProvider,
    instanceId: ProviderInstanceId.makeUnsafe("codex"),
    driver: ProviderDriverKind.make("codex"),
  };
  it("drops a stale built-in default once the real catalog is ready", () => {
    expect(
      resolveNewDraftModelSeed("codex", DEFAULT_UNIFIED_SETTINGS, [provider], "gpt-5.4"),
    ).toBeNull();
  });
  it("preserves an explicitly configured custom model", () => {
    const settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providers: {
        ...DEFAULT_UNIFIED_SETTINGS.providers,
        codex: { ...DEFAULT_UNIFIED_SETTINGS.providers.codex, customModels: ["gpt-5.4"] },
      },
    };
    expect(resolveNewDraftModelSeed("codex", settings, [provider], "gpt-5.4")).toBe("gpt-5.4");
  });
  it("does not replace a supported or not-yet-discovered selection", () => {
    expect(resolveNewDraftModelSeed("codex", DEFAULT_UNIFIED_SETTINGS, [], "gpt-5.4")).toBe(
      "gpt-5.4",
    );
    expect(
      resolveNewDraftModelSeed(
        "codex",
        DEFAULT_UNIFIED_SETTINGS,
        [provider],
        "account-advertised-model",
      ),
    ).toBe("account-advertised-model");
  });
});

it("uses the live model only for fresh drafts and leaves existing conversations unchanged", () => {
  const provider: ServerProvider = {
    ...copilotProvider,
    instanceId: ProviderInstanceId.makeUnsafe("codex"),
    driver: ProviderDriverKind.make("codex"),
  };
  const input = {
    draft: null,
    providers: [provider],
    selectedProvider: "codex" as const,
    threadModelSelection: makeAppModelSelection("codex", "gpt-5.4"),
    projectModelSelection: null,
    settings: DEFAULT_UNIFIED_SETTINGS,
  };
  expect(deriveEffectiveComposerModelState({ ...input, isNewThread: true }).selectedModel).toBe(
    "account-advertised-model",
  );
  expect(deriveEffectiveComposerModelState({ ...input, isNewThread: false }).selectedModel).toBe(
    "gpt-5.4",
  );
});
