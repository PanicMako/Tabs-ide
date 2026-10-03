import {
  ApprovalRequestId,
  isToolLifecycleItemType,
  type OrchestrationLatestTurn,
  type OrchestrationThreadActivity,
  type OrchestrationProposedPlanId,
  type ProviderKind,
  type ProviderApprovalOption,
  type ToolLifecycleItemType,
  type UserInputQuestion,
  type EnvironmentId,
  type ThreadId,
  type TurnId,
} from "@tabs/contracts";

import type {
  ChatMessage,
  ProposedPlan,
  SessionPhase,
  Thread,
  ThreadSession,
  TurnDiffSummary,
} from "./types";

export type ProviderPickerKind =
  | ProviderKind
  | "cursor"
  | "copilot"
  | "grok"
  | "opencode"
  | "kilo"
  | "droid"
  | "antigravity"
  | "openrouter";

export const PROVIDER_OPTIONS: Array<{
  value: ProviderPickerKind;
  label: string;
  available: boolean;
}> = [
  { value: "codex", label: "Codex", available: true },
  { value: "claudeAgent", label: "Claude", available: true },
  { value: "cursor", label: "Cursor", available: true },
  { value: "copilot", label: "GitHub Copilot", available: true },
  { value: "grok", label: "Grok", available: true },
  { value: "opencode", label: "OpenCode", available: true },
  { value: "kilo", label: "Kilo", available: true },
  { value: "droid", label: "Factory Droid", available: true },
  { value: "antigravity", label: "Antigravity", available: true },
  { value: "openrouter", label: "OpenRouter", available: true },
];

export interface WorkLogEntry {
  id: string;
  createdAt: string;
  label: string;
  detail?: string;
  command?: string;
  changedFiles?: ReadonlyArray<string>;
  tone: "thinking" | "tool" | "info" | "error";
  toolTitle?: string;
  itemType?: ToolLifecycleItemType;
  requestKind?: PendingApproval["requestKind"];
  toolCallId?: string;
  // Task lifecycle fields
  taskId?: string;
  taskStatus?: "started" | "running" | "completed" | "failed" | "stopped";
  taskType?: string;
  toolName?: string;
  usage?: unknown;
}

interface DerivedWorkLogEntry extends WorkLogEntry {
  activityKind: OrchestrationThreadActivity["kind"];
  collapseKey?: string;
}

export interface PendingApproval {
  requestId: ApprovalRequestId;
  requestKind: "command" | "file-read" | "file-change";
  createdAt: string;
  detail?: string;
  appName?: string;
  options?: ReadonlyArray<ProviderApprovalOption>;
}

export interface PendingUserInput {
  requestId: ApprovalRequestId;
  createdAt: string;
  questions: ReadonlyArray<UserInputQuestion>;
}

export interface ActivePlanState {
  createdAt: string;
  turnId: TurnId | null;
  explanation?: string | null;
  steps: Array<{
    step: string;
    status: "pending" | "inProgress" | "completed";
  }>;
}

export interface LatestProposedPlanState {
  id: OrchestrationProposedPlanId;
  createdAt: string;
  updatedAt: string;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
}

