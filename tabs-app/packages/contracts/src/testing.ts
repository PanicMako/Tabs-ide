import * as Schema from "effect/Schema";
import { ModelSelection } from "./orchestration.ts";

export const TestingProjectInput = Schema.Struct({
  projectId: Schema.String,
});
export type TestingProjectInput = typeof TestingProjectInput.Type;

export const TestingTargetInput = Schema.Struct({
  projectId: Schema.String,
  targetUrl: Schema.String,
});
export type TestingTargetInput = typeof TestingTargetInput.Type;

export const DEFAULT_TESTING_MAX_STATES = 30;
export const MAX_TESTING_MAX_STATES = 10_000;
export const DEFAULT_TESTING_EXPLORATION_SCOPE = "origin";
export const TESTING_EXPLORATION_SCOPES = ["page", "path", "origin"] as const;
export const MAX_TESTING_DURATION_SECONDS = 86_400;

export const TestingExplorationScope = Schema.Literals(TESTING_EXPLORATION_SCOPES);
export type TestingExplorationScope = typeof TestingExplorationScope.Type;

export const TestingExplorationInput = Schema.Struct({
  projectId: Schema.String,
  targetUrl: Schema.String,
  cdpEndpoint: Schema.optionalKey(Schema.String),
  scope: Schema.optionalKey(TestingExplorationScope),
  maxStates: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
      Schema.isLessThanOrEqualTo(MAX_TESTING_MAX_STATES),
    ),
  ),
  maxDurationSeconds: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
      Schema.isLessThanOrEqualTo(MAX_TESTING_DURATION_SECONDS),
    ),
  ),
});
export type TestingExplorationInput = typeof TestingExplorationInput.Type;

export const TESTING_DISCOVERY_MODES = ["automatic", "guided", "manual"] as const;
export const TESTING_LOCATOR_COVERAGE_MODES = [
  "actions-assertions",
  "actions-only",
  "everything-accessible",
] as const;
export const TESTING_DISCOVERY_SAFETY_PROFILES = [
  "supervised",
  "read-only",
  "configured-unattended",
] as const;
export const TESTING_LOCATOR_STORAGE_MODES = [
  "managed",
  "connected-repository",
  "snapshot-export",
] as const;
export const DEFAULT_TESTING_MAX_ELEMENTS_PER_PAGE = 500;
export const MIN_TESTING_MAX_ELEMENTS_PER_PAGE = 50;
export const MAX_TESTING_MAX_ELEMENTS_PER_PAGE = 5_000;
export const DEFAULT_TESTING_MAX_PAGES_PER_SESSION = 25;
export const MAX_TESTING_MAX_PAGES_PER_SESSION = 250;

export const TestingDiscoveryMode = Schema.Literals(TESTING_DISCOVERY_MODES);
export type TestingDiscoveryMode = typeof TestingDiscoveryMode.Type;
export const TestingLocatorCoverageMode = Schema.Literals(TESTING_LOCATOR_COVERAGE_MODES);
export type TestingLocatorCoverageMode = typeof TestingLocatorCoverageMode.Type;
export const TestingDiscoverySafetyProfile = Schema.Literals(TESTING_DISCOVERY_SAFETY_PROFILES);
export type TestingDiscoverySafetyProfile = typeof TestingDiscoverySafetyProfile.Type;
export const TestingLocatorStorageMode = Schema.Literals(TESTING_LOCATOR_STORAGE_MODES);
export type TestingLocatorStorageMode = typeof TestingLocatorStorageMode.Type;
export const TestingDiscoveryExperience = Schema.Literals(["classic", "locator-first"]);
export type TestingDiscoveryExperience = typeof TestingDiscoveryExperience.Type;

export const TestingLocatorPreviewSnapshot = Schema.Struct({
  url: Schema.String,
  snapshot: Schema.String.check(Schema.isMaxLength(2_000_000)),
  elements: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        selector: Schema.String,
        name: Schema.String,
        tag: Schema.String,
        role: Schema.String,
        testId: Schema.String,
        matchCount: Schema.Int,
        fragile: Schema.Boolean,
      }),
    ),
  ),
});
export type TestingLocatorPreviewSnapshot = typeof TestingLocatorPreviewSnapshot.Type;

export const TestingLocatorDiscoveryInput = Schema.Struct({
  previewSnapshot: Schema.optionalKey(TestingLocatorPreviewSnapshot),
  projectId: Schema.String,
  targetUrl: Schema.String,
  cdpEndpoint: Schema.optionalKey(Schema.String),
  mode: TestingDiscoveryMode,
  scope: TestingExplorationScope,
  coverage: TestingLocatorCoverageMode,
  safetyProfile: TestingDiscoverySafetyProfile,
  approvedActionCategories: Schema.optionalKey(Schema.Array(Schema.String)),
  maxStates: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
      Schema.isLessThanOrEqualTo(MAX_TESTING_MAX_STATES),
    ),
  ),
  maxDurationSeconds: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
      Schema.isLessThanOrEqualTo(MAX_TESTING_DURATION_SECONDS),
    ),
  ),
  maxElementsPerPage: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(MIN_TESTING_MAX_ELEMENTS_PER_PAGE),
  ).check(Schema.isLessThanOrEqualTo(MAX_TESTING_MAX_ELEMENTS_PER_PAGE)),
  maxPagesPerSession: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
    Schema.isLessThanOrEqualTo(MAX_TESTING_MAX_PAGES_PER_SESSION),
  ),
  environmentLabel: Schema.optionalKey(Schema.String),
  captureScope: Schema.optionalKey(Schema.Literals(["task", "page", "path", "origin"])),
  taskContext: Schema.optionalKey(Schema.String),
});
export type TestingLocatorDiscoveryInput = typeof TestingLocatorDiscoveryInput.Type;

