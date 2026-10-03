import { Schema, Struct } from "effect";
import {
  BackgroundPolicySnapshot,
  ClientActivityReportInput,
  HostPowerSnapshot,
} from "./background.ts";
import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import {
  AgentSessionImportInput,
  AgentSessionImportResult,
  AgentSessionScanInput,
  AgentSessionScanResult,
} from "./agentSessions.ts";

import {
  ClientOrchestrationCommand,
  OrchestrationEvent,
  ORCHESTRATION_WS_CHANNELS,
  OrchestrationGetFullThreadDiffInput,
  ORCHESTRATION_WS_METHODS,
  OrchestrationGetSnapshotInput,
  OrchestrationGetTurnDiffInput,
  OrchestrationReplayEventsInput,
} from "./orchestration";
import {
  GitApplyHunkInput,
  GitApplyStashInput,
  GitAbortOperationInput,
  GitActionProgressEvent,
  GitCheckoutInput,
  GitContinueOperationInput,
  GitConflictSnapshotInput,
  GitCreateBranchInput,
  GitCreateForkInput,
  GitDeleteBranchInput,
  GitDiscardChangesInput,
  GitDiffInput,
  GitFetchInput,
  GitHistoryInput,
  GitMergeInput,
  GitPreparePullRequestThreadInput,
  GitCreateWorktreeInput,
  GitDropStashInput,
  GitInitInput,
  GitListBranchesInput,
  GitListPullRequestsInput,
  GitMutatePullRequestInput,
  GitCreatePullRequestInput,
  GitListWorkflowRunsInput,
  GitPullInput,
  GitPushInput,
  GitRepositoryActionInput,
  GitPublishReleaseInput,
  GitTriggerReleaseWorkflowInput,
  GitPullRequestRefInput,
  GitRemoveWorktreeInput,
  GitRenameBranchInput,
  GitRunStackedActionInput,
  GitResolveConflictInput,
  GitSetBranchUpstreamInput,
  GitSkipRebaseInput,
  GitStageFilesInput,
  GitStashListInput,
  GitStashSaveInput,
  GitStatusInput,
  GitRebaseInput,
  GitUnstageFilesInput,
  GitEnvironmentInput,
  GitHubSwitchAccountInput,
  GitHubLogoutInput,
  GitAmendCommitInput,
  GitUndoLastCommitInput,
  GitRevertCommitInput,
  GitCherryPickInput,
  GitCreateTagInput,
  GitListTagsInput,
  GitWatchedBranchStatusesInput,
  GitGenerateDiffSummaryInput,
  GitGenerateReviewInput,
  GitSubmitFindingFeedbackInput,
  GitGetReviewHistoryInput,
  ReviewCostPreviewEvent,
} from "./git";
import {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalWriteInput,
} from "./terminal";
import { KeybindingRule } from "./keybindings";
import {
  ProjectReadFileInput,
  ProjectSearchContentsInput,
  ProjectSearchEntriesInput,
  ProjectWriteFileInput,
} from "./project";
import { FilesystemBrowseInput } from "./filesystem";
import { OpenInEditorInput } from "./editor";
import { ProviderInstanceId } from "./providerInstance";
import { ProviderConsumeResetCreditInput } from "./providerUsageLimits";
import { UsageLimitSourceId } from "./usageLimitSourceId";
import {
  ServerBatchUpsertKeybindingsInput,
  ServerBatchRemoveKeybindingsInput,
  ServerConfigUpdatedPayload,
  ServerProviderUpdatedPayload,
  ServerRunProviderMaintenanceInput,
  ServerProcessResourceHistoryInput,
  ServerSignalProcessInput,
} from "./server";
import { ServerSettingsPatch } from "./settings";
import { ResourceTelemetryHistoryInput, ResourceTelemetrySnapshot } from "./resourceTelemetry";
import {
  SourceControlCloneRepositoryInput,
  SourceControlRepositoryLookupInput,
} from "./sourceControl";
import { ReviewProgressEvent } from "./review";
import {
  ConfiguredLocalServerUrls,
  DiscoveredLocalServerList,
  PreviewCloseInput,
  PreviewEvent,
  PreviewListInput,
  PreviewNavigateInput,
  PreviewOpenInput,
  PreviewRefreshInput,
  PreviewReportStatusInput,
  PreviewResizeInput,
} from "./preview";
import {
  PreviewAutomationHost,
  PreviewAutomationHostFocus,
  PreviewAutomationResponse,
  PreviewAutomationStreamEvent,
} from "./previewAutomation";
import {
  TestingCaseCreateInput,
  TestingCaseDeleteInput,
  TestingCaseGroupUpdateInput,
  TestingCaseGroupCreateInput,
  TestingCaseGroupDeleteInput,
  TestingCaseReviewInput,
  TestingCaseIdPolicyInput,
  TestingBugDraftInput,
  TestingDiscoveryExperienceInput,
  TestingExplorationInput,
  TestingExecutionInput,
  TestingExecutionRunInput,
  TestingGenerationInput,
  TestingGenerationJobInput,
  TestingArtifactReadInput,
  TestingHealingDecisionInput,
  TestingLocatorDiscoveryInput,
  TestingLocatorDiscoveryNavigateInput,
  TestingLocatorDiscoverySessionInput,
  TestingLocatorEntryReviewInput,
  TestingLocatorPageDeleteInput,
  TestingLocatorPageSelectionInput,
  TestingLocatorPageUpdateInput,
  TestingPageObjectCodeUpdateInput,
  TestingLocatorRepositoryApplyInput,
  TestingLocatorRepositoryPreviewInput,
  TestingLocatorSyncDecisionInput,
  TestingLocatorFolderInput,
  TestingLocatorVerificationInput,
  TestingProjectInput,
  TestingReportInput,
  TestingScheduleInput,
  TestingTargetInput,
  TestingStoryImportInput,
  TestingTraceabilityInput,
  TestingTriageInput,
  TestingWorkbookImportInput,
} from "./testing";
import {
  ServerListProviderUsageInput,
  ServerListProviderUsageResult,
  UsageSummaryInput,
} from "./usage";

