/**
 * TestingDataContext
 *
 * Provides the shared testing workspace state — cases, locator library, and
 * mutation callbacks — to all six view components.  This context is the only
 * mechanism for sharing this data; do not drill props through the view tree.
 *
 * Design rules:
 * - The context value is memoized via `useMemo` so that reference equality is
 *   stable unless actual data changes.
 * - Every callback in the value is a `useCallback`-wrapped function whose
 *   identity only changes when its deps change.
 * - `activeTestingSection` is deliberately NOT stored here — it is local state
 *   in `TestingTool` and passed as a direct prop only to the sidebar nav.
 */

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type {
  TestingCaseSummary,
  TestingLocatorLibraryResult,
  TestingLocatorEntry,
  TestingGenerationJob,
  TestingExecutionRun,
  TestingSchedule,
  TestingGraphSummary,
  TestingCaseIdPolicy,
  TestingTestInventoryResult,
  TestingTraceabilityResult,
  TestingGraphExplorerResult,
  TestingLocatorDiscoverySession,
  TestingLocatorFolderResult,
  TestingLocatorSyncPreview,
  TestingLocatorRepositoryProposal,
  ModelSelection,
} from "@tabs/contracts";
import type {
  TestingBusyAction,
  TestingCaseFilter,
  TestingCaseIntakeMode,
  TestingLocatorCaptureScope,
  TestingLocatorFilter,
  TestingLocatorPageTab,
} from "./types";
import type { ProviderPickerKind } from "~/session-logic";

// ---------------------------------------------------------------------------
// Shape of the memoized context value
// ---------------------------------------------------------------------------

export interface TestingDataContextValue {
  // --- core data ------------------------------------------------------------
  cases: ReadonlyArray<TestingCaseSummary>;
  caseGroups: ReadonlyArray<string>;
  locatorLibrary: TestingLocatorLibraryResult | null;
  generationJobs: ReadonlyArray<TestingGenerationJob>;
  executionRuns: ReadonlyArray<TestingExecutionRun>;
  testingSchedules: ReadonlyArray<TestingSchedule>;
  status: TestingGraphSummary | null;
  caseIdPolicy: TestingCaseIdPolicy | null;
  testInventory: TestingTestInventoryResult | null;
  traceability: TestingTraceabilityResult | null;
  graphExplorer: TestingGraphExplorerResult | null;
  locatorSession: TestingLocatorDiscoverySession | null;
  locatorFolderResult: TestingLocatorFolderResult | null;
  locatorSyncPreview: TestingLocatorSyncPreview | null;
  locatorRepositoryProposal: TestingLocatorRepositoryProposal | null;
  reportPaths: { docxPath: string; pdfPath: string } | null;
  bugDraft: string;
  triageResult: string;
  message: string;

  // --- derived / computed ---------------------------------------------------
  filteredCases: ReadonlyArray<TestingCaseSummary>;
  selectedCase: TestingCaseSummary | null;
  acceptedCaseCount: number;
  reviewCaseCount: number;
  blockedCaseCount: number;
  readyCases: ReadonlyArray<TestingCaseSummary>;
  completedGenerationJob: TestingGenerationJob | null;
  latestExecutionRun: TestingExecutionRun | null;

  // --- ui state that multiple views share -----------------------------------
  projectId: import("@tabs/contracts").ProjectId;
  projectPath: string;
  busyAction: TestingBusyAction;
  setBusyAction: (action: TestingBusyAction) => void;
  message_setter: (msg: string) => void;

  // --- case list UI state ---------------------------------------------------
  caseSearch: string;
  setCaseSearch: (v: string) => void;
  caseFilter: TestingCaseFilter;
  setCaseFilter: (v: TestingCaseFilter) => void;
  selectedCaseId: string | null;
  setSelectedCaseId: (id: string | null) => void;
  editingCaseId: string | null;
  setEditingCaseId: (id: string | null) => void;
  editedExternalId: string;
  setEditedExternalId: (v: string) => void;
  editedDescription: string;
  setEditedDescription: (v: string) => void;
  editedSteps: ReadonlyArray<string>;
  setEditedSteps: (
    steps: ReadonlyArray<string> | ((prev: ReadonlyArray<string>) => ReadonlyArray<string>),
  ) => void;
  editedExpectedResults: ReadonlyArray<string>;
  setEditedExpectedResults: (
    results: ReadonlyArray<string> | ((prev: ReadonlyArray<string>) => ReadonlyArray<string>),
  ) => void;
  editedCaseLocatorIds: ReadonlySet<string>;
  setEditedCaseLocatorIds: (ids: ReadonlySet<string>) => void;
  implementedInventoryOpen: boolean;
  setImplementedInventoryOpen: (v: boolean) => void;
  testInventoryView: "tree" | "table";
  setTestInventoryView: (v: "tree" | "table") => void;
  expandedTestNodes: ReadonlySet<string>;
  selectedTestNodeId: string | null;
  setSelectedTestNodeId: (id: string | null) => void;
  flattenedTestInventory: ReadonlyArray<{
    node: import("@tabs/contracts").TestingTestInventoryNode;
    depth: number;
  }>;
  workbookPath: string;

