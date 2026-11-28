import {
  type AuthSessionId,
  type DeviceComparisonFrame,
  type DeviceComparisonReport,
  type DeviceComparisonStatus,
  type DeviceComparisonTarget,
  type DeviceServiceState,
  type ThreadId,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import { exposedControl, isConsequentialDeviceAction } from "./DeviceComparisonSemantics.ts";
import { isLiveDeviceAttachment } from "./AgentDeviceControl.ts";
import { deviceKey as key, sameCaller } from "./DeviceIdentity.ts";
import { type McpThreadCaller } from "../mcp/McpInvocationContext.ts";
import {
  sourceTapObservation,
  canRestore,
  totalCheckFor,
  reportFor,
  type Run,
} from "./DeviceComparisonRun.ts";
import { type ComparisonContext, type RunControl } from "./DeviceComparisonControl.ts";

export function makeStatusReader(ctx: ComparisonContext, control: RunControl) {
  const { runs, owners, agent, providerActive, deps } = ctx;
  const { savedAccessAllowed } = control;
  const status = (
    threadId: ThreadId,
    device?: DeviceComparisonTarget,
    includeControls = false,
    sessionId?: AuthSessionId,
  ): DeviceComparisonStatus => {
    const run = runs.get(threadId);
    const owner = device === undefined ? undefined : owners.get(key(device))?.target.threadId;
    const agentControl =
      device === undefined ? undefined : agent.status(device, threadId, sessionId);
    const manualTarget =
      run?.phase === "recording" && run.agentRecording && !run.busy
        ? run.source
        : run?.phase === "paused" && !run.playing
          ? run.target
          : undefined;
    const manualControl =
      device &&
      manualTarget &&
      key(device) === key(manualTarget) &&
      owner === threadId &&
      run?.manualControl?.sessionId === sessionId
        ? run?.manualControl
        : undefined;
    const returned = run?.replayReturn;
    const sourceTapId = sourceTapObservation(run, device, sessionId)?.sourceTap?.id;
    const pendingReplayReturn =
      device &&
      run?.target &&
      key(device) === key(run.target) &&
      returned &&
      returned.sessionId === sessionId &&
      !returned.queued &&
      !returned.queueing
        ? {
            controlId: returned.controlId,
            stepCompleted: returned.stepCompleted,
          }
        : undefined;
    return {
      ...(owner === undefined ? {} : { ownerThreadId: owner }),
      ...(manualControl ? { manualControlId: manualControl.id } : {}),
      ...(sourceTapId ? { sourceTapId } : {}),
      ...(pendingReplayReturn ? { pendingReplayReturn } : {}),
      ...(agentControl === undefined ? {} : { agentControl }),
      ...(run === undefined
        ? {}
        : {
            run: reportFor(run),
            ...(totalCheckFor(run) && { totalCheck: totalCheckFor(run) }),
            ...(includeControls &&
            run.observation &&
            !run.manualControl &&
            (run.phase === "recording" || run.phase === "paused")
              ? {
                  controls: run.observation.controls.map((control) => {
                    const exposed = exposedControl(control);
                    return run.agentRecording &&
                      run.phase === "recording" &&
                      isConsequentialDeviceAction(exposed.label)
                      ? { ...exposed, canTap: false }
                      : exposed;
                  }),
                }
              : {}),
          }),
    };
  };

  const transferableEvidence = (
    state: DeviceServiceState,
    run: Run | undefined,
    caller: McpThreadCaller | undefined,
  ) => {
    if (!caller || !run?.agentRecording || !run.approvedEvidence || !run.target) return;
    if (
      runs.get(caller.threadId) !== run ||
      run.phase === "stopped" ||
      !sameCaller(run.agentRecording.caller, caller) ||
      !providerActive(caller) ||
      !savedAccessAllowed(state) ||
      !isLiveDeviceAttachment(state, run.source.attachment) ||
      !isLiveDeviceAttachment(state, run.target.attachment)
    )
      return;
    const step = run.difference?.step;
    if (
      step === undefined ||
      step < 1 ||
      step > run.steps.length ||
      !run.evidence?.sourcePng ||
      !run.evidence.targetPng
    )
      return;
    return { approvedEvidence: run.approvedEvidence, evidence: run.evidence };
  };

  const approvedScreenshotIsCurrent = (
    state: DeviceServiceState,
    caller: McpThreadCaller,
    input: {
      readonly frame: DeviceComparisonFrame;
      readonly hostId: string;
      readonly deviceId: string;
      readonly tabId: string;
      readonly grantId: string;
    },
  ) => {
    const run = runs.get(caller.threadId);
    const approved = transferableEvidence(state, run, caller)?.approvedEvidence;
    const { frame } = input;
    const device = run?.[frame.side];
    return (
      approved?.tabId === input.tabId &&
      approved.grantIds[frame.side === "source" ? 0 : 1] === input.grantId &&
      run?.id === frame.runId &&
      run.difference?.step === frame.step &&
      device?.hostId === input.hostId &&
      device.deviceId === input.deviceId
    );
  };

  const savedStatus = (
    threadId: ThreadId,
    report: DeviceComparisonReport | undefined,
    user: boolean,
    runId?: string,
  ): Effect.Effect<DeviceComparisonStatus> =>
    Effect.gen(function* () {
      const fallback = report ? { run: report } : {};
      if (!user || !deps.store || (runId && report?.phase === "completed")) return fallback;
      const loadReplay = (id?: string) =>
        deps.store!.loadReplay(threadId, id).pipe(Effect.catch(() => Effect.succeed(undefined)));
      const active = yield* loadReplay(runId);
      const replay =
        active ??
        (runId === undefined && report?.phase === "stopped"
          ? yield* loadReplay(report.runId)
          : undefined);
      if (!runId && replay?.report && replay.report.runId !== report?.runId) {
        // The result can be committed before the thread's latest pointer is updated.
        const exact = yield* deps.store
          .load(threadId, replay.report.runId)
          .pipe(Effect.catch(() => Effect.succeed(undefined)));
        if (exact?.report.phase === "completed") return { run: exact.report };
      }
      const selected =
        replay?.report && (!report?.savedAt || replay.report.runId !== report.runId)
          ? replay.report
          : report;
      if (
        !selected ||
        !replay ||
        selected.phase !== "stopped" ||
        !canRestore(runs.get(threadId), selected.runId)
      )
        return fallback;
      return {
        run: {
          ...selected,
          completedSteps: replay.checkpoint.index,
          uncertainTap: replay.checkpoint.applied === "unknown",
        },
        canRestoreReplay: true as const,
      };
    });

  return {
    status,
    transferableEvidence,
    approvedScreenshotIsCurrent,
    savedStatus,
  };
}
