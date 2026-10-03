import { Schema, Struct } from "effect";
import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

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
  GitPullInput,
  GitPushInput,
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
import { ProjectReadFileInput, ProjectSearchEntriesInput, ProjectWriteFileInput } from "./project";
import { FilesystemBrowseInput } from "./filesystem";
import { OpenInEditorInput } from "./editor";
import {
  ServerConfigUpdatedPayload,
  ServerProviderUpdatedPayload,
  ServerRunProviderMaintenanceInput,
} from "./server";
import { ServerSettingsPatch } from "./settings";
import {
  SourceControlCloneRepositoryInput,
  SourceControlRepositoryLookupInput,
} from "./sourceControl";

// ── WebSocket RPC Method Names ───────────────────────────────────────

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsSearchEntries: "projects.searchEntries",
  projectsReadFile: "projects.readFile",
  projectsWriteFile: "projects.writeFile",
  filesystemBrowse: "filesystem.browse",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Git methods
  gitPull: "git.pull",
  gitFetch: "git.fetch",
  gitStatus: "git.status",
  gitRunStackedAction: "git.runStackedAction",
  gitListBranches: "git.listBranches",
  gitCreateWorktree: "git.createWorktree",
  gitRemoveWorktree: "git.removeWorktree",
  gitCreateBranch: "git.createBranch",
  gitCheckout: "git.checkout",
  gitRenameBranch: "git.renameBranch",
  gitDeleteBranch: "git.deleteBranch",
  gitSetBranchUpstream: "git.setBranchUpstream",
  gitInit: "git.init",
  gitHistory: "git.history",
  gitDiff: "git.diff",
  gitStageFiles: "git.stageFiles",
  gitUnstageFiles: "git.unstageFiles",
  gitDiscardChanges: "git.discardChanges",
  gitSaveStash: "git.saveStash",
  gitListStashes: "git.listStashes",
  gitApplyStash: "git.applyStash",
  gitDropStash: "git.dropStash",
  gitResolveConflict: "git.resolveConflict",
  gitConflictSnapshot: "git.conflictSnapshot",
  gitApplyHunk: "git.applyHunk",
  gitMerge: "git.merge",
  gitRebase: "git.rebase",
  gitContinueOperation: "git.continueOperation",
  gitAbortOperation: "git.abortOperation",
  gitSkipRebase: "git.skipRebase",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",
  gitPush: "git.push",
  gitEnvironment: "git.environment",
  gitHubSwitchAccount: "git.gitHubSwitchAccount",
  gitHubLogout: "git.gitHubLogout",
  gitAmendCommit: "git.amendCommit",
  gitUndoLastCommit: "git.undoLastCommit",
  gitRevertCommit: "git.revertCommit",
  gitCherryPick: "git.cherryPick",
  gitCreateTag: "git.createTag",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalList: "terminal.list",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Server meta
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverRunProviderMaintenance: "server.runProviderMaintenance",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverRemoveKeybinding: "server.removeKeybinding",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  serverDiscoverSourceControl: "server.discoverSourceControl",
  serverCloneRepository: "server.cloneRepository",
  serverLookupRepository: "server.lookupRepository",
} as const;

// ── Push Event Channels ──────────────────────────────────────────────

export const WS_CHANNELS = {
  gitActionProgress: "git.actionProgress",
  terminalEvent: "terminal.event",
  serverWelcome: "server.welcome",
  serverConfigUpdated: "server.configUpdated",
  serverProvidersUpdated: "server.providersUpdated",
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

  // Project Search
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
  tagRequestBody(WS_METHODS.gitCreateWorktree, GitCreateWorktreeInput),
  tagRequestBody(WS_METHODS.gitRemoveWorktree, GitRemoveWorktreeInput),
  tagRequestBody(WS_METHODS.gitCreateBranch, GitCreateBranchInput),
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
  tagRequestBody(WS_METHODS.gitPreparePullRequestThread, GitPreparePullRequestThreadInput),
  tagRequestBody(WS_METHODS.gitPush, GitPushInput),
  tagRequestBody(WS_METHODS.gitEnvironment, GitEnvironmentInput),
  tagRequestBody(WS_METHODS.gitHubSwitchAccount, GitHubSwitchAccountInput),
  tagRequestBody(WS_METHODS.gitHubLogout, GitHubLogoutInput),
  tagRequestBody(WS_METHODS.gitAmendCommit, GitAmendCommitInput),
  tagRequestBody(WS_METHODS.gitUndoLastCommit, GitUndoLastCommitInput),
  tagRequestBody(WS_METHODS.gitRevertCommit, GitRevertCommitInput),
  tagRequestBody(WS_METHODS.gitCherryPick, GitCherryPickInput),
  tagRequestBody(WS_METHODS.gitCreateTag, GitCreateTagInput),

  // Terminal methods
  tagRequestBody(WS_METHODS.terminalOpen, TerminalOpenInput),
  tagRequestBody(WS_METHODS.terminalList, Schema.Struct({})),
  tagRequestBody(WS_METHODS.terminalWrite, TerminalWriteInput),
  tagRequestBody(WS_METHODS.terminalResize, TerminalResizeInput),
  tagRequestBody(WS_METHODS.terminalClear, TerminalClearInput),
  tagRequestBody(WS_METHODS.terminalRestart, TerminalRestartInput),
  tagRequestBody(WS_METHODS.terminalClose, TerminalCloseInput),

  // Server meta
  tagRequestBody(WS_METHODS.serverGetConfig, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverRefreshProviders, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverRunProviderMaintenance, ServerRunProviderMaintenanceInput),
  tagRequestBody(WS_METHODS.serverUpsertKeybinding, KeybindingRule),
  tagRequestBody(WS_METHODS.serverRemoveKeybinding, KeybindingRule),
  tagRequestBody(WS_METHODS.serverGetSettings, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverUpdateSettings, Schema.Struct({ patch: ServerSettingsPatch })),
  tagRequestBody(WS_METHODS.serverDiscoverSourceControl, Schema.Struct({})),
  tagRequestBody(WS_METHODS.serverCloneRepository, SourceControlCloneRepositoryInput),
  tagRequestBody(WS_METHODS.serverLookupRepository, SourceControlRepositoryLookupInput),
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
  readonly [WS_CHANNELS.terminalEvent]: typeof TerminalEvent.Type;
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
export const WsPushTerminalEvent = makeWsPushSchema(WS_CHANNELS.terminalEvent, TerminalEvent);
export const WsPushOrchestrationDomainEvent = makeWsPushSchema(
  ORCHESTRATION_WS_CHANNELS.domainEvent,
  OrchestrationEvent,
);

export const WsPushChannelSchema = Schema.Literals([
  WS_CHANNELS.gitActionProgress,
  WS_CHANNELS.serverWelcome,
  WS_CHANNELS.serverConfigUpdated,
  WS_CHANNELS.serverProvidersUpdated,
  WS_CHANNELS.terminalEvent,
  ORCHESTRATION_WS_CHANNELS.domainEvent,
]);
export type WsPushChannelSchema = typeof WsPushChannelSchema.Type;

export const WsPush = Schema.Union([
  WsPushServerWelcome,
  WsPushServerConfigUpdated,
  WsPushServerProvidersUpdated,
  WsPushGitActionProgress,
  WsPushTerminalEvent,
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
