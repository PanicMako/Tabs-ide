import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, join } from "node:path";

import type {
  TestingExecutionCaseResult,
  TestingExecutionInput,
  TestingExecutionRun,
  TestingHealingProposal,
} from "@tabs/contracts";

import { runProcess, type ProcessRunResult } from "../processRunner";
import type { StoredGraphEdge, TestingExecutionArtifact, TestingGraphStore } from "./graphStore";
import { shortDigest } from "./security";
import { playwrightOutcome, runBounded } from "./batchExecution";

export const TESTING_HEAL_CONFIDENCE = 0.9;
export const TESTING_HEAL_MARGIN = 0.1;
export const TESTING_HEAL_ATTEMPT_CAP = 2;

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? 0;
}

function nameSimilarity(left: string, right: string): number {
  const a = normalized(left);
  const b = normalized(right);
  if (a === b) return 1;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length, 1);
}

export function rankHealingCandidates(
  fingerprint: TestingExecutionArtifact["fingerprints"][number],
  edges: ReadonlyArray<StoredGraphEdge>,
): ReadonlyArray<{
  readonly edge: StoredGraphEdge;
  readonly confidence: number;
}> {
  return edges
    .map((edge) => ({
      edge,
      confidence: Math.min(
        1,
        nameSimilarity(fingerprint.accessibleName, edge.name) * 0.8 +
          (fingerprint.role === edge.role ? 0.2 : 0),
      ),
    }))
    .sort((left, right) => right.confidence - left.confidence);
}

