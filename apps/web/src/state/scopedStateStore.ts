import { useCallback, useMemo } from "react";
import { create } from "zustand";
import { scopedProjectKey, scopeProjectRef } from "@tabs/client-runtime/environment";
import { EnvironmentId, ProjectId } from "@tabs/contracts";
import type {
  ModelSelection,
  TestingDiscoveryMode,
  TestingDiscoverySafetyProfile,
  TestingExplorationScope,
  TestingLocatorCoverageMode,
  TestingLocatorEntry,
} from "@tabs/contracts";
import type {
  TestingAuthenticationMode,
  TestingCaseFilter,
  TestingCaseIntakeMode,
  TestingLocatorFilter,
  TestingLocatorPageTab,
  TestingWorkspaceSection,
} from "../components/testing/types";
import type { NavPanel } from "../components/git/Sidebar";

export function projectUiStateKey(
  environmentId: string | null | undefined,
  projectId: ProjectId | string,
): string {
  if (!projectId) return "";
  return environmentId
    ? scopedProjectKey(
        scopeProjectRef(EnvironmentId.makeUnsafe(environmentId), ProjectId.makeUnsafe(projectId)),
      )
    : projectId;
}

export interface ProjectTestingState {
  // Navigation / Tabs
  activeTestingSection: TestingWorkspaceSection;

  // Cases View State
  selectedCaseId: string | null;
  caseSearch: string;
  caseFilter: TestingCaseFilter;
  implementedInventoryOpen: boolean;
  testInventoryView: "tree" | "table";
  selectedTestNodeId: string | null;
  expandedTestNodes: ReadonlySet<string>;

  // Case Intake / Drafting
  caseIntakeMode: TestingCaseIntakeMode;
  manualCaseId: string;
  manualCaseDescription: string;
  manualCaseSteps: ReadonlyArray<string>;
  manualCaseExpectedResults: ReadonlyArray<string>;
  manualCaseLocatorIds: ReadonlySet<string>;
  storyText: string;
  storyFilePath: string;

  // Case Editing
  editingCaseId: string | null;
  editedExternalId: string;
  editedDescription: string;
  editedSteps: ReadonlyArray<string>;
  editedExpectedResults: ReadonlyArray<string>;
  editedCaseLocatorIds: ReadonlySet<string>;

  // Discovery / Exploration
  targetUrl: string;
  cdpEndpoint: string;
  explorationScope: TestingExplorationScope;
  authenticationMode: TestingAuthenticationMode;
  maxStates: string;
  maxDurationMinutes: string;

  // Locator Discovery
  locatorMode: TestingDiscoveryMode;
  locatorCoverage: TestingLocatorCoverageMode;
  locatorSafety: TestingDiscoverySafetyProfile;
  locatorMaxElements: string;
  locatorMaxPages: string;
  selectedLocatorPageId: string | null;
  locatorPageTab: TestingLocatorPageTab;
  locatorSearch: string;
  locatorFilter: TestingLocatorFilter;
  editingLocatorId: string | null;
  editingLocatorKey: string;
  editingLocatorClassification: TestingLocatorEntry["classification"];
  editingLocatorStrategy: TestingLocatorEntry["strategy"];
  editingLocatorArguments: string;
  editingLocatorContext: string;
  locatorCodeDraft: string;
  locatorCodeEditing: boolean;
  locatorPreviewExpanded: boolean;
  locatorViewport: "desktop" | "tablet" | "mobile";

  // Automate / Generation
  selectedGenerationCaseIds: ReadonlySet<string>;
  generationModelSelection: ModelSelection | null;
  generationReasoning: "low" | "medium" | "high";
  generationOutputMode: "managed" | "repository";
  repositoryOutputPath: string;
  templatePath: string;
  generationMaxCases: string;
  generationMaxTokens: string;
  generationMaxCost: string;

  // Runs & Triage
  executionMode: "standalone" | "ci";
  visualComparison: boolean;
  bugDraft: string;
  triageResult: string;
  traceCaseId: string;
}

import {
  createScopedStorageKey,
  deserializeSet,
  loadScopedState,
  saveScopedState,
  serializeSet,
} from "../lib/scopedStateStorage";

