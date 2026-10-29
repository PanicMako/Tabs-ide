import {
  hasOmittedBodies,
  stripBodySourceSequence,
  turnItemBodySourceKey,
  restoreSnapshotBodies,
  restoreSubagentBodies,
  restoreTurnItemBodies,
} from "@tabs/shared/orchestrationV2DedupedBodies";
import { mergeProviderWorkspaceSnapshots } from "@tabs/shared/providerWorkspaceSnapshots";
import {
  GitActionProgressEvent,
  type GitRunStackedActionResult,
  type ReviewProgressEvent,
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationV2ShellStreamItem,
  OrchestrationV2ThreadStreamItem,
  type OrchestrationV2ThreadProjection,
  type CheckpointId,
  type MessageId,
  type NodeId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2Subagent,
  type ContextMenuItem,
  type NativeApi,
  type AssetCreateUrlResult,
  ServerConfigStreamEvent,
  ServerConfigUpdatedPayload,
  ServerProviderUpdatedPayload,
  WS_CHANNELS,
  WS_METHODS,
  type WsWelcomePayload,
  type TerminalEvent,
  TerminalEvent as TerminalEventSchema,
  ResourceTelemetrySnapshot,
  type OrchestrationReadModel,
  ScheduledTaskListResult,
} from "@tabs/contracts";
import { providerUsageSnapshots } from "./providerUsageSnapshots";
import * as Schema from "effect/Schema";

import { showContextMenuFallback } from "./contextMenuFallback";
import { WsTransport } from "./wsTransport";
import { showCustomConfirm } from "./lib/customConfirm";

const decodeShellStreamItem = Schema.decodeUnknownSync(OrchestrationV2ShellStreamItem);
const decodeThreadStreamItem = Schema.decodeUnknownSync(OrchestrationV2ThreadStreamItem);

export function normalizeOrchestrationCommand(command: any): any {
  if (!command || typeof command !== "object") return command;
  if (command.type === "project.meta.update") {
    return {
      ...command,
      type: "project.update",
    };
  }
  if (command.type === "thread.create") {
    return {
      ...command,
      interactionMode:
        command.interactionMode === "chat" || !command.interactionMode
          ? "default"
          : command.interactionMode,
    };
  }
  if (command.type === "thread.turn.start") {
    const text = command.input?.text ?? command.text ?? "";
    const attachments = command.input?.attachments ?? command.attachments ?? [];
    return {
      type: "message.dispatch",
      commandId:
        command.commandId ??
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `cmd-${Date.now()}`),
      threadId: command.threadId,
      messageId:
        command.messageId ??
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `msg-${Date.now()}`),
      text,
      attachments,
      dispatchMode: { type: "start_immediately" },
      ...(command.context ? { context: command.context } : {}),
      ...(command.modelSelection ? { modelSelection: command.modelSelection } : {}),
      ...(command.sourcePlanRef ? { sourcePlanRef: command.sourcePlanRef } : {}),
    };
  }
  if (command.type === "thread.approval.respond") {
    return {
      type: "runtime-request.respond",
      commandId:
        command.commandId ??
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `cmd-${Date.now()}`),
      threadId: command.threadId,
      requestId: command.requestId ?? command.approvalId,
      decision: command.decision,
    };
  }
  if (command.type === "thread.user-input.respond") {
    return {
      type: "runtime-request.respond",
      commandId:
        command.commandId ??
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `cmd-${Date.now()}`),
      threadId: command.threadId,
      requestId: command.requestId,
      answers: command.answers,
      ...(command.attachmentsByQuestionId
        ? { attachmentsByQuestionId: command.attachmentsByQuestionId }
        : {}),
    };
  }
  if (command.type === "thread.meta.update") {
    const cmdId =
      command.commandId ??
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `cmd-${Date.now()}`);
    if (command.modelSelection && !command.title && !command.branch && !command.worktreePath) {
      return {
        type: "thread.model-selection.set",
        commandId: cmdId,
        threadId: command.threadId,
        modelSelection: command.modelSelection,
      };
    }
    return {
      type: "thread.metadata.update",
      commandId: cmdId,
      threadId: command.threadId,
      ...(command.title !== undefined ? { title: command.title } : {}),
      ...(command.branch !== undefined ? { branch: command.branch } : {}),
      ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
    };
  }
  return command;
}

let instance: { api: NativeApi; transport: WsTransport } | null = null;
const welcomeListeners = new Set<(payload: WsWelcomePayload) => void>();
let latestV2Config: ServerConfigUpdatedPayload | null = null;
let latestV2Providers: ServerProviderUpdatedPayload | null = null;
const serverConfigUpdatedListeners = new Set<(payload: ServerConfigUpdatedPayload) => void>();
const providersUpdatedListeners = new Set<(payload: ServerProviderUpdatedPayload) => void>();
const gitActionProgressListeners = new Set<(payload: GitActionProgressEvent) => void>();
const reviewProgressListeners = new Set<(payload: ReviewProgressEvent) => void>();
const usageUpdatedListeners = new Set<(payload: any) => void>();

/**
 * Subscribe to the server welcome message. If a welcome was already received
 * before this call, the listener fires synchronously with the cached payload.
 * This avoids the race between WebSocket connect and React effect registration.
 */
export function onServerWelcome(listener: (payload: WsWelcomePayload) => void): () => void {
  welcomeListeners.add(listener);

  const latestWelcome = instance?.transport.getLatestPush(WS_CHANNELS.serverWelcome)?.data ?? null;
  if (latestWelcome) {
    try {
      listener(latestWelcome);
    } catch {
      // Swallow listener errors
    }
  }

  return () => {
    welcomeListeners.delete(listener);
  };
}

/**
 * Subscribe to server config update events. Replays the latest update for
 * late subscribers to avoid missing config validation feedback.
 */
export function onServerConfigUpdated(
  listener: (payload: ServerConfigUpdatedPayload) => void,
): () => void {
  serverConfigUpdatedListeners.add(listener);

  const latestConfig =
    latestV2Config ??
    instance?.transport.getLatestPush(WS_CHANNELS.serverConfigUpdated)?.data ??
    null;
  if (latestConfig) {
    try {
      listener(latestConfig);
    } catch {
      // Swallow listener errors
    }
  }

  return () => {
    serverConfigUpdatedListeners.delete(listener);
  };
}