  // --- case intake & draft UI state -----------------------------------------
  caseIntakeMode: TestingCaseIntakeMode;
  setCaseIntakeMode: (v: TestingCaseIntakeMode) => void;
  manualCaseId: string;
  setManualCaseId: (v: string) => void;
  manualCaseDescription: string;
  setManualCaseDescription: (v: string) => void;
  manualCaseSteps: ReadonlyArray<string>;
  setManualCaseSteps: (
    v: ReadonlyArray<string> | ((prev: ReadonlyArray<string>) => ReadonlyArray<string>),
  ) => void;
  manualCaseExpectedResults: ReadonlyArray<string>;
  setManualCaseExpectedResults: (
    v: ReadonlyArray<string> | ((prev: ReadonlyArray<string>) => ReadonlyArray<string>),
  ) => void;
  manualCaseLocatorIds: ReadonlySet<string>;
  setManualCaseLocatorIds: (v: ReadonlySet<string>) => void;
  storyText: string;
  setStoryText: (v: string) => void;
  storyFilePath: string;
  setStoryFilePath: (v: string) => void;

  // --- case ID policy UI state ----------------------------------------------
  caseIdPrefix: string;
  setCaseIdPrefix: (v: string) => void;
  caseIdPadding: string;
  setCaseIdPadding: (v: string) => void;
  caseIdNext: string;
  setCaseIdNext: (v: string) => void;

  // --- locator library UI state ---------------------------------------------
  selectedLocatorPageId: string | null;
  setSelectedLocatorPageId: (id: string | null) => void;
  selectedLocatorPage: TestingLocatorLibraryResult["pages"][number] | null;
  locatorSearch: string;
  setLocatorSearch: (v: string) => void;
  locatorFilter: TestingLocatorFilter;
  setLocatorFilter: (v: TestingLocatorFilter) => void;
  locatorCodeEntryIds: ReadonlySet<string>;
  setLocatorCodeEntryIds: (
    ids: ReadonlySet<string> | ((previous: ReadonlySet<string>) => ReadonlySet<string>),
  ) => void;
  filteredLocatorEntries: ReadonlyArray<TestingLocatorEntry>;
  selectedLocatorEntryIds: ReadonlySet<string>;
  setSelectedLocatorEntryIds: (
    ids: ReadonlySet<string> | ((previous: ReadonlySet<string>) => ReadonlySet<string>),
  ) => void;
  editingLocatorEntry: TestingLocatorEntry | null;
  pendingRemoveLocator: TestingLocatorEntry | null;
  editingLocatorKey: string;
  setEditingLocatorKey: (v: string) => void;
  editingLocatorClassification: TestingLocatorEntry["classification"];
  setEditingLocatorClassification: (v: TestingLocatorEntry["classification"]) => void;
  editingLocatorStrategy: TestingLocatorEntry["strategy"];
  setEditingLocatorStrategy: (v: TestingLocatorEntry["strategy"]) => void;
  editingLocatorArguments: string;
  setEditingLocatorArguments: (v: string) => void;
  editingLocatorContext: string;
  setEditingLocatorContext: (v: string) => void;
  setEditingLocatorId: (id: string | null) => void;
  setLocatorPendingRemoveId: (id: string | null) => void;
  locatorPageTab: TestingLocatorPageTab;
  setLocatorPageTab: (v: TestingLocatorPageTab) => void;
  locatorPageName: string;
  setLocatorPageName: (v: string) => void;
  locatorCodeEditing: boolean;
  setLocatorCodeEditing: (v: boolean) => void;
  locatorCodeDraft: string;
  setLocatorCodeDraft: (v: string) => void;
  locatorRepositoryFolder: string;
  locatorRepositoryFileName: string;
  setLocatorRepositoryFileName: (v: string) => void;
  setLocatorRepositoryProposal: (proposal: TestingLocatorRepositoryProposal | null) => void;
  locatorRepositoryConfirmOpen: boolean;
  setLocatorRepositoryConfirmOpen: (v: boolean) => void;

