import React, {
  lazy,
  Profiler,
  type ProfilerOnRenderCallback,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ModelSelection,
  ModelSlug,
  EnvironmentId,
  ProjectId,
  TestingCaseIdPolicy,
  TestingCaseSummary,
  TestingDiscoveryMode,
  TestingDiscoverySafetyProfile,
  TestingExecutionRun,
  TestingExplorationScope,
  TestingGenerationJob,
  TestingGraphExplorerResult,
  TestingGraphSummary,
  TestingLocatorCoverageMode,
  TestingLocatorDiscoverySession,
  TestingLocatorEntry,
  TestingLocatorFolderResult,
  TestingLocatorLibraryResult,
  TestingLocatorRepositoryProposal,
  TestingLocatorStorageMode,
  TestingLocatorSyncPreview,
  TestingSchedule,
  TestingTestInventoryNode,
  TestingTestInventoryResult,
  TestingTraceabilityResult,
  CodeChromeState,
} from "@tabs/contracts";
import {
  DEFAULT_MODEL,
  DEFAULT_TESTING_BATCH_MAX_CASES,
  DEFAULT_TESTING_BATCH_MAX_COST_USD,
  DEFAULT_TESTING_BATCH_MAX_TOKENS,
  DEFAULT_TESTING_MAX_ELEMENTS_PER_PAGE,
  DEFAULT_TESTING_MAX_PAGES_PER_SESSION,
  DEFAULT_TESTING_MAX_STATES,
  MAX_TESTING_DURATION_SECONDS,
  MAX_TESTING_MAX_ELEMENTS_PER_PAGE,
  MAX_TESTING_MAX_PAGES_PER_SESSION,
  MAX_TESTING_MAX_STATES,
  MIN_TESTING_MAX_ELEMENTS_PER_PAGE,
} from "@tabs/contracts";
import {
  CircleDotIcon,
  FileTextIcon,
  FlaskConicalIcon,
  FolderIcon,
  LoaderIcon,
  NetworkIcon,
  TerminalIcon,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useServerConfig } from "~/state/settings";
import { makeAppModelSelection } from "~/modelSelection";
import type { ProviderPickerKind } from "~/session-logic";
import { ensureNativeApi, readNativeApi } from "~/nativeApi";
import { cn } from "~/lib/utils";
import { TestingDataContext, type TestingDataContextValue } from "./context";
import {
  isSameWebUrl,
  TESTING_FUSION_PROVIDER_IDS,
  testingReasoningTierFromOptions,
} from "./TestingWidgets";
import { testingLocatorCode } from "./utils";
import {
  captureTestingPreview,
  locatorPageForCapture,
  normalizeLocatorUrl,
} from "./locatorPreview";
import { useConfirm } from "~/hooks/useConfirm";
import type {
  TestingAuthenticationMode,
  TestingBusyAction,
  TestingCaseFilter,
  TestingCaseIntakeMode,
  TestingLocatorCaptureScope,
  TestingLocatorFilter,
  TestingLocatorPageTab,
  TestingWorkspaceSection,
} from "./types";
import { TestingTerminalDock } from "./TestingTerminalDock";

const TestingOverview = lazy(() => import("./TestingOverview"));
const TestingDiscover = lazy(() => import("./TestingDiscover"));
const TestingCases = lazy(() => import("./TestingCases"));
const TestingAutomate = lazy(() => import("./TestingAutomate"));
const TestingRuns = lazy(() => import("./TestingRuns"));
const TestingReports = lazy(() => import("./TestingReports"));

function basenameOfPath(input: string): string {
  const parts = input.split(/[/\\]/g).filter(Boolean);
  return parts[parts.length - 1] ?? input;
}

import { projectUiStateKey, useProjectTestingState } from "~/state/scopedStateStore";

