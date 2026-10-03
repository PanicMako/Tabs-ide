import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { ProviderInstanceId, type TestingCaseSummary } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";

import type { TextGenerationShape } from "../textGeneration/TextGeneration";
import { TestingGenerator, renderGenerationSteps } from "./generator";
import { TestingGraphStore } from "./graphStore";
import { LocatorLibraryStore } from "./locatorLibrary";

const execFile = promisify(execFileCallback);

async function runCommand(command: string, args: ReadonlyArray<string>) {
  try {
    return await execFile(command, [...args]);
  } catch (error) {
    const output = error as Error & { stdout?: string; stderr?: string };
    throw new Error([output.message, output.stdout, output.stderr].filter(Boolean).join("\n"));
  }
}

async function waitFor(
  fn: () => void | Promise<void>,
  timeoutMs = 2000,
  intervalMs = 20,
): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      await fn();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError;
}

function textGeneration(generate = vi.fn()) {
  const service = {
    generateCommitMessage: vi.fn(),
    generatePrContent: vi.fn(),
    generateBranchName: vi.fn(),
    generateThreadTitle: vi.fn(),
    generateDiffSummary: vi.fn(),
    generateStructuredTesting: generate.mockImplementation(() =>
      Effect.succeed({
        featureSlug: "account-settings",
        testTitle: "opens account settings",
        assertionText: "Account settings",
        steps: [{ locatorKey: "account1", action: "click", value: "" }],
      }),
    ),
  };
  return service as unknown as TextGenerationShape;
}

function seedAcceptedCase(store: TestingGraphStore): TestingCaseSummary {
  const runId = store.beginRun("project", "https://example.test/settings");
  store.upsertNode({
    projectId: "project",
    runId,
    stateId: "home",
    pageUrl: "https://example.test/settings",
    pageTitle: "Settings",
    snapshot: '- main "Settings"',
  });
  store.upsertNode({
    projectId: "project",
    runId,
    stateId: "account",
    pageUrl: "https://example.test/settings/account",
    pageTitle: "Account settings",
    snapshot: '- heading "Account settings"',
  });
  store.upsertEdge({
    projectId: "project",
    runId,
    fromStateId: "home",
    toStateId: "account",
    role: "link",
    name: "Account",
  });
  store.finishRun(runId, "completed");
  const imported = store.saveImportedCases({
    projectId: "project",
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
    ],
  });
  return store.reviewCase({
    projectId: "project",
    caseId: imported.cases[0]!.id,
    decision: "accepted",
  }).cases[0]!;
}

function generationInput(projectPath: string) {
  return {
    projectId: "project",
    projectPath,
    framework: "playwright-ts" as const,
    modelSelection: {
      instanceId: ProviderInstanceId.makeUnsafe("codex"),
      model: "gpt-5.3-codex",
    },
    reasoningTier: "medium" as const,
  };
}