export const TestingLocatorDiscoverySessionInput = Schema.Struct({
  previewSnapshot: Schema.optionalKey(TestingLocatorPreviewSnapshot),
  projectId: Schema.String,
  sessionId: Schema.String,
  captureMode: Schema.optionalKey(Schema.Literals(["relevant", "page", "all"])),
});
export type TestingLocatorDiscoverySessionInput = typeof TestingLocatorDiscoverySessionInput.Type;

export const TestingLocatorDiscoveryNavigateInput = Schema.Struct({
  projectId: Schema.String,
  sessionId: Schema.String,
  targetUrl: Schema.String,
});
export type TestingLocatorDiscoveryNavigateInput = typeof TestingLocatorDiscoveryNavigateInput.Type;

export const TestingDiscoveryExperienceInput = Schema.Struct({
  projectId: Schema.String,
  experience: TestingDiscoveryExperience,
});
export type TestingDiscoveryExperienceInput = typeof TestingDiscoveryExperienceInput.Type;

export const TestingCaseIdPolicyInput = Schema.Struct({
  projectId: Schema.String,
  prefix: Schema.String,
  padding: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(12)),
  nextSequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
export type TestingCaseIdPolicyInput = typeof TestingCaseIdPolicyInput.Type;

export const TestingLocatorFolderInput = Schema.Struct({
  projectId: Schema.String,
  projectPath: Schema.String,
  folderPath: Schema.String,
  storageMode: TestingLocatorStorageMode,
});
export type TestingLocatorFolderInput = typeof TestingLocatorFolderInput.Type;

export const TestingLocatorEntryReviewInput = Schema.Struct({
  projectId: Schema.String,
  entryId: Schema.String,
  decision: Schema.Literals(["accept", "archive", "keep-managed", "restore"]),
  locatorKey: Schema.optionalKey(Schema.String),
  classification: Schema.optionalKey(Schema.Literals(["action", "assertion", "content"])),
  strategy: Schema.optionalKey(
    Schema.Literals([
      "role",
      "label",
      "test-id",
      "placeholder",
      "alt-text",
      "title",
      "text",
      "css",
    ]),
  ),
  arguments: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Boolean])),
  ),
  semanticContext: Schema.optionalKey(Schema.String),
});
export type TestingLocatorEntryReviewInput = typeof TestingLocatorEntryReviewInput.Type;

export const TestingLocatorPageUpdateInput = Schema.Struct({
  projectId: Schema.String,
  pageId: Schema.String,
  name: Schema.String,
});
export type TestingLocatorPageUpdateInput = typeof TestingLocatorPageUpdateInput.Type;

export const TestingLocatorPageSelectionInput = Schema.Struct({
  projectId: Schema.String,
  pageId: Schema.String,
  entryIds: Schema.Array(Schema.String),
});
export type TestingLocatorPageSelectionInput = typeof TestingLocatorPageSelectionInput.Type;

export const TestingLocatorPageDeleteInput = Schema.Struct({
  projectId: Schema.String,
  pageId: Schema.String,
});
export type TestingLocatorPageDeleteInput = typeof TestingLocatorPageDeleteInput.Type;

export const TestingPageObjectCodeUpdateInput = Schema.Struct({
  projectId: Schema.String,
  pageId: Schema.String,
  expectedSourceHash: Schema.String,
  code: Schema.String,
});
export type TestingPageObjectCodeUpdateInput = typeof TestingPageObjectCodeUpdateInput.Type;

export const TestingLocatorRepositoryPreviewInput = Schema.Struct({
  projectId: Schema.String,
  projectPath: Schema.String,
  pageId: Schema.String,
  destinationFolder: Schema.String,
  fileName: Schema.String,
});
export type TestingLocatorRepositoryPreviewInput = typeof TestingLocatorRepositoryPreviewInput.Type;

export const TestingLocatorRepositoryApplyInput = Schema.Struct({
  projectId: Schema.String,
  projectPath: Schema.String,
  pageId: Schema.String,
  destinationFolder: Schema.String,
  fileName: Schema.String,
  expectedArtifactSourceHash: Schema.String,
  expectedDestinationSourceHash: Schema.NullOr(Schema.String),
});
export type TestingLocatorRepositoryApplyInput = typeof TestingLocatorRepositoryApplyInput.Type;

export const TestingLocatorSyncDecisionInput = Schema.Struct({
  projectId: Schema.String,
  conflictId: Schema.String,
  decision: Schema.Literals(["keep-managed", "accept-repository", "archive"]),
});
export type TestingLocatorSyncDecisionInput = typeof TestingLocatorSyncDecisionInput.Type;

