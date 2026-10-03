import { describe, expect, it } from "vitest";
import type { ProviderOptionSelection, ServerProviderModel } from "@tabs/contracts";
import { createModelCapabilities } from "@tabs/shared/model";
import { getComposerProviderState } from "./composerProviderRegistry";

const CODEX_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gpt-5.4",
    name: "GPT-5.4",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        {
          id: "reasoningEffort",
          label: "Reasoning",
          type: "select",
          options: [
            { id: "xhigh", label: "Extra High" },
            { id: "high", label: "High", isDefault: true },
            { id: "medium", label: "Medium" },
            { id: "low", label: "Low" },
          ],
        },
        { id: "fastMode", label: "Fast Mode", type: "boolean" },
      ],
    }),
  },
];

const CLAUDE_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        {
          id: "effort",
          label: "Reasoning",
          type: "select",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High", isDefault: true },
            { id: "ultrathink", label: "Ultrathink" },
          ],
          promptInjectedValues: ["ultrathink"],
        },
      ],
    }),
  },
  {
    slug: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [{ id: "thinking", label: "Thinking", type: "boolean" }],
    }),
  },
];

const selections = (...entries: Array<ProviderOptionSelection>): Array<ProviderOptionSelection> =>
  entries;

describe("getComposerProviderState", () => {
  it("resolves the default effort and dispatches it as a selection", () => {
    const state = getComposerProviderState({
      provider: "codex",
      model: "gpt-5.4",
      models: CODEX_MODELS,
      prompt: "",
      modelOptions: undefined,
    });

    expect(state.provider).toBe("codex");
    expect(state.promptEffort).toBe("high");
    expect(state.modelOptionsForDispatch).toEqual([{ id: "reasoningEffort", value: "high" }]);
  });

  it("applies a selected effort and carries boolean options through dispatch", () => {
    const state = getComposerProviderState({
      provider: "codex",
      model: "gpt-5.4",
      models: CODEX_MODELS,
      prompt: "",
      modelOptions: selections(
        { id: "reasoningEffort", value: "low" },
        { id: "fastMode", value: true },
      ),
    });

    expect(state.promptEffort).toBe("low");
    expect(state.modelOptionsForDispatch).toEqual([
      { id: "reasoningEffort", value: "low" },
      { id: "fastMode", value: true },
    ]);
  });

  it("resolves Claude effort defaults from descriptors", () => {
    const state = getComposerProviderState({
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
      models: CLAUDE_MODELS,
      prompt: "",
      modelOptions: undefined,
    });

    expect(state.promptEffort).toBe("high");
    expect(state.modelOptionsForDispatch).toEqual([{ id: "effort", value: "high" }]);
  });

  it("activates ultrathink styling when the prompt is prompt-controlled", () => {
    const state = getComposerProviderState({
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
      models: CLAUDE_MODELS,
      prompt: "Ultrathink:\nInvestigate this",
      modelOptions: undefined,
    });

    expect(state.composerFrameClassName).toBe("ultrathink-frame");
    expect(state.modelPickerIconClassName).toBe("ultrathink-chroma");
  });

  it("returns no dispatch options for trait-less providers", () => {
    const state = getComposerProviderState({
      provider: "claudeAgent",
      model: "claude-haiku-4-5",
      models: CLAUDE_MODELS,
      prompt: "",
      modelOptions: undefined,
    });

    expect(state.promptEffort).toBeNull();
    expect(state.modelOptionsForDispatch).toBeUndefined();
  });
});
