import type { BrowserReadinessResult } from "./browserReadiness.ts";
import type { BrowserComparisonInput } from "./browserComparison.ts";
import type { NotificationToastPayload } from "./notificationOverlay.ts";
import type {
  DesktopExtensionBoundsInput,
  DesktopExtensionViewInput,
  DesktopInstalledExtension,
  TabsExtensionAssignment,
} from "./extensions.ts";
export * from "./notificationOverlay.ts";
import type {
  VcsCreateRefInput,
  VcsCreateRefResult,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  VcsPullInput,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  VcsSwitchRefInput,
  VcsSwitchRefResult,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitResolvePullRequestResult,
  GitListPullRequestsInput,
  GitListPullRequestsResult,
  GitMutatePullRequestInput,
  GitMutatePullRequestResult,
  GitCreatePullRequestInput,
  GitCreatePullRequestResult,
  GitListWorkflowRunsInput,
  GitListWorkflowRunsResult,
  VcsStatusInput,
  VcsStatusResult,
} from "./git.ts";
import type {
  ProviderConsumeResetCreditInput,
  ProviderConsumeResetCreditResult,
} from "./providerUsageLimits.ts";
import type { TestingApi } from "./testing.ts";
import type {
  AgentSessionImportInput,
  AgentSessionImportResult,
  AgentSessionScanResult,
} from "./agentSessions.ts";
import type {
  BrowserImportInput,
  BrowserImportResult,
  BrowserImportSource,
} from "./browserImport.ts";
import type {
  BackgroundPolicySnapshot,
  ClientActivityReportInput,
  HostPowerSnapshot,
} from "./background.ts";
import type {
  GitListBranchesInput,
  GitListBranchesResult,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitRemoveWorktreeInput,
  GitCreateBranchInput,
  GitCreateForkInput,
  GitCheckoutInput,
  GitRenameBranchInput,
  GitRenameBranchResult,
  GitDeleteBranchInput,
  GitSetBranchUpstreamInput,
  GitInitInput,
  GitHistoryInput,
  GitHistoryResult,
  GitDiffInput,
  GitDiffResult,
  GitStageFilesInput,
  GitUnstageFilesInput,
  GitDiscardChangesInput,
  GitStashSaveInput,
  GitStashListInput,
  GitStashListResult,
  GitApplyStashInput,
  GitDropStashInput,
  GitResolveConflictInput,
  GitConflictSnapshotInput,
  GitConflictSnapshotResult,
  GitApplyHunkInput,
  GitMergeInput,
  GitRebaseInput,
  GitContinueOperationInput,
  GitAbortOperationInput,
  GitSkipRebaseInput,
  GitFetchInput,
  GitPullInput,
  GitPullResult,
  GitPushInput,
  GitPushResult,
  GitRepositoryActionInput,
  GitPublishReleaseInput,
  GitTriggerReleaseWorkflowInput,
  GitStatusInput,
  GitStatusResult,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  GitEnvironmentInput,
  GitEnvironmentResult,
  GitHubSwitchAccountInput,
  GitHubLogoutInput,
  GitAmendCommitInput,
  GitUndoLastCommitInput,
  GitRevertCommitInput,
  GitCherryPickInput,
  GitCreateTagInput,
  GitListTagsInput,
  GitListTagsResult,
  GitWatchedBranchStatusesInput,
  GitWatchedBranchStatusesResult,
  GitGenerateDiffSummaryInput,
  GitGenerateDiffSummaryResult,
  GitGenerateReviewInput,
  GitGenerateReviewResult,
  GitSubmitFindingFeedbackInput,
  GitSubmitFindingFeedbackResult,
  GitGetReviewHistoryInput,
  GitGetReviewHistoryResult,
  GitActionProgressEvent,
} from "./git.ts";
import type {
  ReviewDiffPreviewInput,
  ReviewDiffPreviewResult,
  ReviewProgressEvent,
} from "./review.ts";
import type { FilesystemBrowseInput, FilesystemBrowseResult } from "./filesystem.ts";
import type { AssetCreateUrlInput, AssetCreateUrlResult } from "./assets.ts";
import type {
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectReadFileError,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchContentsInput,
  ProjectSearchContentsResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
import type { ProviderInstanceId } from "./providerInstance.ts";
import type {
  ServerConfig,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerProviderUpdateInput,
  ServerProviderUpdatedPayload,
  ServerRemoveKeybindingResult,
  ServerSignalProcessInput,
  ServerSignalProcessResult,
  ServerSupportBundleResult,
  ServerTraceDiagnosticsResult,
  ServerUpsertKeybindingResult,
  ServerBatchUpsertKeybindingsResult,
  ServerRunProviderMaintenanceInput,
} from "./server.ts";
import type {
  TerminalAttachInput,
  TerminalAttachStreamEvent,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalMetadataStreamEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
  TerminalEvent,
} from "./terminal.ts";
import type {
  ServerBatchUpsertKeybindingsInput,
  ServerRemoveKeybindingInput,
  ServerUpsertKeybindingInput,
} from "./server.ts";
import type {
  UsageSummary,
  UsageSummaryInput,
  ServerListProviderUsageInput,
  ServerListProviderUsageResult,
} from "./usage.ts";
import type {
  ResourceTelemetrySnapshot,
  ResourceTelemetryHistory,
  ResourceTelemetryHistoryInput,
  ResourceTelemetryRetryResult,
} from "./resourceTelemetry.ts";
import * as Schema from "effect/Schema";
import type {
  DiscoveredLocalServerList,
  PreviewCloseInput,
  PreviewEvent,
  PreviewListInput,
  PreviewListResult,
  PreviewNavigateInput,
  PreviewOpenInput,
  PreviewRefreshInput,
  PreviewReportStatusInput,
  PreviewResizeInput,
  PreviewSessionSnapshot,
} from "./preview.ts";
import {
  PreviewAutomationClickInput,
  PreviewAutomationEvaluateInput,
  PreviewAutomationHost,
  PreviewAutomationHostFocus,
  PreviewAutomationPressInput,
  PreviewAutomationResponse,
  PreviewAutomationScrollInput,
  PreviewAutomationSnapshot,
  PreviewAutomationStatus,
  PreviewAutomationStreamEvent,
  PreviewAutomationTypeInput,
  PreviewAutomationWaitForInput,
} from "./previewAutomation.ts";
import type {
  DesktopCaptureOptions,
  DesktopCaptureResult,
  DesktopCapturePermissionStatus,
} from "./desktopCapture.ts";
import type {
  ClientOrchestrationCommand,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamItem,
  OrchestrationSubscribeThreadInput,
  OrchestrationThreadStreamItem,
  OrchestrationReadModel,
  OrchestrationEvent,
} from "./orchestration.ts";
import { EnvironmentId } from "./baseSchemas.ts";
import { AuthAccessTokenResult, AuthSessionState, AuthWebSocketTicketResult } from "./auth.ts";
import { AdvertisedEndpoint } from "./remoteAccess.ts";
import { EditorId } from "./editor.ts";
import { ExecutionEnvironmentDescriptor } from "./environment.ts";
import type {
  ClientSettings,
  ServerSettings,
  ServerSettingsPatch,
  DesktopIconTheme,
} from "./settings.ts";
import type {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
  SourceControlDiscoveryResult,
  SourceControlPublishRepositoryInput,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
} from "./sourceControl.ts";

export interface ContextMenuItem<T extends string = string> {
  id: T;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Renders as a non-interactive section header label. Web fallback only — stripped on desktop native menus. */
  header?: boolean;
  /** Icon keyword resolved by the web fallback. Stripped on desktop native menus. */
  icon?: string;
  children?: readonly ContextMenuItem<T>[];
}

export interface ContextMenuItemSchemaType {
  readonly id: string;
  readonly label: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly header?: boolean;
  readonly icon?: string;
  readonly children?: readonly ContextMenuItemSchemaType[];
}

export const ContextMenuItemSchema: Schema.Codec<ContextMenuItemSchemaType> = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  destructive: Schema.optionalKey(Schema.Boolean),
  disabled: Schema.optionalKey(Schema.Boolean),
  header: Schema.optionalKey(Schema.Boolean),
  icon: Schema.optionalKey(Schema.String),
  children: Schema.optionalKey(
    Schema.Array(
      Schema.suspend((): Schema.Codec<ContextMenuItemSchemaType> => ContextMenuItemSchema),
    ),
  ),
});

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export type DesktopRuntimeArch = "arm64" | "x64" | "other";
export type DesktopTheme =
  | "light"
  | "dark"
  | "system"
  | "tabs-dark"
  | "tabs-light"
  | "abyss"
  | "dracula"
  | "deep-blue"
  | "solarized-light"
  | (string & {});
export type DesktopUpdateChannel = "latest" | "nightly";
export type DesktopUpdateDistribution = "platform-signed" | "unsigned-preview";
export type DesktopAppStageLabel = "Alpha" | "Dev" | "Nightly";