export function createDefaultTestingState(projectId?: string): ProjectTestingState {
  const base: ProjectTestingState = {
    activeTestingSection: "overview",
    selectedCaseId: null,
    caseSearch: "",
    caseFilter: "all",
    implementedInventoryOpen: false,
    testInventoryView: "tree",
    selectedTestNodeId: null,
    expandedTestNodes: new Set<string>(),

    caseIntakeMode: "manual",
    manualCaseId: "",
    manualCaseDescription: "",
    manualCaseSteps: [""],
    manualCaseExpectedResults: [""],
    manualCaseLocatorIds: new Set<string>(),
    storyText: "",
    storyFilePath: "",

    editingCaseId: null,
    editedExternalId: "",
    editedDescription: "",
    editedSteps: [],
    editedExpectedResults: [],
    editedCaseLocatorIds: new Set<string>(),

    targetUrl: "",
    cdpEndpoint: "",
    explorationScope: "path",
    authenticationMode: "none",
    maxStates: "100",
    maxDurationMinutes: "30",

    locatorMode: "guided",
    locatorCoverage: "actions-assertions",
    locatorSafety: "supervised",
    locatorMaxElements: "50",
    locatorMaxPages: "10",
    selectedLocatorPageId: null,
    locatorPageTab: "locators",
    locatorSearch: "",
    locatorFilter: "all",
    editingLocatorId: null,
    editingLocatorKey: "",
    editingLocatorClassification: "action",
    editingLocatorStrategy: "role",
    editingLocatorArguments: "{}",
    editingLocatorContext: "",
    locatorCodeDraft: "",
    locatorCodeEditing: false,
    locatorPreviewExpanded: false,
    locatorViewport: "desktop",

    selectedGenerationCaseIds: new Set<string>(),
    generationModelSelection: null,
    generationReasoning: "medium",
    generationOutputMode: "managed",
    repositoryOutputPath: "tests/e2e/generated",
    templatePath: "",
    generationMaxCases: "10",
    generationMaxTokens: "4000",
    generationMaxCost: "0.50",

    executionMode: "standalone",
    visualComparison: false,
    bugDraft: "",
    triageResult: "",
    traceCaseId: "",
  };

  if (projectId && typeof localStorage !== "undefined") {
    const key = createScopedStorageKey("testing-drafts", projectId);
    const persisted = loadScopedState<{
      manualCaseId?: string;
      manualCaseDescription?: string;
      manualCaseSteps?: string[];
      manualCaseExpected?: string;
      manualCaseExpectedResults?: string[];
      manualCaseLocatorIds?: string[];
      storyText?: string;
      storyFilePath?: string;
      locatorCodeDraft?: string;
      bugDraft?: string;
      targetUrl?: string;
    }>(localStorage, key);

    if (persisted) {
      if (persisted.manualCaseId !== undefined) base.manualCaseId = persisted.manualCaseId;
      if (persisted.manualCaseDescription !== undefined)
        base.manualCaseDescription = persisted.manualCaseDescription;
      if (persisted.manualCaseSteps !== undefined) base.manualCaseSteps = persisted.manualCaseSteps;
      if (persisted.manualCaseExpectedResults !== undefined) {
        base.manualCaseExpectedResults = persisted.manualCaseExpectedResults;
      } else if (persisted.manualCaseExpected !== undefined) {
        base.manualCaseExpectedResults = [persisted.manualCaseExpected];
      }
      if (persisted.manualCaseLocatorIds !== undefined)
        base.manualCaseLocatorIds = deserializeSet(persisted.manualCaseLocatorIds);
      if (persisted.storyText !== undefined) base.storyText = persisted.storyText;
      if (persisted.storyFilePath !== undefined) base.storyFilePath = persisted.storyFilePath;
      if (persisted.locatorCodeDraft !== undefined)
        base.locatorCodeDraft = persisted.locatorCodeDraft;
      if (persisted.bugDraft !== undefined) base.bugDraft = persisted.bugDraft;
      if (persisted.targetUrl !== undefined) base.targetUrl = persisted.targetUrl;
    }
  }

  return base;
}

export interface ProjectGitState {
  panel: NavPanel;
  diffMode: "working" | "history";
  selectedPath: string | null;
  selectedCommit: string | null;
  commitDraft: string;
  amend: boolean;
  selectedModel: ModelSelection | undefined;
  conflictResolutions: Record<string, { strategy: string; text?: string }>;
  conflictActiveFile: number;
  conflictEditingKey: string | null;
  conflictManualText: string;
  expandedFileRows: Record<string, boolean>;