export type TimelineEntry =
  | {
      id: string;
      kind: "message";
      createdAt: string;
      message: ChatMessage;
    }
  | {
      id: string;
      kind: "proposed-plan";
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      id: string;
      kind: "work";
      createdAt: string;
      entry: WorkLogEntry;
    }
  | {
      id: string;
      kind: "tasks";
      createdAt: string;
      tasks: ReadonlyArray<TaskNode>;
    };

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1_000).toFixed(1)}s`;
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  if (seconds === 0) return `${minutes}m`;
  if (seconds === 60) return `${minutes + 1}m`;
  return `${minutes}m ${seconds}s`;
}

export function formatElapsed(startIso: string, endIso: string | undefined): string | null {
  if (!endIso) return null;
  const startedAt = Date.parse(startIso);
  const endedAt = Date.parse(endIso);
  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt < startedAt) {
    return null;
  }
  return formatDuration(endedAt - startedAt);
}

type LatestTurnTiming = Pick<OrchestrationLatestTurn, "turnId" | "startedAt" | "completedAt">;
type SessionActivityState = Pick<ThreadSession, "orchestrationStatus" | "activeTurnId">;

export function isLatestTurnSettled(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
): boolean {
  if (!latestTurn?.startedAt) return false;
  if (!latestTurn.completedAt) return false;
  if (!session) return true;
  if (session.orchestrationStatus === "running") return false;
  return true;
}

export function deriveActiveWorkStartedAt(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
  sendStartedAt: string | null,
): string | null {
  if (!isLatestTurnSettled(latestTurn, session)) {
    return latestTurn?.startedAt ?? sendStartedAt;
  }
  return sendStartedAt;
}

function requestKindFromRequestType(requestType: unknown): PendingApproval["requestKind"] | null {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    default:
      return null;
  }
}

function isStalePendingRequestFailureDetail(detail: string | undefined): boolean {
  const normalized = detail?.toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("stale pending approval request") ||
    normalized.includes("stale pending user-input request") ||
    normalized.includes("unknown pending approval request") ||
    normalized.includes("unknown pending permission request") ||
    normalized.includes("unknown pending user-input request")
  );
}

export function derivePendingApprovals(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingApproval[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingApproval>();
  const ordered = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId =
      payload && typeof payload.requestId === "string"
        ? ApprovalRequestId.makeUnsafe(payload.requestId)
        : null;
    const requestKind =
      payload &&
      (payload.requestKind === "command" ||
        payload.requestKind === "file-read" ||
        payload.requestKind === "file-change")
        ? payload.requestKind
        : payload
          ? requestKindFromRequestType(payload.requestType)
          : null;
    const detail = payload && typeof payload.detail === "string" ? payload.detail : undefined;
    const appName = payload && typeof payload.appName === "string" ? payload.appName : undefined;
    const options =
      payload && Array.isArray(payload.options)
        ? payload.options.filter(
            (option): option is ProviderApprovalOption =>
              Boolean(option) &&
              typeof option === "object" &&
              ["accept", "acceptForSession", "decline", "cancel"].includes(
                String((option as { decision?: unknown }).decision),
              ) &&
              typeof (option as { label?: unknown }).label === "string",
          )
        : undefined;

    if (activity.kind === "approval.requested" && requestId && requestKind) {
      openByRequestId.set(requestId, {
        requestId,
        requestKind,
        createdAt: activity.createdAt,
        ...(detail ? { detail } : {}),
        ...(appName ? { appName } : {}),
        ...(options && options.length > 0 ? { options } : {}),
      });
      continue;
    }

    if (activity.kind === "approval.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.approval.respond.failed" &&
      requestId &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId);
      continue;
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function parseUserInputQuestions(
  payload: Record<string, unknown> | null,
): ReadonlyArray<UserInputQuestion> | null {
  const questions = payload?.questions;
  if (!Array.isArray(questions)) {
    return null;
  }
  const parsed = questions
    .map<UserInputQuestion | null>((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const question = entry as Record<string, unknown>;
      if (
        typeof question.id !== "string" ||
        typeof question.header !== "string" ||
        typeof question.question !== "string" ||
        !Array.isArray(question.options)
      ) {
        return null;
      }
      const options = question.options
        .map<UserInputQuestion["options"][number] | null>((option) => {
          if (!option || typeof option !== "object") return null;
          const optionRecord = option as Record<string, unknown>;
          if (
            typeof optionRecord.label !== "string" ||
            typeof optionRecord.description !== "string"
          ) {
            return null;
          }
          return {
            label: optionRecord.label,
            description: optionRecord.description,
            ...(typeof optionRecord.value === "string" ? { value: optionRecord.value } : {}),
          };
        })
        .filter((option): option is UserInputQuestion["options"][number] => option !== null);
      if (options.length === 0) {
        return null;
      }
      return {
        id: question.id,
        header: question.header,
        question: question.question,
        options,
        ...(typeof question.allowCustomAnswer === "boolean"
          ? { allowCustomAnswer: question.allowCustomAnswer }
          : {}),
        ...(typeof question.multiSelect === "boolean" ? { multiSelect: question.multiSelect } : {}),
      };
    })
    .filter((question): question is UserInputQuestion => question !== null);
  return parsed.length > 0 ? parsed : null;
}

export function derivePendingUserInputs(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingUserInput[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingUserInput>();
  const ordered = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId =
      payload && typeof payload.requestId === "string"
        ? ApprovalRequestId.makeUnsafe(payload.requestId)
        : null;
    const detail = payload && typeof payload.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "user-input.requested" && requestId) {
      const questions = parseUserInputQuestions(payload);
      if (!questions) {
        continue;
      }
      openByRequestId.set(requestId, {
        requestId,
        createdAt: activity.createdAt,
        questions,
      });
      continue;
    }

    if (activity.kind === "user-input.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.user-input.respond.failed" &&
      requestId &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId);
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function deriveActivePlanState(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): ActivePlanState | null {
  const ordered = [...activities].toSorted(compareActivitiesByOrder);
  const candidates = ordered.filter((activity) => {
    if (activity.kind !== "turn.plan.updated") {
      return false;
    }
    if (!latestTurnId) {
      return true;
    }
    return activity.turnId === latestTurnId;
  });
  const latest = candidates.at(-1);
  if (!latest) {
    return null;
  }
  const payload =
    latest.payload && typeof latest.payload === "object"
      ? (latest.payload as Record<string, unknown>)
      : null;
  const rawPlan = payload?.plan;
  if (!Array.isArray(rawPlan)) {
    return null;
  }
  const steps = rawPlan
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      if (typeof record.step !== "string") {
        return null;
      }
      const status =
        record.status === "completed" || record.status === "inProgress" ? record.status : "pending";
      return {
        step: record.step,
        status,
      };
    })
    .filter(
      (
        step,
      ): step is {
        step: string;
        status: "pending" | "inProgress" | "completed";
      } => step !== null,
    );
  if (steps.length === 0) {
    return null;
  }
  return {
    createdAt: latest.createdAt,
    turnId: latest.turnId,
    ...(payload && "explanation" in payload
      ? { explanation: payload.explanation as string | null }
      : {}),
    steps,
  };
}

export function findLatestProposedPlan(
  proposedPlans: ReadonlyArray<ProposedPlan>,
  latestTurnId: TurnId | string | null | undefined,
): LatestProposedPlanState | null {
  if (latestTurnId) {
    const matchingTurnPlan = [...proposedPlans]
      .filter((proposedPlan) => proposedPlan.turnId === latestTurnId)
      .toSorted(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
      )
      .at(-1);
    if (matchingTurnPlan) {
      return toLatestProposedPlanState(matchingTurnPlan);
    }
  }

  const latestPlan = [...proposedPlans]
    .toSorted(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
    )
    .at(-1);
  if (!latestPlan) {
    return null;
  }

  return toLatestProposedPlanState(latestPlan);
}

export function findSidebarProposedPlan(input: {
  threads: ReadonlyArray<
    Pick<Thread, "id" | "proposedPlans"> & Pick<Partial<Thread>, "environmentId">
  >;
  latestTurn: Pick<OrchestrationLatestTurn, "turnId" | "sourceProposedPlan"> | null;
  latestTurnSettled: boolean;
  threadId: ThreadId | string | null | undefined;
  environmentId?: EnvironmentId;
}): LatestProposedPlanState | null {
  const activeThreadPlans =
    input.threads.find(
      (thread) =>
        thread.id === input.threadId &&
        (input.environmentId === undefined || thread.environmentId === input.environmentId),
    )?.proposedPlans ?? [];

  if (!input.latestTurnSettled) {
    const sourceProposedPlan = input.latestTurn?.sourceProposedPlan;
    if (sourceProposedPlan) {
      const sourcePlan = input.threads
        .find(
          (thread) =>
            thread.id === sourceProposedPlan.threadId &&
            (input.environmentId === undefined || thread.environmentId === input.environmentId),
        )
        ?.proposedPlans.find((plan) => plan.id === sourceProposedPlan.planId);
      if (sourcePlan) {
        return toLatestProposedPlanState(sourcePlan);
      }
    }
  }

  return findLatestProposedPlan(activeThreadPlans, input.latestTurn?.turnId ?? null);
}

export function hasActionableProposedPlan(
  proposedPlan: LatestProposedPlanState | Pick<ProposedPlan, "implementedAt"> | null,
): boolean {
  return proposedPlan !== null && proposedPlan.implementedAt === null;
}

export function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): WorkLogEntry[] {
  const ordered = [...activities].toSorted(compareActivitiesByOrder);
  const entries = ordered
    .filter((activity) => (latestTurnId ? activity.turnId === latestTurnId : true))
    .filter((activity) => activity.kind !== "tool.started")
    .filter((activity) => activity.kind !== "turn.plan.updated")
    // task.started and task.completed are now surfaced for the Task UI
    .filter((activity) => activity.kind !== "context-window.updated")
    .filter((activity) => activity.summary !== "Checkpoint captured")
    .filter((activity) => !isPlanBoundaryToolActivity(activity))
    .map(toDerivedWorkLogEntry);
  return collapseDerivedWorkLogEntries(entries).map(
    ({ activityKind: _activityKind, collapseKey: _collapseKey, ...entry }) => entry,
  );
}

function isPlanBoundaryToolActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
    return false;
  }

  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  return typeof payload?.detail === "string" && payload.detail.startsWith("ExitPlanMode:");
}

const MAX_WORK_LOG_DETAIL_LENGTH = 32_768;

function boundToolDetail(detail: string): string {
  if (detail.length <= MAX_WORK_LOG_DETAIL_LENGTH) {
    return detail;
  }
  const headLength = 16_384;
  const tailLength = 8_192;
  const omittedChars = detail.length - headLength - tailLength;
  return `${detail.slice(0, headLength)}\n\n... [${omittedChars.toLocaleString()} characters omitted for performance] ...\n\n${detail.slice(-tailLength)}`;
}

function toDerivedWorkLogEntry(activity: OrchestrationThreadActivity): DerivedWorkLogEntry {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const command = extractToolCommand(payload);
  const changedFiles = extractChangedFiles(payload);
  const title = extractToolTitle(payload);
  const entry: DerivedWorkLogEntry = {
    id: activity.id,
    createdAt: activity.createdAt,
    label: activity.summary,
    tone: activity.tone === "approval" ? "info" : activity.tone,
    activityKind: activity.kind,
  };
  const itemType = extractWorkLogItemType(payload);
  const requestKind = extractWorkLogRequestKind(payload);
  if (payload && typeof payload.detail === "string" && payload.detail.length > 0) {
    const detail = stripTrailingExitCode(payload.detail).output;
    if (detail) {
      entry.detail = boundToolDetail(detail);
    }
  }
  if (command) {
    entry.command = command;
  }
  if (changedFiles.length > 0) {
    entry.changedFiles = changedFiles;
  }
  if (title) {
    entry.toolTitle = title;
  }
  if (itemType) {
    entry.itemType = itemType;
  }
  if (requestKind) {
    entry.requestKind = requestKind;
  }
  // Extract task lifecycle fields
  if (payload && typeof payload.taskId === "string") {
    entry.taskId = payload.taskId;
  }
  if (payload && typeof payload.status === "string") {
    const status = payload.status as WorkLogEntry["taskStatus"];
    if (status) {
      entry.taskStatus = status;
    }
  }
  if (payload && typeof payload.taskType === "string") {
    entry.taskType = payload.taskType;
  }
  if (payload && typeof payload.lastToolName === "string") {
    entry.toolName = payload.lastToolName;
  } else if (payload && typeof payload.toolName === "string") {
    entry.toolName = payload.toolName;
  }
  if (payload && payload.usage !== undefined) {
    entry.usage = payload.usage;
  }
  const payloadData =
    payload && typeof payload.data === "object" && payload.data !== null
      ? (payload.data as Record<string, unknown>)
      : null;
  const toolCallId =
    (typeof payload?.toolCallId === "string" && payload.toolCallId.trim()) ||
    (typeof payloadData?.toolCallId === "string" && payloadData.toolCallId.trim()) ||
    undefined;
  if (toolCallId) {
    entry.toolCallId = toolCallId;
  }
  const collapseKey = deriveToolLifecycleCollapseKey(entry);
  if (collapseKey) {
    entry.collapseKey = collapseKey;
  }
  return entry;
}

function collapseDerivedWorkLogEntries(
  entries: ReadonlyArray<DerivedWorkLogEntry>,
): DerivedWorkLogEntry[] {
  const collapsed: DerivedWorkLogEntry[] = [];
  const inFlightIndexByKey = new Map<string, number>();

  for (const entry of entries) {
    // 1. Check if an active in-flight tool entry with the same collapseKey exists
    if (entry.collapseKey && inFlightIndexByKey.has(entry.collapseKey)) {
      const existingIndex = inFlightIndexByKey.get(entry.collapseKey)!;
      const existing = collapsed[existingIndex]!;
      if (existing.activityKind !== "tool.completed") {
        collapsed[existingIndex] = mergeDerivedWorkLogEntries(existing, entry);
        if (entry.activityKind === "tool.completed") {
          inFlightIndexByKey.delete(entry.collapseKey);
        }
        continue;
      }
    }

    // 2. Check if the immediately preceding entry can be collapsed
    const previous = collapsed.at(-1);
    if (previous && shouldCollapseToolLifecycleEntries(previous, entry)) {
      collapsed[collapsed.length - 1] = mergeDerivedWorkLogEntries(previous, entry);
      if (entry.activityKind === "tool.completed" && previous.collapseKey) {
        inFlightIndexByKey.delete(previous.collapseKey);
      }
      continue;
    }

    // 3. Otherwise append entry and track if in-flight
    collapsed.push(entry);
    if (entry.collapseKey && entry.activityKind !== "tool.completed") {
      inFlightIndexByKey.set(entry.collapseKey, collapsed.length - 1);
    }
  }
  return collapsed;
}

function shouldCollapseToolLifecycleEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): boolean {
  if (previous.activityKind !== "tool.updated" && previous.activityKind !== "tool.completed") {
    return false;
  }
  if (next.activityKind !== "tool.updated" && next.activityKind !== "tool.completed") {
    return false;
  }
  if (previous.activityKind === "tool.completed") {
    return false;
  }
  if (previous.toolCallId && next.toolCallId) {
    return previous.toolCallId === next.toolCallId;
  }
  if (previous.taskId && next.taskId) {
    return previous.taskId === next.taskId;
  }
  return previous.collapseKey !== undefined && previous.collapseKey === next.collapseKey;
}

function mergeDerivedWorkLogEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): DerivedWorkLogEntry {
  const changedFiles = mergeChangedFiles(previous.changedFiles, next.changedFiles);
  const detail = next.detail ?? previous.detail;
  const command = next.command ?? previous.command;
  const toolTitle = next.toolTitle ?? previous.toolTitle;
  const itemType = next.itemType ?? previous.itemType;
  const requestKind = next.requestKind ?? previous.requestKind;
  const collapseKey = next.collapseKey ?? previous.collapseKey;
  const toolCallId = next.toolCallId ?? previous.toolCallId;
  const taskId = next.taskId ?? previous.taskId;
  const taskStatus = next.taskStatus ?? previous.taskStatus;
  const taskType = next.taskType ?? previous.taskType;
  const toolName = next.toolName ?? previous.toolName;
  const usage = next.usage ?? previous.usage;
  return {
    ...previous,
    ...next,
    ...(detail ? { detail } : {}),
    ...(command ? { command } : {}),
    ...(changedFiles.length > 0 ? { changedFiles } : {}),
    ...(toolTitle ? { toolTitle } : {}),
    ...(itemType ? { itemType } : {}),
    ...(requestKind ? { requestKind } : {}),
    ...(collapseKey ? { collapseKey } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(taskStatus ? { taskStatus } : {}),
    ...(taskType ? { taskType } : {}),
    ...(toolName ? { toolName } : {}),
    ...(usage !== undefined ? { usage } : {}),
  };
}

function mergeChangedFiles(
  previous: ReadonlyArray<string> | undefined,
  next: ReadonlyArray<string> | undefined,
): string[] {
  const merged = [...(previous ?? []), ...(next ?? [])];
  if (merged.length === 0) {
    return [];
  }
  return [...new Set(merged)];
}

function deriveToolLifecycleCollapseKey(entry: DerivedWorkLogEntry): string | undefined {
  if (entry.activityKind !== "tool.updated" && entry.activityKind !== "tool.completed") {
    return undefined;
  }
  if (entry.toolCallId) {
    return `call:${entry.toolCallId}`;
  }
  if (entry.taskId) {
    return `task:${entry.taskId}`;
  }
  const normalizedLabel = normalizeCompactToolLabel(entry.toolTitle ?? entry.label);
  const detail = entry.detail?.trim() ?? "";
  const itemType = entry.itemType ?? "";
  if (normalizedLabel.length === 0 && detail.length === 0 && itemType.length === 0) {
    return undefined;
  }
  return [itemType, normalizedLabel, detail].join("\u001f");
}

function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

function toLatestProposedPlanState(proposedPlan: ProposedPlan): LatestProposedPlanState {
  return {
    id: proposedPlan.id,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    implementedAt: proposedPlan.implementedAt,
    implementationThreadId: proposedPlan.implementationThreadId,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCommandValue(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts = value
    .map((entry) => asTrimmedString(entry))
    .filter((entry): entry is string => entry !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

function extractToolCommand(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const itemResult = asRecord(item?.result);
  const itemInput = asRecord(item?.input);
  const candidates = [
    normalizeCommandValue(item?.command),
    normalizeCommandValue(itemInput?.command),
    normalizeCommandValue(itemResult?.command),
    normalizeCommandValue(data?.command),
  ];
  return candidates.find((candidate) => candidate !== null) ?? null;
}

function extractToolTitle(payload: Record<string, unknown> | null): string | null {
  return asTrimmedString(payload?.title);
}

function stripTrailingExitCode(value: string): {
  output: string | null;
  exitCode?: number | undefined;
} {
  const trimmed = value.trim();
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code (?<code>\d+)>)\s*$/i.exec(
    trimmed,
  );
  if (!match?.groups) {
    return {
      output: trimmed.length > 0 ? trimmed : null,
    };
  }
  const exitCode = Number.parseInt(match.groups.code ?? "", 10);
  const normalizedOutput = match.groups.output?.trim() ?? "";
  return {
    output: normalizedOutput.length > 0 ? normalizedOutput : null,
    ...(Number.isInteger(exitCode) ? { exitCode } : {}),
  };
}

function extractWorkLogItemType(
  payload: Record<string, unknown> | null,
): WorkLogEntry["itemType"] | undefined {
  if (typeof payload?.itemType === "string" && isToolLifecycleItemType(payload.itemType)) {
    return payload.itemType;
  }
  return undefined;
}

function extractWorkLogRequestKind(
  payload: Record<string, unknown> | null,
): WorkLogEntry["requestKind"] | undefined {
  if (
    payload?.requestKind === "command" ||
    payload?.requestKind === "file-read" ||
    payload?.requestKind === "file-change"
  ) {
    return payload.requestKind;
  }
  return requestKindFromRequestType(payload?.requestType) ?? undefined;
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown) {
  const normalized = asTrimmedString(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > 4 || target.length >= 12) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= 12) {
        return;
      }
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  pushChangedFile(target, seen, record.path);
  pushChangedFile(target, seen, record.filePath);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.oldPath);

  for (const nestedKey of [
    "item",
    "result",
    "input",
    "data",
    "changes",
    "files",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= 12) {
      return;
    }
  }
}

function extractChangedFiles(payload: Record<string, unknown> | null): string[] {
  const changedFiles: string[] = [];
  const seen = new Set<string>();
  collectChangedFiles(asRecord(payload?.data), changedFiles, seen, 0);
  return changedFiles;
}

function compareActivitiesByOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  const lifecycleRankComparison =
    compareActivityLifecycleRank(left.kind) - compareActivityLifecycleRank(right.kind);
  if (lifecycleRankComparison !== 0) {
    return lifecycleRankComparison;
  }

  return left.id.localeCompare(right.id);
}

function compareActivityLifecycleRank(kind: string): number {
  if (kind.endsWith(".started") || kind === "tool.started") {
    return 0;
  }
  if (kind.endsWith(".progress") || kind.endsWith(".updated")) {
    return 1;
  }
  if (kind.endsWith(".completed") || kind.endsWith(".resolved")) {
    return 2;
  }
  return 1;
}

export function hasToolActivityForTurn(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  turnId: TurnId | null | undefined,
): boolean {
  if (!turnId) return false;
  return activities.some((activity) => activity.turnId === turnId && activity.tone === "tool");
}

export function deriveTimelineEntries(
  messages: ChatMessage[],
  proposedPlans: ProposedPlan[],
  workEntries: WorkLogEntry[],
  taskGroups: ReadonlyArray<TaskGroup> = [],
): TimelineEntry[] {
  const messageRows: TimelineEntry[] = messages.map((message) => ({
    id: message.id,
    kind: "message",
    createdAt: message.createdAt,
    message,
  }));
  const proposedPlanRows: TimelineEntry[] = proposedPlans.map((proposedPlan) => ({
    id: proposedPlan.id,
    kind: "proposed-plan",
    createdAt: proposedPlan.createdAt,
    proposedPlan,
  }));
  const workRows: TimelineEntry[] = workEntries.map((entry) => ({
    id: entry.id,
    kind: "work",
    createdAt: entry.createdAt,
    entry,
  }));
  const taskRows: TimelineEntry[] = taskGroups.map((group) => ({
    id: `tasks:${group.turnId ?? group.createdAt}`,
    kind: "tasks",
    createdAt: group.createdAt,
    tasks: group.tasks,
  }));
  return [...messageRows, ...proposedPlanRows, ...workRows, ...taskRows].toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export function inferCheckpointTurnCountByTurnId(
  summaries: TurnDiffSummary[],
): Record<TurnId, number> {
  const sorted = [...summaries].toSorted((a, b) => a.completedAt.localeCompare(b.completedAt));
  const result: Record<TurnId, number> = {};
  for (let index = 0; index < sorted.length; index += 1) {
    const summary = sorted[index];
    if (!summary) continue;
    result[summary.turnId] = index + 1;
  }
  return result;
}

export function derivePhase(session: ThreadSession | null): SessionPhase {
  if (!session || session.status === "closed") return "disconnected";
  if (session.status === "connecting") return "connecting";
  if (session.status === "running") return "running";
  return "ready";
}

// ---------------------------------------------------------------------------
// Task Node derivation — groups task lifecycle activities into structured nodes
// ---------------------------------------------------------------------------

export interface TaskNode {
  taskId: string;
  description: string;
  taskType?: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  lastToolName?: string;
  usage?: unknown;
  latestDetail?: string;
  startedAt: string;
  completedAt?: string;
}

export interface TaskGroup {
  turnId: TurnId | null;
  createdAt: string;
  tasks: ReadonlyArray<TaskNode>;
}

/**
 * Returns genuine provider tasks grouped by turn. Synthetic task records are
 * deliberately excluded: those records mirror turns and tool calls, which are
 * work-log events rather than user-meaningful tasks.
 */
export function deriveTaskGroups(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): TaskGroup[] {
  const taskActivities = activities.filter((activity) => {
    if (
      activity.kind !== "task.started" &&
      activity.kind !== "task.progress" &&
      activity.kind !== "task.completed"
    ) {
      return false;
    }
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    return typeof payload?.taskId === "string" && !payload.taskId.startsWith("synthetic:");
  });
  const activitiesByTurn = new Map<TurnId | null, OrchestrationThreadActivity[]>();
  for (const activity of taskActivities) {
    const turnId = activity.turnId ?? null;
    const existing = activitiesByTurn.get(turnId) ?? [];
    existing.push(activity);
    activitiesByTurn.set(turnId, existing);
  }
  const groupsByTurn = new Map<TurnId | null, TaskGroup>(
    [...activitiesByTurn.entries()].map(([turnId, turnActivities]) => [
      turnId,
      {
        turnId,
        createdAt: turnActivities.reduce(
          (latest, activity) => (activity.createdAt > latest ? activity.createdAt : latest),
          turnActivities[0]?.createdAt ?? new Date(0).toISOString(),
        ),
        tasks: deriveActiveTaskNodes(turnActivities, undefined),
      },
    ]),
  );

  const latestPlanByTurn = new Map<TurnId | null, OrchestrationThreadActivity>();
  for (const activity of activities) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const data =
      payload?.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : null;
    const state =
      data?.state && typeof data.state === "object"
        ? (data.state as Record<string, unknown>)
        : null;
    const input =
      state?.input && typeof state.input === "object"
        ? (state.input as Record<string, unknown>)
        : null;
    const isTodoWriteSnapshot =
      (activity.kind === "tool.updated" || activity.kind === "tool.completed") &&
      typeof data?.tool === "string" &&
      data.tool.toLowerCase() === "todowrite" &&
      Array.isArray(input?.todos);
    if (activity.kind !== "turn.plan.updated" && !isTodoWriteSnapshot) continue;
    const turnId = activity.turnId ?? null;
    const existing = latestPlanByTurn.get(turnId);
    if (!existing || activity.createdAt >= existing.createdAt) {
      latestPlanByTurn.set(turnId, activity);
    }
  }
  for (const [turnId, activity] of latestPlanByTurn) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const data =
      payload?.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : null;
    const state =
      data?.state && typeof data.state === "object"
        ? (data.state as Record<string, unknown>)
        : null;
    const input =
      state?.input && typeof state.input === "object"
        ? (state.input as Record<string, unknown>)
        : null;
    const rawPlan = Array.isArray(payload?.plan)
      ? payload.plan
      : Array.isArray(input?.todos)
        ? input.todos.map((todo) => {
            if (!todo || typeof todo !== "object") return todo;
            const record = todo as Record<string, unknown>;
            return { step: record.content, status: record.status };
          })
        : null;
    if (!rawPlan) continue;
    const planTasks = rawPlan.flatMap((entry, index): TaskNode[] => {
      if (!entry || typeof entry !== "object") return [];
      const step = entry as Record<string, unknown>;
      if (typeof step.step !== "string" || step.step.trim().length === 0) return [];
      const status: TaskNode["status"] =
        step.status === "completed" || step.status === "cancelled"
          ? "completed"
          : step.status === "inProgress" || step.status === "in_progress"
            ? "running"
            : "pending";
      return [
        {
          taskId: `plan:${turnId ?? "unscoped"}:${index}`,
          description: step.step,
          taskType: "plan",
          status,
          startedAt: activity.createdAt,
          ...(status === "completed" ? { completedAt: activity.createdAt } : {}),
        },
      ];
    });
    if (planTasks.length === 0) continue;
    const existing = groupsByTurn.get(turnId);
    groupsByTurn.set(turnId, {
      turnId,
      createdAt:
        existing && existing.createdAt > activity.createdAt
          ? existing.createdAt
          : activity.createdAt,
      tasks: [...(existing?.tasks.filter((task) => task.taskType !== "plan") ?? []), ...planTasks],
    });
  }

  return [...groupsByTurn.values()]
    .filter((group) => group.tasks.length > 0)
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function deriveActiveTaskNodes(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): TaskNode[] {
  const scopedActivities = latestTurnId
    ? activities.filter((a) => a.turnId === latestTurnId)
    : activities;
  const turnActivities = scopedActivities.filter((activity) => {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    return !(typeof payload?.taskId === "string" && payload.taskId.startsWith("synthetic:"));
  });

  const taskMap = new Map<string, TaskNode>();

  for (const activity of turnActivities) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const taskId = payload && typeof payload.taskId === "string" ? payload.taskId : null;
    if (!taskId || !payload) continue;

    if (activity.kind === "task.started") {
      taskMap.set(taskId, {
        taskId,
        description: typeof payload.detail === "string" ? payload.detail : activity.summary,
        ...(typeof payload.taskType === "string" ? { taskType: payload.taskType } : {}),
        status: "running",
        startedAt: activity.createdAt,
      });
    } else if (activity.kind === "task.progress") {
      const existing = taskMap.get(taskId);
      if (existing) {
        if (typeof payload.detail === "string") {
          existing.latestDetail = payload.detail;
        }
        if (typeof payload.lastToolName === "string") {
          existing.lastToolName = payload.lastToolName;
        }
        if (payload.usage !== undefined) {
          existing.usage = payload.usage;
        }
      } else {
        // Progress without a preceding started event — create a node anyway
        const lastToolName =
          typeof payload.lastToolName === "string" ? payload.lastToolName : undefined;
        taskMap.set(taskId, {
          taskId,
          description: typeof payload.detail === "string" ? payload.detail : activity.summary,
          status: "running",
          ...(lastToolName ? { lastToolName } : {}),
          ...(payload.usage !== undefined ? { usage: payload.usage } : {}),
          startedAt: activity.createdAt,
        });
      }
    } else if (activity.kind === "task.completed") {
      const existing = taskMap.get(taskId);
      const status =
        typeof payload.status === "string" ? (payload.status as TaskNode["status"]) : "completed";
      if (existing) {
        existing.status = status;
        existing.completedAt = activity.createdAt;
        if (typeof payload.detail === "string") {
          existing.latestDetail = payload.detail;
        }
        if (payload.usage !== undefined) {
          existing.usage = payload.usage;
        }
      } else {
        taskMap.set(taskId, {
          taskId,
          description: typeof payload.detail === "string" ? payload.detail : activity.summary,
          status,
          startedAt: activity.createdAt,
          completedAt: activity.createdAt,
          ...(payload.usage !== undefined ? { usage: payload.usage } : {}),
        });
      }
    }
  }

  return [...taskMap.values()].toSorted((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/**
 * Returns the most recent task description for use in the "Working..." indicator.
 * Falls back to null when no task progress is available.
 */
export function deriveLatestTaskDescription(taskNodes: ReadonlyArray<TaskNode>): string | null {
  const running = taskNodes.filter((t) => t.status === "running");
  if (running.length === 0) return null;
  const latest = running[running.length - 1];
  if (!latest) return null;
  return latest.latestDetail ?? latest.lastToolName ?? latest.description;
}
