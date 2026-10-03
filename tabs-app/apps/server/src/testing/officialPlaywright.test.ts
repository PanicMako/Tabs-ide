import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { ProviderInstanceId, type TestingCaseSummary } from "@tabs/contracts";
import type { TextGenerationShape } from "../textGeneration/TextGeneration";
import { generateOfficialPlaywright } from "./officialPlaywright";

describe("official Playwright candidate integration (no model calls)", () => {
  it("passes tools and selected model to the backend and validates its candidate with Playwright", async () => {
    const root = await mkdtemp(join(process.cwd(), "official-agent-test-"));
    const modelSelection = {
      instanceId: ProviderInstanceId.makeUnsafe("chosen-codex"),
      model: "chosen-model",
    };
    let captured: unknown;
    const textGeneration = {
      generateStructuredTesting: (input: { cwd: string }) =>
        Effect.tryPromise(async () => {
          captured = input;
          await writeFile(
            join(input.cwd, "tests/generated.spec.ts"),
            'import { test, expect } from "playwright/test"; test("reviewed candidate", () => { expect(1).toBe(1); });',
          );
          return { summary: "Mock candidate only", blockedReason: "" };
        }),
    } as unknown as TextGenerationShape;
    try {
      const files = await generateOfficialPlaywright({
        request: {
          projectId: "project",
          projectPath: root,
          targetUrl: "https://example.test",
          modelSelection,
        },
        testCase: {
          id: "case",
          externalId: "TC-1",
          steps: ["Open page"],
          expectedResult: "Page appears",
        } as unknown as TestingCaseSummary,
        outputDirectory: root,
        textGeneration,
      });
      expect(captured).toMatchObject({
        modelSelection,
        playwrightTools: { cwd: expect.stringContaining("agent-") },
      });
      expect(await readFile(files.specPath, "utf8")).toContain("reviewed candidate");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("does not accept a blocked agent response as generated code", async () => {
    const root = await mkdtemp(join(process.cwd(), "official-agent-blocked-"));
    try {
      await expect(
        generateOfficialPlaywright({
          request: {
            projectId: "project",
            projectPath: root,
            targetUrl: "https://example.test",
            modelSelection: {
              instanceId: ProviderInstanceId.makeUnsafe("codex"),
              model: "selected",
            },
          },
          testCase: {
            id: "case",
            steps: [],
            expectedResult: "Page",
          } as unknown as TestingCaseSummary,
          outputDirectory: root,
          textGeneration: {
            generateStructuredTesting: () =>
              Effect.succeed({ summary: "", blockedReason: "Authentication required" }),
          } as unknown as TextGenerationShape,
        }),
      ).rejects.toThrow("Authentication required");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks repair for non-repairable product assertion failure", async () => {
    const root = await mkdtemp(join(process.cwd(), "official-agent-non-repairable-"));
    try {
      await expect(
        generateOfficialPlaywright({
          request: {
            projectId: "project",
            projectPath: root,
            targetUrl: "https://example.test",
            modelSelection: {
              instanceId: ProviderInstanceId.makeUnsafe("codex"),
              model: "selected",
            },
          },
          testCase: {
            id: "case",
            steps: [],
            expectedResult: "Page",
          } as unknown as TestingCaseSummary,
          outputDirectory: root,
          textGeneration: {} as unknown as TextGenerationShape,
          previousSpec:
            'import { test, expect } from "playwright/test"; test("x", () => { expect(1).toBe(1); });',
          failureEvidence:
            "Error: expect(received).toEqual(expected) - Expected '404', Received '200'",
        }),
      ).rejects.toThrow("failure classified as product-assertion");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects weakened assertions when repairing a test", async () => {
    const root = await mkdtemp(join(process.cwd(), "official-agent-weakened-"));
    const textGeneration = {
      generateStructuredTesting: (input: { cwd: string }) =>
        Effect.tryPromise(async () => {
          await writeFile(
            join(input.cwd, "tests/generated.spec.ts"),
            'import { test, expect } from "playwright/test"; test("weakened", () => { expect(1).toBe(1); });',
          );
          return { summary: "Weakened candidate", blockedReason: "" };
        }),
    } as unknown as TextGenerationShape;
    try {
      await expect(
        generateOfficialPlaywright({
          request: {
            projectId: "project",
            projectPath: root,
            targetUrl: "https://example.test",
            modelSelection: {
              instanceId: ProviderInstanceId.makeUnsafe("codex"),
              model: "selected",
            },
          },
          testCase: {
            id: "case",
            steps: [],
            expectedResult: "Page",
          } as unknown as TestingCaseSummary,
          outputDirectory: root,
          textGeneration,
          previousSpec:
            'import { test, expect } from "playwright/test"; test("x", () => { expect(1).toBe(1); expect(2).toBe(2); });',
          failureEvidence:
            "TimeoutError: locator.click: Timeout 5000ms waiting for locator('#button')",
        }),
      ).rejects.toThrow("Weakened assertions");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects skipped or excluded tests in generated candidate", async () => {
    const root = await mkdtemp(join(process.cwd(), "official-agent-skipped-"));
    const textGeneration = {
      generateStructuredTesting: (input: { cwd: string }) =>
        Effect.tryPromise(async () => {
          await writeFile(
            join(input.cwd, "tests/generated.spec.ts"),
            'import { test, expect } from "playwright/test"; test.skip("skipped test", () => { expect(1).toBe(1); });',
          );
          return { summary: "Skipped candidate", blockedReason: "" };
        }),
    } as unknown as TextGenerationShape;
    try {
      await expect(
        generateOfficialPlaywright({
          request: {
            projectId: "project",
            projectPath: root,
            targetUrl: "https://example.test",
            modelSelection: {
              instanceId: ProviderInstanceId.makeUnsafe("codex"),
              model: "selected",
            },
          },
          testCase: {
            id: "case",
            steps: [],
            expectedResult: "Page",
          } as unknown as TestingCaseSummary,
          outputDirectory: root,
          textGeneration,
        }),
      ).rejects.toThrow("Agent output contains excluded/expected-failure tests");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
