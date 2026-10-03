import { describe, expect, it } from "vitest";
import { ProviderDriverKind, type ModelCapabilities } from "@tabs/contracts";
import { createModelCapabilities } from "@tabs/shared/model";

import { normalizeProviderAuth, providerModelsFromSettings } from "./providerSnapshot";

describe("normalizeProviderAuth", () => {
  it("classifies metered and account credentials through the shared contract", () => {
    expect(
      normalizeProviderAuth({
        status: "authenticated",
        type: "apiKey",
        label: "Provider API Key (usage-based)",
      }),
    ).toMatchObject({
      credentialSource: "api_key",
      billingLabel: "Provider API Key (usage-based)",
    });
    expect(normalizeProviderAuth({ status: "authenticated", type: "oauth" })).toMatchObject({
      credentialSource: "account",
    });
  });
});

const OPENCODE_CUSTOM_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "variant",
      label: "Reasoning",
      type: "select",
      options: [{ id: "medium", label: "Medium", isDefault: true }],
      currentValue: "medium",
    },
    {
      id: "agent",
      label: "Agent",
      type: "select",
      options: [{ id: "build", label: "Build", isDefault: true }],
      currentValue: "build",
    },
  ],
});

describe("providerModelsFromSettings", () => {
  it("applies the provided capabilities to custom models", () => {
    const models = providerModelsFromSettings(
      [],
      "opencode" as ProviderDriverKind,
      ["openai/gpt-5"],
      OPENCODE_CUSTOM_MODEL_CAPABILITIES,
    );

    expect(models).toEqual([
      {
        slug: "openai/gpt-5",
        name: "openai/gpt-5",
        isCustom: true,
        capabilities: OPENCODE_CUSTOM_MODEL_CAPABILITIES,
      },
    ]);
  });
});
