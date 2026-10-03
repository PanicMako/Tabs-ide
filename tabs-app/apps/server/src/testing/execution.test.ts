import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ProviderInstanceId } from "@tabs/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { TestingExecutor, rankHealingCandidates } from "./execution";
import { TestingGraphStore } from "./graphStore";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function seedExecutableArtifact(root: string, targetUrl: string) {
  const store = new TestingGraphStore(join(root, "state.sqlite"));
  const crawlId = store.beginRun("project", targetUrl);
  store.upsertNode({
    projectId: "project",
    runId: crawlId,
    stateId: "home",
    pageUrl: targetUrl,
    pageTitle: "Home",
    snapshot: '- heading "Ready"',
  });
  store.upsertNode({
    projectId: "project",
    runId: crawlId,
    stateId: "saved",
    pageUrl: `${targetUrl}saved`,
    pageTitle: "Saved",
    snapshot: '- status "Saved"',
  });
  store.upsertEdge({
    projectId: "project",
    runId: crawlId,
    fromStateId: "home",
    toStateId: "saved",
    role: "button",
    name: "Save setting",
  });
  store.finishRun(crawlId, "completed");
  const imported = store.saveImportedCases({
    projectId: "project",
    workbookName: "cases.xlsx",
    workbookPath: join(root, "cases.xlsx"),
    cases: [
      {
        externalId: "QA-EXEC-1",
        description: "Open the application",
        steps: ["Open the application"],
        expectedResults: [""],
        sourceSheet: "Cases",
        sourceRow: 2,
        expectedResult: "",
        status: "matches",
        mismatches: [],
        matchedStateIds: ["home"],
      },
    ],
  });
  const caseId = imported.cases[0]!.id;
  const jobId = crypto.randomUUID();
  const specPath = join(root, "generated.spec.ts");
  await writeFile(
    specPath,
    `import { test, expect } from "playwright/test";\ntest("loads the controlled app", async ({ page }) => { await page.goto(process.env.TESTING_BASE_URL!); await expect(page.getByRole("heading", { name: "Ready" })).toBeVisible(); });\n`,
    "utf8",
  );
  store.createGenerationJob({
    id: jobId,
    projectId: "project",
    outputDirectory: root,
    totalCases: 1,
    modelSelection: {
      instanceId: ProviderInstanceId.makeUnsafe("codex"),
      model: "gpt-5.3-codex",
    },
  });
  store.updateGenerationJob(jobId, { status: "completed", completedCases: 1 });
  store.addGeneratedArtifact({
    jobId,
    caseId,
    externalId: "QA-EXEC-1",
    featureSlug: "controlled-app",
    pageObjectPath: join(root, "page.ts"),
    dataPath: join(root, "data.ts"),
    specPath,
    fingerprints: [
      {
        locatorKey: "saveSettings",
        role: "button",
        accessibleName: "Save settings",
        semanticContext: "Settings form",
        graphStateId: "home",
        urlPattern: targetUrl,
      },
    ],
    captureReplay: false,
  });
  return { store, jobId };
}

