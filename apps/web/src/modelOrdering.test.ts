import { describe, expect, it } from "vitest";
import {
  applyCustomModelOrdering,
  isAllBuiltInModelsHidden,
  nextHiddenModelsForBulkToggle,
  resetModelOrder,
  toggleHiddenModel,
  updateHiddenModels,
  updateModelOrder,
} from "./modelOrdering";

function model(slug: string, isCustom = false) {
  return { slug, name: slug, isCustom };
}

describe("modelOrdering", () => {
  it("sorts models according to custom modelOrder while preserving Auto at top", () => {
    const models = [
      { slug: "model-a", name: "Model A" },
      { slug: "auto", name: "Auto" },
      { slug: "model-b", name: "Model B" },
      { slug: "model-c", name: "Model C" },
    ];
    const customOrder = ["model-c", "model-a", "model-b"];

    const sorted = applyCustomModelOrdering(models, customOrder);
    expect(sorted.map((m) => m.slug)).toEqual(["auto", "model-c", "model-a", "model-b"]);
  });

  it("appends unordered models to the end", () => {
    const models = [
      { slug: "model-a" },
      { slug: "model-b" },
      { slug: "model-c" },
      { slug: "model-new" },
    ];
    const customOrder = ["model-c", "model-a"];

    const sorted = applyCustomModelOrdering(models, customOrder);
    expect(sorted.map((m) => m.slug)).toEqual(["model-c", "model-a", "model-b", "model-new"]);
  });

  it("immutably updates model order for instance", () => {
    const initial = {};
    const next = updateModelOrder(initial, "codex", ["gpt-5.4", "gpt-5.3"]);
    expect(next).toEqual({
      codex: {
        hiddenModels: [],
        modelOrder: ["gpt-5.4", "gpt-5.3"],
      },
    });
  });

  it("resets model order for instance", () => {
    const initial = {
      codex: {
        hiddenModels: ["gpt-legacy"],
        modelOrder: ["gpt-5.4", "gpt-5.3"],
      },
    };
    const next = resetModelOrder(initial, "codex");
    expect(next).toEqual({
      codex: {
        hiddenModels: ["gpt-legacy"],
        modelOrder: [],
      },
    });
  });

  describe("bulk toggle and hidden models", () => {
    it("hides every built-in model without hiding custom models", () => {
      const models = [model("a"), model("b"), model("custom", true)];
      expect(nextHiddenModelsForBulkToggle(models, ["a"])).toEqual(["a", "b"]);
    });

    it("shows every built-in model while preserving unrelated hidden entries and custom models", () => {
      const models = [model("a"), model("b"), model("custom", true)];
      expect(nextHiddenModelsForBulkToggle(models, ["a", "b", "legacy", "custom"])).toEqual([
        "legacy",
        "custom",
      ]);
    });

    it("preserves required/default models specified in options", () => {
      const models = [model("auto"), model("default-model"), model("extra-1"), model("extra-2")];
      const result = nextHiddenModelsForBulkToggle(models, [], {
        preserveSlugs: ["auto", "default-model"],
      });
      expect(result).toEqual(["extra-1", "extra-2"]);
      expect(result).not.toContain("auto");
      expect(result).not.toContain("default-model");
    });

    it("supports search-filtered bulk toggle on subset of models", () => {
      const filteredSubset = [model("claude-sonnet"), model("claude-opus")];
      const initialHidden = ["other-model"];

      // When some filtered models are visible, bulk toggle hides the filtered subset
      const toggled = nextHiddenModelsForBulkToggle(filteredSubset, initialHidden);
      expect(toggled).toEqual(["other-model", "claude-sonnet", "claude-opus"]);

      // When all filtered models are hidden, bulk toggle unhides only the filtered subset
      const unhidden = nextHiddenModelsForBulkToggle(filteredSubset, toggled);
      expect(unhidden).toEqual(["other-model"]);
    });

    it("correctly identifies when all built-in models are hidden", () => {
      const models = [model("a"), model("b"), model("custom", true)];
      expect(isAllBuiltInModelsHidden(models, ["a"])).toBe(false);
      expect(isAllBuiltInModelsHidden(models, ["a", "b"])).toBe(true);
      expect(isAllBuiltInModelsHidden(models, ["a", "b", "c"])).toBe(true);

      // With preserveSlugs
      const modelsWithDefault = [model("auto"), model("a"), model("b")];
      expect(
        isAllBuiltInModelsHidden(modelsWithDefault, ["a", "b"], { preserveSlugs: ["auto"] }),
      ).toBe(true);
    });

    it("immutably updates hidden models and avoids saving redundant empty settings", () => {
      const initial = {};
      const next = updateHiddenModels(initial, "codex", ["model-1", "model-2"]);
      expect(next).toEqual({
        codex: {
          hiddenModels: ["model-1", "model-2"],
          modelOrder: [],
        },
      });

      // Clearing hidden models when modelOrder is empty deletes the empty instance settings
      const cleared = updateHiddenModels(next, "codex", []);
      expect(cleared).toEqual({});
    });

    it("toggles single model hidden state", () => {
      const initial = {
        claudeAgent: {
          hiddenModels: ["claude-haiku"],
          modelOrder: [],
        },
      };

      // Unhide claude-haiku
      const unhidden = toggleHiddenModel(initial, "claudeAgent", "claude-haiku");
      expect(unhidden).toEqual({});

      // Hide claude-sonnet
      const hidden = toggleHiddenModel(unhidden, "claudeAgent", "claude-sonnet");
      expect(hidden.claudeAgent?.hiddenModels).toEqual(["claude-sonnet"]);
    });
  });
});
