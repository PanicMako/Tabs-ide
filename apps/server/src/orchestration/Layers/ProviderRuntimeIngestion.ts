import {
  ApprovalRequestId,
  type AssistantDeliveryMode,
  CommandId,
  EventId,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationProposedPlanId,
  CheckpointRef,
  isToolLifecycleItemType,
  ThreadId,
  type ThreadTokenUsageSnapshot,
  TurnId,
  type OrchestrationThreadActivity,
  type ProviderRuntimeEvent,
} from "@tabs/contracts";
import { Cache, Cause, Duration, Effect, Layer, Option, Stream } from "effect";
import { makeDrainableWorker } from "@tabs/shared/DrainableWorker";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { isGitRepository } from "../../git/Utils.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ProviderRuntimeIngestionService,
  type ProviderRuntimeIngestionShape,
} from "../Services/ProviderRuntimeIngestion.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const providerTurnKey = (threadId: ThreadId, turnId: TurnId) => `${threadId}:${turnId}`;
const providerCommandId = (event: ProviderRuntimeEvent, tag: string): CommandId =>
  `provider:${event.eventId}:${tag}:${crypto.randomUUID()}` as CommandId;

const TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY = 10_000;
const TURN_MESSAGE_IDS_BY_TURN_TTL = Duration.minutes(120);
const BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY = 20_000;
const BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL = Duration.minutes(120);
const BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY = 10_000;
const BUFFERED_PROPOSED_PLAN_BY_ID_TTL = Duration.minutes(120);
const MAX_BUFFERED_ASSISTANT_CHARS = 24_000;
const STRICT_PROVIDER_LIFECYCLE_GUARD = process.env.TABS_STRICT_PROVIDER_LIFECYCLE_GUARD !== "0";

type TurnStartRequestedDomainEvent = Extract<
  OrchestrationEvent,
  { type: "thread.turn-start-requested" }
>;

type RuntimeIngestionInput =
  | {
      source: "runtime";
      event: ProviderRuntimeEvent;
    }
  | {
      source: "domain";
      event: TurnStartRequestedDomainEvent;
    };

function toTurnId(value: TurnId | string | undefined): TurnId | undefined {
  return value === undefined ? undefined : (String(value) as TurnId);
}

function toApprovalRequestId(value: string | undefined): ApprovalRequestId | undefined {
  return value === undefined ? undefined : (value as ApprovalRequestId);
}

function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return left === right;
}

function truncateDetail(value: string, limit = 180): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

