import * as Effect from "effect/Effect";
import {
  reject,
  savedControl,
  reportFor,
  type Target,
  type Run,
  pauseReplay,
} from "./DeviceComparisonRun.ts";
import { sourceAmount } from "./DeviceComparisonTotals.ts";
import { type ComparisonContext, type RunControl } from "./DeviceComparisonControl.ts";

export type Persistence = ReturnType<typeof makePersistence>;

export function makePersistence(ctx: ComparisonContext, control: RunControl) {
  const { deps, runs, access } = ctx;
  const { guard, replayWriteGuard } = control;
  const persistReplaySourceFrames = (run: Run, target: Target) =>
    Effect.gen(function* () {
      if (!deps.store || run.sourceFramesStored || run.restoredSessionId) return;
      const check = guard(run, target, "running");
      yield* check;
      const saved = yield* deps.store.saveReplaySourceFrames(
        target.threadId,
        run.id,
        run.steps.map((step) => ({
          ...(step.before.png !== undefined && { before: step.before.png }),
          ...(step.after.png !== undefined && { after: step.after.png }),
        })),
        replayWriteGuard(run, target),
      );
      if (!saved) return yield* reject("Device control changed before saving the source frames.");
      run.sourceFramesStored = true;
      yield* check;
    }).pipe(Effect.tapError((cause) => Effect.sync(() => pauseReplay(run, cause.reason))));

  const persistReplayProgress = (
    run: Run,
    target: Target,
    screenKey: string | undefined,
    dispatching?: {
      readonly clearsBlocker: boolean;
      readonly scroll?: Run["replayScroll"];
    },
  ) =>
    Effect.gen(function* () {
      if (!deps.store || run.index >= run.steps.length) return;
      const current = replayWriteGuard(run, target);
      const scroll = dispatching?.scroll ?? run.replayScroll;
      const {
        approvalId: _approval,
        pauseReason: _pauseReason,
        agentRecording: _agentRecording,
        firstDifference: _difference,
        availableEvidence: _evidence,
        ...report
      } = reportFor(run, false);
      const saved = yield* deps.store.saveReplay(
        target.threadId,
        {
          ...report,
          phase: "stopped",
          busy: false,
          playing: false,
          canResume: false,
          uncertainTap: !!dispatching || run.applied === "unknown",
          savedAt: new Date().toISOString(),
        },
        {
          version: 1,
          index: run.index,
          applied: dispatching ? "unknown" : run.applied,
          previouslyApplied: run.applied === "yes" || run.uncertainPreviousApplied === true,
          clearsBlocker: dispatching?.clearsBlocker ?? run.uncertainClearsBlocker === true,
          ...(scroll && { scroll }),
          ...(screenKey && { screenKey }),
          requireConsequentialReview:
            !!run.agentRecording || run.requireConsequentialReview === true,
          steps: run.steps.map((step) => {
            const { action, expected } = step;
            const identifier = action.type === "tap" ? action.control.identifier : undefined;
            const beforeTotal = run.total && sourceAmount(step, "before", run.total.settings);
            const afterTotal = run.total && sourceAmount(step, "after", run.total.settings);
            return {
              action:
                action.type === "scroll"
                  ? action
                  : {
                      type: "tap",
                      control: savedControl(action.control),
                      ...(identifier && step.before.identifierCounts.get(identifier) === 1
                        ? { uniqueIdentifier: identifier }
                        : {}),
                    },
              ...(expected && { expected: savedControl(expected) }),
              ...(beforeTotal && { beforeTotal }),
              ...(afterTotal && { afterTotal }),
            };
          }),
          ...(run.total && { total: run.total }),
        },
        current,
      );
      if (!saved) return yield* reject("Device control changed before saving replay progress.");
    }).pipe(Effect.tapError((cause) => Effect.sync(() => pauseReplay(run, cause.reason))));

  const persistResult = (run: Run, target: Target, phase: "stopped" | "completed") => {
    if (!deps.store) return Effect.succeed(false);
    const evidence = run.evidence;
    const { approvalId: _approval, pauseReason: _pauseReason, ...report } = reportFor(run, false);
    const epoch = access.epoch;
    return deps.store.save(
      target.threadId,
      {
        ...report,
        phase,
        busy: false,
        playing: false,
        canResume: false,
        savedAt: new Date().toISOString(),
      },
      evidence ?? {},
      () =>
        epoch === access.epoch &&
        !access.blocked &&
        runs.get(target.threadId) === run &&
        run.evidence === evidence &&
        (phase !== "completed" || run.phase === phase),
    );
  };

  return { persistReplaySourceFrames, persistReplayProgress, persistResult };
}
