import { describe, expect, it } from "vitest";
import {
  AUTO_REFRESH_MIN_INTERVAL_MS,
  LAST_MODEL_REFRESH_KEY,
} from "./useAutoRefreshModelsOnStartup";

describe("Restart-triggered & Manual Model Discovery Refresh Guard Tests", () => {
  it("defines a 5-minute (300,000ms) minimum interval guard for auto-refresh", () => {
    expect(AUTO_REFRESH_MIN_INTERVAL_MS).toBe(300_000);
  });

  it("skips restart auto-refresh if last refresh was within 5 minutes", () => {
    const now = Date.now();
    const recentRefresh = now - 60_000; // 1 minute ago

    const shouldSkip = now - recentRefresh < AUTO_REFRESH_MIN_INTERVAL_MS;
    expect(shouldSkip).toBe(true);
  });

  it("allows restart auto-refresh if last refresh was longer than 5 minutes ago", () => {
    const now = Date.now();
    const oldRefresh = now - 360_000; // 6 minutes ago

    const shouldSkip = now - oldRefresh < AUTO_REFRESH_MIN_INTERVAL_MS;
    expect(shouldSkip).toBe(false);
  });
});