export function onServerProvidersUpdated(
  listener: (payload: ServerProviderUpdatedPayload) => void,
): () => void {
  providersUpdatedListeners.add(listener);

  const latestProviders =
    latestV2Providers ??
    instance?.transport.getLatestPush(WS_CHANNELS.serverProvidersUpdated)?.data ??
    null;
  if (latestProviders) {
    try {
      listener(latestProviders);
    } catch {
      // Swallow listener errors
    }
  }

  return () => {
    providersUpdatedListeners.delete(listener);
  };
}

const apiProviderUpdates = new WeakMap<
  NativeApi,
  {
    listeners: Set<(payload: ServerProviderUpdatedPayload) => void>;
    latest: () => ServerProviderUpdatedPayload | null;
  }
>();

export function onApiServerProvidersUpdated(
  api: NativeApi,
  listener: (payload: ServerProviderUpdatedPayload) => void,
): () => void {
  const updates = apiProviderUpdates.get(api);
  if (!updates) return () => {};
  updates.listeners.add(listener);
  const latest = updates.latest();
  if (latest) listener(latest);
  return () => updates.listeners.delete(listener);
}

export function onUsageUpdated(listener: (payload: any) => void): () => void {
  usageUpdatedListeners.add(listener);
  return () => {
    usageUpdatedListeners.delete(listener);
  };
}

export function getWsTransport(): WsTransport | null {
  return instance?.transport ?? null;
}