export const TestingLocatorVerificationInput = Schema.Struct({
  projectId: Schema.String,
  targetUrl: Schema.String,
  cdpEndpoint: Schema.optionalKey(Schema.String),
  entryIds: Schema.Array(Schema.String),
  environmentLabel: Schema.optionalKey(Schema.String),
});
export type TestingLocatorVerificationInput = typeof TestingLocatorVerificationInput.Type;

export const TestingStoryImportInput = Schema.Struct({
  projectId: Schema.String,
  projectPath: Schema.String,
  sourceKind: Schema.Literals(["text", "markdown", "file"]),
  content: Schema.optionalKey(Schema.String),
  filePath: Schema.optionalKey(Schema.String),
  modelSelection: ModelSelection,
});
export type TestingStoryImportInput = typeof TestingStoryImportInput.Type;

export const TestingWorkbookImportInput = Schema.Struct({
  projectId: Schema.String,
  workbookPath: Schema.String,
  groupName: Schema.optionalKey(Schema.String),
  targetUrl: Schema.optionalKey(Schema.String),
  cdpEndpoint: Schema.optionalKey(Schema.String),
});
export type TestingWorkbookImportInput = typeof TestingWorkbookImportInput.Type;

export const TestingCaseReviewInput = Schema.Struct({
  projectId: Schema.String,
  caseId: Schema.String,
  decision: Schema.Literals(["accepted", "edited", "rejected"]),
  externalId: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  steps: Schema.optionalKey(Schema.Array(Schema.String)),
  expectedResults: Schema.optionalKey(Schema.Array(Schema.String)),
  expectedResult: Schema.optionalKey(Schema.String),
  notes: Schema.optionalKey(Schema.String),
  locatorEntryIds: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type TestingCaseReviewInput = typeof TestingCaseReviewInput.Type;

export const TestingCaseDeleteInput = Schema.Struct({
  projectId: Schema.String,
  caseId: Schema.String,
});
export type TestingCaseDeleteInput = typeof TestingCaseDeleteInput.Type;

export const TestingCaseGroupUpdateInput = Schema.Struct({
  projectId: Schema.String,
  caseId: Schema.String,
  groupName: Schema.String,
});
export type TestingCaseGroupUpdateInput = typeof TestingCaseGroupUpdateInput.Type;

export const TestingCaseGroupCreateInput = Schema.Struct({
  projectId: Schema.String,
  groupName: Schema.String,
});
export type TestingCaseGroupCreateInput = typeof TestingCaseGroupCreateInput.Type;

export const TestingCaseGroupDeleteInput = Schema.Struct({
  projectId: Schema.String,
  groupName: Schema.String,
});
export type TestingCaseGroupDeleteInput = typeof TestingCaseGroupDeleteInput.Type;

export const TestingCaseCreateInput = Schema.Struct({
  projectId: Schema.String,
  externalId: Schema.optionalKey(Schema.String),
  description: Schema.String,
  steps: Schema.Array(Schema.String),
  expectedResults: Schema.optionalKey(Schema.Array(Schema.String)),
  expectedResult: Schema.String,
  locatorEntryIds: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type TestingCaseCreateInput = typeof TestingCaseCreateInput.Type;

export const DEFAULT_TESTING_BATCH_MAX_CASES = 25;
export const DEFAULT_TESTING_BATCH_MAX_TOKENS = 200_000;
export const DEFAULT_TESTING_BATCH_MAX_COST_USD = 5;

export const TestingGenerationEngine = Schema.Literals([
  "standard",
  "official-playwright",
  "recording",
]);
export type TestingGenerationEngine = typeof TestingGenerationEngine.Type;

export const TestingGenerationStage = Schema.Literals([
  "planned",
  "generating",
  "generated",
  "validating",
  "validated",
  "blocked",
  "repair-proposed",
  "failed",
  "cancelled",
]);
export type TestingGenerationStage = typeof TestingGenerationStage.Type;

export interface TestingValidationSummary {
  readonly discoveredTests: number;
  readonly passedTests: number;
  readonly failedTests: number;
  readonly skippedTests: number;
  readonly flakyTests: number;
  readonly errors: ReadonlyArray<string>;
}

export interface TestingProviderProvenance {
  readonly instanceId: string;
  readonly model: string;
  readonly options?: ReadonlyArray<string>;
}

export const TestingGenerationInput = Schema.Struct({
  engine: Schema.optionalKey(Schema.Literals(["standard", "official-playwright", "recording"])),
  recordedCode: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1_000_000))),
  recordedExpectedResult: Schema.optionalKey(Schema.String),
  failureRunId: Schema.optionalKey(Schema.String),
  parentJobId: Schema.optionalKey(Schema.String),
  parentRunId: Schema.optionalKey(Schema.String),
  attemptCount: Schema.optionalKey(Schema.Int),
  projectId: Schema.String,
  projectPath: Schema.String,
  targetUrl: Schema.optionalKey(Schema.String),
  cdpEndpoint: Schema.optionalKey(Schema.String),
  caseIds: Schema.optionalKey(Schema.Array(Schema.String)),
  locatorEntryIds: Schema.optionalKey(Schema.Array(Schema.String)),
  framework: Schema.optionalKey(Schema.Literal("playwright-ts")),
  modelSelection: ModelSelection,
  reasoningTier: Schema.optionalKey(Schema.Literals(["low", "medium", "high"])),
  outputMode: Schema.optionalKey(Schema.Literals(["managed", "repository"])),
  repositoryOutputPath: Schema.optionalKey(Schema.String),
  templatePath: Schema.optionalKey(Schema.String),
  captureReplay: Schema.optionalKey(Schema.Boolean),
  maxCases: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  maxEstimatedTokens: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  maxEstimatedCostUsd: Schema.optionalKey(Schema.Number.check(Schema.isGreaterThan(0))),
});
export type TestingGenerationInput = typeof TestingGenerationInput.Type;

export const TestingGenerationJobInput = Schema.Struct({
  projectId: Schema.String,
  jobId: Schema.String,
});
export type TestingGenerationJobInput = typeof TestingGenerationJobInput.Type;

export const TestingArtifactKind = Schema.Literals(["spec", "page", "data"]);
export type TestingArtifactKind = typeof TestingArtifactKind.Type;

export const TestingArtifactReadInput = Schema.Struct({
  projectId: Schema.String,
  generationJobId: Schema.String,
  caseId: Schema.String,
  artifactKind: TestingArtifactKind,
});
export type TestingArtifactReadInput = typeof TestingArtifactReadInput.Type;

export const TestingArtifactReadResult = Schema.Struct({
  contents: Schema.String,
});
export type TestingArtifactReadResult = typeof TestingArtifactReadResult.Type;

export const TestingExecutionInput = Schema.Struct({
  concurrency: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(4)),
  ),
  projectId: Schema.String,
  generationJobId: Schema.String,
  targetUrl: Schema.String,
  mode: Schema.Literals(["standalone", "ci"]),
  caseIds: Schema.optionalKey(Schema.Array(Schema.String)),
  timeoutSeconds: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(3_600)),
  ),
  visualComparison: Schema.optionalKey(Schema.Boolean),
});
export type TestingExecutionInput = typeof TestingExecutionInput.Type;

