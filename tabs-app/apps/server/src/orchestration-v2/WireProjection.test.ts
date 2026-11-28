import {
  MessageId,
  ContextHandoffId,
  ProviderThreadId,
  NodeId,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
  OrchestrationV2RpcSchemas,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadStreamItem,
  type OrchestrationV2DomainEvent,
  OrchestrationV2TurnItem,
  OrchestrationV2TurnItemJson,
} from "@tabs/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import {
  projectTurnItemForWire,
  projectTurnItemForDetail,
  projectThreadProjectionForWire,
  projectDomainEventForWire,
  makeLiveBodyDeduper,
} from "./WireProjection.ts";
import { projectCodexDynamicToolItem } from "./Adapters/CodexAdapterV2.ts";
import { coalesceLiveUpdatedEvents } from "./ThreadLiveEventCoalescer.ts";
import { threadShellFromProjection } from "./ProjectionStore.ts";
import { MAX_TOOL_OUTPUT_IMAGES, toolOutputImages } from "@tabs/shared/toolOutput";

const decodeTurnItem = Schema.decodeUnknownSync(OrchestrationV2TurnItem);
const encodeTurnItemJson = Schema.encodeSync(OrchestrationV2TurnItemJson);
const decodeTurnItemJson = Schema.decodeUnknownSync(OrchestrationV2TurnItemJson);

const base = {
  id: TurnItemId.make("tool-1"),
  type: "dynamic_tool" as const,
  threadId: ThreadId.make("thread-1"),
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  status: "completed" as const,
  title: "MCP tool",
  toolName: "mcp__github__fetch_pr",
  input: { pr: 42 },
  startedAt: DateTime.makeUnsafe("2026-08-13T00:00:00.000Z"),
  completedAt: DateTime.makeUnsafe("2026-08-13T00:00:01.000Z"),
  updatedAt: DateTime.makeUnsafe("2026-08-13T00:00:01.000Z"),
};

const deviceDifference = { runId: "947b49a7-4703-4231-be25-8a99ef4e1e51", step: 2 };
const comparisonRun = {
  runId: deviceDifference.runId,
  phase: "paused",
  source: {
    hostId: "local",
    deviceId: "private-device-id",
    name: "PRIVATE_DEVICE_NAME",
    platform: "ios",
    appId: "com.example.checkout",
  },
  busy: false,
  playing: false,
  completedSteps: 1,
  steps: [{ label: "PRIVATE_CONTROL_LABEL" }],
  firstDifference: { step: deviceDifference.step, kind: "total", reason: "PRIVATE_REASON" },
  canResume: true,
  uncertainTap: false,
};

it("keeps only the verified draft reference from a built-in browser snapshot", () => {
  const item = {
    ...base,
    nativeItemRef: {
      driver: ProviderDriverKind.make("codex"),
      nativeId: "snapshot-call",
      strength: "strong" as const,
    },
    toolName: "t3-code.preview_snapshot",
    output: {
      structuredContent: {
        visibleText: "Private draft text",
        verifiedEvidenceDraft: { ...deviceDifference, url: "https://private.example/draft" },
      },
    },
  };
  const wire = projectTurnItemForWire(item);
  expect(wire).toHaveProperty("output", {
    verifiedEvidenceDraft: { ...deviceDifference, receiptKind: "image" },
  });
  expect(projectTurnItemForWire(wire)).toEqual(wire);
  expect(
    projectTurnItemForWire({
      ...item,
      toolName: "mcp__t3-code__preview_snapshot",
      nativeItemRef: { ...item.nativeItemRef, driver: ProviderDriverKind.make("claudeAgent") },
      output: {
        content: [
          { type: "text", text: JSON.stringify({ verifiedEvidenceDraft: deviceDifference }) },
          { type: "text", text: "Private draft text" },
        ],
      },
    }),
  ).toHaveProperty("output", {
    verifiedEvidenceDraft: { ...deviceDifference, receiptKind: "image" },
  });
  expect(
    projectTurnItemForWire({ ...item, toolName: "other.preview_snapshot" }),
  ).not.toHaveProperty("output.verifiedEvidenceDraft");
  expect(projectTurnItemForWire({ ...item, status: "failed" })).not.toHaveProperty(
    "output.verifiedEvidenceDraft",
  );
});