// ── WebSocket RPC Method Names ───────────────────────────────────────

export const WS_METHODS = {
  testingGetStatus: "testing.getStatus",
  testingGetLocatorLibrary: "testing.getLocatorLibrary",
  testingSetDiscoveryExperience: "testing.setDiscoveryExperience",
  testingGetCaseIdPolicy: "testing.getCaseIdPolicy",
  testingSetCaseIdPolicy: "testing.setCaseIdPolicy",
  testingGetTestInventory: "testing.getTestInventory",
  testingStartLocatorDiscovery: "testing.startLocatorDiscovery",
  testingNavigateLocatorDiscovery: "testing.navigateLocatorDiscovery",
  testingCaptureLocatorPage: "testing.captureLocatorPage",
  testingFinishLocatorDiscovery: "testing.finishLocatorDiscovery",
  testingCancelLocatorDiscovery: "testing.cancelLocatorDiscovery",
  testingReviewLocatorEntry: "testing.reviewLocatorEntry",
  testingUpdateLocatorPage: "testing.updateLocatorPage",
  testingSetLocatorPageSelection: "testing.setLocatorPageSelection",
  testingDeleteLocatorPage: "testing.deleteLocatorPage",
  testingUpdatePageObjectCode: "testing.updatePageObjectCode",
  testingPreviewLocatorRepositoryWrite: "testing.previewLocatorRepositoryWrite",
  testingApplyLocatorRepositoryWrite: "testing.applyLocatorRepositoryWrite",
  testingPreviewLocatorSync: "testing.previewLocatorSync",
  testingResolveLocatorSync: "testing.resolveLocatorSync",
  testingDisconnectLocatorFolder: "testing.disconnectLocatorFolder",
  testingIndexLocatorFolder: "testing.indexLocatorFolder",
  testingVerifyLocators: "testing.verifyLocators",
  testingImportUserStory: "testing.importUserStory",
  testingStartAuthCapture: "testing.startAuthCapture",
  testingFinishAuthCapture: "testing.finishAuthCapture",
  testingStartExploration: "testing.startExploration",
  testingImportWorkbook: "testing.importWorkbook",
  testingListCases: "testing.listCases",
  testingCreateCase: "testing.createCase",
  testingReviewCase: "testing.reviewCase",
  testingDeleteCase: "testing.deleteCase",
  testingUpdateCaseGroup: "testing.updateCaseGroup",
  testingCreateCaseGroup: "testing.createCaseGroup",
  testingDeleteCaseGroup: "testing.deleteCaseGroup",
  testingGenerateScenarios: "testing.generateScenarios",
  testingClearGraph: "testing.clearGraph",
  testingGenerateTests: "testing.generateTests",
  testingListGenerationJobs: "testing.listGenerationJobs",
  testingCancelGenerationJob: "testing.cancelGenerationJob",
  testingReadArtifact: "testing.readArtifact",
  testingRunTests: "testing.runTests",
  testingCancelExecutionRun: "testing.cancelExecutionRun",
  testingListExecutionRuns: "testing.listExecutionRuns",
  testingDecideHealingProposal: "testing.decideHealingProposal",
  testingCreateSchedule: "testing.createSchedule",
  testingListSchedules: "testing.listSchedules",
  testingGenerateReport: "testing.generateReport",
  testingGetTraceability: "testing.getTraceability",
  testingDraftBug: "testing.draftBug",
  testingGetGraphExplorer: "testing.getGraphExplorer",
  testingTriageFailure: "testing.triageFailure",
  projectsAdd: "projects.add",
  projectsList: "projects.list",
  projectsListEntries: "projects.listEntries",
  projectsReadFile: "projects.readFile",
  projectsRemove: "projects.remove",
  projectsSearchContents: "projects.searchContents",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",
  shellOpenInEditor: "shell.openInEditor",
  filesystemBrowse: "filesystem.browse",
  assetsCreateUrl: "assets.createUrl",
  gitAbortOperation: "git.abortOperation",
  gitAmendCommit: "git.amendCommit",
  gitApplyHunk: "git.applyHunk",
  gitApplyStash: "git.applyStash",
  gitCheckout: "git.checkout",
  gitCherryPick: "git.cherryPick",
  gitConflictSnapshot: "git.conflictSnapshot",
  gitContinueOperation: "git.continueOperation",
  gitCreateBranch: "git.createBranch",
  gitCreateFork: "git.createFork",
  gitCreateTag: "git.createTag",
  gitListTags: "git.listTags",
  gitWatchedBranchStatuses: "git.watchedBranchStatuses",
  gitGenerateDiffSummary: "git.generateDiffSummary",
  gitGenerateReview: "git.generateReview",
  gitSubmitFindingFeedback: "git.submitFindingFeedback",
  gitGetReviewHistory: "git.getReviewHistory",

  gitCreateWorktree: "git.createWorktree",
  gitDeleteBranch: "git.deleteBranch",
  gitDiff: "git.diff",
  gitDiscardChanges: "git.discardChanges",
  gitDropStash: "git.dropStash",
  gitEnvironment: "git.environment",
  gitFetch: "git.fetch",
  gitHistory: "git.history",
  gitHubLogout: "git.gitHubLogout",
  gitHubSwitchAccount: "git.gitHubSwitchAccount",
  gitInit: "git.init",
  gitListBranches: "git.listBranches",
  gitListPullRequests: "git.listPullRequests",
  gitMutatePullRequest: "git.mutatePullRequest",
  gitCreatePullRequest: "git.createPullRequest",
  gitListStashes: "git.listStashes",
  gitListWorkflowRuns: "git.listWorkflowRuns",
  gitMerge: "git.merge",
  gitPreparePullRequestThread: "git.preparePullRequestThread",
  gitPull: "git.pull",
  gitPush: "git.push",
  gitPerformRepositoryAction: "git.performRepositoryAction",
  gitPublishRelease: "git.publishRelease",
  gitTriggerReleaseWorkflow: "git.triggerReleaseWorkflow",
  gitRebase: "git.rebase",
  gitRemoveWorktree: "git.removeWorktree",
  gitRenameBranch: "git.renameBranch",
  gitResolveConflict: "git.resolveConflict",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitRevertCommit: "git.revertCommit",
  gitRunStackedAction: "git.runStackedAction",
  gitSaveStash: "git.saveStash",
  gitSetBranchUpstream: "git.setBranchUpstream",
  gitSkipRebase: "git.skipRebase",
  gitStageFiles: "git.stageFiles",
  gitStatus: "git.status",
  gitUndoLastCommit: "git.undoLastCommit",
  gitUnstageFiles: "git.unstageFiles",
  vcsCreateRef: "vcs.createRef",
  vcsCreateWorktree: "vcs.createWorktree",
  vcsInit: "vcs.init",
  vcsListRefs: "vcs.listRefs",
  vcsPull: "vcs.pull",
  vcsRefreshStatus: "vcs.refreshStatus",
  vcsRemoveWorktree: "vcs.removeWorktree",
  vcsSwitchRef: "vcs.switchRef",
  reviewGetDiffPreview: "review.getDiffPreview",
  terminalAttach: "terminal.attach",
  terminalClear: "terminal.clear",
  terminalClose: "terminal.close",
  terminalList: "terminal.list",
  terminalOpen: "terminal.open",
  terminalResize: "terminal.resize",
  terminalRestart: "terminal.restart",
  terminalWrite: "terminal.write",
  previewAutomationConnect: "previewAutomation.connect",
  previewAutomationFocusHost: "previewAutomation.focusHost",
  previewAutomationRespond: "previewAutomation.respond",
  previewClose: "preview.close",
  previewList: "preview.list",
  previewNavigate: "preview.navigate",
  previewOpen: "preview.open",
  previewRefresh: "preview.refresh",
  previewReportStatus: "preview.reportStatus",
  previewResize: "preview.resize",
  serverCloneRepository: "server.cloneRepository",
  serverDiscoverSourceControl: "server.discoverSourceControl",
  serverGetConfig: "server.getConfig",
  serverGetProcessDiagnostics: "server.getProcessDiagnostics",
  serverGetProcessResourceHistory: "server.getProcessResourceHistory",
  serverGetResourceTelemetry: "server.getResourceTelemetry",
  serverGetResourceTelemetryHistory: "server.getResourceTelemetryHistory",
  serverRetryResourceTelemetry: "server.retryResourceTelemetry",
  serverGetSettings: "server.getSettings",
  serverGetTraceDiagnostics: "server.getTraceDiagnostics",
  serverLookupRepository: "server.lookupRepository",
  serverRefreshProviders: "server.refreshProviders",
  serverRemoveKeybinding: "server.removeKeybinding",
  serverRunProviderMaintenance: "server.runProviderMaintenance",
  serverSignalProcess: "server.signalProcess",
  serverCreateSupportBundle: "server.createSupportBundle",
  serverReportClientActivity: "server.reportClientActivity",
  serverReportHostPowerState: "server.reportHostPowerState",
  serverGetBackgroundPolicy: "server.getBackgroundPolicy",
  serverUpdateProvider: "server.updateProvider",
  serverUpdateSettings: "server.updateSettings",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverBatchUpsertKeybindings: "server.batchUpsertKeybindings",
  serverBatchRemoveKeybindings: "server.batchRemoveKeybindings",
  cloudGetRelayClientStatus: "cloud.getRelayClientStatus",
  cloudInstallRelayClient: "cloud.installRelayClient",
  sourceControlCloneRepository: "sourceControl.cloneRepository",
  sourceControlLookupRepository: "sourceControl.lookupRepository",
  sourceControlPublishRepository: "sourceControl.publishRepository",
  providerConsumeResetCredit: "provider.consumeResetCredit",
  usageReadSummary: "usage.readSummary",
  usageListSnapshots: "usage.listSnapshots",
  usageRefreshAll: "usage.refreshAll",
  subscribeAuthAccess: "subscribeAuthAccess",
  subscribeDiscoveredLocalServers: "subscribeDiscoveredLocalServers",
  subscribePreviewEvents: "subscribePreviewEvents",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeTerminalMetadata: "subscribeTerminalMetadata",
  subscribeVcsStatus: "subscribeVcsStatus",
  subscribeResourceTelemetry: "subscribeResourceTelemetry",
  agentSessionsScan: "agentSessions.scan",
  agentSessionsImport: "agentSessions.import",
} as const;