function normalizeProposedPlanMarkdown(planMarkdown: string | undefined): string | undefined {
  const trimmed = planMarkdown?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

function proposedPlanIdForTurn(threadId: ThreadId, turnId: TurnId): string {
  return `plan:${threadId}:turn:${turnId}`;
}

function proposedPlanIdFromEvent(event: ProviderRuntimeEvent, threadId: ThreadId): string {
  const turnId = toTurnId(event.turnId);
  if (turnId) {
    return proposedPlanIdForTurn(threadId, turnId);
  }
  if (event.itemId) {
    return `plan:${threadId}:item:${event.itemId}`;
  }
  return `plan:${threadId}:event:${event.eventId}`;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function buildContextWindowActivityPayload(
  event: ProviderRuntimeEvent,
): ThreadTokenUsageSnapshot | undefined {
  if (event.type !== "thread.token-usage.updated" || event.payload.usage.usedTokens <= 0) {
    return undefined;
  }
  return event.payload.usage;
}

function runtimePayloadRecord(event: ProviderRuntimeEvent): Record<string, unknown> | undefined {
  const payload = (event as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  return payload as Record<string, unknown>;
}

function normalizeRuntimeTurnState(
  value: string | undefined,
): "completed" | "failed" | "interrupted" | "cancelled" {
  switch (value) {
    case "failed":
    case "interrupted":
    case "cancelled":
    case "completed":
      return value;
    default:
      return "completed";
  }
}

function runtimeTurnState(
  event: ProviderRuntimeEvent,
): "completed" | "failed" | "interrupted" | "cancelled" {
  const payloadState = asString(runtimePayloadRecord(event)?.state);
  return normalizeRuntimeTurnState(payloadState);
}

function runtimeTurnErrorMessage(event: ProviderRuntimeEvent): string | undefined {
  const payloadErrorMessage = asString(runtimePayloadRecord(event)?.errorMessage);
  return payloadErrorMessage;
}

function runtimeErrorMessageFromEvent(event: ProviderRuntimeEvent): string | undefined {
  const payloadMessage = asString(runtimePayloadRecord(event)?.message);
  return payloadMessage;
}

function providerSupportsNativeTaskEvents(provider: ProviderRuntimeEvent["provider"]): boolean {
  return provider === "claudeAgent";
}

function syntheticTurnTaskId(
  threadId: ThreadId,
  turnId: TurnId | undefined,
  eventId: string,
): string {
  return `synthetic:task:turn:${threadId}:${turnId ?? eventId}`;
}

function syntheticItemTaskId(threadId: ThreadId, itemId: string): string {
  return `synthetic:task:item:${threadId}:${itemId}`;
}

function syntheticTaskSummaryForItemType(itemType: string): string {
  switch (itemType) {
    case "command_execution":
      return "Running command";
    case "file_change":
      return "Editing files";
    case "mcp_tool_call":
      return "Calling MCP tool";
    case "dynamic_tool_call":
      return "Running tool";
    case "collab_agent_tool_call":
      return "Running subagent";
    case "web_search":
      return "Searching the web";
    case "image_view":
      return "Inspecting image";
    default:
      return "Working";
  }
}

function syntheticTaskDetailFromItemEvent(event: ProviderRuntimeEvent): string | undefined {
  if (
    (event.type !== "item.started" &&
      event.type !== "item.updated" &&
      event.type !== "item.completed") ||
    !isToolLifecycleItemType(event.payload.itemType)
  ) {
    return undefined;
  }

  return (
    event.payload.detail ??
    event.payload.title ??
    syntheticTaskSummaryForItemType(event.payload.itemType)
  );
}

function runtimeEventSequence(
  event: ProviderRuntimeEvent,
): { sequence: number } | Record<string, never> {
  const eventWithSequence = event as ProviderRuntimeEvent & { sessionSequence?: number };
  return eventWithSequence.sessionSequence !== undefined
    ? { sequence: eventWithSequence.sessionSequence }
    : {};
}

function syntheticActivityId(event: ProviderRuntimeEvent, suffix: string): EventId {
  return `${event.eventId}:${suffix}` as EventId;
}

function syntheticTaskActivitiesFromRuntimeEvent(input: {
  event: ProviderRuntimeEvent;
  activeTurnId: TurnId | null;
  enabled: boolean;
}): ReadonlyArray<OrchestrationThreadActivity> {
  const { event, activeTurnId, enabled } = input;
  if (!enabled || providerSupportsNativeTaskEvents(event.provider)) {
    return [];
  }

  const maybeSequence = runtimeEventSequence(event);

  switch (event.type) {
    case "turn.started": {
      const turnId = toTurnId(event.turnId);
      if (!turnId) {
        return [];
      }
      return [
        {
          id: syntheticActivityId(event, "synthetic-task-started"),
          createdAt: event.createdAt,
          tone: "info",
          kind: "task.started",
          summary: "Task started",
          payload: {
            taskId: syntheticTurnTaskId(event.threadId, turnId, event.eventId),
            taskType: "turn",
            detail: "Analyzing prompt and planning steps",
          },
          turnId,
          ...maybeSequence,
        },
      ];
    }

    case "turn.completed": {
      const turnId = toTurnId(event.turnId) ?? activeTurnId ?? undefined;
      if (!turnId) {
        return [];
      }
      const state = runtimeTurnState(event);
      const status =
        state === "failed"
          ? "failed"
          : state === "interrupted" || state === "cancelled"
            ? "stopped"
            : "completed";
      const detail =
        runtimeTurnErrorMessage(event) ??
        event.payload.stopReason ??
        (status === "completed" ? "Response completed" : undefined);
      return [
        {
          id: syntheticActivityId(event, "synthetic-task-completed"),
          createdAt: event.createdAt,
          tone: status === "failed" ? "error" : "info",
          kind: "task.completed",
          summary:
            status === "failed"
              ? "Task failed"
              : status === "stopped"
                ? "Task stopped"
                : "Task completed",
          payload: {
            taskId: syntheticTurnTaskId(event.threadId, turnId, event.eventId),
            status,
            ...(detail ? { detail: truncateDetail(detail) } : {}),
            ...(event.payload.usage !== undefined ? { usage: event.payload.usage } : {}),
          },
          turnId,
          ...maybeSequence,
        },
      ];
    }

    case "runtime.error": {
      const turnId = toTurnId(event.turnId) ?? activeTurnId ?? undefined;
      if (!turnId) {
        return [];
      }
      return [
        {
          id: syntheticActivityId(event, "synthetic-task-failed"),
          createdAt: event.createdAt,
          tone: "error",
          kind: "task.completed",
          summary: "Task failed",
          payload: {
            taskId: syntheticTurnTaskId(event.threadId, turnId, event.eventId),
            status: "failed",
            ...(runtimeErrorMessageFromEvent(event)
              ? { detail: truncateDetail(runtimeErrorMessageFromEvent(event)!) }
              : {}),
          },
          turnId,
          ...maybeSequence,
        },
      ];
    }

    case "session.exited": {
      const turnId = activeTurnId ?? toTurnId(event.turnId) ?? undefined;
      if (!turnId) {
        return [];
      }
      const status = event.payload.exitKind === "error" ? "failed" : "stopped";
      return [
        {
          id: syntheticActivityId(event, "synthetic-task-session-exited"),
          createdAt: event.createdAt,
          tone: status === "failed" ? "error" : "info",
          kind: "task.completed",
          summary: status === "failed" ? "Task failed" : "Task stopped",
          payload: {
            taskId: syntheticTurnTaskId(event.threadId, turnId, event.eventId),
            status,
            ...(event.payload.reason ? { detail: truncateDetail(event.payload.reason) } : {}),
          },
          turnId,
          ...maybeSequence,
        },
      ];
    }

    case "item.started": {
      if (!isToolLifecycleItemType(event.payload.itemType) || !event.itemId) {
        return [];
      }
      return [
        {
          id: syntheticActivityId(event, "synthetic-item-task-started"),
          createdAt: event.createdAt,
          tone: "info",
          kind: "task.started",
          summary: "Task started",
          payload: {
            taskId: syntheticItemTaskId(event.threadId, event.itemId),
            taskType: event.payload.itemType,
            detail: truncateDetail(syntheticTaskDetailFromItemEvent(event) ?? "Working"),
          },
          turnId: toTurnId(event.turnId) ?? activeTurnId,
          ...maybeSequence,
        },
      ];
    }

    case "item.updated": {
      if (!isToolLifecycleItemType(event.payload.itemType) || !event.itemId) {
        return [];
      }
      const detail = syntheticTaskDetailFromItemEvent(event) ?? "Working";
      return [
        {
          id: syntheticActivityId(event, "synthetic-item-task-progress"),
          createdAt: event.createdAt,
          tone: "info",
          kind: "task.progress",
          summary: "Reasoning update",
          payload: {
            taskId: syntheticItemTaskId(event.threadId, event.itemId),
            detail: truncateDetail(detail),
            summary: truncateDetail(detail),
            ...(event.payload.title ? { lastToolName: truncateDetail(event.payload.title) } : {}),
          },
          turnId: toTurnId(event.turnId) ?? activeTurnId,
          ...maybeSequence,
        },
      ];
    }

    case "item.completed": {
      if (!isToolLifecycleItemType(event.payload.itemType) || !event.itemId) {
        return [];
      }
      const status =
        event.payload.status === "failed" || event.payload.status === "declined"
          ? "failed"
          : "completed";
      const detail = syntheticTaskDetailFromItemEvent(event);
      return [
        {
          id: syntheticActivityId(event, "synthetic-item-task-completed"),
          createdAt: event.createdAt,
          tone: status === "failed" ? "error" : "info",
          kind: "task.completed",
          summary: status === "failed" ? "Task failed" : "Task completed",
          payload: {
            taskId: syntheticItemTaskId(event.threadId, event.itemId),
            status,
            ...(detail ? { detail: truncateDetail(detail) } : {}),
          },
          turnId: toTurnId(event.turnId) ?? activeTurnId,
          ...maybeSequence,
        },
      ];
    }

    default:
      return [];
  }
}

function orchestrationSessionStatusFromRuntimeState(
  state: "starting" | "running" | "waiting" | "ready" | "interrupted" | "stopped" | "error",
): "starting" | "running" | "ready" | "interrupted" | "stopped" | "error" {
  switch (state) {
    case "starting":
      return "starting";
    case "running":
    case "waiting":
      return "running";
    case "ready":
      return "ready";
    case "interrupted":
      return "interrupted";
    case "stopped":
      return "stopped";
    case "error":
      return "error";
  }
}

function requestKindFromCanonicalRequestType(
  requestType: string | undefined,
): "command" | "file-read" | "file-change" | undefined {
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
      return undefined;
  }
}

function runtimeEventToActivities(
  event: ProviderRuntimeEvent,
): ReadonlyArray<OrchestrationThreadActivity> {
  const maybeSequence = runtimeEventSequence(event);
  switch (event.type) {
    case "request.opened": {
      if (event.payload.requestType === "tool_user_input") {
        return [];
      }
      const requestKind = requestKindFromCanonicalRequestType(event.payload.requestType);
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "approval",
          kind: "approval.requested",
          summary:
            requestKind === "command"
              ? "Command approval requested"
              : requestKind === "file-read"
                ? "File-read approval requested"
                : requestKind === "file-change"
                  ? "File-change approval requested"
                  : "Approval requested",
          payload: {
            requestId: toApprovalRequestId(event.requestId),
            ...(requestKind ? { requestKind } : {}),
            requestType: event.payload.requestType,
            ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
            ...(event.payload.appName ? { appName: event.payload.appName } : {}),
            ...(event.payload.options ? { options: event.payload.options } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "request.resolved": {
      if (event.payload.requestType === "tool_user_input") {
        return [];
      }
      const requestKind = requestKindFromCanonicalRequestType(event.payload.requestType);
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "approval",
          kind: "approval.resolved",
          summary: "Approval resolved",
          payload: {
            requestId: toApprovalRequestId(event.requestId),
            ...(requestKind ? { requestKind } : {}),
            requestType: event.payload.requestType,
            ...(event.payload.decision ? { decision: event.payload.decision } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "runtime.error": {
      const message = runtimeErrorMessageFromEvent(event);
      if (!message) {
        return [];
      }
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "error",
          kind: "runtime.error",
          summary: "Runtime error",
          payload: {
            message: truncateDetail(message),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "runtime.warning": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "runtime.warning",
          summary: "Runtime warning",
          payload: {
            message: truncateDetail(event.payload.message),
            ...(event.payload.detail !== undefined ? { detail: event.payload.detail } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "turn.plan.updated": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "turn.plan.updated",
          summary: "Plan updated",
          payload: {
            plan: event.payload.plan,
            ...(event.payload.explanation !== undefined
              ? { explanation: event.payload.explanation }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "user-input.requested": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "user-input.requested",
          summary: "User input requested",
          payload: {
            ...(event.requestId ? { requestId: event.requestId } : {}),
            questions: event.payload.questions,
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "user-input.resolved": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "user-input.resolved",
          summary: "User input submitted",
          payload: {
            ...(event.requestId ? { requestId: event.requestId } : {}),
            answers: event.payload.answers,
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.started": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "task.started",
          summary:
            event.payload.taskType === "plan"
              ? "Plan task started"
              : event.payload.taskType
                ? `${event.payload.taskType} task started`
                : "Task started",
          payload: {
            taskId: event.payload.taskId,
            ...(event.payload.taskType ? { taskType: event.payload.taskType } : {}),
            ...(event.payload.description
              ? { detail: truncateDetail(event.payload.description) }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.progress": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "task.progress",
          summary: "Reasoning update",
          payload: {
            taskId: event.payload.taskId,
            detail: truncateDetail(event.payload.summary ?? event.payload.description),
            ...(event.payload.summary ? { summary: truncateDetail(event.payload.summary) } : {}),
            ...(event.payload.lastToolName ? { lastToolName: event.payload.lastToolName } : {}),
            ...(event.payload.usage !== undefined ? { usage: event.payload.usage } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.completed": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: event.payload.status === "failed" ? "error" : "info",
          kind: "task.completed",
          summary:
            event.payload.status === "failed"
              ? "Task failed"
              : event.payload.status === "stopped"
                ? "Task stopped"
                : "Task completed",
          payload: {
            taskId: event.payload.taskId,
            status: event.payload.status,
            ...(event.payload.summary ? { detail: truncateDetail(event.payload.summary) } : {}),
            ...(event.payload.usage !== undefined ? { usage: event.payload.usage } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "thread.state.changed": {
      if (event.payload.state !== "compacted") {
        return [];
      }

      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "context-compaction",
          summary: "Context compacted",
          payload: {
            state: event.payload.state,
            ...(event.payload.detail !== undefined ? { detail: event.payload.detail } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "thread.token-usage.updated": {
      const payload = buildContextWindowActivityPayload(event);
      if (!payload) {
        return [];
      }

      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "context-window.updated",
          summary: "Context window updated",
          payload,
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "item.updated": {
      if (!isToolLifecycleItemType(event.payload.itemType)) {
        return [];
      }
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool.updated",
          summary: event.payload.title ?? "Tool updated",
          payload: {
            itemType: event.payload.itemType,
            ...(event.payload.status ? { status: event.payload.status } : {}),
            ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
            ...(event.payload.data !== undefined ? { data: event.payload.data } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "item.completed": {
      if (!isToolLifecycleItemType(event.payload.itemType)) {
        return [];
      }
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool.completed",
          summary: event.payload.title ?? "Tool",
          payload: {
            itemType: event.payload.itemType,
            ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "item.started": {
      if (!isToolLifecycleItemType(event.payload.itemType)) {
        return [];
      }
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool.started",
          summary: `${event.payload.title ?? "Tool"} started`,
          payload: {
            itemType: event.payload.itemType,
            ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "hook.started": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "hook.started",
          summary: `Hook: ${event.payload.hookName}`,
          payload: {
            hookId: event.payload.hookId,
            hookName: event.payload.hookName,
            hookEvent: event.payload.hookEvent,
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "hook.progress": {
      const hookOutput = event.payload.output ?? event.payload.stdout ?? event.payload.stderr;
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "hook.progress",
          summary: "Hook progress",
          payload: {
            hookId: event.payload.hookId,
            ...(hookOutput ? { detail: truncateDetail(hookOutput) } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "hook.completed": {
      const hookCompletedOutput =
        event.payload.output ?? event.payload.stdout ?? event.payload.stderr;
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: event.payload.outcome === "error" ? "error" : "info",
          kind: "hook.completed",
          summary:
            event.payload.outcome === "error"
              ? "Hook failed"
              : event.payload.outcome === "cancelled"
                ? "Hook cancelled"
                : "Hook completed",
          payload: {
            hookId: event.payload.hookId,
            outcome: event.payload.outcome,
            ...(hookCompletedOutput ? { detail: truncateDetail(hookCompletedOutput) } : {}),
            ...(event.payload.exitCode !== undefined ? { exitCode: event.payload.exitCode } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "tool.progress": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool.progress",
          summary: event.payload.toolName ?? "Tool progress",
          payload: {
            ...(event.payload.toolUseId ? { toolUseId: event.payload.toolUseId } : {}),
            ...(event.payload.toolName ? { toolName: event.payload.toolName } : {}),
            ...(event.payload.summary ? { detail: truncateDetail(event.payload.summary) } : {}),
            ...(event.payload.elapsedSeconds !== undefined
              ? { elapsedSeconds: event.payload.elapsedSeconds }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "tool.summary": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool.summary",
          summary: "Tool summary",
          payload: {
            detail: truncateDetail(event.payload.summary),
            ...(event.payload.precedingToolUseIds
              ? { precedingToolUseIds: event.payload.precedingToolUseIds }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    default:
      break;
  }

  return [];
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const projectionTurnRepository = yield* ProjectionTurnRepository;
  const serverSettingsService = yield* ServerSettingsService;

  const turnMessageIdsByTurnKey = yield* Cache.make<string, Set<MessageId>>({
    capacity: TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY,
    timeToLive: TURN_MESSAGE_IDS_BY_TURN_TTL,
    lookup: () => Effect.succeed(new Set<MessageId>()),
  });

  const bufferedAssistantTextByMessageId = yield* Cache.make<MessageId, string>({
    capacity: BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY,
    timeToLive: BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL,
    lookup: () => Effect.succeed(""),
  });

  const bufferedProposedPlanById = yield* Cache.make<string, { text: string; createdAt: string }>({
    capacity: BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY,
    timeToLive: BUFFERED_PROPOSED_PLAN_BY_ID_TTL,
    lookup: () => Effect.succeed({ text: "", createdAt: "" }),
  });

  const isGitRepoForThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const thread = readModel.threads.find((entry) => entry.id === threadId);
    if (!thread) {
      return false;
    }
    const workspaceCwd = resolveThreadWorkspaceCwd({
      thread,
      projects: readModel.projects,
    });
    if (!workspaceCwd) {
      return false;
    }
    return isGitRepository(workspaceCwd);
  });

  const rememberAssistantMessageId = (threadId: ThreadId, turnId: TurnId, messageId: MessageId) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.flatMap((existingIds) =>
        Cache.set(
          turnMessageIdsByTurnKey,
          providerTurnKey(threadId, turnId),
          Option.match(existingIds, {
            onNone: () => new Set([messageId]),
            onSome: (ids) => {
              const nextIds = new Set(ids);
              nextIds.add(messageId);
              return nextIds;
            },
          }),
        ),
      ),
    );

  const forgetAssistantMessageId = (threadId: ThreadId, turnId: TurnId, messageId: MessageId) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.flatMap((existingIds) =>
        Option.match(existingIds, {
          onNone: () => Effect.void,
          onSome: (ids) => {
            const nextIds = new Set(ids);
            nextIds.delete(messageId);
            if (nextIds.size === 0) {
              return Cache.invalidate(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId));
            }
            return Cache.set(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId), nextIds);
          },
        }),
      ),
    );

  const getAssistantMessageIdsForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.map((existingIds) =>
        Option.getOrElse(existingIds, (): Set<MessageId> => new Set<MessageId>()),
      ),
    );

  const clearAssistantMessageIdsForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Cache.invalidate(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId));

  const appendBufferedAssistantText = (messageId: MessageId, delta: string) =>
    Cache.getOption(bufferedAssistantTextByMessageId, messageId).pipe(
      Effect.flatMap((existingText) =>
        Effect.gen(function* () {
          const nextText = Option.match(existingText, {
            onNone: () => delta,
            onSome: (text) => `${text}${delta}`,
          });
          if (nextText.length <= MAX_BUFFERED_ASSISTANT_CHARS) {
            yield* Cache.set(bufferedAssistantTextByMessageId, messageId, nextText);
            return "";
          }

          // Safety valve: flush full buffered text as an assistant delta to cap memory.
          yield* Cache.invalidate(bufferedAssistantTextByMessageId, messageId);
          return nextText;
        }),
      ),
    );

  const takeBufferedAssistantText = (messageId: MessageId) =>
    Cache.getOption(bufferedAssistantTextByMessageId, messageId).pipe(
      Effect.flatMap((existingText) =>
        Cache.invalidate(bufferedAssistantTextByMessageId, messageId).pipe(
          Effect.as(Option.getOrElse(existingText, () => "")),
        ),
      ),
    );

  const clearBufferedAssistantText = (messageId: MessageId) =>
    Cache.invalidate(bufferedAssistantTextByMessageId, messageId);

  const appendBufferedProposedPlan = (planId: string, delta: string, createdAt: string) =>
    Cache.getOption(bufferedProposedPlanById, planId).pipe(
      Effect.flatMap((existingEntry) => {
        const existing = Option.getOrUndefined(existingEntry);
        return Cache.set(bufferedProposedPlanById, planId, {
          text: `${existing?.text ?? ""}${delta}`,
          createdAt:
            existing?.createdAt && existing.createdAt.length > 0 ? existing.createdAt : createdAt,
        });
      }),
    );

  const takeBufferedProposedPlan = (planId: string) =>
    Cache.getOption(bufferedProposedPlanById, planId).pipe(
      Effect.flatMap((existingEntry) =>
        Cache.invalidate(bufferedProposedPlanById, planId).pipe(
          Effect.as(Option.getOrUndefined(existingEntry)),
        ),
      ),
    );

  const clearBufferedProposedPlan = (planId: string) =>
    Cache.invalidate(bufferedProposedPlanById, planId);

  const clearAssistantMessageState = (messageId: MessageId) =>
    clearBufferedAssistantText(messageId);

  const finalizeAssistantMessage = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    messageId: MessageId;
    turnId?: TurnId;
    createdAt: string;
    commandTag: string;
    finalDeltaCommandTag: string;
    fallbackText?: string;
  }) =>
    Effect.gen(function* () {
      const bufferedText = yield* takeBufferedAssistantText(input.messageId);
      const text =
        bufferedText.length > 0
          ? bufferedText
          : (input.fallbackText?.trim().length ?? 0) > 0
            ? input.fallbackText!
            : "";

      if (text.length > 0) {
        yield* orchestrationEngine.dispatch({
          type: "thread.message.assistant.delta",
          commandId: providerCommandId(input.event, input.finalDeltaCommandTag),
          threadId: input.threadId,
          messageId: input.messageId,
          delta: text,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          createdAt: input.createdAt,
        });
      }

      yield* orchestrationEngine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: providerCommandId(input.event, input.commandTag),
        threadId: input.threadId,
        messageId: input.messageId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        createdAt: input.createdAt,
      });
      yield* clearAssistantMessageState(input.messageId);
    });

  const upsertProposedPlan = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    threadProposedPlans: ReadonlyArray<{
      id: string;
      createdAt: string;
      implementedAt: string | null;
      implementationThreadId: ThreadId | null;
    }>;
    planId: string;
    turnId?: TurnId;
    planMarkdown: string | undefined;
    createdAt: string;
    updatedAt: string;
  }) =>
    Effect.gen(function* () {
      const planMarkdown = normalizeProposedPlanMarkdown(input.planMarkdown);
      if (!planMarkdown) {
        return;
      }

      const existingPlan = input.threadProposedPlans.find((entry) => entry.id === input.planId);
      yield* orchestrationEngine.dispatch({
        type: "thread.proposed-plan.upsert",
        commandId: providerCommandId(input.event, "proposed-plan-upsert"),
        threadId: input.threadId,
        proposedPlan: {
          id: input.planId,
          turnId: input.turnId ?? null,
          planMarkdown,
          implementedAt: existingPlan?.implementedAt ?? null,
          implementationThreadId: existingPlan?.implementationThreadId ?? null,
          createdAt: existingPlan?.createdAt ?? input.createdAt,
          updatedAt: input.updatedAt,
        },
        createdAt: input.updatedAt,
      });
    });

  const finalizeBufferedProposedPlan = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    threadProposedPlans: ReadonlyArray<{
      id: string;
      createdAt: string;
      implementedAt: string | null;
      implementationThreadId: ThreadId | null;
    }>;
    planId: string;
    turnId?: TurnId;
    fallbackMarkdown?: string;
    updatedAt: string;
  }) =>
    Effect.gen(function* () {
      const bufferedPlan = yield* takeBufferedProposedPlan(input.planId);
      const bufferedMarkdown = normalizeProposedPlanMarkdown(bufferedPlan?.text);
      const fallbackMarkdown = normalizeProposedPlanMarkdown(input.fallbackMarkdown);
      const planMarkdown = bufferedMarkdown ?? fallbackMarkdown;
      if (!planMarkdown) {
        return;
      }

      yield* upsertProposedPlan({
        event: input.event,
        threadId: input.threadId,
        threadProposedPlans: input.threadProposedPlans,
        planId: input.planId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        planMarkdown,
        createdAt:
          bufferedPlan?.createdAt && bufferedPlan.createdAt.length > 0
            ? bufferedPlan.createdAt
            : input.updatedAt,
        updatedAt: input.updatedAt,
      });
      yield* clearBufferedProposedPlan(input.planId);
    });

  const clearTurnStateForSession = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const prefix = `${threadId}:`;
      const proposedPlanPrefix = `plan:${threadId}:`;
      const turnKeys = Array.from(yield* Cache.keys(turnMessageIdsByTurnKey));
      const proposedPlanKeys = Array.from(yield* Cache.keys(bufferedProposedPlanById));
      yield* Effect.forEach(
        turnKeys,
        (key) =>
          Effect.gen(function* () {
            if (!key.startsWith(prefix)) {
              return;
            }

            const messageIds = yield* Cache.getOption(turnMessageIdsByTurnKey, key);
            if (Option.isSome(messageIds)) {
              yield* Effect.forEach(messageIds.value, clearAssistantMessageState, {
                concurrency: 1,
              }).pipe(Effect.asVoid);
            }

            yield* Cache.invalidate(turnMessageIdsByTurnKey, key);
          }),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      yield* Effect.forEach(
        proposedPlanKeys,
        (key) =>
          key.startsWith(proposedPlanPrefix)
            ? Cache.invalidate(bufferedProposedPlanById, key)
            : Effect.void,
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
    });

  const getSourceProposedPlanReferenceForPendingTurnStart = Effect.fnUntraced(function* (
    threadId: ThreadId,
  ) {
    const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
      threadId,
    });
    if (Option.isNone(pendingTurnStart)) {
      return null;
    }

    const sourceThreadId = pendingTurnStart.value.sourceProposedPlanThreadId;
    const sourcePlanId = pendingTurnStart.value.sourceProposedPlanId;
    if (sourceThreadId === null || sourcePlanId === null) {
      return null;
    }

    return {
      sourceThreadId,
      sourcePlanId,
    } as const;
  });

  const getExpectedProviderTurnIdForThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const sessions = yield* providerService.listSessions();
    const session = sessions.find((entry) => entry.threadId === threadId);
    return session?.activeTurnId;
  });

  const getSourceProposedPlanReferenceForAcceptedTurnStart = Effect.fnUntraced(function* (
    threadId: ThreadId,
    eventTurnId: TurnId | undefined,
  ) {
    if (eventTurnId === undefined) {
      return null;
    }

    const expectedTurnId = yield* getExpectedProviderTurnIdForThread(threadId);
    if (!sameId(expectedTurnId, eventTurnId)) {
      return null;
    }

    return yield* getSourceProposedPlanReferenceForPendingTurnStart(threadId);
  });

  const markSourceProposedPlanImplemented = Effect.fnUntraced(function* (
    sourceThreadId: ThreadId,
    sourcePlanId: OrchestrationProposedPlanId,
    implementationThreadId: ThreadId,
    implementedAt: string,
  ) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const sourceThread = readModel.threads.find((entry) => entry.id === sourceThreadId);
    const sourcePlan = sourceThread?.proposedPlans.find((entry) => entry.id === sourcePlanId);
    if (!sourceThread || !sourcePlan || sourcePlan.implementedAt !== null) {
      return;
    }

    yield* orchestrationEngine.dispatch({
      type: "thread.proposed-plan.upsert",
      commandId:
        `provider:source-proposed-plan-implemented:${implementationThreadId}:${crypto.randomUUID()}` as CommandId,
      threadId: sourceThread.id,
      proposedPlan: {
        ...sourcePlan,
        implementedAt,
        implementationThreadId,
        updatedAt: implementedAt,
      },
      createdAt: implementedAt,
    });
  });

  const processRuntimeEvent = (event: ProviderRuntimeEvent) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const thread = readModel.threads.find((entry) => entry.id === event.threadId);
      if (!thread) return;

      const now = event.createdAt;
      const eventTurnId = toTurnId(event.turnId);
      const activeTurnId = thread.session?.activeTurnId ?? null;
      const alwaysCreateTasks = yield* Effect.map(
        serverSettingsService.getSettings,
        (settings) => settings.alwaysCreateTasks,
      );

      const conflictsWithActiveTurn =
        activeTurnId !== null && eventTurnId !== undefined && !sameId(activeTurnId, eventTurnId);
      const missingTurnForActiveTurn = activeTurnId !== null && eventTurnId === undefined;

      const shouldApplyThreadLifecycle = (() => {
        if (!STRICT_PROVIDER_LIFECYCLE_GUARD) {
          return true;
        }
        switch (event.type) {
          case "session.exited":
            return true;
          case "session.started":
          case "thread.started":
            return true;
          case "turn.started":
            return !conflictsWithActiveTurn;
          case "turn.completed":
            if (conflictsWithActiveTurn || missingTurnForActiveTurn) {
              return false;
            }
            // Only the active turn may close the lifecycle state.
            if (activeTurnId !== null && eventTurnId !== undefined) {
              return sameId(activeTurnId, eventTurnId);
            }
            // If no active turn is tracked, accept completion scoped to this thread.
            return true;
          default:
            return true;
        }
      })();
      const acceptedTurnStartedSourcePlan =
        event.type === "turn.started" && shouldApplyThreadLifecycle
          ? yield* getSourceProposedPlanReferenceForAcceptedTurnStart(thread.id, eventTurnId)
          : null;

      if (
        event.type === "session.started" ||
        event.type === "session.state.changed" ||
        event.type === "session.exited" ||
        event.type === "thread.started" ||
        event.type === "turn.started" ||
        event.type === "turn.completed"
      ) {
        const nextActiveTurnId =
          event.type === "turn.started"
            ? (eventTurnId ?? null)
            : event.type === "turn.completed" || event.type === "session.exited"
              ? null
              : activeTurnId;
        const status = (() => {
          switch (event.type) {
            case "session.state.changed":
              return orchestrationSessionStatusFromRuntimeState(event.payload.state);
            case "turn.started":
              return "running";
            case "session.exited":
              return "stopped";
            case "turn.completed":
              return runtimeTurnState(event) === "failed" ? "error" : "ready";
            case "session.started":
            case "thread.started":
              // Provider thread/session start notifications can arrive during an
              // active turn; preserve turn-running state in that case.
              return activeTurnId !== null ? "running" : "ready";
          }
        })();
        const lastError =
          event.type === "session.state.changed" && event.payload.state === "error"
            ? (event.payload.reason ?? thread.session?.lastError ?? "Provider session error")
            : event.type === "turn.completed" && runtimeTurnState(event) === "failed"
              ? (runtimeTurnErrorMessage(event) ?? thread.session?.lastError ?? "Turn failed")
              : status === "ready"
                ? null
                : (thread.session?.lastError ?? null);

        if (shouldApplyThreadLifecycle) {
          if (event.type === "turn.started" && acceptedTurnStartedSourcePlan !== null) {
            yield* markSourceProposedPlanImplemented(
              acceptedTurnStartedSourcePlan.sourceThreadId,
              acceptedTurnStartedSourcePlan.sourcePlanId,
              thread.id,
              now,
            ).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning(
                  "provider runtime ingestion failed to mark source proposed plan",
                  {
                    eventId: event.eventId,
                    eventType: event.type,
                    cause: Cause.pretty(cause),
                  },
                ),
              ),
            );
          }

          yield* orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: providerCommandId(event, "thread-session-set"),
            threadId: thread.id,
            session: {
              threadId: thread.id,
              status,
              providerName: event.provider,
              runtimeMode: thread.session?.runtimeMode ?? "full-access",
              activeTurnId: nextActiveTurnId,
              lastError,
              updatedAt: now,
            },
            createdAt: now,
          });
        }

        // If a turn.completed was rejected by the lifecycle guard but the
        // session is still "running" with an activeTurnId that no longer
        // matches any provider turn, transition to "ready" to prevent
        // the session from being stuck in "running" indefinitely.
        // Only apply this fallback for the missing-turnId case (where the
        // runtime omits threadId/turnId entirely). Do NOT apply it when the
        // completed turn explicitly conflicts with the active turn — that is an
        // auxiliary completion that should be ignored without changing state.
        if (
          !shouldApplyThreadLifecycle &&
          event.type === "turn.completed" &&
          thread.session?.status === "running" &&
          !conflictsWithActiveTurn
        ) {
          yield* orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: providerCommandId(event, "turn-completed-fallback-ready"),
            threadId: thread.id,
            session: {
              threadId: thread.id,
              status: "ready",
              providerName: event.provider,
              runtimeMode: thread.session.runtimeMode ?? "full-access",
              activeTurnId: null,
              lastError: null,
              updatedAt: now,
            },
            createdAt: now,
          });
        }
      }

      const assistantDelta =
        event.type === "content.delta" && event.payload.streamKind === "assistant_text"
          ? event.payload.delta
          : undefined;
      const proposedPlanDelta =
        event.type === "turn.proposed.delta" ? event.payload.delta : undefined;

      if (assistantDelta && assistantDelta.length > 0) {
        const assistantMessageId =
          `assistant:${event.itemId ?? event.turnId ?? event.eventId}` as MessageId;
        const turnId = toTurnId(event.turnId);
        if (turnId) {
          yield* rememberAssistantMessageId(thread.id, turnId, assistantMessageId);
        }

        const assistantDeliveryMode: AssistantDeliveryMode = yield* Effect.map(
          serverSettingsService.getSettings,
          (settings) => (settings.enableAssistantStreaming ? "streaming" : "buffered"),
        );
        if (assistantDeliveryMode === "buffered") {
          const spillChunk = yield* appendBufferedAssistantText(assistantMessageId, assistantDelta);
          if (spillChunk.length > 0) {
            yield* orchestrationEngine.dispatch({
              type: "thread.message.assistant.delta",
              commandId: providerCommandId(event, "assistant-delta-buffer-spill"),
              threadId: thread.id,
              messageId: assistantMessageId,
              delta: spillChunk,
              ...(turnId ? { turnId } : {}),
              createdAt: now,
            });
          }
        } else {
          yield* orchestrationEngine.dispatch({
            type: "thread.message.assistant.delta",
            commandId: providerCommandId(event, "assistant-delta"),
            threadId: thread.id,
            messageId: assistantMessageId,
            delta: assistantDelta,
            ...(turnId ? { turnId } : {}),
            createdAt: now,
          });
        }
      }

      if (proposedPlanDelta && proposedPlanDelta.length > 0) {
        const planId = proposedPlanIdFromEvent(event, thread.id);
        yield* appendBufferedProposedPlan(planId, proposedPlanDelta, now);
      }

      const assistantCompletion =
        event.type === "item.completed" && event.payload.itemType === "assistant_message"
          ? {
              messageId: `assistant:${event.itemId ?? event.turnId ?? event.eventId}` as MessageId,
              fallbackText: event.payload.detail,
            }
          : undefined;
      const proposedPlanCompletion =
        event.type === "turn.proposed.completed"
          ? {
              planId: proposedPlanIdFromEvent(event, thread.id),
              turnId: toTurnId(event.turnId),
              planMarkdown: event.payload.planMarkdown,
            }
          : undefined;

      if (assistantCompletion) {
        const assistantMessageId = assistantCompletion.messageId;
        const turnId = toTurnId(event.turnId);
        const existingAssistantMessage = thread.messages.find(
          (entry) => entry.id === assistantMessageId,
        );
        const shouldApplyFallbackCompletionText =
          !existingAssistantMessage || existingAssistantMessage.text.length === 0;
        if (turnId) {
          yield* rememberAssistantMessageId(thread.id, turnId, assistantMessageId);
        }

        yield* finalizeAssistantMessage({
          event,
          threadId: thread.id,
          messageId: assistantMessageId,
          ...(turnId ? { turnId } : {}),
          createdAt: now,
          commandTag: "assistant-complete",
          finalDeltaCommandTag: "assistant-delta-finalize",
          ...(assistantCompletion.fallbackText !== undefined && shouldApplyFallbackCompletionText
            ? { fallbackText: assistantCompletion.fallbackText }
            : {}),
        });

        if (turnId) {
          yield* forgetAssistantMessageId(thread.id, turnId, assistantMessageId);
        }
      }

      if (proposedPlanCompletion) {
        yield* finalizeBufferedProposedPlan({
          event,
          threadId: thread.id,
          threadProposedPlans: thread.proposedPlans,
          planId: proposedPlanCompletion.planId,
          ...(proposedPlanCompletion.turnId ? { turnId: proposedPlanCompletion.turnId } : {}),
          fallbackMarkdown: proposedPlanCompletion.planMarkdown,
          updatedAt: now,
        });
      }

      if (event.type === "turn.completed") {
        const turnId = toTurnId(event.turnId);
        if (turnId) {
          const assistantMessageIds = yield* getAssistantMessageIdsForTurn(thread.id, turnId);
          yield* Effect.forEach(
            assistantMessageIds,
            (assistantMessageId) =>
              finalizeAssistantMessage({
                event,
                threadId: thread.id,
                messageId: assistantMessageId,
                turnId,
                createdAt: now,
                commandTag: "assistant-complete-finalize",
                finalDeltaCommandTag: "assistant-delta-finalize-fallback",
              }),
            { concurrency: 1 },
          ).pipe(Effect.asVoid);
          yield* clearAssistantMessageIdsForTurn(thread.id, turnId);

          yield* finalizeBufferedProposedPlan({
            event,
            threadId: thread.id,
            threadProposedPlans: thread.proposedPlans,
            planId: proposedPlanIdForTurn(thread.id, turnId),
            turnId,
            updatedAt: now,
          });
        }
      }

      if (event.type === "session.exited") {
        yield* clearTurnStateForSession(thread.id);
      }

      if (event.type === "runtime.error") {
        const runtimeErrorMessage = runtimeErrorMessageFromEvent(event) ?? "Provider runtime error";

        const shouldApplyRuntimeError = !STRICT_PROVIDER_LIFECYCLE_GUARD
          ? true
          : activeTurnId === null || eventTurnId === undefined || sameId(activeTurnId, eventTurnId);

        if (shouldApplyRuntimeError) {
          yield* orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: providerCommandId(event, "runtime-error-session-set"),
            threadId: thread.id,
            session: {
              threadId: thread.id,
              status: "error",
              providerName: event.provider,
              runtimeMode: thread.session?.runtimeMode ?? "full-access",
              activeTurnId: eventTurnId ?? null,
              lastError: runtimeErrorMessage,
              updatedAt: now,
            },
            createdAt: now,
          });
        }
      }

      if (event.type === "thread.metadata.updated" && event.payload.name) {
        yield* orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: providerCommandId(event, "thread-meta-update"),
          threadId: thread.id,
          title: event.payload.name,
        });
      }

      if (event.type === "turn.diff.updated") {
        const turnId = toTurnId(event.turnId);
        if (turnId && (yield* isGitRepoForThread(thread.id))) {
          // Skip if a checkpoint already exists for this turn. A real
          // (non-placeholder) capture from CheckpointReactor should not
          // be clobbered, and dispatching a duplicate placeholder for the
          // same turnId would produce an unstable checkpointTurnCount.
          if (thread.checkpoints.some((c) => c.turnId === turnId)) {
            // Already tracked; no-op.
          } else {
            const assistantMessageId =
              `assistant:${event.itemId ?? event.turnId ?? event.eventId}` as MessageId;
            const maxTurnCount = thread.checkpoints.reduce(
              (max, c) => Math.max(max, c.checkpointTurnCount),
              0,
            );
            yield* orchestrationEngine.dispatch({
              type: "thread.turn.diff.complete",
              commandId: providerCommandId(event, "thread-turn-diff-complete"),
              threadId: thread.id,
              turnId,
              completedAt: now,
              checkpointRef: `provider-diff:${event.eventId}` as CheckpointRef,
              status: "missing",
              files: [],
              assistantMessageId,
              checkpointTurnCount: maxTurnCount + 1,
              createdAt: now,
            });
          }
        }
      }

      const activities = [
        ...runtimeEventToActivities(event),
        ...syntheticTaskActivitiesFromRuntimeEvent({
          event,
          activeTurnId,
          enabled: alwaysCreateTasks,
        }),
      ];
      yield* Effect.forEach(activities, (activity) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: providerCommandId(event, "thread-activity-append"),
          threadId: thread.id,
          activity,
          createdAt: activity.createdAt,
        }),
      ).pipe(Effect.asVoid);
    });

  const processDomainEvent = (_event: TurnStartRequestedDomainEvent) => Effect.void;

  const processInput = (input: RuntimeIngestionInput) =>
    input.source === "runtime" ? processRuntimeEvent(input.event) : processDomainEvent(input.event);

  const processInputSafely = (input: RuntimeIngestionInput) =>
    processInput(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("provider runtime ingestion failed to process event", {
          source: input.source,
          eventId: input.event.eventId,
          eventType: input.event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processInputSafely);

  const start: ProviderRuntimeIngestionShape["start"] = Effect.gen(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(providerService.streamEvents, (event) =>
        worker.enqueue({ source: "runtime", event }),
      ),
    );
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type !== "thread.turn-start-requested") {
          return Effect.void;
        }
        return worker.enqueue({ source: "domain", event });
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ProviderRuntimeIngestionShape;
});

export const ProviderRuntimeIngestionLive = Layer.effect(
  ProviderRuntimeIngestionService,
  make,
).pipe(Layer.provide(ProjectionTurnRepositoryLive));
