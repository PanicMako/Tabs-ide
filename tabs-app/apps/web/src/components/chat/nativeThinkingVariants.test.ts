import { expect, test } from "vitest";
import {
  groupNativeThinkingVariants,
  NATIVE_THINKING_OPTION,
  nativeThinkingDescriptor,
  resolveNativeThinkingSelection,
  type ThinkingModel,
} from "./nativeThinkingVariants";

const models = ["high", "medium", "low"].map((level) => ({
  slug: `gemini-3.8-flash-${level}`,
  name: `Gemini 3.8 Flash (${level[0]!.toUpperCase() + level.slice(1)})`,
  providerId: "antigravity",
  isCustom: false,
})) as ThinkingModel[];

test("one family row preserves the selected native ID and all available levels", () => {
  const grouped = groupNativeThinkingVariants(models, models[1]!.slug);
  expect(grouped).toHaveLength(1);
  expect(grouped[0]!.name).toBe("Gemini 3.8 Flash");
  expect(grouped[0]!.slug).toBe(models[1]!.slug);
  expect(grouped[0]!.thinkingVariants?.map((v) => v.model.slug)).toEqual([
    "gemini-3.8-flash-low",
    "gemini-3.8-flash-medium",
    "gemini-3.8-flash-high",
  ]);
  expect(nativeThinkingDescriptor(grouped[0]!)[0]).toMatchObject({ currentValue: "medium" });
});

test("never merges providers, unrelated native IDs, or single available variants", () => {
  expect(
    groupNativeThinkingVariants([models[0]!, { ...models[1]!, providerId: "gemini" }], ""),
  ).toHaveLength(2);
  expect(
    groupNativeThinkingVariants([models[0]!, { ...models[1]!, slug: "other-medium" }], ""),
  ).toHaveLength(2);
  expect(groupNativeThinkingVariants([models[0]!], "")[0]!.thinkingVariants).toBeUndefined();
});

test("picking a level selects that variant's native ID and keeps the level out of the options", () => {
  const family = groupNativeThinkingVariants(models, "gemini-3.8-flash-medium")[0]!;
  for (const level of ["low", "medium", "high"]) {
    expect(resolveNativeThinkingSelection(family, [], level).slug).toBe(
      `gemini-3.8-flash-${level}`,
    );
  }
  // The inactive-row path carries the level inside the selections.
  expect(
    resolveNativeThinkingSelection(family, [
      { id: NATIVE_THINKING_OPTION, value: "low" },
      { id: "other", value: true },
    ]),
  ).toEqual({ slug: "gemini-3.8-flash-low", options: [{ id: "other", value: true }] });
  // A model without variants (for example GPT-OSS) maps to itself.
  const gptOss = { ...models[0]!, slug: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" };
  expect(groupNativeThinkingVariants([gptOss], "")[0]).toBe(gptOss);
  expect(resolveNativeThinkingSelection(gptOss, undefined, "low").slug).toBe("gpt-oss-120b-medium");
  expect(nativeThinkingDescriptor(gptOss)).toEqual([]);
});

test("a model with its own reasoning control gets no second folded control", () => {
  const family = groupNativeThinkingVariants(models, models[1]!.slug)[0]!;
  const withOwn = {
    ...family,
    capabilities: {
      optionDescriptors: [
        {
          id: "thought_level",
          label: "Thinking Level",
          type: "select" as const,
          role: "reasoning" as const,
          options: [{ id: "low", label: "Low" }],
        },
      ],
    },
  } as ThinkingModel;
  expect(nativeThinkingDescriptor(family)).toHaveLength(1);
  expect(nativeThinkingDescriptor(withOwn)).toEqual([]);
});