export const TestingExecutionRunInput = Schema.Struct({
  projectId: Schema.String,
  runId: Schema.String,
});
export type TestingExecutionRunInput = typeof TestingExecutionRunInput.Type;

export const TestingHealingDecisionInput = Schema.Struct({
  projectId: Schema.String,
  proposalId: Schema.String,
  decision: Schema.Literals(["accepted", "rejected"]),
});
export type TestingHealingDecisionInput = typeof TestingHealingDecisionInput.Type;

export const TestingScheduleInput = Schema.Struct({
  projectId: Schema.String,
  generationJobId: Schema.String,
  targetUrl: Schema.String,
  timezone: Schema.String,
  runAt: Schema.String,
  recurrence: Schema.optionalKey(Schema.Literals(["none", "daily", "weekly"])),
});
export type TestingScheduleInput = typeof TestingScheduleInput.Type;

export const TestingReportInput = Schema.Struct({
  projectId: Schema.String,
  runId: Schema.String,
  testerName: Schema.String,
  buildLabel: Schema.optionalKey(Schema.String),
  environmentLabel: Schema.optionalKey(Schema.String),
});
export type TestingReportInput = typeof TestingReportInput.Type;

export const TestingTraceabilityInput = Schema.Struct({
  projectId: Schema.String,
  externalId: Schema.String,
});
export type TestingTraceabilityInput = typeof TestingTraceabilityInput.Type;

export const TestingBugDraftInput = Schema.Struct({
  projectId: Schema.String,
  runId: Schema.String,
  caseId: Schema.String,
});
export type TestingBugDraftInput = typeof TestingBugDraftInput.Type;

export const TestingTriageInput = Schema.Struct({
  projectId: Schema.String,
  projectPath: Schema.String,
  runId: Schema.String,
  caseId: Schema.String,
  modelSelection: ModelSelection,
});
export type TestingTriageInput = typeof TestingTriageInput.Type;

export const TestingCaseSource = Schema.Literals(["excel", "generated"]);
export type TestingCaseSource = typeof TestingCaseSource.Type;
export const TestingReconciliationStatus = Schema.Literals(["matches", "needs-review", "blocked"]);
export type TestingReconciliationStatus = typeof TestingReconciliationStatus.Type;
export const TestingReviewDecision = Schema.Literals(["pending", "accepted", "edited", "rejected"]);
export type TestingReviewDecision = typeof TestingReviewDecision.Type;

export interface TestingMismatch {
  readonly stepIndex: number | null;
  readonly expected: string;
  readonly actual: string;
  readonly kind: "parse" | "duplicate" | "unreachable" | "live-verification" | "expected-result";
}

export interface TestingCaseSummary {
  readonly id: string;
  readonly externalId: string;
  readonly source: TestingCaseSource;
  readonly creationMethod?: "manual" | "imported" | "generated";
  readonly description: string;
  readonly groupName: string;
  readonly steps: ReadonlyArray<string>;
  readonly expectedResults: ReadonlyArray<string>;
  readonly expectedResult: string;
  readonly sourceSheet: string | null;
  readonly sourceRow: number | null;
  readonly status: TestingReconciliationStatus;
  readonly reviewDecision: TestingReviewDecision;
  readonly mismatches: ReadonlyArray<TestingMismatch>;
  readonly matchedStateIds: ReadonlyArray<string>;
  readonly standaloneStatus: "passed" | "failed" | "blocked" | "not-applicable" | "not-yet-tested";
  readonly ciStatus: "pass" | "fail" | null;
  readonly notes: string;
  readonly locatorEntryIds?: ReadonlyArray<string>;
}