export const DesktopUpdateStatusSchema = Schema.Literals([
  "disabled",
  "idle",
  "checking",
  "up-to-date",
  "available",
  "downloading",
  "downloaded",
  "installing",
  "error",
]);
export const DesktopRuntimeArchSchema = Schema.Literals(["arm64", "x64", "other"]);
export const DesktopThemeSchema = Schema.String;
export const DesktopUpdateChannelSchema = Schema.Literals(["latest", "nightly"]);
export const DesktopUpdateDistributionSchema = Schema.Literals([
  "platform-signed",
  "unsigned-preview",
]);
export const DesktopAppStageLabelSchema = Schema.Literals(["Alpha", "Dev", "Nightly"]);

export interface DesktopAppBranding {
  baseName: string;
  stageLabel: DesktopAppStageLabel;
  displayName: string;
}

export const DesktopAppBrandingSchema = Schema.Struct({
  baseName: Schema.String,
  stageLabel: DesktopAppStageLabelSchema,
  displayName: Schema.String,
});

export interface DesktopRuntimeInfo {
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
}

export const DesktopRuntimeInfoSchema = Schema.Struct({
  hostArch: DesktopRuntimeArchSchema,
  appArch: DesktopRuntimeArchSchema,
  runningUnderArm64Translation: Schema.Boolean,
});

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  channel?: DesktopUpdateChannel;
  distribution?: DesktopUpdateDistribution;
  currentVersion: string;
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
  availableVersion: string | null;
  releaseNotes?: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: "check" | "download" | "install" | null;
  canRetry: boolean;
}

export const DesktopUpdateStateSchema = Schema.Struct({
  enabled: Schema.Boolean,
  status: DesktopUpdateStatusSchema,
  channel: Schema.optionalKey(DesktopUpdateChannelSchema),
  distribution: Schema.optionalKey(DesktopUpdateDistributionSchema),
  currentVersion: Schema.String,
  hostArch: DesktopRuntimeArchSchema,
  appArch: DesktopRuntimeArchSchema,
  runningUnderArm64Translation: Schema.Boolean,
  availableVersion: Schema.NullOr(Schema.String),
  releaseNotes: Schema.optionalKey(Schema.NullOr(Schema.String)),
  downloadedVersion: Schema.NullOr(Schema.String),
  downloadPercent: Schema.NullOr(Schema.Number),
  checkedAt: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  errorContext: Schema.NullOr(Schema.Literals(["check", "download", "install"])),
  canRetry: Schema.Boolean,
});

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export const DesktopUpdateActionResultSchema = Schema.Struct({
  accepted: Schema.Boolean,
  completed: Schema.Boolean,
  state: DesktopUpdateStateSchema,
});

export interface DesktopUpdateCheckResult {
  checked: boolean;
  state: DesktopUpdateState;
}

export const DesktopUpdateCheckResultSchema = Schema.Struct({
  checked: Schema.Boolean,
  state: DesktopUpdateStateSchema,
});

// Stable id for the Windows-native primary backend. Desktop side wraps
// this with a brand inside DesktopBackendManager; web side keeps it as
// a plain string so the env-runtime can compare against it without
// importing brand machinery from the desktop package.
export const PRIMARY_LOCAL_ENVIRONMENT_ID = "primary";

export interface DesktopEnvironmentBootstrap {
  // Stable backend instance id (e.g. "primary" or "wsl:ubuntu"). The
  // web env runtime keys local environments off this so projects
  // routed to a specific backend reopen against the same one.
  id: string;
  label: string;
  // Concrete WSL distro used by the current backend run. This stays separate
  // from id because a default-tracking instance keeps the stable
  // "wsl:default" IPC target while each run launches a specific distro.
  runningDistro?: string | null;
  httpBaseUrl: string | null;
  wsBaseUrl: string | null;
  bootstrapToken?: string;
}

export const DesktopEnvironmentBootstrapSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  runningDistro: Schema.optionalKey(Schema.NullOr(Schema.String)),
  httpBaseUrl: Schema.NullOr(Schema.String),
  wsBaseUrl: Schema.NullOr(Schema.String),
  bootstrapToken: Schema.optionalKey(Schema.String),
});

export const DesktopSshEnvironmentTargetSchema = Schema.Struct({
  alias: Schema.String,
  hostname: Schema.String,
  username: Schema.NullOr(Schema.String),
  port: Schema.NullOr(Schema.Number),
});
export type DesktopSshEnvironmentTarget = typeof DesktopSshEnvironmentTargetSchema.Type;

export type DesktopSshHostSource = "ssh-config" | "known-hosts";
export const DesktopSshHostSourceSchema = Schema.Literals(["ssh-config", "known-hosts"]);

export interface DesktopDiscoveredSshHost extends DesktopSshEnvironmentTarget {
  source: DesktopSshHostSource;
}

export const DesktopDiscoveredSshHostSchema = Schema.Struct({
  alias: Schema.String,
  hostname: Schema.String,
  username: Schema.NullOr(Schema.String),
  port: Schema.NullOr(Schema.Number),
  source: DesktopSshHostSourceSchema,
});

export interface DesktopSshEnvironmentBootstrap {
  target: DesktopSshEnvironmentTarget;
  httpBaseUrl: string;
  wsBaseUrl: string;
  pairingToken: string | null;
  remotePort?: number;
  remoteServerKind?: "external" | "managed";
}

export const DesktopSshEnvironmentBootstrapSchema = Schema.Struct({
  target: DesktopSshEnvironmentTargetSchema,
  httpBaseUrl: Schema.String,
  wsBaseUrl: Schema.String,
  pairingToken: Schema.NullOr(Schema.String),
  remotePort: Schema.optionalKey(Schema.Number),
  remoteServerKind: Schema.optionalKey(Schema.Literals(["external", "managed"])),
});

export interface DesktopSshPasswordPromptRequest {
  requestId: string;
  destination: string;
  username: string | null;
  prompt: string;
  expiresAt: string;
}

export const DesktopSshPasswordPromptRequestSchema = Schema.Struct({
  requestId: Schema.String,
  destination: Schema.String,
  username: Schema.NullOr(Schema.String),
  prompt: Schema.String,
  expiresAt: Schema.String,
});

export const DesktopSshPasswordPromptCancelledType = "ssh-password-prompt-cancelled" as const;

export const DesktopSshPasswordPromptCancelledResultSchema = Schema.Struct({
  type: Schema.Literal(DesktopSshPasswordPromptCancelledType),
  message: Schema.String,
});

export const DesktopSshEnvironmentEnsureOptionsSchema = Schema.Struct({
  issuePairingToken: Schema.optionalKey(Schema.Boolean),
});

export const DesktopSshEnvironmentEnsureInputSchema = Schema.Struct({
  target: DesktopSshEnvironmentTargetSchema,
  options: Schema.optionalKey(DesktopSshEnvironmentEnsureOptionsSchema),
});

export const DesktopSshEnvironmentEnsureResultSchema = Schema.Union([
  DesktopSshEnvironmentBootstrapSchema,
  DesktopSshPasswordPromptCancelledResultSchema,
]);

export const DesktopSshHttpBaseUrlInputSchema = Schema.Struct({
  httpBaseUrl: Schema.String,
});

export const DesktopSshBearerRequestInputSchema = Schema.Struct({
  httpBaseUrl: Schema.String,
  bearerToken: Schema.String,
});

export const DesktopSshBearerBootstrapInputSchema = Schema.Struct({
  httpBaseUrl: Schema.String,
  credential: Schema.String,
});

export const DesktopSshPasswordPromptResolutionInputSchema = Schema.Struct({
  requestId: Schema.String,
  password: Schema.NullOr(Schema.String),
});

export const PersistedSavedEnvironmentRecordSchema = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  wsBaseUrl: Schema.String,
  httpBaseUrl: Schema.String,
  createdAt: Schema.String,
  lastConnectedAt: Schema.NullOr(Schema.String),
  desktopSsh: Schema.optionalKey(DesktopSshEnvironmentTargetSchema),
  relayManaged: Schema.optionalKey(
    Schema.Struct({
      relayUrl: Schema.String,
    }),
  ),
});
export type PersistedSavedEnvironmentRecord = typeof PersistedSavedEnvironmentRecordSchema.Type;

export type DesktopServerExposureMode = "local-only" | "network-accessible";

export const DesktopServerExposureModeSchema = Schema.Literals([
  "local-only",
  "network-accessible",
]);

export interface DesktopServerExposureState {
  mode: DesktopServerExposureMode;
  endpointUrl: string | null;
  advertisedHost: string | null;
  tailscaleServeEnabled: boolean;
  tailscaleServePort: number;
}

export const DesktopServerExposureStateSchema = Schema.Struct({
  mode: DesktopServerExposureModeSchema,
  endpointUrl: Schema.NullOr(Schema.String),
  advertisedHost: Schema.NullOr(Schema.String),
  tailscaleServeEnabled: Schema.Boolean,
  tailscaleServePort: Schema.Number,
});

