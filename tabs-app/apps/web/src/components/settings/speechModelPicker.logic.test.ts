import type { EnvironmentSpeechModel } from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import { formatModelBytes, modelFacts, visibleModels } from "./speechModelPicker.logic";

const model = (patch: Partial<EnvironmentSpeechModel> & { id: string }): EnvironmentSpeechModel =>
  ({
    name: patch.id,
    description: "",
    size: 700_000_000,
    languages: ["en"],
    accuracy: 0,
    speed: 0,
    recommended: false,
    supportsStreaming: false,
    supportsLanguageDetection: false,
    supportsTranslation: false,
    active: false,
    state: "downloadable",
    ...patch,
  }) as unknown as EnvironmentSpeechModel;

const withAccuracy = (errorPercent: number, grade = "B") => ({
  benchmark: {
    accuracy: { en: { grade, errorPercent } },
    secondsPer30s: { accelerated: 1.2, cpu: 2 },
  },
});

describe("speech model picker", () => {
  it("shows size, language, measured accuracy and speed", () => {
    expect(
      modelFacts(model({ id: "a", supportsStreaming: true, ...withAccuracy(4, "A-") }), "auto"),
    ).toEqual([
      "700 MB",
      "English",
      "Accuracy A- (4.0% errors)",
      "1.2s per 30s of speech",
      "Streams as you talk",
    ]);
    expect(formatModelBytes(2_410_655_232)).toBe("2.4 GB");
  });

  it("puts the active model first, then installed, then the most accurate", () => {
    const list = visibleModels(
      [
        model({ id: "worse", recommended: true, ...withAccuracy(9) }),
        model({ id: "best", recommended: true, ...withAccuracy(3) }),
        model({ id: "installed", state: "installed", ...withAccuracy(20) }),
        model({ id: "active", active: true, state: "installed" }),
      ],
      { view: "all", query: "", language: "auto" },
    );
    expect(list.map((entry) => entry.id)).toEqual(["active", "installed", "best", "worse"]);
  });

  it("filters by view, language and search", () => {
    const models = [
      model({ id: "en-rec", recommended: true }),
      model({ id: "fr-rec", recommended: true, languages: ["fr"] }),
      model({ id: "plain" }),
      model({ id: "have", state: "installed" }),
    ];
    const ids = (view: "recommended" | "installed" | "all", language = "auto", query = "") =>
      visibleModels(models, { view, query, language }).map((entry) => entry.id);
    expect(ids("recommended", "en")).toEqual(["have", "en-rec"]);
    expect(ids("installed")).toEqual(["have"]);
    expect(ids("all")).toHaveLength(4);
    expect(ids("all", "auto", "french")).toEqual(["fr-rec"]);
  });
});
