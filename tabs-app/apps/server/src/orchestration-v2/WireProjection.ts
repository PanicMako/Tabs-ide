import type {
  CheckpointId,
  MessageId,
  NodeId,
  OrchestrationV2Checkpoint,
  OrchestrationV2DomainEvent,
  OrchestrationV2ContextHandoff,
  OrchestrationV2Subagent,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadStreamItem,
  OrchestrationV2TurnItem,
} from "@tabs/contracts";
import {
  BrowserQuickActionFileReceipt,
  BrowserQuickActionFileResultRef,
  BrowserQuickActionRequestRef,
  BrowserWorkflowResultRef,
  DeviceAppRequestRef,
  DeviceComparisonReport,
  DeviceComparisonRequestRef,
  DeviceComparisonResultRef,
  FigmaCanvasResultRef,
  PartnerCenterStatusRef,
  TerminalAgentInputRef,
} from "@tabs/contracts";
import {
  hasOmittedBodies,
  turnItemBodySourceKey,
  dedupeSubagentBodies,
  dedupeTurnItemBodies,
} from "@tabs/shared/orchestrationV2DedupedBodies";
import {
  compactDynamicToolOutput,
  omitToolOutputImageData,
  toolOutputImages,
  toolOutputIndicatesFailure,
} from "@tabs/shared/toolOutput";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

const MAX_DETAIL_STRING_BYTES = 32_768;
const MAX_DYNAMIC_VALUE_BYTES = 16_384;
const MAX_ON_DEMAND_BYTES = 256 * 1024;
const MAX_MCP_RESULT_CONTENT_BLOCKS = 32;
const MAX_MCP_RESULT_ENVELOPE_DEPTH = 4;

const DEVICE_COMPARISON_TOOLS = new Set([
  "device_comparison_status",
  "device_record_comparison",
  "device_replay_demonstration",
  "device_stop_comparison",
]);
const isBrowserWorkflowResult = Schema.is(BrowserWorkflowResultRef);
const isBrowserQuickActionRequest = Schema.is(BrowserQuickActionRequestRef);
const isBrowserQuickActionFileResult = Schema.is(BrowserQuickActionFileResultRef);
const isBrowserQuickActionFileReceipt = Schema.is(BrowserQuickActionFileReceipt);
const isPartnerCenterStatusRef = Schema.is(PartnerCenterStatusRef);
const isDeviceComparisonRequest = Schema.is(DeviceComparisonRequestRef);
const isDeviceComparisonReport = Schema.is(DeviceComparisonReport);
const isDeviceAppRequest = Schema.is(DeviceAppRequestRef);
const isDeviceDifference = Schema.is(DeviceComparisonResultRef);
const isFigmaCanvasResult = Schema.is(FigmaCanvasResultRef);
const isTerminalAgentInputRef = Schema.is(TerminalAgentInputRef);

type DynamicToolItem = Extract<OrchestrationV2TurnItem, { type: "dynamic_tool" }>;
type TabsMcpResultKind =
  | "deviceComparison"
  | "browserSnapshot"
  | "deviceApp"
  | "browserQuickAction"
  | "browserWorkflow"
  | "figmaCanvas"
  | "partnerCenterStatus"
  | "terminalAgentInput";

function tabsMcpResultKind(item: DynamicToolItem): TabsMcpResultKind | undefined {
  const { toolName, toolSource, nativeItemRef, threadId } = item;
  if (toolName === null || toolSource !== undefined) return undefined;

  const resultKind = (prefix: string): TabsMcpResultKind | undefined => {
    if (!toolName.startsWith(prefix)) return undefined;
    const tool = toolName.slice(prefix.length);
    if (tool === "preview_workflow") return "browserWorkflow";
    if (tool === "preview_snapshot") return "browserSnapshot";
    if (tool === "preview_run_quick_action") return "browserQuickAction";
    if (tool === "preview_figma_frame") return "figmaCanvas";
    if (tool === "preview_partner_center_status") return "partnerCenterStatus";
    if (tool === "terminal_input") return "terminalAgentInput";
    if (tool === "device_open") return "deviceApp";
    return DEVICE_COMPARISON_TOOLS.has(tool) ? "deviceComparison" : undefined;
  };
  // ACP can infer the same dotted name from a bare tool title. Its projected
  // item does not retain enough information to verify the tool's origin.
  switch (nativeItemRef?.driver) {
    case "codex":
      return resultKind("t3-code.");
    case "claudeAgent":
    case "pi":
    case "cursor":
      return resultKind("mcp__t3-code__");
    case "opencode":
      return (
        resultKind("t3-code_") ??
        resultKind(`t3-code-${threadId.replaceAll(/[^a-zA-Z0-9_-]/g, "_")}_`)
      );
    default:
      return undefined;
  }
}