export interface TestingCaseListResult {
  readonly cases: ReadonlyArray<TestingCaseSummary>;
  readonly groups: ReadonlyArray<string>;
}

export interface TestingWorkbookImportResult extends TestingCaseListResult {
  readonly importId: string;
  readonly workbookName: string;
  readonly importedCount: number;
  readonly matchesCount: number;
  readonly needsReviewCount: number;
  readonly blockedCount: number;
}

export interface TestingClearGraphResult extends TestingGraphSummary {
  readonly clearedNodeCount: number;
  readonly clearedEdgeCount: number;
}

export type TestingLocatorVerificationStatus =
  | "unverified"
  | "verified"
  | "stale"
  | "missing"
  | "ambiguous"
  | "invalid";

export type TestingFailureClassification =
  | "selector-drift"
  | "actionability-timing"
  | "navigation-readiness"
  | "fixture-defect"
  | "product-assertion"
  | "missing-credentials"
  | "auth-redirect"
  | "network-failure"
  | "browser-crash"
  | "infrastructure-failure"
  | "unknown";

export interface TestingLocatorEntry {
  readonly id: string;
  readonly pageId: string;
  readonly locatorKey: string;
  readonly classification: "action" | "assertion" | "content";
  readonly strategy:
    | "role"
    | "label"
    | "test-id"
    | "placeholder"
    | "alt-text"
    | "title"
    | "text"
    | "css";
  readonly arguments: Readonly<Record<string, string | number | boolean>>;
  readonly semanticContext: string;
  readonly source: "discovered" | "repository" | "manual" | "healing";
  readonly sourceFile: string | null;
  readonly sourceLine: number | null;
  readonly lifecycleStatus: "draft" | "accepted" | "archived" | "manual-required";
  readonly syncStatus:
    | "managed"
    | "linked"
    | "managed-only"
    | "repository-only"
    | "conflict"
    | "source-disconnected";
  readonly fragile: boolean;
  readonly currentVersionId: string;
  readonly versionNumber: number;
  readonly verificationStatus: TestingLocatorVerificationStatus;
  readonly verificationEnvironment: string | null;
  readonly verifiedAt: string | null;
  readonly health?: "healthy" | "degraded" | "broken" | "quarantined" | undefined;
  readonly elementFingerprint?: string | null | undefined;
  readonly targetPageFingerprint?: string | null | undefined;
  readonly verificationCount?: number | undefined;
  readonly consecutiveRepairAttempts?: number | undefined;
  readonly lastFailureClassification?: TestingFailureClassification | string | null | undefined;
}

export interface TestingLocatorPage {
  readonly id: string;
  readonly name: string;
  readonly urlPattern: string;
  readonly environmentLabel: string;
  readonly structuralFingerprint: string;
  readonly captureSource: "automatic" | "guided" | "manual" | "repository" | "backfill";
  readonly lifecycleStatus: "draft" | "accepted";
  readonly incompleteSession: boolean;
  readonly pageObject: TestingPageObjectArtifact | null;
  readonly repositoryTarget: TestingLocatorRepositoryTarget | null;
  readonly entries: ReadonlyArray<TestingLocatorEntry>;
}

export interface TestingPageObjectArtifact {
  readonly id: string;
  readonly pageId: string;
  readonly versionNumber: number;
  readonly className: string;
  readonly fileName: string;
  readonly code: string;
  readonly sourceHash: string;
  readonly status: "current" | "stale";
  readonly origin: "generated" | "manual";
  readonly createdAt: string;
}

export interface TestingLocatorRepositoryTarget {
  readonly folderPath: string;
  readonly fileName: string;
  readonly relativePath: string;
  readonly lastAppliedArtifactSourceHash: string | null;
  readonly updatedAt: string;
}

export interface TestingLocatorRepositoryProposal {
  readonly projectId: string;
  readonly pageId: string;
  readonly pageName: string;
  readonly className: string;
  readonly fileName: string;
  readonly relativePath: string;
  readonly artifactSourceHash: string;
  readonly destinationSourceHash: string | null;
  readonly existingCode: string;
  readonly proposedCode: string;
  readonly changeKind: "create" | "update" | "unchanged";
  readonly selectedLocatorCount: number;
}

export interface TestingLocatorRepositoryApplyResult {
  readonly proposal: TestingLocatorRepositoryProposal;
  readonly library: TestingLocatorLibraryResult;
  readonly appliedAt: string;
}

export interface TestingCaseIdPolicy {
  readonly prefix: string;
  readonly padding: number;
  readonly nextSequence: number;
  readonly example: string;
}

export interface TestingTestInventoryNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly kind: "root" | "file" | "suite" | "test" | "case";
  readonly label: string;
  readonly source: "managed" | "repository" | "vscode";
  readonly status: "unknown" | "queued" | "running" | "passed" | "failed" | "skipped";
  readonly filePath: string | null;
  readonly line: number | null;
  readonly externalCaseId: string | null;
  readonly runnable: boolean;
  readonly children: ReadonlyArray<TestingTestInventoryNode>;
}

