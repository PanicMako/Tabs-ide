import { chmod, copyFile, readFile, realpath, stat, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  TestingAuthStartResult,
  TestingArtifactReadInput,
  TestingArtifactReadResult,
  TestingBugDraft,
  TestingBugDraftInput,
  TestingCaseListResult,
  TestingCaseCreateInput,
  TestingCaseDeleteInput,
  TestingCaseGroupUpdateInput,
  TestingCaseGroupCreateInput,
  TestingCaseGroupDeleteInput,
  TestingCaseIdPolicy,
  TestingCaseIdPolicyInput,
  TestingCaseReviewInput,
  TestingClearGraphResult,
  TestingDiscoveryExperienceInput,
  TestingExplorationInput,
  TestingExplorationResult,
  TestingExecutionInput,
  TestingExecutionRun,
  TestingExecutionRunInput,
  TestingExecutionRunListResult,
  TestingGraphExplorerResult,
  TestingGraphSummary,
  TestingGenerationInput,
  TestingGenerationJob,
  TestingGenerationJobInput,
  TestingGenerationJobListResult,
  TestingHealingDecisionInput,
  TestingLocatorDiscoveryInput,
  TestingLocatorDiscoveryNavigateInput,
  TestingLocatorDiscoverySession,
  TestingLocatorDiscoverySessionInput,
  TestingLocatorPreviewSnapshot,
  TestingLocatorEntryReviewInput,
  TestingLocatorPageDeleteInput,
  TestingLocatorPageSelectionInput,
  TestingLocatorPageUpdateInput,
  TestingPageObjectCodeUpdateInput,
  TestingLocatorRepositoryApplyInput,
  TestingLocatorRepositoryApplyResult,
  TestingLocatorRepositoryPreviewInput,
  TestingLocatorRepositoryProposal,
  TestingLocatorFolderInput,
  TestingLocatorFolderResult,
  TestingLocatorLibraryResult,
  TestingLocatorSyncDecisionInput,
  TestingLocatorSyncPreview,
  TestingLocatorVerificationInput,
  TestingLocatorEntry,
  TestingMismatch,
  TestingProjectInput,
  TestingReport,
  TestingReportInput,
  TestingSchedule,
  TestingScheduleInput,
  TestingScheduleListResult,
  TestingTargetInput,
  TestingStoryImportInput,
  TestingStoryImportResult,
  TestingTraceabilityInput,
  TestingTraceabilityResult,
  TestingTriageInput,
  TestingTriageResult,
  TestingTestInventoryResult,
  TestingWorkbookImportInput,
  TestingWorkbookImportResult,
} from "@tabs/contracts";
import { DEFAULT_TESTING_MAX_STATES } from "@tabs/contracts";
import { sanitizePersistedUrl } from "./security";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { TextGenerationShape } from "../textGeneration/TextGeneration";

import { TestingCrawler } from "./crawler";
import { TestingGraphStore } from "./graphStore";
import {
  captureLocatorSnapshot,
  countLocatorMatches,
  locatorCandidatesFromSnapshot,
  verificationStatusForCount,
} from "./locatorDiscovery";
import { indexLocatorFolder } from "./locatorImporter";
import { LocatorLibraryStore } from "./locatorLibrary";
import { applyLocatorRepositoryWrite, previewLocatorRepositoryWrite } from "./locatorRepository";
import { TestingGenerator } from "./generator";
import { TestingExecutor } from "./execution";
import { createPlaywrightMcpSession, type PlaywrightMcpSession } from "./playwrightMcp";
import { TestingReporter } from "./reporting";
import {
  reconcileWorkbookCase,
  scenariosFromGraph,
  verifyReconciledCaseLive,
} from "./reconciliation";
import { sanitizeModelBoundText, shortDigest, tokenizePii } from "./security";
import { parseUserStory } from "./storyImporter";
import { parseTestingWorkbook } from "./workbookParser";
import { scanTestingInventory } from "./testInventory";

const MAX_TESTING_ARTIFACT_PREVIEW_BYTES = 1024 * 1024;

function isPathInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot.length > 0 &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

interface AuthCapture {
  readonly session: PlaywrightMcpSession;
  readonly profilePath: string;
  readonly outputPath: string;
}

interface LocatorCaptureSession {
  readonly session: PlaywrightMcpSession | null;
  readonly input: TestingLocatorDiscoveryInput;
  readonly capturedUrls: Set<string>;
  currentUrl: string;
}

const LOCATOR_MATCH_STOP_WORDS = new Set([
  "a",
  "and",
  "click",
  "in",
  "on",
  "open",
  "press",
  "select",
  "the",
  "then",
  "to",
]);

function locatorMatchScore(step: string, entry: TestingLocatorEntry): number {
  const words = (value: string) =>
    new Set(
      value
        .toLocaleLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 1 && !LOCATOR_MATCH_STOP_WORDS.has(word)),
    );
  const expected = words(step);
  const candidate = words(
    `${entry.locatorKey} ${entry.semanticContext} ${Object.values(entry.arguments).join(" ")}`,
  );
  if (expected.size === 0 || candidate.size === 0) return 0;
  let overlap = 0;
  for (const word of expected) if (candidate.has(word)) overlap += 1;
  return overlap / new Set([...expected, ...candidate]).size;
}

function bestLocatorForStep(
  step: string,
  entries: ReadonlyArray<TestingLocatorEntry>,
): TestingLocatorEntry | null {
  const ranked = entries
    .map((entry) => ({ entry, score: locatorMatchScore(step, entry) }))
    .filter((candidate) => candidate.score >= 0.15)
    .toSorted((left, right) => right.score - left.score);
  return ranked[0]?.entry ?? null;
}

function automaticActionAllowed(
  action: { readonly role: string; readonly name: string },
  input: TestingLocatorDiscoveryInput,
): boolean {
  if (input.safetyProfile === "read-only") return false;
  if (["link", "tab", "treeitem", "menuitem"].includes(action.role)) return true;
  if (input.safetyProfile === "supervised") return false;
  const approved = new Set(input.approvedActionCategories ?? []);
  if (
    approved.has("navigation") &&
    /\b(?:open|view|next|previous|back|continue)\b/i.test(action.name)
  ) {
    return true;
  }
  if (approved.has("filters") && /\b(?:filter|sort|search|apply)\b/i.test(action.name)) return true;
  if (approved.has("tabs") && action.role === "tab") return true;
  return approved.has("form-drafts") && /\b(?:add|draft|preview)\b/i.test(action.name);
}