function isFailedMcpResult(value: Record<PropertyKey, unknown>): boolean {
  return (
    value.isError === true ||
    value.is_error === true ||
    value.error != null ||
    value.success === false ||
    value._tag === "DeviceComparisonError" ||
    value._tag === "OrchestratorMcpFailure"
  );
}

function readMcpResult(
  value: unknown,
  depth = 0,
  cursorContent = false,
  snapshot = false,
): Record<PropertyKey, unknown> | undefined {
  if (depth > MAX_MCP_RESULT_ENVELOPE_DEPTH) return undefined;
  if (typeof value === "string") {
    if (
      value.length > MAX_DYNAMIC_VALUE_BYTES ||
      Buffer.byteLength(value, "utf8") > MAX_DYNAMIC_VALUE_BYTES
    ) {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
    return readMcpResult(parsed, depth + 1, cursorContent, snapshot);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_MCP_RESULT_CONTENT_BLOCKS) return undefined;
    // Browser snapshots put their compact identity before the larger page payload.
    let text: string | undefined;
    for (const block of value) {
      if (!Predicate.isObject(block) || isFailedMcpResult(block)) return undefined;
      const blockText =
        block.type === "text"
          ? block.text
          : cursorContent && Predicate.isObject(block.text)
            ? block.text.text
            : undefined;
      if (blockText === undefined && block.type !== "text") continue;
      if (typeof blockText !== "string") return undefined;
      if (text !== undefined) {
        if (!snapshot) return undefined;
        continue;
      }
      text = blockText;
    }
    return readMcpResult(text, depth + 1, cursorContent, snapshot);
  }
  if (!Predicate.isObject(value) || isFailedMcpResult(value)) return undefined;
  const wrapped = value.structuredContent ?? value.content;
  return wrapped === undefined ? value : readMcpResult(wrapped, depth + 1, cursorContent, snapshot);
}

function projectBrowserWorkflowResult(
  result: Record<PropertyKey, unknown> | undefined,
  alreadyProjected: boolean,
): BrowserWorkflowResultRef | undefined {
  if (result === undefined) return undefined;
  const { phase, workflowId, lastVerified } = result;
  const stage = Predicate.isObject(lastVerified) ? lastVerified.stage : undefined;
  const pending =
    phase === "uncertain"
      ? stage === "ready_to_upload"
        ? "upload"
        : stage === "uploaded"
          ? "submit"
          : undefined
      : undefined;
  const manualSubmit = phase === "manual_submit" && stage === "uploaded";
  const ref =
    phase === "ready" ||
    phase === "approval_required" ||
    manualSubmit ||
    phase === "paused" ||
    phase === "verified" ||
    phase === "watching" ||
    pending !== undefined
      ? {
          workflowId,
          stage,
          ...(pending ? { pendingAction: pending } : {}),
          ...(manualSubmit && { submitRequiresUser: true }),
        }
      : alreadyProjected &&
          Object.hasOwn(result, "browserWorkflowResult") &&
          Object.keys(result).length === 1
        ? result.browserWorkflowResult
        : undefined;
  if (!isBrowserWorkflowResult(ref)) return undefined;
  if (
    (ref.pendingAction === "upload" && ref.stage !== "ready_to_upload") ||
    (ref.pendingAction === "submit" && ref.stage !== "uploaded") ||
    (ref.submitRequiresUser && (ref.stage !== "uploaded" || ref.pendingAction !== undefined))
  )
    return undefined;
  return {
    workflowId: ref.workflowId,
    stage: ref.stage,
    ...(ref.pendingAction ? { pendingAction: ref.pendingAction } : {}),
    ...(ref.submitRequiresUser && { submitRequiresUser: true }),
  };
}

