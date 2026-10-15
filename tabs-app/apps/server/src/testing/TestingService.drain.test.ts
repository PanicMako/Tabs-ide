import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ProviderInstanceId, type TestingCaseSummary } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vitest";

import { TestingService } from "./TestingService.ts";
import { TestingGraphStore } from "./graphStore.ts";
import { TestingExecutor } from "./execution.ts";
import { TestingGenerator } from "./generator.ts";
import { LocatorLibraryStore } from "./locatorLibrary.ts";
import type { TextGenerationShape } from "../textGeneration/TextGeneration.ts";
import type { ProcessRunResult } from "../processRunner.ts";
import type { PlaywrightMcpSession } from "./playwrightMcp.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function makeTempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "testing-service-drain-"));
  roots.push(dir);
  return dir;
}

function seedAcceptedCase(store: TestingGraphStore, projectId = "proj-drain"): TestingCaseSummary {
  const runId = store.beginRun(projectId, "https://example.test/settings");
  store.upsertNode({
    projectId,
    runId,
    stateId: "home",
    pageUrl: "https://example.test/settings",
    pageTitle: "Settings",
    snapshot: '- main "Settings"',
  });
  store.upsertNode({
    projectId,
    runId,
    stateId: "account",
    pageUrl: "https://example.test/settings/account",
    pageTitle: "Account settings",
    snapshot: '- heading "Account settings"',
  });
  store.upsertEdge({
    projectId,
    runId,
    fromStateId: "home",
    toStateId: "account",
    role: "link",
    name: "Account",
  });
  store.finishRun(runId, "completed");
  const imported = store.saveImportedCases({
    projectId,
    workbookName: "company.xlsx",
    workbookPath: "/tmp/company.xlsx",
    cases: [
      {
        externalId: "QA-101",
        description: "Open account settings",
        steps: ["Open Settings", "Choose Account"],
        expectedResults: ["Settings are visible", "Account Settings page is visible"],
        expectedResult: "Account Settings page is visible",
        sourceSheet: "Cases",
        sourceRow: 2,
        status: "matches",
        mismatches: [],
        matchedStateIds: ["home", "account"],
      },
      {
        externalId: "QA-102",
        description: "Open account settings secondary",
        steps: ["Open Settings", "Choose Account"],
        expectedResults: ["Settings are visible", "Account Settings page is visible"],
        expectedResult: "Account Settings page is visible",
        sourceSheet: "Cases",
        sourceRow: 3,
        status: "matches",
        mismatches: [],
        matchedStateIds: ["home", "account"],
      },
    ],
  });
  return store.reviewCase({
    projectId,
    caseId: imported.cases[0]!.id,
    decision: "accepted",
  }).cases[0]!;
}

