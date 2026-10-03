import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { ProviderInstanceId } from "@tabs/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { TestingGraphStore } from "./graphStore";
import { TestingReporter } from "./reporting";

const disposable: string[] = [];
afterEach(async () => {
  await Promise.all(disposable.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function seedRun(root: string) {
  const store = new TestingGraphStore(join(root, "state.sqlite"));
  const crawlId = store.beginRun("report-project", "http://127.0.0.1:4173/settings");
  store.upsertNode({
    projectId: "report-project",
    runId: crawlId,
    stateId: "settings",
    pageUrl: "http://127.0.0.1:4173/settings",
    pageTitle: "Settings",
    snapshot: '- heading "Settings"',
  });
  store.finishRun(crawlId, "completed");
  const imported = store.saveImportedCases({
    projectId: "report-project",
    workbookName: "controlled.xlsx",
    workbookPath: join(root, "controlled.xlsx"),
    cases: [
      {
        externalId: "QA-0042",
        description: "Open workspace settings",
        steps: ["Open Settings", "Choose Workspace"],
        expectedResults: ["", ""],
        expectedResult: "",
        sourceSheet: "Cases",
        sourceRow: 42,
        status: "matches",
        mismatches: [],
        matchedStateIds: ["settings"],
      },
    ],
  });
  const testCase = imported.cases[0]!;
  const jobId = crypto.randomUUID();
  store.createGenerationJob({
    id: jobId,
    projectId: "report-project",
    outputDirectory: root,
    totalCases: 1,
    modelSelection: { instanceId: ProviderInstanceId.makeUnsafe("codex"), model: "gpt-5.3-codex" },
  });
  store.updateGenerationJob(jobId, { status: "completed", completedCases: 1 });
  store.addGeneratedArtifact({
    jobId,
    caseId: testCase.id,
    externalId: testCase.externalId,
    featureSlug: "workspace-settings",
    pageObjectPath: join(root, "settings.page.ts"),
    dataPath: join(root, "settings.data.ts"),
    specPath: join(root, "settings.spec.ts"),
    fingerprints: [
      {
        locatorKey: "workspace",
        role: "button",
        accessibleName: "Workspace",
        semanticContext: "Settings navigation",
        graphStateId: "settings",
        urlPattern: "/settings",
      },
    ],
    captureReplay: false,
  });
  const runId = crypto.randomUUID();
  store.beginExecutionRun({
    id: runId,
    projectId: "report-project",
    generationJobId: jobId,
    mode: "standalone",
    targetUrl: "http://127.0.0.1:4173/settings",
    artifactRevision: "fixture-revision",
  });
  store.finishExecutionRun({
    runId,
    status: "passed",
    durationMs: 1384,
    stdout: "1 passed",
    stderr: "",
    artifactRevision: "fixture-revision",
    results: [
      {
        caseId: testCase.id,
        externalId: testCase.externalId,
        status: "passed",
        durationMs: 1384,
        error: null,
        tracePath: join(root, "trace.zip"),
        screenshotPath: null,
        flaky: false,
        quarantined: false,
        visualStatus: "disabled",
      },
    ],
    proposals: [],
  });
  return { store, runId, testCase, jobId };
}

describe("TestingReporter", () => {
  it.skipIf(process.env.TABS_VERIFY_REPORT !== "1")(
    "creates openable DOCX/PDF reports and resolves exact case traceability",
    async () => {
      const configured = process.env.TABS_VERIFY_REPORT_OUTPUT;
      const root = configured ?? (await mkdtemp(join(process.cwd(), "tabs-testing-report-")));
      if (!configured) disposable.push(root);
      const { store, runId, testCase, jobId } = await seedRun(root);
      try {
        const report = await new TestingReporter(store, join(root, "testing")).generate({
          projectId: "report-project",
          runId,
          testerName: "Controlled QA",
          buildLabel: "phase-5-fixture",
          environmentLabel: "Local controlled app",
        });
        const [docx, pdf] = await Promise.all([
          readFile(report.docxPath),
          readFile(report.pdfPath),
        ]);
        expect(docx.subarray(0, 2).toString()).toBe("PK");
        expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
        const trace = store.traceability("report-project", "QA-0042");
        expect(trace).toMatchObject({
          case: { id: testCase.id, externalId: "QA-0042", standaloneStatus: "passed" },
          import: { workbookName: "controlled.xlsx" },
          generatedArtifacts: [{ jobId, externalId: "QA-0042", fingerprintCount: 1 }],
          executions: [{ runId, status: "passed" }],
        });
        process.stdout.write(
          `REPORT_DOCX=${report.docxPath}\nREPORT_PDF=${report.pdfPath}\nTRACE=QA-0042 passed run=${runId}\n`,
        );
      } finally {
        store.close();
      }
    },
    30_000,
  );
});