// ── Push Event Channels ──────────────────────────────────────────────

export const WS_CHANNELS = {
  gitActionProgress: "git.actionProgress",
  reviewCostPreview: "review.costPreview",
  reviewProgress: "review.progress",
  terminalEvent: "terminal.event",
  serverWelcome: "server.welcome",
  serverConfigUpdated: "server.configUpdated",
  serverProvidersUpdated: "server.providersUpdated",
  usageUpdated: "usage.updated",
  previewEvent: "preview.event",
  previewAutomationEvent: "preview.automationEvent",
  backgroundPolicyUpdated: "server.backgroundPolicyUpdated",
  discoveredLocalServers: "preview.discoveredLocalServers",
  resourceTelemetryUpdated: "resourceTelemetry.updated",
} as const;

// -- Tagged Union of all request body schemas ─────────────────────────

const tagRequestBody = <const Tag extends string, const Fields extends Schema.Struct.Fields>(
  tag: Tag,
  schema: Schema.Struct<Fields>,
) =>
  schema.mapFields(
    Struct.assign({ _tag: Schema.tag(tag) }),
    // PreserveChecks is safe here. No existing schema should have checks depending on the tag
    { unsafePreserveChecks: true },
  );

const WebSocketRequestBody = Schema.Union([
  // Orchestration methods
  tagRequestBody(
    ORCHESTRATION_WS_METHODS.dispatchCommand,
    Schema.Struct({ command: ClientOrchestrationCommand }),
  ),
  tagRequestBody(ORCHESTRATION_WS_METHODS.getSnapshot, OrchestrationGetSnapshotInput),
  tagRequestBody(ORCHESTRATION_WS_METHODS.getTurnDiff, OrchestrationGetTurnDiffInput),
  tagRequestBody(ORCHESTRATION_WS_METHODS.getFullThreadDiff, OrchestrationGetFullThreadDiffInput),
  tagRequestBody(ORCHESTRATION_WS_METHODS.replayEvents, OrchestrationReplayEventsInput),

  // Testing crawler
  tagRequestBody(WS_METHODS.testingGetStatus, TestingProjectInput),
  tagRequestBody(WS_METHODS.testingGetLocatorLibrary, TestingProjectInput),
  tagRequestBody(WS_METHODS.testingSetDiscoveryExperience, TestingDiscoveryExperienceInput),
  tagRequestBody(WS_METHODS.testingGetCaseIdPolicy, TestingProjectInput),
  tagRequestBody(WS_METHODS.testingSetCaseIdPolicy, TestingCaseIdPolicyInput),
  tagRequestBody(
    WS_METHODS.testingGetTestInventory,
    Schema.Struct({ projectId: Schema.String, projectPath: Schema.String }),
  ),
  tagRequestBody(WS_METHODS.testingStartLocatorDiscovery, TestingLocatorDiscoveryInput),
  tagRequestBody(WS_METHODS.testingNavigateLocatorDiscovery, TestingLocatorDiscoveryNavigateInput),
  tagRequestBody(WS_METHODS.testingCaptureLocatorPage, TestingLocatorDiscoverySessionInput),
  tagRequestBody(WS_METHODS.testingFinishLocatorDiscovery, TestingLocatorDiscoverySessionInput),
  tagRequestBody(WS_METHODS.testingCancelLocatorDiscovery, TestingLocatorDiscoverySessionInput),
  tagRequestBody(WS_METHODS.testingReviewLocatorEntry, TestingLocatorEntryReviewInput),
  tagRequestBody(WS_METHODS.testingUpdateLocatorPage, TestingLocatorPageUpdateInput),
  tagRequestBody(WS_METHODS.testingSetLocatorPageSelection, TestingLocatorPageSelectionInput),
  tagRequestBody(WS_METHODS.testingDeleteLocatorPage, TestingLocatorPageDeleteInput),
  tagRequestBody(WS_METHODS.testingUpdatePageObjectCode, TestingPageObjectCodeUpdateInput),
  tagRequestBody(
    WS_METHODS.testingPreviewLocatorRepositoryWrite,
    TestingLocatorRepositoryPreviewInput,
  ),
  tagRequestBody(WS_METHODS.testingApplyLocatorRepositoryWrite, TestingLocatorRepositoryApplyInput),
  tagRequestBody(WS_METHODS.testingPreviewLocatorSync, TestingProjectInput),
  tagRequestBody(WS_METHODS.testingResolveLocatorSync, TestingLocatorSyncDecisionInput),
  tagRequestBody(WS_METHODS.testingDisconnectLocatorFolder, TestingProjectInput),
  tagRequestBody(WS_METHODS.testingIndexLocatorFolder, TestingLocatorFolderInput),
  tagRequestBody(WS_METHODS.testingVerifyLocators, TestingLocatorVerificationInput),
  tagRequestBody(WS_METHODS.testingImportUserStory, TestingStoryImportInput),
  tagRequestBody(WS_METHODS.testingStartAuthCapture, TestingTargetInput),
  tagRequestBody(WS_METHODS.testingFinishAuthCapture, TestingProjectInput),
  tagRequestBody(WS_METHODS.testingStartExploration, TestingExplorationInput),
  tagRequestBody(WS_METHODS.testingImportWorkbook, TestingWorkbookImportInput),
  tagRequestBody(WS_METHODS.testingListCases, TestingProjectInput),
  tagRequestBody(WS_METHODS.testingCreateCase, TestingCaseCreateInput),
  tagRequestBody(WS_METHODS.testingReviewCase, TestingCaseReviewInput),
  tagRequestBody(WS_METHODS.testingDeleteCase, TestingCaseDeleteInput),
  tagRequestBody(WS_METHODS.testingUpdateCaseGroup, TestingCaseGroupUpdateInput),
  tagRequestBody(WS_METHODS.testingCreateCaseGroup, TestingCaseGroupCreateInput),
  tagRequestBody(WS_METHODS.testingDeleteCaseGroup, TestingCaseGroupDeleteInput),
  tagRequestBody(WS_METHODS.testingGenerateScenarios, TestingProjectInput),
  tagRequestBody(WS_METHODS.testingClearGraph, TestingProjectInput),
  tagRequestBody(WS_METHODS.testingGenerateTests, TestingGenerationInput),
  tagRequestBody(WS_METHODS.testingListGenerationJobs, TestingProjectInput),
  tagRequestBody(WS_METHODS.testingCancelGenerationJob, TestingGenerationJobInput),
  tagRequestBody(WS_METHODS.testingReadArtifact, TestingArtifactReadInput),
  tagRequestBody(WS_METHODS.testingRunTests, TestingExecutionInput),
  tagRequestBody(WS_METHODS.testingCancelExecutionRun, TestingExecutionRunInput),
  tagRequestBody(WS_METHODS.testingListExecutionRuns, TestingProjectInput),
  tagRequestBody(WS_METHODS.testingDecideHealingProposal, TestingHealingDecisionInput),
  tagRequestBody(WS_METHODS.testingCreateSchedule, TestingScheduleInput),
  tagRequestBody(WS_METHODS.testingListSchedules, TestingProjectInput),
  tagRequestBody(WS_METHODS.testingGenerateReport, TestingReportInput),
  tagRequestBody(WS_METHODS.testingGetTraceability, TestingTraceabilityInput),
  tagRequestBody(WS_METHODS.testingDraftBug, TestingBugDraftInput),
  tagRequestBody(WS_METHODS.testingGetGraphExplorer, TestingProjectInput),
  tagRequestBody(WS_METHODS.testingTriageFailure, TestingTriageInput),

  // Project Search
  tagRequestBody(WS_METHODS.projectsSearchContents, ProjectSearchContentsInput),
  tagRequestBody(WS_METHODS.projectsSearchEntries, ProjectSearchEntriesInput),
  tagRequestBody(WS_METHODS.projectsReadFile, ProjectReadFileInput),
  tagRequestBody(WS_METHODS.projectsWriteFile, ProjectWriteFileInput),
  tagRequestBody(WS_METHODS.filesystemBrowse, FilesystemBrowseInput),

  // Shell methods
  tagRequestBody(WS_METHODS.shellOpenInEditor, OpenInEditorInput),

  // Git methods
  tagRequestBody(WS_METHODS.gitPull, GitPullInput),
  tagRequestBody(WS_METHODS.gitFetch, GitFetchInput),
  tagRequestBody(WS_METHODS.gitStatus, GitStatusInput),
  tagRequestBody(WS_METHODS.gitRunStackedAction, GitRunStackedActionInput),
  tagRequestBody(WS_METHODS.gitListBranches, GitListBranchesInput),
  tagRequestBody(WS_METHODS.gitListWorkflowRuns, GitListWorkflowRunsInput),
  tagRequestBody(WS_METHODS.gitCreateWorktree, GitCreateWorktreeInput),
  tagRequestBody(WS_METHODS.gitRemoveWorktree, GitRemoveWorktreeInput),
  tagRequestBody(WS_METHODS.gitCreateBranch, GitCreateBranchInput),
  tagRequestBody(WS_METHODS.gitCreateFork, GitCreateForkInput),
  tagRequestBody(WS_METHODS.gitCheckout, GitCheckoutInput),
  tagRequestBody(WS_METHODS.gitRenameBranch, GitRenameBranchInput),
  tagRequestBody(WS_METHODS.gitDeleteBranch, GitDeleteBranchInput),
  tagRequestBody(WS_METHODS.gitSetBranchUpstream, GitSetBranchUpstreamInput),
  tagRequestBody(WS_METHODS.gitInit, GitInitInput),
  tagRequestBody(WS_METHODS.gitHistory, GitHistoryInput),
  tagRequestBody(WS_METHODS.gitDiff, GitDiffInput),
  tagRequestBody(WS_METHODS.gitStageFiles, GitStageFilesInput),
  tagRequestBody(WS_METHODS.gitUnstageFiles, GitUnstageFilesInput),
  tagRequestBody(WS_METHODS.gitDiscardChanges, GitDiscardChangesInput),
  tagRequestBody(WS_METHODS.gitSaveStash, GitStashSaveInput),
  tagRequestBody(WS_METHODS.gitListStashes, GitStashListInput),
  tagRequestBody(WS_METHODS.gitApplyStash, GitApplyStashInput),
  tagRequestBody(WS_METHODS.gitDropStash, GitDropStashInput),
  tagRequestBody(WS_METHODS.gitResolveConflict, GitResolveConflictInput),
  tagRequestBody(WS_METHODS.gitConflictSnapshot, GitConflictSnapshotInput),
  tagRequestBody(WS_METHODS.gitApplyHunk, GitApplyHunkInput),
  tagRequestBody(WS_METHODS.gitMerge, GitMergeInput),
  tagRequestBody(WS_METHODS.gitRebase, GitRebaseInput),
  tagRequestBody(WS_METHODS.gitContinueOperation, GitContinueOperationInput),
  tagRequestBody(WS_METHODS.gitAbortOperation, GitAbortOperationInput),
  tagRequestBody(WS_METHODS.gitSkipRebase, GitSkipRebaseInput),
  tagRequestBody(WS_METHODS.gitResolvePullRequest, GitPullRequestRefInput),
  tagRequestBody(WS_METHODS.gitListPullRequests, GitListPullRequestsInput),
  tagRequestBody(WS_METHODS.gitMutatePullRequest, GitMutatePullRequestInput),
  tagRequestBody(WS_METHODS.gitCreatePullRequest, GitCreatePullRequestInput),
  tagRequestBody(WS_METHODS.gitPreparePullRequestThread, GitPreparePullRequestThreadInput),
  tagRequestBody(WS_METHODS.gitPush, GitPushInput),
  tagRequestBody(WS_METHODS.gitPerformRepositoryAction, GitRepositoryActionInput),
  tagRequestBody(WS_METHODS.gitPublishRelease, GitPublishReleaseInput),
  tagRequestBody(WS_METHODS.gitTriggerReleaseWorkflow, GitTriggerReleaseWorkflowInput),
  tagRequestBody(WS_METHODS.gitEnvironment, GitEnvironmentInput),
  tagRequestBody(WS_METHODS.gitHubSwitchAccount, GitHubSwitchAccountInput),
  tagRequestBody(WS_METHODS.gitHubLogout, GitHubLogoutInput),
  tagRequestBody(WS_METHODS.gitAmendCommit, GitAmendCommitInput),
  tagRequestBody(WS_METHODS.gitUndoLastCommit, GitUndoLastCommitInput),
  tagRequestBody(WS_METHODS.gitRevertCommit, GitRevertCommitInput),
  tagRequestBody(WS_METHODS.gitCherryPick, GitCherryPickInput),
  tagRequestBody(WS_METHODS.gitCreateTag, GitCreateTagInput),
  tagRequestBody(WS_METHODS.gitListTags, GitListTagsInput),
  tagRequestBody(WS_METHODS.gitWatchedBranchStatuses, GitWatchedBranchStatusesInput),
  tagRequestBody(WS_METHODS.gitGenerateDiffSummary, GitGenerateDiffSummaryInput),
  tagRequestBody(WS_METHODS.gitGenerateReview, GitGenerateReviewInput),
  tagRequestBody(WS_METHODS.gitSubmitFindingFeedback, GitSubmitFindingFeedbackInput),
  tagRequestBody(WS_METHODS.gitGetReviewHistory, GitGetReviewHistoryInput),

  // Terminal methods
  tagRequestBody(WS_METHODS.terminalOpen, TerminalOpenInput),
  tagRequestBody(WS_METHODS.terminalList, Schema.Struct({})),
  tagRequestBody(WS_METHODS.terminalWrite, TerminalWriteInput),
  tagRequestBody(WS_METHODS.terminalResize, TerminalResizeInput),
  tagRequestBody(WS_METHODS.terminalClear, TerminalClearInput),
  tagRequestBody(WS_METHODS.terminalRestart, TerminalRestartInput),
  tagRequestBody(WS_METHODS.terminalClose, TerminalCloseInput),

  tagRequestBody(WS_METHODS.previewOpen, PreviewOpenInput),
  tagRequestBody(WS_METHODS.previewNavigate, PreviewNavigateInput),
  tagRequestBody(WS_METHODS.previewReportStatus, PreviewReportStatusInput),
  tagRequestBody(WS_METHODS.previewResize, PreviewResizeInput),
  tagRequestBody(WS_METHODS.previewRefresh, PreviewRefreshInput),
  tagRequestBody(WS_METHODS.previewClose, PreviewCloseInput),
  tagRequestBody(WS_METHODS.previewList, PreviewListInput),
  tagRequestBody(WS_METHODS.previewAutomationConnect, PreviewAutomationHost),
  tagRequestBody(WS_METHODS.previewAutomationFocusHost, PreviewAutomationHostFocus),
  tagRequestBody(WS_METHODS.previewAutomationRespond, PreviewAutomationResponse),
  tagRequestBody(
    WS_METHODS.subscribeDiscoveredLocalServers,
    Schema.Struct({
      configuredUrls: Schema.optional(ConfiguredLocalServerUrls),
    }),
  ),

  // Server meta
  tagRequestBody(WS_METHODS.serverGetConfig, Schema.Struct({})),
  tagRequestBody(
    WS_METHODS.serverRefreshProviders,
    Schema.Struct({
      instanceId: Schema.optional(ProviderInstanceId),
      cwd: Schema.optional(TrimmedNonEmptyString),
    }),
  ),
  tagRequestBody(WS_METHODS.serverRunProviderMaintenance, ServerRunProviderMaintenanceInput),
  tagRequestBody(WS_METHODS.serverUpsertKeybinding, KeybindingRule),
  tagRequestBody(WS_METHODS.serverBatchUpsertKeybindings, ServerBatchUpsertKeybindingsInput),
  tagRequestBody(WS_METHODS.serverBatchRemoveKeybindings, ServerBatchRemoveKeybindingsInput),
  tagRequestBody(WS_METHODS.serverRemoveKeybinding, KeybindingRule),
  tagRequestBody(WS_METHODS.serverGetSettings, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverUpdateSettings, Schema.Struct({ patch: ServerSettingsPatch })),
  tagRequestBody(WS_METHODS.serverDiscoverSourceControl, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverCloneRepository, SourceControlCloneRepositoryInput),
  tagRequestBody(WS_METHODS.serverLookupRepository, SourceControlRepositoryLookupInput),
  tagRequestBody(WS_METHODS.serverGetTraceDiagnostics, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverGetProcessDiagnostics, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverGetProcessResourceHistory, ServerProcessResourceHistoryInput),
  tagRequestBody(WS_METHODS.serverGetResourceTelemetry, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverGetResourceTelemetryHistory, ResourceTelemetryHistoryInput),
  tagRequestBody(WS_METHODS.serverRetryResourceTelemetry, Schema.Struct({})),
  tagRequestBody(WS_METHODS.subscribeResourceTelemetry, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverSignalProcess, ServerSignalProcessInput),
  tagRequestBody(WS_METHODS.serverCreateSupportBundle, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverReportClientActivity, ClientActivityReportInput),
  tagRequestBody(WS_METHODS.serverReportHostPowerState, HostPowerSnapshot),
  tagRequestBody(WS_METHODS.serverGetBackgroundPolicy, Schema.Struct({})),

  // Usage & Limits
  Schema.Struct({
    _tag: Schema.tag(WS_METHODS.providerConsumeResetCredit),
    instanceId: ProviderInstanceId,
  }),
  Schema.Struct({
    _tag: Schema.tag(WS_METHODS.providerConsumeResetCredit),
    sourceId: UsageLimitSourceId,
    accountId: TrimmedNonEmptyString,
    creditId: TrimmedNonEmptyString,
  }),
  tagRequestBody(WS_METHODS.usageReadSummary, UsageSummaryInput),
  tagRequestBody(WS_METHODS.usageListSnapshots, ServerListProviderUsageInput),
  tagRequestBody(WS_METHODS.usageRefreshAll, Schema.Struct({})),

  // Agent sessions
  tagRequestBody(WS_METHODS.agentSessionsScan, Schema.Struct({})),
  tagRequestBody(WS_METHODS.agentSessionsImport, AgentSessionImportInput),
]);

