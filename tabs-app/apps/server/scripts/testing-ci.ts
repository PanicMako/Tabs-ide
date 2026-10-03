import { resolve } from "node:path";

import { TestingService } from "../src/testing/TestingService";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

let service: TestingService | null = null;
try {
  service = new TestingService(resolve(required("TABS_TESTING_STATE_DIRECTORY")));
  const run = await service.runTests({
    projectId: required("TABS_TESTING_PROJECT_ID"),
    generationJobId: required("TABS_TESTING_GENERATION_JOB_ID"),
    targetUrl: required("TABS_TESTING_TARGET_URL"),
    mode: "ci",
    visualComparison: process.env.TABS_TESTING_VISUAL === "1",
  });
  process.stdout.write(
    `${JSON.stringify({
      runId: run.id,
      status: run.status,
      passed: run.results.filter((result) => result.status === "passed").length,
      failed: run.results.filter((result) => result.status === "failed").length,
      quarantined: run.results.filter((result) => result.quarantined).length,
    })}\n`,
  );
  process.exitCode = run.status === "passed" ? 0 : 1;
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 2;
} finally {
  service?.close();
}