export function createWsNativeApi(options?: {
  readonly transport?: WsTransport;
  readonly singleton?: boolean;
}): NativeApi {
  const singleton = options?.singleton !== false;
  if (singleton && instance) return instance.api;

  const transport = options?.transport ?? new WsTransport();
  const activeWelcomeListeners = singleton
    ? welcomeListeners
    : new Set<(payload: WsWelcomePayload) => void>();
  const activeServerConfigUpdatedListeners = singleton
    ? serverConfigUpdatedListeners
    : new Set<(payload: ServerConfigUpdatedPayload) => void>();
  const activeProvidersUpdatedListeners = singleton
    ? providersUpdatedListeners
    : new Set<(payload: ServerProviderUpdatedPayload) => void>();
  const activeGitActionProgressListeners = singleton
    ? gitActionProgressListeners
    : new Set<(payload: GitActionProgressEvent) => void>();
  const activeReviewProgressListeners = singleton
    ? reviewProgressListeners
    : new Set<(payload: ReviewProgressEvent) => void>();
  const activeUsageUpdatedListeners = singleton
    ? usageUpdatedListeners
    : new Set<(payload: any) => void>();

  if (singleton) {
    window.desktopBridge?.onSystemResume?.(() => {
      transport.reconnectAfterSystemResume();
    });
  }

  let streamConfig: ServerConfigUpdatedPayload | null = null;
  transport.subscribeRpc<ServerConfigStreamEvent>(
    WS_METHODS.subscribeServerConfig,
    () => ({}),
    Schema.decodeUnknownSync(ServerConfigStreamEvent),
    (event) => {
      if (event.type === "snapshot") {
        streamConfig = {
          issues: event.config.issues,
          providers: event.config.providers,
          settings: event.config.settings,
          environmentThemes: event.config.environmentThemes,
          usageLimitSources: event.config.usageLimitSources,
        };
      } else if (streamConfig) {
        if (event.type === "providerStatuses")
          streamConfig = { ...streamConfig, providers: event.payload.providers };
        else if (event.type === "settingsUpdated")
          streamConfig = { ...streamConfig, settings: event.payload.settings };
        else if (event.type === "keybindingsUpdated")
          streamConfig = { ...streamConfig, issues: event.payload.issues };
        else if (event.type === "environmentThemesUpdated")
          streamConfig = { ...streamConfig, environmentThemes: event.payload.themes };
        else if (event.type === "usageLimitSourcesUpdated")
          streamConfig = { ...streamConfig, usageLimitSources: event.payload.sources };
      }
      if (!streamConfig) return;
      if (singleton) latestV2Config = streamConfig;
      // Keybinding reloads are notifications, not settings changes. Keep the
      // complete cached snapshot for replay without suppressing validation toasts.
      const { settings: _settings, ...keybindingsUpdate } = streamConfig;
      const notification = event.type === "keybindingsUpdated" ? keybindingsUpdate : streamConfig;
      for (const listener of activeServerConfigUpdatedListeners) listener(notification);
      if (event.type === "snapshot" || event.type === "providerStatuses") {
        const payload = { providers: streamConfig.providers };
        if (singleton) latestV2Providers = payload;
        for (const listener of activeProvidersUpdatedListeners) listener(payload);
      }
    },
    () => undefined,
  );

  transport.subscribe(WS_CHANNELS.serverWelcome, (message) => {
    const payload = message.data;
    for (const listener of activeWelcomeListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(WS_CHANNELS.serverConfigUpdated, (message) => {
    const payload = message.data;
    for (const listener of activeServerConfigUpdatedListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(WS_CHANNELS.serverProvidersUpdated, (message) => {
    const payload = message.data;
    for (const listener of activeProvidersUpdatedListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(WS_CHANNELS.gitActionProgress, (message) => {
    const payload = message.data;
    for (const listener of activeGitActionProgressListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(WS_CHANNELS.reviewProgress, (message) => {
    const payload = message.data;
    for (const listener of activeReviewProgressListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(WS_CHANNELS.usageUpdated, (message) => {
    const payload = message.data;
    for (const listener of activeUsageUpdatedListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });

  const api: NativeApi = {
    testing: {
      getStatus: (input) => transport.request(WS_METHODS.testingGetStatus, input),
      getLocatorLibrary: (input) => transport.request(WS_METHODS.testingGetLocatorLibrary, input),
      setDiscoveryExperience: (input) =>
        transport.request(WS_METHODS.testingSetDiscoveryExperience, input),
      getCaseIdPolicy: (input) => transport.request(WS_METHODS.testingGetCaseIdPolicy, input),
      setCaseIdPolicy: (input) => transport.request(WS_METHODS.testingSetCaseIdPolicy, input),
      getTestInventory: (input) => transport.request(WS_METHODS.testingGetTestInventory, input),
      startLocatorDiscovery: (input) =>
        transport.request(WS_METHODS.testingStartLocatorDiscovery, input, { timeoutMs: null }),
      navigateLocatorDiscovery: (input) =>
        transport.request(WS_METHODS.testingNavigateLocatorDiscovery, input, { timeoutMs: null }),
      captureLocatorPage: (input) =>
        transport.request(WS_METHODS.testingCaptureLocatorPage, input, { timeoutMs: null }),
      finishLocatorDiscovery: (input) =>
        transport.request(WS_METHODS.testingFinishLocatorDiscovery, input, { timeoutMs: null }),
      cancelLocatorDiscovery: (input) =>
        transport.request(WS_METHODS.testingCancelLocatorDiscovery, input, { timeoutMs: null }),
      reviewLocatorEntry: (input) => transport.request(WS_METHODS.testingReviewLocatorEntry, input),
      updateLocatorPage: (input) => transport.request(WS_METHODS.testingUpdateLocatorPage, input),
      setLocatorPageSelection: (input) =>
        transport.request(WS_METHODS.testingSetLocatorPageSelection, input),
      deleteLocatorPage: (input) => transport.request(WS_METHODS.testingDeleteLocatorPage, input),
      updatePageObjectCode: (input) =>
        transport.request(WS_METHODS.testingUpdatePageObjectCode, input),
      previewLocatorRepositoryWrite: (input) =>
        transport.request(WS_METHODS.testingPreviewLocatorRepositoryWrite, input),
      applyLocatorRepositoryWrite: (input) =>
        transport.request(WS_METHODS.testingApplyLocatorRepositoryWrite, input),
      previewLocatorSync: (input) => transport.request(WS_METHODS.testingPreviewLocatorSync, input),
      resolveLocatorSync: (input) => transport.request(WS_METHODS.testingResolveLocatorSync, input),
      disconnectLocatorFolder: (input) =>
        transport.request(WS_METHODS.testingDisconnectLocatorFolder, input),
      indexLocatorFolder: (input) =>
        transport.request(WS_METHODS.testingIndexLocatorFolder, input, { timeoutMs: null }),
      verifyLocators: (input) =>
        transport.request(WS_METHODS.testingVerifyLocators, input, { timeoutMs: null }),
      importUserStory: (input) =>
        transport.request(WS_METHODS.testingImportUserStory, input, { timeoutMs: null }),
      startAuthCapture: (input) =>
        transport.request(WS_METHODS.testingStartAuthCapture, input, { timeoutMs: null }),
      finishAuthCapture: (input) =>
        transport.request(WS_METHODS.testingFinishAuthCapture, input, { timeoutMs: null }),
      startExploration: (input) =>
        transport.request(WS_METHODS.testingStartExploration, input, { timeoutMs: null }),
      importWorkbook: (input) =>
        transport.request(WS_METHODS.testingImportWorkbook, input, { timeoutMs: null }),
      listCases: (input) => transport.request(WS_METHODS.testingListCases, input),
      createCase: (input) => transport.request(WS_METHODS.testingCreateCase, input),
      reviewCase: (input) => transport.request(WS_METHODS.testingReviewCase, input),
      deleteCase: (input) => transport.request(WS_METHODS.testingDeleteCase, input),
      updateCaseGroup: (input) => transport.request(WS_METHODS.testingUpdateCaseGroup, input),
      createCaseGroup: (input) => transport.request(WS_METHODS.testingCreateCaseGroup, input),
      deleteCaseGroup: (input) => transport.request(WS_METHODS.testingDeleteCaseGroup, input),
      generateScenarios: (input) =>
        transport.request(WS_METHODS.testingGenerateScenarios, input, { timeoutMs: null }),
      clearGraph: (input) => transport.request(WS_METHODS.testingClearGraph, input),
      generateTests: (input) =>
        transport.request(WS_METHODS.testingGenerateTests, input, { timeoutMs: null }),
      listGenerationJobs: (input) => transport.request(WS_METHODS.testingListGenerationJobs, input),
      cancelGenerationJob: (input) =>
        transport.request(WS_METHODS.testingCancelGenerationJob, input),
      readArtifact: (input) => transport.request(WS_METHODS.testingReadArtifact, input),
      runTests: (input) =>
        transport.request(WS_METHODS.testingRunTests, input, { timeoutMs: null }),
      cancelExecutionRun: (input) => transport.request(WS_METHODS.testingCancelExecutionRun, input),
      listExecutionRuns: (input) => transport.request(WS_METHODS.testingListExecutionRuns, input),
      decideHealingProposal: (input) =>
        transport.request(WS_METHODS.testingDecideHealingProposal, input),
      createSchedule: (input) => transport.request(WS_METHODS.testingCreateSchedule, input),
      listSchedules: (input) => transport.request(WS_METHODS.testingListSchedules, input),
      generateReport: (input) =>
        transport.request(WS_METHODS.testingGenerateReport, input, { timeoutMs: null }),
      getTraceability: (input) => transport.request(WS_METHODS.testingGetTraceability, input),
      draftBug: (input) => transport.request(WS_METHODS.testingDraftBug, input),
      getGraphExplorer: (input) => transport.request(WS_METHODS.testingGetGraphExplorer, input),
      triageFailure: (input) =>
        transport.request(WS_METHODS.testingTriageFailure, input, { timeoutMs: null }),
    },
    dialogs: {
      pickFolder: async (options) => {
        if (!window.desktopBridge) return null;
        return window.desktopBridge.pickFolder(options);
      },
      pickFile: async (options) => {
        if (!window.desktopBridge) return null;
        return window.desktopBridge.pickFile(options);
      },
      confirm: async (message) => {
        return showCustomConfirm(message);
      },
    },
    terminal: {
      open: (input) => transport.request(WS_METHODS.terminalOpen, input),
      list: () => transport.request(WS_METHODS.terminalList, {}),
      write: (input) => transport.request(WS_METHODS.terminalWrite, input),
      resize: (input) => transport.request(WS_METHODS.terminalResize, input),
      clear: (input) => transport.request(WS_METHODS.terminalClear, input),
      restart: (input) => transport.request(WS_METHODS.terminalRestart, input),
      close: (input) => transport.request(WS_METHODS.terminalClose, input),
      onEvent: (callback) => {
        const unsubscribePush = transport.subscribe(WS_CHANNELS.terminalEvent, (message) =>
          callback(message.data),
        );
        const unsubscribeRpc = transport.subscribeRpc(
          WS_METHODS.subscribeTerminalEvents,
          () => ({}),
          Schema.decodeUnknownSync(TerminalEventSchema),
          callback,
          (error) => console.error("Terminal event subscription failed:", error),
        );
        return () => {
          unsubscribePush();
          unsubscribeRpc();
        };
      },
      attach: () => () => {},
      onMetadata: () => () => {},
    },
    projects: {
      searchEntries: (input) => transport.request(WS_METHODS.projectsSearchEntries, input),
      searchContents: (input) => transport.request(WS_METHODS.projectsSearchContents, input),
      readFile: (input) => transport.request(WS_METHODS.projectsReadFile, input),
      writeFile: (input) => transport.request(WS_METHODS.projectsWriteFile, input),
      filesystemBrowse: (input) => transport.request(WS_METHODS.filesystemBrowse, input),
      listEntries: (input) => transport.request(WS_METHODS.projectsListEntries, input),
    },
    filesystem: {
      browse: (input) => transport.request(WS_METHODS.filesystemBrowse, input),
    },
    repositories: {
      clone: async (input) => {
        if (!window.desktopBridge) {
          return { ok: false, error: "Cloning a repository requires the desktop app." };
        }
        return window.desktopBridge.cloneRepository(input);
      },
    },
    shell: {
      openInEditor: (cwd, editor) =>
        transport.request(WS_METHODS.shellOpenInEditor, { cwd, editor }),
      openExternal: async (url) => {
        if (window.desktopBridge) {
          const opened = await window.desktopBridge.openExternal(url);
          if (!opened) {
            throw new Error("Unable to open link.");
          }
          return;
        }

        // Some mobile browsers can return null here even when the tab opens.
        // Avoid false negatives and let the browser handle popup policy.
        window.open(url, "_blank", "noopener,noreferrer");
      },
    },
    git: {
      fetch: (input) => transport.request(WS_METHODS.gitFetch, input),
      pull: (input) => transport.request(WS_METHODS.gitPull, input),
      status: (input) => transport.request(WS_METHODS.gitStatus, input),
      runStackedAction: async (input) => {
        let completed: GitRunStackedActionResult | undefined;
        const legacyResult = await transport.request<GitRunStackedActionResult>(
          WS_METHODS.gitRunStackedAction,
          input,
          {
            timeoutMs: null,
            onChunk: (values) => {
              for (const value of values) {
                const event = Schema.decodeUnknownSync(GitActionProgressEvent)(value);
                if (event.kind === "action_finished") completed = event.result;
                for (const listener of activeGitActionProgressListeners) listener(event);
              }
            },
          },
        );
        if (completed) return completed;
        if (legacyResult) return legacyResult;
        throw new Error(
          "Git operation ended without a completion result. Refresh repository status before retrying.",
        );
      },
      listBranches: (input) => transport.request(WS_METHODS.gitListBranches, input),
      listWorkflowRuns: (input) => transport.request(WS_METHODS.gitListWorkflowRuns, input),
      createWorktree: (input) => transport.request(WS_METHODS.gitCreateWorktree, input),
      removeWorktree: (input) => transport.request(WS_METHODS.gitRemoveWorktree, input),
      createBranch: (input) => transport.request(WS_METHODS.gitCreateBranch, input),
      createFork: (input) =>
        transport.request(WS_METHODS.gitCreateFork, input, { timeoutMs: 45_000 }),
      checkout: (input) => transport.request(WS_METHODS.gitCheckout, input),
      renameBranch: (input) => transport.request(WS_METHODS.gitRenameBranch, input),
      deleteBranch: (input) => transport.request(WS_METHODS.gitDeleteBranch, input),
      setBranchUpstream: (input) => transport.request(WS_METHODS.gitSetBranchUpstream, input),
      init: (input) => transport.request(WS_METHODS.gitInit, input),
      history: (input) => transport.request(WS_METHODS.gitHistory, input),
      diff: (input) => transport.request(WS_METHODS.gitDiff, input),
      stageFiles: (input) => transport.request(WS_METHODS.gitStageFiles, input),
      unstageFiles: (input) => transport.request(WS_METHODS.gitUnstageFiles, input),
      discardChanges: (input) => transport.request(WS_METHODS.gitDiscardChanges, input),
      saveStash: (input) => transport.request(WS_METHODS.gitSaveStash, input),
      listStashes: (input) => transport.request(WS_METHODS.gitListStashes, input),
      applyStash: (input) => transport.request(WS_METHODS.gitApplyStash, input),
      dropStash: (input) => transport.request(WS_METHODS.gitDropStash, input),
      resolveConflict: (input) => transport.request(WS_METHODS.gitResolveConflict, input),
      readConflictSnapshot: (input) => transport.request(WS_METHODS.gitConflictSnapshot, input),
      applyHunk: (input) => transport.request(WS_METHODS.gitApplyHunk, input),
      merge: (input) => transport.request(WS_METHODS.gitMerge, input),
      rebase: (input) => transport.request(WS_METHODS.gitRebase, input),
      continueOperation: (input) => transport.request(WS_METHODS.gitContinueOperation, input),
      abortOperation: (input) => transport.request(WS_METHODS.gitAbortOperation, input),
      skipRebase: (input) => transport.request(WS_METHODS.gitSkipRebase, input),
      resolvePullRequest: (input) => transport.request(WS_METHODS.gitResolvePullRequest, input),
      listPullRequests: (input) => transport.request(WS_METHODS.gitListPullRequests, input),
      mutatePullRequest: (input) => transport.request(WS_METHODS.gitMutatePullRequest, input),
      createPullRequest: (input) => transport.request(WS_METHODS.gitCreatePullRequest, input),
      preparePullRequestThread: (input) =>
        transport.request(WS_METHODS.gitPreparePullRequestThread, input),
      push: (input) => transport.request(WS_METHODS.gitPush, input),
      performRepositoryAction: (input) =>
        transport.request(WS_METHODS.gitPerformRepositoryAction, input),
      publishRelease: (input) => transport.request(WS_METHODS.gitPublishRelease, input),
      triggerReleaseWorkflow: (input) =>
        transport.request(WS_METHODS.gitTriggerReleaseWorkflow, input),
      environment: (input) => transport.request(WS_METHODS.gitEnvironment, input),
      gitHubSwitchAccount: (input) =>
        transport.request(WS_METHODS.gitHubSwitchAccount, input, { timeoutMs: null }),
      gitHubLogout: (input) => transport.request(WS_METHODS.gitHubLogout, input),
      amendCommit: (input) => transport.request(WS_METHODS.gitAmendCommit, input),
      undoLastCommit: (input) => transport.request(WS_METHODS.gitUndoLastCommit, input),
      revertCommit: (input) => transport.request(WS_METHODS.gitRevertCommit, input),
      cherryPick: (input) => transport.request(WS_METHODS.gitCherryPick, input),
      createTag: (input) => transport.request(WS_METHODS.gitCreateTag, input),
      listTags: (input) => transport.request(WS_METHODS.gitListTags, input),
      watchedBranchStatuses: (input) =>
        transport.request(WS_METHODS.gitWatchedBranchStatuses, input),
      generateDiffSummary: (input) => transport.request(WS_METHODS.gitGenerateDiffSummary, input),
      generateReview: (input) =>
        transport.request(WS_METHODS.gitGenerateReview, input, { timeoutMs: null }),
      submitFindingFeedback: (input) =>
        transport.request(WS_METHODS.gitSubmitFindingFeedback, input),
      getReviewHistory: (input) => transport.request(WS_METHODS.gitGetReviewHistory, input),

      onActionProgress: (callback) => {
        activeGitActionProgressListeners.add(callback);
        return () => {
          activeGitActionProgressListeners.delete(callback);
        };
      },
      onReviewProgress: (callback) => {
        activeReviewProgressListeners.add(callback);
        return () => {
          activeReviewProgressListeners.delete(callback);
        };
      },
    },
    contextMenu: {
      show: async <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
      ): Promise<T | null> => {
        if (window.desktopBridge) {
          return window.desktopBridge.showContextMenu(items, position) as Promise<T | null>;
        }
        return showContextMenuFallback(items, position);
      },
    },
    server: {
      getConfig: () => transport.request(WS_METHODS.serverGetConfig),
      refreshProviders: (input) => transport.request(WS_METHODS.serverRefreshProviders, input),
      runProviderMaintenance: (input) =>
        transport.request(WS_METHODS.serverRunProviderMaintenance, input, { timeoutMs: 310_000 }),
      upsertKeybinding: (input) => transport.request(WS_METHODS.serverUpsertKeybinding, input),
      batchUpsertKeybindings: (input) =>
        transport.request(WS_METHODS.serverBatchUpsertKeybindings, input),
      batchRemoveKeybindings: (input) =>
        transport.request(WS_METHODS.serverBatchRemoveKeybindings, input),
      removeKeybinding: (input) => transport.request(WS_METHODS.serverRemoveKeybinding, input),
      getSettings: () => transport.request(WS_METHODS.serverGetSettings),
      updateSettings: (patch) => transport.request(WS_METHODS.serverUpdateSettings, { patch }),
      discoverSourceControl: () => transport.request(WS_METHODS.serverDiscoverSourceControl),
      cloneRepository: (input) => transport.request(WS_METHODS.serverCloneRepository, input),
      lookupRepository: (input) => transport.request(WS_METHODS.serverLookupRepository, input),
      updateProvider: (input) => transport.request(WS_METHODS.serverUpdateProvider, input),
      getTraceDiagnostics: () => transport.request(WS_METHODS.serverGetTraceDiagnostics),
      getProcessDiagnostics: () => transport.request(WS_METHODS.serverGetProcessDiagnostics),
      getProcessResourceHistory: (input) =>
        transport.request(WS_METHODS.serverGetProcessResourceHistory, input),
      getResourceTelemetry: () => transport.request(WS_METHODS.serverGetResourceTelemetry),
      getResourceTelemetryHistory: (input) =>
        transport.request(WS_METHODS.serverGetResourceTelemetryHistory, input),
      retryResourceTelemetry: () => transport.request(WS_METHODS.serverRetryResourceTelemetry),
      signalProcess: (input) => transport.request(WS_METHODS.serverSignalProcess, input),
      createSupportBundle: () => transport.request(WS_METHODS.serverCreateSupportBundle),
      reportClientActivity: (input) =>
        transport.request(WS_METHODS.serverReportClientActivity, input, {
          timeoutMs: 10_000,
          coalesceKey: `clientActivity:${input.clientId}`,
        }),
      reportHostPowerState: (input) =>
        transport.request(WS_METHODS.serverReportHostPowerState, input, {
          timeoutMs: 10_000,
          coalesceKey: "hostPowerState",
        }),
      getBackgroundPolicy: () => transport.request(WS_METHODS.serverGetBackgroundPolicy, {}),
      onBackgroundPolicy: (callback) =>
        transport.subscribe(WS_CHANNELS.backgroundPolicyUpdated, (message) =>
          callback(message.data),
        ),
      onResourceTelemetry: (callback) =>
        transport.subscribeRpc(
          WS_METHODS.subscribeResourceTelemetry,
          () => ({}),
          Schema.decodeUnknownSync(ResourceTelemetrySnapshot),
          callback,
          (error) => console.error("Resource telemetry stream failed", error),
        ),
      readUsageSummary: (input) => transport.request("server.getUsageSummary", input),
      listUsageSnapshots: async (input = {}) => {
        if (input.forceRefresh) await transport.request(WS_METHODS.serverRefreshProviders, {});
        const config = await transport.request<ServerConfigUpdatedPayload>(
          WS_METHODS.serverGetConfig,
        );
        return providerUsageSnapshots(config.providers, input.provider);
      },
      refreshAllUsageSnapshots: async () => {
        await transport.request(WS_METHODS.serverRefreshProviders, {});
        const config = await transport.request<ServerConfigUpdatedPayload>(
          WS_METHODS.serverGetConfig,
        );
        return providerUsageSnapshots(config.providers);
      },
      consumeResetCredit: (input) =>
        transport.request(WS_METHODS.providerConsumeResetCredit, input),
    },
    scheduledTasks: {
      list: () => transport.request(WS_METHODS.scheduledTasksList, {}),
      subscribe: (callback, onError) =>
        transport.subscribeRpc(
          WS_METHODS.scheduledTasksSubscribe,
          () => ({}),
          Schema.decodeUnknownSync(ScheduledTaskListResult),
          callback,
          onError,
        ),
      upsert: (input) => transport.request(WS_METHODS.scheduledTasksUpsert, input),
      setEnabled: (input) => transport.request(WS_METHODS.scheduledTasksSetEnabled, input),
      delete: (input) => transport.request(WS_METHODS.scheduledTasksDelete, input),
      runNow: (input) => transport.request(WS_METHODS.scheduledTasksRunNow, input),
      rotateWebhookToken: (input) =>
        transport.request(WS_METHODS.scheduledTasksRotateWebhookToken, input),
      listWebhookDeliveries: (input) =>
        transport.request(WS_METHODS.scheduledTasksListWebhookDeliveries, input),
      getWebhookDelivery: (input) =>
        transport.request(WS_METHODS.scheduledTasksGetWebhookDelivery, input),
    },
    orchestration: {
      getSnapshot: async (environmentId?: string) => {
        const { appAtomRegistry } = await import("./state/atomRegistry");
        const { readModelStateAtom } = await import("./state/readModel");
        const { getPrimaryEnvironmentId, isPrimaryEnvironment } =
          await import("./connection/environmentApiRegistry");
        const state = appAtomRegistry.get(readModelStateAtom);
        const primaryEnv = getPrimaryEnvironmentId();
        const targetEnv = environmentId ?? transport.environmentId ?? primaryEnv ?? "primary";

        const meta =
          state.environmentSnapshots?.[targetEnv] ??
          (targetEnv === "primary" || isPrimaryEnvironment(targetEnv)
            ? (state.environmentSnapshots?.["primary"] ??
              (primaryEnv ? state.environmentSnapshots?.[primaryEnv] : undefined))
            : undefined);

        if (!meta || !meta.initialized) {
          throw new Error(
            `Orchestration snapshot unavailable: initial snapshot has not been received for environment ${targetEnv}.`,
          );
        }

        const isTargetPrimary = targetEnv === "primary" || isPrimaryEnvironment(targetEnv);
        const envProjects = state.projects.filter((p) =>
          isTargetPrimary
            ? p.environmentId === undefined || isPrimaryEnvironment(p.environmentId)
            : p.environmentId === targetEnv,
        );
        const envThreads = state.threads.filter((t) =>
          isTargetPrimary
            ? t.environmentId === undefined || isPrimaryEnvironment(t.environmentId)
            : t.environmentId === targetEnv,
        );

        return {
          snapshotSequence: meta.snapshotSequence,
          projects: envProjects as unknown as any[],
          threads: envThreads as unknown as any[],
          updatedAt: meta.updatedAt,
        } as unknown as OrchestrationReadModel;
      },
      dispatchCommand: (command) => {
        const normalized = normalizeOrchestrationCommand(command);
        if (
          normalized &&
          (normalized.type === "project.create" ||
            normalized.type === "project.update" ||
            normalized.type === "project.meta.update" ||
            normalized.type === "project.delete")
        ) {
          const type =
            normalized.type === "project.meta.update" ? "project.update" : normalized.type;
          return transport.request(WS_METHODS.projectsMutate, {
            type,
            commandId: normalized.commandId,
            projectId: normalized.projectId,
            ...(normalized.title !== undefined ? { title: normalized.title } : {}),
            ...(normalized.workspaceRoot !== undefined
              ? { workspaceRoot: normalized.workspaceRoot }
              : {}),
            ...(normalized.createWorkspaceRootIfMissing !== undefined
              ? { createWorkspaceRootIfMissing: normalized.createWorkspaceRootIfMissing }
              : {}),
            ...(normalized.defaultModelSelection !== undefined
              ? { defaultModelSelection: normalized.defaultModelSelection }
              : {}),
            ...(normalized.autoPull !== undefined ? { autoPull: normalized.autoPull } : {}),
            ...(normalized.projectIcon !== undefined
              ? { projectIcon: normalized.projectIcon }
              : {}),
            ...(normalized.faviconPath !== undefined
              ? { faviconPath: normalized.faviconPath }
              : {}),
            ...(normalized.defaultThreadEnvMode !== undefined
              ? { defaultThreadEnvMode: normalized.defaultThreadEnvMode }
              : {}),
            ...(normalized.scripts !== undefined ? { scripts: normalized.scripts } : {}),
            ...(normalized.force !== undefined ? { force: normalized.force } : {}),
          });
        }
        return transport.request(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, normalized);
      },
      getTurnDiff: (input) => transport.request(ORCHESTRATION_WS_METHODS.getTurnDiff, input),
      getFullThreadDiff: (input) =>
        transport.request(ORCHESTRATION_WS_METHODS.getFullThreadDiff, input),
      replayEvents: (fromSequenceExclusive) =>
        transport.request(ORCHESTRATION_WS_METHODS.replayEvents, { fromSequenceExclusive }),
      onDomainEvent: (callback) =>
        transport.subscribe(ORCHESTRATION_WS_CHANNELS.domainEvent, (message) =>
          callback(message.data),
        ),
      getArchivedShellSnapshot: () =>
        transport.request(ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot, {}),
      getThreadFamily: (input) =>
        transport.request(ORCHESTRATION_V2_WS_METHODS.getThreadFamily, input),
      getOlderSettledThreads: (input) =>
        transport.request(ORCHESTRATION_V2_WS_METHODS.getOlderSettledThreads, input),
      getThreadProjection: async (input) => {
        const complete = (projection: OrchestrationV2ThreadProjection) =>
          !(projection.turnItems ?? []).some(hasOmittedBodies) &&
          !(projection.visibleTurnItems ?? []).some((row) => hasOmittedBodies(row.item)) &&
          !(projection.subagents ?? []).some(hasOmittedBodies);
        const projection = restoreSnapshotBodies(
          await transport.request<OrchestrationV2ThreadProjection>(
            ORCHESTRATION_V2_WS_METHODS.getThreadProjection,
            { ...input, acceptDedupedBodies: true },
          ),
        );
        if (complete(projection)) return projection;
        const full = await transport.request<OrchestrationV2ThreadProjection>(
          ORCHESTRATION_V2_WS_METHODS.getThreadProjection,
          { ...input, acceptDedupedBodies: false },
        );
        if (!complete(full))
          throw new Error("The server returned an incomplete conversation. Reconnect and retry.");
        return full;
      },
      reconcileIntake: (input) =>
        transport.request(ORCHESTRATION_V2_WS_METHODS.reconcileIntake, input),
      recordCancellationIntent: (input) =>
        transport.request(ORCHESTRATION_V2_WS_METHODS.recordCancellationIntent, input),
      subscribeShell: (callback, options) => {
        let lastSeenSequence: number | undefined = undefined;
        let isFirst = true;
        return transport.subscribeRpc(
          ORCHESTRATION_V2_WS_METHODS.subscribeShell,
          () => {
            if (!isFirst) {
              options?.onResubscribe?.();
            }
            isFirst = false;
            return {
              ...(lastSeenSequence !== undefined ? { afterSequence: lastSeenSequence } : {}),
              ...(options?.omitIdleSubagents ? { omitIdleSubagents: true } : {}),
              ...(options?.omitOlderSettled ? { omitOlderSettled: true } : {}),
            };
          },
          (value) => {
            try {
              return decodeShellStreamItem(value);
            } catch {
              return value as any;
            }
          },
          (item) => {
            if ("sequence" in item && typeof item.sequence === "number") {
              lastSeenSequence = item.sequence;
            } else if (
              "kind" in item &&
              item.kind === "snapshot" &&
              "snapshot" in item &&
              typeof (item.snapshot as any)?.snapshotSequence === "number"
            ) {
              lastSeenSequence = (item.snapshot as any).snapshotSequence;
            }
            callback(item);
          },
          (error) => {
            console.error("Shell subscription error:", error);
          },
        );
      },
      subscribeThread: (input, callback, options) => {
        let lastSeenSequence: number | undefined =
          "afterSequence" in input && typeof input.afterSequence === "number"
            ? input.afterSequence
            : undefined;
        const threadId = "threadId" in input ? input.threadId : undefined;
        if (!threadId) return () => {};
        let isFirst = true;
        let stopped = false;
        let recovering = false;
        let generation = 0;
        let unsubscribe: (() => void) | undefined;
        const messageText = new Map<MessageId, string>();
        const checkpointFiles = new Map<CheckpointId, OrchestrationV2Checkpoint["files"]>();
        const subagents = new Map<NodeId, Pick<OrchestrationV2Subagent, "prompt" | "result">>();
        const versions = new Map<string, number>();
        const remember = <K, V>(cache: Map<K, V>, key: K, value: V) => {
          cache.delete(key);
          cache.set(key, value);
          if (cache.size > 32) cache.delete(cache.keys().next().value!);
        };
        const clear = () => {
          messageText.clear();
          checkpointFiles.clear();
          subagents.clear();
          versions.clear();
        };
        const source = {
          messageText: (id: MessageId) => messageText.get(id),
          checkpointFiles: (id: CheckpointId) => checkpointFiles.get(id),
          subagent: (id: NodeId) => subagents.get(id),
        };
        const rememberSubagent = (
          record: Pick<OrchestrationV2Subagent, "id" | "prompt" | "result">,
          sequence: number,
        ) => {
          remember(subagents, record.id, { prompt: record.prompt, result: record.result });
          remember(versions, `subagent:${record.id}`, sequence);
        };
        const sourceMatches = (payload: object, key: string | null) =>
          !hasOmittedBodies(payload) ||
          (key !== null &&
            "bodySourceSequence" in payload &&
            typeof payload.bodySourceSequence === "number" &&
            versions.get(key) === payload.bodySourceSequence);
        const recover = () => {
          // Suppress the incomplete event and all late callbacks from this subscription.
          generation++;
          recovering = true;
          lastSeenSequence = undefined;
          clear();
          const cancel = unsubscribe;
          cancel?.();
          queueMicrotask(() => {
            if (!cancel) unsubscribe?.();
            if (!stopped) start();
          });
        };
        const start = () => {
          const currentGeneration = ++generation;
          unsubscribe = transport.subscribeRpc(
            ORCHESTRATION_V2_WS_METHODS.subscribeThread,
            () => {
              if (!isFirst) options?.onResubscribe?.();
              isFirst = false;
              return {
                threadId,
                ...(lastSeenSequence !== undefined ? { afterSequence: lastSeenSequence } : {}),
                acceptDedupedBodies: !recovering,
                acceptVersionedLiveBodies: !recovering,
                acceptBoundedSnapshot: recovering
                  ? false
                  : "acceptBoundedSnapshot" in input
                    ? input.acceptBoundedSnapshot
                    : true,
              };
            },
            (value) => {
              try {
                return decodeThreadStreamItem(value);
              } catch {
                return value as OrchestrationV2ThreadStreamItem;
              }
            },
            (item) => {
              if (stopped || currentGeneration !== generation) return;
              if (item.kind === "snapshot") {
                const projection = restoreSnapshotBodies(item.projection);
                if (
                  projection.turnItems.some(hasOmittedBodies) ||
                  projection.visibleTurnItems.some((row) => hasOmittedBodies(row.item)) ||
                  projection.subagents.some(hasOmittedBodies)
                ) {
                  if (!recovering) recover();
                  else console.error(`Thread snapshot contains unresolved bodies for ${threadId}`);
                  return;
                }
                clear();
                for (const message of projection.messages) {
                  remember(messageText, message.id, message.text);
                  remember(versions, `message:${message.id}`, item.snapshotSequence);
                }
                for (const checkpoint of projection.checkpoints) {
                  remember(checkpointFiles, checkpoint.id, checkpoint.files);
                  remember(versions, `checkpoint:${checkpoint.id}`, item.snapshotSequence);
                }
                for (const record of projection.subagents)
                  rememberSubagent(record, item.snapshotSequence);
                lastSeenSequence = item.snapshotSequence;
                callback({ ...item, projection });
                return;
              }
              if (item.kind === "event") {
                if (lastSeenSequence !== undefined && item.sequence <= lastSeenSequence) return;
                const { event } = item;
                if (event.type === "subagent.updated" || event.type === "turn-item.updated") {
                  const key =
                    event.type === "subagent.updated"
                      ? `subagent:${event.payload.id}`
                      : turnItemBodySourceKey(event.payload);
                  if (!sourceMatches(event.payload, key)) {
                    recover();
                    return;
                  }
                  const payload = stripBodySourceSequence(
                    event.type === "subagent.updated"
                      ? restoreSubagentBodies(event.payload, subagents.get(event.payload.id))
                      : restoreTurnItemBodies(event.payload, source),
                  );
                  if (hasOmittedBodies(payload)) {
                    recover();
                    return;
                  }
                  lastSeenSequence = item.sequence;
                  if (event.type === "subagent.updated") {
                    const restored = payload as OrchestrationV2Subagent;
                    rememberSubagent(restored, item.sequence);
                    callback({ ...item, event: { ...event, payload: restored } });
                  } else
                    callback({
                      ...item,
                      event: { ...event, payload: payload as typeof event.payload },
                    });
                  return;
                }
                if (event.type === "message.updated") {
                  remember(messageText, event.payload.id, event.payload.text);
                  remember(versions, `message:${event.payload.id}`, item.sequence);
                } else if (event.type === "checkpoint.captured") {
                  remember(checkpointFiles, event.payload.id, event.payload.files);
                  remember(versions, `checkpoint:${event.payload.id}`, item.sequence);
                }
              }
              if ("sequence" in item)
                lastSeenSequence = Math.max(lastSeenSequence ?? 0, item.sequence);
              callback(item);
            },
            (error) => {
              if (!stopped && currentGeneration === generation)
                console.error(`Thread subscription error for ${threadId}:`, error);
            },
          );
        };
        start();
        return () => {
          stopped = true;
          generation++;
          clear();
          unsubscribe?.();
        };
      },
    },
    persistence: {
      getClientSettings: async () => null,
      setClientSettings: async () => {},
    } as any,
    assets: {
      createUrl: async (input) => {
        const result = await transport.request<AssetCreateUrlResult>(
          WS_METHODS.assetsCreateUrl,
          input,
        );
        return { ...result, relativeUrl: transport.resolveHttpUrl(result.relativeUrl) };
      },
      persistChatAttachments: (input) =>
        transport.request(WS_METHODS.assetsPersistChatAttachments, input),
    },
    sourceControl: {
      lookupRepository: async () => {
        throw new Error("Unsupported in web");
      },
      cloneRepository: async () => {
        throw new Error("Unsupported in web");
      },
      publishRepository: async () => {
        throw new Error("Unsupported in web");
      },
    } as any,
    vcs: {
      listRefs: async () => ({ refs: [], activeRef: null }),
      createWorktree: async () => ({ path: "", branch: "" }),
      removeWorktree: async () => {},
      createRef: async () => ({ ref: "" }),
      switchRef: async () => ({ ref: "" }),
      init: async () => {},
      pull: async () => ({ success: true }),
      refreshStatus: async () => ({ clean: true, changes: [] }),
      onStatus: () => () => {},
    } as any,
    review: {
      getDiffPreview: async () => {
        throw new Error("Unsupported in web");
      },
    } as any,
    preview: {
      open: (input) => transport.request(WS_METHODS.previewOpen, input),
      navigate: (input) => transport.request(WS_METHODS.previewNavigate, input),
      resize: (input) => transport.request(WS_METHODS.previewResize, input),
      refresh: (input) => transport.request(WS_METHODS.previewRefresh, input),
      close: (input) => transport.request(WS_METHODS.previewClose, input),
      list: (input) => transport.request(WS_METHODS.previewList, input),
      reportStatus: (input) => transport.request(WS_METHODS.previewReportStatus, input),
      automation: {
        connect: (input, callback, options) => {
          const unsubscribe = transport.subscribe(WS_CHANNELS.previewAutomationEvent, (message) =>
            callback(message.data),
          );
          let connectedOnce = false;
          const unsubscribeOpen = transport.onOpen(() => {
            if (connectedOnce) options?.onResubscribe?.();
            connectedOnce = true;
            void transport
              .request(WS_METHODS.previewAutomationConnect, input, { timeoutMs: null })
              .catch(() => undefined);
          });
          return () => {
            unsubscribeOpen();
            unsubscribe();
          };
        },
        respond: (input) => transport.request(WS_METHODS.previewAutomationRespond, input),
        focusHost: (input) => transport.request(WS_METHODS.previewAutomationFocusHost, input),
      },
      onEvent: (callback) =>
        transport.subscribe(WS_CHANNELS.previewEvent, (message) => callback(message.data)),
      subscribePorts: (callback, options) => {
        const unsubscribe = transport.subscribe(WS_CHANNELS.discoveredLocalServers, (message) =>
          callback(message.data),
        );
        let subscribedOnce = false;
        const unsubscribeOpen = transport.onOpen(() => {
          if (subscribedOnce) options?.onResubscribe?.();
          subscribedOnce = true;
          void transport
            .request(WS_METHODS.subscribeDiscoveredLocalServers, {}, { timeoutMs: null })
            .catch(() => undefined);
        });
        return () => {
          unsubscribeOpen();
          unsubscribe();
        };
      },
    },
    agentSessions: {
      scan: () => transport.request(WS_METHODS.agentSessionsScan, {}),
      import: (input) => transport.request(WS_METHODS.agentSessionsImport, input),
    },
  };

  apiProviderUpdates.set(api, {
    listeners: activeProvidersUpdatedListeners,
    latest: () => (streamConfig ? { providers: streamConfig.providers } : null),
  });
  if (singleton) instance = { api, transport };
  return api;
}
