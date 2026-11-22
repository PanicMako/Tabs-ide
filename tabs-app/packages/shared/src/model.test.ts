import { describe, expect, it } from "vitest";
import { isReasoningSelectDescriptor } from "./model.ts";
import {
  DEFAULT_MODEL,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelCapabilities,
} from "@tabs/contracts";

import {
  applyClaudePromptEffortPrefix,
  buildProviderOptionSelectionsFromDescriptors,
  createModelCapabilities,
  createModelSelection,
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionDescriptors,
  getProviderOptionBooleanSelectionValue,
  getProviderOptionStringSelectionValue,
  isClaudeUltrathinkPrompt,
  splitClaudeUltrathinkPrefix,
  normalizeModelSlug,
  resolveModelSlugForProvider,
  resolveSelectableModel,
  trimOrNull,
} from "./model";

const codexCaps: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "xhigh", label: "Extra High" },
        { id: "high", label: "High", isDefault: true },
      ],
      currentValue: "high",
    },
    {
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
    },
  ],
});

const claudeCaps: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "medium", label: "Medium" },
        { id: "high", label: "High", isDefault: true },
        { id: "ultrathink", label: "Ultrathink" },
      ],
      currentValue: "high",
      promptInjectedValues: ["ultrathink"],
    },
    {
      id: "contextWindow",
      label: "Context Window",
      type: "select",
      options: [
        { id: "200k", label: "200k" },
        { id: "1m", label: "1M", isDefault: true },
      ],
      currentValue: "1m",
    },
  ],
});

describe("normalizeModelSlug", () => {
  it("maps known aliases to canonical slugs", () => {
    const claude = "claudeAgent" as ProviderDriverKind;
    expect(normalizeModelSlug("gpt-5-codex")).toBe("gpt-5.4");
    expect(normalizeModelSlug("5.3")).toBe("gpt-5.3-codex");
    expect(normalizeModelSlug("sonnet", claude)).toBe("claude-sonnet-5");
  });

  it("returns null for empty or missing values", () => {
    expect(normalizeModelSlug("")).toBeNull();
    expect(normalizeModelSlug("   ")).toBeNull();
    expect(normalizeModelSlug(null)).toBeNull();
    expect(normalizeModelSlug(undefined)).toBeNull();
  });
});

describe("resolveModelSlugForProvider", () => {
  it("returns defaults when the model is missing", () => {
    expect(resolveModelSlugForProvider("codex" as ProviderDriverKind, undefined)).toBe(
      DEFAULT_MODEL,
    );
    expect(resolveModelSlugForProvider("ollama" as ProviderDriverKind, undefined)).toBe(
      DEFAULT_MODEL,
    );
    expect(resolveModelSlugForProvider("grok" as ProviderDriverKind, undefined)).toBe("grok-build");
  });

  it("preserves normalized unknown models", () => {
    expect(
      resolveModelSlugForProvider("codex" as ProviderDriverKind, "custom/internal-model"),
    ).toBe("custom/internal-model");
  });
});