export const WebSocketRequest = Schema.Struct({
  id: TrimmedNonEmptyString,
  body: WebSocketRequestBody,
});
export type WebSocketRequest = typeof WebSocketRequest.Type;

export const WebSocketResponse = Schema.Struct({
  id: TrimmedNonEmptyString,
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(
    Schema.Struct({
      message: Schema.String,
      phase: Schema.optional(Schema.NullOr(Schema.String)),
      createdCommitSha: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});
export type WebSocketResponse = typeof WebSocketResponse.Type;

export const WsPushSequence = NonNegativeInt;
export type WsPushSequence = typeof WsPushSequence.Type;

export const WsWelcomePayload = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  projectName: TrimmedNonEmptyString,
  bootstrapProjectId: Schema.optional(ProjectId),
  bootstrapThreadId: Schema.optional(ThreadId),
});
export type WsWelcomePayload = typeof WsWelcomePayload.Type;

export interface WsPushPayloadByChannel {
  readonly [WS_CHANNELS.serverWelcome]: WsWelcomePayload;
  readonly [WS_CHANNELS.serverConfigUpdated]: typeof ServerConfigUpdatedPayload.Type;
  readonly [WS_CHANNELS.serverProvidersUpdated]: typeof ServerProviderUpdatedPayload.Type;
  readonly [WS_CHANNELS.gitActionProgress]: typeof GitActionProgressEvent.Type;
  readonly [WS_CHANNELS.reviewCostPreview]: ReviewCostPreviewEvent;
  readonly [WS_CHANNELS.reviewProgress]: ReviewProgressEvent;
  readonly [WS_CHANNELS.terminalEvent]: typeof TerminalEvent.Type;
  readonly [WS_CHANNELS.usageUpdated]: ServerListProviderUsageResult;
  readonly [WS_CHANNELS.previewEvent]: PreviewEvent;
  readonly [WS_CHANNELS.previewAutomationEvent]: PreviewAutomationStreamEvent;
  readonly [WS_CHANNELS.backgroundPolicyUpdated]: typeof BackgroundPolicySnapshot.Type;
  readonly [WS_CHANNELS.discoveredLocalServers]: DiscoveredLocalServerList;
  readonly [WS_CHANNELS.resourceTelemetryUpdated]: ResourceTelemetrySnapshot;
  readonly [ORCHESTRATION_WS_CHANNELS.domainEvent]: OrchestrationEvent;
}

export type WsPushChannel = keyof WsPushPayloadByChannel;
export type WsPushData<C extends WsPushChannel> = WsPushPayloadByChannel[C];

const makeWsPushSchema = <const Channel extends string, Payload extends Schema.Schema<any>>(
  channel: Channel,
  payload: Payload,
) =>
  Schema.Struct({
    type: Schema.Literal("push"),
    sequence: WsPushSequence,
    channel: Schema.Literal(channel),
    data: payload,
  });

export const WsPushServerWelcome = makeWsPushSchema(WS_CHANNELS.serverWelcome, WsWelcomePayload);
export const WsPushServerConfigUpdated = makeWsPushSchema(
  WS_CHANNELS.serverConfigUpdated,
  ServerConfigUpdatedPayload,
);
export const WsPushServerProvidersUpdated = makeWsPushSchema(
  WS_CHANNELS.serverProvidersUpdated,
  ServerProviderUpdatedPayload,
);
export const WsPushGitActionProgress = makeWsPushSchema(
  WS_CHANNELS.gitActionProgress,
  GitActionProgressEvent,
);
export const WsPushReviewCostPreview = makeWsPushSchema(
  WS_CHANNELS.reviewCostPreview,
  ReviewCostPreviewEvent,
);
export const WsPushReviewProgress = makeWsPushSchema(
  WS_CHANNELS.reviewProgress,
  ReviewProgressEvent,
);
export const WsPushTerminalEvent = makeWsPushSchema(WS_CHANNELS.terminalEvent, TerminalEvent);
export const WsPushUsageUpdated = makeWsPushSchema(
  WS_CHANNELS.usageUpdated,
  ServerListProviderUsageResult,
);
export const WsPushPreviewEvent = makeWsPushSchema(WS_CHANNELS.previewEvent, PreviewEvent);
export const WsPushPreviewAutomationEvent = makeWsPushSchema(
  WS_CHANNELS.previewAutomationEvent,
  PreviewAutomationStreamEvent,
);
export const WsPushBackgroundPolicyUpdated = makeWsPushSchema(
  WS_CHANNELS.backgroundPolicyUpdated,
  BackgroundPolicySnapshot,
);
export const WsPushDiscoveredLocalServers = makeWsPushSchema(
  WS_CHANNELS.discoveredLocalServers,
  DiscoveredLocalServerList,
);
export const WsPushResourceTelemetryUpdated = makeWsPushSchema(
  WS_CHANNELS.resourceTelemetryUpdated,
  ResourceTelemetrySnapshot,
);
export const WsPushOrchestrationDomainEvent = makeWsPushSchema(
  ORCHESTRATION_WS_CHANNELS.domainEvent,
  OrchestrationEvent,
);

export const WsPushChannelSchema = Schema.Literals([
  WS_CHANNELS.gitActionProgress,
  WS_CHANNELS.reviewCostPreview,
  WS_CHANNELS.reviewProgress,
  WS_CHANNELS.serverWelcome,
  WS_CHANNELS.serverConfigUpdated,
  WS_CHANNELS.serverProvidersUpdated,
  WS_CHANNELS.terminalEvent,
  WS_CHANNELS.usageUpdated,
  WS_CHANNELS.previewEvent,
  WS_CHANNELS.previewAutomationEvent,
  WS_CHANNELS.backgroundPolicyUpdated,
  WS_CHANNELS.discoveredLocalServers,
  WS_CHANNELS.resourceTelemetryUpdated,
  ORCHESTRATION_WS_CHANNELS.domainEvent,
]);
export type WsPushChannelSchema = typeof WsPushChannelSchema.Type;

export const WsPush = Schema.Union([
  WsPushServerWelcome,
  WsPushServerConfigUpdated,
  WsPushServerProvidersUpdated,
  WsPushGitActionProgress,
  WsPushReviewCostPreview,
  WsPushReviewProgress,
  WsPushTerminalEvent,
  WsPushUsageUpdated,
  WsPushPreviewEvent,
  WsPushPreviewAutomationEvent,
  WsPushBackgroundPolicyUpdated,
  WsPushDiscoveredLocalServers,
  WsPushResourceTelemetryUpdated,
  WsPushOrchestrationDomainEvent,
]);
export type WsPush = typeof WsPush.Type;

export type WsPushMessage<C extends WsPushChannel> = Extract<WsPush, { channel: C }>;

export const WsPushEnvelopeBase = Schema.Struct({
  type: Schema.Literal("push"),
  sequence: WsPushSequence,
  channel: WsPushChannelSchema,
  data: Schema.Unknown,
});
export type WsPushEnvelopeBase = typeof WsPushEnvelopeBase.Type;

// ── Union of all server → client messages ─────────────────────────────

export const WsResponse = Schema.Union([WebSocketResponse, WsPush]);
export type WsResponse = typeof WsResponse.Type;
