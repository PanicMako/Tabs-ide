import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TestingGraphStore } from "./graphStore";
import { LocatorLibraryStore } from "./locatorLibrary";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function stores() {
  const root = await mkdtemp(join(tmpdir(), "tabs-locator-library-"));
  roots.push(root);
  const databasePath = join(root, "testing.sqlite");
  const graph = new TestingGraphStore(databasePath);
  const library = new LocatorLibraryStore(databasePath);
  return { graph, library };
}

describe("LocatorLibraryStore", () => {
  it("defaults new projects to locator-first and allocates configurable case IDs", async () => {
    const { graph, library } = await stores();
    try {
      expect(library.experience("project-a")).toBe("locator-first");
      expect(library.caseIdPolicy("project-a")).toMatchObject({
        prefix: "TC-",
        padding: 5,
        nextSequence: 1,
        example: "TC-00001",
      });
      library.setCaseIdPolicy({
        projectId: "project-a",
        prefix: "QA-",
        padding: 4,
        nextSequence: 42,
      });
      expect(library.allocateCaseIds("project-a", 2)).toEqual(["QA-0042", "QA-0043"]);
      expect(library.caseIdPolicy("project-a").nextSequence).toBe(44);
      expect(library.caseIdPolicy("project-b").example).toBe("TC-00001");
    } finally {
      library.close();
      graph.close();
    }
  });

  it("rejects new sessions while the server kill switch is disabled", async () => {
    const previous = process.env.TABS_TESTING_LOCATOR_FIRST_ENABLED;
    process.env.TABS_TESTING_LOCATOR_FIRST_ENABLED = "false";
    const { graph, library } = await stores();
    try {
      expect(library.library("project-a").featureAvailable).toBe(false);
      expect(() =>
        library.beginSession({
          projectId: "project-a",
          mode: "manual",
          coverage: "actions-assertions",
          safetyProfile: "supervised",
          targetUrl: "https://example.test",
          environmentLabel: "uat",
          maxElementsPerPage: 500,
          maxPagesPerSession: 25,
        }),
      ).toThrow(/disabled/);
    } finally {
      if (previous === undefined) delete process.env.TABS_TESTING_LOCATOR_FIRST_ENABLED;
      else process.env.TABS_TESTING_LOCATOR_FIRST_ENABLED = previous;
      library.close();
      graph.close();
    }
  });

  it("isolates projects and persists sanitized versioned locators", async () => {
    const { graph, library } = await stores();
    try {
      library.saveCapturedPage({
        projectId: "project-a",
        sessionId: null,
        rawUrl: "https://example.test/account/sk_live_1234567890abcdefghijklmnop?token=raw",
        environmentLabel: "uat",
        fingerprint: "page-a",
        captureSource: "manual",
        observedElements: 1,
        truncatedElements: 0,
        candidates: [
          {
            locatorKey: "save-account",
            classification: "action",
            strategy: "role",
            arguments: { role: "button", name: "Save" },
            semanticContext: "Save account",
            source: "manual",
          },
        ],
      });

      const projectA = library.library("project-a");
      expect(projectA.locatorCount).toBe(1);
      expect(projectA.pages[0]?.urlPattern).not.toContain("sk_live");
      expect(projectA.pages[0]?.urlPattern).not.toContain("raw");
      expect(projectA.pages[0]?.entries[0]?.versionNumber).toBe(1);
      expect(library.library("project-b").locatorCount).toBe(0);
    } finally {
      library.close();
      graph.close();
    }
  });

  it("keeps locator entries and page-object selections scoped to each captured page", async () => {
    const { graph, library } = await stores();
    try {
      for (const [path, name] of [
        ["/landing", "Get started"],
        ["/login", "Sign in"],
      ] as const) {
        library.saveCapturedPage({
          projectId: "project-a",
          sessionId: null,
          rawUrl: `https://example.test${path}`,
          environmentLabel: "uat",
          fingerprint: path,
          captureSource: "manual",
          observedElements: 1,
          truncatedElements: 0,
          candidates: [
            {
              locatorKey: "primary-action",
              classification: "action",
              strategy: "role",
              arguments: { role: "button", name },
              semanticContext: name,
              source: "manual",
            },
          ],
        });
      }

      const captured = library.library("project-a");
      expect(captured.pages).toHaveLength(2);
      const landing = captured.pages.find((page) => page.urlPattern.includes("/landing"))!;
      const login = captured.pages.find((page) => page.urlPattern.includes("/login"))!;
      expect(landing.id).not.toBe(login.id);
      expect(landing.entries[0]?.id).not.toBe(login.entries[0]?.id);

      library.setPageSelection({
        projectId: "project-a",
        pageId: landing.id,
        entryIds: [landing.entries[0]!.id],
      });
      const selected = library.library("project-a");
      expect(
        selected.pages.find((page) => page.id === landing.id)?.entries[0]?.lifecycleStatus,
      ).toBe("accepted");
      expect(selected.pages.find((page) => page.id === login.id)?.entries[0]?.lifecycleStatus).toBe(
        "draft",
      );
    } finally {
      library.close();
      graph.close();
    }
  });

  it("preserves managed-only entries during repository reconciliation", async () => {
    const { graph, library } = await stores();
    try {
      library.saveCapturedPage({
        projectId: "project-a",
        sessionId: null,
        rawUrl: "https://example.test/settings",
        environmentLabel: "uat",
        fingerprint: "settings",
        captureSource: "manual",
        observedElements: 1,
        truncatedElements: 0,
        candidates: [
          {
            locatorKey: "save-settings",
            classification: "action",
            strategy: "role",
            arguments: { role: "button", name: "Save" },
            semanticContext: "Save settings",
            source: "manual",
          },
        ],
      });

      expect(library.markManagedOnly("project-a", new Set())).toBe(1);
      expect(library.library("project-a").pages[0]?.entries[0]?.syncStatus).toBe("managed-only");
      expect(library.disconnectSources("project-a").pages[0]?.entries[0]?.syncStatus).toBe(
        "managed-only",
      );
    } finally {
      library.close();
      graph.close();
    }
  });

  it("replaces manual case locator mappings without crossing project boundaries", async () => {
    const { graph, library } = await stores();
    try {
      graph.createCase({
        projectId: "project-a",
        externalId: "TC-00001",
        description: "Open settings",
        steps: ["Open Settings"],
        expectedResult: "Settings are visible",
      });
      library.saveCapturedPage({
        projectId: "project-a",
        sessionId: null,
        rawUrl: "https://example.test/settings",
        environmentLabel: "uat",
        fingerprint: "settings",
        captureSource: "manual",
        observedElements: 2,
        truncatedElements: 0,
        candidates: [
          {
            locatorKey: "open-settings",
            classification: "action",
            strategy: "role",
            arguments: { role: "button", name: "Settings" },
            semanticContext: "Open settings",
            source: "manual",
          },
          {
            locatorKey: "settings-heading",
            classification: "assertion",
            strategy: "role",
            arguments: { role: "heading", name: "Settings" },
            semanticContext: "Settings heading",
            source: "manual",
          },
        ],
      });
      const testCase = graph.listCases("project-a").cases[0]!;
      const entries = library.library("project-a").pages[0]!.entries;

      library.replaceCaseLocators(
        "project-a",
        testCase.id,
        entries.map((entry) => entry.id),
      );
      expect(library.caseLocatorIds("project-a", testCase.id)).toHaveLength(2);
      library.replaceCaseLocators("project-a", testCase.id, [entries[1]!.id]);
      expect(library.caseLocatorIds("project-a", testCase.id)).toEqual([entries[1]!.id]);
      expect(() => library.replaceCaseLocators("project-b", testCase.id, [entries[0]!.id])).toThrow(
        /unavailable in this project/,
      );
    } finally {
      library.close();
      graph.close();
    }
  });

  it("persists deterministic page-object artifacts and versions locator changes", async () => {
    const { graph, library } = await stores();
    try {
      const capture = (name: string) =>
        library.saveCapturedPage({
          projectId: "project-a",
          sessionId: null,
          rawUrl: "https://example.test/settings",
          environmentLabel: "uat",
          fingerprint: "settings",
          captureSource: "manual",
          observedElements: 1,
          truncatedElements: 0,
          candidates: [
            {
              locatorKey: "save-settings",
              classification: "action",
              strategy: "role",
              arguments: { role: "button", name },
              semanticContext: name,
              source: "manual",
            },
          ],
        });

      capture("Save");
      const first = library.library("project-a").pages[0]?.pageObject;
      expect(first).toMatchObject({ versionNumber: 1, status: "current" });
      const initialEntry = library.library("project-a").pages[0]?.entries[0];
      expect(initialEntry).toBeDefined();
      library.reviewEntry({
        projectId: "project-a",
        entryId: initialEntry!.id,
        decision: "accept",
      });
      const accepted = library.library("project-a").pages[0]?.pageObject;
      expect(accepted).toMatchObject({ versionNumber: 2, status: "current" });
      expect(accepted?.code).toContain('getByRole("button", { name: "Save" })');
      expect(first?.code).not.toContain("saveSettings");

      const entry = library.library("project-a").pages[0]?.entries[0];
      expect(entry).toBeDefined();
      library.promoteHealing({
        projectId: "project-a",
        entryId: entry!.id,
        strategy: "role",
        arguments: { role: "button", name: "Save changes" },
        semanticContext: "Save changes",
        environmentLabel: "uat",
        targetUrl: "https://example.test/settings",
        expectedVersionId: entry!.currentVersionId,
      });
      const second = library.library("project-a").pages[0]?.pageObject;
      expect(second).toMatchObject({ versionNumber: 3, status: "current" });
      expect(second?.id).not.toBe(accepted?.id);
      expect(second?.code).toContain("Save changes");
    } finally {
      library.close();
      graph.close();
    }
  });

  it("uses human page names and generates code only for the selected locators", async () => {
    const { graph, library } = await stores();
    try {
      library.saveCapturedPage({
        projectId: "project-a",
        sessionId: null,
        rawUrl: "https://example.test/",
        environmentLabel: "uat",
        fingerprint: "landing",
        captureSource: "manual",
        observedElements: 2,
        truncatedElements: 0,
        candidates: [
          {
            locatorKey: "sign-in",
            classification: "action",
            strategy: "role",
            arguments: { role: "button", name: "Sign in" },
            semanticContext: "Sign in",
            source: "manual",
          },
          {
            locatorKey: "create-account",
            classification: "action",
            strategy: "role",
            arguments: { role: "link", name: "Create account" },
            semanticContext: "Create account",
            source: "manual",
          },
        ],
      });
      const page = library.library("project-a").pages[0];
      expect(page?.name).toBe("Landing page");
      expect(page?.pageObject?.className).toBe("LandingPage");
      expect(page?.pageObject?.fileName).toBe("landing.page.ts");

      const signIn = page?.entries.find((entry) => entry.locatorKey === "sign-in");
      expect(signIn).toBeDefined();
      const selected = library.setPageSelection({
        projectId: "project-a",
        pageId: page!.id,
        entryIds: [signIn!.id],
      });
      expect(selected.pages[0]?.pageObject?.code).toContain("signIn");
      expect(selected.pages[0]?.pageObject?.code).not.toContain("createAccount");

      const renamed = library.updatePage({
        projectId: "project-a",
        pageId: page!.id,
        name: "Authentication",
      });
      expect(renamed.pages[0]?.name).toBe("Authentication");
      expect(renamed.pages[0]?.pageObject?.className).toBe("AuthenticationPage");
      expect(renamed.pages[0]?.pageObject?.versionNumber).toBeGreaterThan(
        selected.pages[0]?.pageObject?.versionNumber ?? 0,
      );
    } finally {
      library.close();
      graph.close();
    }
  });

  it("deletes only the selected page and all of its locator records", async () => {
    const { graph, library } = await stores();
    try {
      for (const [path, key] of [
        ["/login", "sign-in"],
        ["/settings", "save-settings"],
      ] as const) {
        library.saveCapturedPage({
          projectId: "project-a",
          sessionId: null,
          rawUrl: `https://example.test${path}`,
          environmentLabel: "uat",
          fingerprint: path,
          captureSource: "manual",
          observedElements: 1,
          truncatedElements: 0,
          candidates: [
            {
              locatorKey: key,
              classification: "action",
              strategy: "role",
              arguments: { role: "button", name: key },
              semanticContext: key,
              source: "manual",
            },
          ],
        });
      }

      const loginPage = library
        .library("project-a")
        .pages.find((page) => page.urlPattern === "https://example.test/login");
      expect(loginPage).toBeDefined();

      const result = library.deletePage({
        projectId: "project-a",
        pageId: loginPage!.id,
      });
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0]?.urlPattern).toBe("https://example.test/settings");
      expect(result.pages[0]?.entries.map((entry) => entry.locatorKey)).toEqual(["save-settings"]);
      expect(() => library.deletePage({ projectId: "project-a", pageId: loginPage!.id })).toThrow(
        /not found/,
      );
    } finally {
      library.close();
      graph.close();
    }
  });

  it("saves validated manual code as a version and regenerates after locator changes", async () => {
    const { graph, library } = await stores();
    try {
      library.saveCapturedPage({
        projectId: "project-a",
        sessionId: null,
        rawUrl: "https://example.test/",
        environmentLabel: "uat",
        fingerprint: "landing",
        captureSource: "manual",
        observedElements: 1,
        truncatedElements: 0,
        candidates: [
          {
            locatorKey: "sign-in",
            classification: "action",
            strategy: "role",
            arguments: { role: "button", name: "Sign in" },
            semanticContext: "Sign in",
            source: "manual",
            lifecycleStatus: "accepted",
          },
        ],
      });
      const page = library.library("project-a").pages[0]!;
      const generated = page.pageObject!;
      const editedCode = generated.code.replace(
        "\n\tconstructor",
        '\n\treadonly help = this.page.getByTitle("Help");\n\n\tconstructor',
      );
      const edited = library.updatePageObjectCode({
        projectId: "project-a",
        pageId: page.id,
        expectedSourceHash: generated.sourceHash,
        code: editedCode,
      });
      expect(edited.pages[0]?.pageObject).toMatchObject({
        origin: "manual",
        versionNumber: generated.versionNumber + 1,
        code: editedCode,
      });
      expect(library.library("project-a").pages[0]?.pageObject?.origin).toBe("manual");
      expect(() =>
        library.updatePageObjectCode({
          projectId: "project-a",
          pageId: page.id,
          expectedSourceHash: edited.pages[0]!.pageObject!.sourceHash,
          code: "export class LandingPage {",
        }),
      ).toThrow(/TypeScript syntax/);
      expect(() =>
        library.updatePageObjectCode({
          projectId: "project-a",
          pageId: page.id,
          expectedSourceHash: edited.pages[0]!.pageObject!.sourceHash,
          code: editedCode.replace("Help", "sk_live_1234567890abcdefghijklmnop"),
        }),
      ).toThrow(/credentials/);

      const regenerated = library.setPageSelection({
        projectId: "project-a",
        pageId: page.id,
        entryIds: [],
      });
      expect(regenerated.pages[0]?.pageObject?.origin).toBe("generated");
      expect(regenerated.pages[0]?.pageObject?.code).not.toContain("readonly help");
    } finally {
      library.close();
      graph.close();
    }
  });

  it("never emits tokenized accessible names into generated page objects", async () => {
    const { graph, library } = await stores();
    try {
      library.saveCapturedPage({
        projectId: "project-a",
        sessionId: null,
        rawUrl: "https://example.test/account",
        environmentLabel: "uat",
        fingerprint: "account",
        captureSource: "manual",
        observedElements: 2,
        truncatedElements: 0,
        candidates: [
          {
            locatorKey: "email-link",
            classification: "action",
            strategy: "role",
            arguments: { role: "link", name: "<PII_EMAIL:local-token>" },
            semanticContext: "Contact <PII_EMAIL:local-token>",
            source: "manual",
          },
          {
            locatorKey: "save-button",
            classification: "action",
            strategy: "role",
            arguments: { role: "button", name: "Save" },
            semanticContext: "Save",
            source: "manual",
            lifecycleStatus: "accepted",
          },
        ],
      });
      const code = library.library("project-a").pages[0]?.pageObject?.code ?? "";
      expect(code).toContain("saveButton");
      expect(code).not.toContain("PII_EMAIL");
      expect(code).not.toContain("emailLink");
    } finally {
      library.close();
      graph.close();
    }
  });

  it("versions locator edits and supports recoverable removal", async () => {
    const { graph, library } = await stores();
    try {
      library.saveCapturedPage({
        projectId: "project-a",
        sessionId: null,
        rawUrl: "https://example.test/account",
        environmentLabel: "uat",
        fingerprint: "account",
        captureSource: "manual",
        observedElements: 1,
        truncatedElements: 0,
        candidates: [
          {
            locatorKey: "save-account",
            classification: "action",
            strategy: "role",
            arguments: { role: "button", name: "Save" },
            semanticContext: "Account form",
            source: "manual",
          },
        ],
      });
      const entry = library.library("project-a").pages[0]!.entries[0]!;
      library.reviewEntry({
        projectId: "project-a",
        entryId: entry.id,
        decision: "accept",
        locatorKey: "submit-account",
        classification: "action",
        strategy: "test-id",
        arguments: { testId: "account-submit" },
        semanticContext: "Submit the account form",
      });
      const edited = library.library("project-a").pages[0]!.entries[0]!;
      expect(edited).toMatchObject({
        locatorKey: "submit-account",
        strategy: "test-id",
        arguments: { testId: "account-submit" },
        versionNumber: entry.versionNumber + 1,
        lifecycleStatus: "accepted",
      });

      library.reviewEntry({
        projectId: "project-a",
        entryId: entry.id,
        decision: "archive",
      });
      expect(library.library("project-a").pages[0]!.entries[0]!.lifecycleStatus).toBe("archived");
      library.reviewEntry({
        projectId: "project-a",
        entryId: entry.id,
        decision: "restore",
      });
      expect(library.library("project-a").pages[0]!.entries[0]!.lifecycleStatus).toBe("draft");

      expect(() =>
        library.reviewEntry({
          projectId: "project-a",
          entryId: entry.id,
          decision: "accept",
          arguments: { testId: "sk_live_1234567890abcdefghijklmnop" },
        }),
      ).toThrow(/credentials/);
    } finally {
      library.close();
      graph.close();
    }
  });

  it("manages locator health states, repair attempt limits, and quarantine", async () => {
    const { library } = await stores();
    try {
      library.saveCapturedPage({
        projectId: "project-health",
        sessionId: null,
        rawUrl: "https://example.com/app",
        environmentLabel: "test",
        fingerprint: "state-1",
        captureSource: "manual",
        observedElements: 1,
        truncatedElements: 0,
        candidates: [
          {
            locatorKey: "button-login",
            classification: "action",
            strategy: "test-id",
            arguments: { testId: "login-btn" },
            semanticContext: "button login",
            source: "discovered",
          },
        ],
      });

      let page = library.library("project-health").pages[0]!;
      let entry = page.entries[0]!;
      expect(entry.health).toBe("healthy");
      expect(entry.consecutiveRepairAttempts).toBe(0);

      // Failing verification with selector drift degrades/breaks health
      library.recordVerification({
        projectId: "project-health",
        entryId: entry.id,
        versionId: entry.currentVersionId,
        environmentLabel: "test",
        targetUrl: "https://example.com/app",
        status: "missing",
        matchCount: 0,
        failureClassification: "selector-drift",
        isRepairAttempt: true,
      });

      entry = library.library("project-health").pages[0]!.entries[0]!;
      expect(entry.health).toBe("broken");
      expect(entry.consecutiveRepairAttempts).toBe(1);
      expect(entry.lastFailureClassification).toBe("selector-drift");

      // Non-selector failure (e.g. product assertion) does NOT affect locator health
      library.recordVerification({
        projectId: "project-health",
        entryId: entry.id,
        versionId: entry.currentVersionId,
        environmentLabel: "test",
        targetUrl: "https://example.com/app",
        status: "missing",
        matchCount: 0,
        failureClassification: "product-assertion",
      });

      entry = library.library("project-health").pages[0]!.entries[0]!;
      // Health should not change on non-selector failure
      expect(entry.health).toBe("broken");
      expect(entry.consecutiveRepairAttempts).toBe(1);

      // Second repair attempt failing
      library.recordVerification({
        projectId: "project-health",
        entryId: entry.id,
        versionId: entry.currentVersionId,
        environmentLabel: "test",
        targetUrl: "https://example.com/app",
        status: "missing",
        matchCount: 0,
        failureClassification: "selector-drift",
        isRepairAttempt: true,
      });

      entry = library.library("project-health").pages[0]!.entries[0]!;
      expect(entry.health).toBe("quarantined");
      expect(entry.consecutiveRepairAttempts).toBe(2);

      // Further failed verification remains quarantined.
      library.recordVerification({
        projectId: "project-health",
        entryId: entry.id,
        versionId: entry.currentVersionId,
        environmentLabel: "test",
        targetUrl: "https://example.com/app",
        status: "missing",
        matchCount: 0,
        failureClassification: "selector-drift",
        isRepairAttempt: true,
      });

      entry = library.library("project-health").pages[0]!.entries[0]!;
      expect(entry.health).toBe("quarantined");
      expect(entry.consecutiveRepairAttempts).toBe(3);

      // Healing verification restores healthy status and resets attempts
      library.recordVerification({
        projectId: "project-health",
        entryId: entry.id,
        versionId: entry.currentVersionId,
        environmentLabel: "test",
        targetUrl: "https://example.com/app",
        status: "verified",
        matchCount: 1,
      });

      entry = library.library("project-health").pages[0]!.entries[0]!;
      expect(entry.health).toBe("healthy");
      expect(entry.consecutiveRepairAttempts).toBe(0);
      expect(entry.lastFailureClassification).toBeNull();
      expect(entry.verificationCount).toBe(5);

      // Ambiguous resolution sets health to degraded
      library.recordVerification({
        projectId: "project-health",
        entryId: entry.id,
        versionId: entry.currentVersionId,
        environmentLabel: "test",
        targetUrl: "https://example.com/app",
        status: "ambiguous",
        matchCount: 2,
      });

      entry = library.library("project-health").pages[0]!.entries[0]!;
      expect(entry.health).toBe("degraded");
    } finally {
      library.close();
    }
  });
});