export interface TestingTestInventoryResult {
  readonly projectId: string;
  readonly generatedAt: string;
  readonly repositoryFilesScanned: number;
  readonly parseWarnings: ReadonlyArray<string>;
  readonly editorProviderConnected: boolean;
  readonly roots: ReadonlyArray<TestingTestInventoryNode>;
}

export interface TestingLocatorLibraryResult {
  readonly featureAvailable: boolean;
  readonly experience: TestingDiscoveryExperience;
  readonly pages: ReadonlyArray<TestingLocatorPage>;
  readonly pageCount: number;
  readonly locatorCount: number;
  readonly verifiedCount: number;
  readonly reviewCount: number;
}

export interface TestingLocatorDiscoverySession {
  readonly id: string;
  readonly projectId: string;
  readonly status: "running" | "completed" | "cancelled" | "failed";
  readonly mode: TestingDiscoveryMode;
  readonly coverage: TestingLocatorCoverageMode;
  readonly safetyProfile: TestingDiscoverySafetyProfile;
  readonly currentUrl: string | null;
  readonly currentPageName: string | null;
  readonly observedElements: number;
  readonly storedElements: number;
  readonly truncatedElements: number;
  readonly capturedPages: number;
  readonly terminationReason:
    | "completed"
    | "element-limit"
    | "page-limit"
    | "feature-disabled"
    | "cancelled"
    | "failed"
    | null;
  readonly message: string;
  readonly library: TestingLocatorLibraryResult;
}

export interface TestingLocatorImportWarning {
  readonly file: string;
  readonly line: number | null;
  readonly category: "warning" | "unsupported-dynamic" | "parse-error";
  readonly message: string;
}

export interface TestingLocatorFolderResult {
  readonly filesScanned: number;
  readonly filesParsed: number;
  readonly recognized: number;
  readonly warnings: number;
  readonly unsupportedDynamic: number;
  readonly recognitionRate: number | null;
  readonly fileParseCoverage: number | null;
  readonly linked: number;
  readonly repositoryOnly: number;
  readonly managedOnly: number;
  readonly conflicts: number;
  readonly details: ReadonlyArray<TestingLocatorImportWarning>;
  readonly library: TestingLocatorLibraryResult;
}

export interface TestingLocatorSyncItem {
  readonly id: string;
  readonly entryId: string;
  readonly locatorKey: string;
  readonly kind: "conflict" | "managed-only" | "repository-only" | "healing-source-diff";
  readonly sourceFile: string | null;
  readonly details: Readonly<Record<string, unknown>>;
  readonly status: "pending" | "accepted" | "rejected";
}

export interface TestingLocatorSyncPreview {
  readonly items: ReadonlyArray<TestingLocatorSyncItem>;
  readonly library: TestingLocatorLibraryResult;
}

export interface TestingStoryImportResult extends TestingCaseListResult {
  readonly storyImportId: string;
  readonly sourceName: string;
  readonly generatedCount: number;
}

export interface TestingGeneratedArtifact {
  readonly caseId: string;
  readonly externalId: string;
  readonly featureSlug: string;
  readonly pageObjectPath: string;
  readonly dataPath: string;
  readonly specPath: string;
  readonly fingerprintCount: number;
}

export interface TestingGenerationJob {
  readonly id: string;
  readonly projectId: string;
  readonly status: "queued" | "running" | "completed" | "failed" | "cancelled" | "budget-stopped";
  readonly engine: TestingGenerationEngine;
  readonly stage: TestingGenerationStage;
  readonly parentJobId?: string | null | undefined;
  readonly parentRunId?: string | null | undefined;
  readonly attemptCount: number;
  readonly validationSummary?: TestingValidationSummary | null | undefined;
  readonly immutableArtifactPaths?: ReadonlyArray<string> | undefined;
  readonly providerProvenance?: TestingProviderProvenance | null | undefined;
  readonly usageMeasured: boolean;
  readonly framework: "playwright-ts";
  readonly modelSelection: ModelSelection;
  readonly outputDirectory: string;
  readonly totalCases: number;
  readonly completedCases: number;
  readonly estimatedTokens: number;
  readonly estimatedCostUsd: number;
  readonly error: string | null;
  readonly artifacts: ReadonlyArray<TestingGeneratedArtifact>;
}

export interface TestingGenerationJobListResult {
  readonly jobs: ReadonlyArray<TestingGenerationJob>;
}

export interface TestingHealingProposal {
  readonly id: string;
  readonly caseId: string;
  readonly locatorKey: string;
  readonly previousRole: string;
  readonly previousName: string;
  readonly proposedRole: string;
  readonly proposedName: string;
  readonly confidence: number;
  readonly margin: number;
  readonly diff: string;
  readonly status: "pending" | "accepted" | "rejected" | "below-threshold";
  readonly consecutiveAttempts: number;
  readonly locatorEntryId?: string;
  readonly locatorVersionId?: string;
}

export interface TestingExecutionCaseResult {
  readonly caseId: string;
  readonly externalId: string;
  readonly status: "passed" | "failed" | "blocked" | "not-applicable";
  readonly durationMs: number;
  readonly error: string | null;
  readonly tracePath: string | null;
  readonly screenshotPath: string | null;
  readonly flaky: boolean;
  readonly quarantined: boolean;
  readonly visualStatus:
    | "disabled"
    | "baseline-created"
    | "matched"
    | "changed"
    | "review-required";
}

