import { describe, expect, it } from "vitest";
import { TIMELINE_LIVE_ARRIVAL_LIMIT, selectArrivedRowIds } from "./useTimelineRowEntrance";

describe("timeline row entrance", () => {
  it("never animates the rows painted when the timeline mounts", () => {
    expect(selectArrivedRowIds(new Set(), ["a", "b"], true)).toEqual([]);
  });

  it("animates rows that arrive live", () => {
    expect(selectArrivedRowIds(new Set(["a", "b"]), ["a", "b", "working"], false)).toEqual([
      "working",
    ]);
    expect(selectArrivedRowIds(new Set(["a", "working"]), ["a", "reply"], false)).toEqual([
      "reply",
    ]);
  });

  it("treats a large batch as a load and leaves it still", () => {
    const batch = Array.from({ length: TIMELINE_LIVE_ARRIVAL_LIMIT + 1 }, (_, i) => `row-${i}`);
    expect(selectArrivedRowIds(new Set(["a"]), ["a", ...batch], false)).toEqual([]);
  });
});