describe("TestingExecutor", () => {
  it("records launch failures as blocked instead of leaving the run running", async () => {
    const root = await mkdtemp(join(process.cwd(), "tabs-testing-launch-"));
    roots.push(root);
    const { store, jobId } = await seedExecutableArtifact(root, "http://127.0.0.1:4173/");
    try {
      const executor = new TestingExecutor(store, join(root, "testing"), async () => {
        throw new Error("Browser executable missing");
      });
      const run = await executor.execute({
        projectId: "project",
        generationJobId: jobId,
        targetUrl: "http://127.0.0.1:4173/",
        mode: "standalone",
        concurrency: 2,
      });
      expect(run.status).toBe("failed");
      expect(run.results).toMatchObject([
        { status: "blocked", error: "Browser executable missing" },
      ]);
    } finally {
      store.close();
    }
  });
  it.skipIf(process.env.TABS_VERIFY_GENERATED_SUITE !== "1")(
    "executes a generated Playwright test end to end and persists evidence",
    async () => {
      const root = await mkdtemp(join(process.cwd(), "tabs-testing-execution-"));
      roots.push(root);
      const server = createServer((_request, response) => {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<!doctype html><h1>Ready</h1>");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing fixture address");
      const targetUrl = `http://127.0.0.1:${address.port}`;
      const { store, jobId } = await seedExecutableArtifact(root, targetUrl);
      try {
        const run = await new TestingExecutor(store, join(root, "testing")).execute({
          projectId: "project",
          generationJobId: jobId,
          targetUrl,
          mode: "standalone",
          visualComparison: true,
        });
        if (run.status !== "passed") {
          throw new Error(`${run.stdout}\n${run.stderr}`);
        }
        expect(run.status).toBe("passed");
        expect(run.results).toMatchObject([
          {
            externalId: "QA-EXEC-1",
            status: "passed",
            visualStatus: "baseline-created",
          },
        ]);
        expect(run.stdout).toContain("1 passed");
      } finally {
        store.close();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
    30_000,
  );

  it("requires a strong winner before proposing a locator heal", () => {
    const ranked = rankHealingCandidates(
      { locatorKey: "save", role: "button", accessibleName: "Save settings", graphStateId: "form" },
      [
        {
          fromStateId: "form",
          toStateId: "done",
          role: "button",
          name: "Save setting",
          intentLocator: "role=button[name=Save setting]",
        },
        {
          fromStateId: "form",
          toStateId: "cancel",
          role: "button",
          name: "Cancel",
          intentLocator: "role=button[name=Cancel]",
        },
      ],
    );
    expect(ranked[0]?.confidence).toBeGreaterThanOrEqual(0.9);
    expect((ranked[0]?.confidence ?? 0) - (ranked[1]?.confidence ?? 0)).toBeGreaterThanOrEqual(0.1);
  });

  it("quarantines pass/fail flips only after three comparable executions", async () => {
    const root = await mkdtemp(join(process.cwd(), "tabs-testing-flaky-"));
    roots.push(root);
    const { store, jobId } = await seedExecutableArtifact(root, "http://127.0.0.1:4173/");
    const exitCodes = [1, 0, 1];
    const executor = new TestingExecutor(store, join(root, "testing"), async (_command, args) => {
      const config = await readFile(args[args.indexOf("--config") + 1]!, "utf8");
      const reportPath = JSON.parse(config.match(/outputFile: ("[^"]+")/)![1]!);
      await writeFile(
        reportPath,
        JSON.stringify({
          stats: { expected: 1, skipped: 0, unexpected: 0, flaky: 0 },
          errors: [],
          suites: [{ specs: [{ tests: [{ expectedStatus: "passed", status: "expected" }] }] }],
        }),
      );
      return {
        stdout: exitCodes[0] === 0 ? "1 passed" : "1 failed",
        stderr: "",
        code: exitCodes.shift() ?? 1,
        signal: null,
        timedOut: false,
      };
    });
    try {
      const runs = [];
      for (let index = 0; index < 3; index += 1) {
        runs.push(
          await executor.execute({
            projectId: "project",
            generationJobId: jobId,
            targetUrl: "http://127.0.0.1:4173/",
            mode: "ci",
          }),
        );
      }
      expect(runs[1]?.results[0]?.quarantined).toBe(false);
      expect(runs[2]?.results[0]).toMatchObject({ flaky: true, quarantined: true });
    } finally {
      store.close();
    }
  });

  it("persists a high-confidence locator proposal without rewriting source", async () => {
    const root = await mkdtemp(join(process.cwd(), "tabs-testing-healing-"));
    roots.push(root);
    const { store, jobId } = await seedExecutableArtifact(root, "http://127.0.0.1:4173/");
    const sourceBefore = await readFile(join(root, "generated.spec.ts"), "utf8");
    const executor = new TestingExecutor(store, join(root, "testing"), async () => ({
      stdout: "locator getByRole failed: element not found",
      stderr: "",
      code: 1,
      signal: null,
      timedOut: false,
    }));
    try {
      const runs = [];
      for (let index = 0; index < 3; index += 1) {
        runs.push(
          await executor.execute({
            projectId: "project",
            generationJobId: jobId,
            targetUrl: "http://127.0.0.1:4173/",
            mode: "standalone",
          }),
        );
      }
      const run = runs[0]!;
      expect(run.healingProposals).toMatchObject([
        {
          previousName: "Save settings",
          proposedName: "Save setting",
          status: "pending",
          consecutiveAttempts: 1,
        },
      ]);
      expect(run.healingProposals[0]?.confidence).toBeGreaterThanOrEqual(0.9);
      expect(runs[2]?.healingProposals[0]).toMatchObject({
        status: "below-threshold",
        consecutiveAttempts: 3,
      });
      expect(await readFile(join(root, "generated.spec.ts"), "utf8")).toBe(sourceBefore);
    } finally {
      store.close();
    }
  });

  it("aborts active and queued test cases on cancellation and marks run as blocked", async () => {
    const root = await mkdtemp(join(process.cwd(), "tabs-testing-cancel-"));
    roots.push(root);
    const { store, jobId } = await seedExecutableArtifact(root, "http://127.0.0.1:4173/");
    let executorRef: TestingExecutor | null = null;
    const executor = new TestingExecutor(
      store,
      join(root, "testing"),
      async (_cmd, _args, opts) => {
        // Simulate slow execution that gets cancelled
        if (executorRef) {
          // Trigger cancellation while running
          const runs = store.executionRuns("project").runs;
          const currentRun = runs[0];
          if (currentRun) {
            executorRef.cancel("project", currentRun.id);
          }
        }
        if (opts?.signal?.aborted) {
          throw new Error("Execution cancelled");
        }
        return {
          stdout: "",
          stderr: "cancelled",
          code: 1,
          signal: "SIGTERM",
          timedOut: false,
        };
      },
    );
    executorRef = executor;
    try {
      const run = await executor.execute({
        projectId: "project",
        generationJobId: jobId,
        targetUrl: "http://127.0.0.1:4173/",
        mode: "standalone",
      });
      expect(run.status).toBe("blocked");
      expect(run.results[0]?.status).toBe("blocked");
    } finally {
      store.close();
    }
  });
});
