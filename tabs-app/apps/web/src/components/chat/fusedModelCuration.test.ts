import { describe, expect, it } from "vitest";

import { curateModels } from "./fusedModelCuration";

const model = (name: string) => ({ slug: name.toLowerCase().replace(/\s+/g, "-"), name });

describe("curateModels", () => {
  const claude = [
    "Claude Opus 4.7",
    "Claude Opus 4.5",
    "Claude Sonnet 5.5",
    "Claude Sonnet 5",
    "Claude Sonnet 4.6",
    "Claude Haiku 5.5",
    "Claude Haiku 4.5",
  ].map(model);

  it("keeps the newest of each family and counts the rest as hidden", () => {
    const { shown, hidden } = curateModels(claude, () => false);
    expect(shown.map((m) => m.name)).toEqual([
      "Claude Opus 4.7",
      "Claude Sonnet 5.5",
      "Claude Haiku 5.5",
    ]);
    expect(hidden).toBe(4);
  });

  it("keeps pinned or selected models even when superseded", () => {
    const { shown } = curateModels(claude, (m) => m.name === "Claude Opus 4.5");
    expect(shown.map((m) => m.name)).toContain("Claude Opus 4.5");
  });

  it("leaves short lists alone", () => {
    const short = claude.slice(0, 3);
    expect(curateModels(short, () => false)).toEqual({ shown: short, hidden: 0 });
  });
});