function projectDynamicToolOutput(item: DynamicToolItem, kind: TabsMcpResultKind | undefined) {
  const output = compactDynamicToolOutput(item.output);
  if (
    kind === undefined ||
    output?.isError ||
    item.status !== "completed" ||
    item.toolNonExecutionKind !== undefined
  ) {
    if (
      kind !== "browserWorkflow" &&
      kind !== "figmaCanvas" &&
      kind !== "partnerCenterStatus" &&
      kind !== "terminalAgentInput"
    )
      return output;
    return output?.isError ? { isError: true } : undefined;
  }
  const result = readMcpResult(
    item.output,
    0,
    item.nativeItemRef?.driver === "cursor",
    kind === "browserSnapshot",
  );
  // The event stream can project an item twice. Only a top-level wire result
  // with the omission marker can carry the already compacted reference.
  const alreadyProjected = item.outputOmitted === true && result === item.output;
  if (kind === "browserSnapshot") {
    const ref = result?.verifiedEvidenceDraft;
    const digestRef = (value: unknown) =>
      Predicate.isObject(value) &&
      typeof value.sha256 === "string" &&
      /^[a-f0-9]{64}$/u.test(value.sha256)
        ? value.sha256
        : undefined;
    const verified = digestRef(result?.verifiedScreenshotDraft);
    const unverified = digestRef(result?.unverifiedScreenshotDraft);
    if (!isDeviceDifference(ref) && !verified && !unverified) return output;
    // Only an image receipt is verified; a digest printed on the page stays unverified.
    return {
      ...output,
      ...(isDeviceDifference(ref) && {
        verifiedEvidenceDraft: { runId: ref.runId, step: ref.step, receiptKind: "image" },
      }),
      ...(verified && { verifiedScreenshotDraft: { sha256: verified, receiptKind: "image" } }),
      ...(unverified && {
        unverifiedScreenshotDraft: { sha256: unverified, receiptKind: "pageText" },
      }),
    };
  }
  if (kind === "deviceApp") {
    const request = alreadyProjected
      ? result?.deviceComparisonRequest
      : result?.status === "approval_required" &&
          Predicate.isObject(result.device) &&
          Predicate.isObject(result.approval)
        ? {
            approvalId: result.approval.id,
            hostId: result.device.hostId,
            deviceId: result.device.id,
          }
        : undefined;
    if (isDeviceAppRequest(request)) {
      const { approvalId, hostId, deviceId } = request;
      return { deviceComparisonRequest: { approvalId, hostId, deviceId } };
    }
    return output;
  }
  if (kind === "browserQuickAction") {
    const fileResult = alreadyProjected
      ? result?.browserQuickActionFileResult
      : result?.status === "pass"
        ? result.fileResult
        : undefined;
    if (
      isBrowserQuickActionFileResult(fileResult) &&
      (alreadyProjected ||
        (isBrowserQuickActionFileReceipt(result?.fileReceipt) &&
          result.fileReceipt.filename === fileResult.filename))
    ) {
      const { resultId, tabId, profileId, filename, restorable } = fileResult;
      return {
        browserQuickActionFileResult: {
          resultId,
          tabId,
          profileId,
          filename,
          ...(restorable && { restorable }),
        },
      };
    }
    const request =
      result?.status === "approval_required"
        ? { actionId: result.actionId }
        : alreadyProjected
          ? result?.browserQuickActionRequest
          : result?.status === "paused"
            ? result.resumeRequest
            : undefined;
    if (
      isBrowserQuickActionRequest(request) &&
      (alreadyProjected || result?.status !== "paused" || request.pause)
    ) {
      const { actionId, pause } = request;
      return {
        browserQuickActionRequest: {
          actionId,
          ...(pause && {
            pause: { pauseId: pause.pauseId, tabId: pause.tabId, profileId: pause.profileId },
          }),
        },
      };
    }
    return output;
  }
  if (kind === "browserWorkflow") {
    const browserWorkflowResult = projectBrowserWorkflowResult(result, alreadyProjected);
    return browserWorkflowResult === undefined ? undefined : { browserWorkflowResult };
  }
  if (kind === "figmaCanvas") {
    if (!result) return undefined;
    const ref = alreadyProjected
      ? Object.keys(result).length === 1 && Object.hasOwn(result, "figmaCanvasResult")
        ? result.figmaCanvasResult
        : undefined
      : result.status === "verified"
        ? { operationId: result.operationId }
        : undefined;
    return isFigmaCanvasResult(ref)
      ? { figmaCanvasResult: { operationId: ref.operationId } }
      : undefined;
  }
  if (kind === "partnerCenterStatus") {
    if (!result) return undefined;
    const status = { storeStatus: result.storeStatus, observedAt: result.observedAt };
    const ref = alreadyProjected
      ? Object.keys(result).length === 1 && Object.hasOwn(result, "browserWorkflowResult")
        ? result.browserWorkflowResult
        : undefined
      : result.status === "verified"
        ? {
            workflowId: result.workflowId,
            stage: result.browserStage,
            ...(isPartnerCenterStatusRef(status) ? { partnerCenter: status } : {}),
          }
        : undefined;
    if (!isBrowserWorkflowResult(ref)) return undefined;
    const { workflowId, stage, partnerCenter } = ref;
    return {
      browserWorkflowResult: {
        workflowId,
        stage,
        ...(partnerCenter
          ? {
              partnerCenter: {
                storeStatus: partnerCenter.storeStatus,
                observedAt: partnerCenter.observedAt,
              },
            }
          : {}),
      },
    };
  }
  if (kind === "terminalAgentInput") {
    const ref = alreadyProjected
      ? result?.terminalAgentInput
      : result?.status === "pending"
        ? { requestId: result.requestId }
        : undefined;
    return isTerminalAgentInputRef(ref)
      ? { terminalAgentInput: { requestId: ref.requestId } }
      : undefined;
  }
  const run = result?.run;
  const request =
    Predicate.isObject(run) &&
    run.phase === "awaiting_approval" &&
    Predicate.isObject(run.agentRecording) &&
    run.agentRecording.manual === false
      ? { runId: run.runId }
      : alreadyProjected
        ? result?.deviceComparisonRequest
        : undefined;
  if (isDeviceComparisonRequest(request))
    return { deviceComparisonRequest: { runId: request.runId } };
  const difference = Predicate.isObject(run)
    ? {
        runId: run.runId,
        step: Predicate.isObject(run.firstDifference) ? run.firstDifference.step : undefined,
      }
    : alreadyProjected
      ? result?.deviceDifference
      : undefined;
  const completion = alreadyProjected
    ? result?.deviceCompletion
    : isDeviceComparisonReport(run) &&
        run.phase === "completed" &&
        !!run.target &&
        !run.busy &&
        !run.playing &&
        !run.uncertainTap &&
        run.completedSteps > 0 &&
        run.completedSteps === run.steps.length
      ? { runId: run.runId }
      : undefined;
  const completedResult = isDeviceComparisonRequest(completion)
    ? { deviceCompletion: { runId: completion.runId } }
    : undefined;
  if (isDeviceDifference(difference)) {
    const { runId, step } = difference;
    return { ...output, deviceDifference: { runId, step }, ...completedResult };
  }
  return completedResult ?? output;
}

