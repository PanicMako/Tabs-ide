import { describe, expect, it } from "vitest";
import type { ProviderOptionDescriptor } from "@tabs/contracts";
import { applyClaudePromptEffortPrefix } from "@tabs/shared/model";
import {
  collectReasoningChoices,
  formatThinkingHeaderWords,
  getReasoningChoiceRank,
  sortReasoningChoices,
} from "./reasoningOrdering";

describe("reasoningOrdering", () => {
  describe("formatThinkingHeaderWords", () => {
    it("splits compound terms into two lines", () => {
      expect(formatThinkingHeaderWords({ id: "ultrathink", label: "Ultrathink" })).toEqual([
        "ULTRA",
        "THINK",
      ]);
      expect(formatThinkingHeaderWords({ id: "ultracode", label: "Ultracode" })).toEqual([
        "ULTRA",
        "CODE",
      ]);
      expect(formatThinkingHeaderWords({ id: "ultracoder", label: "Ultracoder" })).toEqual([
        "ULTRA",
        "CODER",
      ]);
      expect(formatThinkingHeaderWords({ id: "xhigh", label: "Extra High" })).toEqual([
        "EXTRA",
        "HIGH",
      ]);
      expect(formatThinkingHeaderWords({ id: "xhigh", label: "xhigh" })).toEqual(["EXTRA", "HIGH"]);
      expect(
        formatThinkingHeaderWords({ id: "instantthinking", label: "instantthinking" }),
      ).toEqual(["INSTANT", "THINK"]);
      expect(
        formatThinkingHeaderWords({ id: "instant_thinking", label: "Instant Thinking" }),
      ).toEqual(["INSTANT", "THINKING"]);
    });

    it("handles single-word terms without splitting unnecessarily", () => {
      expect(formatThinkingHeaderWords({ id: "low", label: "Low" })).toEqual(["LOW"]);
      expect(formatThinkingHeaderWords({ id: "medium", label: "Medium" })).toEqual(["MEDIUM"]);
      expect(formatThinkingHeaderWords({ id: "high", label: "High" })).toEqual(["HIGH"]);
      expect(formatThinkingHeaderWords({ id: "max", label: "Max" })).toEqual(["MAX"]);
    });

    it("splits multi-word strings cleanly", () => {
      expect(formatThinkingHeaderWords({ id: "deep_thinking", label: "Deep Thinking" })).toEqual([
        "DEEP",
        "THINKING",
      ]);
    });
  });
  describe("getReasoningChoiceRank", () => {
    it("assigns stable ranks to known reasoning level IDs", () => {
      expect(getReasoningChoiceRank("none")).toBe(0);
      expect(getReasoningChoiceRank("low")).toBe(10);
      expect(getReasoningChoiceRank("minimal")).toBe(15);
      expect(getReasoningChoiceRank("medium")).toBe(20);
      expect(getReasoningChoiceRank("high")).toBe(30);
      expect(getReasoningChoiceRank("xhigh")).toBe(40);
      expect(getReasoningChoiceRank("max")).toBe(50);
      expect(getReasoningChoiceRank("ultra")).toBe(60);
      expect(getReasoningChoiceRank("ultracode")).toBe(70);
      expect(getReasoningChoiceRank("ultrathink")).toBe(80);
    });

    it("returns high fallback rank for unknown reasoning level IDs", () => {
      expect(getReasoningChoiceRank("creative")).toBe(1000);
      expect(getReasoningChoiceRank("deep_thinking")).toBe(1000);
    });
  });

  describe("sortReasoningChoices", () => {
    it("sorts choices by rank order and preserves full choice metadata", () => {
      const input = [
        { id: "max", label: "Maximum Effort", isDefault: false },
        { id: "low", label: "Low Effort", isDefault: true },
        { id: "high", label: "High Effort", isDefault: false },
      ];

      const sorted = sortReasoningChoices(input);
      expect(sorted.map((c) => c.id)).toEqual(["low", "high", "max"]);
      expect(sorted[0]).toEqual({ id: "low", label: "Low Effort", isDefault: true });
    });

    it("preserves unknown reasoning IDs and places them after known IDs deterministically", () => {
      const input = [
        { id: "creative", label: "Creative" },
        { id: "high", label: "High" },
        { id: "balanced", label: "Balanced" },
        { id: "low", label: "Low" },
      ];

      const sorted = sortReasoningChoices(input);
      expect(sorted.map((c) => c.id)).toEqual(["low", "high", "balanced", "creative"]);
    });
  });

  describe("collectReasoningChoices", () => {
    it("returns default standard reasoning choices for empty descriptor collections", () => {
      expect(collectReasoningChoices([]).map((c) => c.id)).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultra",
      ]);
    });

    it("returns empty array when descriptor sets do not contain reasoning effort options (e.g. non-reasoning models)", () => {
      const descriptors: ProviderOptionDescriptor[][] = [
        [
          {
            id: "fastMode",
            type: "boolean",
            label: "Fast Mode",
            currentValue: false,
          },
        ],
      ];

      expect(collectReasoningChoices(descriptors)).toEqual([]);
    });

    it("collects, deduplicates by ID, and sorts choices from reasoning effort descriptors", () => {
      const set1: ProviderOptionDescriptor[] = [
        {
          id: "reasoningEffort",
          type: "select",
          label: "Reasoning Effort",
          currentValue: "medium",
          options: [
            { id: "low", label: "Low", isDefault: false },
            { id: "medium", label: "Medium", isDefault: true },
            { id: "high", label: "High", isDefault: false },
          ],
        },
      ];

      const set2: ProviderOptionDescriptor[] = [
        {
          id: "reasoningEffort",
          type: "select",
          label: "Reasoning Effort",
          currentValue: "ultra",
          options: [
            { id: "medium", label: "Medium", isDefault: false },
            { id: "ultra", label: "Ultra Thinking", isDefault: false },
            { id: "max", label: "Max", isDefault: false },
          ],
        },
      ];

      const result = collectReasoningChoices([set1, set2]);
      expect(result.map((c) => c.id)).toEqual(["low", "medium", "high", "max", "ultra"]);
      expect(result.find((c) => c.id === "ultra")?.label).toBe("Ultra Thinking");
    });

    it("correctly extracts choices that use value property instead of id", () => {
      const serverSet: ProviderOptionDescriptor[] = [
        {
          id: "effort",
          type: "select",
          label: "Reasoning",
          options: [
            { value: "low", label: "Low" } as any,
            { value: "medium", label: "Medium" } as any,
            { value: "high", label: "High" } as any,
            { value: "xhigh", label: "Extra High" } as any,
            { value: "max", label: "Max" } as any,
            { value: "ultracode", label: "Ultracode" } as any,
            { value: "ultrathink", label: "Ultrathink" } as any,
          ],
        },
      ];

      const result = collectReasoningChoices([serverSet]);
      expect(result.map((c) => c.id)).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultracode",
        "ultrathink",
      ]);
    });
  });

  describe("Ultrathink scoping & prompt/frame behavior", () => {
    it("applyClaudePromptEffortPrefix adds prefix for ultrathink and strips it for other efforts", () => {
      const baseText = "Help me optimize this algorithm";
      const withPrefix = applyClaudePromptEffortPrefix(baseText, "ultrathink");
      expect(withPrefix).toBe("Ultrathink:\nHelp me optimize this algorithm");

      // Moving to max or high strips the prefix
      const strippedToMax = applyClaudePromptEffortPrefix(withPrefix, "max");
      expect(strippedToMax).toBe("Help me optimize this algorithm");

      const strippedToNull = applyClaudePromptEffortPrefix(withPrefix, null);
      expect(strippedToNull).toBe("Help me optimize this algorithm");
    });

    it("getComposerProviderState only activates ultrathink frame when promptEffort is ultrathink", async () => {
      const { getComposerProviderState } =
        await import("./components/chat/composerProviderRegistry");
      const { createModelCapabilities } = await import("@tabs/shared/model");

      const claudeCaps = createModelCapabilities({
        optionDescriptors: [
          {
            id: "effort",
            type: "select",
            label: "Reasoning",
            options: [
              { id: "high", label: "High" },
              { id: "max", label: "Max" },
              { id: "ultrathink", label: "Ultrathink" },
            ],
            promptInjectedValues: ["ultrathink"],
          },
        ],
      });

      const models = [
        {
          slug: "claude-opus-4-8",
          name: "Claude Opus 4.8",
          isCustom: false,
          capabilities: claudeCaps,
        },
      ];

      // Case 1: On Ultrathink with prefix -> frame active
      const activeState = getComposerProviderState({
        provider: "claudeAgent",
        model: "claude-opus-4-8",
        models,
        prompt: "Ultrathink:\nHello world",
        modelOptions: [{ id: "effort", value: "ultrathink" }],
      });
      expect(activeState.composerFrameClassName).toBe("ultrathink-frame");

      // Case 2: On MAX even if prompt still contains prefix -> frame is NOT active!
      const inactiveState = getComposerProviderState({
        provider: "claudeAgent",
        model: "claude-opus-4-8",
        models,
        prompt: "Ultrathink:\nHello world",
        modelOptions: [{ id: "effort", value: "max" }],
      });
      expect(inactiveState.composerFrameClassName).toBeUndefined();
    });

    it("inferModelCapabilitiesFromSlug does NOT assign prompt-injected ultrathink to GPT/Codex models", async () => {
      const { inferModelCapabilitiesFromSlug } = await import("@tabs/contracts");

      const gpt5Caps = inferModelCapabilitiesFromSlug("gpt-5.6-terra");
      expect(gpt5Caps.promptInjectedEffortLevels).toEqual([]);
      const gpt5Effort = gpt5Caps.optionDescriptors?.find(
        (d) => d.id === "reasoningEffort" || d.id === "effort",
      );
      if (gpt5Effort && gpt5Effort.type === "select") {
        expect(gpt5Effort.options.map((o) => o.id)).not.toContain("ultrathink");
      }
      expect(gpt5Caps.optionDescriptors?.some((d) => d.id === "serviceTier")).toBe(true);

      const claudeCaps = inferModelCapabilitiesFromSlug("claude-opus-4-8");
      expect(claudeCaps.promptInjectedEffortLevels).toContain("ultrathink");
    });
  });
});