  // --- discover / locator session UI ----------------------------------------
  locatorMode: import("@tabs/contracts").TestingDiscoveryMode;
  setLocatorMode: (v: import("@tabs/contracts").TestingDiscoveryMode) => void;
  locatorCoverage: import("@tabs/contracts").TestingLocatorCoverageMode;
  setLocatorCoverage: (v: import("@tabs/contracts").TestingLocatorCoverageMode) => void;
  locatorSafety: import("@tabs/contracts").TestingDiscoverySafetyProfile;
  setLocatorSafety: (v: import("@tabs/contracts").TestingDiscoverySafetyProfile) => void;
  locatorMaxElements: string;
  setLocatorMaxElements: (v: string) => void;
  locatorMaxPages: string;
  setLocatorMaxPages: (v: string) => void;
  locatorNavigateUrl: string;
  setLocatorNavigateUrl: (v: string) => void;
  locatorStorageMode: import("@tabs/contracts").TestingLocatorStorageMode;
  setLocatorStorageMode: (v: import("@tabs/contracts").TestingLocatorStorageMode) => void;
  locatorCaptureScope: TestingLocatorCaptureScope;
  setLocatorCaptureScope: (v: TestingLocatorCaptureScope) => void;
  locatorTaskContext: string;
  setLocatorTaskContext: (v: string) => void;
  locatorAdvancedOpen: boolean;
  setLocatorAdvancedOpen: (v: boolean) => void;
  locatorViewport: "desktop" | "tablet" | "mobile";
  setLocatorViewport: (v: "desktop" | "tablet" | "mobile") => void;
  locatorPreviewExpanded: boolean;
  setLocatorPreviewExpanded: (v: boolean) => void;
  locatorPreviewFocusButtonRef: React.RefObject<HTMLButtonElement | null>;

  // --- generate / automate UI state ----------------------------------------
  generationModelSelection: ModelSelection;
  generationFusionProvider: ProviderPickerKind;
  generationReasoning: "low" | "medium" | "high";
  generationOutputMode: "managed" | "repository";
  setGenerationOutputMode: (v: "managed" | "repository") => void;
  repositoryOutputPath: string;
  setRepositoryOutputPath: (v: string) => void;
  templatePath: string;
  setTemplatePath: (v: string) => void;
  captureReplay: boolean;
  setCaptureReplay: (v: boolean) => void;
  generationMaxCases: string;
  setGenerationMaxCases: (v: string) => void;
  generationMaxTokens: string;
  setGenerationMaxTokens: (v: string) => void;
  generationMaxCost: string;
  setGenerationMaxCost: (v: string) => void;
  selectedGenerationCaseIds: ReadonlySet<string>;
  setSelectedGenerationCaseIds: (ids: ReadonlySet<string>) => void;

  // --- runs UI state --------------------------------------------------------
  executionMode: "standalone" | "ci";
  setExecutionMode: (v: "standalone" | "ci") => void;
  visualComparison: boolean;
  setVisualComparison: (v: boolean) => void;
  scheduleTime: string;
  setScheduleTime: (v: string) => void;

  // --- reports UI state -----------------------------------------------------
  testerName: string;
  setTesterName: (v: string) => void;
  traceCaseId: string;
  setTraceCaseId: (v: string) => void;

  // --- discovery (global) ---------------------------------------------------
  targetUrl: string;
  setTargetUrl: (v: string) => void;
  normalizedTarget: string | null;
  cdpEndpoint: string;
  setCdpEndpoint: (v: string) => void;
  normalizedCdpEndpoint: string | null | undefined;
  explorationScope: import("@tabs/contracts").TestingExplorationScope;
  setExplorationScope: (v: import("@tabs/contracts").TestingExplorationScope) => void;
  authenticationMode: import("./types").TestingAuthenticationMode;
  setAuthenticationMode: (v: import("./types").TestingAuthenticationMode) => void;
  authCaptureOpen: boolean;
  authenticationReady: boolean;
  maxStates: string;
  setMaxStates: (v: string) => void;
  normalizedMaxStates: number | null;
  maxDurationMinutes: string;
  setMaxDurationMinutes: (v: string) => void;
  normalizedMaxDurationSeconds: number | null | undefined;

  // --- mutation callbacks ---------------------------------------------------
  refreshStatus: () => Promise<void>;
  refreshLocatorLibrary: () => Promise<void>;
  refreshCases: () => Promise<void>;
  refreshGenerationJobs: () => Promise<void>;
  refreshExecution: () => Promise<void>;
  refreshGraphExplorer: () => Promise<void>;
  refreshTestingWorkspace: () => Promise<void>;
  setWorkspaceCases: (cases: ReadonlyArray<TestingCaseSummary>) => void;

