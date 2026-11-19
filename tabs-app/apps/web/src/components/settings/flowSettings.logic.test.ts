import { describe, expect, it } from "vitest";
import {
  autoSettleChoices,
  autoSettleLabel,
  fetchIntervalChoices,
  fetchIntervalLabel,
  mergeMethodChoice,
  mergeMethodFromChoice,
} from "./flowSettings.logic";

describe("flow settings helpers", () => {
  it("labels auto-settle choices in plain words", () => {
    expect(autoSettleLabel(null)).toBe("Never");
    expect(autoSettleLabel(1)).toBe("After 1 day");
    expect(autoSettleLabel(7)).toBe("After 7 days");
  });

  it("keeps a stored value that is not a preset visible, in order", () => {
    expect(autoSettleChoices(3)).toEqual([null, 1, 3, 7, 14, 30, 90]);
    expect(autoSettleChoices(10)).toEqual([null, 1, 3, 7, 10, 14, 30, 90]);
  });

  it("labels fetch intervals and keeps an unusual one", () => {
    expect(fetchIntervalLabel(30_000)).toBe("Every 30 seconds");
    expect(fetchIntervalLabel(60_000)).toBe("Every minute");
    expect(fetchIntervalLabel(300_000)).toBe("Every 5 minutes");
    expect(fetchIntervalChoices(45_000)).toEqual([
      15_000, 30_000, 45_000, 60_000, 300_000, 900_000,
    ]);
  });

  it("treats no merge method as asking each time", () => {
    expect(mergeMethodChoice(null)).toBe("ask");
    expect(mergeMethodFromChoice("ask")).toBeNull();
    expect(mergeMethodFromChoice(mergeMethodChoice("squash"))).toBe("squash");
  });
});