async function findEvidence(root: string, suffix: string): Promise<string | null> {
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        const nested = await findEvidence(path, suffix);
        if (nested) return nested;
      } else if (entry.name.endsWith(suffix)) {
        return path;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export class TestingExecutor {
  readonly #store: TestingGraphStore;
  readonly #testingRoot: string;
  readonly #run: typeof runProcess;
  readonly #activeRuns = new Map<string, AbortController>();

  constructor(store: TestingGraphStore, testingRoot: string, run = runProcess) {
    this.#store = store;
    this.#testingRoot = testingRoot;
    this.#run = run;
  }

  cancel(projectId: string, runId: string): TestingExecutionRun {
    const run = this.#store.executionRuns(projectId).runs.find((item) => item.id === runId);
    if (!run) throw new Error("Execution run was not found");
    const controller = this.#activeRuns.get(runId);
    if (controller) {
      controller.abort();
    }
    return run;
  }

  async execute(input: TestingExecutionInput): Promise<TestingExecutionRun> {
    const concurrency = input.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
      throw new Error("Test concurrency must be an integer between 1 and 4");
    }
    const target = new URL(input.targetUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("Test execution requires an http:// or https:// target URL");
    }
    const job = this.#store.generationJob(input.projectId, input.generationJobId);
    if (!job || job.status !== "completed") throw new Error("Choose a completed generation job");
    const artifacts = this.#store.executionArtifacts(input.generationJobId, input.caseIds);
    if (artifacts.length === 0)
      throw new Error("The selected generation job has no matching cases");
    const artifactRevision = shortDigest(
      artifacts.map((artifact) => `${artifact.caseId}:${artifact.specPath}`).join("|"),
    );
    const runId = crypto.randomUUID();
    const abortController = new AbortController();
    const { signal } = abortController;
    const runRoot = join(this.#testingRoot, "executions", runId);
    try {
      await mkdir(runRoot, { recursive: true });
      this.#store.beginExecutionRun({
        id: runId,
        projectId: input.projectId,
        generationJobId: input.generationJobId,
        mode: input.mode,
        targetUrl: target.href,
        artifactRevision,
      });
      this.#activeRuns.set(runId, abortController);
      const startedAt = Date.now();
      const results: TestingExecutionCaseResult[] = [];
      const proposals: Array<Omit<TestingHealingProposal, "id">> = [];
      const outputs: ProcessRunResult[] = [];
      const playwrightRoot = dirname(
        createRequire(import.meta.url).resolve("playwright/package.json"),
      );
      const cliPath = join(playwrightRoot, "cli.js");
      const graph = this.#store.graph(input.projectId);

      await runBounded(
        artifacts,
        concurrency,
        async (artifact) => {
          if (signal.aborted) return;
          try {
            const caseOutput = join(runRoot, artifact.caseId);
            await mkdir(caseOutput, { recursive: true });
            const configPath = join(runRoot, `${artifact.caseId}.playwright.config.mjs`);
            const reportPath = join(runRoot, `${artifact.caseId}.results.json`);
            const storageStatePath = join(
              this.#testingRoot,
              "auth",
              shortDigest(input.projectId),
              "storage-state.json",
            );
            const useOptions = {
              trace: "retain-on-failure",
              screenshot: input.visualComparison ? "on" : "only-on-failure",
              ...(existsSync(storageStatePath) ? { storageState: storageStatePath } : {}),
            };
            await writeFile(
              configPath,
              `export default { testDir: ${JSON.stringify(dirname(artifact.specPath))}, testMatch: ${JSON.stringify(basename(artifact.specPath))}, forbidOnly: true, retries: 0, reporter: [["line"], ["json", { outputFile: ${JSON.stringify(reportPath)} }]], outputDir: ${JSON.stringify(caseOutput)}, use: ${JSON.stringify(useOptions)} };\n`,
              "utf8",
            );
            const caseStartedAt = Date.now();
            const processResult = await this.#run(
              process.execPath,
              [cliPath, "test", basename(artifact.specPath), "--config", configPath, "--workers=1"],
              {
                cwd: dirname(artifact.specPath),
                timeoutMs: (input.timeoutSeconds ?? 120) * 1_000,
                maxBufferBytes: 512 * 1024,
                outputMode: "truncate",
                allowNonZeroExit: true,
                signal,
                env: {
                  ...process.env,
                  ELECTRON_RUN_AS_NODE: "1",
                  NODE_PATH: [dirname(playwrightRoot), process.env.NODE_PATH]
                    .filter(Boolean)
                    .join(delimiter),
                  TESTING_BASE_URL: target.href,
                },
              },
            );
            outputs.push(processResult);
            const tracePath = await findEvidence(caseOutput, ".zip");
            const screenshotPath = await findEvidence(caseOutput, ".png");
            let report: unknown;
            try {
              report = JSON.parse(await readFile(reportPath, "utf8"));
            } catch {
              // Missing/incomplete evidence is blocked, never a successful test.
            }
            const status = playwrightOutcome(processResult, report);
            const history = [
              ...this.#store.comparableCaseStatuses(artifact.caseId, artifactRevision),
              status,
            ].filter(
              (value): value is "passed" | "failed" => value === "passed" || value === "failed",
            );
            const flaky =
              history.length >= 3 && history.includes("passed") && history.includes("failed");
            let visualStatus: TestingExecutionCaseResult["visualStatus"] = "disabled";
            if (input.visualComparison && screenshotPath) {
              const hash = createHash("sha256")
                .update(await readFile(screenshotPath))
                .digest("hex");
              visualStatus = this.#store.compareVisualBaseline(
                artifact.caseId,
                hash,
                screenshotPath,
              );
            }
            results.push({
              caseId: artifact.caseId,
              externalId: artifact.externalId,
              status,
              durationMs: Date.now() - caseStartedAt,
              error:
                status === "passed"
                  ? null
                  : `${status === "blocked" ? "Execution incomplete: timeout, missing report, skipped or flaky tests.\n" : ""}${processResult.stderr || processResult.stdout}`.slice(
                      -8_000,
                    ),
              tracePath,
              screenshotPath,
              flaky,
              quarantined: flaky,
              visualStatus,
            });

            if (
              status === "failed" &&
              /locator|getByRole|element|waiting for/i.test(
                `${processResult.stdout}\n${processResult.stderr}`,
              )
            ) {
              for (const fingerprint of artifact.fingerprints) {
                const ranked = rankHealingCandidates(fingerprint, graph.edges);
                const best = ranked[0];
                if (
                  !best ||
                  (best.edge.role === fingerprint.role &&
                    best.edge.name === fingerprint.accessibleName)
                )
                  continue;
                const margin = best.confidence - (ranked[1]?.confidence ?? 0);
                const attempts =
                  this.#store.consecutiveHealingAttempts(artifact.caseId, fingerprint.locatorKey) +
                  1;
                const eligible =
                  best.confidence >= TESTING_HEAL_CONFIDENCE &&
                  margin >= TESTING_HEAL_MARGIN &&
                  attempts <= TESTING_HEAL_ATTEMPT_CAP;
                proposals.push({
                  caseId: artifact.caseId,
                  locatorKey: fingerprint.locatorKey,
                  previousRole: fingerprint.role,
                  previousName: fingerprint.accessibleName,
                  proposedRole: best.edge.role,
                  proposedName: best.edge.name,
                  confidence: best.confidence,
                  margin,
                  diff: `- getByRole(${JSON.stringify(fingerprint.role)}, { name: ${JSON.stringify(fingerprint.accessibleName)} })\n+ getByRole(${JSON.stringify(best.edge.role)}, { name: ${JSON.stringify(best.edge.name)} })`,
                  status: eligible ? "pending" : "below-threshold",
                  consecutiveAttempts: attempts,
                  ...(fingerprint.locatorEntryId
                    ? { locatorEntryId: fingerprint.locatorEntryId }
                    : {}),
                  ...(fingerprint.locatorVersionId
                    ? { locatorVersionId: fingerprint.locatorVersionId }
                    : {}),
                });
              }
            }
          } catch (error) {
            results.push({
              caseId: artifact.caseId,
              externalId: artifact.externalId,
              status: "blocked",
              durationMs: 0,
              error: signal.aborted
                ? "Execution cancelled"
                : error instanceof Error
                  ? error.message
                  : String(error),
              tracePath: null,
              screenshotPath: null,
              flaky: false,
              quarantined: false,
              visualStatus: "disabled",
            });
          }
        },
        signal,
      );

      const executedCaseIds = new Set(results.map((r) => r.caseId));
      for (const artifact of artifacts) {
        if (!executedCaseIds.has(artifact.caseId)) {
          results.push({
            caseId: artifact.caseId,
            externalId: artifact.externalId,
            status: "blocked",
            durationMs: 0,
            error: signal.aborted ? "Execution cancelled" : "Execution not reached",
            tracePath: null,
            screenshotPath: null,
            flaky: false,
            quarantined: false,
            visualStatus: "disabled",
          });
        }
      }

      const order = new Map(artifacts.map((artifact, index) => [artifact.caseId, index]));
      results.sort((a, b) => order.get(a.caseId)! - order.get(b.caseId)!);

      const durationMs = Date.now() - startedAt;
      const runStatus: TestingExecutionRun["status"] = signal.aborted
        ? "blocked"
        : results.every((result) => result.status === "passed")
          ? "passed"
          : "failed";
      const stdout = outputs
        .map((output) => output.stdout)
        .join("\n")
        .slice(-512 * 1024);
      const stderr = outputs
        .map((output) => output.stderr)
        .join("\n")
        .slice(-512 * 1024);
      this.#store.finishExecutionRun({
        runId,
        status: runStatus,
        durationMs,
        stdout,
        stderr,
        artifactRevision,
        results,
        proposals,
      });
      return this.#store.executionRuns(input.projectId).runs.find((run) => run.id === runId)!;
    } finally {
      this.#activeRuns.delete(runId);
    }
  }
}
