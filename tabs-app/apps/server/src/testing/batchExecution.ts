import type { ProcessRunResult } from "../processRunner";

// Bounded workers keep independent case failures from abandoning the batch.
export async function runBounded<T>(
  items: readonly T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error("Test concurrency must be an integer between 1 and 4");
  }
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        if (signal?.aborted) break;
        const index = next++;
        await run(items[index]!, index);
      }
    }),
  );
}

export function playwrightOutcome(
  result: ProcessRunResult,
  report: unknown,
): "passed" | "failed" | "blocked" {
  if (result.timedOut || result.code === null) return "blocked";
  if (result.code !== 0) return "failed";
  if (!report || typeof report !== "object" || !("stats" in report)) return "blocked";
  const stats = report.stats as Record<string, unknown> | null;
  if (!stats || typeof stats.expected !== "number" || stats.expected < 1) return "blocked";
  // Skips, unexpected passes/failures and retry-flaky tests must not become green.
  if (stats.skipped !== 0 || stats.flaky !== 0 || stats.unexpected !== 0) return "blocked";
  if (!("errors" in report) || !Array.isArray(report.errors) || report.errors.length !== 0)
    return "blocked";
  const tests: Array<Record<string, unknown>> = [];
  function visit(suites: unknown): void {
    if (!Array.isArray(suites)) return;
    for (const suite of suites) {
      if (!suite || typeof suite !== "object") continue;
      if (Array.isArray(suite.specs)) {
        for (const spec of suite.specs) {
          if (!spec || typeof spec !== "object") continue;
          if (Array.isArray(spec.tests)) tests.push(...spec.tests);
        }
      }
      visit(suite.suites);
    }
  }
  visit("suites" in report ? report.suites : undefined);
  if (
    tests.length === 0 ||
    tests.some((test) => !test || test.expectedStatus !== "passed" || test.status !== "expected")
  )
    return "blocked";
  return "passed";
}