export interface DesktopFileFilter {
  name: string;
  extensions: string[];
}

export const DesktopFileFilterSchema = Schema.Struct({
  name: Schema.String,
  extensions: Schema.Array(Schema.String),
});

export interface PickFileOptions {
  initialPath?: string | null;
  filters?: DesktopFileFilter[];
  title?: string;
  buttonLabel?: string;
  targetEnvironmentId?: string;
}

export const PickFileOptionsSchema = Schema.Struct({
  initialPath: Schema.optionalKey(Schema.NullOr(Schema.String)),
  filters: Schema.optionalKey(Schema.Array(DesktopFileFilterSchema)),
  title: Schema.optionalKey(Schema.String),
  buttonLabel: Schema.optionalKey(Schema.String),
  targetEnvironmentId: Schema.optionalKey(Schema.String),
});

export interface PickFolderOptions {
  initialPath?: string | null;
  // When set, the desktop dialog opens against the named backend's
  // filesystem instead of the primary's. Used by callers that already
  // know which local environment they're targeting (e.g. opening a
  // project that lives inside WSL). Omitting it keeps the historical
  // behavior so non-WSL users never see a different picker.
  targetEnvironmentId?: string;
}

export const PickFolderOptionsSchema = Schema.Struct({
  initialPath: Schema.optionalKey(Schema.NullOr(Schema.String)),
  targetEnvironmentId: Schema.optionalKey(Schema.String),
});

export interface DesktopWslDistro {
  name: string;
  isDefault: boolean;
  version: 1 | 2;
}

export const DesktopWslDistroSchema = Schema.Struct({
  name: Schema.String,
  isDefault: Schema.Boolean,
  version: Schema.Literals([1, 2]),
});

export interface DesktopWslState {
  // True when the user has opted the WSL backend in; the actual backend
  // process is registered with the desktop pool independently of this
  // flag and may take a moment to come up after the user enables it.
  enabled: boolean;
  // null means "track the current WSL default distro".
  distro: string | null;
  available: boolean;
  // When true (and `enabled` is also true) the desktop runs only the
  // WSL backend as the primary; the Windows-side Node backend is not
  // started. Toggling this requires an app restart because the
  // primary backend's spec is captured once at layer init.
  wslOnly: boolean;
  distros: readonly DesktopWslDistro[];
  // Reason the dual-mode WSL backend last failed preflight (no node, wrong
  // version, missing build tools), or null. Surfaced inline in Connections
  // settings. Always null in wsl-only mode — that path shows a dialog and
  // falls back to Windows instead.
  preflightError: string | null;
}

export const DesktopWslStateSchema = Schema.Struct({
  enabled: Schema.Boolean,
  distro: Schema.NullOr(Schema.String),
  available: Schema.Boolean,
  wslOnly: Schema.Boolean,
  distros: Schema.Array(DesktopWslDistroSchema),
  preflightError: Schema.NullOr(Schema.String),
});

/**
 * Renderer-facing snapshot of a desktop preview tab. Mirrors the main-process
 * PreviewTabState shape but uses serialisable primitives only.
 */
export type DesktopPreviewNavStatus =
  | { kind: "Idle" }
  | { kind: "Loading"; url: string; title: string }
  | { kind: "Success"; url: string; title: string }
  | {
      kind: "LoadFailed";
      url: string;
      title: string;
      code: number;
      description: string;
    };

export interface DesktopPreviewTabState {
  tabId: string;
  webContentsId: number | null;
  navStatus: DesktopPreviewNavStatus;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Current zoom factor (1.0 = 100%). */
  zoomFactor: number;
  controller: "human" | "agent" | "none";
  updatedAt: string;
}

export const DesktopPreviewTabIdSchema = Schema.String.check(Schema.isTrimmed()).check(
  Schema.isNonEmpty(),
);

export const DesktopPreviewNavStatusSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("Idle") }),
  Schema.Struct({
    kind: Schema.Literal("Loading"),
    url: Schema.String,
    title: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("Success"),
    url: Schema.String,
    title: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("LoadFailed"),
    url: Schema.String,
    title: Schema.String,
    code: Schema.Number,
    description: Schema.String,
  }),
]);

export const DesktopPreviewTabStateSchema: Schema.Codec<DesktopPreviewTabState> = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  webContentsId: Schema.NullOr(Schema.Int),
  navStatus: DesktopPreviewNavStatusSchema,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
  zoomFactor: Schema.Number,
  controller: Schema.Literals(["human", "agent", "none"]),
  updatedAt: Schema.String,
});

export interface DesktopPreviewPointerEvent {
  tabId: string;
  phase: "move" | "click";
  x: number;
  y: number;
  sequence: number;
  createdAt: string;
}

export const DesktopPreviewPointerEventSchema: Schema.Codec<DesktopPreviewPointerEvent> =
  Schema.Struct({
    tabId: DesktopPreviewTabIdSchema,
    phase: Schema.Literals(["move", "click"]),
    x: Schema.Number,
    y: Schema.Number,
    sequence: Schema.Int,
    createdAt: Schema.String,
  });

/**
 * Static config a renderer needs to mount a preview `<webview>`. Returned
 * atomically by `DesktopPreviewBridge.getPreviewConfig()` so the renderer
 * doesn't have to wait on three separate IPC round-trips before the webview
 * can attach.
 */
export interface DesktopPreviewWebviewConfig {
  /** `persist:t3code-preview` (or whatever the desktop chose). */
  partition: string;
  /**
   * Canonical `<webview webpreferences="...">` string. Encodes the security
   * posture (sandboxed but contextIsolation off so the picker preload can
   * read the page's React DevTools hook). Always present.
   */
  webPreferences: string;
  /**
   * Absolute `file://`-style URL to the picker preload bundle. Set to null
   * when the bundle isn't present (older builds, broken install) — the
   * renderer must then disable element-pick affordances.
   */
  preloadUrl: string | null;
}

export const DesktopPreviewWebviewConfigSchema: Schema.Codec<DesktopPreviewWebviewConfig> =
  Schema.Struct({
    partition: Schema.String,
    webPreferences: Schema.String,
    preloadUrl: Schema.NullOr(Schema.String),
  });

export interface DesktopPreviewAnnotationTheme {
  colorScheme: "light" | "dark";
  radius: string;
  background: string;
  foreground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  border: string;
  input: string;
  ring: string;
  fontSans: string;
  fontMono: string;
}

export const DesktopPreviewAnnotationThemeSchema: Schema.Codec<DesktopPreviewAnnotationTheme> =
  Schema.Struct({
    colorScheme: Schema.Literals(["light", "dark"]),
    radius: Schema.String,
    background: Schema.String,
    foreground: Schema.String,
    popover: Schema.String,
    popoverForeground: Schema.String,
    primary: Schema.String,
    primaryForeground: Schema.String,
    muted: Schema.String,
    mutedForeground: Schema.String,
    accent: Schema.String,
    accentForeground: Schema.String,
    border: Schema.String,
    input: Schema.String,
    ring: Schema.String,
    fontSans: Schema.String,
    fontMono: Schema.String,
  });

export interface DesktopPreviewRecordingFrame {
  tabId: string;
  data: string;
  width: number;
  height: number;
  receivedAt: string;
}

export const DesktopPreviewRecordingFrameSchema: Schema.Codec<DesktopPreviewRecordingFrame> =
  Schema.Struct({
    tabId: DesktopPreviewTabIdSchema,
    data: Schema.String,
    width: Schema.Number,
    height: Schema.Number,
    receivedAt: Schema.String,
  });

