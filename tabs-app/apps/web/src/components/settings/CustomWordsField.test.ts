import { describe, expect, it } from "vitest";
import { addCustomWords, CUSTOM_WORDS_MAX } from "./CustomWordsField";

describe("addCustomWords", () => {
  it("adds comma-separated words, trimmed, without case-insensitive duplicates", () => {
    expect(addCustomWords(["Tabs"], " Effect, tabs ,OpenCode,, ")).toEqual([
      "Tabs",
      "Effect",
      "OpenCode",
    ]);
  });

  it("keeps each word within the dictionary's length and count limits", () => {
    expect(addCustomWords([], "x".repeat(80))).toEqual(["x".repeat(50)]);
    const full = Array.from({ length: CUSTOM_WORDS_MAX }, (_, index) => `word${index}`);
    expect(addCustomWords(full, "one more")).toHaveLength(CUSTOM_WORDS_MAX);
  });
});
