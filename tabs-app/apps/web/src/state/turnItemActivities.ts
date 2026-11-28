/**
 * Turns the tool-related items of a V2 thread projection (shell commands, tool calls such as
 * `read`, file changes, searches and provider errors) into the activities the timeline already
 * knows how to render as a work log.
 *
 * The server stores these as turn items; without this step the web app copied only messages out
 * of a projection, so an agent's tool calls were in the database but never appeared in the chat.
 * The derived activities carry an id prefix so a later projection replaces them cleanly and they
 * never mix with activities from any other source.
 */

import {
  BrowserQuickActionRequestRef,
  BrowserQuickActionFileResultRef,
  BrowserWorkflowResultRef,
  DeviceAccessRequestRef,
  DeviceComparisonRequestRef,
  DeviceComparisonResultRef,
  FigmaCanvasResultRef,
  TerminalAgentInputRef,
  type OrchestrationThreadActivity,
} from "@tabs/contracts";
import * as Schema from "effect/Schema";

export const TURN_ITEM_ACTIVITY_ID_PREFIX = "v2-item:";

type ItemRecord = Readonly<Record<string, unknown>>;
const isComparisonResult = Schema.is(DeviceComparisonResultRef);
const isUnverifiedScreenshot = Schema.is(
  Schema.Struct({ sha256: Schema.String, receiptKind: Schema.Literal("pageText") }),
);
const isComparisonCompletion = Schema.is(DeviceComparisonRequestRef);
const isComparisonRequest = Schema.is(DeviceAccessRequestRef);
const isBrowserResult = Schema.is(BrowserWorkflowResultRef);
const isBrowserQuickActionRequest = Schema.is(BrowserQuickActionRequestRef);
const isBrowserQuickActionFileResult = Schema.is(BrowserQuickActionFileResultRef);
const isFigmaResult = Schema.is(FigmaCanvasResultRef);
const isTerminalInput = Schema.is(TerminalAgentInputRef);

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Tool output may be a string or structured data; show strings as-is and structures as JSON. */
function outputText(value: unknown): string | null {
  if (typeof value === "string") return text(value);
  if (value === undefined || value === null) return null;
  try {
    return text(JSON.stringify(value, null, 2));
  } catch {
    return null;
  }
}

function isoDate(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "epochMilliseconds" in value) {
    return new Date(
      Number((value as { epochMilliseconds: number }).epochMilliseconds),
    ).toISOString();
  }
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toISOString?: unknown }).toISOString === "function"
  ) {
    return (value as { toISOString: () => string }).toISOString();
  }
  return new Date(0).toISOString();
}

function lifecycleKind(status: unknown): string {
  return status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
    ? "tool.completed"
    : "tool.updated";
}

function toActivity(
  item: ItemRecord,
  fields: {
    readonly tone: "tool" | "error" | "info";
    readonly kind: string;
    readonly summary: string;
    readonly payload: Record<string, unknown>;
  },
): OrchestrationThreadActivity {
  const id = String(item.id);
  return {
    id: `${TURN_ITEM_ACTIVITY_ID_PREFIX}${id}` as OrchestrationThreadActivity["id"],
    tone: fields.tone,
    kind: fields.kind,
    summary: fields.summary,
    payload: { toolCallId: id, status: item.status, ...fields.payload },
    turnId: null,
    sequence: typeof item.ordinal === "number" ? item.ordinal : 0,
    createdAt: isoDate(item.startedAt ?? item.updatedAt),
  } as OrchestrationThreadActivity;
}

