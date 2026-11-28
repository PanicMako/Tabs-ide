import {
  DeviceComparisonError,
  DeviceComparisonRecording,
  DeviceComparisonReplay,
  DeviceComparisonReport,
  DeviceComparisonStatus,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import { DeviceService } from "../../../device/DeviceService.ts";
import { McpInvocationContext, requireThreadMcpCapability } from "../../McpInvocationContext.ts";

const options = {
  dependencies: [McpInvocationContext, DeviceService],
  success: Schema.Struct({
    run: Schema.optional(DeviceComparisonReport),
    /** Plain-language caveats, such as that no total check ran. */
    note: Schema.optional(Schema.String),
  }),
  failure: DeviceComparisonError,
};

export const NO_TOTAL_CHECK_NOTE = "No total check was configured; totals were not compared.";
export const SUGGEST_TOTAL_CHECK_NOTE =
  "The recorded screens show a currency amount. Propose with total { sourceLabel, targetLabel, currency } so replay compares the totals.";

/** Spell out when a replay did not (or will not) compare totals so it is never silent. */
export const totalCheckNote = (run: DeviceComparisonReport | undefined) => {
  if (run?.totalCheck !== "none") return {};
  return {
    note: run.suggestTotalCheck
      ? `${NO_TOTAL_CHECK_NOTE} ${SUGGEST_TOTAL_CHECK_NOTE}`
      : NO_TOTAL_CHECK_NOTE,
  };
};

const replayOutcome = Schema.Struct({
  ...options.success.fields,
  approvedEvidence: DeviceComparisonStatus.fields.approvedEvidence,
});

const status = Tool.make("device_comparison_status", {
  ...options,
  description:
    "Get the demonstration or replay status. With runId and waitForCheckpoint=true, wait up to 30 seconds for the current replay to pause, finish or stop. If both frozen frames are ready and transfer was approved, approvedEvidence contains the tabId and one-use grantIds in source, target order. Use device_attach_screenshot with each grant on a separate input.",
  parameters: Schema.Struct({
    runId: Schema.optional(DeviceComparisonReplay.fields.runId),
    waitForCheckpoint: Schema.optional(Schema.Boolean),
  }),
  success: replayOutcome,
}).annotate(Tool.Readonly, true);

const [proposal, , selection, scroll] = DeviceComparisonRecording.members;
const record = Tool.make("device_record_comparison", {
  ...options,
  description:
    "Record source taps and scrolls for a managed comparison. Propose with the exact open source and target hostId, deviceId and appId, plus optional total labels and currency. For first-difference evidence, copy evidenceDestination from the user's browser .tabs.json attachment. In older toolbar attachments, take tabId, profileId, pageRef and instanceId from target.resource. In older companion attachments, use target.tabId, target.profileId, pageRef and browserInstanceId as instanceId. Wait for Device panel approval. Inspect with runId for current source controls. Tap and expect use runId and an observed controlId. Scroll uses runId and direction up or down. After scrolling, inspect and use expect on a unique label that came into view. Mark an observable outcome after the final step, then finish. Ask the user to choose My turn for consequential actions or private input. Replay uses the approved pair and total settings.",
  // Provider tool descriptors need an object at the root. Decode each action against the shared contract.
  parameters: Schema.Struct({
    action: Schema.Literals(["propose", "inspect", "tap", "scroll", "expect", "finish"]),
    source: Schema.optional(proposal.fields.source),
    target: Schema.optional(proposal.fields.target),
    total: proposal.fields.total,
    evidenceDestination: proposal.fields.evidenceDestination,
    runId: Schema.optional(selection.fields.runId),
    controlId: Schema.optional(selection.fields.controlId),
    direction: Schema.optional(scroll.fields.direction),
  }),
  success: Schema.Struct({
    ...options.success.fields,
    controls: DeviceComparisonStatus.fields.controls,
  }),
}).annotate(Tool.Title, "Record device comparison");

const replay = Tool.make("device_replay_demonstration", {
  ...options,
  description:
    "Replay on the exact approved destination. Pass runId and approvalId from device_comparison_status. For a user demonstration, supply labels and currency to compare totals. Agent recordings use the approved settings. Replay pauses on a control mismatch, unexpected outcome or unverifiable total. Waits up to 30 seconds for a checkpoint and returns approvedEvidence when both frozen frames are ready and approved. If run.busy is true, call device_comparison_status with the same runId and waitForCheckpoint=true. The user corrects and resumes in the Device panel.",
  parameters: DeviceComparisonReplay,
  success: replayOutcome,
}).annotate(Tool.Destructive, true);

const stop = Tool.make("device_stop_comparison", {
  ...options,
  description:
    "Dismiss an approval request or stop managed recording or replay in the Device panel. Stops dispatching input and hands the device back after the current operation settles.",
  parameters: Schema.Struct({ runId: DeviceComparisonReplay.fields.runId }),
});

export const DeviceComparisonToolkit = Toolkit.make(status, record, replay, stop);

const context = Effect.gen(function* () {
  const { thread, capabilities } = yield* requireThreadMcpCapability("device").pipe(
    Effect.mapError(
      () =>
        new DeviceComparisonError({
          reason: "Agent device access is unavailable for this thread.",
        }),
    ),
  );
  const devices = yield* DeviceService;
  return { thread, threadId: thread.threadId, devices, preview: capabilities.has("preview") };
});

export const layer = DeviceComparisonToolkit.toLayer({
  device_comparison_status: ({ runId, waitForCheckpoint }) =>
    Effect.gen(function* () {
      const { devices, threadId, thread, preview } = yield* context;
      const { run, approvedEvidence } = yield* devices.comparison(
        {
          action: "status",
          threadId,
          ...(runId === undefined ? {} : { runId }),
          ...(waitForCheckpoint === undefined ? {} : { waitForCheckpoint }),
        },
        undefined,
        thread,
      );
      if (runId !== undefined && run?.runId !== runId) {
        return yield* new DeviceComparisonError({
          reason: "This comparison is no longer available in the thread.",
        });
      }
      return run
        ? { run, ...totalCheckNote(run), ...(preview && approvedEvidence && { approvedEvidence }) }
        : {};
    }),
  device_record_comparison: (input) =>
    Effect.gen(function* () {
      const { devices, thread, preview } = yield* context;
      const request = yield* Schema.decodeUnknownEffect(DeviceComparisonRecording, {
        onExcessProperty: "error",
      })(input).pipe(
        Effect.mapError(
          () =>
            new DeviceComparisonError({
              reason:
                "Propose with source and target. Inspect and finish require runId. Tap and expect require runId and controlId. Scroll requires runId and direction.",
            }),
        ),
      );
      if (request.action === "propose" && request.evidenceDestination && !preview)
        return yield* new DeviceComparisonError({
          reason: "Browser access is required to propose a first-difference evidence transfer.",
        });
      const { run, controls } = yield* devices.comparisonRecording(request, thread);
      return { ...(run && { run }), ...totalCheckNote(run), ...(controls && { controls }) };
    }),
  device_replay_demonstration: (input) =>
    Effect.gen(function* () {
      const { devices, threadId, thread, preview } = yield* context;
      yield* devices.comparison({ action: "replay", threadId, ...input }, undefined, thread);
      const { run, approvedEvidence } = yield* devices.comparison(
        { action: "status", threadId, runId: input.runId, waitForCheckpoint: true },
        undefined,
        thread,
      );
      if (run?.runId !== input.runId) {
        return yield* new DeviceComparisonError({
          reason: "This comparison is no longer available in the thread.",
        });
      }
      return {
        run,
        ...totalCheckNote(run),
        ...(preview && approvedEvidence && { approvedEvidence }),
      };
    }),
  device_stop_comparison: ({ runId }) =>
    Effect.gen(function* () {
      const { devices, threadId, thread } = yield* context;
      const { run } = yield* devices.comparison(
        { action: "stop", threadId, runId },
        undefined,
        thread,
      );
      return run ? { run } : {};
    }),
});
