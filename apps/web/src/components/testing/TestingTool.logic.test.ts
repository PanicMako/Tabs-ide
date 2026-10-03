import { describe, expect, it } from "vitest";
import type { ProjectId, TestingLocatorEntry } from "@tabs/contracts";
import { testingLocatorCode, testingLocatorHasRedactedArgument } from "./utils";
import { testingReasoningTierFromOptions, createEmptyBrowserSessionState } from "./TestingWidgets";
import { TestingOverview } from "./TestingOverview";
import { TestingDiscover } from "./TestingDiscover";
import { TestingCases } from "./TestingCases";
import { TestingAutomate } from "./TestingAutomate";
import { TestingRuns } from "./TestingRuns";
import { TestingReports } from "./TestingReports";

describe("Testing Tool Utils & Logic", () => {
  it("formats testing locator code correctly", () => {
    const entry: TestingLocatorEntry = {
      id: "loc-1",
      pageId: "page-1",
      locatorKey: "submitButton",
      classification: "action",
      strategy: "role",
      arguments: { role: "button", name: "Submit" },
      semanticContext: "Submit form",
      source: "discovered",
      sourceFile: null,
      sourceLine: null,
      lifecycleStatus: "accepted",
      syncStatus: "managed",
      fragile: false,
      currentVersionId: "v1",
      versionNumber: 1,
      verificationStatus: "unverified",
      verificationEnvironment: null,
      verifiedAt: null,
    };

    const code = testingLocatorCode(entry);
    expect(code).toBe('page.getByRole("button", { name: "Submit" })');
  });

  it("detects redacted/PII arguments in locators", () => {
    const safeEntry: TestingLocatorEntry = {
      id: "loc-1",
      pageId: "page-1",
      locatorKey: "nameInput",
      classification: "assertion",
      strategy: "label",
      arguments: { label: "Full Name" },
      semanticContext: "User full name",
      source: "discovered",
      sourceFile: null,
      sourceLine: null,
      lifecycleStatus: "accepted",
      syncStatus: "managed",
      fragile: false,
      currentVersionId: "v1",
      versionNumber: 1,
      verificationStatus: "unverified",
      verificationEnvironment: null,
      verifiedAt: null,
    };

    const redactedEntry: TestingLocatorEntry = {
      ...safeEntry,
      arguments: { label: "<PII_EMAIL_ADDRESS>" },
    };

    expect(testingLocatorHasRedactedArgument(safeEntry)).toBe(false);
    expect(testingLocatorHasRedactedArgument(redactedEntry)).toBe(true);
  });

  it("extracts reasoning tier from model selection options", () => {
    expect(testingReasoningTierFromOptions([{ id: "reasoning", value: "high" }])).toBe("high");
    expect(testingReasoningTierFromOptions([{ id: "reasoning", value: "low" }])).toBe("low");
    expect(testingReasoningTierFromOptions([{ id: "reasoning", value: "medium" }])).toBe("medium");
    expect(testingReasoningTierFromOptions(undefined)).toBe("medium");
  });

  it("initializes empty browser session state properly", () => {
    const state = createEmptyBrowserSessionState("test-proj" as ProjectId);
    expect(state.loading).toBe(false);
    expect(state.canGoBack).toBe(false);
    expect(state.canGoForward).toBe(false);
    expect(state.currentUrl).toBeNull();
    expect(state.pageTitle).toBeNull();
  });

  it("ensures all 6 views are defined and exported", () => {
    expect(TestingOverview).toBeDefined();
    expect(TestingDiscover).toBeDefined();
    expect(TestingCases).toBeDefined();
    expect(TestingAutomate).toBeDefined();
    expect(TestingRuns).toBeDefined();
    expect(TestingReports).toBeDefined();
  });
});