describe("TestingGenerator", () => {
  it("renders the reviewed action types instead of clicking every locator", () => {
    expect(
      renderGenerationSteps(
        {
          featureSlug: "form",
          testTitle: "fills form",
          assertionText: "Saved",
          steps: [
            { locatorKey: "name", action: "fill", value: "Rushil" },
            { locatorKey: "country", action: "selectOption", value: "India" },
            { locatorKey: "terms", action: "check", value: "" },
            { locatorKey: "save", action: "click", value: "" },
            { locatorKey: "notice", action: "assertText", value: "Saved" },
          ],
        },
        ["name", "country", "terms", "save", "notice"].map((key) => ({ key })),
      ),
    ).toEqual([
      '  await app.name.fill("Rushil");',
      '  await app.country.selectOption("India");',
      "  await app.terms.check();",
      "  await app.save.click();",
      '  await expect(app.notice).toHaveText("Saved");',
    ]);
    expect(() =>
      renderGenerationSteps(
        {
          featureSlug: "x",
          testTitle: "x",
          assertionText: "x",
          steps: [{ locatorKey: "invented", action: "click", value: "" }],
        },
        [{ key: "real" }],
      ),
    ).toThrow("Unknown locator");
  });
  it("generates separate POM, data, and spec artifacts with locator fingerprints", async () => {
    const root = await mkdtemp(
      join(
        process.env.TABS_VERIFY_GENERATED_SUITE ? process.cwd() : tmpdir(),
        "tabs-testing-generation-",
      ),
    );
    const databasePath = join(root, "state.sqlite");
    const store = new TestingGraphStore(databasePath);
    const locatorStore = new LocatorLibraryStore(databasePath);
    const localGenerate = vi.fn();
    try {
      seedAcceptedCase(store);
      const generator = new TestingGenerator(
        store,
        locatorStore,
        join(root, "state"),
        textGeneration(localGenerate),
      );
      const job = await generator.generate(generationInput(root));

      expect(job).toMatchObject({
        status: "completed",
        completedCases: 1,
        totalCases: 1,
      });
      expect(job.modelSelection).toMatchObject({
        instanceId: "codex",
        model: "gpt-5.3-codex",
      });
      expect(job.artifacts).toHaveLength(1);
      expect(job.artifacts[0]?.fingerprintCount).toBe(1);
      const artifact = job.artifacts[0]!;
      const [page, data, spec] = await Promise.all([
        readFile(artifact.pageObjectPath, "utf8"),
        readFile(artifact.dataPath, "utf8"),
        readFile(artifact.specPath, "utf8"),
      ]);
      expect(page).toContain('page.getByRole("link"');
      expect(page).toContain("async activateAccount1");
      expect(data).toContain('caseId": "QA-101"');
      expect(data).toContain('"expectedResult"');
      expect(data).toContain('"assertionText"');
      expect(spec).toContain("await app.account1.click()");
      expect(spec).not.toContain("Open account settings");
      // Verify the prompt sent to the LLM was enriched with the expected result.
      const promptArg =
        (localGenerate.mock.calls[0]?.[0] as { sanitizedPrompt?: string } | undefined)
          ?.sanitizedPrompt ?? "";
      expect(promptArg).toContain("Expected Result:");
      if (process.env.TABS_VERIFY_GENERATED_SUITE) {
        await runCommand("bunx", [
          "tsc",
          "--noEmit",
          "--strict",
          "--skipLibCheck",
          "--target",
          "ES2022",
          "--module",
          "ESNext",
          "--moduleResolution",
          "Bundler",
          artifact.pageObjectPath,
          artifact.dataPath,
          artifact.specPath,
        ]);
        const configPath = join(root, "playwright.generated.config.ts");
        await writeFile(
          configPath,
          `import { defineConfig } from "playwright/test";\nexport default defineConfig({ testDir: ${JSON.stringify(dirname(artifact.specPath))} });\n`,
          "utf8",
        );
        const discovery = await runCommand(process.execPath, [
          join(process.cwd(), "node_modules", "playwright", "cli.js"),
          "test",
          "--config",
          configPath,
          "--list",
        ]);
        expect(discovery.stdout).toContain("opens account settings");
      }
    } finally {
      locatorStore.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses a declarative company manifest for repository layout", async () => {
    const root = await mkdtemp(join(tmpdir(), "tabs-testing-template-"));
    const databasePath = join(root, "state.sqlite");
    const store = new TestingGraphStore(databasePath);
    const locatorStore = new LocatorLibraryStore(databasePath);
    try {
      seedAcceptedCase(store);
      await mkdir(join(root, "testing"), { recursive: true });
      await writeFile(
        join(root, "testing", "company.json"),
        JSON.stringify({
          version: 1,
          name: "Company layout",
          directories: {
            pages: "qa/pages",
            data: "qa/data",
            specs: "qa/specs",
          },
          filePatterns: {
            pageObject: "{feature}/{caseId}.page.ts",
            data: "{feature}/{caseId}.data.ts",
            spec: "{feature}/{caseId}.spec.ts",
          },
          classPattern: "{featurePascal}Screen",
        }),
        "utf8",
      );
      const generator = new TestingGenerator(
        store,
        locatorStore,
        join(root, "state"),
        textGeneration(),
      );
      const job = await generator.generate({
        ...generationInput(root),
        outputMode: "repository",
        repositoryOutputPath: "generated",
        templatePath: "testing/company.json",
      });

      expect(job.status).toBe("completed");
      expect(job.artifacts[0]?.pageObjectPath).toContain(
        join("generated", "qa", "pages", "account-settings", "qa-101.page.ts"),
      );
      expect(await readFile(job.artifacts[0]!.pageObjectPath, "utf8")).toContain(
        "class AccountSettingsScreen",
      );
    } finally {
      locatorStore.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stops before provider dispatch when the next case exceeds a budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "tabs-testing-budget-"));
    const databasePath = join(root, "state.sqlite");
    const store = new TestingGraphStore(databasePath);
    const locatorStore = new LocatorLibraryStore(databasePath);
    const generate = vi.fn();
    try {
      seedAcceptedCase(store);
      const generator = new TestingGenerator(
        store,
        locatorStore,
        join(root, "state"),
        textGeneration(generate),
      );
      const job = await generator.generate({
        ...generationInput(root),
        maxEstimatedTokens: 1,
      });

      expect(job).toMatchObject({
        status: "budget-stopped",
        completedCases: 0,
      });
      expect(generate).not.toHaveBeenCalled();
    } finally {
      locatorStore.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists and returns a background job before preflight finishes", async () => {
    const root = await mkdtemp(join(tmpdir(), "tabs-testing-background-job-"));
    const databasePath = join(root, "state.sqlite");
    const store = new TestingGraphStore(databasePath);
    const locatorStore = new LocatorLibraryStore(databasePath);
    try {
      seedAcceptedCase(store);
      const generator = new TestingGenerator(
        store,
        locatorStore,
        join(root, "state"),
        textGeneration(),
      );
      const job = await generator.generate(generationInput(root), {
        background: true,
        beforeRun: async () => {
          throw new Error("Locator preflight failed");
        },
      });

      expect(["queued", "running"]).toContain(job.status);
      await waitFor(() => {
        expect(store.generationJob("project", job.id)).toMatchObject({
          status: "failed",
          error: "Locator preflight failed",
        });
      });
    } finally {
      locatorStore.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("enforces maximum repair attempts and tracks lifecycle stages", async () => {
    const root = await mkdtemp(join(tmpdir(), "tabs-testing-repair-capping-"));
    const databasePath = join(root, "state.sqlite");
    const store = new TestingGraphStore(databasePath);
    const locatorStore = new LocatorLibraryStore(databasePath);
    try {
      seedAcceptedCase(store);
      const generator = new TestingGenerator(
        store,
        locatorStore,
        join(root, "state"),
        textGeneration(),
      );

      // Initial job
      const job1 = await generator.generate(generationInput(root));
      expect(job1.stage).toBe("generated");
      expect(job1.attemptCount).toBe(1);

      // First repair attempt (attempt 2)
      const job2 = await generator.generate({
        ...generationInput(root),
        parentJobId: job1.id,
      });
      expect(job2.stage).toBe("repair-proposed");
      expect(job2.attemptCount).toBe(2);

      // Second repair attempt (attempt 3 - should throw)
      await expect(
        generator.generate({
          ...generationInput(root),
          parentJobId: job2.id,
        }),
      ).rejects.toThrow("Maximum repair attempts exceeded (2)");

      // Explicit attemptCount > 2 should also throw
      await expect(
        generator.generate({
          ...generationInput(root),
          attemptCount: 3,
        }),
      ).rejects.toThrow("Maximum repair attempts exceeded (2)");
    } finally {
      locatorStore.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