export interface DesktopPreviewRecordingArtifact {
  id: string;
  tabId: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export const DesktopPreviewRecordingArtifactSchema: Schema.Codec<DesktopPreviewRecordingArtifact> =
  Schema.Struct({
    id: Schema.String,
    tabId: DesktopPreviewTabIdSchema,
    path: Schema.String,
    mimeType: Schema.String,
    sizeBytes: Schema.Int,
    createdAt: Schema.String,
  });

export interface DesktopPreviewScreenshotArtifact {
  id: string;
  tabId: string;
  path: string;
  mimeType: "image/png";
  sizeBytes: number;
  createdAt: string;
}

export const DesktopPreviewScreenshotArtifactSchema: Schema.Codec<DesktopPreviewScreenshotArtifact> =
  Schema.Struct({
    id: Schema.String,
    tabId: DesktopPreviewTabIdSchema,
    path: Schema.String,
    mimeType: Schema.Literal("image/png"),
    sizeBytes: Schema.Int,
    createdAt: Schema.String,
  });

/**
 * Single stack frame captured by react-grab's `getElementContext`. We surface
 * the source file/line so coding agents can jump straight to the JSX that
 * produced the picked DOM node.
 */
export interface PickedElementStackFrame {
  functionName: string | null;
  fileName: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
}

export const PickedElementStackFrameSchema: Schema.Codec<PickedElementStackFrame> = Schema.Struct({
  functionName: Schema.NullOr(Schema.String),
  fileName: Schema.NullOr(Schema.String),
  lineNumber: Schema.NullOr(Schema.Number),
  columnNumber: Schema.NullOr(Schema.Number),
});

/**
 * A successful element pick from the preview webview. All fields are
 * best-effort — pages that don't ship a React fiber tree (or aren't running
 * in dev) will still produce a usable payload (selector + html preview),
 * just without component / source attribution.
 */
export interface PickedElementPayload {
  /** URL of the page the element was picked on. */
  pageUrl: string;
  /** Optional `<title>` of that page (best-effort). */
  pageTitle: string | null;
  /** Lowercase tag name, e.g. `"button"`. */
  tagName: string;
  /** CSS selector resolving back to the element on a re-render. */
  selector: string | null;
  /** Truncated outer-HTML preview (matches react-grab's `htmlPreview`). */
  htmlPreview: string;
  /** Nearest React component display name, or null when unavailable. */
  componentName: string | null;
  /** First source-mapped stack frame (file + line of the JSX source). */
  source: PickedElementStackFrame | null;
  /** Full owner-stack frames; can be empty. Useful for richer context. */
  stack: ReadonlyArray<PickedElementStackFrame>;
  /** Author CSS only (UA defaults stripped) — react-grab's `styles`. */
  styles: string;
  /** Wall-clock pick time as ISO-8601 string. */
  pickedAt: string;
}

export const PickedElementPayloadSchema: Schema.Codec<PickedElementPayload> = Schema.Struct({
  pageUrl: Schema.String,
  pageTitle: Schema.NullOr(Schema.String),
  tagName: Schema.String,
  selector: Schema.NullOr(Schema.String),
  htmlPreview: Schema.String,
  componentName: Schema.NullOr(Schema.String),
  source: Schema.NullOr(PickedElementStackFrameSchema),
  stack: Schema.Array(PickedElementStackFrameSchema),
  styles: Schema.String,
  pickedAt: Schema.String,
});

export interface PreviewAnnotationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const PreviewAnnotationRectSchema: Schema.Codec<PreviewAnnotationRect> = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});

export interface PreviewAnnotationPoint {
  x: number;
  y: number;
}

export const PreviewAnnotationPointSchema: Schema.Codec<PreviewAnnotationPoint> = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
});

export interface PreviewAnnotationElementTarget {
  id: string;
  element: PickedElementPayload;
  rect: PreviewAnnotationRect;
}

export const PreviewAnnotationElementTargetSchema: Schema.Codec<PreviewAnnotationElementTarget> =
  Schema.Struct({
    id: Schema.String,
    element: PickedElementPayloadSchema,
    rect: PreviewAnnotationRectSchema,
  });

export interface PreviewAnnotationRegionTarget {
  id: string;
  rect: PreviewAnnotationRect;
}

export const PreviewAnnotationRegionTargetSchema: Schema.Codec<PreviewAnnotationRegionTarget> =
  Schema.Struct({
    id: Schema.String,
    rect: PreviewAnnotationRectSchema,
  });

export interface PreviewAnnotationStrokeTarget {
  id: string;
  color: string;
  width: number;
  points: ReadonlyArray<PreviewAnnotationPoint>;
  bounds: PreviewAnnotationRect;
}

export const PreviewAnnotationStrokeTargetSchema: Schema.Codec<PreviewAnnotationStrokeTarget> =
  Schema.Struct({
    id: Schema.String,
    color: Schema.String,
    width: Schema.Number,
    points: Schema.Array(PreviewAnnotationPointSchema),
    bounds: PreviewAnnotationRectSchema,
  });

export interface PreviewAnnotationStyleChange {
  targetId: string;
  selector: string | null;
  property: string;
  previousValue: string;
  value: string;
}

export const PreviewAnnotationStyleChangeSchema: Schema.Codec<PreviewAnnotationStyleChange> =
  Schema.Struct({
    targetId: Schema.String,
    selector: Schema.NullOr(Schema.String),
    property: Schema.String,
    previousValue: Schema.String,
    value: Schema.String,
  });

export interface PreviewAnnotationScreenshot {
  dataUrl: string;
  width: number;
  height: number;
  cropRect: PreviewAnnotationRect;
}

export const PreviewAnnotationScreenshotSchema: Schema.Codec<PreviewAnnotationScreenshot> =
  Schema.Struct({
    dataUrl: Schema.String,
    width: Schema.Number,
    height: Schema.Number,
    cropRect: PreviewAnnotationRectSchema,
  });

/**
 * A submitted preview annotation. One annotation may reference multiple DOM
 * elements, freeform regions, and ink strokes. The desktop main process adds
 * the screenshot after the guest preload submits the structured draft.
 */
export interface PreviewAnnotationPayload {
  id: string;
  pageUrl: string;
  pageTitle: string | null;
  comment: string;
  elements: ReadonlyArray<PreviewAnnotationElementTarget>;
  regions: ReadonlyArray<PreviewAnnotationRegionTarget>;
  strokes: ReadonlyArray<PreviewAnnotationStrokeTarget>;
  styleChanges: ReadonlyArray<PreviewAnnotationStyleChange>;
  screenshot: PreviewAnnotationScreenshot | null;
  createdAt: string;
}

export const PreviewAnnotationPayloadSchema: Schema.Codec<PreviewAnnotationPayload> = Schema.Struct(
  {
    id: Schema.String,
    pageUrl: Schema.String,
    pageTitle: Schema.NullOr(Schema.String),
    comment: Schema.String,
    elements: Schema.Array(PreviewAnnotationElementTargetSchema),
    regions: Schema.Array(PreviewAnnotationRegionTargetSchema),
    strokes: Schema.Array(PreviewAnnotationStrokeTargetSchema),
    styleChanges: Schema.Array(PreviewAnnotationStyleChangeSchema),
    screenshot: Schema.NullOr(PreviewAnnotationScreenshotSchema),
    createdAt: Schema.String,
  },
);

export const DesktopPreviewTabInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
});

export const DesktopPreviewRegisterWebviewInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  webContentsId: Schema.Int.check(Schema.isGreaterThan(0)),
});

export const DesktopPreviewNavigateInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  url: Schema.String,
});

export const DesktopPreviewConfigInputSchema = Schema.Struct({
  environmentId: EnvironmentId,
});

export const DesktopPreviewAnnotationThemeInputSchema = Schema.Struct({
  theme: DesktopPreviewAnnotationThemeSchema,
});

export const DesktopPreviewArtifactInputSchema = Schema.Struct({
  path: Schema.String.check(Schema.isTrimmed()).check(Schema.isNonEmpty()),
});

export const DesktopPreviewRecordingSaveInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  mimeType: Schema.String.check(Schema.isTrimmed()).check(Schema.isNonEmpty()),
  data: Schema.Uint8Array,
});

export const DesktopPreviewAutomationClickInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  input: PreviewAutomationClickInput,
});

export const DesktopPreviewAutomationTypeInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  input: PreviewAutomationTypeInput,
});

export const DesktopPreviewAutomationPressInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  input: PreviewAutomationPressInput,
});

export const DesktopPreviewAutomationScrollInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  input: PreviewAutomationScrollInput,
});

export const DesktopPreviewAutomationEvaluateInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  input: PreviewAutomationEvaluateInput,
});

export const DesktopPreviewAutomationWaitForInputSchema = Schema.Struct({
  tabId: DesktopPreviewTabIdSchema,
  input: PreviewAutomationWaitForInput,
});

export interface BrowserProfileDomainInfo {
  domain: string;
  cookieCount: number;
  /** A session-shaped cookie exists. This is only a hint, never proof of a valid login. */
  hasSessionHint: boolean;
}

export interface BrowserProfileInspection {
  readonly profileId: string;
  readonly partition: string;
  readonly isPersistent: boolean;
  readonly storagePath: string | null;
  readonly totalDomains: number;
  readonly totalCookies: number;
  readonly domains: BrowserProfileDomainInfo[];
  readonly inspectedAt: number;
}

export interface BrowserPermissionRequest {
  readonly requestId: string;
  readonly profileId: string;
  readonly origin: string;
  readonly permission: string;
  readonly details?:
    | {
        readonly mediaType?: "video" | "audio" | undefined;
        readonly requestingUrl?: string | undefined;
      }
    | undefined;
}

export interface BrowserPermissionResponse {
  readonly requestId: string;
  readonly granted: boolean;
  readonly remember?: boolean | undefined;
}

export interface BrowserProfilePermissionInfo {
  readonly profileId: string;
  readonly origin: string;
  readonly permission: string;
  readonly granted: boolean;
  readonly updatedAt: number;
}