  branchForm: "new" | "rename" | null;
  branchSearch: string;
  tagForm: boolean;
  tagSearch: string;
  historySearch: string;
  selectedCommitDetailIndex: number;
  prViewMode: "branch" | "all";
  prFilter: "all" | "open" | "merged" | "closed";
  prExpandedComments: number | null;
}

export function createDefaultGitState(key?: string): ProjectGitState {
  const base: ProjectGitState = {
    panel: "overview",
    diffMode: "working",
    selectedPath: null,
    selectedCommit: null,
    commitDraft: "",
    amend: false,
    selectedModel: undefined,
    conflictResolutions: {},
    conflictActiveFile: 0,
    conflictEditingKey: null,
    conflictManualText: "",
    expandedFileRows: {},

    branchForm: null,
    branchSearch: "",
    tagForm: false,
    tagSearch: "",
    historySearch: "",
    selectedCommitDetailIndex: 0,
    prViewMode: "branch",
    prFilter: "all",
    prExpandedComments: null,
  };

  if (key && typeof localStorage !== "undefined") {
    const storageKey = createScopedStorageKey("git-drafts", key);
    const persisted = loadScopedState<{
      commitDraft?: string;
      amend?: boolean;
    }>(localStorage, storageKey);

    if (persisted) {
      if (persisted.commitDraft !== undefined) base.commitDraft = persisted.commitDraft;
      if (persisted.amend !== undefined) base.amend = persisted.amend;
    }
  }

  return base;
}

export interface ProjectAgentsState {
  threadListView: "current" | "archived";
  planSidebarOpen: boolean;
  expandedWorkGroups: Record<string, boolean>;
  pendingUserInputAnswersByRequestId: Record<string, unknown>;
}

export function createDefaultAgentsState(): ProjectAgentsState {
  return {
    threadListView: "current",
    planSidebarOpen: false,
    expandedWorkGroups: {},
    pendingUserInputAnswersByRequestId: {},
  };
}

export interface ProjectServerState {
  presetsExpanded: boolean;
  activeTerminalId: string | null;
  logQueryByProcessId: Record<string, string>;
}

export function createDefaultServerState(): ProjectServerState {
  return {
    presetsExpanded: false,
    activeTerminalId: null,
    logQueryByProcessId: {},
  };
}

export interface ProjectBrowserState {
  draftUrl: string;
  viewportSelectorOpen: boolean;
}

export function createDefaultBrowserState(): ProjectBrowserState {
  return {
    draftUrl: "",
    viewportSelectorOpen: false,
  };
}

export interface SettingsViewState {
  activeSection: string;
  searchQuery: string;
  activeProviderFilter: string | null;
  openProviderDetails: Record<string, boolean>;
  customModelInputByProvider: Record<string, string>;
  draftModelOrders: Record<string, ReadonlyArray<string>>;
  animationTab: "startup" | "close";
  projectWorkspaceMasterDetail: Record<
    string,
    {
      activeSection: string;
      activeCustomEmbedId: string | null;
      activeServerProcessId: string | null;
      activeServerPresetId: string | null;
    }
  >;
}

export function createDefaultSettingsState(): SettingsViewState {
  return {
    activeSection: "general",
    searchQuery: "",
    activeProviderFilter: null,
    openProviderDetails: {},
    customModelInputByProvider: {},
    draftModelOrders: {},
    animationTab: "startup",
    projectWorkspaceMasterDetail: {},
  };
}

export interface ScopedStateStore {
  testingStateByProjectId: Record<string, ProjectTestingState>;
  gitStateByProjectId: Record<string, ProjectGitState>;
  agentsStateByProjectId: Record<string, ProjectAgentsState>;
  serverStateByProjectId: Record<string, ProjectServerState>;
  browserStateByProjectId: Record<string, ProjectBrowserState>;
  settingsState: SettingsViewState;

  // Actions
  updateTestingState: (
    projectId: ProjectId | string,
    updater:
      | Partial<ProjectTestingState>
      | ((prev: ProjectTestingState) => Partial<ProjectTestingState>),
  ) => void;
  updateGitState: (
    key: ProjectId | string,
    updater: Partial<ProjectGitState> | ((prev: ProjectGitState) => Partial<ProjectGitState>),
  ) => void;
  updateAgentsState: (
    projectId: ProjectId | string,
    updater:
      | Partial<ProjectAgentsState>
      | ((prev: ProjectAgentsState) => Partial<ProjectAgentsState>),
  ) => void;
  updateServerState: (
    projectId: ProjectId | string,
    updater:
      | Partial<ProjectServerState>
      | ((prev: ProjectServerState) => Partial<ProjectServerState>),
  ) => void;
  updateBrowserState: (
    projectId: ProjectId | string,
    updater:
      | Partial<ProjectBrowserState>
      | ((prev: ProjectBrowserState) => Partial<ProjectBrowserState>),
  ) => void;
  updateSettingsState: (
    updater: Partial<SettingsViewState> | ((prev: SettingsViewState) => Partial<SettingsViewState>),
  ) => void;
}