describe("device comparison wire output", () => {
  const toolName = "t3-code.device_comparison_status";
  const nativeItemRef = {
    driver: ProviderDriverKind.make("codex"),
    nativeId: "comparison-tool-call",
    strength: "strong" as const,
  };
  const claudeItemRef = { ...nativeItemRef, driver: ProviderDriverKind.make("claudeAgent") };
  const comparisonItem = { ...base, nativeItemRef, toolName, output: { run: comparisonRun } };

  it("projects only the run ID for a settled comparison without a difference", () => {
    const run = {
      ...comparisonRun,
      phase: "completed",
      target: { ...comparisonRun.source, hostId: "pixel-host", platform: "android" },
      canResume: false,
      firstDifference: undefined,
    };
    const item = { ...comparisonItem, output: { run } };
    const expected = { deviceCompletion: { runId: run.runId } };
    const wire = projectTurnItemForWire(item);
    expect(wire).toHaveProperty("output", expected);
    expect(projectTurnItemForWire(wire)).toEqual(wire);
    expect(projectTurnItemForDetail(item)).toHaveProperty("output", expected);
    for (const patch of [{ busy: true }, { completedSteps: 0 }, { target: undefined }]) {
      expect(
        projectTurnItemForWire({ ...item, output: { run: { ...run, ...patch } } }),
      ).not.toHaveProperty("output.deviceCompletion");
    }
    expect(
      projectTurnItemForWire({ ...item, toolName: "other.device_comparison_status" }),
    ).not.toHaveProperty("output.deviceCompletion");
    expect(projectTurnItemForWire({ ...item, output: expected })).not.toHaveProperty(
      "output.deviceCompletion",
    );
  });

  it("keeps the completed result and the original difference after a correction", () => {
    const run = {
      ...comparisonRun,
      phase: "completed",
      target: { ...comparisonRun.source, hostId: "pixel-host", platform: "android" },
      completedSteps: 2,
      steps: [{ label: "PRIVATE_CONTROL_LABEL" }, { label: "Review" }],
      canResume: false,
    };
    const item = { ...comparisonItem, output: { run } };
    const expected = { deviceDifference, deviceCompletion: { runId: run.runId } };
    const wire = projectTurnItemForWire(item);
    expect(wire).toHaveProperty("output", expected);
    expect(projectTurnItemForWire(wire)).toEqual(wire);
    expect(projectTurnItemForDetail(item)).toHaveProperty("output", expected);
    for (const patch of [{ phase: "paused" }, { completedSteps: 1 }, { uncertainTap: true }]) {
      expect(
        projectTurnItemForWire({ ...item, output: { run: { ...run, ...patch } } }),
      ).toHaveProperty("output", { deviceDifference });
    }
  });

  it("projects the Codex result in live events and both snapshot item collections", () => {
    const item = {
      ...base,
      nativeItemRef,
      ...projectCodexDynamicToolItem({
        type: "mcpToolCall",
        id: "comparison-status",
        server: "t3-code",
        tool: "device_comparison_status",
        status: "completed",
        arguments: {},
        result: { structuredContent: comparisonItem.output, content: [] },
      }),
    };
    expect(item.toolName).toBe(toolName);
    const event = {
      id: EventId.make("device-comparison-event"),
      type: "turn-item.updated" as const,
      threadId: base.threadId,
      occurredAt: base.updatedAt,
      payload: item,
    };
    const sentEvent = projectDomainEventForWire(event);
    const expected = { ...item, output: { deviceDifference }, outputOmitted: true };
    expect(sentEvent.payload).toEqual(expected);
    expect(projectDomainEventForWire(sentEvent)).toEqual(sentEvent);
    const streamCodec = Schema.toCodecJson(OrchestrationV2RpcSchemas.subscribeThread.output);
    const chunk = Schema.encodeSync(streamCodec)({ kind: "event", sequence: 1, event: sentEvent });
    expect(chunk).toHaveProperty("event.payload.output", { deviceDifference });

    const projection = {
      contextHandoffs: [],
      turnItems: [item],
      visibleTurnItems: [
        {
          position: 0,
          visibility: "local",
          sourceThreadId: item.threadId,
          sourceItemId: item.id,
          item,
        },
      ],
    } satisfies Pick<
      OrchestrationV2ThreadProjection,
      "contextHandoffs" | "turnItems" | "visibleTurnItems"
    >;
    const sentProjection = projectThreadProjectionForWire(
      projection as unknown as OrchestrationV2ThreadProjection,
    );
    expect(sentProjection.turnItems).toEqual([expected]);
    expect(sentProjection.visibleTurnItems[0]?.item).toBe(sentProjection.turnItems[0]);
    expect(item.output).toEqual({ run: comparisonRun });
    const detail = Schema.encodeSync(
      Schema.toCodecJson(OrchestrationV2RpcSchemas.getTurnItem.output),
    )({
      item: projectTurnItemForDetail(item),
    });
    expect(detail).toHaveProperty("item.output", { deviceDifference });
  });

  it("preserves the link and existing result identities from an MCP content wrapper", () => {
    const item = {
      ...comparisonItem,
      nativeItemRef: claudeItemRef,
      toolName: "mcp__t3-code__device_replay_demonstration",
      output: {
        isError: false,
        content: [
          { type: "image", mimeType: "image/png", data: "PRIVATE_SCREENSHOT" },
          {
            type: "text",
            text: JSON.stringify({ run: comparisonRun, threadId: "result-thread" }),
          },
        ],
      },
    };
    const projected = projectTurnItemForWire(item);
    const output = { threadId: "result-thread", deviceDifference };
    expect(projected).toEqual({ ...item, output, outputOmitted: true });
    expect(projectTurnItemForWire(projected)).toEqual(projected);
    const detail = projectTurnItemForDetail(item);
    expect(detail).toHaveProperty("output", output);
    expect(projectTurnItemForDetail(detail)).toEqual(detail);
  });

  it("reads OpenCode's JSON text under its thread-specific MCP namespace", () => {
    const item = {
      ...comparisonItem,
      nativeItemRef: {
        driver: ProviderDriverKind.make("opencode"),
        nativeId: "tool",
        strength: "strong" as const,
      },
      toolName: `t3-code-${base.threadId}_device_stop_comparison`,
      output: JSON.stringify(comparisonItem.output),
    };
    expect(projectTurnItemForWire(item)).toHaveProperty("output", { deviceDifference });
    expect(
      projectTurnItemForWire({ ...item, toolName: "t3-code-other-thread_device_stop_comparison" }),
    ).not.toHaveProperty("output");
  });

  it("prefers structured content in an MCP result envelope", () => {
    const item = {
      ...comparisonItem,
      nativeItemRef: claudeItemRef,
      toolName: "mcp__t3-code__device_comparison_status",
      output: {
        structuredContent: comparisonItem.output,
        content: [{ type: "text", text: "PRIVATE_FALLBACK" }],
      },
    };
    expect(projectTurnItemForWire(item)).toHaveProperty("output", { deviceDifference });
  });

  it("projects an exact device access request and preserves it through a second pass", () => {
    const item = {
      ...comparisonItem,
      toolName: "t3-code.device_record_comparison",
      output: {
        run: {
          runId: comparisonRun.runId,
          phase: "awaiting_approval",
          agentRecording: { manual: false },
          source: { deviceId: "private-device" },
        },
      },
    };
    const output = { deviceComparisonRequest: { runId: comparisonRun.runId } };
    const projected = projectTurnItemForWire(item);
    expect(projected).toHaveProperty("output", output);
    expect(projectTurnItemForWire(projected)).toEqual(projected);
    expect(projectTurnItemForWire({ ...item, output })).not.toHaveProperty("output");
    expect(
      projectTurnItemForWire({ ...item, toolName: "other.device_record_comparison" }),
    ).not.toHaveProperty("output");
  });

  it("links only a genuine pending app request to the exact device", () => {
    const approvalId = comparisonRun.runId;
    const item = {
      ...comparisonItem,
      toolName: "t3-code.device_open",
      output: {
        status: "approval_required",
        device: { hostId: "pixel-host", id: "same-id", name: "Pixel" },
        approval: { id: approvalId, appId: "com.tabs.checkout" },
      },
    };
    const expected = {
      deviceComparisonRequest: { approvalId, hostId: "pixel-host", deviceId: "same-id" },
    };
    const wire = projectTurnItemForWire(item);
    expect(wire).toHaveProperty("output", expected);
    expect(projectTurnItemForWire(wire)).toEqual(wire);
    expect(projectTurnItemForWire({ ...item, output: expected })).not.toHaveProperty(
      "output.deviceComparisonRequest",
    );
    expect(projectTurnItemForWire({ ...item, toolName: "other.device_open" })).not.toHaveProperty(
      "output.deviceComparisonRequest",
    );
  });

  it.each([
    { status: "running" as const },
    { status: "failed" as const },
    { status: "cancelled" as const },
    { toolNonExecutionKind: "denied" },
    { nativeItemRef: null },
    { nativeItemRef: { ...nativeItemRef, driver: ProviderDriverKind.make("grok") } },
    { toolName: "device_comparison_status" },
    { toolName: "mcp__other__device_comparison_status", nativeItemRef: claudeItemRef },
    { toolName: "mcp__claude_ai_t3-code__device_comparison_status", nativeItemRef: claudeItemRef },
    { toolName: "other.t3-code.device_comparison_status" },
    { toolName: "t3-code-foreign_device_comparison_status" },
    { toolName: "t3-code.device_screenshot" },
    { toolSource: { key: "mcp:other", name: "Other", kind: "integration" as const } },
    { output: {} },
    { output: { run: { ...comparisonRun, runId: "PRIVATE_INVALID_ID" } } },
    { output: { run: { ...comparisonRun, firstDifference: undefined } } },
    { output: { deviceDifference } },
    { output: { structuredContent: { deviceDifference } }, outputOmitted: true },
    { output: { success: false, run: comparisonRun } },
  ])("omits a link for an ineligible item, case %#", (overrides) => {
    expect(projectTurnItemForWire({ ...comparisonItem, ...overrides })).not.toHaveProperty(
      "output",
    );
  });

  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, "2"])(
    "rejects invalid difference steps, case %#",
    (step) => {
      const run = { ...comparisonRun, firstDifference: { ...comparisonRun.firstDifference, step } };
      expect(projectTurnItemForWire({ ...comparisonItem, output: { run } })).not.toHaveProperty(
        "output",
      );
    },
  );

  it.each([
    { isError: true, structuredContent: comparisonItem.output },
    { error: "PRIVATE_ERROR", result: comparisonItem.output },
    { content: [{ type: "text", text: JSON.stringify({ is_error: true, run: comparisonRun }) }] },
  ])("retains only the failure flag from a failed result, case %#", (output) => {
    const item = { ...comparisonItem, output };
    expect(projectTurnItemForWire(item)).toHaveProperty("output", { isError: true });
    expect(projectTurnItemForDetail(item)).toHaveProperty("output", { isError: true });
  });
});