const FailureTriage = Schema.Struct({
  classification: Schema.Literals(["application-regression", "test-update", "uncertain"]),
  observedFacts: Schema.Array(Schema.String),
  inference: Schema.String,
  recommendation: Schema.String,
});

const StoryCases = Schema.Struct({
  cases: Schema.Array(
    Schema.Struct({
      externalId: Schema.String,
      description: Schema.String,
      preconditions: Schema.Array(Schema.String),
      steps: Schema.Array(Schema.String),
      expectedResults: Schema.Array(Schema.String),
      locatorKeys: Schema.Array(Schema.String),
    }),
  ),
});

export class TestingService {
  readonly #testingRoot: string;
  readonly #store: TestingGraphStore;
  readonly #locatorStore: LocatorLibraryStore;
  readonly #authCaptures = new Map<string, AuthCapture>();
  readonly #runningCrawls = new Set<string>();
  readonly #locatorSessions = new Map<string, LocatorCaptureSession>();
  readonly #generator: TestingGenerator | null;
  readonly #executor: TestingExecutor;
  readonly #reporter: TestingReporter;
  readonly #textGeneration: TextGenerationShape | null;

  constructor(stateDirectory: string, textGeneration?: TextGenerationShape) {
    this.#testingRoot = join(stateDirectory, "testing");
    this.#store = new TestingGraphStore(join(this.#testingRoot, "state-graph.sqlite"));
    this.#locatorStore = new LocatorLibraryStore(join(this.#testingRoot, "state-graph.sqlite"));
    this.#generator = textGeneration
      ? new TestingGenerator(this.#store, this.#locatorStore, this.#testingRoot, textGeneration)
      : null;
    this.#textGeneration = textGeneration ?? null;
    this.#executor = new TestingExecutor(this.#store, this.#testingRoot);
    this.#reporter = new TestingReporter(this.#store, this.#testingRoot);
  }

  #withCaseLocatorMappings(
    projectId: string,
    result: TestingCaseListResult,
  ): TestingCaseListResult {
    return {
      groups: result.groups,
      cases: result.cases.map((testCase) => ({
        ...testCase,
        locatorEntryIds: this.#locatorStore.caseLocatorIds(projectId, testCase.id),
      })),
    };
  }

  close(): void {
    for (const capture of this.#authCaptures.values()) {
      void capture.session.close();
    }
    this.#authCaptures.clear();
    for (const locatorSession of this.#locatorSessions.values()) {
      void locatorSession.session?.close();
    }
    this.#locatorSessions.clear();
    this.#locatorStore.close();
    this.#store.close();
  }

  getStatus(input: TestingProjectInput): TestingGraphSummary {
    return this.#store.summary(input.projectId);
  }

  getLocatorLibrary(input: TestingProjectInput): TestingLocatorLibraryResult {
    return this.#locatorStore.library(input.projectId);
  }

  setDiscoveryExperience(input: TestingDiscoveryExperienceInput): TestingLocatorLibraryResult {
    this.#locatorStore.setExperience(input.projectId, input.experience);
    return this.#locatorStore.library(input.projectId);
  }

  getCaseIdPolicy(input: TestingProjectInput): TestingCaseIdPolicy {
    return this.#locatorStore.caseIdPolicy(input.projectId);
  }

  setCaseIdPolicy(input: TestingCaseIdPolicyInput): TestingCaseIdPolicy {
    return this.#locatorStore.setCaseIdPolicy(input);
  }

  getTestInventory(
    input: TestingProjectInput & { readonly projectPath: string },
  ): TestingTestInventoryResult {
    return scanTestingInventory({
      projectId: input.projectId,
      projectPath: input.projectPath,
      managedCases: this.#store.listCases(input.projectId).cases,
    });
  }

