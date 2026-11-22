import { describe, expect, it } from "vitest";
import { dateToTimeOfDay, timeOfDayToDate } from "./TimeField";

describe("TimeField helpers", () => {
  it("round-trips HH:MM", () => {
    expect(dateToTimeOfDay(timeOfDayToDate("09:05")!)).toBe("09:05");
    expect(dateToTimeOfDay(timeOfDayToDate("23:59")!)).toBe("23:59");
  });
  it("rejects malformed values", () => {
    expect(timeOfDayToDate("")).toBeNull();
    expect(timeOfDayToDate("25:00")).toBeNull();
    expect(timeOfDayToDate("9:75")).toBeNull();
  });
});
