import { describe, expect, it } from "vitest";

import { latestSlotAtOrBefore, lookAroundDueSlot, nextSlotAfter } from "./lookAroundSchedule.ts";

const at = (hour: number, minute = 0, day = 10) => new Date(2026, 10, day, hour, minute).getTime();

describe("look-around slots", () => {
  it("finds the latest slot at or before now, today only", () => {
    expect(latestSlotAtOrBefore("every4h", at(7))).toBeNull();
    expect(latestSlotAtOrBefore("every4h", at(13))).toBe(at(12));
    expect(latestSlotAtOrBefore("twiceDaily", at(23))).toBe(at(13));
  });

  it("finds the next slot, rolling to tomorrow after the last one", () => {
    expect(nextSlotAfter("mornings", at(7))).toBe(at(8));
    expect(nextSlotAfter("mornings", at(8))).toBe(at(8, 0, 11));
  });

  it("is due once per slot and catches up a slept-through slot the same day", () => {
    const armedAt = at(6);
    expect(
      lookAroundDueSlot({ preset: "every4h", armedAt, lastLookAt: null, now: at(12, 3) }),
    ).toBe(at(12));
    expect(
      lookAroundDueSlot({ preset: "every4h", armedAt, lastLookAt: at(12, 1), now: at(12, 3) }),
    ).toBeNull();
    expect(
      lookAroundDueSlot({ preset: "every4h", armedAt, lastLookAt: at(8, 1), now: at(15) }),
    ).toBe(at(12));
  });

  it("never catches up a slot before it was turned on, and a recent look stands in for a slot", () => {
    expect(
      lookAroundDueSlot({ preset: "every4h", armedAt: at(13), lastLookAt: null, now: at(14) }),
    ).toBeNull();
    expect(
      lookAroundDueSlot({
        preset: "every4h",
        armedAt: at(6),
        lastLookAt: at(11, 30),
        now: at(12, 5),
      }),
    ).toBeNull();
  });
});