describe("terminal input approval wire output", () => {
  const requestId = "890a6a1f-d885-46cf-a648-7e0653d85477";
  const item = {
    ...base,
    nativeItemRef: {
      driver: ProviderDriverKind.make("codex"),
      nativeId: "terminal-input-tool-call",
      strength: "strong" as const,
    },
    toolName: "t3-code.terminal_input",
    input: { action: "propose", text: "review-only bytes" },
    output: { requestId, status: "pending", text: "review-only bytes" },
  };

  it("preserves only the pending reference through detail reads and repeated projection", () => {
    const wire = projectTurnItemForWire(item);
    expect(wire).toHaveProperty("output", { terminalAgentInput: { requestId } });
    expect(wire).toHaveProperty("input", undefined);
    expect(projectTurnItemForWire(wire)).toEqual(wire);
    expect(projectTurnItemForDetail(item)).toEqual(wire);
    expect(JSON.stringify(wire)).not.toContain("review-only bytes");
  });

  it("discards invalid, finished and spoofed references", () => {
    for (const output of [
      { requestId: "not-an-id", status: "pending" },
      { requestId, status: "delivered" },
      { terminalAgentInput: { requestId } },
    ]) {
      expect(projectTurnItemForWire({ ...item, output })).not.toHaveProperty("output");
    }
    expect(
      projectTurnItemForWire({ ...item, toolName: "other.terminal_input" }),
    ).not.toHaveProperty("output");
  });

  it("projects Cursor's native MCP response from the registered Tabs server", () => {
    const cursorItem = {
      ...item,
      nativeItemRef: { ...item.nativeItemRef, driver: ProviderDriverKind.make("cursor") },
      toolName: "mcp__t3-code__terminal_input",
      output: {
        isError: false,
        content: [{ text: { text: JSON.stringify({ requestId, status: "pending" }) } }],
      },
    };
    const wire = projectTurnItemForWire(cursorItem);
    expect(wire).toHaveProperty("output", { terminalAgentInput: { requestId } });
    expect(wire).toHaveProperty("input", undefined);
    expect(projectTurnItemForWire(wire)).toEqual(wire);
    expect(
      projectTurnItemForWire({ ...cursorItem, toolName: "mcp__another-server__terminal_input" }),
    ).not.toHaveProperty("output.terminalAgentInput");
    expect(
      projectTurnItemForWire({ ...cursorItem, output: { ...cursorItem.output, isError: true } }),
    ).not.toHaveProperty("output.terminalAgentInput");
  });
});

describe("Figma canvas result wire output", () => {
  const operationId = "f1".repeat(32);
  const output = {
    status: "verified",
    operationId,
    receipt: { target: { fileKey: "private-file" }, frameNodeId: "12:34" },
  };
  const compact = { figmaCanvasResult: { operationId } };
  const item = {
    ...base,
    nativeItemRef: {
      driver: ProviderDriverKind.make("codex"),
      nativeId: "figma-frame-tool-call",
      strength: "strong" as const,
    },
    ...projectCodexDynamicToolItem({
      type: "mcpToolCall",
      id: "figma-frame-tool-call",
      server: "t3-code",
      tool: "preview_figma_frame",
      status: "completed",
      arguments: {},
      result: { structuredContent: output, content: [] },
    }),
  };

  it("keeps only the reference in live and on-demand responses", () => {
    const event = projectDomainEventForWire({
      id: EventId.make("figma-frame-event"),
      type: "turn-item.updated",
      threadId: item.threadId,
      occurredAt: item.updatedAt,
      payload: item,
    });
    const expected = { ...item, output: compact, outputOmitted: true };
    expect(event.payload).toEqual(expected);
    expect(projectDomainEventForWire(event)).toEqual(event);
    expect(projectTurnItemForDetail(item)).toEqual(expected);
    expect(projectTurnItemForDetail(expected)).toEqual(expected);
  });

  it.each([
    { status: "running" as const },
    { status: "failed" as const },
    { toolNonExecutionKind: "denied" },
    { nativeItemRef: null },
    { toolName: "preview_figma_frame" },
    { toolName: "other.preview_figma_frame" },
    { toolSource: { key: "mcp:other", name: "Other", kind: "integration" as const } },
    { output: { ...output, status: "approval_required" } },
    { output: { ...output, operationId: "../other-receipt" } },
    { output: { ...output, operationId: `${operationId}\n` } },
    { output: { structuredContent: output, isError: true } },
    { output: { ...output, success: false } },
    { output: compact },
    { output: { structuredContent: compact }, outputOmitted: true },
    { output: { ...compact, receipt: output.receipt }, outputOmitted: true },
  ])("omits the reference in live and detail reads for ineligible item %#", (overrides) => {
    const ineligibleItem = { ...item, ...overrides };
    expect(projectTurnItemForWire(ineligibleItem)).not.toHaveProperty("output.figmaCanvasResult");
    expect(projectTurnItemForDetail(ineligibleItem)).not.toHaveProperty("output.figmaCanvasResult");
  });
});

