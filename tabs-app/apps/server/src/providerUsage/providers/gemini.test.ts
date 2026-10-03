import { describe, expect, it } from "vitest";

import { geminiUsageFetcher } from "./gemini.ts";

describe("Gemini usage", () => {
  it("does not fabricate quota consumption from an API key", async () => {
    const snapshot = await geminiUsageFetcher.fetch({
      homeDir: "/tmp/tester",
      env: { GEMINI_API_KEY: "test-key" },
      platform: "linux",
      nowMs: 1_780_000_000_000,
    });

    expect(snapshot.status).toBe("unsupported");
    expect(snapshot.limits).toEqual([]);
    expect(snapshot.detail).toContain("Google AI Studio");
  });
});