function truncateDetail(
  value: string | undefined,
  maxBytes = MAX_DETAIL_STRING_BYTES,
): string | undefined {
  if (
    value === undefined ||
    (value.length <= maxBytes && Buffer.byteLength(value, "utf8") <= maxBytes)
  ) {
    return value;
  }
  // UTF-8 needs at least one byte per UTF-16 code unit. Only encode the prefix
  // that could fit, rather than allocating a buffer for the complete output.
  const prefix = Buffer.from(value.slice(0, maxBytes), "utf8")
    .subarray(0, maxBytes)
    .toString("utf8")
    .replace(/\uFFFD$/u, "");
  return `${prefix}\n… output truncated for transport`;
}

/** Bound stored diffs to the client wire limit to avoid retaining invisible data in SQLite and heap. */
export function boundFileChangeForStorage(item: OrchestrationV2TurnItem): OrchestrationV2TurnItem {
  if (item.type !== "file_change") return item;
  const { diffStr, oldStr, newStr } = item;
  const bounded = {
    ...item,
    ...(diffStr === undefined ? {} : { diffStr: truncateDetail(diffStr) }),
    ...(oldStr === undefined ? {} : { oldStr: truncateDetail(oldStr) }),
    ...(newStr === undefined ? {} : { newStr: truncateDetail(newStr) }),
  };
  return bounded.diffStr === diffStr && bounded.oldStr === oldStr && bounded.newStr === newStr
    ? item
    : bounded;
}