describe("browser workflow wire output", () => {
  const workflowId = "ab".repeat(32);
  const report = {
    workflowId,
    phase: "verified",
    result: { url: "https://example.test/private-draft", profileId: "private-profile" },
    lastVerified: { stage: "certified", statusSelector: "#private-status", statusText: "Private" },
    reason: "Private reason",
  };
  const browserWorkflowResult = { workflowId, stage: "certified" };
  const expectedOutput = { browserWorkflowResult };
  const nativeItemRef = {
    driver: ProviderDriverKind.make("codex"),
    nativeId: "preview-workflow-tool-call",
    strength: "strong" as const,
  };
  const item = {
    ...base,
    nativeItemRef,
    toolName: "t3-code.preview_workflow",
    output: report,
  };

  it("sends only the reference through live and detail RPCs", () => {
    const providerItem = {
      ...item,
      ...projectCodexDynamicToolItem({
        type: "mcpToolCall",
        id: nativeItemRef.nativeId,
        server: "t3-code",
        tool: "preview_workflow",
        status: "completed",
        arguments: { action: "check", workflowId },
        result: { structuredContent: { ...report, threadId: "private-thread" }, content: [] },
      }),
    };
    const event = projectDomainEventForWire({
      id: EventId.make("browser-workflow-event"),
      type: "turn-item.updated",
      threadId: item.threadId,
      occurredAt: item.updatedAt,
      payload: providerItem,
    });
    expect(event.payload).toEqual({ ...providerItem, output: expectedOutput, outputOmitted: true });
    expect(projectDomainEventForWire(event)).toEqual(event);
    const streamCodec = Schema.toCodecJson(OrchestrationV2RpcSchemas.subscribeThread.output);
    expect(Schema.encodeSync(streamCodec)({ kind: "event", sequence: 1, event })).toHaveProperty(
      "event.payload.output",
      expectedOutput,
    );

    const detail = projectTurnItemForDetail(providerItem);
    const detailCodec = Schema.toCodecJson(OrchestrationV2RpcSchemas.getTurnItem.output);
    expect(Schema.encodeSync(detailCodec)({ item: detail })).toHaveProperty(
      "item.output",
      expectedOutput,
    );
    expect(projectTurnItemForDetail(detail)).toEqual(detail);
  });

  it("projects a Quick Action review only from the built-in completed proposal", () => {
    const actionId = "9d8446b7-7524-4305-b22e-d336291c583e";
    const proposal = {
      ...item,
      toolName: "t3-code.preview_run_quick_action",
      output: { status: "approval_required", actionId },
    };
    const expected = { browserQuickActionRequest: { actionId } };
    const projected = projectTurnItemForWire(proposal);
    expect(projected).toHaveProperty("output", expected);
    expect(projectTurnItemForWire(projected)).toEqual(projected);
    expect(projectTurnItemForDetail(proposal)).toHaveProperty("output", expected);
    for (const candidate of [
      { ...proposal, toolName: "other.preview_run_quick_action", output: expected },
      { ...proposal, status: "failed" as const },
      { ...proposal, output: { status: "pass", completedSteps: 2, actionId } },
      { ...proposal, output: { status: "approval_required", actionId: "other" } },
    ]) {
      expect(projectTurnItemForWire(candidate)).not.toHaveProperty(
        "output.browserQuickActionRequest",
      );
    }
  });

  it("projects a paused Quick Action with the exact repair target", () => {
    const resumeRequest = {
      actionId: "9d8446b7-7524-4305-b22e-d336291c583e",
      pause: {
        pauseId: "226f5b60-d213-49c1-94a1-bc17a181aa71",
        tabId: "work-tab",
        profileId: "work",
      },
    };
    const paused = {
      ...item,
      toolName: "t3-code.preview_run_quick_action",
      output: {
        status: "paused",
        completedSteps: 1,
        resumeRequest: { ...resumeRequest, url: "https://reports.example/private" },
      },
    };
    const projected = projectTurnItemForWire(paused);
    expect(projected).toHaveProperty("output", { browserQuickActionRequest: resumeRequest });
    expect(projectTurnItemForDetail(projected)).toEqual(projected);
    for (const output of [
      { status: "pass", resumeRequest },
      { status: "paused", resumeRequest: { actionId: resumeRequest.actionId } },
    ]) {
      expect(projectTurnItemForWire({ ...paused, output })).not.toHaveProperty(
        "output.browserQuickActionRequest",
      );
    }
  });

  it("exposes a verified Quick Action file link only from the built-in completed run", () => {
    const fileResult = {
      resultId: "226f5b60-d213-49c1-94a1-bc17a181aa71",
      tabId: "work-tab",
      profileId: "work",
      filename: "report.csv",
      restorable: true,
    };
    const proof = {
      ...item,
      toolName: "t3-code.preview_run_quick_action",
      output: {
        status: "pass",
        fileReceipt: { filename: "report.csv", byteLength: 16, sha256: "a".repeat(64) },
        fileResult: { ...fileResult, url: "https://reports.example/private-link" },
      },
    };
    const expected = { browserQuickActionFileResult: fileResult };
    const projected = projectTurnItemForWire(proof);
    expect(projected).toHaveProperty("output", expected);
    expect(projectTurnItemForWire(projected)).toEqual(projected);
    expect(projectTurnItemForDetail(proof)).toHaveProperty("output", expected);
    for (const candidate of [
      { ...proof, toolName: "other.preview_run_quick_action" },
      { ...proof, status: "failed" as const },
      {
        ...proof,
        output: {
          ...proof.output,
          fileReceipt: { ...proof.output.fileReceipt, filename: "other.csv" },
        },
      },
      { ...proof, output: { status: "pass", fileResult } },
    ]) {
      expect(projectTurnItemForWire(candidate)).not.toHaveProperty(
        "output.browserQuickActionFileResult",
      );
    }
  });

  it("links a verified Store receipt to the exact saved browser workflow", () => {
    const observedAt = "2026-11-26T10:31:00.000Z";
    const storeItem = {
      ...item,
      toolName: "t3-code.preview_partner_center_status",
      output: {
        status: "verified",
        workflowId,
        browserStage: "certified",
        storeStatus: "Published",
        observedAt,
        applicationId: "private-app",
        submissionId: "private-submission",
      },
    };
    const expectedStoreOutput = {
      browserWorkflowResult: {
        ...browserWorkflowResult,
        partnerCenter: { storeStatus: "Published", observedAt },
      },
    };
    const projected = projectTurnItemForWire(storeItem);
    expect(projected).toHaveProperty("output", expectedStoreOutput);
    expect(projectTurnItemForWire(projected)).toEqual(projected);
    expect(projectTurnItemForDetail(storeItem)).toHaveProperty("output", expectedStoreOutput);
    expect(
      projectTurnItemForWire({
        ...storeItem,
        output: { ...storeItem.output, observedAt: "not-a-timestamp" },
      }),
    ).toHaveProperty("output", expectedOutput);
    expect(
      projectTurnItemForWire({
        ...storeItem,
        output: { ...storeItem.output, status: "approval_required" },
      }),
    ).not.toHaveProperty("output");
    expect(
      projectTurnItemForWire({
        ...storeItem,
        output: { ...storeItem.output, browserStage: "unknown" },
      }),
    ).not.toHaveProperty("output");
  });

  it.each([
    ["claudeAgent", "mcp__t3-code__preview_workflow", { structuredContent: report, content: [] }],
    [
      "pi",
      "mcp__t3-code__preview_workflow",
      {
        content: [
          { type: "image", data: "private-image", mimeType: "image/png" },
          { type: "text", text: JSON.stringify(report) },
        ],
      },
    ],
    ["opencode", "t3-code_preview_workflow", JSON.stringify(report)],
    ["opencode", `t3-code-${base.threadId}_preview_workflow`, JSON.stringify(report)],
  ])("projects a %s %s result wrapper", (driver, toolName, output) => {
    const wrappedItem = {
      ...item,
      nativeItemRef: { ...nativeItemRef, driver: ProviderDriverKind.make(driver) },
      toolName,
      output,
    };
    const projected = projectTurnItemForWire(wrappedItem);
    expect(projected).toEqual({ ...wrappedItem, output: expectedOutput, outputOmitted: true });
    expect(projectTurnItemForWire(projected)).toEqual(projected);
  });

  it.each(["ready", "paused", "verified"])("uses the last verified stage in phase %s", (phase) => {
    const output = {
      ...report,
      phase,
      stage: "published",
      browserWorkflowResult: { workflowId: "0".repeat(64), stage: "published" },
    };
    expect(projectTurnItemForWire({ ...item, output })).toHaveProperty("output", expectedOutput);
  });

  it("projects the original draft when it awaits submission approval", () => {
    const output = {
      ...report,
      phase: "approval_required",
      lastVerified: { ...report.lastVerified, stage: "uploaded" },
    };
    const expected = { browserWorkflowResult: { workflowId, stage: "uploaded" } };
    expect(projectTurnItemForWire({ ...item, output })).toHaveProperty("output", expected);
    expect(projectTurnItemForDetail({ ...item, output })).toHaveProperty("output", expected);
  });

  it("links an unkeyed submission handoff without representing a pending submit", () => {
    const handoff = {
      ...item,
      output: {
        ...report,
        phase: "manual_submit",
        lastVerified: { ...report.lastVerified, stage: "uploaded" },
      },
    };
    const expected = {
      browserWorkflowResult: { workflowId, stage: "uploaded", submitRequiresUser: true },
    };
    const projected = projectTurnItemForWire(handoff);
    expect(projected).toHaveProperty("output", expected);
    expect(projectTurnItemForWire(projected)).toEqual(projected);
    expect(projectTurnItemForDetail(handoff)).toHaveProperty("output", expected);
  });

  it.each([
    ["ready_to_upload", "upload"],
    ["uploaded", "submit"],
  ] as const)("links a draft whose %s stage has pending verification", (stage, pendingAction) => {
    const uncertain = {
      ...item,
      output: {
        ...report,
        phase: "uncertain",
        lastVerified: { ...report.lastVerified, stage },
      },
    };
    const expected = { browserWorkflowResult: { workflowId, stage, pendingAction } };
    const projected = projectTurnItemForWire(uncertain);
    expect(projected).toHaveProperty("output", expected);
    expect(projectTurnItemForWire(projected)).toEqual(projected);
    expect(projectTurnItemForDetail(uncertain)).toHaveProperty("output", expected);
  });

  it.each([
    { status: "running" as const },
    { status: "failed" as const },
    { toolNonExecutionKind: "denied" },
    { nativeItemRef: null },
    { nativeItemRef: { ...nativeItemRef, driver: ProviderDriverKind.make("copilot") } },
    { toolName: "preview_workflow" },
    { toolName: "other.preview_workflow" },
    { toolName: "t3-code.preview_workflow_extra" },
    { toolName: "mcp__t3-code__preview_workflow" },
    {
      nativeItemRef: { ...nativeItemRef, driver: ProviderDriverKind.make("opencode") },
      toolName: "t3-code-other-thread_preview_workflow",
    },
    { toolSource: { key: "mcp:other", name: "Other", kind: "integration" as const } },
    { output: expectedOutput },
    { output: { structuredContent: expectedOutput }, outputOmitted: true },
    { output: JSON.stringify(expectedOutput), outputOmitted: true },
    {
      output: { browserWorkflowResult: { ...browserWorkflowResult, stage: "unknown" } },
      outputOmitted: true,
    },
    { output: { ...report, phase: "uncertain", ...expectedOutput }, outputOmitted: true },
    {
      output: { browserWorkflowResult: { ...browserWorkflowResult, pendingAction: "submit" } },
      outputOmitted: true,
    },
    { output: { ...report, phase: "unobservable" } },
    { output: { ...report, workflowId: workflowId.toUpperCase() } },
    { output: { ...report, workflowId: workflowId.slice(1) } },
    { output: { ...report, workflowId: `${workflowId}\n` } },
    { output: { ...report, lastVerified: { stage: "unknown" } } },
    { output: { ...report, lastVerified: undefined, stage: "certified" } },
    { output: { ...report, success: false } },
    {
      output: [
        { type: "text", text: JSON.stringify(report) },
        { type: "text", text: "{}" },
      ],
    },
  ])("omits a reference for an ineligible item, case %#", (overrides) => {
    const projected = projectTurnItemForWire({ ...item, ...overrides });
    expect(projected).not.toHaveProperty("output");
    expect(projectTurnItemForWire(projected)).toEqual(projected);
  });

  it.each([
    { isError: true, structuredContent: report },
    { structuredContent: { ...report, _tag: "OrchestratorMcpFailure" } },
    { content: [{ type: "text", text: JSON.stringify({ ...report, is_error: true }) }] },
  ])("keeps only the failure flag from a failed result, case %#", (output) => {
    expect(projectTurnItemForWire({ ...item, output })).toHaveProperty("output", { isError: true });
    expect(projectTurnItemForDetail({ ...item, output })).toHaveProperty("output", {
      isError: true,
    });
  });
});

