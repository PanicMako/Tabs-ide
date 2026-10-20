import type {
  EnvironmentId,
  ModelSelection,
  OrchestrationLatestTurn,
  OrchestrationProposedPlanId,
  OrchestrationSessionStatus,
  OrchestrationThreadActivity,
  ProjectScript as ContractProjectScript,
  ThreadId,
  ProjectId,
  RunId,
  TurnId,
  MessageId,
  ProviderKind,
  CheckpointRef,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadLinkedPullRequest,
  ThreadPullRequestLink,
  ThreadTitleRegeneration,
  ProjectIconOverride,
  ThreadEnvMode,
} from "@tabs/contracts";

export interface QueuedRunItem {
  id: RunId;
  ordinal: number;
  userMessageId: MessageId;
  text: string;
  attachments?: ChatAttachment[];
  scheduledFor?: string | null;
  queuePosition?: number | null;
  queueHeld?: boolean;
  createdAt: string;
}

export type SessionPhase = "disconnected" | "connecting" | "ready" | "running";
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export const DEFAULT_INTERACTION_MODE: ProviderInteractionMode = "default";
export const DEFAULT_THREAD_TERMINAL_HEIGHT = 280;
export const DEFAULT_THREAD_TERMINAL_ID = "default";
export const MAX_TERMINALS_PER_GROUP = 4;
export type ProjectScript = ContractProjectScript;

export interface ThreadTerminalGroup {
  id: string;
  terminalIds: string[];
}

export interface ChatImageAttachment {
  type: "image";
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl?: string;
}

export interface ChatFileAttachment {
  type: "file";
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export type ChatAttachment = ChatImageAttachment | ChatFileAttachment;

export interface ChatMessage {
  id: MessageId;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ChatAttachment[];
  createdAt: string;
  completedAt?: string | undefined;
  streaming: boolean;
}

export interface ProposedPlan {
  id: OrchestrationProposedPlanId;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
  createdAt: string;
  updatedAt: string;
}

export interface TurnDiffFileChange {
  path: string;
  kind?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
}

export interface TurnDiffSummary {
  turnId: TurnId;
  completedAt: string;
  status?: string | undefined;
  files: TurnDiffFileChange[];
  checkpointRef?: CheckpointRef | undefined;
  assistantMessageId?: MessageId | undefined;
  checkpointTurnCount?: number | undefined;
}

export interface Project {
  id: ProjectId;
  environmentId?: EnvironmentId | undefined;
  name: string;
  title?: string;
  cwd: string;
  defaultModelSelection: ModelSelection | null;
  defaultThreadEnvMode?: ThreadEnvMode | null | undefined;
  faviconPath?: string | null | undefined;
  projectIcon?: ProjectIconOverride | null | undefined;
  expanded: boolean;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  scripts: ProjectScript[];
}

export interface Thread {
  id: ThreadId;
  environmentId?: EnvironmentId | undefined;
  codexThreadId: string | null;
  projectId: ProjectId;
  title: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  session: ThreadSession | null;
  messages: ChatMessage[];
  /** Content known from the shell before the thread detail has loaded. */
  visibleItemCount?: number | undefined;
  proposedPlans: ProposedPlan[];
  error: string | null;
  createdAt: string;
  updatedAt?: string | undefined;
  latestTurn: OrchestrationLatestTurn | null;
  lastVisitedAt?: string | undefined;
  archivedAt: string | null;
  settledOverride?: "settled" | "active" | null;
  settledAt?: string | null;
  unsettledAt?: string | null;
  snoozedUntil?: string | null;
  snoozedAt?: string | null;
  pinnedAt?: string | null;
  pinOrderKey?: string | null;
  linkedPullRequest?: ThreadLinkedPullRequest | null;
  pullRequests?: ThreadPullRequestLink[];
  titleRegeneration?: ThreadTitleRegeneration | null;
  branch: string | null;
  worktreePath: string | null;
  turnDiffSummaries: TurnDiffSummary[];
  activities: OrchestrationThreadActivity[];
  queuedRuns?: QueuedRunItem[];
  activeRunId?: RunId | null;
  activeRunUserMessageId?: MessageId | null;
}

export interface ThreadSession {
  provider: ProviderKind;
  status: SessionPhase | "error" | "closed";
  activeTurnId?: TurnId | undefined;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  orchestrationStatus: OrchestrationSessionStatus;
}