export interface TestingExecutionRun {
  readonly id: string;
  readonly projectId: string;
  readonly generationJobId: string;
  readonly mode: "standalone" | "ci";
  readonly status: "queued" | "running" | "passed" | "failed" | "blocked";
  readonly targetUrl: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number;
  readonly artifactRevision: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly results: ReadonlyArray<TestingExecutionCaseResult>;
  readonly healingProposals: ReadonlyArray<TestingHealingProposal>;
}

export interface TestingExecutionRunListResult {
  readonly runs: ReadonlyArray<TestingExecutionRun>;
}

export interface TestingSchedule {
  readonly id: string;
  readonly projectId: string;
  readonly generationJobId: string;
  readonly targetUrl: string;
  readonly timezone: string;
  readonly recurrence: "none" | "daily" | "weekly";
  readonly nextRunAt: string;
  readonly enabled: boolean;
}

export interface TestingScheduleListResult {
  readonly schedules: ReadonlyArray<TestingSchedule>;
}

export interface TestingReport {
  readonly id: string;
  readonly runId: string;
  readonly docxPath: string;
  readonly pdfPath: string;
  readonly createdAt: string;
}

export interface TestingTraceabilityResult {
  readonly case: TestingCaseSummary;
  readonly import: {
    readonly workbookName: string;
    readonly workbookPath: string;
  } | null;
  readonly generatedArtifacts: ReadonlyArray<TestingGeneratedArtifact & { readonly jobId: string }>;
  readonly executions: ReadonlyArray<{
    readonly runId: string;
    readonly mode: "standalone" | "ci";
    readonly status: TestingExecutionCaseResult["status"];
    readonly verifiedAt: string;
    readonly durationMs: number;
    readonly error: string | null;
  }>;
  readonly healing: ReadonlyArray<TestingHealingProposal & { readonly runId: string }>;
}

export interface TestingBugDraft {
  readonly title: string;
  readonly markdown: string;
  readonly localOnly: true;
}

export interface TestingTriageResult {
  readonly classification: "application-regression" | "test-update" | "uncertain";
  readonly observedFacts: ReadonlyArray<string>;
  readonly inference: string;
  readonly recommendation: string;
}

export interface TestingGraphExplorerResult {
  readonly nodes: ReadonlyArray<{
    readonly stateId: string;
    readonly pageUrl: string;
    readonly pageTitle: string;
    readonly snapshot: string;
    readonly linkedCaseIds: ReadonlyArray<string>;
  }>;
  readonly edges: ReadonlyArray<{
    readonly fromStateId: string;
    readonly toStateId: string;
    readonly role: string;
    readonly name: string;
    readonly intentLocator: string;
  }>;
}

export interface TestingGraphSummary {
  readonly projectId: string;
  readonly targetUrl: string | null;
  readonly databasePath: string;
  readonly authCapturedAt: string | null;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly cacheEntryCount: number;
  readonly cacheHitCount: number;
  readonly lastRunStatus: "idle" | "running" | "completed" | "failed";
  readonly lastRunError: string | null;
  readonly lastRunMetrics: null | {
    readonly terminationReason: "plateaued" | "max-states" | "time-budget" | null;
    readonly statesVisited: number | null;
    readonly transitionsObserved: number | null;
    readonly durationMs: number | null;
    readonly maxStates: number | null;
    readonly maxDurationSeconds: number | null;
  };
}

export interface TestingAuthStartResult {
  readonly started: true;
  readonly profilePath: string;
}

export interface TestingExplorationResult extends TestingGraphSummary {
  readonly runId: string;
  readonly injectionFlags: ReadonlyArray<string>;
  readonly piiTokenCount: number;
  readonly statesVisited: number;
  readonly transitionsObserved: number;
  readonly durationMs: number;
  readonly maxStates: number;
  readonly maxDurationSeconds: number | null;
  readonly scope: TestingExplorationScope;
  readonly terminationReason: "plateaued" | "max-states" | "time-budget";
}