describe("orchestration V2 wire projection", () => {
  it("keeps copied handoff transcripts out of activity items and live events", () => {
    const item = {
      ...base,
      type: "handoff" as const,
      contextHandoffId: ContextHandoffId.make("handoff:wire"),
      fromProviderThreadIds: [],
      toProviderThreadId: ProviderThreadId.make("target"),
      fromProviderInstanceIds: [],
      toProviderInstanceId: ProviderInstanceId.make("codex"),
      strategy: "full_thread_summary" as const,
      summary: "PRIVATE_HANDOFF_TRANSCRIPT",
    };
    const projected = projectTurnItemForWire(item);
    expect(projected).not.toHaveProperty("summary");
    expect(decodeTurnItem(projected)).toMatchObject({ contextHandoffId: item.contextHandoffId });
    const event = {
      id: EventId.make("handoff:wire"),
      type: "turn-item.updated" as const,
      threadId: base.threadId,
      occurredAt: base.updatedAt,
      payload: item,
    };
    expect(JSON.stringify(projectDomainEventForWire(event))).not.toContain(item.summary);
    expect(item.summary).toBe("PRIVATE_HANDOFF_TRANSCRIPT");
  });

  it("preserves image metadata through wire and JSON contracts while redacting output", () => {
    const item = {
      ...base,
      toolName: "Read",
      input: { file_path: "/workspace/reference.png" },
      viewedImagePath: "/workspace/reference.png",
      output: { data: "private-image-data" },
    } satisfies OrchestrationV2TurnItem;
    const projected = projectTurnItemForWire(item);
    const live = decodeTurnItem(projected);
    const encoded = encodeTurnItemJson(live);
    const json = decodeTurnItemJson(encoded);
    const decoded = decodeTurnItem(json);
    expect(decoded).toMatchObject({ viewedImagePath: "/workspace/reference.png" });
    expect(decoded).not.toHaveProperty("output");
    expect(item.output.data).toBe("private-image-data");
  });

  it("preserves provider notices in bounded items and live events", () => {
    const item = {
      ...base,
      type: "system_notice" as const,
      message: "Safeguards flagged this message. Switched to Opus 4.8.",
    };
    expect(projectTurnItemForWire(item)).toEqual(item);
    const event = {
      id: EventId.make("notice-wire-event"),
      type: "turn-item.updated" as const,
      threadId: item.threadId,
      occurredAt: item.updatedAt,
      payload: item,
    };
    expect(projectDomainEventForWire(event)).toEqual(event);
  });

  it("keeps transcript bodies out of shell rows", () => {
    const now = DateTime.makeUnsafe("2026-08-13T00:00:00.000Z");
    const threadId = ThreadId.make("thread-shell-budget");
    const projection = {
      thread: {
        createdBy: "user",
        creationSource: "web",
        id: threadId,
        projectId: ProjectId.make("project-shell-budget"),
        title: "Shell payload budget",
        providerInstanceId: ProviderInstanceId.make("codex"),
        modelSelection: null,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        lineage: {
          parentThreadId: null,
          relationshipToParent: null,
          rootThreadId: threadId,
        },
        forkedFrom: null,
        activeProviderThreadId: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
      },
      runs: [],
      runtimeRequests: [],
      messages: [
        {
          id: MessageId.make("message-shell-budget"),
          role: "assistant",
          text: "x".repeat(1_000_000),
          updatedAt: now,
        },
      ],
      providerSessions: [],
      providerThreads: [],
      turnItems: [],
      visibleTurnItems: [],
      plans: [],
      updatedAt: now,
    } as unknown as OrchestrationV2ThreadProjection;

    const shell = threadShellFromProjection(projection);

    expect(shell.latestVisibleMessage).toBeNull();
    expect(JSON.stringify(shell).length).toBeLessThan(2_000);
  });

  it("omits oversized dynamic tool results without mutating persistence data", () => {
    const output = { content: [{ type: "text", text: "first line\n" + "x".repeat(100_000) }] };
    const item = { ...base, output } satisfies OrchestrationV2TurnItem;
    const projected = projectTurnItemForWire(item);

    expect(item.output).toBe(output);
    expect(projected).not.toBe(item);
    expect(JSON.stringify(projected).length).toBeLessThan(2_000);
    expect(projected).not.toHaveProperty("output");
  });

  it("omits even small dynamic tool results while retaining input", () => {
    const item = { ...base, output: { ok: true } } satisfies OrchestrationV2TurnItem;
    expect(projectTurnItemForWire(item)).toEqual({ ...base, outputOmitted: true });
    expect(item.output).toEqual({ ok: true });
  });

  it("keeps undefined dynamic input intact", () => {
    const item = { ...base, input: undefined } satisfies OrchestrationV2TurnItem;
    expect(projectTurnItemForWire(item)).toEqual(item);
  });

  it.each([
    [" \t\r\n\n  first\t line  \r\n" + "x\n".repeat(10_000), "first line"],
    [" \n".repeat(10_000), "Large tool output"],
    ["a".repeat(160) + "\n" + "x".repeat(20_000), "a".repeat(160)],
    ["a".repeat(161) + "\n" + "x".repeat(20_000), "a".repeat(159) + "…"],
    ["a".repeat(159) + "\t b" + "x".repeat(20_000), "a".repeat(159) + "…"],
    ["  café\u00a0\u2003😀 \t\r\n" + "x".repeat(20_000), "café 😀"],
  ])("preserves bounded input summary normalization for case %#", (input, summary) => {
    const projected = projectTurnItemForWire({ ...base, input });
    expect(projected.type === "dynamic_tool" ? projected.input : null).toEqual({
      summary,
      truncated: true,
    });
  });

  it("uses encoded JSON bytes for strings near the dynamic-value limit", () => {
    const small = '"'.repeat(8_191);
    const large = '"'.repeat(8_192);
    const smallItem = { ...base, input: small };
    expect(projectTurnItemForWire(smallItem)).toEqual(smallItem);
    const projected = projectTurnItemForWire({ ...base, input: large });
    expect(projected.type === "dynamic_tool" ? projected.input : null).toEqual({
      summary: '"'.repeat(159) + "…",
      truncated: true,
    });
  });

  it("serializes an oversized structured input only once for its summary", () => {
    let serializations = 0;
    const input = {
      toJSON() {
        serializations += 1;
        return { text: "x".repeat(100_000) };
      },
    };
    const projected = projectTurnItemForWire({ ...base, input });
    expect(serializations).toBe(1);
    expect(projected.type === "dynamic_tool" ? projected.input : null).toMatchObject({
      truncated: true,
    });
  });

  it("truncates detail at a UTF-8 boundary without changing the source", () => {
    const progress = "a".repeat(32_767) + "😀" + "x".repeat(100_000);
    const item = {
      ...base,
      type: "subagent" as const,
      subagentId: NodeId.make("child-agent"),
      origin: "app_owned" as const,
      driver: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      childThreadId: null,
      prompt: "Inspect code",
      result: null,
      progress,
    };
    const projected = projectTurnItemForWire(item);
    expect(projected.type === "subagent" ? projected.progress : null).toBe(
      "a".repeat(32_767) + "\n… output truncated for transport",
    );
    expect(item.progress).toBe(progress);
  });

  it.each(["", "small output", "x".repeat(1_048_576)])(
    "omits command output of every size, case %#",
    (output) => {
      const item = { ...base, type: "command_execution" as const, input: "test", output };
      const projected = projectTurnItemForWire(item);
      expect(projected).not.toHaveProperty("output");
      expect(projected).toMatchObject({ input: "test", status: "completed" });
      // Clients fetch withheld output on demand, so they need to know it exists.
      expect(projected.type === "command_execution" ? projected.outputOmitted : null).toBe(
        output ? true : undefined,
      );
      expect(item.output).toBe(output);
    },
  );

  it.each([
    ["echo ok", "echo ok"],
    ["a".repeat(262_143) + "😀", "a".repeat(262_143) + "\n… output truncated for transport"],
  ])("bounds fetched command input without changing persistence, case %#", (input, expected) => {
    const item = { ...base, type: "command_execution" as const, input, output: "ok" };
    const projected = projectTurnItemForDetail(item);
    expect(projected).toMatchObject({ input: expected, output: "ok" });
    expect(item.input).toBe(input);
  });

  it("leaves a screenshot's bytes out of the fetched tool output", () => {
    const data = "A".repeat(600_000);
    const item = {
      ...base,
      type: "dynamic_tool" as const,
      toolName: "mcp__t3-code__device_screenshot",
      input: { deviceId: "phone" },
      output: {
        content: [{ type: "image", source: { type: "base64", media_type: "image/png", data } }],
      },
    };
    expect(projectTurnItemForDetail(item)).toMatchObject({
      output: { content: [{ type: "image", mimeType: "image/png" }] },
    });
    expect(item.output.content[0]?.source.data).toBe(data);
  });

  it("keeps image markers when the rest of a tool output is too large to send", () => {
    const image = {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "AAAA" },
    };
    const item = {
      ...base,
      type: "dynamic_tool" as const,
      output: { content: [{ type: "text", text: "x".repeat(300_000) }, image] },
    };
    const projected = projectTurnItemForDetail(item);
    const output = projected.type === "dynamic_tool" ? projected.output : null;
    expect(Array.isArray(output) ? output.slice(1) : null).toEqual([
      { type: "image", mimeType: "image/png" },
    ]);
    expect(JSON.stringify(output).length).toBeLessThan(270_000);
  });

  it("bounds a tool output made of many images", () => {
    const image = { type: "image", data: "AAAA", mimeType: "image/png" };
    const item = {
      ...base,
      type: "dynamic_tool" as const,
      output: Array.from({ length: 10_000 }, () => image),
    };
    const projected = projectTurnItemForDetail(item);
    const output = projected.type === "dynamic_tool" ? projected.output : null;
    // The truncated text block plus a fixed number of markers, however many images there are.
    expect(Array.isArray(output) ? output.length : null).toBe(1 + MAX_TOOL_OUTPUT_IMAGES);
    expect(Array.isArray(output) ? String(output[0]?.text).length : null).toBeLessThan(263_000);
    expect(toolOutputImages(output)).toHaveLength(MAX_TOOL_OUTPUT_IMAGES);
  });

  it("keeps failure evidence without retaining command output", () => {
    const item = {
      ...base,
      type: "command_execution" as const,
      input: "cat missing-file",
      output: "cat: missing-file: No such file or directory",
    };
    const projected = projectTurnItemForWire(item);
    expect(projected).not.toHaveProperty("output");
    expect(projected).toMatchObject({ outputIndicatesFailure: true });
    expect(projectTurnItemForWire(projected)).toEqual(projected);
    expect(projectTurnItemForWire({ ...item, output: "", exitCode: 2 })).toMatchObject({
      outputIndicatesFailure: true,
      exitCode: 2,
    });
  });

  it("trusts a zero exit code over failure phrases printed by a successful command", () => {
    const item = {
      ...base,
      type: "command_execution" as const,
      input: "cat docs/NOTES.md",
      output: "Handles ENOENT and file not found; exit code 2 means bad usage.",
      exitCode: 0,
    };
    expect(projectTurnItemForWire(item)).not.toHaveProperty("outputIndicatesFailure");
  });

  it("omits inline file bodies but preserves file identity and change counts", () => {
    const item = {
      ...base,
      type: "file_change" as const,
      fileName: "src/main.ts",
      additions: 3,
      deletions: 1,
      diffStr: "+new code",
      oldStr: "old code",
      newStr: "new code",
    };
    const projected = projectTurnItemForWire(item);
    expect(projected).not.toHaveProperty("diffStr");
    expect(projected).not.toHaveProperty("oldStr");
    expect(projected).not.toHaveProperty("newStr");
    expect(projected).toMatchObject({ fileName: "src/main.ts", additions: 3, deletions: 1 });
    expect(item.diffStr).toBe("+new code");
    // A failed edit keeps the provider's error so expanding the row can show it.
    const failed = projectTurnItemForWire({
      ...item,
      status: "failed",
      diffStr: "String to replace not found",
    });
    expect(failed).toMatchObject({ diffStr: "String to replace not found" });
    expect(failed).not.toHaveProperty("newStr");
  });

  it("retains only result identities and failure metadata in live tool events", () => {
    const output = {
      isError: true,
      structuredContent: { threadId: "child-thread", messageId: "message", text: "PRIVATE_BODY" },
      content: [{ type: "text", text: "PRIVATE_BODY" }],
    };
    const event = {
      id: EventId.make("result-event"),
      type: "turn-item.updated" as const,
      threadId: base.threadId,
      occurredAt: base.updatedAt,
      payload: { ...base, output },
    };
    const projected = projectDomainEventForWire(event);
    expect(projected.payload).toMatchObject({
      output: { isError: true, threadId: "child-thread", messageId: "message" },
    });
    expect(JSON.stringify(projected)).not.toContain("PRIVATE_BODY");
    expect(event.payload.output).toBe(output);
    expect(projectDomainEventForWire(projected)).toEqual(projected);
  });

  it("does not serialize raw dynamic output to discard it", () => {
    const output = {
      toJSON: () => {
        throw new Error("Raw output must not be serialized");
      },
    };
    expect(projectTurnItemForWire({ ...base, output })).not.toHaveProperty("output");
  });
});

