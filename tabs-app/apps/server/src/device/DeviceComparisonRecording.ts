import { DeviceComparisonError, type DeviceComparisonScrollDirection } from "@tabs/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  isConsequentialDeviceAction,
  type DeviceObservation,
  type ObservedControl,
} from "./DeviceComparisonSemantics.ts";
import { systemDeviceSurface } from "./DeviceSemanticDriver.ts";
import {
  reject,
  statusPhase,
  type Target,
  type Phase,
  type Step,
  type Run,
  completeSourceStep,
} from "./DeviceComparisonRun.ts";
import { type ComparisonContext, type RunControl } from "./DeviceComparisonControl.ts";
import { type Persistence } from "./DeviceComparisonPersistence.ts";

export type Recording = ReturnType<typeof makeRecording>;

export function makeRecording(
  ctx: ComparisonContext,
  control: RunControl,
  persistence: Persistence,
) {
  const { deps } = ctx;
  const { guard, stop, frame, captureFrame } = control;
  const { persistReplayProgress } = persistence;
  const dispatchInput = <A>(
    run: Run,
    target: Target,
    phase: Phase,
    send: (
      guard: Effect.Effect<void, DeviceComparisonError>,
    ) => Effect.Effect<A, DeviceComparisonError>,
    {
      clearsBlocker = false,
      mode,
      replayScroll = false,
    }: {
      readonly clearsBlocker?: boolean;
      readonly mode?: Parameters<typeof guard>[3];
      readonly replayScroll?: boolean;
    } = {},
  ) =>
    Effect.gen(function* () {
      const previouslyApplied = run.applied;
      // Charge the attempt in the journal before sending, even if its receipt is lost.
      const scroll = replayScroll
        ? { attempts: (run.replayScroll?.attempts ?? 0) + 1, inFlight: true }
        : undefined;
      const check = guard(run, target, phase, mode);
      const commit = check.pipe(
        Effect.andThen(
          phase !== "recording"
            ? persistReplayProgress(run, target, undefined, {
                clearsBlocker,
                scroll,
              }).pipe(Effect.andThen(check))
            : Effect.void,
        ),
        Effect.tap(() =>
          Effect.sync(() => {
            run.uncertainPreviousApplied = previouslyApplied === "yes";
            run.uncertainClearsBlocker = clearsBlocker;
            if (scroll) run.replayScroll = scroll;
            run.applied = "unknown";
          }),
        ),
      );
      const receipt = yield* send(commit);
      if (scroll) run.replayScroll = { ...scroll, inFlight: false };
      run.applied = clearsBlocker || scroll ? previouslyApplied : "yes";
      delete run.uncertainPreviousApplied;
      delete run.uncertainClearsBlocker;
      return receipt;
    });

  const dispatchTap = (
    run: Run,
    target: Target,
    phase: Phase,
    ref: string,
    clearsBlocker = false,
    mode?: Parameters<typeof guard>[3],
  ) =>
    dispatchInput(run, target, phase, (commit) => deps.driver.press(target, ref, commit), {
      clearsBlocker,
      mode,
    });

  const onStepFailure = (run: Run, phase: Phase, cause: DeviceComparisonError) => {
    if (run.applied === "no") delete run.pendingSourceStep;
    if (phase === "recording" && !run.agentRecording && run.applied !== "no")
      stop(run, cause.reason);
    else run.pauseReason = cause.reason;
  };

  const recordTap = (
    run: Run,
    target: Target,
    phase: "recording" | "paused",
    select: (before: DeviceObservation) => ObservedControl | undefined,
    clearsBlocker: boolean,
  ) =>
    Effect.gen(function* () {
      const mode = phase === "paused" ? "panelCorrection" : "automation";
      const initial = yield* frame(run, target, phase, mode);
      const before =
        phase === "recording" ? yield* captureFrame(run, target, phase, initial) : initial;
      const current = select(before);
      if (!current) {
        if (!run.manualControl) run.observation = before;
        return yield* reject(
          "The selected control changed or is ambiguous. Refresh controls and choose again.",
        );
      }
      if (phase === "recording" && run.agentRecording && isConsequentialDeviceAction(current.label))
        return yield* reject("Choose My turn before using this control on the source.");
      const agentSource = phase === "recording" && run.agentRecording !== undefined;
      const action = { type: "tap", control: current } as const;
      if (agentSource) run.pendingSourceStep = { action, before };
      const receipt = yield* dispatchTap(run, target, phase, current.ref, clearsBlocker, mode);
      if (agentSource && receipt?.permissionDialog) return yield* systemDeviceSurface();
      const observationMode = agentSource ? "sourceObservation" : mode;
      const result = yield* frame(run, target, phase, observationMode);
      let after =
        phase === "recording"
          ? yield* captureFrame(run, target, phase, result, observationMode)
          : result;
      if (
        phase === "recording" &&
        !run.manualControl &&
        before.screenKey &&
        after.screenKey === before.screenKey
      ) {
        // A confirmed tap can return before the app exposes the next accessibility tree.
        const cancelled = Deferred.makeUnsafe<void>();
        run.observationCancellation = cancelled;
        const refreshed = yield* frame(run, target, phase, observationMode).pipe(
          Effect.timeoutOption("5 seconds"),
          Effect.flatMap((settled) =>
            Option.isSome(settled) &&
            settled.value.screenKey &&
            settled.value.screenKey !== before.screenKey
              ? captureFrame(run, target, phase, settled.value, observationMode)
              : Effect.succeed(undefined),
          ),
          Effect.interruptible,
          Effect.raceFirst(Deferred.await(cancelled).pipe(Effect.as(undefined))),
          Effect.ensuring(
            Effect.sync(() => {
              delete run.observationCancellation;
            }),
          ),
        );
        if (run.phase !== phase) return;
        yield* guard(run, target, phase, observationMode);
        if (refreshed) after = refreshed;
      }
      if (run.phase !== phase) return;
      if (!run.manualControl) run.observation = after;
      if (agentSource) completeSourceStep(run, after);
      else if (phase === "recording") {
        run.steps.push({ action, before, after });
        run.applied = "no";
      }
      delete run.pauseReason;
    });

  const recordScroll = (
    run: Run,
    direction: DeviceComparisonScrollDirection,
    pending: Step | undefined,
  ) =>
    Effect.gen(function* () {
      const target = run.source;
      const initial = yield* frame(run, target, "recording");
      const before = yield* captureFrame(run, target, "recording", initial);
      if (!before.screenKey) return yield* reject("Check that the recording app is observable.");
      run.pendingSourceStep = {
        action: { type: "scroll", direction },
        before,
        ...(pending && { extendScroll: pending }),
      };
      yield* dispatchInput(run, target, "recording", (commit) =>
        deps.driver.scroll(target, direction, commit),
      );
      const mode = run.agentRecording ? "sourceObservation" : undefined;
      const result = yield* frame(run, target, "recording", mode);
      const after = yield* captureFrame(run, target, "recording", result, mode);
      if (statusPhase(run) !== "recording") return;
      if (!run.manualControl) run.observation = after;
      const reason = completeSourceStep(run, after);
      if (reason) return yield* reject(reason);
      delete run.pauseReason;
    });

  return {
    dispatchInput,
    dispatchTap,
    onStepFailure,
    recordTap,
    recordScroll,
  };
}
