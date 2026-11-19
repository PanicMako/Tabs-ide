import { describe, expect, it } from "vitest";
import { isUsageCommand, usageCommandEffect } from "./usageCommands";

describe("usageCommandEffect", () => {
  it("opens the overview for plain open", () => {
    expect(usageCommandEffect("usage.open")).toEqual({ tab: "usage" });
  });

  it("switches between cost and tokens on the overview", () => {
    expect(usageCommandEffect("usage.cost")).toEqual({ tab: "usage", metric: "cost" });
    expect(usageCommandEffect("usage.tokens")).toEqual({ tab: "usage", metric: "tokens" });
  });

  it("opens provider limits", () => {
    expect(usageCommandEffect("usage.limits")).toEqual({ tab: "limits" });
  });

  it("maps each period onto a usage window", () => {
    expect(usageCommandEffect("usage.period.day").window).toBe("24h");
    expect(usageCommandEffect("usage.period.week").window).toBe("7d");
    expect(usageCommandEffect("usage.period.month").window).toBe("30d");
    expect(usageCommandEffect("usage.period.quarter").window).toBe("90d");
  });

  it("recognises only usage commands", () => {
    expect(isUsageCommand("usage.cost")).toBe(true);
    expect(isUsageCommand("usage.period.week")).toBe(true);
    expect(isUsageCommand("chat.new")).toBe(false);
  });
});
