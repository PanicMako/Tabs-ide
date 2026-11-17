import { describe, expect, it } from "vitest";
import { firstLine, queueWhen, relativeAge, timeUntil } from "./composerSheets";

describe("composer sheet text", () => {
  it("previews a draft by its first line", () => {
    expect(firstLine("  Fix login\nmore")).toBe("Fix login");
    expect(firstLine("   ")).toBe("Untitled draft");
  });

  it("says how old a draft is in plain words", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    expect(relativeAge("2026-11-16T11:59:40Z", now)).toBe("just now");
    expect(relativeAge("2026-11-16T11:15:00Z", now)).toBe("45m ago");
    expect(relativeAge("2026-11-16T07:00:00Z", now)).toBe("5h ago");
    expect(relativeAge("2026-11-13T12:00:00Z", now)).toBe("3d ago");
  });

  it("says how long until a scheduled send", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    expect(timeUntil("2026-11-16T12:00:20Z", now)).toBe("any moment");
    expect(timeUntil("2026-11-16T12:12:00Z", now)).toBe("in 12 min");
    expect(timeUntil("2026-11-16T13:00:00Z", now)).toBe("in 1 hr");
    expect(timeUntil("2026-11-16T13:20:00Z", now)).toBe("in 1 hr 20 min");
    expect(timeUntil("2026-11-18T12:00:00Z", now)).toBe("in 2 days");
  });

  it("describes when a queued message goes out", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    const base = { id: "q", text: "hi", failed: false };
    expect(queueWhen({ ...base, scheduledFor: null }, now)).toBe("Sends when the agent is free");
    expect(queueWhen({ ...base, scheduledFor: "2026-11-16T13:00:00Z" }, now)).toMatch(
      /^Sends .+ · in 1 hr$/,
    );
    expect(queueWhen({ ...base, scheduledFor: null, failed: true }, now)).toBe("Couldn't send");
  });
});