describe("TestingService and component lifecycle drain", () => {
  it("TestingExecutor waits for active execution to abort and complete during close", async () => {
    const root = await makeTempRoot();
    const testingRoot = join(root, "testing");
    const dbPath = join(testingRoot, "state-graph.sqlite");
    const store = new TestingGraphStore(dbPath);

    let processStarted = false;
    let processAborted = false;
    let processResolve: (() => void) | null = null;

    const mockRun = async (
      _execPath: string,
      _args: string[],
      opts: { signal?: AbortSignal },
    ): Promise<ProcessRunResult> => {
      processStarted = true;
      if (opts.signal) {
        opts.signal.addEventListener("abort", () => {
          processAborted = true;
          processResolve?.();
        });
      }
      return new Promise<ProcessRunResult>((resolve) => {
        processResolve = () =>
          resolve({
            stdout: "",
            stderr: opts.signal?.aborted ? "Aborted by signal" : "",
            code: opts.signal?.aborted ? 1 : 0,
            signal: opts.signal?.aborted ? "SIGTERM" : null,
            timedOut: false,
          });
      });
    };

    const executor = new TestingExecutor(store, testingRoot, mockRun as any);

    const testCase = seedAcceptedCase(store, "proj-drain");
    const jobId = crypto.randomUUID();
    const specPath = join(root, "test.spec.ts");
    await writeFile(specPath, "import 'playwright';");

    store.createGenerationJob({
      id: jobId,
      projectId: "proj-drain",
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
      caseId: testCase.id,
      externalId: "QA-101",
      featureSlug: "feature",
      pageObjectPath: join(root, "page.ts"),
      dataPath: join(root, "data.ts"),
      specPath,
      fingerprints: [],
      captureReplay: false,
    });

    const executionPromise = executor.execute({
      projectId: "proj-drain",
      generationJobId: jobId,
      caseIds: [testCase.id],
      targetUrl: "http://localhost:3000",
      mode: "standalone",
    });

    while (!processStarted) {
      await new Promise((r) => setTimeout(r, 10));
    }

    let closeDone = false;
    const closePromise = executor.close().then(() => {
      closeDone = true;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(processAborted).toBe(true);

    await closePromise;
    expect(closeDone).toBe(true);

    const result = await executionPromise;
    expect(result.status).toBe("blocked");

    // Rejects after close
    await expect(
      executor.execute({
        projectId: "proj-drain",
        generationJobId: jobId,
        caseIds: [testCase.id],
        targetUrl: "http://localhost:3000",
        mode: "standalone",
      }),
    ).rejects.toThrow("shutting down");

    store.close();
  });

  it("TestingGenerator interrupts active fiber and drains queueTail on close", async () => {
    const root = await makeTempRoot();
    const testingRoot = join(root, "testing");
    const dbPath = join(testingRoot, "state-graph.sqlite");
    const store = new TestingGraphStore(dbPath);
    const locatorStore = new LocatorLibraryStore(dbPath);

    let activeInterrupted = false;

    const mockTextGeneration: TextGenerationShape = {
      generateStructuredTesting: () =>
        Effect.callback((resume, signal) => {
          signal.addEventListener("abort", () => {
            activeInterrupted = true;
          });
        }) as any,
    } as any;

    const generator = new TestingGenerator(store, locatorStore, testingRoot, mockTextGeneration);
    const testCase = seedAcceptedCase(store, "proj-drain");

    const genPromise = generator.generate({
      projectId: "proj-drain",
      caseIds: [testCase.id],
      projectPath: root,
      modelSelection: {
        instanceId: ProviderInstanceId.makeUnsafe("codex"),
        model: "gpt-5.3-codex",
      },
    });

    await new Promise((r) => setTimeout(r, 30));

    await generator.close();

    expect(activeInterrupted).toBe(true);

    const job = await genPromise;
    expect(["cancelled", "failed"]).toContain(job.status);

    await expect(
      generator.generate({
        projectId: "proj-drain",
        caseIds: [testCase.id],
        projectPath: root,
        modelSelection: {
          instanceId: ProviderInstanceId.makeUnsafe("codex"),
          model: "gpt-5.3-codex",
        },
      }),
    ).rejects.toThrow("shutting down");

    locatorStore.close();
    store.close();
  });

  it("TestingGenerator drains queued jobs during close", async () => {
    const root = await makeTempRoot();
    const testingRoot = join(root, "testing");
    const dbPath = join(testingRoot, "state-graph.sqlite");
    const store = new TestingGraphStore(dbPath);
    const locatorStore = new LocatorLibraryStore(dbPath);

    let activeInterrupted = false;

    const mockTextGeneration: TextGenerationShape = {
      generateStructuredTesting: () =>
        Effect.callback((resume, signal) => {
          signal.addEventListener("abort", () => {
            activeInterrupted = true;
          });
        }) as any,
    } as any;

    const generator = new TestingGenerator(store, locatorStore, testingRoot, mockTextGeneration);
    const testCase = seedAcceptedCase(store, "proj-drain");

    const job1Promise = generator.generate({
      projectId: "proj-drain",
      caseIds: [testCase.id],
      projectPath: root,
      modelSelection: {
        instanceId: ProviderInstanceId.makeUnsafe("codex"),
        model: "gpt-5.3-codex",
      },
    });

    const job2Promise = generator.generate({
      projectId: "proj-drain",
      caseIds: [testCase.id],
      projectPath: root,
      modelSelection: {
        instanceId: ProviderInstanceId.makeUnsafe("codex"),
        model: "gpt-5.3-codex",
      },
    });

    await new Promise((r) => setTimeout(r, 30));

    await generator.close();

    expect(activeInterrupted).toBe(true);

    const [j1, j2] = await Promise.all([job1Promise, job2Promise]);
    expect(["cancelled", "failed"]).toContain(j1.status);
    expect(["cancelled", "failed"]).toContain(j2.status);

    locatorStore.close();
    store.close();
  });

  it("TestingService coordinates shutdown across sessions and stores cleanly and idempotently", async () => {
    const root = await makeTempRoot();
    const service = new TestingService(root);

    // Start a locator discovery session
    const session = await service.startLocatorDiscovery({
      projectId: "drain-test",
      targetUrl: "https://www.google.com/",
      mode: "guided",
      scope: "page",
      coverage: "actions-assertions",
      safetyProfile: "read-only",
      maxElementsPerPage: 10,
      maxPagesPerSession: 1,
      previewSnapshot: {
        url: "https://www.google.com/",
        snapshot: '- heading "Google"',
      },
    });
    expect(session.id).toBeDefined();

    // First close
    await service.close();

    // Second close is idempotent
    await expect(service.close()).resolves.toBeUndefined();

    // Further operations reject because service is shutting down
    await expect(
      service.startLocatorDiscovery({
        projectId: "drain-test",
        targetUrl: "https://www.google.com/",
        mode: "guided",
        scope: "page",
        coverage: "actions-assertions",
        safetyProfile: "read-only",
        maxElementsPerPage: 10,
        maxPagesPerSession: 1,
      }),
    ).rejects.toThrow("shutting down");
  });

  it("TestingService cancels and drains active crawler exploration before closing stores", async () => {
    const root = await makeTempRoot();
    let crawlerPausedInCall = false;
    let callAbortedOrResolved = false;
    let sessionClosed = false;
    let storeClosed = false;
    let unpausePromiseResolve: (() => void) | null = null;
    const unpausePromise = new Promise<void>((resolve) => {
      unpausePromiseResolve = resolve;
    });

    const mockSession: PlaywrightMcpSession = {
      call: async (name: string) => {
        if (name === "browser_navigate") {
          crawlerPausedInCall = true;
          unpausePromiseResolve?.();
          return new Promise<string>((_resolve, reject) => {
            const checkInterval = setInterval(() => {
              if (sessionClosed) {
                clearInterval(checkInterval);
                callAbortedOrResolved = true;
                reject(new Error("Session closed while executing call"));
              }
            }, 10);
          });
        }
        return "snapshot content";
      },
      close: async () => {
        sessionClosed = true;
      },
    };

    const service = new TestingService(root, undefined, async () => mockSession);

    const explorePromise = service.startExploration({
      projectId: "drain-crawler-test",
      targetUrl: "http://localhost:3000/app",
    });

    // Wait until the crawler is paused inside browser_navigate
    await unpausePromise;
    expect(crawlerPausedInCall).toBe(true);
    expect(sessionClosed).toBe(false);

    // Call close while crawler is active and paused
    // Call close concurrently multiple times to verify idempotence
    const closePromise1 = service.close();
    const closePromise2 = service.close();

    // Verify close waits for crawler cancellation and session cleanup before resolving
    await Promise.all([closePromise1, closePromise2]);

    expect(sessionClosed).toBe(true);
    expect(callAbortedOrResolved).toBe(true);

    // explorePromise should have rejected due to cancellation
    await expect(explorePromise).rejects.toThrow();

    // Repeated close calls still resolve
    await expect(service.close()).resolves.toBeUndefined();

    // After close, service rejects new exploration operations
    await expect(
      service.startExploration({
        projectId: "drain-crawler-test",
        targetUrl: "http://localhost:3000/app",
      }),
    ).rejects.toThrow("shutting down");
  });

  it("TestingService cancels and drains automatic locator discovery crawler before closing stores", async () => {
    const root = await makeTempRoot();
    let crawlerPausedInCall = false;
    let sessionClosed = false;
    let unpauseResolve: (() => void) | null = null;
    const unpausePromise = new Promise<void>((resolve) => {
      unpauseResolve = resolve;
    });

    const mockSession: PlaywrightMcpSession = {
      call: async (name: string) => {
        if (name === "browser_navigate") {
          crawlerPausedInCall = true;
          unpauseResolve?.();
          return new Promise<string>((_, reject) => {
            const checkInterval = setInterval(() => {
              if (sessionClosed) {
                clearInterval(checkInterval);
                reject(new Error("Session closed"));
              }
            }, 10);
          });
        }
        return "snapshot content";
      },
      close: async () => {
        sessionClosed = true;
      },
    };

    const service = new TestingService(root, undefined, async () => mockSession);

    const discoveryPromise = service.startLocatorDiscovery({
      projectId: "drain-locator-crawler-test",
      targetUrl: "http://localhost:3000/app",
      mode: "automatic",
      scope: "page",
      coverage: "actions-assertions",
      safetyProfile: "read-only",
      maxElementsPerPage: 10,
      maxPagesPerSession: 1,
    });

    await unpausePromise;
    expect(crawlerPausedInCall).toBe(true);
    expect(sessionClosed).toBe(false);

    // Call close while locator discovery crawler is running
    const closePromise1 = service.close();
    const closePromise2 = service.close();

    await Promise.all([closePromise1, closePromise2]);

    expect(sessionClosed).toBe(true);

    await expect(discoveryPromise).rejects.toThrow();

    // Subsequent calls reject
    await expect(
      service.startLocatorDiscovery({
        projectId: "drain-locator-crawler-test",
        targetUrl: "http://localhost:3000/app",
        mode: "automatic",
        scope: "page",
        coverage: "actions-assertions",
        safetyProfile: "read-only",
        maxElementsPerPage: 10,
        maxPagesPerSession: 1,
      }),
    ).rejects.toThrow("shutting down");
  });
});
