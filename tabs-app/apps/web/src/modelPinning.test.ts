import { describe, expect, it } from "vitest";
import {
  getPinnedModels,
  isPinnedModel,
  reorderPinnedModels,
  sortModelsWithPinnedFirst,
  togglePinnedModel,
} from "./modelPinning";
import type { ProviderInstanceId } from "@tabs/contracts";

describe("modelPinning", () => {
  it("reads pinnedModels with fallback to legacy favorites", () => {
    expect(getPinnedModels(null)).toEqual([]);
    expect(
      getPinnedModels({
        pinnedModels: [{ provider: "codex" as ProviderInstanceId, model: "gpt-5.4" }],
      }),
    ).toEqual([{ provider: "codex", model: "gpt-5.4" }]);
    // Fallback to legacy favorites only when pinnedModels is undefined
    expect(
      getPinnedModels({
        favorites: [{ provider: "claudeAgent" as ProviderInstanceId, model: "claude-sonnet-5" }],
      } as any),
    ).toEqual([{ provider: "claudeAgent", model: "claude-sonnet-5" }]);

    // Preserve empty pinnedModels array when explicitly set
    expect(
      getPinnedModels({
        pinnedModels: [],
        favorites: [{ provider: "claudeAgent" as ProviderInstanceId, model: "claude-sonnet-5" }],
      } as any),
    ).toEqual([]);
  });

  it("pin and unpin model immutably without duplicates", () => {
    const initial: any[] = [];

    // Pin a model
    const pinned1 = togglePinnedModel(initial, "codex", "gpt-5.4");
    expect(pinned1).toEqual([{ provider: "codex", model: "gpt-5.4" }]);

    // Pin another model
    const pinned2 = togglePinnedModel(pinned1, "claudeAgent", "claude-sonnet-5");
    expect(pinned2).toEqual([
      { provider: "codex", model: "gpt-5.4" },
      { provider: "claudeAgent", model: "claude-sonnet-5" },
    ]);

    // Unpin first model
    const unpinned = togglePinnedModel(pinned2, "codex", "gpt-5.4");
    expect(unpinned).toEqual([{ provider: "claudeAgent", model: "claude-sonnet-5" }]);
  });

  it("checks if model is pinned correctly for provider instance", () => {
    const pinned = [
      { provider: "codex" as ProviderInstanceId, model: "gpt-5.4" },
      { provider: "custom-instance" as ProviderInstanceId, model: "custom-model-1" },
    ];

    expect(isPinnedModel(pinned, "codex", "gpt-5.4")).toBe(true);
    expect(isPinnedModel(pinned, "codex", "gpt-5.3")).toBe(false);
    expect(isPinnedModel(pinned, "custom-instance", "custom-model-1")).toBe(true);
    expect(isPinnedModel(pinned, "other-instance", "custom-model-1")).toBe(false);
  });

  it("sorts models with pinned models first", () => {
    const models = [
      { slug: "gpt-5.3", name: "GPT 5.3" },
      { slug: "gpt-5.4", name: "GPT 5.4" },
      { slug: "gpt-5.2", name: "GPT 5.2" },
    ];
    const pinned = [{ provider: "codex" as ProviderInstanceId, model: "gpt-5.4" }];

    const sorted = sortModelsWithPinnedFirst(models, pinned, "codex");
    expect(sorted[0]?.slug).toBe("gpt-5.4");
  });

  it("reorders pinned models correctly", () => {
    const pinned = [
      { provider: "codex" as ProviderInstanceId, model: "gpt-5.4" },
      { provider: "claudeAgent" as ProviderInstanceId, model: "claude-sonnet-5" },
      { provider: "kilo" as ProviderInstanceId, model: "solar-pro" },
    ];

    // Move item at index 2 to index 0
    const reordered1 = reorderPinnedModels(pinned, 2, 0);
    expect(reordered1.map((p) => p.model)).toEqual(["solar-pro", "gpt-5.4", "claude-sonnet-5"]);

    // Move item at index 0 to index 1
    const reordered2 = reorderPinnedModels(pinned, 0, 1);
    expect(reordered2.map((p) => p.model)).toEqual(["claude-sonnet-5", "gpt-5.4", "solar-pro"]);

    // Invalid index returns unchanged
    const invalid = reorderPinnedModels(pinned, -1, 5);
    expect(invalid).toEqual(pinned);
  });
});