export interface TestingApi {
  readonly getStatus: (input: TestingProjectInput) => Promise<TestingGraphSummary>;
  readonly getLocatorLibrary: (input: TestingProjectInput) => Promise<TestingLocatorLibraryResult>;
  readonly setDiscoveryExperience: (
    input: TestingDiscoveryExperienceInput,
  ) => Promise<TestingLocatorLibraryResult>;
  readonly getCaseIdPolicy: (input: TestingProjectInput) => Promise<TestingCaseIdPolicy>;
  readonly setCaseIdPolicy: (input: TestingCaseIdPolicyInput) => Promise<TestingCaseIdPolicy>;
  readonly getTestInventory: (
    input: TestingProjectInput & { readonly projectPath: string },
  ) => Promise<TestingTestInventoryResult>;
  readonly startLocatorDiscovery: (
    input: TestingLocatorDiscoveryInput,
  ) => Promise<TestingLocatorDiscoverySession>;
  readonly navigateLocatorDiscovery: (
    input: TestingLocatorDiscoveryNavigateInput,
  ) => Promise<TestingLocatorDiscoverySession>;
  readonly captureLocatorPage: (
    input: TestingLocatorDiscoverySessionInput,
  ) => Promise<TestingLocatorDiscoverySession>;
  readonly finishLocatorDiscovery: (
    input: TestingLocatorDiscoverySessionInput,
  ) => Promise<TestingLocatorDiscoverySession>;
  readonly cancelLocatorDiscovery: (
    input: TestingLocatorDiscoverySessionInput,
  ) => Promise<TestingLocatorDiscoverySession>;
  readonly reviewLocatorEntry: (
    input: TestingLocatorEntryReviewInput,
  ) => Promise<TestingLocatorLibraryResult>;
  readonly updateLocatorPage: (
    input: TestingLocatorPageUpdateInput,
  ) => Promise<TestingLocatorLibraryResult>;
  readonly setLocatorPageSelection: (
    input: TestingLocatorPageSelectionInput,
  ) => Promise<TestingLocatorLibraryResult>;
  readonly deleteLocatorPage: (
    input: TestingLocatorPageDeleteInput,
  ) => Promise<TestingLocatorLibraryResult>;
  readonly updatePageObjectCode: (
    input: TestingPageObjectCodeUpdateInput,
  ) => Promise<TestingLocatorLibraryResult>;
  readonly previewLocatorRepositoryWrite: (
    input: TestingLocatorRepositoryPreviewInput,
  ) => Promise<TestingLocatorRepositoryProposal>;
  readonly applyLocatorRepositoryWrite: (
    input: TestingLocatorRepositoryApplyInput,
  ) => Promise<TestingLocatorRepositoryApplyResult>;
  readonly previewLocatorSync: (input: TestingProjectInput) => Promise<TestingLocatorSyncPreview>;
  readonly resolveLocatorSync: (
    input: TestingLocatorSyncDecisionInput,
  ) => Promise<TestingLocatorSyncPreview>;
  readonly disconnectLocatorFolder: (
    input: TestingProjectInput,
  ) => Promise<TestingLocatorLibraryResult>;
  readonly indexLocatorFolder: (
    input: TestingLocatorFolderInput,
  ) => Promise<TestingLocatorFolderResult>;
  readonly verifyLocators: (
    input: TestingLocatorVerificationInput,
  ) => Promise<TestingLocatorLibraryResult>;
  readonly importUserStory: (input: TestingStoryImportInput) => Promise<TestingStoryImportResult>;
  readonly startAuthCapture: (input: TestingTargetInput) => Promise<TestingAuthStartResult>;
  readonly finishAuthCapture: (input: TestingProjectInput) => Promise<TestingGraphSummary>;
  readonly startExploration: (input: TestingExplorationInput) => Promise<TestingExplorationResult>;
  readonly importWorkbook: (
    input: TestingWorkbookImportInput,
  ) => Promise<TestingWorkbookImportResult>;
  readonly listCases: (input: TestingProjectInput) => Promise<TestingCaseListResult>;
  readonly createCase: (input: TestingCaseCreateInput) => Promise<TestingCaseListResult>;
  readonly reviewCase: (input: TestingCaseReviewInput) => Promise<TestingCaseListResult>;
  readonly deleteCase: (input: TestingCaseDeleteInput) => Promise<TestingCaseListResult>;
  readonly updateCaseGroup: (input: TestingCaseGroupUpdateInput) => Promise<TestingCaseListResult>;
  readonly createCaseGroup: (input: TestingCaseGroupCreateInput) => Promise<TestingCaseListResult>;
  readonly deleteCaseGroup: (input: TestingCaseGroupDeleteInput) => Promise<TestingCaseListResult>;
  readonly generateScenarios: (input: TestingProjectInput) => Promise<TestingCaseListResult>;
  readonly clearGraph: (input: TestingProjectInput) => Promise<TestingClearGraphResult>;
  readonly generateTests: (input: TestingGenerationInput) => Promise<TestingGenerationJob>;
  readonly listGenerationJobs: (
    input: TestingProjectInput,
  ) => Promise<TestingGenerationJobListResult>;
  readonly cancelGenerationJob: (input: TestingGenerationJobInput) => Promise<TestingGenerationJob>;
  readonly readArtifact: (input: TestingArtifactReadInput) => Promise<TestingArtifactReadResult>;
  readonly runTests: (input: TestingExecutionInput) => Promise<TestingExecutionRun>;
  readonly cancelExecutionRun: (input: TestingExecutionRunInput) => Promise<TestingExecutionRun>;
  readonly listExecutionRuns: (
    input: TestingProjectInput,
  ) => Promise<TestingExecutionRunListResult>;
  readonly decideHealingProposal: (
    input: TestingHealingDecisionInput,
  ) => Promise<TestingExecutionRunListResult>;
  readonly createSchedule: (input: TestingScheduleInput) => Promise<TestingSchedule>;
  readonly listSchedules: (input: TestingProjectInput) => Promise<TestingScheduleListResult>;
  readonly generateReport: (input: TestingReportInput) => Promise<TestingReport>;
  readonly getTraceability: (input: TestingTraceabilityInput) => Promise<TestingTraceabilityResult>;
  readonly draftBug: (input: TestingBugDraftInput) => Promise<TestingBugDraft>;
  readonly getGraphExplorer: (input: TestingProjectInput) => Promise<TestingGraphExplorerResult>;
  readonly triageFailure: (input: TestingTriageInput) => Promise<TestingTriageResult>;
}
