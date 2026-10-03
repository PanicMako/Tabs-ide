import { describe, expect, it } from "vitest";
import { playwrightOutcome, runBounded } from "./batchExecution";

const result = { code: 0, stdout: "", stderr: "", signal: null, timedOut: false };
const report = {
  stats: { expected: 1, skipped: 0, unexpected: 0, flaky: 0 },
  errors: [],
  suites: [{ specs: [{ tests: [{ expectedStatus: "passed", status: "expected" }] }] }],
};

describe("Playwright execution evidence", () => {
  it("requires structured evidence of an actual successful test", () => {
    expect(playwrightOutcome(result, report)).toBe("passed");
    expect(playwrightOutcome(result, undefined)).toBe("blocked");
    expect(playwrightOutcome(result, { ...report, suites: [] })).toBe("blocked");
  });
  it("does not turn skipped, flaky, expected-failure or empty suites green", () => {
    for (const stats of [{ expected: 0 }, { skipped: 1 }, { flaky: 1 }, { unexpected: 1 }]) {
      expect(playwrightOutcome(result, { ...report, stats: { ...report.stats, ...stats } })).toBe(
        "blocked",
      );
    }
    expect(
      playwrightOutcome(result, {
        ...report,
        suites: [{ specs: [{ tests: [{ expectedStatus: "failed", status: "expected" }] }] }],
      }),
    ).toBe("blocked");
  });
  it("retains process failures and timeouts", () => {
    expect(playwrightOutcome({ ...result, code: 1 }, report)).toBe("failed");
    expect(playwrightOutcome({ ...result, timedOut: true }, report)).toBe("blocked");
  });
  it("limits workers and processes each case exactly once", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    await runBounded([1, 2, 3, 4, 5], 2, async (item) => {
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      seen.push(item);
      active--;
    });
    expect(peak).toBe(2);
    expect(seen.toSorted()).toEqual([1, 2, 3, 4, 5]);
    await expect(runBounded([], 0, async () => {})).rejects.toThrow("between 1 and 4");
  });
});
