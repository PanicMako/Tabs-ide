import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("reports both replay matchers' decisions and paired timing samples", () => {
  const script = fileURLToPath(new URL("./compareDeviceReplayControls.ts", import.meta.url));
  const report = JSON.parse(execFileSync("bun", ["--no-env-file", script], { encoding: "utf8" }));

  expect(report.results).toEqual([
    { name: "renamed and moved", expected: "@e2~s1", previous: "pause", current: "@e2~s1" },
    {
      name: "recorded label on a different control",
      expected: "pause",
      previous: "@e2~s1",
      current: "pause",
    },
    {
      name: "same label with no shared identifier",
      expected: "@e2~s1",
      previous: "@e2~s1",
      current: "@e2~s1",
    },
    { name: "repeated identifier", expected: "pause", previous: "@e1~s1", current: "pause" },
    { name: "order placement label", expected: "pause", previous: "pause", current: "pause" },
  ]);
  expect(report.previous).toEqual({ correct: 2, wrongTargetSelections: 2 });
  expect(report.current).toEqual({ correct: 5, wrongTargetSelections: 0 });
  expect(report.timing).toMatchObject({ warmupBatchesPerMatcher: 2, decisionsPerBatch: 50_000 });
  for (const matcher of ["previous", "current"] as const) {
    const { samplesMs, medianMs } = report.timing[matcher];
    expect(samplesMs).toHaveLength(10);
    for (const elapsedMs of samplesMs) {
      expect(Number.isFinite(elapsedMs) && elapsedMs > 0).toBe(true);
    }
    const sorted = samplesMs.toSorted((a: number, b: number) => a - b);
    expect(medianMs).toBe((sorted[4] + sorted[5]) / 2);
  }
});