function summarizeDynamicValue(value: unknown): unknown {
  let serialized: string;
  try {
    if (typeof value === "string" && value.length > MAX_DYNAMIC_VALUE_BYTES) {
      serialized = value;
    } else {
      const json = JSON.stringify(value) ?? String(value);
      if (Buffer.byteLength(json, "utf8") <= MAX_DYNAMIC_VALUE_BYTES) {
        return value;
      }
      serialized = typeof value === "string" ? value : json;
    }
  } catch {
    serialized = "Unserializable tool output";
  }

  // Preserve the first nonblank normalized line, but stop after the preview.
  // Splitting and normalizing every line can allocate far more than the input.
  const start = /\S/u.exec(serialized)?.index;
  let firstLine = start === undefined ? "Large tool output" : "";
  let pendingSpace = false;
  for (let index = start ?? serialized.length; index < serialized.length; index += 1) {
    const character = serialized[index]!;
    if (character === "\n") break;
    if (/\s/u.test(character)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace) firstLine += " ";
    firstLine += character;
    pendingSpace = false;
    if (firstLine.length > 160) break;
  }
  return {
    summary: firstLine.length <= 160 ? firstLine : `${firstLine.slice(0, 159).trimEnd()}…`,
    truncated: true,
  };
}

export function projectTurnItemForWire(item: OrchestrationV2TurnItem): OrchestrationV2TurnItem {
  switch (item.type) {
    case "handoff": {
      const { summary: _summary, ...projected } = item;
      return projected;
    }
    case "command_execution": {
      const { output, ...projected } = item;
      // A successful `cat` or search can print "ENOENT" or "exit code 2" as plain text, so
      // output text decides only when the provider reported no exit code. The exit code wins.
      const failed =
        item.exitCode === undefined
          ? item.outputIndicatesFailure === true ||
            (output !== undefined &&
              toolOutputIndicatesFailure(output.slice(0, MAX_DETAIL_STRING_BYTES)))
          : item.exitCode !== 0;
      return {
        ...projected,
        ...(failed ? { outputIndicatesFailure: true } : {}),
        ...(output?.trim() ? { outputOmitted: true } : {}),
      };
    }
    case "file_change": {
      // File identity and counts are enough for activity. Full diffs already
      // have a dedicated read path and remain intact in persistence.
      const { diffStr, oldStr: _old, newStr: _new, ...projected } = item;
      // A failed edit stores the provider's error where the diff would be.
      return item.status === "failed" && diffStr?.trim()
        ? { ...projected, diffStr: truncateDetail(diffStr) }
        : projected;
    }
    case "subagent":
      return {
        ...item,
        prompt: truncateDetail(item.prompt) ?? "",
        progress: truncateDetail(item.progress),
        result: item.result === null ? null : (truncateDetail(item.result) ?? null),
      };
    case "dynamic_tool": {
      const { output: rawOutput, ...projected } = item;
      const kind = tabsMcpResultKind(item);
      const output = projectDynamicToolOutput(item, kind);
      return {
        ...projected,
        input: kind === "terminalAgentInput" ? undefined : summarizeDynamicValue(item.input),
        ...(output === undefined ? {} : { output }),
        ...(hasDynamicValue(rawOutput) ? { outputOmitted: true } : {}),
      };
    }
    default:
      return item;
  }
}

function hasDynamicValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value !== "object" || Object.keys(value).length > 0;
}

function boundDynamicValue(value: unknown): unknown {
  if (value === undefined) return value;
  if (typeof value === "string") return truncateDetail(value, MAX_ON_DEMAND_BYTES);
  let json: string;
  try {
    // Compact, so measuring does not inflate the value; clients indent it.
    json = JSON.stringify(value) ?? String(value);
  } catch {
    return "Unserializable tool value";
  }
  return Buffer.byteLength(json, "utf8") <= MAX_ON_DEMAND_BYTES
    ? value
    : truncateDetail(json, MAX_ON_DEMAND_BYTES);
}

/**
 * A tool output for a detail read, without image bytes. When the rest is too
 * large to send whole, its truncated text still comes with the image markers,
 * in order, so clients can load each image by index.
 */
function boundToolOutput(output: unknown): unknown {
  const omitted = omitToolOutputImageData(output);
  const bounded = boundDynamicValue(omitted);
  if (typeof bounded !== "string" || typeof omitted === "string") return bounded;
  const images = toolOutputImages(omitted);
  return images.length === 0
    ? bounded
    : [
        { type: "text", text: bounded },
        ...images.map((image) => ({ type: "image", mimeType: image.mimeType })),
      ];
}

/**
 * Projects one item for an on-demand detail read: keeps the input and output
 * the timeline withholds where available, bounded so a huge result cannot stall
 * the socket. Built-in comparison, workflow and Figma results stay compact here too.
 * Clients load image bytes as `tool-output-image` assets.
 */
export function projectTurnItemForDetail(item: OrchestrationV2TurnItem): OrchestrationV2TurnItem {
  switch (item.type) {
    case "command_execution":
      return {
        ...item,
        input: truncateDetail(item.input, MAX_ON_DEMAND_BYTES) ?? "",
        output: truncateDetail(item.output, MAX_ON_DEMAND_BYTES),
      };
    case "dynamic_tool": {
      const kind = tabsMcpResultKind(item);
      return {
        ...item,
        input: kind === "terminalAgentInput" ? undefined : boundDynamicValue(item.input),
        output:
          kind === undefined ? boundToolOutput(item.output) : projectDynamicToolOutput(item, kind),
        ...(kind !== undefined && hasDynamicValue(item.output) ? { outputOmitted: true } : {}),
      };
    }
    case "subagent":
      return {
        ...item,
        prompt: truncateDetail(item.prompt, MAX_ON_DEMAND_BYTES) ?? "",
        progress: truncateDetail(item.progress, MAX_ON_DEMAND_BYTES),
        result:
          item.result === null ? null : (truncateDetail(item.result, MAX_ON_DEMAND_BYTES) ?? null),
      };
    case "handoff":
    case "file_change":
      return projectTurnItemForWire(item);
    default:
      return item;
  }
}

export function projectContextHandoffForWire(
  handoff: OrchestrationV2ContextHandoff,
): OrchestrationV2ContextHandoff {
  const { history: _history, delivery: _delivery, ...projected } = handoff;
  return { ...projected, summaryText: "" };
}

export function projectThreadProjectionForWire(
  projection: OrchestrationV2ThreadProjection,
): OrchestrationV2ThreadProjection {
  const projectedById = new Map<string, OrchestrationV2TurnItem>();
  const project = (item: OrchestrationV2TurnItem) => {
    const key = `${item.threadId}:${item.id}`;
    const existing = projectedById.get(key);
    if (existing !== undefined) return existing;
    const projected = projectTurnItemForWire(item);
    projectedById.set(key, projected);
    return projected;
  };
  return {
    ...projection,
    contextHandoffs: projection.contextHandoffs.map(projectContextHandoffForWire),
    turnItems: projection.turnItems.map(project),
    visibleTurnItems: projection.visibleTurnItems.map((row) => ({
      ...row,
      item: project(row.item),
    })),
  };
}