  async startLocatorDiscovery(
    input: TestingLocatorDiscoveryInput,
  ): Promise<TestingLocatorDiscoverySession> {
    if (!this.#locatorStore.isFeatureEnabled()) {
      throw new Error("Locator-first discovery is disabled by the server feature flag");
    }
    if (this.#authCaptures.has(input.projectId)) {
      throw new Error("Finish authentication capture before starting locator discovery");
    }
    if (
      [...this.#locatorSessions.values()].some((item) => item.input.projectId === input.projectId)
    ) {
      throw new Error("A locator-discovery session is already running for this project");
    }
    const environmentLabel = input.environmentLabel?.trim() || "default";
    const sessionId = this.#locatorStore.beginSession({
      projectId: input.projectId,
      mode: input.mode,
      coverage: input.coverage,
      safetyProfile: input.safetyProfile,
      targetUrl: input.targetUrl,
      environmentLabel,
      maxElementsPerPage: input.maxElementsPerPage,
      maxPagesPerSession: input.maxPagesPerSession,
    });
    if (input.mode === "automatic") {
      try {
        if (this.#runningCrawls.has(input.projectId)) {
          throw new Error("An exploration is already running for this project");
        }
        this.#runningCrawls.add(input.projectId);
        await new TestingCrawler(
          this.#store,
          this.#testingRoot,
          () => this.#locatorStore.isFeatureEnabled(),
          (action) => automaticActionAllowed(action, input),
        ).explore({
          projectId: input.projectId,
          targetUrl: input.targetUrl,
          ...(input.cdpEndpoint ? { cdpEndpoint: input.cdpEndpoint } : {}),
          scope: input.scope,
          maxStates: Math.min(
            input.maxStates ?? DEFAULT_TESTING_MAX_STATES,
            input.maxPagesPerSession,
          ),
          ...(input.maxDurationSeconds === undefined
            ? {}
            : { maxDurationSeconds: input.maxDurationSeconds }),
        });
        const graph = this.#store.graph(input.projectId);
        const pages = graph.nodes.slice(0, input.maxPagesPerSession);
        let truncated = false;
        for (const node of pages) {
          if (!this.#locatorStore.isFeatureEnabled()) {
            throw new Error("Locator-first discovery was disabled during this session");
          }
          const parsed = locatorCandidatesFromSnapshot({
            projectId: input.projectId,
            snapshot: node.snapshot,
            coverage: input.coverage,
            maxElements: input.maxElementsPerPage,
            ...(input.captureScope === "task" && input.taskContext?.trim()
              ? { taskContext: input.taskContext.trim() }
              : {}),
          });
          truncated ||= parsed.truncatedElements > 0;
          this.#locatorStore.saveCapturedPage({
            projectId: input.projectId,
            sessionId,
            rawUrl: node.pageUrl,
            environmentLabel,
            fingerprint: node.stateId,
            captureSource: "automatic",
            candidates: parsed.candidates,
            observedElements: parsed.observedElements,
            truncatedElements: parsed.truncatedElements,
          });
        }
        const pageLimited = graph.nodes.length > input.maxPagesPerSession;
        this.#locatorStore.finishSession(
          input.projectId,
          sessionId,
          "completed",
          pageLimited ? "page-limit" : truncated ? "element-limit" : "completed",
          `Captured ${pages.length} page${pages.length === 1 ? "" : "s"} into the Locator Library`,
        );
      } catch (error) {
        const featureDisabled = !this.#locatorStore.isFeatureEnabled();
        this.#locatorStore.finishSession(
          input.projectId,
          sessionId,
          featureDisabled ? "cancelled" : "failed",
          featureDisabled ? "feature-disabled" : "failed",
          error instanceof Error ? error.message : String(error),
          true,
        );
        throw error;
      } finally {
        this.#runningCrawls.delete(input.projectId);
      }
      return this.#locatorSessionResult(input.projectId, sessionId);
    }
    if (input.previewSnapshot) {
      this.#locatorSessions.set(sessionId, {
        session: null,
        input,
        capturedUrls: new Set(),
        currentUrl: input.previewSnapshot.url,
      });
      try {
        return await this.#captureLocatorPage(
          input.projectId,
          sessionId,
          input.captureScope === "task" ? "relevant" : "all",
          input.previewSnapshot,
        );
      } catch (error) {
        this.#locatorSessions.delete(sessionId);
        this.#locatorStore.finishSession(
          input.projectId,
          sessionId,
          "failed",
          "failed",
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }
    const session = await createPlaywrightMcpSession({
      profilePath: join(this.#testingRoot, "auth", shortDigest(input.projectId)),
      outputPath: join(this.#testingRoot, "mcp-output", `locator-${sessionId}`),
      headless: false,
      ...(input.cdpEndpoint ? { cdpEndpoint: input.cdpEndpoint } : {}),
    });
    await session.call("browser_navigate", { url: input.targetUrl });
    this.#locatorSessions.set(sessionId, {
      session,
      input,
      currentUrl: input.targetUrl,
      capturedUrls: new Set(),
    });
    if (input.mode === "guided") await this.#captureLocatorPage(input.projectId, sessionId);
    return this.#locatorSessionResult(input.projectId, sessionId);
  }

  async navigateLocatorDiscovery(
    input: TestingLocatorDiscoveryNavigateInput,
  ): Promise<TestingLocatorDiscoverySession> {
    const active = await this.#activeLocatorSession(input.projectId, input.sessionId);
    if (!active.session) throw new Error("Navigate in the preview, then scan the current page.");
    await active.session.call("browser_navigate", { url: input.targetUrl });
    if (!this.#locatorStore.isFeatureEnabled()) {
      await this.cancelLocatorDiscovery(input);
      throw new Error("Locator discovery was cancelled because the feature was disabled");
    }
    active.currentUrl = input.targetUrl;
    if (active.input.mode === "guided")
      await this.#captureLocatorPage(input.projectId, input.sessionId);
    return this.#locatorSessionResult(input.projectId, input.sessionId);
  }

  captureLocatorPage(
    input: TestingLocatorDiscoverySessionInput,
  ): Promise<TestingLocatorDiscoverySession> {
    return this.#captureLocatorPage(
      input.projectId,
      input.sessionId,
      input.captureMode ?? "relevant",
      input.previewSnapshot,
    );
  }

  async finishLocatorDiscovery(
    input: TestingLocatorDiscoverySessionInput,
  ): Promise<TestingLocatorDiscoverySession> {
    const active = await this.#activeLocatorSession(input.projectId, input.sessionId);
    this.#locatorSessions.delete(input.sessionId);
    await active.session?.close();
    this.#locatorStore.finishSession(
      input.projectId,
      input.sessionId,
      "completed",
      "completed",
      "Locator discovery completed",
    );
    return this.#locatorSessionResult(input.projectId, input.sessionId);
  }

  async cancelLocatorDiscovery(
    input: TestingLocatorDiscoverySessionInput,
  ): Promise<TestingLocatorDiscoverySession> {
    const active = this.#locatorSessions.get(input.sessionId);
    if (active?.input.projectId === input.projectId) {
      this.#locatorSessions.delete(input.sessionId);
      await active.session?.close();
    }
    this.#locatorStore.finishSession(
      input.projectId,
      input.sessionId,
      "cancelled",
      this.#locatorStore.isFeatureEnabled() ? "cancelled" : "feature-disabled",
      this.#locatorStore.isFeatureEnabled()
        ? "Locator discovery cancelled"
        : "Locator discovery cancelled because the feature was disabled",
      true,
    );
    return this.#locatorSessionResult(input.projectId, input.sessionId);
  }

  reviewLocatorEntry(input: TestingLocatorEntryReviewInput): TestingLocatorLibraryResult {
    this.#locatorStore.reviewEntry(input);
    return this.#locatorStore.library(input.projectId);
  }

  updateLocatorPage(input: TestingLocatorPageUpdateInput): TestingLocatorLibraryResult {
    return this.#locatorStore.updatePage(input);
  }

  setLocatorPageSelection(input: TestingLocatorPageSelectionInput): TestingLocatorLibraryResult {
    return this.#locatorStore.setPageSelection(input);
  }

  deleteLocatorPage(input: TestingLocatorPageDeleteInput): TestingLocatorLibraryResult {
    return this.#locatorStore.deletePage(input);
  }

  updatePageObjectCode(input: TestingPageObjectCodeUpdateInput): TestingLocatorLibraryResult {
    return this.#locatorStore.updatePageObjectCode(input);
  }

  previewLocatorRepositoryWrite(
    input: TestingLocatorRepositoryPreviewInput,
  ): Promise<TestingLocatorRepositoryProposal> {
    return previewLocatorRepositoryWrite({
      ...input,
      store: this.#locatorStore,
    });
  }

  applyLocatorRepositoryWrite(
    input: TestingLocatorRepositoryApplyInput,
  ): Promise<TestingLocatorRepositoryApplyResult> {
    return applyLocatorRepositoryWrite({ ...input, store: this.#locatorStore });
  }

  previewLocatorSync(input: TestingProjectInput): TestingLocatorSyncPreview {
    return this.#locatorStore.previewSync(input.projectId);
  }

  resolveLocatorSync(input: TestingLocatorSyncDecisionInput): TestingLocatorSyncPreview {
    return this.#locatorStore.resolveSync(input);
  }

  disconnectLocatorFolder(input: TestingProjectInput): TestingLocatorLibraryResult {
    return this.#locatorStore.disconnectSources(input.projectId);
  }

  indexLocatorFolder(input: TestingLocatorFolderInput): Promise<TestingLocatorFolderResult> {
    if (!this.#locatorStore.isFeatureEnabled()) {
      throw new Error("Locator-first discovery is disabled by the server feature flag");
    }
    return indexLocatorFolder({
      ...input,
      targetUrl: this.#store.summary(input.projectId).targetUrl,
      store: this.#locatorStore,
    });
  }

  async verifyLocators(
    input: TestingLocatorVerificationInput,
  ): Promise<TestingLocatorLibraryResult> {
    const session = await createPlaywrightMcpSession({
      profilePath: join(this.#testingRoot, "auth", shortDigest(input.projectId)),
      outputPath: join(this.#testingRoot, "mcp-output", `verify-${crypto.randomUUID()}`),
      headless: true,
      ...(input.cdpEndpoint ? { cdpEndpoint: input.cdpEndpoint } : {}),
    });
    try {
      const library = this.#locatorStore.library(input.projectId);
      const requested = new Set(input.entryIds);
      for (const page of library.pages.filter((candidate) =>
        candidate.entries.some((entry) => requested.has(entry.id)),
      )) {
        if (!this.#locatorStore.isFeatureEnabled()) {
          throw new Error(
            "Locator verification stopped because locator-first discovery is disabled",
          );
        }
        const rawTarget = new URL(input.targetUrl);
        try {
          const pagePattern = new URL(page.urlPattern);
          if (!decodeURIComponent(pagePattern.pathname).includes("<REDACTED_PATH_SEGMENT>")) {
            rawTarget.pathname = pagePattern.pathname;
            rawTarget.hash = pagePattern.hash;
          }
          rawTarget.search = "";
        } catch {
          // Repository-only pages without a real URL are verified at the supplied target.
        }
        await session.call("browser_navigate", { url: rawTarget.href });
        const capture = await captureLocatorSnapshot({
          projectId: input.projectId,
          session,
          coverage: "everything-accessible",
          maxElements: 5_000,
          fallbackUrl: rawTarget.href,
        });
        for (const entry of page.entries.filter((item) => requested.has(item.id))) {
          const count =
            capture.resolvedCounts?.get(entry.locatorKey) ??
            countLocatorMatches(capture.storedSnapshot, entry);
          this.#locatorStore.recordVerification({
            projectId: input.projectId,
            entryId: entry.id,
            versionId: entry.currentVersionId,
            environmentLabel: input.environmentLabel?.trim() || "default",
            targetUrl: capture.rawUrl,
            status: verificationStatusForCount(count),
            matchCount: count,
            pageFingerprint: capture.fingerprint,
            message: count === 1 ? "Locator resolved uniquely" : `Locator resolved ${count} times`,
          });
        }
      }
      return this.#locatorStore.library(input.projectId);
    } finally {
      await session.close();
    }
  }

  async importUserStory(input: TestingStoryImportInput): Promise<TestingStoryImportResult> {
    if (!this.#textGeneration) throw new Error("No configured Fusion model backend is available");
    const parsed = await parseUserStory(input);
    const sanitized = sanitizeModelBoundText(input.projectId, parsed.content);
    const storyImportId = this.#locatorStore.createStoryImport({
      projectId: input.projectId,
      sourceName: parsed.sourceName,
      sourceKind: parsed.sourceKind,
      sanitizedContent: sanitized.tokenized,
    });
    const library = this.#locatorStore.library(input.projectId);
    const locatorContext = library.pages
      .flatMap((page) =>
        page.entries
          .filter((entry) => entry.lifecycleStatus !== "archived")
          .map((entry) => `${entry.locatorKey}: ${entry.classification} on ${page.name}`),
      )
      .slice(0, 1_000)
      .join("\n");
    const generated = await Effect.runPromise(
      this.#textGeneration.generateStructuredTesting({
        cwd: input.projectPath,
        taskKind: "story-to-cases",
        sanitizedPrompt: [
          "Convert the following user story into concise, reviewable QA cases.",
          "Return exactly one expectedResults item for every step, in the same order.",
          "Reference only locator keys from the supplied Locator Library when they apply.",
          "User story:",
          sanitized.tokenized,
          "Locator Library:",
          locatorContext || "No locators captured yet; leave locatorKeys empty.",
        ].join("\n\n"),
        outputSchema: StoryCases,
        modelSelection: input.modelSelection,
        reasoningTier: "medium",
        budget: { maxEstimatedTokens: 30_000, maxEstimatedCostUsd: 2 },
      }),
    );
    const beforeIds = new Set(this.#store.listCases(input.projectId).cases.map((item) => item.id));
    const cases = this.#store.saveGeneratedCases(
      input.projectId,
      generated.cases.map((testCase, index) => ({
        externalId: testCase.externalId.trim() || `STORY-${String(index + 1).padStart(3, "0")}`,
        description: testCase.description,
        steps: [
          ...testCase.preconditions.map((item) => `Precondition: ${item}`),
          ...testCase.steps,
        ],
        expectedResults: [
          ...testCase.preconditions.map((item) => `Precondition is satisfied: ${item}`),
          ...testCase.expectedResults,
        ],
        expectedResult: testCase.expectedResults.filter(Boolean).join("\n"),
        matchedStateIds: [],
      })),
    ).cases;
    const created = cases.filter((item) => !beforeIds.has(item.id));
    const libraryEntries = library.pages.flatMap((page) => page.entries);
    for (const createdCase of created) {
      const generatedCase = generated.cases.find(
        (item) => item.externalId.trim() === createdCase.externalId,
      );
      if (!generatedCase) continue;
      this.#locatorStore.mapCaseLocators(
        createdCase.id,
        generatedCase.locatorKeys.flatMap((locatorKey, stepIndex) => {
          const entry = libraryEntries.find((item) => item.locatorKey === locatorKey);
          return entry
            ? [
                {
                  entryId: entry.id,
                  versionId: entry.currentVersionId,
                  stepIndex,
                  source: "story" as const,
                },
              ]
            : [];
        }),
      );
    }
    this.#locatorStore.updateStoryCases(
      storyImportId,
      created.map((item) => item.id),
    );
    const groupedCases = this.#store.listCases(input.projectId);
    return {
      storyImportId,
      sourceName: parsed.sourceName,
      generatedCount: created.length,
      ...this.#withCaseLocatorMappings(input.projectId, {
        cases,
        groups: groupedCases.groups,
      }),
    };
  }

  async startAuthCapture(input: TestingTargetInput): Promise<TestingAuthStartResult> {
    if (this.#authCaptures.has(input.projectId)) {
      throw new Error("An authentication capture browser is already open for this project");
    }
    const target = new URL(input.targetUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("Authentication capture requires an http:// or https:// target URL");
    }
    const projectKey = shortDigest(input.projectId);
    const profilePath = join(this.#testingRoot, "auth", projectKey);
    const outputPath = join(this.#testingRoot, "mcp-output", `auth-${projectKey}`);
    const session = await createPlaywrightMcpSession({
      profilePath,
      outputPath,
      headless: false,
    });
    await session.call("browser_navigate", { url: target.href });
    this.#authCaptures.set(input.projectId, {
      session,
      profilePath,
      outputPath,
    });
    return { started: true, profilePath };
  }

  async finishAuthCapture(input: TestingProjectInput): Promise<TestingGraphSummary> {
    const capture = this.#authCaptures.get(input.projectId);
    if (!capture) {
      throw new Error("No authentication capture browser is open for this project");
    }
    this.#authCaptures.delete(input.projectId);
    try {
      const exportedStatePath = join(capture.outputPath, "storage-state.json");
      await capture.session.call("browser_storage_state", {
        filename: exportedStatePath,
      });
      await chmod(exportedStatePath, 0o600);
      const storageStatePath = join(capture.profilePath, "storage-state.json");
      await copyFile(exportedStatePath, storageStatePath);
      await chmod(storageStatePath, 0o600);
    } finally {
      await capture.session.close();
    }
    this.#store.recordAuthSession(input.projectId, capture.profilePath);
    return this.#store.summary(input.projectId);
  }

  async startExploration(input: TestingExplorationInput): Promise<TestingExplorationResult> {
    if (this.#runningCrawls.has(input.projectId)) {
      throw new Error("An exploration is already running for this project");
    }
    if (this.#authCaptures.has(input.projectId)) {
      throw new Error("Finish authentication capture before starting exploration");
    }
    this.#runningCrawls.add(input.projectId);
    try {
      return await new TestingCrawler(this.#store, this.#testingRoot).explore(input);
    } finally {
      this.#runningCrawls.delete(input.projectId);
    }
  }

  async importWorkbook(input: TestingWorkbookImportInput): Promise<TestingWorkbookImportResult> {
    const parsed = await parseTestingWorkbook(input.workbookPath);
    const graph = this.#store.graph(input.projectId);
    const targetUrl = input.targetUrl ?? this.#store.summary(input.projectId).targetUrl;
    const initialEntries = this.#locatorStore
      .library(input.projectId)
      .pages.flatMap((page) => page.entries);
    const candidates = new Set<string>();
    for (const parsedCase of parsed.cases) {
      for (const step of parsedCase.steps) {
        const candidate = bestLocatorForStep(step, initialEntries);
        if (candidate) candidates.add(candidate.id);
      }
    }
    if (targetUrl && candidates.size > 0) {
      await this.verifyLocators({
        projectId: input.projectId,
        targetUrl,
        ...(input.cdpEndpoint ? { cdpEndpoint: input.cdpEndpoint } : {}),
        entryIds: [...candidates],
        environmentLabel: "default",
      });
    }
    const entries = this.#locatorStore
      .library(input.projectId)
      .pages.flatMap((page) => page.entries);
    const mappingsByExternalId = new Map<
      string,
      Array<{ entry: TestingLocatorEntry; stepIndex: number }>
    >();
    const reconciled = [];
    for (const parsedCase of parsed.cases) {
      if (graph.nodes.length > 0 && targetUrl) {
        const graphMatch = reconcileWorkbookCase(parsedCase, graph);
        reconciled.push(
          await verifyReconciledCaseLive({
            projectId: input.projectId,
            targetUrl,
            ...(input.cdpEndpoint ? { cdpEndpoint: input.cdpEndpoint } : {}),
            testingRoot: this.#testingRoot,
            store: this.#store,
            reconciled: graphMatch,
          }),
        );
      } else {
        const mismatches: TestingMismatch[] = parsedCase.errors.map((error) => ({
          stepIndex: null,
          expected: parsedCase.externalId,
          actual: error,
          kind: error.startsWith("Duplicate") ? "duplicate" : "parse",
        }));
        const mappings: Array<{
          entry: TestingLocatorEntry;
          stepIndex: number;
        }> = [];
        parsedCase.steps.forEach((step, stepIndex) => {
          const candidate = bestLocatorForStep(step, entries);
          if (candidate?.verificationStatus === "verified") {
            mappings.push({ entry: candidate, stepIndex });
          } else {
            mismatches.push({
              stepIndex,
              expected: step,
              actual: candidate
                ? `Locator ${candidate.locatorKey} is ${candidate.verificationStatus}`
                : "Locator needed: no matching Locator Library entry was found",
              kind: "unreachable",
            });
          }
        });
        mappingsByExternalId.set(parsedCase.externalId, mappings);
        reconciled.push({
          externalId: parsedCase.externalId,
          description: parsedCase.description,
          steps: parsedCase.steps,
          expectedResults: parsedCase.expectedResults,
          expectedResult: parsedCase.expectedResult,
          sourceSheet: parsedCase.sourceSheet,
          sourceRow: parsedCase.sourceRow,
          status:
            parsedCase.errors.length > 0
              ? ("blocked" as const)
              : mismatches.length > 0
                ? ("needs-review" as const)
                : ("matches" as const),
          mismatches,
          matchedStateIds: [],
        });
      }
    }
    const result = this.#store.saveImportedCases({
      projectId: input.projectId,
      workbookName: parsed.workbookName,
      workbookPath: input.workbookPath,
      ...(input.groupName ? { groupName: input.groupName } : {}),
      cases: reconciled,
    });
    for (const testCase of result.cases) {
      const mappings =
        mappingsByExternalId.get(testCase.externalId) ??
        testCase.steps.flatMap((step, stepIndex) => {
          const entry = bestLocatorForStep(step, entries);
          return entry?.verificationStatus === "verified" ? [{ entry, stepIndex }] : [];
        });
      this.#locatorStore.mapCaseLocators(
        testCase.id,
        mappings.map(({ entry, stepIndex }) => ({
          entryId: entry.id,
          versionId: entry.currentVersionId,
          stepIndex,
          source: "excel",
        })),
      );
    }
    return {
      ...result,
      cases: this.#withCaseLocatorMappings(input.projectId, {
        cases: result.cases,
        groups: result.groups,
      }).cases,
    };
  }

  listCases(input: TestingProjectInput): TestingCaseListResult {
    return this.#withCaseLocatorMappings(input.projectId, this.#store.listCases(input.projectId));
  }

  createCase(input: TestingCaseCreateInput): TestingCaseListResult {
    const externalId =
      input.externalId?.trim() || this.#locatorStore.allocateCaseIds(input.projectId, 1)[0]!;
    const result = this.#store.createCase({ ...input, externalId });
    const created = result.cases.find((testCase) => testCase.externalId === externalId);
    if (!created) throw new Error("The manual case was not created");
    this.#locatorStore.replaceCaseLocators(
      input.projectId,
      created.id,
      input.locatorEntryIds ?? [],
    );
    return this.#withCaseLocatorMappings(input.projectId, result);
  }

  reviewCase(input: TestingCaseReviewInput): TestingCaseListResult {
    const result = this.#store.reviewCase(input);
    if (input.locatorEntryIds) {
      this.#locatorStore.replaceCaseLocators(input.projectId, input.caseId, input.locatorEntryIds);
    }
    return this.#withCaseLocatorMappings(input.projectId, result);
  }

  deleteCase(input: TestingCaseDeleteInput): TestingCaseListResult {
    this.#locatorStore.replaceCaseLocators(input.projectId, input.caseId, []);
    return this.#withCaseLocatorMappings(
      input.projectId,
      this.#store.deleteCase(input.projectId, input.caseId),
    );
  }

  updateCaseGroup(input: TestingCaseGroupUpdateInput): TestingCaseListResult {
    return this.#withCaseLocatorMappings(input.projectId, this.#store.updateCaseGroup(input));
  }

  createCaseGroup(input: TestingCaseGroupCreateInput): TestingCaseListResult {
    return this.#withCaseLocatorMappings(
      input.projectId,
      this.#store.createCaseGroup(input.projectId, input.groupName),
    );
  }

  deleteCaseGroup(input: TestingCaseGroupDeleteInput): TestingCaseListResult {
    return this.#withCaseLocatorMappings(
      input.projectId,
      this.#store.deleteCaseGroup(input.projectId, input.groupName),
    );
  }

  generateScenarios(input: TestingProjectInput): TestingCaseListResult {
    const graph = this.#store.graph(input.projectId);
    const scenarios = scenariosFromGraph(graph);
    if (scenarios.length === 0) {
      throw new Error("Explore the target application before generating discovered scenarios");
    }

    const existingResult = this.#store.listCases(input.projectId);
    const existingCases = existingResult.cases;
    const existingGenerated = existingCases.filter((c) => c.source === "generated");

    const newScenarios = scenarios.filter((scenario) => {
      const stepsJson = JSON.stringify(scenario.steps);
      return !existingGenerated.some((existing) => JSON.stringify(existing.steps) === stepsJson);
    });

    if (newScenarios.length === 0) {
      return this.#withCaseLocatorMappings(input.projectId, existingResult);
    }

    const allocatedIds = this.#locatorStore.allocateCaseIds(input.projectId, newScenarios.length);
    const renumberedScenarios = newScenarios.map((scenario, index) => ({
      ...scenario,
      externalId: allocatedIds[index]!,
    }));

    return this.#withCaseLocatorMappings(
      input.projectId,
      this.#store.saveGeneratedCases(input.projectId, renumberedScenarios),
    );
  }

  clearGraph(input: TestingProjectInput): TestingClearGraphResult {
    if (this.#runningCrawls.has(input.projectId)) {
      throw new Error("Wait for the active exploration to finish before clearing its graph");
    }
    return this.#store.clearGraph(input.projectId);
  }

  async generateTests(input: TestingGenerationInput): Promise<TestingGenerationJob> {
    if (input.engine === "recording") {
      const code = input.recordedCode?.trim();
      const expected = input.recordedExpectedResult?.trim();
      if (!code || !expected || code.includes('throw new Error("Add expected-result assertions'))
        throw new Error("Review the recording and add an expected-result assertion before saving.");
      if (/\btest\s*\.\s*(skip|fixme|fail|only)\s*\(/.test(code)) {
        throw new Error(
          "Recorded tests cannot be skipped, marked as expected failures, or exclusive.",
        );
      }
      if (!/\bexpect\s*\(/.test(code)) {
        throw new Error("Recorded tests require at least one Playwright assertion.");
      }
      const jobId = crypto.randomUUID();
      const outputDirectory = join(
        this.#testingRoot,
        "generated",
        shortDigest(input.projectId),
        jobId,
      );
      await mkdir(outputDirectory, { recursive: true });
      const specPath = join(outputDirectory, "recorded.spec.ts");
      const pageObjectPath = join(outputDirectory, "page.ts");
      const dataPath = join(outputDirectory, "data.ts");
      await Promise.all([
        writeFile(specPath, code, { flag: "wx" }),
        writeFile(pageObjectPath, "// Self-contained reviewed recording.\nexport {};\n", {
          flag: "wx",
        }),
        writeFile(
          dataPath,
          "// Input placeholders must be supplied before execution.\nexport {};\n",
          { flag: "wx" },
        ),
      ]);
      const externalId = `REC-${jobId.slice(0, 8)}`;
      const testCase = this.createCase({
        projectId: input.projectId,
        externalId,
        description: "Recorded browser journey",
        steps: ["Replay the reviewed browser recording"],
        expectedResult: expected,
        ...(input.locatorEntryIds ? { locatorEntryIds: [...input.locatorEntryIds] } : {}),
      }).cases.find((item) => item.externalId === externalId)!;
      this.reviewCase({
        projectId: input.projectId,
        caseId: testCase.id,
        decision: "accepted",
        ...(input.locatorEntryIds ? { locatorEntryIds: [...input.locatorEntryIds] } : {}),
      });
      this.#store.createGenerationJob({
        id: jobId,
        projectId: input.projectId,
        outputDirectory,
        totalCases: 1,
        modelSelection: input.modelSelection,
        engine: "recording",
        stage: "generated",
        attemptCount: 1,
        immutableArtifactPaths: [specPath, pageObjectPath, dataPath],
        usageMeasured: true,
      });
      this.#store.addGeneratedArtifact({
        jobId,
        caseId: testCase.id,
        externalId,
        featureSlug: "recorded-journey",
        specPath,
        pageObjectPath,
        dataPath,
        fingerprints: [],
        captureReplay: true,
      });
      this.#store.updateGenerationJob(jobId, {
        status: "completed",
        completedCases: 1,
        estimatedTokens: 0,
        estimatedCostUsd: 0,
      });
      return this.#store.generationJob(input.projectId, jobId)!;
    }
    if (
      input.failureRunId &&
      !this.#store.executionRuns(input.projectId).runs.some((run) => run.id === input.failureRunId)
    ) {
      throw new Error("The failure run does not belong to this project.");
    }
    if (!this.#generator) {
      throw new Error("No configured coding-agent text-generation backend is available");
    }
    const selectedCases = this.#store
      .listCases(input.projectId)
      .cases.filter((testCase) =>
        input.caseIds
          ? input.caseIds.includes(testCase.id)
          : testCase.reviewDecision === "accepted" || testCase.reviewDecision === "edited",
      );
    const entryIds = [
      ...new Set(
        selectedCases.flatMap((testCase) =>
          this.#locatorStore.caseLocators(input.projectId, testCase.id).map((entry) => entry.id),
        ),
      ),
    ];
    return this.#generator.generate(input, {
      background: true,
      ...(entryIds.length > 0 && input.engine !== "official-playwright"
        ? {
            beforeRun: async () => {
              if (!input.targetUrl) {
                throw new Error(
                  "A live target URL is required to reverify selected Locator Library entries",
                );
              }
              await this.verifyLocators({
                projectId: input.projectId,
                targetUrl: input.targetUrl,
                ...(input.cdpEndpoint ? { cdpEndpoint: input.cdpEndpoint } : {}),
                entryIds,
                environmentLabel: "default",
              });
            },
          }
        : {}),
    });
  }

  listGenerationJobs(input: TestingProjectInput): TestingGenerationJobListResult {
    return this.#store.listGenerationJobs(input.projectId);
  }

  cancelGenerationJob(input: TestingGenerationJobInput): TestingGenerationJob {
    if (!this.#generator) {
      throw new Error("No configured coding-agent text-generation backend is available");
    }
    return this.#generator.cancel(input.projectId, input.jobId);
  }

  async readArtifact(input: TestingArtifactReadInput): Promise<TestingArtifactReadResult> {
    const job = this.#store.generationJob(input.projectId, input.generationJobId);
    if (!job) {
      throw new Error("Generation job was not found in this project");
    }
    if (job.status !== "completed") {
      throw new Error("Generation job is not completed");
    }
    const artifact = job.artifacts.find((candidate) => candidate.caseId === input.caseId);
    if (!artifact) {
      throw new Error("Generated artifact was not found for this case");
    }
    const storedPath =
      input.artifactKind === "spec"
        ? artifact.specPath
        : input.artifactKind === "page"
          ? artifact.pageObjectPath
          : artifact.dataPath;
    const [canonicalOutputDirectory, canonicalArtifactPath] = await Promise.all([
      realpath(resolve(job.outputDirectory)),
      realpath(resolve(storedPath)),
    ]).catch((cause) => {
      throw new Error("Generated artifact file is unavailable", { cause });
    });
    if (!isPathInside(canonicalOutputDirectory, canonicalArtifactPath)) {
      throw new Error("Generated artifact path escapes the generation output directory");
    }
    const fileInfo = await stat(canonicalArtifactPath);
    if (!fileInfo.isFile()) {
      throw new Error("Generated artifact path is not a file");
    }
    if (fileInfo.size > MAX_TESTING_ARTIFACT_PREVIEW_BYTES) {
      throw new Error("Generated artifact is too large to preview");
    }
    return { contents: await readFile(canonicalArtifactPath, "utf8") };
  }

  runTests(input: TestingExecutionInput): Promise<TestingExecutionRun> {
    return this.#executor.execute(input);
  }

  cancelExecutionRun(input: TestingExecutionRunInput): TestingExecutionRun {
    return this.#executor.cancel(input.projectId, input.runId);
  }

  listExecutionRuns(input: TestingProjectInput): TestingExecutionRunListResult {
    return this.#store.executionRuns(input.projectId);
  }

  decideHealingProposal(input: TestingHealingDecisionInput): TestingExecutionRunListResult {
    const proposal = this.#store.healingProposal(input.projectId, input.proposalId);
    if (!proposal) throw new Error("Healing proposal not found");
    if (
      input.decision === "accepted" &&
      proposal.status === "pending" &&
      proposal.locatorEntryId &&
      proposal.locatorVersionId
    ) {
      this.#locatorStore.promoteHealing({
        projectId: input.projectId,
        entryId: proposal.locatorEntryId,
        expectedVersionId: proposal.locatorVersionId,
        strategy: "role",
        arguments: { role: proposal.proposedRole, name: proposal.proposedName },
        semanticContext: proposal.proposedName,
        environmentLabel: "default",
        targetUrl: proposal.targetUrl,
      });
    }
    return this.#store.decideHealingProposal(input);
  }

  createSchedule(input: TestingScheduleInput): TestingSchedule {
    return this.#store.createSchedule(input);
  }

  listSchedules(input: TestingProjectInput): TestingScheduleListResult {
    return this.#store.listSchedules(input.projectId);
  }

  generateReport(input: TestingReportInput): Promise<TestingReport> {
    return this.#reporter.generate(input);
  }

  getTraceability(input: TestingTraceabilityInput): TestingTraceabilityResult {
    return this.#store.traceability(input.projectId, input.externalId);
  }

  draftBug(input: TestingBugDraftInput): TestingBugDraft {
    const run = this.#store
      .executionRuns(input.projectId)
      .runs.find((item) => item.id === input.runId);
    const result = run?.results.find((item) => item.caseId === input.caseId);
    const testCase = this.#store
      .listCases(input.projectId)
      .cases.find((item) => item.id === input.caseId);
    if (!run || !result || !testCase || result.status !== "failed") {
      throw new Error("A failed execution result is required to draft a bug");
    }
    return {
      title: `${testCase.externalId}: ${testCase.description}`,
      markdown: [
        `# ${testCase.externalId}: ${testCase.description}`,
        "",
        "## Environment",
        `- Target: ${run.targetUrl}`,
        `- Run: ${run.id}`,
        `- Artifact revision: ${run.artifactRevision}`,
        "",
        "## Reproduction steps",
        ...testCase.steps.map((step, index) => `${index + 1}. ${step}`),
        "",
        "## Expected",
        testCase.expectedResult || testCase.description,
        "",
        "## Actual",
        result.error ?? "The generated test failed without additional error text.",
        "",
        "## Local evidence",
        `- Trace: ${result.tracePath ?? "Not captured"}`,
        `- Screenshot: ${result.screenshotPath ?? "Not captured"}`,
        "",
        "Draft only - review before filing or transmitting.",
      ].join("\n"),
      localOnly: true,
    };
  }

  getGraphExplorer(input: TestingProjectInput): TestingGraphExplorerResult {
    return this.#store.graphExplorer(input.projectId);
  }

  async triageFailure(input: TestingTriageInput): Promise<TestingTriageResult> {
    if (!this.#textGeneration) throw new Error("No configured coding-agent backend is available");
    const run = this.#store
      .executionRuns(input.projectId)
      .runs.find((item) => item.id === input.runId);
    const result = run?.results.find((item) => item.caseId === input.caseId);
    const testCase = this.#store
      .listCases(input.projectId)
      .cases.find((item) => item.id === input.caseId);
    if (
      !run ||
      run.mode !== "ci" ||
      !result ||
      !testCase ||
      result.status !== "failed" ||
      result.quarantined
    ) {
      throw new Error("Triage requires a non-quarantined failed CI case");
    }
    const raw = [
      `Case: ${testCase.externalId} - ${testCase.description}`,
      `Expected steps: ${testCase.steps.join(" | ")}`,
      ...(testCase.expectedResult ? [`Expected outcome: ${testCase.expectedResult}`] : []),
      `Observed failure: ${result.error ?? "No error text"}`,
      `Artifact revision: ${run.artifactRevision}`,
      "Separate observed facts from inference. Decide whether this is an application regression, a test update, or uncertain.",
    ].join("\n");
    const sanitized = tokenizePii(input.projectId, raw).tokenized.replace(
      /(?:authorization|cookie|password|token)\s*[:=]\s*\S+/gi,
      "$1=<REDACTED>",
    );
    return Effect.runPromise(
      this.#textGeneration.generateStructuredTesting({
        cwd: input.projectPath,
        taskKind: "failure-triage",
        sanitizedPrompt: sanitized,
        outputSchema: FailureTriage,
        modelSelection: input.modelSelection,
        reasoningTier: "high",
        budget: { maxEstimatedTokens: 8_000, maxEstimatedCostUsd: 1 },
      }),
    );
  }

  async #activeLocatorSession(
    projectId: string,
    sessionId: string,
  ): Promise<LocatorCaptureSession> {
    const active = this.#locatorSessions.get(sessionId);
    if (!active || active.input.projectId !== projectId) {
      throw new Error("The locator-discovery session is not active for this project");
    }
    if (!this.#locatorStore.isFeatureEnabled()) {
      await this.cancelLocatorDiscovery({ projectId, sessionId });
      throw new Error("Locator discovery was cancelled because the feature was disabled");
    }
    return active;
  }

  async #captureLocatorPage(
    projectId: string,
    sessionId: string,
    captureMode: "relevant" | "page" | "all" = "relevant",
    previewSnapshot?: TestingLocatorPreviewSnapshot,
  ): Promise<TestingLocatorDiscoverySession> {
    const active = await this.#activeLocatorSession(projectId, sessionId);
    if (!active.session && !previewSnapshot)
      throw new Error("Capture the current preview before scanning.");
    const capture = await captureLocatorSnapshot({
      projectId,
      session: active.session,
      ...(previewSnapshot ? { previewSnapshot } : {}),
      coverage: captureMode === "all" ? "everything-accessible" : active.input.coverage,
      maxElements: active.input.maxElementsPerPage,
      fallbackUrl: active.currentUrl,
      ...(captureMode === "relevant" &&
      active.input.captureScope === "task" &&
      active.input.taskContext?.trim()
        ? { taskContext: active.input.taskContext.trim() }
        : {}),
    });
    const capturedUrl = sanitizePersistedUrl(capture.rawUrl);
    if (
      active.capturedUrls.size >= active.input.maxPagesPerSession &&
      !active.capturedUrls.has(capturedUrl)
    ) {
      throw new Error(
        `Reached the ${active.input.maxPagesPerSession}-page session limit. Finish discovery and start a new session to scan this page.`,
      );
    }
    if (!this.#locatorStore.isFeatureEnabled()) {
      await this.cancelLocatorDiscovery({ projectId, sessionId });
      throw new Error("Locator discovery was cancelled because the feature was disabled");
    }
    active.currentUrl = capture.rawUrl;
    this.#locatorStore.saveCapturedPage({
      projectId,
      sessionId,
      rawUrl: capture.rawUrl,
      environmentLabel: active.input.environmentLabel?.trim() || "default",
      fingerprint: capture.fingerprint,
      captureSource: active.input.mode,
      candidates: capture.candidates,
      observedElements: capture.observedElements,
      truncatedElements: capture.truncatedElements,
      replaceMissing:
        captureMode !== "relevant" &&
        capture.truncatedElements === 0 &&
        capture.candidates.length > 0,
    });
    active.capturedUrls.add(capturedUrl);
    const library = this.#locatorStore.library(projectId);
    const capturedPage = library.pages.find(
      (page) => page.urlPattern === sanitizePersistedUrl(capture.rawUrl),
    );
    if (capturedPage) {
      for (const entry of capturedPage.entries) {
        const count =
          capture.resolvedCounts?.get(entry.locatorKey) ??
          countLocatorMatches(capture.storedSnapshot, entry);
        this.#locatorStore.recordVerification({
          projectId,
          entryId: entry.id,
          versionId: entry.currentVersionId,
          environmentLabel: active.input.environmentLabel?.trim() || "default",
          targetUrl: capture.rawUrl,
          status: verificationStatusForCount(count),
          matchCount: count,
          pageFingerprint: capture.fingerprint,
          message:
            count === 1 ? "Verified during capture" : `Resolved ${count} times during capture`,
        });
      }
    }
    return this.#locatorSessionResult(projectId, sessionId);
  }

  #locatorSessionResult(projectId: string, sessionId: string): TestingLocatorDiscoverySession {
    const row = this.#locatorStore.session(projectId, sessionId);
    if (!row) throw new Error("Locator-discovery session was not found");
    return {
      id: sessionId,
      projectId,
      status: row.status as TestingLocatorDiscoverySession["status"],
      mode: row.mode as TestingLocatorDiscoverySession["mode"],
      coverage: row.coverage as TestingLocatorDiscoverySession["coverage"],
      safetyProfile: row.safety_profile as TestingLocatorDiscoverySession["safetyProfile"],
      currentUrl: typeof row.current_url_pattern === "string" ? row.current_url_pattern : null,
      currentPageName: typeof row.current_page_name === "string" ? row.current_page_name : null,
      observedElements: Number(row.observed_elements ?? 0),
      storedElements: Number(row.stored_elements ?? 0),
      truncatedElements: Number(row.truncated_elements ?? 0),
      capturedPages: Number(row.captured_pages ?? 0),
      terminationReason:
        (row.termination_reason as TestingLocatorDiscoverySession["terminationReason"]) ?? null,
      message: typeof row.message === "string" ? row.message : "",
      library: this.#locatorStore.library(projectId),
    };
  }
}
