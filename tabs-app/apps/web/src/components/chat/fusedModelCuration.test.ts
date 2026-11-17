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

describe("curateModels shortlist limit", () => {
  it("keeps the first few newest models and always the selected one", () => {
    const models = Array.from({ length: 12 }, (_, index) => ({
      slug: `family-${index}-1`,
      name: `Family${String.fromCharCode(65 + index)} 1`,
    }));
    const { shown, hidden } = curateModels(models, (model) => model.slug === "family-11-1", 5);
    expect(shown.map((model) => model.slug)).toEqual([
      "family-0-1",
      "family-1-1",
      "family-2-1",
      "family-3-1",
      "family-4-1",
      "family-11-1",
    ]);
    expect(hidden).toBe(6);
  });
});