describe("resolveSelectableModel", () => {
  it("resolves exact slugs, labels, and aliases", () => {
    const options = [
      { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
      { slug: "claude-sonnet-5", name: "Claude Sonnet 5" },
    ];
    expect(resolveSelectableModel("codex" as ProviderDriverKind, "gpt-5.3-codex", options)).toBe(
      "gpt-5.3-codex",
    );
    expect(resolveSelectableModel("codex" as ProviderDriverKind, "gpt-5.3 codex", options)).toBe(
      "gpt-5.3-codex",
    );
    expect(resolveSelectableModel("claudeAgent" as ProviderDriverKind, "sonnet", options)).toBe(
      "claude-sonnet-5",
    );
  });
});

describe("misc helpers", () => {
  it("detects ultrathink prompts", () => {
    expect(isClaudeUltrathinkPrompt("Please ultrathink about this")).toBe(true);
    expect(isClaudeUltrathinkPrompt("Ultrathink:\nInvestigate")).toBe(true);
    expect(isClaudeUltrathinkPrompt("Investigate")).toBe(false);
  });

  it("splits the ultrathink line from the prompt under it", () => {
    expect(splitClaudeUltrathinkPrefix("Ultrathink:\n/overmind ship it")).toEqual({
      prefix: "Ultrathink:\n",
      body: "/overmind ship it",
    });
    expect(splitClaudeUltrathinkPrefix("  ultrathink:  /overmind").body).toBe("/overmind");
    expect(splitClaudeUltrathinkPrefix("Ultrathink:\n\nkeep the blank line").body).toBe(
      "\nkeep the blank line",
    );
    expect(splitClaudeUltrathinkPrefix("Please ultrathink: x")).toEqual({
      prefix: "",
      body: "Please ultrathink: x",
    });
  });

  it("prefixes ultrathink prompts once", () => {
    expect(applyClaudePromptEffortPrefix("Investigate", "ultrathink")).toBe(
      "Ultrathink:\nInvestigate",
    );
    expect(applyClaudePromptEffortPrefix("Ultrathink:\nInvestigate", "ultrathink")).toBe(
      "Ultrathink:\nInvestigate",
    );
  });

  it("trims strings to null", () => {
    expect(trimOrNull("  hi  ")).toBe("hi");
    expect(trimOrNull("   ")).toBeNull();
  });
});

describe("descriptor helpers", () => {
  it("applies selection values to capability descriptors", () => {
    expect(
      getProviderOptionDescriptors({
        caps: claudeCaps,
        selections: [
          { id: "effort", value: "medium" },
          { id: "contextWindow", value: "200k" },
        ],
      }),
    ).toEqual([
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [
          { id: "medium", label: "Medium" },
          { id: "high", label: "High", isDefault: true },
          { id: "ultrathink", label: "Ultrathink" },
        ],
        currentValue: "medium",
        promptInjectedValues: ["ultrathink"],
      },
      {
        id: "contextWindow",
        label: "Context Window",
        type: "select",
        options: [
          { id: "200k", label: "200k" },
          { id: "1m", label: "1M", isDefault: true },
        ],
        currentValue: "200k",
      },
    ]);
  });

  it("builds wire-format option selections from descriptors", () => {
    const descriptors = getProviderOptionDescriptors({
      caps: codexCaps,
      selections: [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: true },
      ],
    });

    expect(buildProviderOptionSelectionsFromDescriptors(descriptors)).toEqual([
      { id: "reasoningEffort", value: "high" },
      { id: "fastMode", value: true },
    ]);
  });

  it("stores option selection arrays in model selections", () => {
    expect(
      createModelSelection("codex" as ProviderInstanceId, "gpt-5.4", [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: true },
      ]),
    ).toEqual({
      instanceId: "codex",
      model: "gpt-5.4",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: true },
      ],
    });
  });

  it("reads typed option selection values", () => {
    const selection = createModelSelection("codex" as ProviderInstanceId, "gpt-5.4", [
      { id: "reasoningEffort", value: "high" },
      { id: "fastMode", value: true },
    ]);

    expect(getProviderOptionStringSelectionValue(selection.options, "reasoningEffort")).toBe(
      "high",
    );
    expect(getProviderOptionStringSelectionValue(selection.options, "fastMode")).toBeUndefined();
    expect(getProviderOptionBooleanSelectionValue(selection.options, "fastMode")).toBe(true);
    expect(
      getProviderOptionBooleanSelectionValue(selection.options, "reasoningEffort"),
    ).toBeUndefined();
    expect(getModelSelectionStringOptionValue(selection, "reasoningEffort")).toBe("high");
    expect(getModelSelectionBooleanOptionValue(selection, "fastMode")).toBe(true);
  });
});

describe("isReasoningSelectDescriptor", () => {
  const select = (id: string, role?: "reasoning") =>
    ({
      id,
      label: id,
      type: "select",
      options: [{ id: "low", label: "Low" }],
      ...(role ? { role } : {}),
    }) as const;

  it("accepts the agent-marked role and conventional ids, and rejects other options", () => {
    expect(isReasoningSelectDescriptor(select("thought_level", "reasoning"))).toBe(true);
    for (const id of ["effort", "reasoningEffort", "variant", "thought_level", "thinking"]) {
      expect(isReasoningSelectDescriptor(select(id))).toBe(true);
    }
    expect(isReasoningSelectDescriptor(select("tone"))).toBe(false);
    expect(isReasoningSelectDescriptor({ id: "effort", label: "x", type: "boolean" })).toBe(false);
  });
});