/** One activity for a tool-related turn item, or null for items that are not part of the work log. */
export function activityFromTurnItem(item: ItemRecord): OrchestrationThreadActivity | null {
  const failed = item.status === "failed";
  const title = text(item.title);

  switch (item.type) {
    case "command_execution": {
      const command = text(item.input);
      const output = outputText(item.output);
      const exitCode = typeof item.exitCode === "number" ? item.exitCode : undefined;
      // The exit code outranks text in the output, which can merely mention an error.
      const failedRun =
        failed || (exitCode === undefined ? item.outputIndicatesFailure === true : exitCode !== 0);
      return toActivity(item, {
        tone: failedRun ? "error" : "tool",
        kind: lifecycleKind(item.status),
        summary: title ?? command ?? "Ran a command",
        payload: {
          itemType: "command_execution",
          ...(title ? { title } : {}),
          ...(output ? { detail: output } : {}),
          ...(command ? { data: { item: { command } } } : {}),
          ...(exitCode !== undefined ? { exitCode } : {}),
        },
      });
    }
    case "dynamic_tool": {
      const toolName = text(item.toolName);
      const references =
        item.status === "completed" &&
        item.outputOmitted === true &&
        item.output &&
        typeof item.output === "object"
          ? (item.output as ItemRecord)
          : undefined;
      const deviceDifference = isComparisonResult(references?.deviceDifference)
        ? references.deviceDifference
        : undefined;
      const verifiedEvidenceDraft = isComparisonResult(references?.verifiedEvidenceDraft)
        ? references.verifiedEvidenceDraft
        : undefined;
      const unverifiedScreenshotDraft = isUnverifiedScreenshot(
        references?.unverifiedScreenshotDraft,
      )
        ? references.unverifiedScreenshotDraft
        : undefined;
      const deviceCompletion = isComparisonCompletion(references?.deviceCompletion)
        ? references.deviceCompletion
        : undefined;
      const deviceComparisonRequest = isComparisonRequest(references?.deviceComparisonRequest)
        ? references.deviceComparisonRequest
        : undefined;
      const browserWorkflowResult = isBrowserResult(references?.browserWorkflowResult)
        ? references.browserWorkflowResult
        : undefined;
      const browserQuickActionRequest = isBrowserQuickActionRequest(
        references?.browserQuickActionRequest,
      )
        ? references.browserQuickActionRequest
        : undefined;
      const figmaCanvasResult = isFigmaResult(references?.figmaCanvasResult)
        ? references.figmaCanvasResult
        : undefined;
      const browserQuickActionFileResult = isBrowserQuickActionFileResult(
        references?.browserQuickActionFileResult,
      )
        ? references.browserQuickActionFileResult
        : undefined;
      const terminalAgentInput = isTerminalInput(references?.terminalAgentInput)
        ? references.terminalAgentInput
        : undefined;
      const output =
        deviceComparisonRequest ||
        deviceDifference ||
        verifiedEvidenceDraft ||
        unverifiedScreenshotDraft ||
        deviceCompletion ||
        browserWorkflowResult ||
        browserQuickActionRequest ||
        browserQuickActionFileResult ||
        figmaCanvasResult ||
        terminalAgentInput
          ? null
          : outputText(item.output);
      const input = item.input && typeof item.input === "object" ? item.input : undefined;
      return toActivity(item, {
        tone: failed ? "error" : "tool",
        kind: lifecycleKind(item.status),
        summary: title ?? toolName ?? "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          ...(title ? { title } : {}),
          ...(toolName ? { toolName } : {}),
          ...(output ? { detail: output } : {}),
          ...(deviceDifference ? { deviceDifference } : {}),
          ...(verifiedEvidenceDraft ? { verifiedEvidenceDraft } : {}),
          ...(unverifiedScreenshotDraft ? { unverifiedScreenshotDraft } : {}),
          ...(deviceCompletion ? { deviceCompletion } : {}),
          ...(deviceComparisonRequest ? { deviceComparisonRequest } : {}),
          ...(browserWorkflowResult ? { browserWorkflowResult } : {}),
          ...(browserQuickActionRequest ? { browserQuickActionRequest } : {}),
          ...(browserQuickActionFileResult ? { browserQuickActionFileResult } : {}),
          ...(figmaCanvasResult ? { figmaCanvasResult } : {}),
          ...(terminalAgentInput ? { terminalAgentInput } : {}),
          ...(input ? { data: { item: { input } } } : {}),
        },
      });
    }
    case "file_change": {
      const fileName = text(item.fileName);
      const paths = Array.isArray(item.changes)
        ? (item.changes as ReadonlyArray<ItemRecord>).flatMap((change) => text(change.path) ?? [])
        : [];
      const files = paths.length > 0 ? paths : fileName ? [fileName] : [];
      return toActivity(item, {
        tone: failed ? "error" : "tool",
        kind: lifecycleKind(item.status),
        summary: title ?? (fileName ? `Edited ${fileName}` : "Edited files"),
        payload: {
          itemType: "file_change",
          ...(title ? { title } : {}),
          data: { changes: files.map((path) => ({ path })) },
        },
      });
    }
    case "file_search":
    case "web_search": {
      const pattern = text(item.pattern) ?? text(item.message);
      return toActivity(item, {
        tone: failed ? "error" : "tool",
        kind: lifecycleKind(item.status),
        summary: title ?? (item.type === "web_search" ? "Searched the web" : "Searched files"),
        payload: {
          itemType: item.type === "web_search" ? "web_search" : "file_search",
          ...(title ? { title } : {}),
          ...(pattern ? { detail: pattern } : {}),
        },
      });
    }
    case "error": {
      const failure =
        item.failure && typeof item.failure === "object" ? (item.failure as ItemRecord) : null;
      const message = text(failure?.message) ?? title ?? "The provider reported an error";
      return toActivity(item, {
        tone: "error",
        kind: "runtime.error",
        summary: message,
        payload: { detail: message },
      });
    }
    default:
      return null;
  }
}

/** Activities for every tool-related item in a projection, in the server's committed order. */
export function activitiesFromTurnItems(
  items: ReadonlyArray<ItemRecord>,
): OrchestrationThreadActivity[] {
  const activities: OrchestrationThreadActivity[] = [];
  for (const item of items) {
    const activity = activityFromTurnItem(item);
    if (activity) activities.push(activity);
  }
  return activities;
}

/** Replaces earlier derived activities with fresh ones and leaves every other activity alone. */
export function mergeTurnItemActivities(
  existing: ReadonlyArray<OrchestrationThreadActivity> | undefined,
  derived: ReadonlyArray<OrchestrationThreadActivity>,
): OrchestrationThreadActivity[] {
  const others = (existing ?? []).filter(
    (activity) => !String(activity.id).startsWith(TURN_ITEM_ACTIVITY_ID_PREFIX),
  );
  return [...others, ...derived];
}