export interface DesktopBridge {
  listExtensions: () => Promise<DesktopInstalledExtension[]>;
  installDevelopmentExtension: (directory: string) => Promise<DesktopInstalledExtension>;
  setExtensionAssignment: (
    extensionId: string,
    assignment: TabsExtensionAssignment,
  ) => Promise<void>;
  addExtensionProfile: (extensionId: string, id: string, label: string) => Promise<void>;
  activateExtensionTool: (input: DesktopExtensionViewInput) => Promise<void>;
  setExtensionBounds: (input: DesktopExtensionBoundsInput) => Promise<void>;
  hideExtensionTool: () => Promise<void>;
  writeClipboardText: (text: string) => Promise<void>;
  readClipboardText?: (type?: "clipboard" | "selection") => Promise<string>;
  getDesktopCapturePermissionStatus?: () => Promise<DesktopCapturePermissionStatus>;
  requestDesktopCapturePermission?: () => Promise<boolean>;
  captureDesktopScreen?: (options?: DesktopCaptureOptions) => Promise<DesktopCaptureResult>;
  getClientPlatform?: () => string;
  getLocalEnvironmentBootstraps: () => readonly DesktopEnvironmentBootstrap[];
  getConnectionCatalog?: () => Promise<string | null>;
  setConnectionCatalog?: (catalog: string) => Promise<boolean>;
  clearConnectionCatalog?: () => Promise<void>;
  discoverSshHosts: () => Promise<readonly DesktopDiscoveredSshHost[]>;
  ensureSshEnvironment: (
    target: DesktopSshEnvironmentTarget,
    options?: { readonly issuePairingToken?: boolean },
  ) => Promise<DesktopSshEnvironmentBootstrap>;
  disconnectSshEnvironment: (target: DesktopSshEnvironmentTarget) => Promise<void>;
  fetchSshEnvironmentDescriptor: (httpBaseUrl: string) => Promise<ExecutionEnvironmentDescriptor>;
  bootstrapSshBearerSession: (
    httpBaseUrl: string,
    credential: string,
  ) => Promise<AuthAccessTokenResult>;
  fetchSshSessionState: (httpBaseUrl: string, bearerToken: string) => Promise<AuthSessionState>;
  issueSshWebSocketTicket: (
    httpBaseUrl: string,
    bearerToken: string,
  ) => Promise<AuthWebSocketTicketResult>;
  onSshPasswordPrompt: (listener: (request: DesktopSshPasswordPromptRequest) => void) => () => void;
  resolveSshPasswordPrompt: (requestId: string, password: string | null) => Promise<boolean>;
  onSystemResume?: (listener: () => void) => () => void;
  getHostPowerSnapshot?: () => Promise<HostPowerSnapshot>;
  onHostPowerSnapshot?: (listener: (snapshot: HostPowerSnapshot) => void) => () => void;
  getWsUrl: () => string | null;
  cloneRepository: (input: DesktopCloneRepositoryInput) => Promise<DesktopCloneRepositoryResult>;
  getPersistedItem: (key: string) => Promise<string | null>;
  setPersistedItem: (key: string, value: string) => Promise<void>;
  removePersistedItem: (key: string) => Promise<void>;
  pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
  pickFile: (options?: PickFileOptions) => Promise<string | null>;
  confirm: (message: string) => Promise<boolean>;
  setTheme: (theme: DesktopTheme) => Promise<void>;
  setIconTheme: (theme: DesktopIconTheme) => Promise<void>;
  setAiProvider?: (provider: "tabs" | "copilot") => Promise<void>;
  setZoomFactor: (factor: number) => Promise<void>;
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  openExternal: (url: string) => Promise<boolean>;
  isPopout?: boolean;
  openPopoutWindow?: (options: {
    readonly url: string;
    readonly title?: string;
    readonly width?: number;
    readonly height?: number;
  }) => Promise<void>;
  onMenuAction: (listener: (action: string) => void) => () => void;
  getUpdateState: () => Promise<DesktopUpdateState>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  installUpdate: () => Promise<DesktopUpdateActionResult>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
  getCodeHostState: () => Promise<DesktopCodeHostState>;
  ensureCodeSession: (input: DesktopCodeHostEnsureSessionInput) => Promise<void>;
  activateCodeSession: (input: DesktopCodeHostActivateSessionInput) => Promise<void>;
  hideCodeSession: () => Promise<void>;
  captureCodeSession: (input: { projectId: string }) => Promise<string | null>;
  openCodeFile: (input: DesktopCodeHostOpenFileInput) => Promise<void>;
  setCodeBounds: (input: DesktopCodeHostSetBoundsInput) => Promise<void>;
  syncCodeSessions: (projectIds: readonly string[]) => Promise<void>;
  recreateCodeSession: (input: { projectId: string }) => Promise<void>;
  /** Forward an allowlisted workbench command to a project's embedded editor. Resolves true when delivered. */
  runCodeCommand: (projectId: string, commandId: string) => Promise<boolean>;
  /** Get the latest known chrome state for a project. */
  getCodeChromeState: (input: { projectId: string }) => Promise<CodeChromeState>;
  /** Subscribe to chrome-state pushes from the embedded workbench (tagged by project). Returns an unsubscribe fn. */
  onCodeChromeState: (
    listener: (update: { projectId: string; state: CodeChromeState }) => void,
  ) => () => void;
  probeBrowserReadiness: (input: {
    url: string;
    timeoutMs?: number;
  }) => Promise<BrowserReadinessResult>;
  configureBrowserComparison: (input: BrowserComparisonInput) => Promise<void>;
  closeBrowserComparison: (input: { projectId: string; comparisonId: string }) => Promise<void>;
  captureBrowserComparison: (input: {
    projectId: string;
    comparisonId: string;
  }) => Promise<DesktopPreviewScreenshotArtifact[]>;
  getBrowserHostState: () => Promise<DesktopBrowserHostState>;
  getBrowserSessionState: (
    input: DesktopBrowserHostControlInput,
  ) => Promise<DesktopBrowserSessionState>;
  ensureBrowserSession: (input: DesktopBrowserHostEnsureSessionInput) => Promise<void>;
  activateBrowserSession: (input: DesktopBrowserHostActivateSessionInput) => Promise<void>;
  hideBrowserSession: () => Promise<void>;
  navigateBrowserSession: (input: DesktopBrowserHostNavigateInput) => Promise<void>;
  reloadBrowserSession: (
    input: DesktopBrowserHostControlInput & { ignoreCache?: boolean },
  ) => Promise<void>;
  setBrowserZoomFactor: (
    input: DesktopBrowserHostControlInput & { zoomFactor: number },
  ) => Promise<void>;
  setBrowserAudioMuted: (
    input: DesktopBrowserHostControlInput & { audioMuted: boolean },
  ) => Promise<void>;
  openBrowserPictureInPicture: (input: DesktopBrowserHostControlInput) => Promise<void>;
  closeBrowserPictureInPicture: (input: DesktopBrowserHostControlInput) => Promise<void>;
  setBrowserColorScheme: (
    input: DesktopBrowserHostControlInput & { colorScheme: "system" | "light" | "dark" },
  ) => Promise<void>;
  goBackBrowserSession: (input: DesktopBrowserHostControlInput) => Promise<void>;
  goForwardBrowserSession: (input: DesktopBrowserHostControlInput) => Promise<void>;
  toggleBrowserDevTools: (input: DesktopBrowserHostControlInput) => Promise<void>;
  runBrowserAutomation: (input: DesktopBrowserAutomationInput) => Promise<unknown>;
  captureBrowserScreenshot: (
    input: DesktopBrowserHostControlInput,
  ) => Promise<DesktopPreviewScreenshotArtifact>;
  getBrowserMediaSourceId: (input: DesktopBrowserHostControlInput) => Promise<string>;
  saveBrowserRecording: (
    input: DesktopBrowserHostControlInput & { mimeType: string; data: Uint8Array },
  ) => Promise<DesktopPreviewRecordingArtifact>;
  pickBrowserElement: (
    input: DesktopBrowserHostControlInput,
  ) => Promise<PreviewAnnotationPayload | null>;
  revealBrowserArtifact: (path: string) => Promise<void>;
  copyBrowserArtifactToClipboard: (path: string) => Promise<void>;
  setBrowserBounds: (input: DesktopBrowserHostSetBoundsInput) => Promise<void>;
  syncBrowserSessions: (projectIds: readonly string[]) => Promise<void>;
  recreateBrowserSession: (input: {
    projectId: string;
    sessionId?: string | undefined;
    partition?: string | undefined;
  }) => Promise<void>;
  clearBrowserSessionData: (input: DesktopBrowserHostControlInput) => Promise<void>;
  clearBrowserProfileData: (input: { profileId: string }) => Promise<void>;
  openBrowserProfileLoginWindow: (input: { profileId: string; url?: string }) => Promise<void>;
  getBrowserProfileDomains: (input: { profileId: string }) => Promise<BrowserProfileDomainInfo[]>;
  inspectBrowserProfile?: (input: { profileId: string }) => Promise<BrowserProfileInspection>;
  clearBrowserProfileDomain: (input: { profileId: string; domain: string }) => Promise<void>;
  listBrowserImportSources?: () => Promise<BrowserImportSource[]>;
  cancelBrowserImport?: (requestId: string) => Promise<void>;
  importBrowserCookies?: (input: BrowserImportInput) => Promise<BrowserImportResult>;
  respondBrowserPermission?: (response: BrowserPermissionResponse) => Promise<void>;
  getBrowserProfilePermissions?: (input: {
    profileId: string;
  }) => Promise<BrowserProfilePermissionInfo[]>;
  revokeBrowserProfilePermission?: (input: {
    profileId: string;
    origin: string;
    permission: string;
  }) => Promise<void>;
  takeBrowserControl?: (input: DesktopBrowserHostControlInput) => Promise<void>;
  resumeBrowserAgent?: (
    input: DesktopBrowserHostControlInput & { taskId?: string | undefined },
  ) => Promise<void>;
  assignBrowserTabTask?: (
    input: DesktopBrowserHostControlInput & { taskId: string | null },
  ) => Promise<void>;
  retainBrowserTab?: (input: DesktopBrowserHostControlInput) => Promise<void>;
  cleanupAgentBrowserTabs?: (input: { projectId: string; taskId: string }) => Promise<string[]>;
  destroyBrowserSession?: (input: DesktopBrowserHostControlInput) => Promise<void>;
  getRecentlyClosedBrowserTabs?: (projectId: string) => Promise<
    Array<{
      id: string;
      projectId: string;
      sessionId: string;
      url: string;
      title: string;
      profileId?: string | undefined;
      closedAt: string;
    }>
  >;
  restoreRecentlyClosedBrowserTab?: (input: {
    projectId: string;
    id?: string | undefined;
  }) => Promise<{
    id: string;
    projectId: string;
    sessionId: string;
    url: string;
    title: string;
    profileId?: string | undefined;
    closedAt: string;
  } | null>;
  onBrowserProfileDataChanged: (listener: (profileId: string) => void) => () => void;
  onBrowserSessionState: (listener: (state: DesktopBrowserSessionState) => void) => () => void;
  getTailscaleStatus: () => Promise<{
    available: boolean;
    running: boolean;
    magicDnsName: string | null;
    ipv4: string | null;
  }>;
  /**
   * Desktop-only preview surface. Present iff the renderer is hosted by the
   * Electron desktop build; web builds have `preview === undefined`.
   */
  preview?: DesktopPreviewBridge;
  /** Fired by main when the app is about to quit. */
  onAppClosing: (listener: () => void) => () => void;
  notifySettingsFlushDone: () => void;
  onAppCleanupDone: (listener: () => void) => () => void;
  notifyReadyToExit: () => Promise<void>;
  getConfirmBeforeQuit: () => Promise<boolean>;
  setConfirmBeforeQuit: (value: boolean) => Promise<void>;
  onQuitConfirmationRequested: (listener: () => void) => () => void;
  respondToQuitConfirmation: (choice: "save-and-quit" | "cancel") => void;
  syncNotificationOverlay?: (toasts: readonly NotificationToastPayload[]) => Promise<void>;
  onNotificationOverlayAction?: (
    listener: (action: { toastId: string; actionId: string }) => void,
  ) => () => void;
  onNotificationOverlayDismiss?: (listener: (dismiss: { toastId: string }) => void) => () => void;
}