export function projectDomainEventForWire(
  event: OrchestrationV2DomainEvent,
): OrchestrationV2DomainEvent {
  return event.type === "turn-item.updated"
    ? { ...event, payload: projectTurnItemForWire(event.payload) }
    : event.type === "context-handoff.updated"
      ? { ...event, payload: projectContextHandoffForWire(event.payload) }
      : event;
}

const LIVE_DEDUPE_MEMORY = 32;

function remember<K, V>(memory: Map<K, V>, key: K, value: V): void {
  memory.delete(key);
  memory.set(key, value);
  if (memory.size > LIVE_DEDUPE_MEMORY) memory.delete(memory.keys().next().value as K);
}

/**
 * One per subscription, after coalescing, so it remembers only records the client received. A
 * record event comes before the turn item that repeats its body, so the item (or a repeated
 * subagent record) ships blank and marked. The other order, or a forgotten record, only costs
 * bytes: the repeat ships whole.
 */
export function makeLiveBodyDeduper(
  versioned = false,
): (item: OrchestrationV2ThreadStreamItem) => OrchestrationV2ThreadStreamItem {
  const versions = new Map<string, number>();
  const withVersion = <T extends object>(payload: T, key: string | null, original: T): T => {
    const sequence = key === null ? undefined : versions.get(key);
    if (!versioned || !hasOmittedBodies(payload)) return payload;
    return sequence === undefined ? original : { ...payload, bodySourceSequence: sequence };
  };
  const messageText = new Map<MessageId, string>();
  const checkpointFiles = new Map<CheckpointId, OrchestrationV2Checkpoint["files"]>();
  const subagents = new Map<NodeId, Pick<OrchestrationV2Subagent, "prompt" | "result">>();
  const source = {
    messageText: (id: MessageId) => messageText.get(id),
    checkpointFiles: (id: CheckpointId) => checkpointFiles.get(id),
    subagent: (id: NodeId) => subagents.get(id),
  };
  const rememberSubagent = ({ id, prompt, result }: OrchestrationV2Subagent) =>
    remember(subagents, id, { prompt, result });
  return (item) => {
    if (item.kind === "snapshot") {
      messageText.clear();
      checkpointFiles.clear();
      subagents.clear();
      versions.clear();
      // The client now holds exactly these records; their bodies are never blanked.
      const { messages, checkpoints, subagents: records } = item.projection;
      for (const message of messages) {
        remember(messageText, message.id, message.text);
        remember(versions, `message:${message.id}`, item.snapshotSequence);
      }
      for (const checkpoint of checkpoints) {
        remember(checkpointFiles, checkpoint.id, checkpoint.files);
        remember(versions, `checkpoint:${checkpoint.id}`, item.snapshotSequence);
      }
      for (const subagent of records) {
        rememberSubagent(subagent);
        remember(versions, `subagent:${subagent.id}`, item.snapshotSequence);
      }
      return item;
    }
    if (item.kind !== "event") return item;
    const { event } = item;
    switch (event.type) {
      case "message.updated":
        remember(messageText, event.payload.id, event.payload.text);
        remember(versions, `message:${event.payload.id}`, item.sequence);
        return item;
      case "checkpoint.captured":
        remember(checkpointFiles, event.payload.id, event.payload.files);
        remember(versions, `checkpoint:${event.payload.id}`, item.sequence);
        return item;
      case "subagent.updated": {
        const payload = withVersion(
          dedupeSubagentBodies(event.payload, subagents.get(event.payload.id)),
          `subagent:${event.payload.id}`,
          event.payload,
        );
        rememberSubagent(event.payload);
        remember(versions, `subagent:${event.payload.id}`, item.sequence);
        return payload === event.payload ? item : { ...item, event: { ...event, payload } };
      }
      case "turn-item.updated": {
        const payload = withVersion(
          dedupeTurnItemBodies(event.payload, source),
          turnItemBodySourceKey(event.payload),
          event.payload,
        );
        return payload === event.payload ? item : { ...item, event: { ...event, payload } };
      }
      default:
        return item;
    }
  };
}