describe("live body deduper", () => {
  const at = base.updatedAt;
  const messageId = MessageId.make("message-live");
  const event = (
    sequence: number,
    rest: Pick<OrchestrationV2DomainEvent, "type" | "payload">,
  ): Extract<OrchestrationV2ThreadStreamItem, { kind: "event" }> => ({
    kind: "event",
    sequence,
    event: {
      id: EventId.make(`event-${sequence}`),
      threadId: base.threadId,
      occurredAt: at,
      ...rest,
    } as OrchestrationV2DomainEvent,
  });
  const message = (sequence: number, text: string) =>
    event(sequence, {
      type: "message.updated",
      payload: {
        id: messageId,
        threadId: base.threadId,
        runId: null,
        nodeId: null,
        role: "assistant",
        text,
        attachments: [],
        streaming: true,
        createdBy: "agent",
        creationSource: "provider",
        createdAt: at,
        updatedAt: at,
      },
    });
  const reply = (sequence: number, text: string) =>
    event(sequence, {
      type: "turn-item.updated",
      payload: {
        ...base,
        status: "running",
        type: "assistant_message",
        messageId,
        text,
        streaming: true,
      },
    });
  const payloadOf = (item: OrchestrationV2ThreadStreamItem) =>
    item.kind === "event" ? item.event.payload : undefined;

  it("blanks a reply that repeats the message delivered before it, after coalescing", () => {
    const delivered = coalesceLiveUpdatedEvents([
      message(1, "a"),
      reply(2, "a"),
      message(3, "ab"),
      reply(4, "ab"),
    ]).map(makeLiveBodyDeduper());

    expect(
      delivered.map((item) => [item.kind === "event" && item.sequence, payloadOf(item)]),
    ).toEqual([
      [3, message(3, "ab").event.payload],
      [4, { ...reply(4, "ab").event.payload, text: "", textOmitted: true }],
    ]);
  });

  it("versions omitted bodies against the exact source event and clears sources on snapshot", () => {
    const dedupe = makeLiveBodyDeduper(true);
    dedupe(message(1, "Unicode 🌍\n".repeat(1000)));
    const compact = dedupe(reply(2, "Unicode 🌍\n".repeat(1000)));
    expect(payloadOf(compact)).toMatchObject({
      text: "",
      textOmitted: true,
      bodySourceSequence: 1,
    });
    const snapshot = {
      kind: "snapshot",
      snapshotSequence: 3,
      projection: { messages: [], checkpoints: [], subagents: [] },
    } as unknown as OrchestrationV2ThreadStreamItem;
    dedupe(snapshot);
    const whole = reply(4, "Unicode 🌍\n".repeat(1000));
    expect(dedupe(whole)).toBe(whole);
    expect(dedupe(reply(5, ""))).toEqual(reply(5, ""));
  });

  it("tracks each subagent update as the source version for the next omitted update", () => {
    const dedupe = makeLiveBodyDeduper(true);
    const subagent = (sequence: number, prompt: string, result: string | null) =>
      event(sequence, {
        type: "subagent.updated",
        payload: {
          id: NodeId.make("child"),
          prompt,
          result,
        } as OrchestrationV2DomainEvent["payload"],
      });

    dedupe(subagent(10, "Inspect the repository", null));
    const omitted = dedupe(subagent(11, "Inspect the repository", null));
    expect(payloadOf(omitted)).toMatchObject({
      prompt: "",
      promptOmitted: true,
      bodySourceSequence: 10,
    });

    dedupe(subagent(12, "Inspect the repository", "Finished"));
    const omittedAgain = dedupe(subagent(13, "Inspect the repository", "Finished"));
    expect(payloadOf(omittedAgain)).toMatchObject({
      promptOmitted: true,
      resultOmitted: true,
      bodySourceSequence: 12,
    });
  });

  it("ships a reply whole when its message arrives after it", () => {
    const first = reply(1, "a");
    expect([first, message(2, "a")].map(makeLiveBodyDeduper())[0]).toBe(first);
  });
});

it("forwards single screenshot receipts with their kind and drops page text", () => {
  const digest = "a".repeat(64);
  const project = (structuredContent: Record<string, unknown>) =>
    projectTurnItemForWire({
      ...base,
      toolName: "t3-code.preview_snapshot",
      nativeItemRef: {
        driver: ProviderDriverKind.make("codex"),
        nativeId: "receipt-call",
        strength: "strong" as const,
      },
      output: { structuredContent: { visibleText: "Private draft text", ...structuredContent } },
    });
  expect(project({ verifiedScreenshotDraft: { sha256: digest } })).toHaveProperty("output", {
    verifiedScreenshotDraft: { sha256: digest, receiptKind: "image" },
  });
  expect(
    project({ unverifiedScreenshotDraft: { sha256: digest, receiptKind: "pageText" } }),
  ).toHaveProperty("output", {
    unverifiedScreenshotDraft: { sha256: digest, receiptKind: "pageText" },
  });
});
