import { expect, it } from "vitest";
import { collectComposerInlineTokens, SKILL_MENTION_PATTERN } from "./composerInlineTokens.ts";
it("recognizes currency sigils for skills while preserving monetary amounts", () => {
  const text = "Use €review then ₹2spec and £20k or ¥100M";
  expect(
    collectComposerInlineTokens(text)
      .filter((x) => x.type === "skill")
      .map((x) => x.value),
  ).toEqual(["review", "2spec"]);
  expect(text.replace(SKILL_MENTION_PATTERN, "$1$$$2")).toBe(
    "Use $review then $2spec and £20k or ¥100M",
  );
});