  startAuthCapture: () => Promise<void>;
  finishAuthCapture: () => Promise<void>;
  startExploration: () => Promise<void>;
  setDiscoveryExperience: (experience: "classic" | "locator-first") => Promise<void>;
  clearGraph: () => Promise<void>;

  startLocatorDiscovery: () => Promise<boolean>;
  navigateLocatorDiscovery: (url?: string) => Promise<void>;
  captureLocatorPage: (captureMode?: "relevant" | "page" | "all") => Promise<boolean>;
  finishLocatorDiscovery: (cancel: boolean) => Promise<void>;
  rescanLocatorPage: (pageId?: string) => Promise<void>;
  deleteLocatorPage: (pageId?: string) => Promise<void>;
  indexLocatorFolder: (
    storageMode?: import("@tabs/contracts").TestingLocatorStorageMode,
  ) => Promise<void>;
  approveSelectedLocators: () => Promise<void>;
  reviewLocator: (
    entryId: string,
    decision: "accept" | "archive" | "keep-managed" | "restore",
    locatorKey?: string,
  ) => Promise<void>;
  startEditingLocator: (entry: TestingLocatorEntry) => void;
  saveLocatorChanges: () => Promise<void>;
  saveLocatorPageName: () => Promise<void>;
  saveLocatorCodeSelection: () => Promise<void>;
  savePageObjectCode: () => Promise<void>;
  chooseLocatorRepositoryFolder: () => Promise<void>;
  previewLocatorRepositoryChange: () => Promise<void>;
  applyLocatorRepositoryChange: () => Promise<void>;
  resolveLocatorSync: (
    conflictId: string,
    decision: "keep-managed" | "accept-repository" | "archive",
  ) => Promise<void>;
  disconnectLocatorFolder: () => Promise<void>;

  chooseWorkbook: () => Promise<void>;
  setWorkbookPath: (path: string) => void;
  importWorkbook: (groupName?: string) => Promise<void>;
  generateScenarios: () => Promise<void>;
  reviewCase: (
    testCase: TestingCaseSummary,
    decision: "accepted" | "edited" | "rejected",
  ) => Promise<void>;
  deleteCase: (testCase: TestingCaseSummary) => Promise<void>;
  updateCaseGroup: (testCase: TestingCaseSummary, groupName: string) => Promise<void>;
  createCaseGroup: (groupName: string) => Promise<void>;
  deleteCaseGroup: (groupName: string) => Promise<void>;
  beginEditCase: (testCase: TestingCaseSummary) => void;
  updateEditedStep: (index: number, value: string) => void;
  moveEditedStep: (index: number, direction: -1 | 1) => void;
  saveCaseIdPolicy: () => Promise<void>;

  generateTests: (
    failureRunId?: string,
    engine?: "standard" | "official-playwright",
  ) => Promise<void>;
  cancelGeneration: (jobId: string) => Promise<void>;

  runGeneratedTests: (caseIds?: ReadonlyArray<string>, concurrency?: number) => Promise<void>;
  decideHealing: (proposalId: string, decision: "accepted" | "rejected") => Promise<void>;
  createTestingSchedule: () => Promise<void>;

  generateSignoffReport: () => Promise<void>;
  resolveTraceability: () => Promise<void>;
  draftFailedCaseBug: (run: TestingExecutionRun, caseId: string) => Promise<void>;
  triageFailedCase: (run: TestingExecutionRun, caseId: string) => Promise<void>;

  updateTestingFusionModel: (
    provider: ProviderPickerKind,
    model: import("@tabs/contracts").ModelSlug,
    options?: ModelSelection["options"],
  ) => void;
  updateTestingFusionOptions: (options: ModelSelection["options"] | undefined) => void;
  fusionProviders: ReadonlyArray<unknown>;
  serverConfig: import("@tabs/contracts").ServerConfig | null;
}

// ---------------------------------------------------------------------------
// Context + hook
// ---------------------------------------------------------------------------

// Intentionally typed as `TestingDataContextValue | null` so the hook can
// throw a meaningful error when consumed outside the provider.
const TestingDataContext = createContext<TestingDataContextValue | null>(null);

export function useTestingData(): TestingDataContextValue {
  const ctx = useContext(TestingDataContext);
  if (ctx === null) {
    throw new Error("useTestingData must be used within a TestingDataProvider");
  }
  return ctx;
}

export { TestingDataContext };