export function TestingTool(props: {
  projectId: ProjectId;
  environmentId?: EnvironmentId;
  projectPath: string;
  defaultModelSelection: ModelSelection | null;
}) {
  const serverConfig = useServerConfig();
  const { confirm, confirmDialog } = useConfirm();
  const [testingTerminalOpen, setTestingTerminalOpen] = useState(false);
  const testingTerminalButtonRef = useRef<HTMLButtonElement>(null);
  const [testingState, setTestingState] = useProjectTestingState(
    projectUiStateKey(props.environmentId, props.projectId),
  );

  const closeTestingTerminal = useCallback(() => {
    setTestingTerminalOpen(false);
    window.requestAnimationFrame(() => testingTerminalButtonRef.current?.focus());
  }, []);

  const targetUrl = testingState.targetUrl;
  const setTargetUrl = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({ targetUrl: typeof v === "function" ? v(prev.targetUrl) : v }));
    },
    [setTestingState],
  );

  const cdpEndpoint = testingState.cdpEndpoint;
  const setCdpEndpoint = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        cdpEndpoint: typeof v === "function" ? v(prev.cdpEndpoint) : v,
      }));
    },
    [setTestingState],
  );

  const explorationScope = testingState.explorationScope;
  const setExplorationScope = useCallback(
    (v: TestingExplorationScope | ((prev: TestingExplorationScope) => TestingExplorationScope)) => {
      setTestingState((prev) => ({
        explorationScope: typeof v === "function" ? v(prev.explorationScope) : v,
      }));
    },
    [setTestingState],
  );

  const authenticationMode = testingState.authenticationMode;
  const setAuthenticationMode = useCallback(
    (
      v:
        | TestingAuthenticationMode
        | ((prev: TestingAuthenticationMode) => TestingAuthenticationMode),
    ) => {
      setTestingState((prev) => ({
        authenticationMode: typeof v === "function" ? v(prev.authenticationMode) : v,
      }));
    },
    [setTestingState],
  );

  const activeTestingSection = testingState.activeTestingSection;
  const setActiveTestingSection = useCallback(
    (v: TestingWorkspaceSection | ((prev: TestingWorkspaceSection) => TestingWorkspaceSection)) => {
      setTestingState((prev) => ({
        activeTestingSection: typeof v === "function" ? v(prev.activeTestingSection) : v,
      }));
    },
    [setTestingState],
  );

  const caseSearch = testingState.caseSearch;
  const setCaseSearch = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({ caseSearch: typeof v === "function" ? v(prev.caseSearch) : v }));
    },
    [setTestingState],
  );

  const caseFilter = testingState.caseFilter;
  const setCaseFilter = useCallback(
    (v: TestingCaseFilter | ((prev: TestingCaseFilter) => TestingCaseFilter)) => {
      setTestingState((prev) => ({ caseFilter: typeof v === "function" ? v(prev.caseFilter) : v }));
    },
    [setTestingState],
  );

  const implementedInventoryOpen = testingState.implementedInventoryOpen;
  const setImplementedInventoryOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setTestingState((prev) => ({
        implementedInventoryOpen: typeof v === "function" ? v(prev.implementedInventoryOpen) : v,
      }));
    },
    [setTestingState],
  );

  const selectedCaseId = testingState.selectedCaseId;
  const setSelectedCaseId = useCallback(
    (v: string | null | ((prev: string | null) => string | null)) => {
      setTestingState((prev) => ({
        selectedCaseId: typeof v === "function" ? v(prev.selectedCaseId) : v,
      }));
    },
    [setTestingState],
  );

  const maxStates = testingState.maxStates;
  const setMaxStates = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({ maxStates: typeof v === "function" ? v(prev.maxStates) : v }));
    },
    [setTestingState],
  );

  const maxDurationMinutes = testingState.maxDurationMinutes;
  const setMaxDurationMinutes = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        maxDurationMinutes: typeof v === "function" ? v(prev.maxDurationMinutes) : v,
      }));
    },
    [setTestingState],
  );

  const [status, setStatus] = useState<TestingGraphSummary | null>(null);
  const [cases, setCases] = useState<ReadonlyArray<TestingCaseSummary>>([]);
  const [caseGroups, setCaseGroups] = useState<ReadonlyArray<string>>(["Ungrouped"]);
  const [generationJobs, setGenerationJobs] = useState<ReadonlyArray<TestingGenerationJob>>([]);
  const [executionRuns, setExecutionRuns] = useState<ReadonlyArray<TestingExecutionRun>>([]);
  const [testingSchedules, setTestingSchedules] = useState<ReadonlyArray<TestingSchedule>>([]);

  const executionMode = testingState.executionMode;
  const setExecutionMode = useCallback(
    (v: "standalone" | "ci" | ((prev: "standalone" | "ci") => "standalone" | "ci")) => {
      setTestingState((prev) => ({
        executionMode: typeof v === "function" ? v(prev.executionMode) : v,
      }));
    },
    [setTestingState],
  );

  const visualComparison = testingState.visualComparison;
  const setVisualComparison = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setTestingState((prev) => ({
        visualComparison: typeof v === "function" ? v(prev.visualComparison) : v,
      }));
    },
    [setTestingState],
  );

  const [scheduleTime, setScheduleTime] = useState("");
  const [testerName, setTesterName] = useState("");

  const traceCaseId = testingState.traceCaseId;
  const setTraceCaseId = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        traceCaseId: typeof v === "function" ? v(prev.traceCaseId) : v,
      }));
    },
    [setTestingState],
  );

  const [traceability, setTraceability] = useState<TestingTraceabilityResult | null>(null);
  const [graphExplorer, setGraphExplorer] = useState<TestingGraphExplorerResult | null>(null);
  const [reportPaths, setReportPaths] = useState<{ docxPath: string; pdfPath: string } | null>(
    null,
  );

  const bugDraft = testingState.bugDraft;
  const setBugDraft = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({ bugDraft: typeof v === "function" ? v(prev.bugDraft) : v }));
    },
    [setTestingState],
  );

  const triageResult = testingState.triageResult;
  const setTriageResult = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        triageResult: typeof v === "function" ? v(prev.triageResult) : v,
      }));
    },
    [setTestingState],
  );

  const generationModelSelection =
    testingState.generationModelSelection ??
    props.defaultModelSelection ??
    makeAppModelSelection("codex", DEFAULT_MODEL);
  const setGenerationModelSelection = useCallback(
    (v: ModelSelection | ((prev: ModelSelection) => ModelSelection)) => {
      setTestingState((prev) => ({
        generationModelSelection:
          typeof v === "function"
            ? v(
                prev.generationModelSelection ??
                  props.defaultModelSelection ??
                  makeAppModelSelection("codex", DEFAULT_MODEL),
              )
            : v,
      }));
    },
    [props.defaultModelSelection, setTestingState],
  );

  const generationReasoning = testingState.generationReasoning;
  const setGenerationReasoning = useCallback(
    (
      v:
        | "low"
        | "medium"
        | "high"
        | ((prev: "low" | "medium" | "high") => "low" | "medium" | "high"),
    ) => {
      setTestingState((prev) => ({
        generationReasoning: typeof v === "function" ? v(prev.generationReasoning) : v,
      }));
    },
    [setTestingState],
  );

  const generationOutputMode = testingState.generationOutputMode;
  const setGenerationOutputMode = useCallback(
    (
      v: "managed" | "repository" | ((prev: "managed" | "repository") => "managed" | "repository"),
    ) => {
      setTestingState((prev) => ({
        generationOutputMode: typeof v === "function" ? v(prev.generationOutputMode) : v,
      }));
    },
    [setTestingState],
  );

  const repositoryOutputPath = testingState.repositoryOutputPath;
  const setRepositoryOutputPath = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        repositoryOutputPath: typeof v === "function" ? v(prev.repositoryOutputPath) : v,
      }));
    },
    [setTestingState],
  );

  const templatePath = testingState.templatePath;
  const setTemplatePath = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        templatePath: typeof v === "function" ? v(prev.templatePath) : v,
      }));
    },
    [setTestingState],
  );

  const [captureReplay, setCaptureReplay] = useState(false);

  const generationMaxCases = testingState.generationMaxCases;
  const setGenerationMaxCases = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        generationMaxCases: typeof v === "function" ? v(prev.generationMaxCases) : v,
      }));
    },
    [setTestingState],
  );

  const generationMaxTokens = testingState.generationMaxTokens;
  const setGenerationMaxTokens = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        generationMaxTokens: typeof v === "function" ? v(prev.generationMaxTokens) : v,
      }));
    },
    [setTestingState],
  );

  const generationMaxCost = testingState.generationMaxCost;
  const setGenerationMaxCost = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        generationMaxCost: typeof v === "function" ? v(prev.generationMaxCost) : v,
      }));
    },
    [setTestingState],
  );

  const [workbookPath, setWorkbookPath] = useState("");

  const selectedGenerationCaseIds = testingState.selectedGenerationCaseIds;
  const setSelectedGenerationCaseIds = useCallback(
    (v: ReadonlySet<string> | ((prev: ReadonlySet<string>) => ReadonlySet<string>)) => {
      setTestingState((prev) => ({
        selectedGenerationCaseIds: typeof v === "function" ? v(prev.selectedGenerationCaseIds) : v,
      }));
    },
    [setTestingState],
  );

  const generationSelectionInitializedRef = useRef(false);

  const editingCaseId = testingState.editingCaseId;
  const setEditingCaseId = useCallback(
    (v: string | null | ((prev: string | null) => string | null)) => {
      setTestingState((prev) => ({
        editingCaseId: typeof v === "function" ? v(prev.editingCaseId) : v,
      }));
    },
    [setTestingState],
  );

  const editedExternalId = testingState.editedExternalId;
  const setEditedExternalId = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        editedExternalId: typeof v === "function" ? v(prev.editedExternalId) : v,
      }));
    },
    [setTestingState],
  );

  const editedDescription = testingState.editedDescription;
  const setEditedDescription = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        editedDescription: typeof v === "function" ? v(prev.editedDescription) : v,
      }));
    },
    [setTestingState],
  );

  const editedSteps = testingState.editedSteps;
  const setEditedSteps = useCallback(
    (v: ReadonlyArray<string> | ((prev: ReadonlyArray<string>) => ReadonlyArray<string>)) => {
      setTestingState((prev) => ({
        editedSteps: typeof v === "function" ? v(prev.editedSteps) : v,
      }));
    },
    [setTestingState],
  );

  const editedExpectedResults = testingState.editedExpectedResults;
  const setEditedExpectedResults = useCallback(
    (v: ReadonlyArray<string> | ((prev: ReadonlyArray<string>) => ReadonlyArray<string>)) => {
      setTestingState((prev) => ({
        editedExpectedResults: typeof v === "function" ? v(prev.editedExpectedResults) : v,
      }));
    },
    [setTestingState],
  );

  const editedCaseLocatorIds = testingState.editedCaseLocatorIds;
  const setEditedCaseLocatorIds = useCallback(
    (v: ReadonlySet<string> | ((prev: ReadonlySet<string>) => ReadonlySet<string>)) => {
      setTestingState((prev) => ({
        editedCaseLocatorIds: typeof v === "function" ? v(prev.editedCaseLocatorIds) : v,
      }));
    },
    [setTestingState],
  );

  const caseIntakeMode = testingState.caseIntakeMode;
  const setCaseIntakeMode = useCallback(
    (v: TestingCaseIntakeMode | ((prev: TestingCaseIntakeMode) => TestingCaseIntakeMode)) => {
      setTestingState((prev) => ({
        caseIntakeMode: typeof v === "function" ? v(prev.caseIntakeMode) : v,
      }));
    },
    [setTestingState],
  );

  const manualCaseId = testingState.manualCaseId;
  const setManualCaseId = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        manualCaseId: typeof v === "function" ? v(prev.manualCaseId) : v,
      }));
    },
    [setTestingState],
  );

  const manualCaseDescription = testingState.manualCaseDescription;
  const setManualCaseDescription = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        manualCaseDescription: typeof v === "function" ? v(prev.manualCaseDescription) : v,
      }));
    },
    [setTestingState],
  );

  const manualCaseSteps = testingState.manualCaseSteps;
  const setManualCaseSteps = useCallback(
    (v: ReadonlyArray<string> | ((prev: ReadonlyArray<string>) => ReadonlyArray<string>)) => {
      setTestingState((prev) => ({
        manualCaseSteps: typeof v === "function" ? v(prev.manualCaseSteps) : v,
      }));
    },
    [setTestingState],
  );

  const manualCaseExpectedResults = testingState.manualCaseExpectedResults;
  const setManualCaseExpectedResults = useCallback(
    (v: ReadonlyArray<string> | ((prev: ReadonlyArray<string>) => ReadonlyArray<string>)) => {
      setTestingState((prev) => ({
        manualCaseExpectedResults: typeof v === "function" ? v(prev.manualCaseExpectedResults) : v,
      }));
    },
    [setTestingState],
  );

  const manualCaseLocatorIds = testingState.manualCaseLocatorIds;
  const setManualCaseLocatorIds = useCallback(
    (v: ReadonlySet<string> | ((prev: ReadonlySet<string>) => ReadonlySet<string>)) => {
      setTestingState((prev) => ({
        manualCaseLocatorIds: typeof v === "function" ? v(prev.manualCaseLocatorIds) : v,
      }));
    },
    [setTestingState],
  );

  const storyText = testingState.storyText;
  const setStoryText = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({ storyText: typeof v === "function" ? v(prev.storyText) : v }));
    },
    [setTestingState],
  );

  const storyFilePath = testingState.storyFilePath;
  const setStoryFilePath = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        storyFilePath: typeof v === "function" ? v(prev.storyFilePath) : v,
      }));
    },
    [setTestingState],
  );

  const [busyAction, setBusyAction] = useState<TestingBusyAction>(null);
  const [authCaptureOpen, setAuthCaptureOpen] = useState(false);
  const [message, setMessage] = useState("Ready to explore a UAT application.");
  const [locatorLibrary, setLocatorLibrary] = useState<TestingLocatorLibraryResult | null>(null);
  const [locatorSession, setLocatorSession] = useState<TestingLocatorDiscoverySession | null>(null);
  const previewLocatorSessionId = useRef<string | null>(null);

  const locatorMode = testingState.locatorMode;
  const setLocatorMode = useCallback(
    (v: TestingDiscoveryMode | ((prev: TestingDiscoveryMode) => TestingDiscoveryMode)) => {
      setTestingState((prev) => ({
        locatorMode: typeof v === "function" ? v(prev.locatorMode) : v,
      }));
    },
    [setTestingState],
  );

  const locatorCoverage = testingState.locatorCoverage;
  const setLocatorCoverage = useCallback(
    (
      v:
        | TestingLocatorCoverageMode
        | ((prev: TestingLocatorCoverageMode) => TestingLocatorCoverageMode),
    ) => {
      setTestingState((prev) => ({
        locatorCoverage: typeof v === "function" ? v(prev.locatorCoverage) : v,
      }));
    },
    [setTestingState],
  );

  const locatorSafety = testingState.locatorSafety;
  const setLocatorSafety = useCallback(
    (
      v:
        | TestingDiscoverySafetyProfile
        | ((prev: TestingDiscoverySafetyProfile) => TestingDiscoverySafetyProfile),
    ) => {
      setTestingState((prev) => ({
        locatorSafety: typeof v === "function" ? v(prev.locatorSafety) : v,
      }));
    },
    [setTestingState],
  );

  const locatorMaxElements = testingState.locatorMaxElements;
  const setLocatorMaxElements = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        locatorMaxElements: typeof v === "function" ? v(prev.locatorMaxElements) : v,
      }));
    },
    [setTestingState],
  );

  const locatorMaxPages = testingState.locatorMaxPages;
  const setLocatorMaxPages = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        locatorMaxPages: typeof v === "function" ? v(prev.locatorMaxPages) : v,
      }));
    },
    [setTestingState],
  );

  const [locatorNavigateUrl, setLocatorNavigateUrl] = useState("");
  const [locatorStorageMode, setLocatorStorageMode] =
    useState<TestingLocatorStorageMode>("managed");
  const [locatorFolderResult, setLocatorFolderResult] = useState<TestingLocatorFolderResult | null>(
    null,
  );
  const [locatorSyncPreview, setLocatorSyncPreview] = useState<TestingLocatorSyncPreview | null>(
    null,
  );

  const editingLocatorId = testingState.editingLocatorId;
  const setEditingLocatorId = useCallback(
    (v: string | null | ((prev: string | null) => string | null)) => {
      setTestingState((prev) => ({
        editingLocatorId: typeof v === "function" ? v(prev.editingLocatorId) : v,
      }));
    },
    [setTestingState],
  );

  const editingLocatorKey = testingState.editingLocatorKey;
  const setEditingLocatorKey = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        editingLocatorKey: typeof v === "function" ? v(prev.editingLocatorKey) : v,
      }));
    },
    [setTestingState],
  );

  const editingLocatorClassification = testingState.editingLocatorClassification;
  const setEditingLocatorClassification = useCallback(
    (
      v:
        | TestingLocatorEntry["classification"]
        | ((prev: TestingLocatorEntry["classification"]) => TestingLocatorEntry["classification"]),
    ) => {
      setTestingState((prev) => ({
        editingLocatorClassification:
          typeof v === "function" ? v(prev.editingLocatorClassification) : v,
      }));
    },
    [setTestingState],
  );

  const editingLocatorStrategy = testingState.editingLocatorStrategy;
  const setEditingLocatorStrategy = useCallback(
    (
      v:
        | TestingLocatorEntry["strategy"]
        | ((prev: TestingLocatorEntry["strategy"]) => TestingLocatorEntry["strategy"]),
    ) => {
      setTestingState((prev) => ({
        editingLocatorStrategy: typeof v === "function" ? v(prev.editingLocatorStrategy) : v,
      }));
    },
    [setTestingState],
  );

  const editingLocatorArguments = testingState.editingLocatorArguments;
  const setEditingLocatorArguments = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        editingLocatorArguments: typeof v === "function" ? v(prev.editingLocatorArguments) : v,
      }));
    },
    [setTestingState],
  );

  const editingLocatorContext = testingState.editingLocatorContext;
  const setEditingLocatorContext = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        editingLocatorContext: typeof v === "function" ? v(prev.editingLocatorContext) : v,
      }));
    },
    [setTestingState],
  );

  const locatorSearch = testingState.locatorSearch;
  const setLocatorSearch = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        locatorSearch: typeof v === "function" ? v(prev.locatorSearch) : v,
      }));
    },
    [setTestingState],
  );

  const locatorFilter = testingState.locatorFilter;
  const setLocatorFilter = useCallback(
    (v: TestingLocatorFilter | ((prev: TestingLocatorFilter) => TestingLocatorFilter)) => {
      setTestingState((prev) => ({
        locatorFilter: typeof v === "function" ? v(prev.locatorFilter) : v,
      }));
    },
    [setTestingState],
  );

  const [locatorPendingRemoveId, setLocatorPendingRemoveId] = useState<string | null>(null);
  const [locatorCaptureScope, setLocatorCaptureScope] =
    useState<TestingLocatorCaptureScope>("page");
  const [locatorTaskContext, setLocatorTaskContext] = useState("");
  const [locatorAdvancedOpen, setLocatorAdvancedOpen] = useState(false);

  const locatorViewport = testingState.locatorViewport;
  const setLocatorViewport = useCallback(
    (
      v:
        | "desktop"
        | "tablet"
        | "mobile"
        | ((prev: "desktop" | "tablet" | "mobile") => "desktop" | "tablet" | "mobile"),
    ) => {
      setTestingState((prev) => ({
        locatorViewport: typeof v === "function" ? v(prev.locatorViewport) : v,
      }));
    },
    [setTestingState],
  );

  const locatorPreviewExpanded = testingState.locatorPreviewExpanded;
  const setLocatorPreviewExpanded = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setTestingState((prev) => ({
        locatorPreviewExpanded: typeof v === "function" ? v(prev.locatorPreviewExpanded) : v,
      }));
    },
    [setTestingState],
  );

  const locatorPreviewFocusButtonRef = useRef<HTMLButtonElement | null>(null);

  const selectedLocatorPageId = testingState.selectedLocatorPageId;
  const setSelectedLocatorPageId = useCallback(
    (v: string | null | ((prev: string | null) => string | null)) => {
      setTestingState((prev) => ({
        selectedLocatorPageId: typeof v === "function" ? v(prev.selectedLocatorPageId) : v,
      }));
    },
    [setTestingState],
  );

  const locatorPageTab = testingState.locatorPageTab;
  const setLocatorPageTab = useCallback(
    (v: TestingLocatorPageTab | ((prev: TestingLocatorPageTab) => TestingLocatorPageTab)) => {
      setTestingState((prev) => ({
        locatorPageTab: typeof v === "function" ? v(prev.locatorPageTab) : v,
      }));
    },
    [setTestingState],
  );

  const [locatorPageName, setLocatorPageName] = useState("");
  const [locatorCodeEntryIds, setLocatorCodeEntryIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [locatorRepositoryFolder, setLocatorRepositoryFolder] = useState("");
  const [locatorRepositoryFileName, setLocatorRepositoryFileName] = useState("");
  const [locatorRepositoryProposal, setLocatorRepositoryProposal] =
    useState<TestingLocatorRepositoryProposal | null>(null);
  const [locatorRepositoryConfirmOpen, setLocatorRepositoryConfirmOpen] = useState(false);

  const locatorCodeEditing = testingState.locatorCodeEditing;
  const setLocatorCodeEditing = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setTestingState((prev) => ({
        locatorCodeEditing: typeof v === "function" ? v(prev.locatorCodeEditing) : v,
      }));
    },
    [setTestingState],
  );

  const locatorCodeDraft = testingState.locatorCodeDraft;
  const setLocatorCodeDraft = useCallback(
    (v: string | ((prev: string) => string)) => {
      setTestingState((prev) => ({
        locatorCodeDraft: typeof v === "function" ? v(prev.locatorCodeDraft) : v,
      }));
    },
    [setTestingState],
  );

  const [selectedLocatorEntryIds, setSelectedLocatorEntryIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [caseIdPolicy, setCaseIdPolicy] = useState<TestingCaseIdPolicy | null>(null);
  const [caseIdPrefix, setCaseIdPrefix] = useState("TC-");
  const [caseIdPadding, setCaseIdPadding] = useState("5");
  const [caseIdNext, setCaseIdNext] = useState("1");
  const [testInventory, setTestInventory] = useState<TestingTestInventoryResult | null>(null);

  const testInventoryView = testingState.testInventoryView;
  const setTestInventoryView = useCallback(
    (v: "tree" | "table" | ((prev: "tree" | "table") => "tree" | "table")) => {
      setTestingState((prev) => ({
        testInventoryView: typeof v === "function" ? v(prev.testInventoryView) : v,
      }));
    },
    [setTestingState],
  );

  const expandedTestNodes = testingState.expandedTestNodes;
  const setExpandedTestNodes = useCallback(
    (v: ReadonlySet<string> | ((prev: ReadonlySet<string>) => ReadonlySet<string>)) => {
      setTestingState((prev) => ({
        expandedTestNodes: typeof v === "function" ? v(prev.expandedTestNodes) : v,
      }));
    },
    [setTestingState],
  );

  const selectedTestNodeId = testingState.selectedTestNodeId;
  const setSelectedTestNodeId = useCallback(
    (v: string | null | ((prev: string | null) => string | null)) => {
      setTestingState((prev) => ({
        selectedTestNodeId: typeof v === "function" ? v(prev.selectedTestNodeId) : v,
      }));
    },
    [setTestingState],
  );

  useEffect(() => {
    if (!locatorPreviewExpanded) return;
    const focusButton = locatorPreviewFocusButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setLocatorPreviewExpanded(false);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = document.querySelector<HTMLElement>(
        '[aria-label="Focused application preview"]',
      );
      const focusable = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => focusButton?.focus());
    };
  }, [locatorPreviewExpanded]);

  const refreshStatus = useCallback(async () => {
    const api = readNativeApi() ?? ensureNativeApi();
    const nextStatus = await api.testing.getStatus({ projectId: props.projectId });
    setStatus(nextStatus);
    if (nextStatus.targetUrl) {
      setTargetUrl((current) => current || nextStatus.targetUrl || "");
    }
  }, [props.projectId]);

  const refreshLocatorLibrary = useCallback(async () => {
    const result = await (readNativeApi() ?? ensureNativeApi()).testing.getLocatorLibrary({
      projectId: props.projectId,
    });
    setLocatorLibrary(result);
  }, [props.projectId]);

  const setWorkspaceCases = useCallback((nextCases: ReadonlyArray<TestingCaseSummary>) => {
    setCases(nextCases);
    setSelectedGenerationCaseIds((current) => {
      const available = new Set(nextCases.map((testCase) => testCase.id));
      const retained = new Set([...current].filter((id) => available.has(id)));
      if (generationSelectionInitializedRef.current || nextCases.length === 0) return retained;
      generationSelectionInitializedRef.current = true;
      return new Set(
        nextCases
          .filter(
            (testCase) =>
              testCase.reviewDecision === "accepted" || testCase.reviewDecision === "edited",
          )
          .map((testCase) => testCase.id),
      );
    });
  }, []);

  const refreshCases = useCallback(async () => {
    const result = await (readNativeApi() ?? ensureNativeApi()).testing.listCases({
      projectId: props.projectId,
    });
    setWorkspaceCases(result.cases);
    setCaseGroups(result.groups);
  }, [props.projectId, setWorkspaceCases]);

  const refreshTestingWorkspace = useCallback(async () => {
    const api = readNativeApi() ?? ensureNativeApi();
    const [policy, inventory] = await Promise.all([
      api.testing.getCaseIdPolicy({ projectId: props.projectId }),
      api.testing.getTestInventory({ projectId: props.projectId, projectPath: props.projectPath }),
    ]);
    setCaseIdPolicy(policy);
    setCaseIdPrefix(policy.prefix);
    setCaseIdPadding(String(policy.padding));
    setCaseIdNext(String(policy.nextSequence));
    setTestInventory(inventory);
  }, [props.projectId, props.projectPath]);

  const refreshGenerationJobs = useCallback(async () => {
    const result = await (readNativeApi() ?? ensureNativeApi()).testing.listGenerationJobs({
      projectId: props.projectId,
    });
    setGenerationJobs(result.jobs);
  }, [props.projectId]);

  const refreshExecution = useCallback(async () => {
    const api = readNativeApi() ?? ensureNativeApi();
    const [runs, schedules] = await Promise.all([
      api.testing.listExecutionRuns({ projectId: props.projectId }),
      api.testing.listSchedules({ projectId: props.projectId }),
    ]);
    setExecutionRuns(runs.runs);
    setTestingSchedules(schedules.schedules);
  }, [props.projectId]);

  const refreshGraphExplorer = useCallback(async () => {
    const result = await (readNativeApi() ?? ensureNativeApi()).testing.getGraphExplorer({
      projectId: props.projectId,
    });
    setGraphExplorer(result);
  }, [props.projectId]);

  useEffect(() => {
    void Promise.all([
      refreshStatus(),
      refreshCases(),
      refreshGenerationJobs(),
      refreshExecution(),
      refreshGraphExplorer(),
      refreshLocatorLibrary(),
      refreshTestingWorkspace(),
    ]).catch((error) => {
      setMessage(error instanceof Error ? error.message : "Could not load Testing status.");
    });
  }, [
    refreshCases,
    refreshExecution,
    refreshGenerationJobs,
    refreshGraphExplorer,
    refreshLocatorLibrary,
    refreshTestingWorkspace,
    refreshStatus,
  ]);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.onCodeChromeState) return;
    const toInventoryNode = (
      item: NonNullable<CodeChromeState["testItems"]>[number],
      parentId: string,
    ): TestingTestInventoryNode => ({
      id: `vscode:${item.id}`,
      parentId,
      kind: item.children.length > 0 ? "suite" : "test",
      label: item.label,
      source: "vscode",
      status: item.busy ? "running" : "unknown",
      filePath: item.uri,
      line: item.line,
      externalCaseId: item.label.match(/\b(?:TC-|QA-)?\d{2,}\b/i)?.[0] ?? null,
      runnable: item.children.length === 0,
      children: item.children.map((child) => toInventoryNode(child, `vscode:${item.id}`)),
    });
    return bridge.onCodeChromeState((update) => {
      if (update.projectId !== props.projectId || update.state.testItems === undefined) return;
      setTestInventory((current) => {
        if (!current) return current;
        const vscodeRoot: TestingTestInventoryNode = {
          id: "vscode",
          parentId: null,
          kind: "root",
          label: "VS Code test providers",
          source: "vscode",
          status: "unknown",
          filePath: null,
          line: null,
          externalCaseId: null,
          runnable: false,
          children: update.state.testItems!.map((item) => toInventoryNode(item, "vscode")),
        };
        return {
          ...current,
          editorProviderConnected: true,
          roots: [...current.roots.filter((root) => root.source !== "vscode"), vscodeRoot],
        };
      });
      setExpandedTestNodes((current) => new Set([...current, "vscode"]));
    });
  }, [props.projectId]);

  const normalizedTarget = useMemo(() => {
    const trimmed = targetUrl.trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
    } catch {
      return null;
    }
  }, [targetUrl]);

  const normalizedMaxStates = useMemo(() => {
    const parsed = Number(maxStates);
    return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_TESTING_MAX_STATES
      ? parsed
      : null;
  }, [maxStates]);

  const normalizedMaxDurationSeconds = useMemo(() => {
    const trimmed = maxDurationMinutes.trim();
    if (!trimmed) return undefined;
    const parsedMinutes = Number(trimmed);
    const parsedSeconds = parsedMinutes * 60;
    return Number.isSafeInteger(parsedSeconds) &&
      parsedSeconds >= 1 &&
      parsedSeconds <= MAX_TESTING_DURATION_SECONDS
      ? parsedSeconds
      : null;
  }, [maxDurationMinutes]);

  const normalizedCdpEndpoint = useMemo(() => {
    const trimmed = cdpEndpoint.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = new URL(trimmed);
      const isLoopback =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]";
      return (parsed.protocol === "http:" || parsed.protocol === "https:") && isLoopback
        ? parsed.href
        : null;
    } catch {
      return null;
    }
  }, [cdpEndpoint]);

  const authenticationReady =
    authenticationMode === "none" ||
    (authenticationMode === "local-profile" && Boolean(status?.authCapturedAt)) ||
    (authenticationMode === "connected-session" && typeof normalizedCdpEndpoint === "string");

  const acceptedCaseCount = useMemo(
    () =>
      cases.filter(
        (testCase) =>
          testCase.reviewDecision === "accepted" || testCase.reviewDecision === "edited",
      ).length,
    [cases],
  );
  const readyCases = useMemo(
    () =>
      cases.filter(
        (testCase) =>
          testCase.reviewDecision === "accepted" || testCase.reviewDecision === "edited",
      ),
    [cases],
  );
  const reviewCaseCount = useMemo(
    () =>
      cases.filter(
        (testCase) => testCase.status === "needs-review" && testCase.reviewDecision === "pending",
      ).length,
    [cases],
  );
  const blockedCaseCount = useMemo(
    () => cases.filter((testCase) => testCase.status === "blocked").length,
    [cases],
  );
  const completedGenerationJob = useMemo(
    () => generationJobs.find((job) => job.status === "completed") ?? null,
    [generationJobs],
  );
  const latestExecutionRun = useMemo(() => executionRuns[0] ?? null, [executionRuns]);

  const filteredCases = useMemo(() => {
    const query = caseSearch.trim().toLocaleLowerCase();
    return cases.filter((testCase) => {
      const matchesQuery =
        !query ||
        testCase.externalId.toLocaleLowerCase().includes(query) ||
        testCase.description.toLocaleLowerCase().includes(query);
      const matchesFilter =
        caseFilter === "all" ||
        (caseFilter === "needs-review" && testCase.status === "needs-review") ||
        (caseFilter === "accepted" &&
          (testCase.reviewDecision === "accepted" || testCase.reviewDecision === "edited")) ||
        (caseFilter === "blocked" && testCase.status === "blocked");
      return matchesQuery && matchesFilter;
    });
  }, [caseFilter, caseSearch, cases]);

  const selectedCase = useMemo(
    () =>
      filteredCases.find((testCase) => testCase.id === selectedCaseId) ?? filteredCases[0] ?? null,
    [filteredCases, selectedCaseId],
  );

  const fusionProviders = useMemo(() => serverConfig?.providers ?? [], [serverConfig?.providers]);
  const generationFusionProvider = TESTING_FUSION_PROVIDER_IDS.includes(
    generationModelSelection.instanceId as ProviderPickerKind,
  )
    ? (generationModelSelection.instanceId as ProviderPickerKind)
    : "codex";

  const updateTestingFusionModel = useCallback(
    (provider: ProviderPickerKind, model: ModelSlug, options?: ModelSelection["options"]) => {
      const selection = makeAppModelSelection(provider, model, options);
      setGenerationModelSelection(selection);
      setGenerationReasoning(testingReasoningTierFromOptions(selection.options));
    },
    [],
  );

  const updateTestingFusionOptions = useCallback(
    (options: ModelSelection["options"] | undefined) => {
      const selection = makeAppModelSelection(
        generationFusionProvider,
        generationModelSelection.model,
        options,
      );
      setGenerationModelSelection(selection);
      setGenerationReasoning(testingReasoningTierFromOptions(selection.options));
    },
    [generationFusionProvider, generationModelSelection.model],
  );

  const selectedLocatorPage = useMemo(
    () => locatorLibrary?.pages.find((page) => page.id === selectedLocatorPageId) ?? null,
    [locatorLibrary?.pages, selectedLocatorPageId],
  );

  const filteredLocatorEntries = useMemo(() => {
    const query = locatorSearch.trim().toLocaleLowerCase();
    return (selectedLocatorPage?.entries ?? []).filter((entry) => {
      const matchesQuery =
        !query ||
        entry.locatorKey.toLocaleLowerCase().includes(query) ||
        entry.strategy.toLocaleLowerCase().includes(query) ||
        entry.classification.toLocaleLowerCase().includes(query) ||
        entry.semanticContext.toLocaleLowerCase().includes(query) ||
        testingLocatorCode(entry).toLocaleLowerCase().includes(query);
      const matchesFilter =
        locatorFilter === "all"
          ? entry.lifecycleStatus !== "archived"
          : locatorFilter === "selected"
            ? locatorCodeEntryIds.has(entry.id) && entry.lifecycleStatus !== "archived"
            : locatorFilter === "needs-review"
              ? (entry.lifecycleStatus === "draft" ||
                  entry.lifecycleStatus === "manual-required" ||
                  entry.fragile) &&
                entry.lifecycleStatus !== "archived"
              : entry.lifecycleStatus === "archived";
      return matchesQuery && matchesFilter;
    });
  }, [locatorCodeEntryIds, locatorFilter, locatorSearch, selectedLocatorPage]);

  const editingLocatorEntry = useMemo(
    () => selectedLocatorPage?.entries.find((entry) => entry.id === editingLocatorId) ?? null,
    [editingLocatorId, selectedLocatorPage?.entries],
  );
  const pendingRemoveLocator = useMemo(
    () => selectedLocatorPage?.entries.find((entry) => entry.id === locatorPendingRemoveId) ?? null,
    [locatorPendingRemoveId, selectedLocatorPage?.entries],
  );

  useEffect(() => {
    if (!selectedLocatorPage) return;
    setLocatorPageName(selectedLocatorPage.name);
    setLocatorCodeEntryIds(
      new Set(
        selectedLocatorPage.entries
          .filter((entry) => entry.lifecycleStatus === "accepted")
          .map((entry) => entry.id),
      ),
    );
    setLocatorRepositoryFolder(selectedLocatorPage.repositoryTarget?.folderPath ?? "");
    setLocatorRepositoryFileName(
      selectedLocatorPage.repositoryTarget?.fileName ??
        selectedLocatorPage.pageObject?.fileName ??
        "page.ts",
    );
    setLocatorRepositoryProposal(null);
    setLocatorCodeEditing(false);
    setLocatorCodeDraft(selectedLocatorPage.pageObject?.code ?? "");
  }, [selectedLocatorPage]);

  const flattenedTestInventory = useMemo(() => {
    const rows: Array<{ node: TestingTestInventoryNode; depth: number }> = [];
    const visit = (node: TestingTestInventoryNode, depth: number) => {
      rows.push({ node, depth });
      if (!expandedTestNodes.has(node.id)) return;
      for (const child of node.children) visit(child, depth + 1);
    };
    for (const root of testInventory?.roots ?? []) visit(root, 0);
    return rows;
  }, [expandedTestNodes, testInventory]);

  const startAuthCapture = useCallback(async () => {
    if (!normalizedTarget) return;
    setBusyAction("auth");
    setMessage("Opening a browser for manual sign-in...");
    try {
      await ensureNativeApi().testing.startAuthCapture({
        projectId: props.projectId,
        targetUrl: normalizedTarget,
      });
      setAuthCaptureOpen(true);
      setMessage("Sign in in the opened browser, then choose Finish & Save Session.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open the sign-in browser.");
    } finally {
      setBusyAction(null);
    }
  }, [normalizedTarget, props.projectId]);

  const finishAuthCapture = useCallback(async () => {
    setBusyAction("finish-auth");
    setMessage("Saving the authenticated browser profile...");
    try {
      const nextStatus = await ensureNativeApi().testing.finishAuthCapture({
        projectId: props.projectId,
      });
      setStatus(nextStatus);
      setAuthCaptureOpen(false);
      setMessage("Authenticated session saved locally and ready for reuse.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the browser session.");
    } finally {
      setBusyAction(null);
    }
  }, [props.projectId]);

  useEffect(() => {
    if (busyAction !== "explore") return;
    const interval = setInterval(() => {
      const api = readNativeApi();
      if (!api) return;
      api.testing
        .getStatus({ projectId: props.projectId })
        .then((nextStatus) => {
          setStatus(nextStatus);
          if (nextStatus.targetUrl) {
            setTargetUrl((current) => current || nextStatus.targetUrl || "");
          }
          if (nextStatus.lastRunStatus === "running") {
            const res = nextStatus.lastRunMetrics;
            setMessage(
              `Exploring accessibility states... Discovered ${res?.statesVisited ?? 0} states and ${res?.transitionsObserved ?? 0} transitions so far.`,
            );
          } else if (nextStatus.lastRunStatus === "completed" && nextStatus.lastRunMetrics) {
            const res = nextStatus.lastRunMetrics;
            const terminationMessage =
              res.terminationReason === "plateaued"
                ? "exploration plateaued naturally"
                : res.terminationReason === "time-budget"
                  ? `reached the ${Math.round((res.maxDurationSeconds ?? 0) / 60)}-minute time budget`
                  : `reached the ${res.maxStates}-state limit`;
            setMessage(
              `Exploration complete: ${res.statesVisited} states and ${res.transitionsObserved} transitions observed in ${((res.durationMs ?? 0) / 1000).toFixed(1)} seconds; ${terminationMessage}.`,
            );
            setBusyAction(null);
          } else if (nextStatus.lastRunStatus === "failed") {
            setMessage(`Exploration failed: ${nextStatus.lastRunError ?? "Unknown error"}`);
            setBusyAction(null);
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(interval);
  }, [busyAction, props.projectId]);

  useEffect(() => {
    const hasActiveGeneration = generationJobs.some(
      (job) => job.status === "queued" || job.status === "running",
    );
    if (!hasActiveGeneration) return;
    const interval = setInterval(() => {
      void refreshGenerationJobs();
    }, 1_000);
    return () => clearInterval(interval);
  }, [generationJobs, refreshGenerationJobs]);

  const startExploration = useCallback(async () => {
    if (!normalizedTarget || normalizedMaxStates === null || normalizedMaxDurationSeconds === null)
      return;
    setBusyAction("explore");
    setMessage("Exploring accessibility states and building the transition graph...");
    let isRpcCompleted = false;
    let rpcError: unknown = null;
    try {
      const result = await ensureNativeApi().testing.startExploration({
        projectId: props.projectId,
        targetUrl: normalizedTarget,
        ...(authenticationMode === "connected-session" && normalizedCdpEndpoint
          ? { cdpEndpoint: normalizedCdpEndpoint }
          : {}),
        scope: explorationScope,
        maxStates: normalizedMaxStates,
        ...(normalizedMaxDurationSeconds
          ? { maxDurationSeconds: normalizedMaxDurationSeconds }
          : {}),
      });
      isRpcCompleted = true;
      setStatus(result);
      const terminationMessage =
        result.terminationReason === "plateaued"
          ? "exploration plateaued naturally"
          : result.terminationReason === "time-budget"
            ? `reached the ${Math.round((result.maxDurationSeconds ?? 0) / 60)}-minute time budget`
            : `reached the ${result.maxStates}-state limit`;
      setMessage(
        `Exploration complete: ${result.statesVisited} states and ${result.transitionsObserved} transitions observed in ${(result.durationMs / 1000).toFixed(1)} seconds; ${terminationMessage}.`,
      );
      setBusyAction(null);
    } catch (error) {
      rpcError = error;
    }

    if (!isRpcCompleted) {
      const api = readNativeApi() ?? ensureNativeApi();
      const currentStatus = await api.testing
        .getStatus({ projectId: props.projectId })
        .catch(() => null);
      if (currentStatus?.lastRunStatus === "running") {
        setStatus(currentStatus);
      } else {
        setMessage(rpcError instanceof Error ? rpcError.message : "Exploration failed.");
        await refreshStatus().catch(() => undefined);
        setBusyAction(null);
      }
    }
  }, [
    authenticationMode,
    explorationScope,
    normalizedCdpEndpoint,
    normalizedMaxDurationSeconds,
    normalizedMaxStates,
    normalizedTarget,
    props.projectId,
    refreshStatus,
  ]);

  const setDiscoveryExperience = useCallback(
    async (experience: "classic" | "locator-first") => {
      try {
        const result = await ensureNativeApi().testing.setDiscoveryExperience({
          projectId: props.projectId,
          experience,
        });
        setLocatorLibrary(result);
        setMessage(
          experience === "locator-first"
            ? "Locator-first Discover is enabled for this project."
            : "Classic Discover is enabled for this project.",
        );
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Could not change discovery experience.",
        );
      }
    },
    [props.projectId],
  );

  const startLocatorDiscovery = useCallback(
    async (targetUrlOverride?: string): Promise<boolean> => {
      const discoveryTarget = targetUrlOverride ?? (locatorNavigateUrl || normalizedTarget);
      const discoveryMode = targetUrlOverride ? "manual" : locatorMode;
      const captureScope = targetUrlOverride ? "page" : locatorCaptureScope;
      if (!discoveryTarget) return false;
      const maxElementsPerPage = Number(locatorMaxElements);
      const maxPagesPerSession = Number(locatorMaxPages);
      if (
        !Number.isSafeInteger(maxElementsPerPage) ||
        maxElementsPerPage < MIN_TESTING_MAX_ELEMENTS_PER_PAGE ||
        maxElementsPerPage > MAX_TESTING_MAX_ELEMENTS_PER_PAGE ||
        !Number.isSafeInteger(maxPagesPerSession) ||
        maxPagesPerSession < 1 ||
        maxPagesPerSession > MAX_TESTING_MAX_PAGES_PER_SESSION
      ) {
        setMessage("Choose valid page and element limits before discovery.");
        return false;
      }
      setBusyAction("locator-discovery");
      setMessage("Opening the locator discovery workspace...");
      try {
        const api = ensureNativeApi().testing;
        const previewSnapshot =
          discoveryMode !== "automatic" && authenticationMode !== "connected-session"
            ? await captureTestingPreview(props.projectId)
            : undefined;
        let result = await api.startLocatorDiscovery({
          ...(previewSnapshot ? { previewSnapshot } : {}),
          projectId: props.projectId,
          targetUrl: previewSnapshot?.url ?? normalizeLocatorUrl(discoveryTarget),
          ...(authenticationMode === "connected-session" && normalizedCdpEndpoint
            ? { cdpEndpoint: normalizedCdpEndpoint }
            : {}),
          mode: discoveryMode,
          scope:
            locatorCaptureScope === "origin"
              ? "origin"
              : locatorCaptureScope === "path"
                ? "path"
                : "page",
          coverage: locatorCoverage,
          safetyProfile: locatorSafety,
          captureScope,
          ...(captureScope === "task" && locatorTaskContext.trim()
            ? { taskContext: locatorTaskContext.trim() }
            : {}),
          maxElementsPerPage,
          maxPagesPerSession,
          environmentLabel: "default",
          ...(locatorMode === "automatic" && normalizedMaxStates !== null
            ? { maxStates: normalizedMaxStates }
            : {}),
          ...(locatorMode === "automatic" && normalizedMaxDurationSeconds
            ? { maxDurationSeconds: normalizedMaxDurationSeconds }
            : {}),
        });
        if (!previewSnapshot && discoveryMode === "manual" && result.status === "running") {
          result = await api.captureLocatorPage({
            projectId: props.projectId,
            sessionId: result.id,
            captureMode: captureScope === "task" ? "relevant" : "all",
          });
        }
        setLocatorSession(result);
        previewLocatorSessionId.current = previewSnapshot ? result.id : null;
        setLocatorLibrary(result.library);
        setLocatorNavigateUrl(previewSnapshot?.url ?? discoveryTarget);
        const capturedPage = locatorPageForCapture(result);
        setSelectedLocatorPageId(capturedPage?.id ?? null);
        setSelectedLocatorEntryIds(new Set());
        if (capturedPage) {
          setSelectedLocatorPageId(capturedPage.id);
          setSelectedLocatorEntryIds(
            new Set(
              capturedPage.entries
                .filter(
                  (entry) =>
                    entry.lifecycleStatus !== "archived" &&
                    entry.lifecycleStatus !== "manual-required",
                )
                .map((entry) => entry.id),
            ),
          );
        }
        setMessage(
          capturedPage
            ? `${result.message}. Choose which locators belong in the page object.`
            : result.message,
        );
        return Boolean(capturedPage);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Locator discovery could not start.");
        return false;
      } finally {
        setBusyAction(null);
      }
    },
    [
      authenticationMode,
      locatorCaptureScope,
      locatorCoverage,
      locatorMaxElements,
      locatorMaxPages,
      locatorMode,
      locatorSafety,
      locatorTaskContext,
      locatorNavigateUrl,
      normalizedCdpEndpoint,
      normalizedMaxDurationSeconds,
      normalizedMaxStates,
      normalizedTarget,
      props.projectId,
    ],
  );

  const deleteLocatorPage = useCallback(
    async (pageId?: string) => {
      const page =
        locatorLibrary?.pages.find((candidate) => candidate.id === pageId) ?? selectedLocatorPage;
      if (!page) return;
      const confirmed = await confirm(
        `Delete the ${page.name} page and its ${page.entries.length} saved locator${page.entries.length === 1 ? "" : "s"}? This does not delete any repository files.`,
      );
      if (!confirmed) return;
      setBusyAction("locator-page");
      try {
        const library = await ensureNativeApi().testing.deleteLocatorPage({
          projectId: props.projectId,
          pageId: page.id,
        });
        setLocatorLibrary(library);
        setSelectedLocatorPageId(library.pages[0]?.id ?? null);
        setSelectedLocatorEntryIds(new Set());
        setLocatorRepositoryProposal(null);
        setMessage(`Deleted ${page.name} and its saved locators.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not delete this locator page.");
      } finally {
        setBusyAction(null);
      }
    },
    [confirm, locatorLibrary?.pages, props.projectId, selectedLocatorPage],
  );

  const rescanLocatorPage = useCallback(
    async (pageId?: string) => {
      const page =
        locatorLibrary?.pages.find((candidate) => candidate.id === pageId) ?? selectedLocatorPage;
      if (!page) return;
      const rescanUrl = page.urlPattern.trim();
      if (!rescanUrl || rescanUrl.includes("<")) {
        setMessage("Open the saved page in the preview before rescanning it.");
        return;
      }
      const confirmed = await confirm(
        `Rescan ${page.name}? Its current saved locators will be replaced with a fresh capture. Repository files will not be changed.`,
      );
      if (!confirmed) return;
      setBusyAction("locator-page");
      try {
        const api = ensureNativeApi().testing;
        if (locatorSession?.status === "running") {
          setLocatorSession(
            await api.finishLocatorDiscovery({
              projectId: props.projectId,
              sessionId: locatorSession.id,
            }),
          );
        }
        if (window.desktopBridge) {
          await window.desktopBridge.navigateBrowserSession({
            projectId: props.projectId,
            sessionId: `testing:${props.projectId}`,
            url: rescanUrl,
          });
        }
        setLocatorRepositoryProposal(null);
        setTargetUrl(rescanUrl);
        setLocatorNavigateUrl(rescanUrl);
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Could not prepare this page for a fresh scan.",
        );
        setBusyAction(null);
        return;
      }
      setBusyAction(null);
      await startLocatorDiscovery(rescanUrl);
    },
    [
      locatorLibrary?.pages,
      confirm,
      locatorSession,
      props.projectId,
      selectedLocatorPage,
      startLocatorDiscovery,
    ],
  );

  const navigateLocatorDiscovery = useCallback(
    async (url?: string) => {
      if (!(url ?? locatorNavigateUrl).trim()) return;
      setBusyAction("locator-capture");
      try {
        const target = normalizeLocatorUrl(url ?? locatorNavigateUrl);
        if (window.desktopBridge) {
          await window.desktopBridge.ensureBrowserSession({
            projectId: props.projectId,
            sessionId: `testing:${props.projectId}`,
            initialUrl: target,
          });
          await window.desktopBridge.navigateBrowserSession({
            projectId: props.projectId,
            sessionId: `testing:${props.projectId}`,
            url: target,
          });
          setLocatorNavigateUrl(target);
          setTargetUrl(target);
          setMessage("Page opened. Scan controls to choose locators from this page.");
          return;
        }
        if (!locatorSession || locatorSession.status !== "running") {
          setLocatorNavigateUrl(target);
          setTargetUrl(target);
          return;
        }
        const result = await ensureNativeApi().testing.navigateLocatorDiscovery({
          projectId: props.projectId,
          sessionId: locatorSession.id,
          targetUrl: target,
        });
        setLocatorSession(result);
        setLocatorLibrary(result.library);
        setLocatorNavigateUrl(target);
        setSelectedLocatorPageId(locatorPageForCapture(result)?.id ?? null);
        setSelectedLocatorEntryIds(new Set());
        setMessage(result.message);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not navigate discovery.");
      } finally {
        setBusyAction(null);
      }
    },
    [locatorNavigateUrl, locatorSession, props.projectId, setTargetUrl],
  );

  const captureLocatorPage = useCallback(
    async (captureMode: "relevant" | "page" | "all" = "all"): Promise<boolean> => {
      if (!locatorSession) return false;
      setBusyAction("locator-capture");
      try {
        const api = ensureNativeApi().testing;
        let result = locatorSession;
        const previewSnapshot =
          previewLocatorSessionId.current === locatorSession.id
            ? await captureTestingPreview(props.projectId)
            : undefined;
        const previewUrl = locatorNavigateUrl.trim();
        if (
          !previewSnapshot &&
          previewUrl &&
          !isSameWebUrl(previewUrl, locatorSession.currentUrl)
        ) {
          result = await api.navigateLocatorDiscovery({
            projectId: props.projectId,
            sessionId: locatorSession.id,
            targetUrl: previewUrl,
          });
        }
        if (
          previewSnapshot ||
          result.mode !== "guided" ||
          isSameWebUrl(result.currentUrl, locatorSession.currentUrl)
        ) {
          result = await api.captureLocatorPage({
            projectId: props.projectId,
            sessionId: locatorSession.id,
            captureMode,
            ...(previewSnapshot ? { previewSnapshot } : {}),
          });
        }
        setLocatorSession(result);
        setLocatorLibrary(result.library);
        const capturedPage = locatorPageForCapture(result);
        setLocatorNavigateUrl(previewSnapshot?.url ?? previewUrl);
        setSelectedLocatorPageId(capturedPage?.id ?? null);
        setSelectedLocatorEntryIds(new Set());
        if (capturedPage) {
          setSelectedLocatorPageId(capturedPage.id);
          setSelectedLocatorEntryIds(
            new Set(
              capturedPage.entries
                .filter(
                  (entry) =>
                    entry.lifecycleStatus !== "archived" &&
                    entry.lifecycleStatus !== "manual-required",
                )
                .map((entry) => entry.id),
            ),
          );
        }
        setMessage(
          capturedPage
            ? `${result.message}. Review the selection before adding them to code.`
            : result.message,
        );
        return Boolean(capturedPage);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not capture this page.");
        return false;
      } finally {
        setBusyAction(null);
      }
    },
    [locatorNavigateUrl, locatorSession, props.projectId],
  );

  const finishLocatorDiscovery = useCallback(
    async (cancel: boolean) => {
      if (!locatorSession) return;
      setBusyAction("locator-capture");
      try {
        const api = ensureNativeApi().testing;
        const result = cancel
          ? await api.cancelLocatorDiscovery({
              projectId: props.projectId,
              sessionId: locatorSession.id,
            })
          : await api.finishLocatorDiscovery({
              projectId: props.projectId,
              sessionId: locatorSession.id,
            });
        setLocatorSession(result);
        setLocatorLibrary(result.library);
        setMessage(result.message);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not finish locator discovery.");
      } finally {
        setBusyAction(null);
      }
    },
    [locatorSession, props.projectId],
  );

  const indexLocatorFolder = useCallback(
    async (storageMode: TestingLocatorStorageMode = locatorStorageMode) => {
      const folderPath = await ensureNativeApi().dialogs.pickFolder();
      if (!folderPath) return;
      setBusyAction("locator-index");
      setMessage("Statically indexing locator files. Repository code will not be executed.");
      try {
        const result = await ensureNativeApi().testing.indexLocatorFolder({
          projectId: props.projectId,
          projectPath: props.projectPath,
          folderPath,
          storageMode,
        });
        setLocatorFolderResult(result);
        setLocatorLibrary(result.library);
        setLocatorSyncPreview(
          await ensureNativeApi().testing.previewLocatorSync({ projectId: props.projectId }),
        );
        setMessage(
          `Indexed ${result.filesScanned} supported files without executing repository code.`,
        );
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not index the locator folder.");
      } finally {
        setBusyAction(null);
      }
    },
    [locatorStorageMode, props.projectId, props.projectPath],
  );

  const reviewLocator = useCallback(
    async (
      entryId: string,
      decision: "accept" | "archive" | "keep-managed" | "restore",
      locatorKey?: string,
    ) => {
      try {
        const result = await ensureNativeApi().testing.reviewLocatorEntry({
          projectId: props.projectId,
          entryId,
          decision,
          ...(locatorKey?.trim() ? { locatorKey: locatorKey.trim() } : {}),
        });
        setLocatorLibrary(result);
        setEditingLocatorId(null);
        setLocatorPendingRemoveId(null);
        setMessage(
          decision === "archive"
            ? "Locator removed from active use. You can restore it from the Archived filter."
            : decision === "restore"
              ? "Locator restored as a draft for review."
              : "Locator review decision saved locally.",
        );
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not review the locator.");
      }
    },
    [props.projectId],
  );

  const startEditingLocator = useCallback((entry: TestingLocatorEntry) => {
    setEditingLocatorId(entry.id);
    setEditingLocatorKey(entry.locatorKey);
    setEditingLocatorClassification(entry.classification);
    setEditingLocatorStrategy(entry.strategy);
    setEditingLocatorArguments(JSON.stringify(entry.arguments, null, 2));
    setEditingLocatorContext(entry.semanticContext);
  }, []);

  const saveLocatorChanges = useCallback(async () => {
    if (!editingLocatorId) return;
    let locatorArguments: Record<string, string | number | boolean>;
    try {
      const parsed = JSON.parse(editingLocatorArguments) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Locator arguments must be a JSON object.");
      }
      locatorArguments = Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => {
          if (!["string", "number", "boolean"].includes(typeof value)) {
            throw new Error(`Argument ${key} must be text, a number, or true/false.`);
          }
          return [key, value as string | number | boolean];
        }),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Locator arguments are not valid JSON.");
      return;
    }
    setBusyAction("locator-review");
    try {
      const result = await ensureNativeApi().testing.reviewLocatorEntry({
        projectId: props.projectId,
        entryId: editingLocatorId,
        decision: "accept",
        locatorKey: editingLocatorKey.trim(),
        classification: editingLocatorClassification,
        strategy: editingLocatorStrategy,
        arguments: locatorArguments,
        semanticContext: editingLocatorContext.trim(),
      });
      setLocatorLibrary(result);
      setEditingLocatorId(null);
      setLocatorRepositoryProposal(null);
      setMessage("Locator saved as a new version and added to the managed page object.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update the locator.");
    } finally {
      setBusyAction(null);
    }
  }, [
    editingLocatorArguments,
    editingLocatorClassification,
    editingLocatorContext,
    editingLocatorId,
    editingLocatorKey,
    editingLocatorStrategy,
    props.projectId,
  ]);

  const saveLocatorPageName = useCallback(async () => {
    if (!selectedLocatorPage || !locatorPageName.trim()) return;
    setBusyAction("locator-page");
    try {
      const library = await ensureNativeApi().testing.updateLocatorPage({
        projectId: props.projectId,
        pageId: selectedLocatorPage.id,
        name: locatorPageName.trim(),
      });
      setLocatorLibrary(library);
      setLocatorRepositoryProposal(null);
      setMessage("Page name saved. Its managed page object was regenerated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not rename this page.");
    } finally {
      setBusyAction(null);
    }
  }, [locatorPageName, props.projectId, selectedLocatorPage]);

  const saveLocatorCodeSelection = useCallback(async () => {
    if (!selectedLocatorPage) return;
    setBusyAction("locator-page");
    try {
      const library = await ensureNativeApi().testing.setLocatorPageSelection({
        projectId: props.projectId,
        pageId: selectedLocatorPage.id,
        entryIds: [...locatorCodeEntryIds],
      });
      setLocatorLibrary(library);
      setLocatorRepositoryProposal(null);
      setLocatorPageTab("code");
      setMessage(
        `Page object regenerated with ${locatorCodeEntryIds.size} selected locator${locatorCodeEntryIds.size === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update the page object.");
    } finally {
      setBusyAction(null);
    }
  }, [locatorCodeEntryIds, props.projectId, selectedLocatorPage]);

  const savePageObjectCode = useCallback(async () => {
    if (!selectedLocatorPage?.pageObject) return;
    setBusyAction("locator-code");
    try {
      const library = await ensureNativeApi().testing.updatePageObjectCode({
        projectId: props.projectId,
        pageId: selectedLocatorPage.id,
        expectedSourceHash: selectedLocatorPage.pageObject.sourceHash,
        code: locatorCodeDraft,
      });
      setLocatorLibrary(library);
      setLocatorRepositoryProposal(null);
      setLocatorCodeEditing(false);
      setMessage("Edited page-object code saved as a new local version.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the edited page object.");
    } finally {
      setBusyAction(null);
    }
  }, [locatorCodeDraft, props.projectId, selectedLocatorPage]);

  const chooseLocatorRepositoryFolder = useCallback(async () => {
    const folder = await ensureNativeApi().dialogs.pickFolder();
    if (!folder) return;
    setLocatorRepositoryFolder(folder);
    setLocatorRepositoryProposal(null);
  }, []);

  const previewLocatorRepositoryChange = useCallback(async () => {
    if (!selectedLocatorPage || !locatorRepositoryFolder || !locatorRepositoryFileName.trim()) {
      setMessage("Choose a repository folder and TypeScript filename first.");
      return;
    }
    setBusyAction("locator-repository");
    try {
      const proposal = await ensureNativeApi().testing.previewLocatorRepositoryWrite({
        projectId: props.projectId,
        projectPath: props.projectPath,
        pageId: selectedLocatorPage.id,
        destinationFolder: locatorRepositoryFolder,
        fileName: locatorRepositoryFileName.trim(),
      });
      setLocatorRepositoryProposal(proposal);
      setMessage(
        proposal.changeKind === "unchanged"
          ? "The repository file already matches this page object."
          : `Review the ${proposal.changeKind} proposal before applying it.`,
      );
    } catch (error) {
      setLocatorRepositoryProposal(null);
      setMessage(error instanceof Error ? error.message : "Could not prepare the repository diff.");
    } finally {
      setBusyAction(null);
    }
  }, [
    locatorRepositoryFileName,
    locatorRepositoryFolder,
    props.projectId,
    props.projectPath,
    selectedLocatorPage,
  ]);

  const applyLocatorRepositoryChange = useCallback(async () => {
    if (!selectedLocatorPage || !locatorRepositoryProposal) return;
    setBusyAction("locator-repository");
    try {
      const result = await ensureNativeApi().testing.applyLocatorRepositoryWrite({
        projectId: props.projectId,
        projectPath: props.projectPath,
        pageId: selectedLocatorPage.id,
        destinationFolder: locatorRepositoryFolder,
        fileName: locatorRepositoryFileName.trim(),
        expectedArtifactSourceHash: locatorRepositoryProposal.artifactSourceHash,
        expectedDestinationSourceHash: locatorRepositoryProposal.destinationSourceHash,
      });
      setLocatorLibrary(result.library);
      setLocatorRepositoryProposal(result.proposal);
      setLocatorRepositoryConfirmOpen(false);
      setMessage(`Applied the reviewed page object to ${result.proposal.relativePath}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not apply the repository change.");
    } finally {
      setBusyAction(null);
    }
  }, [
    locatorRepositoryFileName,
    locatorRepositoryFolder,
    locatorRepositoryProposal,
    props.projectId,
    props.projectPath,
    selectedLocatorPage,
  ]);

  const approveSelectedLocators = useCallback(async () => {
    if (!selectedLocatorPage) return;
    const selectedEntryIds = selectedLocatorPage.entries
      .filter(
        (entry) =>
          selectedLocatorEntryIds.has(entry.id) &&
          entry.lifecycleStatus !== "archived" &&
          entry.lifecycleStatus !== "manual-required",
      )
      .map((entry) => entry.id);
    if (selectedEntryIds.length === 0) {
      setMessage("Select at least one locator to include in this page object.");
      return;
    }
    const entriesToApprove = selectedLocatorPage.entries.filter(
      (entry) => selectedEntryIds.includes(entry.id) && entry.lifecycleStatus !== "accepted",
    );
    setBusyAction("locator-review");
    try {
      const api = ensureNativeApi().testing;
      const prepareRepositoryProposal =
        locatorStorageMode === "connected-repository" || locatorFolderResult !== null;
      for (const entry of entriesToApprove) {
        await api.reviewLocatorEntry({
          projectId: props.projectId,
          entryId: entry.id,
          decision: prepareRepositoryProposal ? "keep-managed" : "accept",
        });
      }
      const library = await api.setLocatorPageSelection({
        projectId: props.projectId,
        pageId: selectedLocatorPage.id,
        entryIds: selectedEntryIds,
      });
      setLocatorLibrary(library);
      setSelectedLocatorEntryIds(new Set());
      setLocatorPageTab("code");
      if (locatorFolderResult || locatorStorageMode === "connected-repository") {
        setLocatorSyncPreview(await api.previewLocatorSync({ projectId: props.projectId }));
      }
      setMessage(
        `${selectedEntryIds.length} locator${selectedEntryIds.length === 1 ? "" : "s"} selected for the page object${entriesToApprove.length ? " and newly approved" : ""}.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not approve the selected locators.",
      );
    } finally {
      setBusyAction(null);
    }
  }, [
    locatorFolderResult,
    locatorLibrary?.pages,
    locatorStorageMode,
    props.projectId,
    selectedLocatorPage,
    selectedLocatorEntryIds,
  ]);

  const resolveLocatorSync = useCallback(
    async (conflictId: string, decision: "keep-managed" | "accept-repository" | "archive") => {
      try {
        const result = await ensureNativeApi().testing.resolveLocatorSync({
          projectId: props.projectId,
          conflictId,
          decision,
        });
        setLocatorSyncPreview(result);
        setLocatorLibrary(result.library);
        setMessage("Synchronization decision saved. No repository file was overwritten.");
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Could not resolve locator synchronization.",
        );
      }
    },
    [props.projectId],
  );

  const disconnectLocatorFolder = useCallback(async () => {
    try {
      const result = await ensureNativeApi().testing.disconnectLocatorFolder({
        projectId: props.projectId,
      });
      setLocatorLibrary(result);
      setLocatorSyncPreview(null);
      setMessage("Locator source disconnected. Imported entries and history were preserved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not disconnect the locator source.",
      );
    }
  }, [props.projectId]);

  const chooseWorkbook = useCallback(async () => {
    const selected = await ensureNativeApi().dialogs.pickFile({
      title: "Choose Excel QA Workbook",
      filters: [
        { name: "Excel Workbooks (*.xlsx, *.xls)", extensions: ["xlsx", "xls", "xlsm", "xlsb"] },
      ],
    });
    if (!selected) return;
    const lower = selected.toLowerCase();
    if (
      !lower.endsWith(".xlsx") &&
      !lower.endsWith(".xls") &&
      !lower.endsWith(".xlsm") &&
      !lower.endsWith(".xlsb")
    ) {
      setMessage("Please select a valid Excel workbook (.xlsx or .xls).");
      return;
    }
    setWorkbookPath(selected);
    setMessage("Workbook selected. Import it to reconcile its cases against the live graph.");
  }, []);

  const importWorkbook = useCallback(
    async (groupName?: string) => {
      if (!workbookPath) return;
      setBusyAction("import");
      setMessage("Parsing the workbook and verifying graph paths against the live target...");
      try {
        const result = await ensureNativeApi().testing.importWorkbook({
          projectId: props.projectId,
          workbookPath,
          ...(groupName?.trim() ? { groupName: groupName.trim() } : {}),
          ...(normalizedTarget ? { targetUrl: normalizedTarget } : {}),
          ...(authenticationMode === "connected-session" && normalizedCdpEndpoint
            ? { cdpEndpoint: normalizedCdpEndpoint }
            : {}),
        });
        setWorkspaceCases(result.cases);
        setCaseGroups(result.groups);
        setMessage(
          `Imported ${result.importedCount} cases: ${result.matchesCount} match, ${result.needsReviewCount} need review, and ${result.blockedCount} are blocked.`,
        );
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Workbook import failed.");
      } finally {
        setBusyAction(null);
      }
    },
    [
      authenticationMode,
      normalizedCdpEndpoint,
      normalizedTarget,
      props.projectId,
      setWorkspaceCases,
      workbookPath,
    ],
  );

  const generateScenarios = useCallback(async () => {
    setBusyAction("generate");
    setMessage("Creating candidate scenarios from reachable graph transitions...");
    try {
      const oldLength = cases.length;
      const result = await ensureNativeApi().testing.generateScenarios({
        projectId: props.projectId,
      });
      setWorkspaceCases(result.cases);
      await refreshTestingWorkspace();

      const newAdded = result.cases.length - oldLength;
      if (newAdded > 0) {
        setMessage(`${newAdded} reachable graph scenarios were added to the review queue.`);
      } else {
        setMessage(
          "No new scenarios were generated. All reachable paths from the graph already exist in the queue.",
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not generate graph scenarios.");
    } finally {
      setBusyAction(null);
    }
  }, [cases.length, props.projectId, refreshTestingWorkspace, setWorkspaceCases]);

  const reviewCase = useCallback(
    async (testCase: TestingCaseSummary, decision: "accepted" | "edited" | "rejected") => {
      setBusyAction("review");
      try {
        const result = await ensureNativeApi().testing.reviewCase({
          projectId: props.projectId,
          caseId: testCase.id,
          decision,
          ...(decision === "edited"
            ? {
                externalId: editedExternalId,
                description: editedDescription,
                steps: editedSteps.map((step) => step.trim()),
                expectedResults: editedExpectedResults,
                expectedResult: editedExpectedResults.filter(Boolean).join("\n"),
                locatorEntryIds: [...editedCaseLocatorIds],
              }
            : {}),
        });
        setWorkspaceCases(result.cases);
        setEditingCaseId(null);
        setMessage(`Case ${testCase.externalId} was ${decision}.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not save the review decision.");
      } finally {
        setBusyAction(null);
      }
    },
    [
      editedCaseLocatorIds,
      editedDescription,
      editedExpectedResults,
      editedExternalId,
      editedSteps,
      props.projectId,
      setWorkspaceCases,
    ],
  );

  const deleteCase = useCallback(
    async (testCase: TestingCaseSummary) => {
      const confirmed = await ensureNativeApi().dialogs.confirm(
        `Delete ${testCase.externalId}? This permanently removes the test case and its locator mappings.`,
      );
      if (!confirmed) return;
      setBusyAction("review");
      try {
        const result = await ensureNativeApi().testing.deleteCase({
          projectId: props.projectId,
          caseId: testCase.id,
        });
        setWorkspaceCases(result.cases);
        setSelectedCaseId(result.cases[0]?.id ?? null);
        setEditingCaseId(null);
        setMessage(`Deleted ${testCase.externalId}.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not delete this test case.");
      } finally {
        setBusyAction(null);
      }
    },
    [props.projectId, setWorkspaceCases],
  );

  const updateCaseGroup = useCallback(
    async (testCase: TestingCaseSummary, groupName: string) => {
      setBusyAction("review");
      try {
        const result = await ensureNativeApi().testing.updateCaseGroup({
          projectId: props.projectId,
          caseId: testCase.id,
          groupName,
        });
        setWorkspaceCases(result.cases);
        setCaseGroups(result.groups);
        setMessage(`${testCase.externalId} moved to ${groupName.trim() || "Ungrouped"}.`);
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Could not update the test case group.",
        );
      } finally {
        setBusyAction(null);
      }
    },
    [props.projectId, setWorkspaceCases],
  );

  const createCaseGroup = useCallback(
    async (groupName: string) => {
      setBusyAction("review");
      try {
        const result = await ensureNativeApi().testing.createCaseGroup({
          projectId: props.projectId,
          groupName,
        });
        setWorkspaceCases(result.cases);
        setCaseGroups(result.groups);
        setMessage(`${groupName.trim()} folder created.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not create the test group.");
      } finally {
        setBusyAction(null);
      }
    },
    [props.projectId, setWorkspaceCases],
  );

  const deleteCaseGroup = useCallback(
    async (groupName: string) => {
      const groupedCaseCount = cases.filter((testCase) => testCase.groupName === groupName).length;
      const confirmed = await ensureNativeApi().dialogs.confirm(
        groupedCaseCount > 0
          ? `Delete the “${groupName}” folder? Its ${groupedCaseCount} test case${groupedCaseCount === 1 ? "" : "s"} will move to Ungrouped.`
          : `Delete the empty “${groupName}” folder?`,
      );
      if (!confirmed) return;
      setBusyAction("review");
      try {
        const result = await ensureNativeApi().testing.deleteCaseGroup({
          projectId: props.projectId,
          groupName,
        });
        setWorkspaceCases(result.cases);
        setCaseGroups(result.groups);
        setMessage(`${groupName} folder deleted.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not delete the test group.");
      } finally {
        setBusyAction(null);
      }
    },
    [cases, props.projectId, setWorkspaceCases],
  );

  const beginEditCase = useCallback((testCase: TestingCaseSummary) => {
    setEditingCaseId(testCase.id);
    setEditedExternalId(testCase.externalId);
    setEditedDescription(testCase.description);
    setEditedSteps(testCase.steps);
    setEditedExpectedResults(testCase.expectedResults);
    setEditedCaseLocatorIds(new Set(testCase.locatorEntryIds ?? []));
  }, []);

  const updateEditedStep = useCallback((index: number, value: string) => {
    setEditedSteps((current) =>
      current.map((step, stepIndex) => (stepIndex === index ? value : step)),
    );
  }, []);

  const moveEditedStep = useCallback((index: number, direction: -1 | 1) => {
    setEditedSteps((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }, []);

  const saveCaseIdPolicy = useCallback(async () => {
    const padding = Number(caseIdPadding);
    const nextSequence = Number(caseIdNext);
    if (
      !Number.isSafeInteger(padding) ||
      padding < 1 ||
      padding > 12 ||
      !Number.isSafeInteger(nextSequence) ||
      nextSequence < 1
    ) {
      setMessage("Case ID width must be 1-12 and the next number must be at least 1.");
      return;
    }
    try {
      const policy = await ensureNativeApi().testing.setCaseIdPolicy({
        projectId: props.projectId,
        prefix: caseIdPrefix,
        padding,
        nextSequence,
      });
      setCaseIdPolicy(policy);
      setMessage(`New generated cases will start at ${policy.example}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the Case ID format.");
    }
  }, [caseIdNext, caseIdPadding, caseIdPrefix, props.projectId]);

  const clearGraph = useCallback(async () => {
    const confirmed = await ensureNativeApi().dialogs.confirm(
      "Clear the stored state graph and its cached/tokenized crawl data? Imported test cases and the local login profile are preserved.",
    );
    if (!confirmed) return;
    setBusyAction("clear");
    try {
      const result = await ensureNativeApi().testing.clearGraph({ projectId: props.projectId });
      setStatus(result);
      setMessage(
        `Cleared ${result.clearedNodeCount} states and ${result.clearedEdgeCount} transitions. Imported cases and authentication were preserved.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not clear the stored graph.");
    } finally {
      setBusyAction(null);
    }
  }, [props.projectId]);

  const generateTests = useCallback(
    async (failureRunId?: string, engine: "standard" | "official-playwright" = "standard") => {
      const selectedCaseIds = failureRunId
        ? (executionRuns
            .find((run) => run.id === failureRunId)
            ?.results.filter((result) => result.status === "failed" || result.status === "blocked")
            .map((result) => result.caseId) ?? [])
        : [...selectedGenerationCaseIds];
      const maxCasesValue = Number(generationMaxCases);
      const maxTokensValue = Number(generationMaxTokens);
      const maxCostValue = Number(generationMaxCost);
      if (
        !Number.isSafeInteger(maxCasesValue) ||
        maxCasesValue < 1 ||
        !Number.isSafeInteger(maxTokensValue) ||
        maxTokensValue < 1 ||
        !Number.isFinite(maxCostValue) ||
        maxCostValue <= 0
      ) {
        setMessage("Enter positive generation limits.");
        return;
      }
      if (selectedCaseIds.length === 0) {
        setMessage("Select at least one reviewed case to build.");
        return;
      }
      setBusyAction("generate-tests");
      setMessage("Generating Playwright tests from reviewed graph paths...");
      try {
        const job = await ensureNativeApi().testing.generateTests({
          projectId: props.projectId,
          projectPath: props.projectPath,
          caseIds: selectedCaseIds,
          ...(failureRunId ? { failureRunId } : {}),
          engine,
          ...(normalizedTarget ? { targetUrl: normalizedTarget } : {}),
          ...(authenticationMode === "connected-session" && normalizedCdpEndpoint
            ? { cdpEndpoint: normalizedCdpEndpoint }
            : {}),
          framework: "playwright-ts",
          modelSelection: generationModelSelection,
          reasoningTier: generationReasoning,
          outputMode: failureRunId ? "managed" : generationOutputMode,
          ...(generationOutputMode === "repository"
            ? { repositoryOutputPath: repositoryOutputPath.trim() || "tests/e2e/generated" }
            : {}),
          ...(templatePath.trim() ? { templatePath: templatePath.trim() } : {}),
          captureReplay,
          maxCases: maxCasesValue,
          maxEstimatedTokens: maxTokensValue,
          maxEstimatedCostUsd: maxCostValue,
        });
        await refreshGenerationJobs();
        setMessage(
          job.status === "queued" || job.status === "running"
            ? `Playwright generation started. Output will be written to ${job.outputDirectory}.`
            : job.status === "completed"
              ? `Generated ${job.completedCases} Playwright test case${job.completedCases === 1 ? "" : "s"} in ${job.outputDirectory}.`
              : `Generation stopped with status ${job.status}${job.error ? `: ${job.error}` : "."}`,
        );
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Test generation failed.");
        await refreshGenerationJobs().catch(() => undefined);
      } finally {
        setBusyAction(null);
      }
    },
    [
      authenticationMode,
      captureReplay,
      generationMaxCases,
      executionRuns,
      generationMaxCost,
      generationMaxTokens,
      generationModelSelection,
      generationOutputMode,
      generationReasoning,
      normalizedCdpEndpoint,
      normalizedTarget,
      props.projectId,
      props.projectPath,
      refreshGenerationJobs,
      repositoryOutputPath,
      selectedGenerationCaseIds,
      templatePath,
    ],
  );

  const cancelGeneration = useCallback(
    async (jobId: string) => {
      setBusyAction("cancel-generation");
      try {
        await ensureNativeApi().testing.cancelGenerationJob({ projectId: props.projectId, jobId });
        await refreshGenerationJobs();
        setMessage("Generation cancellation requested.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not cancel generation.");
      } finally {
        setBusyAction(null);
      }
    },
    [props.projectId, refreshGenerationJobs],
  );

  const runGeneratedTests = useCallback(
    async (caseIds?: ReadonlyArray<string>, concurrency = 1) => {
      const job = generationJobs.find((candidate) => candidate.status === "completed");
      if (!job || !normalizedTarget) return;
      setBusyAction("run-tests");
      const runCount = caseIds?.length ?? job.totalCases;
      setMessage(
        `Running ${runCount} generated ${runCount === 1 ? "case" : "cases"} in ${executionMode} mode...`,
      );
      try {
        const run = await ensureNativeApi().testing.runTests({
          projectId: props.projectId,
          generationJobId: job.id,
          targetUrl: normalizedTarget,
          mode: executionMode,
          concurrency,
          ...(caseIds ? { caseIds: [...caseIds] } : {}),
          visualComparison,
        });
        await Promise.all([refreshExecution(), refreshCases()]);
        setMessage(
          `Run ${run.status}: ${run.results.filter((result) => result.status === "passed").length} passed, ${run.results.filter((result) => result.status === "failed").length} failed, ${run.results.filter((result) => result.status === "blocked").length} blocked in ${(run.durationMs / 1000).toFixed(1)} seconds.`,
        );
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Generated test execution failed.");
        await refreshExecution().catch(() => undefined);
      } finally {
        setBusyAction(null);
      }
    },
    [
      executionMode,
      generationJobs,
      normalizedTarget,
      props.projectId,
      refreshCases,
      refreshExecution,
      visualComparison,
    ],
  );

  const decideHealing = useCallback(
    async (proposalId: string, decision: "accepted" | "rejected") => {
      setBusyAction("healing-decision");
      try {
        const result = await ensureNativeApi().testing.decideHealingProposal({
          projectId: props.projectId,
          proposalId,
          decision,
        });
        setExecutionRuns(result.runs);
        setMessage(
          decision === "accepted"
            ? "Healing proposal accepted for the next generated revision; source was not silently rewritten."
            : "Healing proposal rejected and retained in the audit trail.",
        );
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Could not record the healing decision.",
        );
      } finally {
        setBusyAction(null);
      }
    },
    [props.projectId],
  );

  const createTestingSchedule = useCallback(async () => {
    const job = generationJobs.find((candidate) => candidate.status === "completed");
    if (!job || !normalizedTarget || !scheduleTime) return;
    setBusyAction("schedule");
    try {
      await ensureNativeApi().testing.createSchedule({
        projectId: props.projectId,
        generationJobId: job.id,
        targetUrl: normalizedTarget,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        runAt: new Date(scheduleTime).toISOString(),
        recurrence: "none",
      });
      await refreshExecution();
      setMessage("Local one-off run scheduled. Its timezone and next run remain visible here.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create the schedule.");
    } finally {
      setBusyAction(null);
    }
  }, [generationJobs, normalizedTarget, props.projectId, refreshExecution, scheduleTime]);

  const generateSignoffReport = useCallback(async () => {
    const run = executionRuns.find(
      (candidate) => candidate.mode === "standalone" && candidate.completedAt,
    );
    if (!run || !testerName.trim()) return;
    setBusyAction("report");
    try {
      const report = await ensureNativeApi().testing.generateReport({
        projectId: props.projectId,
        runId: run.id,
        testerName: testerName.trim(),
        environmentLabel: normalizedTarget ?? "Configured target",
        buildLabel: run.artifactRevision,
      });
      setReportPaths({ docxPath: report.docxPath, pdfPath: report.pdfPath });
      setMessage("Word and PDF sign-off reports were generated from persisted run evidence.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not generate the sign-off report.",
      );
    } finally {
      setBusyAction(null);
    }
  }, [executionRuns, normalizedTarget, props.projectId, testerName]);

  const resolveTraceability = useCallback(async () => {
    if (!traceCaseId.trim()) return;
    setBusyAction("trace");
    try {
      const result = await ensureNativeApi().testing.getTraceability({
        projectId: props.projectId,
        externalId: traceCaseId.trim(),
      });
      setTraceability(result);
      setMessage(`Resolved ${result.case.externalId} through generation and execution evidence.`);
    } catch (error) {
      setTraceability(null);
      setMessage(error instanceof Error ? error.message : "Case traceability lookup failed.");
    } finally {
      setBusyAction(null);
    }
  }, [props.projectId, traceCaseId]);

  const draftFailedCaseBug = useCallback(
    async (run: TestingExecutionRun, caseId: string) => {
      setBusyAction("bug-draft");
      try {
        const draft = await ensureNativeApi().testing.draftBug({
          projectId: props.projectId,
          runId: run.id,
          caseId,
        });
        setBugDraft(draft.markdown);
        setMessage("Local bug draft created. Nothing was filed or transmitted.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not draft the bug.");
      } finally {
        setBusyAction(null);
      }
    },
    [props.projectId],
  );

  const triageFailedCase = useCallback(
    async (run: TestingExecutionRun, caseId: string) => {
      setBusyAction("triage");
      try {
        const result = await ensureNativeApi().testing.triageFailure({
          projectId: props.projectId,
          projectPath: props.projectPath,
          runId: run.id,
          caseId,
          modelSelection: generationModelSelection,
        });
        setTriageResult(
          `${result.classification}: ${result.inference}\n\nObserved facts:\n${result.observedFacts.map((fact) => `- ${fact}`).join("\n")}\n\nRecommendation: ${result.recommendation}`,
        );
        setMessage(
          "Coding-agent triage completed. Its inference is shown separately from observed facts.",
        );
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not triage the failed CI case.");
      } finally {
        setBusyAction(null);
      }
    },
    [generationModelSelection, props.projectId, props.projectPath],
  );

  const recommendedTestingSection: TestingWorkspaceSection = useMemo(() => {
    return (status?.nodeCount ?? 0) === 0
      ? "discover"
      : cases.length === 0 || reviewCaseCount > 0
        ? "cases"
        : !completedGenerationJob
          ? "automate"
          : executionRuns.length === 0
            ? "runs"
            : "reports";
  }, [
    cases.length,
    completedGenerationJob,
    executionRuns.length,
    reviewCaseCount,
    status?.nodeCount,
  ]);

  const testingSections: ReadonlyArray<{
    id: TestingWorkspaceSection;
    label: string;
    description: string;
    count?: number;
  }> = useMemo(
    () => [
      { id: "overview", label: "Home", description: "Choose where to begin" },
      {
        id: "discover",
        label: "App & locators",
        description: "Open a page and capture controls",
        count: status?.nodeCount ?? 0,
      },
      {
        id: "cases",
        label: "Test cases",
        description: "Import, edit, and map steps",
        count: cases.length,
      },
      {
        id: "automate",
        label: "Build tests",
        description: "Generate maintainable code",
        count: completedGenerationJob?.artifacts.length ?? 0,
      },
      {
        id: "runs",
        label: "Test runs",
        description: "Run tests and inspect failures",
        count: executionRuns.length,
      },
      { id: "reports", label: "Reports", description: "Export results and trace a test" },
    ],
    [
      cases.length,
      completedGenerationJob?.artifacts.length,
      executionRuns.length,
      status?.nodeCount,
    ],
  );

  const contextValue: TestingDataContextValue = useMemo(
    () => ({
      cases,
      caseGroups,
      locatorLibrary,
      generationJobs,
      executionRuns,
      testingSchedules,
      status,
      caseIdPolicy,
      testInventory,
      traceability,
      graphExplorer,
      locatorSession,
      locatorFolderResult,
      locatorSyncPreview,
      locatorRepositoryProposal,
      reportPaths,
      bugDraft,
      triageResult,
      message,
      filteredCases,
      selectedCase,
      acceptedCaseCount,
      reviewCaseCount,
      blockedCaseCount,
      readyCases,
      completedGenerationJob,
      latestExecutionRun,
      projectId: props.projectId,
      projectPath: props.projectPath,
      busyAction,
      setBusyAction,
      message_setter: setMessage,
      caseSearch,
      setCaseSearch,
      caseFilter,
      setCaseFilter,
      selectedCaseId,
      setSelectedCaseId,
      editingCaseId,
      setEditingCaseId,
      editedExternalId,
      setEditedExternalId,
      editedDescription,
      setEditedDescription,
      editedSteps,
      setEditedSteps,
      editedExpectedResults,
      setEditedExpectedResults,
      editedCaseLocatorIds,
      setEditedCaseLocatorIds,
      implementedInventoryOpen,
      setImplementedInventoryOpen,
      testInventoryView,
      setTestInventoryView,
      expandedTestNodes,
      setExpandedTestNodes,
      selectedTestNodeId,
      setSelectedTestNodeId,
      flattenedTestInventory,
      workbookPath,
      caseIntakeMode,
      setCaseIntakeMode,
      manualCaseId,
      setManualCaseId,
      manualCaseDescription,
      setManualCaseDescription,
      manualCaseSteps,
      setManualCaseSteps,
      manualCaseExpectedResults,
      setManualCaseExpectedResults,
      manualCaseLocatorIds,
      setManualCaseLocatorIds,
      storyText,
      setStoryText,
      storyFilePath,
      setStoryFilePath,
      caseIdPrefix,
      setCaseIdPrefix,
      caseIdPadding,
      setCaseIdPadding,
      caseIdNext,
      setCaseIdNext,
      selectedLocatorPageId,
      setSelectedLocatorPageId,
      selectedLocatorPage,
      locatorSearch,
      setLocatorSearch,
      locatorFilter,
      setLocatorFilter,
      locatorCodeEntryIds,
      setLocatorCodeEntryIds,
      filteredLocatorEntries,
      selectedLocatorEntryIds,
      setSelectedLocatorEntryIds,
      editingLocatorEntry,
      pendingRemoveLocator,
      editingLocatorKey,
      setEditingLocatorKey,
      editingLocatorClassification,
      setEditingLocatorClassification,
      editingLocatorStrategy,
      setEditingLocatorStrategy,
      editingLocatorArguments,
      setEditingLocatorArguments,
      editingLocatorContext,
      setEditingLocatorContext,
      setEditingLocatorId,
      setLocatorPendingRemoveId,
      locatorPageTab,
      setLocatorPageTab,
      locatorPageName,
      setLocatorPageName,
      locatorCodeEditing,
      setLocatorCodeEditing,
      locatorCodeDraft,
      setLocatorCodeDraft,
      locatorRepositoryFolder,
      setLocatorRepositoryFolder,
      locatorRepositoryFileName,
      setLocatorRepositoryFileName,
      setLocatorRepositoryProposal,
      locatorRepositoryConfirmOpen,
      setLocatorRepositoryConfirmOpen,
      locatorMode,
      setLocatorMode,
      locatorCoverage,
      setLocatorCoverage,
      locatorSafety,
      setLocatorSafety,
      locatorMaxElements,
      setLocatorMaxElements,
      locatorMaxPages,
      setLocatorMaxPages,
      locatorNavigateUrl,
      setLocatorNavigateUrl,
      locatorStorageMode,
      setLocatorStorageMode,
      locatorCaptureScope,
      setLocatorCaptureScope,
      locatorTaskContext,
      setLocatorTaskContext,
      locatorAdvancedOpen,
      setLocatorAdvancedOpen,
      locatorViewport,
      setLocatorViewport,
      locatorPreviewExpanded,
      setLocatorPreviewExpanded,
      locatorPreviewFocusButtonRef,
      generationModelSelection,
      generationFusionProvider,
      generationReasoning,
      generationOutputMode,
      setGenerationOutputMode,
      repositoryOutputPath,
      setRepositoryOutputPath,
      templatePath,
      setTemplatePath,
      captureReplay,
      setCaptureReplay,
      generationMaxCases,
      setGenerationMaxCases,
      generationMaxTokens,
      setGenerationMaxTokens,
      generationMaxCost,
      setGenerationMaxCost,
      selectedGenerationCaseIds,
      setSelectedGenerationCaseIds,
      executionMode,
      setExecutionMode,
      visualComparison,
      setVisualComparison,
      scheduleTime,
      setScheduleTime,
      testerName,
      setTesterName,
      traceCaseId,
      setTraceCaseId,
      targetUrl,
      setTargetUrl,
      normalizedTarget,
      cdpEndpoint,
      setCdpEndpoint,
      normalizedCdpEndpoint,
      explorationScope,
      setExplorationScope,
      authenticationMode,
      setAuthenticationMode,
      authCaptureOpen,
      authenticationReady,
      maxStates,
      setMaxStates,
      normalizedMaxStates,
      maxDurationMinutes,
      setMaxDurationMinutes,
      normalizedMaxDurationSeconds,
      refreshStatus,
      refreshLocatorLibrary,
      refreshCases,
      refreshGenerationJobs,
      refreshExecution,
      refreshGraphExplorer,
      refreshTestingWorkspace,
      setWorkspaceCases,
      startAuthCapture,
      finishAuthCapture,
      startExploration,
      setDiscoveryExperience,
      clearGraph,
      startLocatorDiscovery,
      navigateLocatorDiscovery,
      captureLocatorPage,
      finishLocatorDiscovery,
      rescanLocatorPage,
      deleteLocatorPage,
      indexLocatorFolder,
      approveSelectedLocators,
      reviewLocator,
      startEditingLocator,
      saveLocatorChanges,
      saveLocatorPageName,
      saveLocatorCodeSelection,
      savePageObjectCode,
      chooseLocatorRepositoryFolder,
      previewLocatorRepositoryChange,
      applyLocatorRepositoryChange,
      resolveLocatorSync,
      disconnectLocatorFolder,
      chooseWorkbook,
      setWorkbookPath,
      importWorkbook,
      generateScenarios,
      reviewCase,
      deleteCase,
      updateCaseGroup,
      createCaseGroup,
      deleteCaseGroup,
      beginEditCase,
      updateEditedStep,
      moveEditedStep,
      saveCaseIdPolicy,
      generateTests,
      cancelGeneration,
      runGeneratedTests,
      decideHealing,
      createTestingSchedule,
      generateSignoffReport,
      resolveTraceability,
      draftFailedCaseBug,
      triageFailedCase,
      updateTestingFusionModel,
      updateTestingFusionOptions,
      fusionProviders,
      serverConfig,
    }),
    [
      acceptedCaseCount,
      applyLocatorRepositoryChange,
      approveSelectedLocators,
      authCaptureOpen,
      authenticationMode,
      authenticationReady,
      beginEditCase,
      blockedCaseCount,
      bugDraft,
      busyAction,
      cancelGeneration,
      captureLocatorPage,
      captureReplay,
      caseFilter,
      caseIdNext,
      caseIdPadding,
      caseIdPolicy,
      caseIdPrefix,
      caseIntakeMode,
      manualCaseId,
      manualCaseDescription,
      manualCaseSteps,
      manualCaseExpectedResults,
      manualCaseLocatorIds,
      storyText,
      storyFilePath,
      caseSearch,
      cases,
      caseGroups,
      cdpEndpoint,
      chooseLocatorRepositoryFolder,
      chooseWorkbook,
      clearGraph,
      completedGenerationJob,
      createTestingSchedule,
      decideHealing,
      disconnectLocatorFolder,
      draftFailedCaseBug,
      deleteLocatorPage,
      editedCaseLocatorIds,
      editedDescription,
      editedExpectedResults,
      editedExternalId,
      editedSteps,
      editingCaseId,
      editingLocatorArguments,
      editingLocatorClassification,
      editingLocatorContext,
      editingLocatorEntry,
      editingLocatorId,
      editingLocatorKey,
      editingLocatorStrategy,
      executionMode,
      executionRuns,
      expandedTestNodes,
      explorationScope,
      filteredCases,
      filteredLocatorEntries,
      finishAuthCapture,
      finishLocatorDiscovery,
      flattenedTestInventory,
      fusionProviders,
      generateScenarios,
      generateSignoffReport,
      generateTests,
      generationFusionProvider,
      generationJobs,
      generationMaxCases,
      generationMaxCost,
      generationMaxTokens,
      generationModelSelection,
      generationOutputMode,
      generationReasoning,
      graphExplorer,
      implementedInventoryOpen,
      importWorkbook,
      indexLocatorFolder,
      latestExecutionRun,
      locatorAdvancedOpen,
      locatorCaptureScope,
      locatorCodeDraft,
      locatorCodeEditing,
      locatorCodeEntryIds,
      locatorCoverage,
      locatorFilter,
      locatorFolderResult,
      locatorLibrary,
      locatorMaxElements,
      locatorMaxPages,
      locatorMode,
      locatorNavigateUrl,
      locatorPageName,
      locatorPageTab,
      locatorPendingRemoveId,
      locatorPreviewExpanded,
      locatorRepositoryConfirmOpen,
      locatorRepositoryFileName,
      locatorRepositoryFolder,
      locatorRepositoryProposal,
      locatorSafety,
      locatorSearch,
      locatorSession,
      locatorStorageMode,
      locatorSyncPreview,
      locatorTaskContext,
      locatorViewport,
      maxDurationMinutes,
      maxStates,
      message,
      moveEditedStep,
      navigateLocatorDiscovery,
      normalizedCdpEndpoint,
      normalizedMaxDurationSeconds,
      normalizedMaxStates,
      normalizedTarget,
      pendingRemoveLocator,
      previewLocatorRepositoryChange,
      props.projectId,
      props.projectPath,
      readyCases,
      refreshCases,
      refreshExecution,
      refreshGenerationJobs,
      refreshGraphExplorer,
      refreshLocatorLibrary,
      refreshStatus,
      refreshTestingWorkspace,
      rescanLocatorPage,
      reportPaths,
      repositoryOutputPath,
      resolveLocatorSync,
      resolveTraceability,
      reviewCase,
      reviewCaseCount,
      reviewLocator,
      runGeneratedTests,
      saveCaseIdPolicy,
      saveLocatorChanges,
      saveLocatorCodeSelection,
      saveLocatorPageName,
      savePageObjectCode,
      scheduleTime,
      selectedCase,
      selectedCaseId,
      selectedGenerationCaseIds,
      selectedLocatorEntryIds,
      selectedLocatorPage,
      selectedLocatorPageId,
      selectedTestNodeId,
      serverConfig,
      setDiscoveryExperience,
      setWorkbookPath,
      setWorkspaceCases,
      startAuthCapture,
      startEditingLocator,
      startExploration,
      startLocatorDiscovery,
      status,
      targetUrl,
      templatePath,
      testInventory,
      testInventoryView,
      testerName,
      testingSchedules,
      traceCaseId,
      traceability,
      triageFailedCase,
      triageResult,
      updateEditedStep,
      updateCaseGroup,
      createCaseGroup,
      deleteCaseGroup,
      updateTestingFusionModel,
      updateTestingFusionOptions,
      visualComparison,
      workbookPath,
    ],
  );

  const onProfilerRender: ProfilerOnRenderCallback = useCallback((id, phase, actualDuration) => {
    console.log(
      `[React Profiler] id="${id}" phase="${phase}" actualDuration=${actualDuration.toFixed(2)}ms`,
    );
  }, []);

  return (
    <TestingDataContext.Provider value={contextValue}>
      {confirmDialog}
      <main
        className="relative flex h-full min-h-0 overflow-hidden bg-background"
        aria-labelledby="testing-heading"
      >
        <div className="min-w-0 flex-1 overflow-auto">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
            <header
              className={cn(
                "border-b border-border/70",
                activeTestingSection === "overview"
                  ? "flex flex-col gap-3 pb-5"
                  : "flex flex-wrap items-center justify-between gap-4 pb-3.5",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <h1
                    id="testing-heading"
                    className={cn(
                      "font-semibold tracking-tight text-foreground leading-snug pb-0.5",
                      activeTestingSection === "overview" ? "text-3xl" : "text-xl",
                    )}
                  >
                    Testing
                  </h1>
                  {activeTestingSection === "overview" ? (
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[11px] font-semibold text-foreground">
                      <FlaskConicalIcon aria-hidden="true" className="size-3 text-foreground" />
                      <span>Private Workspace</span>
                    </div>
                  ) : null}
                </div>

                <div
                  className="flex flex-wrap items-center gap-2"
                  role="group"
                  aria-label="Workspace testing summary"
                >
                  <div className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    <FolderIcon className="size-3.5 text-muted-foreground/80" aria-hidden="true" />
                    <span>Project:</span>
                    <span className="font-semibold text-foreground">
                      {basenameOfPath(props.projectPath)}
                    </span>
                  </div>

                  <div className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-2.5 py-1 text-xs font-medium text-foreground">
                    <span className="inline-flex items-center gap-1">
                      <NetworkIcon className="size-3.5 text-sky-500" aria-hidden="true" />
                      <span className="font-semibold">{status?.nodeCount ?? 0}</span>
                      <span className="text-muted-foreground text-[11px]">states</span>
                    </span>
                    <span className="h-3 w-px bg-border/80" aria-hidden="true" />
                    <span className="inline-flex items-center gap-1">
                      <FileTextIcon className="size-3.5 text-violet-500" aria-hidden="true" />
                      <span className="font-semibold">{cases.length}</span>
                      <span className="text-muted-foreground text-[11px]">cases</span>
                    </span>
                  </div>

                  <div
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium",
                      latestExecutionRun
                        ? latestExecutionRun.status === "passed"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                        : "border-border/60 bg-muted/20 text-muted-foreground",
                    )}
                  >
                    <CircleDotIcon
                      className={cn(
                        "size-3",
                        latestExecutionRun
                          ? latestExecutionRun.status === "passed"
                            ? "text-emerald-500 fill-emerald-500/20"
                            : "text-rose-500 fill-rose-500/20"
                          : "text-muted-foreground/60",
                      )}
                      aria-hidden="true"
                    />
                    <span>
                      {latestExecutionRun
                        ? `Latest run: ${latestExecutionRun.status}`
                        : "No runs yet"}
                    </span>
                  </div>
                  <Button
                    ref={testingTerminalButtonRef}
                    type="button"
                    size="sm"
                    variant={testingTerminalOpen ? "secondary" : "outline"}
                    onClick={() => setTestingTerminalOpen((open) => !open)}
                    aria-expanded={testingTerminalOpen}
                    aria-controls="testing-terminal-dock"
                  >
                    <TerminalIcon aria-hidden="true" className="size-3.5" />
                    Terminal
                  </Button>
                </div>
              </div>

              {activeTestingSection === "overview" ? (
                <p className="max-w-4xl text-sm leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground/90">
                    Turn test plans and live applications into reviewed, repeatable evidence
                  </span>
                  <span className="text-muted-foreground/80">
                    {" "}
                    — guided step-by-step with reviewed diffs and automated code.
                  </span>
                </p>
              ) : null}
            </header>

            <div className="grid min-w-0 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
              <nav aria-label="Testing workflow" className="lg:sticky lg:top-4 lg:self-start">
                <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:rounded-xl lg:border lg:border-border/50 lg:bg-card/30 lg:p-1.5">
                  {testingSections.map((section) => {
                    const active = activeTestingSection === section.id;
                    const recommended = recommendedTestingSection === section.id;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        aria-current={active ? "page" : undefined}
                        onClick={() => setActiveTestingSection(section.id)}
                        className={cn(
                          "group relative min-w-40 rounded-lg px-3 py-2.5 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-w-0",
                          active
                            ? "bg-background/80 text-foreground shadow-sm ring-1 ring-border/60"
                            : "text-muted-foreground hover:bg-background/50 hover:text-foreground/80",
                        )}
                      >
                        {active && (
                          <span
                            className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-foreground/40"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className={cn(
                            "flex items-center justify-between gap-2 text-sm font-medium",
                            active ? "pl-2.5" : "",
                          )}
                        >
                          {section.label}
                          {typeof section.count === "number" ? (
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-semibold",
                                active
                                  ? "bg-primary/15 text-foreground"
                                  : "bg-muted text-muted-foreground group-hover:text-foreground",
                              )}
                            >
                              {section.count}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={cn(
                            "mt-1 block text-xs leading-normal text-muted-foreground",
                            active ? "pl-2.5" : "",
                          )}
                        >
                          {section.description}
                        </span>
                        {recommended && (
                          <span
                            className={cn(
                              "mt-1.5 inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground",
                              active ? "ml-2.5" : "",
                            )}
                          >
                            Recommended next
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </nav>

              <div className="min-w-0 space-y-6">
                <p className="sr-only" aria-live="polite">
                  {testingSections.find((section) => section.id === activeTestingSection)?.label}{" "}
                  workspace opened.
                </p>

                <Suspense
                  fallback={
                    <div className="flex h-64 items-center justify-center">
                      <LoaderIcon className="size-6 animate-spin text-muted-foreground" />
                    </div>
                  }
                >
                  <div
                    className={cn(activeTestingSection === "overview" ? "block" : "hidden")}
                    aria-hidden={activeTestingSection !== "overview"}
                  >
                    <Profiler id="TestingOverview" onRender={onProfilerRender}>
                      <TestingOverview
                        onNavigate={setActiveTestingSection}
                        recommendedTestingSection={recommendedTestingSection}
                        testingSections={testingSections}
                      />
                    </Profiler>
                  </div>
                  <div
                    className={cn(activeTestingSection === "discover" ? "block" : "hidden")}
                    aria-hidden={activeTestingSection !== "discover"}
                  >
                    <Profiler id="TestingDiscover" onRender={onProfilerRender}>
                      <TestingDiscover projectId={props.projectId} />
                    </Profiler>
                  </div>
                  <div
                    className={cn(activeTestingSection === "cases" ? "block" : "hidden")}
                    aria-hidden={activeTestingSection !== "cases"}
                  >
                    <Profiler id="TestingCases" onRender={onProfilerRender}>
                      <TestingCases
                        projectPath={props.projectPath}
                        onNavigate={setActiveTestingSection}
                      />
                    </Profiler>
                  </div>
                  <div
                    className={cn(activeTestingSection === "automate" ? "block" : "hidden")}
                    aria-hidden={activeTestingSection !== "automate"}
                  >
                    <Profiler id="TestingAutomate" onRender={onProfilerRender}>
                      <TestingAutomate onNavigate={setActiveTestingSection} />
                    </Profiler>
                  </div>
                  <div
                    className={cn(activeTestingSection === "runs" ? "block" : "hidden")}
                    aria-hidden={activeTestingSection !== "runs"}
                  >
                    <Profiler id="TestingRuns" onRender={onProfilerRender}>
                      <TestingRuns />
                    </Profiler>
                  </div>
                  <div
                    className={cn(activeTestingSection === "reports" ? "block" : "hidden")}
                    aria-hidden={activeTestingSection !== "reports"}
                  >
                    <Profiler id="TestingReports" onRender={onProfilerRender}>
                      <TestingReports />
                    </Profiler>
                  </div>
                </Suspense>
              </div>
            </div>
          </div>
        </div>
        {testingTerminalOpen ? (
          <TestingTerminalDock
            projectId={props.projectId}
            projectPath={props.projectPath}
            onClose={closeTestingTerminal}
          />
        ) : null}
      </main>
    </TestingDataContext.Provider>
  );
}

export default TestingTool;