export interface DesktopPreviewBridge {
  createTab: (tabId: string) => Promise<void>;
  closeTab: (tabId: string) => Promise<void>;
  registerWebview: (tabId: string, webContentsId: number) => Promise<void>;
  navigate: (tabId: string, url: string) => Promise<void>;
  goBack: (tabId: string) => Promise<void>;
  goForward: (tabId: string) => Promise<void>;
  refresh: (tabId: string) => Promise<void>;
  zoomIn: (tabId: string) => Promise<void>;
  zoomOut: (tabId: string) => Promise<void>;
  resetZoom: (tabId: string) => Promise<void>;
  /** Reload bypassing the HTTP cache. */
  hardReload: (tabId: string) => Promise<void>;
  /** Open the guest webview's DevTools (detached). */
  openDevTools: (tabId: string) => Promise<void>;
  /** Drop cookies + storage data for the preview partition (all tabs). */
  clearCookies: () => Promise<void>;
  /** Drop the HTTP cache for the preview partition (all tabs). */
  clearCache: () => Promise<void>;
  /**
   * One-shot config for mounting a preview `<webview>`. Replaces three
   * earlier round-trip calls (`getBrowserPartition`, `getWebviewPreferences`,
   * `getPickPreloadPath`) so adding a new field here only requires touching
   * the contract + main, not the renderer's mount logic.
   */
  getPreviewConfig: (environmentId: EnvironmentId) => Promise<DesktopPreviewWebviewConfig>;
  setAnnotationTheme: (theme: DesktopPreviewAnnotationTheme) => Promise<void>;
  /**
   * Activate the in-page element picker for the given tab. Resolves with
   * the picked payload, or `null` when the user cancels (Escape / nav). The
   * promise rejects if the picker can't be activated (no webview, etc.).
   */
  pickElement: (tabId: string) => Promise<PreviewAnnotationPayload | null>;
  /** Cancel an in-flight preview annotation session. */
  cancelPickElement: (tabId: string) => Promise<void>;
  captureScreenshot: (tabId: string) => Promise<DesktopPreviewScreenshotArtifact>;
  revealArtifact: (path: string) => Promise<void>;
  copyArtifactToClipboard: (path: string) => Promise<void>;
  recording: {
    startScreencast: (tabId: string) => Promise<void>;
    stopScreencast: (tabId: string) => Promise<void>;
    save: (
      tabId: string,
      mimeType: string,
      data: Uint8Array,
    ) => Promise<DesktopPreviewRecordingArtifact>;
    onFrame: (listener: (frame: DesktopPreviewRecordingFrame) => void) => () => void;
  };
  automation: {
    status: (tabId: string) => Promise<PreviewAutomationStatus>;
    snapshot: (tabId: string) => Promise<PreviewAutomationSnapshot>;
    click: (tabId: string, input: PreviewAutomationClickInput) => Promise<void>;
    type: (tabId: string, input: PreviewAutomationTypeInput) => Promise<void>;
    press: (tabId: string, input: PreviewAutomationPressInput) => Promise<void>;
    scroll: (tabId: string, input: PreviewAutomationScrollInput) => Promise<void>;
    evaluate: (tabId: string, input: PreviewAutomationEvaluateInput) => Promise<unknown>;
    waitFor: (tabId: string, input: PreviewAutomationWaitForInput) => Promise<void>;
  };
  onStateChange: (listener: (tabId: string, state: DesktopPreviewTabState) => void) => () => void;
  onPointerEvent: (listener: (event: DesktopPreviewPointerEvent) => void) => () => void;
}

/**
 * APIs bound to the local app shell, not to any particular backend environment.
 *
 * These capabilities describe the desktop/browser host that the user is
 * currently running: dialogs, editor/external-link opening, context menus, and
 * app-level settings/config access. They must not be used as a proxy for
 * "whatever environment the user is targeting", because in a multi-environment
 * world the local shell and a selected backend environment are distinct
 * concepts.
 */
export interface LocalApi {
  dialogs: {
    pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
    pickFile: (options?: PickFileOptions) => Promise<string | null>;
    confirm: (message: string) => Promise<boolean>;
  };
  shell: {
    openInEditor: (cwd: string, editor: EditorId) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
  };
  persistence: {
    getClientSettings: () => Promise<ClientSettings | null>;
    setClientSettings: (settings: ClientSettings) => Promise<void>;
  };
  server: {
    getConfig: () => Promise<ServerConfig>;
    /**
     * Refresh provider snapshots. When `input.instanceId` is supplied only that
     * configured instance is probed; otherwise every configured instance is
     * refreshed (legacy untargeted refresh).
     */
    refreshProviders: (input?: {
      readonly instanceId?: ProviderInstanceId;
      readonly cwd?: string;
    }) => Promise<ServerProviderUpdatedPayload>;
    updateProvider: (input: ServerProviderUpdateInput) => Promise<ServerProviderUpdatedPayload>;
    upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>;
    batchUpsertKeybindings: (
      input: ServerBatchUpsertKeybindingsInput,
    ) => Promise<ServerBatchUpsertKeybindingsResult>;
    removeKeybinding: (input: ServerRemoveKeybindingInput) => Promise<ServerRemoveKeybindingResult>;
    getSettings: () => Promise<ServerSettings>;
    updateSettings: (patch: ServerSettingsPatch) => Promise<ServerSettings>;
    discoverSourceControl: () => Promise<SourceControlDiscoveryResult>;
    getTraceDiagnostics: () => Promise<ServerTraceDiagnosticsResult>;
    getProcessDiagnostics: () => Promise<ServerProcessDiagnosticsResult>;
    getProcessResourceHistory: (
      input: ServerProcessResourceHistoryInput,
    ) => Promise<ServerProcessResourceHistoryResult>;
    getResourceTelemetry: () => Promise<ResourceTelemetrySnapshot>;
    getResourceTelemetryHistory: (
      input: ResourceTelemetryHistoryInput,
    ) => Promise<ResourceTelemetryHistory>;
    retryResourceTelemetry: () => Promise<ResourceTelemetryRetryResult>;
    signalProcess: (input: ServerSignalProcessInput) => Promise<ServerSignalProcessResult>;
    createSupportBundle: () => Promise<ServerSupportBundleResult>;
    reportClientActivity: (input: ClientActivityReportInput) => Promise<void>;
    reportHostPowerState: (input: HostPowerSnapshot) => Promise<void>;
    getBackgroundPolicy: () => Promise<BackgroundPolicySnapshot>;
    onBackgroundPolicy: (listener: (snapshot: BackgroundPolicySnapshot) => void) => () => void;
    onResourceTelemetry?: (listener: (snapshot: ResourceTelemetrySnapshot) => void) => () => void;
    readUsageSummary: (input: UsageSummaryInput) => Promise<UsageSummary>;
    listUsageSnapshots: (
      input?: ServerListProviderUsageInput,
    ) => Promise<ServerListProviderUsageResult>;
    refreshAllUsageSnapshots: () => Promise<ServerListProviderUsageResult>;
    consumeResetCredit: (
      input: ProviderConsumeResetCreditInput,
    ) => Promise<ProviderConsumeResetCreditResult>;
  };
}

