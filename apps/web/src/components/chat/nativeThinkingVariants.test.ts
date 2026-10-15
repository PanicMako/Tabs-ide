import { expect, test } from "vitest";
import {
  groupNativeThinkingVariants,
  nativeThinkingDescriptor,
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