export const useScopedStateStore = create<ScopedStateStore>((set) => ({
  testingStateByProjectId: {},
  gitStateByProjectId: {},
  agentsStateByProjectId: {},
  serverStateByProjectId: {},
  browserStateByProjectId: {},
  settingsState: createDefaultSettingsState(),

  updateTestingState: (projectId, updater) =>
    set((state) => {
      const current =
        state.testingStateByProjectId[projectId] ?? createDefaultTestingState(projectId);
      const patch = typeof updater === "function" ? updater(current) : updater;
      const next = { ...current, ...patch };

      if (typeof localStorage !== "undefined") {
        const storageKey = createScopedStorageKey("testing-drafts", projectId);
        saveScopedState(localStorage, storageKey, {
          manualCaseId: next.manualCaseId,
          manualCaseDescription: next.manualCaseDescription,
          manualCaseSteps: [...next.manualCaseSteps],
          manualCaseExpectedResults: [...next.manualCaseExpectedResults],
          manualCaseLocatorIds: serializeSet(next.manualCaseLocatorIds),
          storyText: next.storyText,
          storyFilePath: next.storyFilePath,
          locatorCodeDraft: next.locatorCodeDraft,
          bugDraft: next.bugDraft,
          targetUrl: next.targetUrl,
        });
      }

      return {
        testingStateByProjectId: {
          ...state.testingStateByProjectId,
          [projectId]: next,
        },
      };
    }),

  updateGitState: (key, updater) =>
    set((state) => {
      const current = state.gitStateByProjectId[key] ?? createDefaultGitState(key);
      const patch = typeof updater === "function" ? updater(current) : updater;
      const next = { ...current, ...patch };

      if (typeof localStorage !== "undefined") {
        const storageKey = createScopedStorageKey("git-drafts", key);
        saveScopedState(localStorage, storageKey, {
          commitDraft: next.commitDraft,
          amend: next.amend,
        });
      }

      return {
        gitStateByProjectId: {
          ...state.gitStateByProjectId,
          [key]: next,
        },
      };
    }),

  updateAgentsState: (projectId, updater) =>
    set((state) => {
      const current = state.agentsStateByProjectId[projectId] ?? createDefaultAgentsState();
      const patch = typeof updater === "function" ? updater(current) : updater;
      return {
        agentsStateByProjectId: {
          ...state.agentsStateByProjectId,
          [projectId]: { ...current, ...patch },
        },
      };
    }),

  updateServerState: (projectId, updater) =>
    set((state) => {
      const current = state.serverStateByProjectId[projectId] ?? createDefaultServerState();
      const patch = typeof updater === "function" ? updater(current) : updater;
      return {
        serverStateByProjectId: {
          ...state.serverStateByProjectId,
          [projectId]: { ...current, ...patch },
        },
      };
    }),

  updateBrowserState: (projectId, updater) =>
    set((state) => {
      const current = state.browserStateByProjectId[projectId] ?? createDefaultBrowserState();
      const patch = typeof updater === "function" ? updater(current) : updater;
      return {
        browserStateByProjectId: {
          ...state.browserStateByProjectId,
          [projectId]: { ...current, ...patch },
        },
      };
    }),

  updateSettingsState: (updater) =>
    set((state) => {
      const current = state.settingsState;
      const patch = typeof updater === "function" ? updater(current) : updater;
      return {
        settingsState: { ...current, ...patch },
      };
    }),
}));

const STATIC_DEFAULT_TESTING_STATE: ProjectTestingState = createDefaultTestingState();
const STATIC_DEFAULT_GIT_STATE: ProjectGitState = createDefaultGitState();
const STATIC_DEFAULT_AGENTS_STATE: ProjectAgentsState = createDefaultAgentsState();
const STATIC_DEFAULT_SERVER_STATE: ProjectServerState = createDefaultServerState();
const STATIC_DEFAULT_BROWSER_STATE: ProjectBrowserState = createDefaultBrowserState();