/**
 * APIs bound to a specific backend environment connection.
 *
 * These operations must always be routed with explicit environment context.
 * They represent remote stateful capabilities such as orchestration, terminal,
 * project, VCS, and provider operations. In multi-environment mode, each environment gets
 * its own instance of this surface, and callers should resolve it by
 * `environmentId` rather than reaching through the local desktop bridge.
 */
export interface EnvironmentApi {
  terminal: {
    open: (input: typeof TerminalOpenInput.Encoded) => Promise<TerminalSessionSnapshot>;
    attach: (
      input: typeof TerminalAttachInput.Encoded,
      callback: (event: TerminalAttachStreamEvent) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
    write: (input: typeof TerminalWriteInput.Encoded) => Promise<void>;
    resize: (input: typeof TerminalResizeInput.Encoded) => Promise<void>;
    clear: (input: typeof TerminalClearInput.Encoded) => Promise<void>;
    restart: (input: typeof TerminalRestartInput.Encoded) => Promise<TerminalSessionSnapshot>;
    close: (input: typeof TerminalCloseInput.Encoded) => Promise<void>;
    onMetadata: (
      callback: (event: TerminalMetadataStreamEvent) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
  projects: {
    listEntries: (input: ProjectListEntriesInput) => Promise<ProjectListEntriesResult>;
    readFile: (input: ProjectReadFileInput) => Promise<ProjectReadFileResult>;
    searchContents: (input: ProjectSearchContentsInput) => Promise<ProjectSearchContentsResult>;
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>;
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
  };
  filesystem: {
    browse: (input: FilesystemBrowseInput) => Promise<FilesystemBrowseResult>;
  };
  agentSessions: {
    scan: () => Promise<AgentSessionScanResult>;
    import: (input: AgentSessionImportInput) => Promise<AgentSessionImportResult>;
  };
  assets: {
    createUrl: (input: AssetCreateUrlInput) => Promise<AssetCreateUrlResult>;
  };
  sourceControl: {
    lookupRepository: (
      input: SourceControlRepositoryLookupInput,
    ) => Promise<SourceControlRepositoryInfo>;
    cloneRepository: (
      input: SourceControlCloneRepositoryInput,
    ) => Promise<SourceControlCloneRepositoryResult>;
    publishRepository: (
      input: SourceControlPublishRepositoryInput,
    ) => Promise<SourceControlPublishRepositoryResult>;
  };
  vcs: {
    listRefs: (input: VcsListRefsInput) => Promise<VcsListRefsResult>;
    createWorktree: (input: VcsCreateWorktreeInput) => Promise<VcsCreateWorktreeResult>;
    removeWorktree: (input: VcsRemoveWorktreeInput) => Promise<void>;
    createRef: (input: VcsCreateRefInput) => Promise<VcsCreateRefResult>;
    switchRef: (input: VcsSwitchRefInput) => Promise<VcsSwitchRefResult>;
    init: (input: VcsInitInput) => Promise<void>;
    pull: (input: VcsPullInput) => Promise<VcsPullResult>;
    refreshStatus: (input: VcsStatusInput) => Promise<VcsStatusResult>;
    onStatus: (
      input: VcsStatusInput,
      callback: (status: VcsStatusResult) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
  git: {
    resolvePullRequest: (input: GitPullRequestRefInput) => Promise<GitResolvePullRequestResult>;
    listPullRequests: (input: GitListPullRequestsInput) => Promise<GitListPullRequestsResult>;
    mutatePullRequest: (input: GitMutatePullRequestInput) => Promise<GitMutatePullRequestResult>;
    createPullRequest: (input: GitCreatePullRequestInput) => Promise<GitCreatePullRequestResult>;
    preparePullRequestThread: (
      input: GitPreparePullRequestThreadInput,
    ) => Promise<GitPreparePullRequestThreadResult>;
    listWorkflowRuns: (input: GitListWorkflowRunsInput) => Promise<GitListWorkflowRunsResult>;
    generateDiffSummary: (
      input: GitGenerateDiffSummaryInput,
    ) => Promise<GitGenerateDiffSummaryResult>;
    generateReview: (input: GitGenerateReviewInput) => Promise<GitGenerateReviewResult>;
    submitFindingFeedback: (
      input: GitSubmitFindingFeedbackInput,
    ) => Promise<GitSubmitFindingFeedbackResult>;
    getReviewHistory: (input: GitGetReviewHistoryInput) => Promise<GitGetReviewHistoryResult>;
    onReviewProgress: (callback: (event: ReviewProgressEvent) => void) => () => void;
  };
  review: {
    getDiffPreview: (input: ReviewDiffPreviewInput) => Promise<ReviewDiffPreviewResult>;
  };
  orchestration: {
    dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{ sequence: number }>;
    getTurnDiff: (input: OrchestrationGetTurnDiffInput) => Promise<OrchestrationGetTurnDiffResult>;
    getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Promise<OrchestrationGetFullThreadDiffResult>;
    getArchivedShellSnapshot: () => Promise<OrchestrationShellSnapshot>;
    subscribeShell: (
      callback: (event: OrchestrationShellStreamItem) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
    subscribeThread: (
      input: OrchestrationSubscribeThreadInput,
      callback: (event: OrchestrationThreadStreamItem) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
  preview: {
    open: (input: typeof PreviewOpenInput.Encoded) => Promise<PreviewSessionSnapshot>;
    navigate: (input: typeof PreviewNavigateInput.Encoded) => Promise<PreviewSessionSnapshot>;
    resize: (input: typeof PreviewResizeInput.Encoded) => Promise<PreviewSessionSnapshot>;
    refresh: (input: typeof PreviewRefreshInput.Encoded) => Promise<void>;
    close: (input: typeof PreviewCloseInput.Encoded) => Promise<void>;
    list: (input: typeof PreviewListInput.Encoded) => Promise<PreviewListResult>;
    reportStatus: (input: typeof PreviewReportStatusInput.Encoded) => Promise<void>;
    automation: {
      connect: (
        input: PreviewAutomationHost,
        callback: (event: PreviewAutomationStreamEvent) => void,
        options?: { onResubscribe?: () => void },
      ) => () => void;
      respond: (response: PreviewAutomationResponse) => Promise<void>;
      focusHost: (input: PreviewAutomationHostFocus) => Promise<void>;
    };
    onEvent: (
      callback: (event: PreviewEvent) => void,
      options?: { onResubscribe?: () => void },
    ) => () => void;
    subscribePorts: (
      callback: (servers: DiscoveredLocalServerList) => void,
      options?: { onResubscribe?: () => void },
    ) => () => void;
  };
}

export interface DesktopCloneRepositoryInput {
  url: string;
  parentDir: string;
}
export type DesktopCloneRepositoryResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

export interface NativeApi extends LocalApi, EnvironmentApi {
  testing: TestingApi;
  terminal: EnvironmentApi["terminal"] & {
    list: () => Promise<ReadonlyArray<TerminalSessionSnapshot>>;
    onEvent: (callback: (event: TerminalEvent) => void) => () => void;
  };
  projects: EnvironmentApi["projects"] & {
    filesystemBrowse: (input: FilesystemBrowseInput) => Promise<FilesystemBrowseResult>;
  };
  repositories: {
    clone: (input: DesktopCloneRepositoryInput) => Promise<DesktopCloneRepositoryResult>;
  };
  git: EnvironmentApi["git"] & {
    listBranches: (input: GitListBranchesInput) => Promise<GitListBranchesResult>;
    createWorktree: (input: GitCreateWorktreeInput) => Promise<GitCreateWorktreeResult>;
    removeWorktree: (input: GitRemoveWorktreeInput) => Promise<void>;
    createBranch: (input: GitCreateBranchInput) => Promise<void>;
    createFork: (input: GitCreateForkInput) => Promise<void>;
    checkout: (input: GitCheckoutInput) => Promise<void>;
    renameBranch: (input: GitRenameBranchInput) => Promise<GitRenameBranchResult>;
    deleteBranch: (input: GitDeleteBranchInput) => Promise<void>;
    setBranchUpstream: (input: GitSetBranchUpstreamInput) => Promise<void>;
    init: (input: GitInitInput) => Promise<void>;
    history: (input: GitHistoryInput) => Promise<GitHistoryResult>;
    diff: (input: GitDiffInput) => Promise<GitDiffResult>;
    stageFiles: (input: GitStageFilesInput) => Promise<void>;
    unstageFiles: (input: GitUnstageFilesInput) => Promise<void>;
    discardChanges: (input: GitDiscardChangesInput) => Promise<void>;
    saveStash: (input: GitStashSaveInput) => Promise<void>;
    listStashes: (input: GitStashListInput) => Promise<GitStashListResult>;
    applyStash: (input: GitApplyStashInput) => Promise<void>;
    dropStash: (input: GitDropStashInput) => Promise<void>;
    resolveConflict: (input: GitResolveConflictInput) => Promise<void>;
    readConflictSnapshot: (input: GitConflictSnapshotInput) => Promise<GitConflictSnapshotResult>;
    applyHunk: (input: GitApplyHunkInput) => Promise<void>;
    merge: (input: GitMergeInput) => Promise<void>;
    rebase: (input: GitRebaseInput) => Promise<void>;
    continueOperation: (input: GitContinueOperationInput) => Promise<void>;
    abortOperation: (input: GitAbortOperationInput) => Promise<void>;
    skipRebase: (input: GitSkipRebaseInput) => Promise<void>;
    fetch: (input: GitFetchInput) => Promise<void>;
    pull: (input: GitPullInput) => Promise<GitPullResult>;
    push: (input: GitPushInput) => Promise<GitPushResult>;
    performRepositoryAction: (input: GitRepositoryActionInput) => Promise<void>;
    publishRelease: (input: GitPublishReleaseInput) => Promise<void>;
    triggerReleaseWorkflow: (input: GitTriggerReleaseWorkflowInput) => Promise<void>;
    status: (input: GitStatusInput) => Promise<GitStatusResult>;
    runStackedAction: (input: GitRunStackedActionInput) => Promise<GitRunStackedActionResult>;
    onActionProgress: (callback: (event: GitActionProgressEvent) => void) => () => void;
    onReviewProgress: (callback: (event: ReviewProgressEvent) => void) => () => void;
    environment: (input: GitEnvironmentInput) => Promise<GitEnvironmentResult>;
    gitHubSwitchAccount: (input: GitHubSwitchAccountInput) => Promise<GitEnvironmentResult>;
    gitHubLogout: (input: GitHubLogoutInput) => Promise<GitEnvironmentResult>;
    amendCommit: (input: GitAmendCommitInput) => Promise<void>;
    undoLastCommit: (input: GitUndoLastCommitInput) => Promise<void>;
    revertCommit: (input: GitRevertCommitInput) => Promise<void>;
    cherryPick: (input: GitCherryPickInput) => Promise<void>;
    createTag: (input: GitCreateTagInput) => Promise<void>;
    listTags: (input: GitListTagsInput) => Promise<GitListTagsResult>;
    watchedBranchStatuses: (
      input: GitWatchedBranchStatusesInput,
    ) => Promise<GitWatchedBranchStatusesResult>;
    generateDiffSummary: (
      input: GitGenerateDiffSummaryInput,
    ) => Promise<GitGenerateDiffSummaryResult>;
  };
  server: LocalApi["server"] & {
    cloneRepository: (
      input: SourceControlCloneRepositoryInput,
    ) => Promise<SourceControlCloneRepositoryResult>;
    lookupRepository: (
      input: SourceControlRepositoryLookupInput,
    ) => Promise<SourceControlRepositoryInfo>;
    runProviderMaintenance: (
      input: ServerRunProviderMaintenanceInput,
    ) => Promise<ServerProviderUpdatedPayload>;
  };
  orchestration: EnvironmentApi["orchestration"] & {
    getSnapshot: () => Promise<OrchestrationReadModel>;
    replayEvents: (fromSequenceExclusive: number) => Promise<void>;
    onDomainEvent: (callback: (event: OrchestrationEvent) => void) => () => void;
  };
}

export type CodeActivityViewId = "explorer" | "search" | "scm" | "debug" | "extensions";

export interface CustomActivityBarItem {
  id: string;
  label: string;
  commandId: string;
  location?: "sidebar" | "auxiliaryBar";
  icon: {
    type: "themeIcon" | "uri" | "themeUri";
    value?: string;
    light?: string;
    dark?: string;
  };
  order?: number;
}

export interface CodeCursorPosition {
  line: number;
  col: number;
}

export interface CodeTabInfo {
  filePath: string;
  viewColumn?: number;
  active?: boolean;
  pinned?: boolean;
  preview?: boolean;
}

export interface CodeTestItem {
  id: string;
  label: string;
  uri: string | null;
  line: number | null;
  busy: boolean;
  children: readonly CodeTestItem[];
}

export interface CodeChromeState {
  activeViewId: string | null;
  panelOpen: boolean;
  panelMaximized: boolean;
  dirtyCount: number;
  branch: string | null;
  activityBarItems?: readonly CustomActivityBarItem[];
  autoSaveEnabled?: boolean;
  languageId?: string | null;
  cursor?: CodeCursorPosition | null;
  openTabs?: readonly CodeTabInfo[];
  testItems?: readonly CodeTestItem[];
}

export interface DesktopCodeHostState {
  available: boolean;
  mode: "embedded" | "external";
  entry: string | null;
  reason: string | null;
}

export interface DesktopCodeHostEnsureSessionInput {
  projectId: string;
  workspaceRoot: string;
}

export interface DesktopCodeHostActivateSessionInput {
  projectId: string;
}

export interface DesktopCodeHostOpenFileInput {
  projectId: string;
  relativePath: string;
  navigationNonce: number;
  lineNumber?: number;
}

export interface DesktopCodeHostSetBoundsInput {
  projectId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface DesktopBrowserHostState {
  available: boolean;
  reason: string | null;
}

export interface DesktopBrowserHostEnsureSessionInput {
  projectId: string;
  sessionId?: string | undefined;
  initialUrl: string;
  partition?: string | undefined;
  profileId?: string | undefined;
  taskId?: string | undefined;
  temporaryAgentTab?: boolean | undefined;
}

export interface DesktopBrowserHostActivateSessionInput {
  projectId: string;
  sessionId?: string | undefined;
}

export interface DesktopBrowserHostNavigateInput {
  projectId: string;
  sessionId?: string | undefined;
  url: string;
}

export interface DesktopBrowserHostControlInput {
  projectId: string;
  sessionId?: string | undefined;
}

export interface DesktopBrowserAutomationInput extends DesktopBrowserHostControlInput {
  source?: "human" | "agent" | undefined;
  taskId?: string | undefined;
  operation:
    | "status"
    | "snapshot"
    | "click"
    | "type"
    | "press"
    | "scroll"
    | "evaluate"
    | "waitFor"
    | "verify"
    | "assertControl"
    | "cancelVerification"
    | "navigate"
    | "recordStart"
    | "recordStop"
    | "recordStatus";
  input?: unknown;
}

export interface DesktopBrowserHostSetBoundsInput {
  projectId: string;
  sessionId?: string | undefined;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface DesktopBrowserSecurityContext {
  securityState: "secure" | "insecure" | "broken" | "unknown";
  registrableDomain: string | null;
  origin: string | null;
  profileId: string | null;
  isTabsOwned: boolean;
  certificateError?: string | null | undefined;
  hasPunycodeWarning?: boolean | undefined;
}

export interface DesktopBrowserSessionState {
  projectId: string;
  sessionId: string;
  profileId?: string | undefined;
  currentUrl: string | null;
  pageTitle: string | null;
  visible?: boolean;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  devToolsOpen: boolean;
  /** Page zoom relative to the enclosing Tabs window zoom. */
  zoomFactor: number;
  audioMuted: boolean;
  pictureInPicture: boolean;
  colorScheme: "system" | "light" | "dark";
  controller?: "human" | "agent" | "none";
  controlEpoch?: number | undefined;
  assignedTaskId?: string | null | undefined;
  temporaryAgentTab?: boolean | undefined;
  userRetained?: boolean | undefined;
  lastError: string | null;
  /** Set when did-fail-load fires with ERR_CONNECTION_REFUSED (-102).
   * Unlike lastError, this is treated as a transient startup condition and
   * does NOT switch the browser UI into an offline/error state — the overlay
   * instead shows "Starting..." and retries automatically. */
  transientError: string | null;
  securityContext?: DesktopBrowserSecurityContext | undefined;
  pendingPermission?: BrowserPermissionRequest | null | undefined;
}
