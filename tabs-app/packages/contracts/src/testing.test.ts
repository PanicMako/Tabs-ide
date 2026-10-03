import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import {
  DEFAULT_TESTING_MAX_STATES,
  MAX_TESTING_DURATION_SECONDS,
  MAX_TESTING_MAX_STATES,
  TestingCaseIdPolicyInput,
  TestingExplorationInput,
  TestingGenerationInput,
  TestingLocatorDiscoveryInput,
  TestingCaseReviewInput,
  TestingWorkbookImportInput,
} from "./testing";

const decodeExplorationInput = Schema.decodeUnknownSync(TestingExplorationInput);

describe("TestingExplorationInput", () => {
  it("accepts a configurable state limit", () => {
    expect(
      decodeExplorationInput({
        projectId: "project",
        targetUrl: "https://example.test",
        cdpEndpoint: "http://127.0.0.1:9224",
        scope: "path",
        maxStates: 150,
        maxDurationSeconds: 300,
      }),
    ).toMatchObject({
      maxStates: 150,
      maxDurationSeconds: 300,
      scope: "path",
      cdpEndpoint: "http://127.0.0.1:9224",
    });
  });

  it("allows callers to use the crawler default", () => {
    const decoded = decodeExplorationInput({
      projectId: "project",
      targetUrl: "https://example.test",
    });
    expect(decoded.maxStates ?? DEFAULT_TESTING_MAX_STATES).toBe(DEFAULT_TESTING_MAX_STATES);
  });

  it.each([0, 1.5, MAX_TESTING_MAX_STATES + 1])("rejects invalid state limit %s", (maxStates) => {
    expect(() =>
      decodeExplorationInput({
        projectId: "project",
        targetUrl: "https://example.test",
        maxStates,
      }),
    ).toThrow();
  });

  it.each([0, 1.5, MAX_TESTING_DURATION_SECONDS + 1])(
    "rejects invalid time budget %s",
    (maxDurationSeconds) => {
      expect(() =>
        decodeExplorationInput({
          projectId: "project",
          targetUrl: "https://example.test",
          maxDurationSeconds,
        }),
      ).toThrow();
    },
  );

  it("rejects unknown scope modes", () => {
    expect(() =>
      decodeExplorationInput({
        projectId: "project",
        targetUrl: "https://example.test",
        scope: "workspace",
      }),
    ).toThrow();
  });
});

describe("Testing Phase 2 inputs", () => {
  it("decodes workbook imports and review decisions", () => {
    expect(
      Schema.decodeUnknownSync(TestingWorkbookImportInput)({
        projectId: "project",
        workbookPath: "/tmp/cases.xlsx",
        targetUrl: "https://example.test",
      }),
    ).toMatchObject({ workbookPath: "/tmp/cases.xlsx" });
    expect(
      Schema.decodeUnknownSync(TestingCaseReviewInput)({
        projectId: "project",
        caseId: "case",
        decision: "edited",
        externalId: "QA-002",
        description: "Updated",
        steps: ["Open page"],
      }),
    ).toMatchObject({ decision: "edited", externalId: "QA-002" });
  });

  it("rejects unsupported review decisions", () => {
    expect(() =>
      Schema.decodeUnknownSync(TestingCaseReviewInput)({
        projectId: "project",
        caseId: "case",
        decision: "approved",
      }),
    ).toThrow();
  });
});

describe("Testing Phase 3 inputs", () => {
  const validInput = {
    projectId: "project",
    projectPath: "/tmp/project",
    framework: "playwright-ts",
    modelSelection: { instanceId: "codex", model: "gpt-5" },
    reasoningTier: "medium",
    outputMode: "managed",
    maxCases: 25,
    maxEstimatedTokens: 200_000,
    maxEstimatedCostUsd: 5,
  };

  it("accepts provider routing, template, output, and budget controls", () => {
    expect(
      Schema.decodeUnknownSync(TestingGenerationInput)({
        ...validInput,
        outputMode: "repository",
        repositoryOutputPath: "tests/e2e/generated",
        templatePath: "testing/templates/company.json",
        captureReplay: true,
      }),
    ).toMatchObject({
      framework: "playwright-ts",
      reasoningTier: "medium",
      outputMode: "repository",
      captureReplay: true,
    });
  });

  it.each([
    { maxCases: 0 },
    { maxEstimatedTokens: 0 },
    { maxEstimatedCostUsd: 0 },
    { framework: "selenium" },
    { reasoningTier: "unbounded" },
  ])("rejects unsupported or non-positive generation controls: %o", (patch) => {
    expect(() =>
      Schema.decodeUnknownSync(TestingGenerationInput)({ ...validInput, ...patch }),
    ).toThrow();
  });
});

describe("Testing Phase 6 workspace inputs", () => {
  it("decodes task-focused locator capture and configurable case IDs", () => {
    expect(
      Schema.decodeUnknownSync(TestingLocatorDiscoveryInput)({
        projectId: "project",
        targetUrl: "https://example.test/account",
        environmentLabel: "uat",
        mode: "guided",
        scope: "path",
        coverage: "actions-assertions",
        safetyProfile: "supervised",
        maxElementsPerPage: 500,
        maxPagesPerSession: 25,
        captureScope: "task",
        taskContext: "Update the account profile",
      }),
    ).toMatchObject({ captureScope: "task", scope: "path" });
    expect(
      Schema.decodeUnknownSync(TestingCaseIdPolicyInput)({
        projectId: "project",
        prefix: "QA-",
        padding: 4,
        nextSequence: 42,
      }),
    ).toMatchObject({ prefix: "QA-", padding: 4, nextSequence: 42 });
  });

  it("rejects invalid Case ID widths", () => {
    expect(() =>
      Schema.decodeUnknownSync(TestingCaseIdPolicyInput)({
        projectId: "project",
        prefix: "TC-",
        padding: 0,
        nextSequence: 1,
      }),
    ).toThrow();
  });
});