export function useProjectTestingState(projectId: ProjectId | string) {
  const testingStateFromStore = useScopedStateStore(
    useCallback(
      (state: ScopedStateStore) =>
        projectId ? state.testingStateByProjectId[projectId] : undefined,
      [projectId],
    ),
  );
  const update = useScopedStateStore((state) => state.updateTestingState);

  const fallback = useMemo(
    () => (projectId ? createDefaultTestingState(projectId) : STATIC_DEFAULT_TESTING_STATE),
    [projectId],
  );
  const testingState = testingStateFromStore ?? fallback;

  const setTestingState = useCallback(
    (
      updater:
        | Partial<ProjectTestingState>
        | ((prev: ProjectTestingState) => Partial<ProjectTestingState>),
    ) => {
      if (!projectId) return;
      update(projectId, updater);
    },
    [projectId, update],
  );

  return [testingState, setTestingState] as const;
}

export function useProjectGitState(key: ProjectId | string) {
  const gitStateFromStore = useScopedStateStore(
    useCallback(
      (state: ScopedStateStore) => (key ? state.gitStateByProjectId[key] : undefined),
      [key],
    ),
  );
  const update = useScopedStateStore((state) => state.updateGitState);

  const fallback = useMemo(
    () => (key ? createDefaultGitState(key) : STATIC_DEFAULT_GIT_STATE),
    [key],
  );
  const gitState = gitStateFromStore ?? fallback;

  const setGitState = useCallback(
    (updater: Partial<ProjectGitState> | ((prev: ProjectGitState) => Partial<ProjectGitState>)) => {
      if (!key) return;
      update(key, updater);
    },
    [key, update],
  );

  return [gitState, setGitState] as const;
}

export function useProjectAgentsState(projectId: ProjectId | string) {
  const agentsStateFromStore = useScopedStateStore(
    useCallback(
      (state: ScopedStateStore) =>
        projectId ? state.agentsStateByProjectId[projectId] : undefined,
      [projectId],
    ),
  );
  const update = useScopedStateStore((state) => state.updateAgentsState);
  const agentsState = agentsStateFromStore ?? STATIC_DEFAULT_AGENTS_STATE;

  const setAgentsState = useCallback(
    (
      updater:
        | Partial<ProjectAgentsState>
        | ((prev: ProjectAgentsState) => Partial<ProjectAgentsState>),
    ) => {
      if (!projectId) return;
      update(projectId, updater);
    },
    [projectId, update],
  );

  return [agentsState, setAgentsState] as const;
}

export function useProjectServerState(projectId: ProjectId | string) {
  const serverStateFromStore = useScopedStateStore(
    useCallback(
      (state: ScopedStateStore) =>
        projectId ? state.serverStateByProjectId[projectId] : undefined,
      [projectId],
    ),
  );
  const update = useScopedStateStore((state) => state.updateServerState);
  const serverState = serverStateFromStore ?? STATIC_DEFAULT_SERVER_STATE;

  const setServerState = useCallback(
    (
      updater:
        | Partial<ProjectServerState>
        | ((prev: ProjectServerState) => Partial<ProjectServerState>),
    ) => {
      if (!projectId) return;
      update(projectId, updater);
    },
    [projectId, update],
  );

  return [serverState, setServerState] as const;
}

export function useProjectBrowserState(projectId: ProjectId | string) {
  const browserStateFromStore = useScopedStateStore(
    useCallback(
      (state: ScopedStateStore) =>
        projectId ? state.browserStateByProjectId[projectId] : undefined,
      [projectId],
    ),
  );
  const update = useScopedStateStore((state) => state.updateBrowserState);
  const browserState = browserStateFromStore ?? STATIC_DEFAULT_BROWSER_STATE;

  const setBrowserState = useCallback(
    (
      updater:
        | Partial<ProjectBrowserState>
        | ((prev: ProjectBrowserState) => Partial<ProjectBrowserState>),
    ) => {
      if (!projectId) return;
      update(projectId, updater);
    },
    [projectId, update],
  );

  return [browserState, setBrowserState] as const;
}

export function useSettingsViewState() {
  const settingsState = useScopedStateStore((state) => state.settingsState);
  const update = useScopedStateStore((state) => state.updateSettingsState);

  const setSettingsState = useCallback(
    (
      updater:
        | Partial<SettingsViewState>
        | ((prev: SettingsViewState) => Partial<SettingsViewState>),
    ) => {
      update(updater);
    },
    [update],
  );

  return [settingsState, setSettingsState] as const;
}
