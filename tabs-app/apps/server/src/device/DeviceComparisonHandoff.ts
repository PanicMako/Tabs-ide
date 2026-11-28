import { type DeviceComparisonInput } from "@tabs/contracts";
import { randomUUID } from "node:crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { observeTotal } from "./DeviceComparisonSemantics.ts";
import { systemDeviceSurface } from "./DeviceSemanticDriver.ts";
import { isLiveDeviceAttachment } from "./AgentDeviceControl.ts";
import { deviceKey as key } from "./DeviceIdentity.ts";
import {
  reject,
  active,
  statusPhase,
  type Run,
  cancelObservation,
  completeSourceStep,
} from "./DeviceComparisonRun.ts";
import { sameTotal } from "./DeviceComparisonTotals.ts";
import { type ComparisonContext, type RunControl } from "./DeviceComparisonControl.ts";
import { type Persistence } from "./DeviceComparisonPersistence.ts";
import { makeReplay } from "./DeviceComparisonReplay.ts";
import { makeStatusReader } from "./DeviceComparisonStatus.ts";
import { type ActionArgs } from "./DeviceComparisonActions.ts";

export function makeHandoff(
  ctx: ComparisonContext,
  control: RunControl,
  persistence: Persistence,
  replaySteps: ReturnType<typeof makeReplay>["replaySteps"],
  status: ReturnType<typeof makeStatusReader>["status"],
) {
  const { deps, runs } = ctx;
  const {
    release,
    stop,
    claim,
    guard,
    frame,
    captureFrame,
    launch,
    authorizeCaller,
    queueReplayReturn,
  } = control;
  const { persistReplayProgress } = persistence;
  const takeover = (args: ActionArgs<Extract<DeviceComparisonInput, { action: "takeover" }>>) =>
    Effect.gen(function* () {
      const { input, run, sessionId, caller, agentSource } = args;
      const { threadId } = input;
      if (agentSource) {
        if (
          caller ||
          !sessionId ||
          !deps.manualInput ||
          input.liveInput !== true ||
          !input.device ||
          key(input.device) !== key(run.source)
        )
          return yield* reject("Choose My turn on the source device’s live screen.");
        if (run.manualControl && run.manualControl.sessionId !== sessionId)
          return yield* reject("The device screen is controlled by another Tabs session.");
        run.manualControl ??= { id: randomUUID(), sessionId };
        delete run.observation;
        cancelObservation(run);
        return status(threadId, run.source, false, sessionId);
      }
      if (input.device && (!run.target || key(input.device) !== key(run.target)))
        return yield* reject("Choose the approved destination to take over replay.");
      const liveInput = input.liveInput === true && run.target && deps.manualInput && sessionId;
      if (run.phase === "running") {
        run.phase = "paused";
        run.pauseReason = "Replay paused. Choose a correction or resume.";
      } else if (run.phase !== "paused" || !liveInput) {
        return yield* reject("Replay is already paused or has ended.");
      }
      if (run.manualControl && run.manualControl.sessionId !== sessionId)
        return yield* reject("The device screen is controlled by another Tabs session.");
      if (!run.manualControl) {
        delete run.replayReturn;
        if (liveInput) {
          delete run.restoredScreenKey;
          run.manualControl = { id: randomUUID(), sessionId: liveInput };
        }
      }
      delete run.observation;
      cancelObservation(run);
      return status(threadId);
    });

  const manualInput = (
    args: ActionArgs<Extract<DeviceComparisonInput, { action: "manualInput" }>>,
  ) =>
    Effect.gen(function* () {
      const { input, run, sessionId, agentSource } = args;
      const { threadId } = input;
      const target = agentSource ? run.source : run.target;
      const phase = agentSource ? "recording" : "paused";
      const control = run.manualControl;
      const send = deps.manualInput;
      if (
        run.phase !== phase ||
        !target ||
        !send ||
        !control ||
        control.id !== input.controlId ||
        control.sessionId !== sessionId ||
        run.applied === "unknown"
      )
        return yield* reject("Take control of this device before using its live screen.");
      const previous = run.applied;
      let dispatched = false;
      const check = guard(run, target, phase, "human");
      const commit = check.pipe(
        Effect.andThen(
          phase === "paused"
            ? persistReplayProgress(run, target, undefined, {
                clearsBlocker: false,
              }).pipe(Effect.andThen(check))
            : Effect.void,
        ),
        Effect.tap(() =>
          Effect.sync(() => {
            dispatched = true;
          }),
        ),
      );
      // Hold the device even if the client disconnects while awaiting confirmation.
      yield* Effect.gen(function* () {
        run.busy = true;
        yield* send(target, input.gesture, commit).pipe(
          Effect.tapError(() =>
            Effect.sync(() => {
              if (dispatched && statusPhase(run) === "paused") {
                run.applied = "unknown";
                run.uncertainPreviousApplied = previous === "yes";
              }
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              run.busy = false;
              if (!active(run)) release(run);
            }),
          ),
        );
      }).pipe(Effect.uninterruptible);
      return status(threadId);
    });

  const startReplay = (args: ActionArgs<Extract<DeviceComparisonInput, { action: "replay" }>>) =>
    Effect.gen(function* () {
      const { input, run, state, sessionId, caller } = args;
      const { threadId } = input;
      const target = run.target;
      // A retry after a lost reply must see the replay it already started, not a stale error.
      if (
        target &&
        run.approvalId !== undefined &&
        run.approvalId === input.approvalId &&
        input.runId === run.id &&
        (run.phase === "running" || run.phase === "paused" || run.phase === "completed")
      )
        return status(threadId);
      if (run.phase !== "ready" || !target)
        return yield* reject("Ask the user to approve a destination in the Device panel.");
      if (run.approvalId !== input.approvalId)
        return yield* reject("The approved destination changed. Read the comparison status again.");
      if (!isLiveDeviceAttachment(state, target.attachment))
        return yield* reject("The approved destination session changed. Approve the device again.");
      if (run.agentRecording) {
        if (!caller && !sessionId)
          return yield* reject(
            "Replay this comparison from its original agent session or the Device panel.",
          );
        yield* authorizeCaller(run.agentRecording.caller, run);
        if (input.total && !sameTotal(run.agentRecording.total, input.total))
          return yield* reject("Replay uses the total settings approved with this recording.");
      }
      const total = run.agentRecording ? run.agentRecording.total : input.total;
      let totalVerification: Run["total"];
      if (total) {
        const checkpoints = run.steps.flatMap((step, index) =>
          (["before", "after"] as const).map((timing) => ({
            step: index + 1,
            timing,
            amount: observeTotal(step[timing], total.sourceLabel, total.currency),
          })),
        );
        const first = checkpoints.find(({ amount }) => amount);
        if (!first || checkpoints.some(({ amount }) => amount === null)) {
          return yield* reject(
            "The source demonstration never showed one readable total with the supplied label and currency, or showed an ambiguous amount at a checkpoint.",
          );
        }
        totalVerification = {
          settings: total,
          startsAt: { step: first.step, timing: first.timing },
        };
      }
      if (!claim(run, target))
        return yield* reject("The destination is busy or owned by another comparison.");
      if (totalVerification) run.total = totalVerification;
      run.phase = "running";
      yield* launch(run, replaySteps(run, target), true, (cause) => stop(run, cause.reason));
      return status(threadId);
    });

  const resumeSource = (
    args: ActionArgs<Extract<DeviceComparisonInput, { action: "resume" | "resolve" }>>,
  ) =>
    Effect.gen(function* () {
      const { input, run, sessionId } = args;
      const { action } = input;
      const { threadId } = input;
      const control = run.manualControl;
      if (!control || control.sessionId !== sessionId || control.id !== input.controlId)
        return yield* reject("Return control from the Tabs session that took over the device.");
      if (action === "resolve") {
        if (!run.pendingSourceStep || run.applied !== "unknown")
          return yield* reject("There is no uncertain source action to resolve.");
        run.applied = input.applied ? "yes" : "no";
        if (!input.applied) delete run.pendingSourceStep;
        delete run.uncertainPreviousApplied;
        delete run.uncertainClearsBlocker;
        return status(threadId, run.source, false, sessionId);
      }
      if (run.applied === "unknown")
        return yield* reject(
          `Inspect the device and confirm whether the last ${run.pendingSourceStep?.action.type ?? "action"} took effect.`,
        );
      yield* launch(
        run,
        Effect.gen(function* () {
          if (!run.sourceOpened) {
            yield* deps.driver.open(
              run.source,
              guard(run, run.source, "recording", "sourceObservation"),
            );
            run.sourceOpened = true;
          }
          const observed = yield* frame(run, run.source, "recording", "sourceObservation");
          if (run.phase !== "recording") return;
          const after = run.pendingSourceStep
            ? yield* captureFrame(run, run.source, "recording", observed, "sourceObservation")
            : observed;
          if (run.phase !== "recording") return;
          const reason = completeSourceStep(run, after);
          run.observation = after;
          delete run.manualControl;
          if (reason) run.pauseReason = reason;
          else delete run.pauseReason;
        }),
        false,
        (cause) => {
          run.pauseReason = cause.reason;
        },
      );
      if (run.settled) yield* Deferred.await(run.settled);
      return status(threadId, run.source, false, sessionId);
    });

  const resumeReplay = (
    args: ActionArgs<Extract<DeviceComparisonInput, { action: "resume" | "resolve" }>>,
  ) =>
    Effect.gen(function* () {
      const { input, run, sessionId, caller, dispatchReturn } = args;
      const { action } = input;
      const { threadId } = input;
      const target = run.target;
      const control = run.manualControl;
      if (run.phase !== "paused" || !target) return yield* reject("Replay is not paused.");
      if (control && control.sessionId !== sessionId)
        return yield* reject("Return control from the Tabs session that took over the device.");
      if (input.controlId !== control?.id)
        return yield* reject("The screen handoff changed. Reopen the current comparison.");
      if (action === "resolve") {
        if (run.applied !== "unknown")
          return yield* reject("There is no uncertain action to resolve.");
        if (run.replayScroll?.inFlight) {
          run.replayScroll = { ...run.replayScroll, inFlight: false };
          run.applied = "no";
        } else {
          run.applied =
            (input.applied && !run.uncertainClearsBlocker) || run.uncertainPreviousApplied
              ? "yes"
              : "no";
        }
        delete run.uncertainPreviousApplied;
        delete run.uncertainClearsBlocker;
        return status(threadId);
      }
      if (run.agentRecording) yield* authorizeCaller(run.agentRecording.caller, run);
      return yield* Effect.gen(function* () {
        if (
          runs.get(threadId) !== run ||
          run.phase !== "paused" ||
          run.manualControl !== control ||
          run.busy
        )
          return yield* reject("The screen handoff changed. Reopen the current comparison.");
        if (run.applied === "unknown")
          return yield* reject(
            "Inspect the device and confirm whether the last action took effect.",
          );
        if (run.needsPermissionHandoff && !control)
          return yield* reject(systemDeviceSurface().reason);
        if (input.stepCompleted && !control)
          return yield* reject("Use the live device controls first.");
        const returned =
          !caller && run.agentRecording && dispatchReturn && control
            ? {
                controlId: control.id,
                sessionId: control.sessionId,
                stepCompleted: input.stepCompleted === true,
                queued: false,
                queueing: false,
              }
            : undefined;
        if (returned) run.replayReturn = returned;
        if (input.stepCompleted) run.applied = "yes";
        delete run.manualControl;
        delete run.needsPermissionHandoff;
        run.phase = "running";
        delete run.pauseReason;
        yield* launch(run, replaySteps(run, target), true, (cause) => stop(run, cause.reason));
        if (returned && dispatchReturn)
          yield* queueReplayReturn(run, target, returned, dispatchReturn);
        return status(threadId);
      }).pipe(Effect.uninterruptible);
    });

  return { takeover, manualInput, startReplay, resumeSource, resumeReplay };
}
