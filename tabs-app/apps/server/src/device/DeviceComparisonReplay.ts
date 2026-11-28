import {
  type DeviceComparisonDifference,
  type DeviceComparisonScrollDirection,
} from "@tabs/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import {
  comparisonScreenKey,
  cropComparisonScreenshot,
  isConsequentialDeviceAction,
  matchControl,
  matchReplayControl,
  normalizeLabel,
  needsPrivateDeviceInput,
  observeTotal,
  type DeviceObservation,
  type ObservedControl,
} from "./DeviceComparisonSemantics.ts";
import {
  androidPermissionEvidenceBounds,
  isDeviceSystemSurface,
  systemDeviceSurfaceReason,
} from "./DeviceSemanticDriver.ts";
import { MAX_REPLAY_SCROLLS } from "./DeviceComparisonStore.ts";
import {
  reject,
  statusPhase,
  visibleLabelCount,
  type Target,
  type TotalCheckpoint,
  type Run,
  pauseReplay,
} from "./DeviceComparisonRun.ts";
import { sourceAmount, verifyTotalAt } from "./DeviceComparisonTotals.ts";
import { type ComparisonContext, type RunControl } from "./DeviceComparisonControl.ts";
import { type Persistence } from "./DeviceComparisonPersistence.ts";
import { type Recording } from "./DeviceComparisonRecording.ts";

export function makeReplay(
  ctx: ComparisonContext,
  control: RunControl,
  persistence: Persistence,
  recording: Recording,
) {
  const { deps, runs } = ctx;
  const { guard, replayWriteGuard, frame, captureFrame } = control;
  const { persistReplaySourceFrames, persistReplayProgress, persistResult } = persistence;
  const { dispatchInput, dispatchTap } = recording;
  const capturePermissionEvidence = (run: Run, target: Target, step: number) =>
    Effect.gen(function* () {
      const check = guard(run, target, "running").pipe(
        Effect.andThen(
          Effect.suspend(() =>
            runs.get(target.threadId) === run && run.target === target && run.index === step
              ? Effect.void
              : reject("The approved replay step changed before permission evidence was read."),
          ),
        ),
      );
      const read = check.pipe(
        Effect.andThen(
          Effect.suspend(() => deps.driver.snapshot(target, check, "permissionEvidence")),
        ),
        Effect.tap(() => check),
      );
      let before = yield* read;
      // A confirmed press can report the dialog one accessibility snapshot before it appears.
      if (
        run.needsPermissionHandoff &&
        before.appBundleId === target.appId &&
        !isDeviceSystemSurface(before) &&
        comparisonScreenKey(before) &&
        !needsPrivateDeviceInput(before)
      ) {
        yield* Effect.sleep(100);
        before = yield* read;
      }
      const bounds = androidPermissionEvidenceBounds(before, target);
      const screenKey = comparisonScreenKey(before);
      if (!bounds || !screenKey || needsPrivateDeviceInput(before)) return undefined;
      yield* check;
      const bytes = yield* deps.screenshot(target, check);
      if (!bytes) return undefined;
      const after = yield* read;
      if (
        screenKey !== comparisonScreenKey(after) ||
        !androidPermissionEvidenceBounds(after, target)
      )
        return undefined;
      return cropComparisonScreenshot(bytes, bounds);
    }).pipe(
      Effect.timeout(5_000),
      Effect.orElseSucceed(() => undefined),
      Effect.interruptible,
    );

  const pause = (
    run: Run,
    target: Target,
    sourceTiming: TotalCheckpoint["timing"],
    targetFrame: DeviceObservation | undefined,
    difference: Omit<DeviceComparisonDifference, "step">,
  ) =>
    Effect.gen(function* () {
      if (run.phase !== "running") return;
      const cancelled = Deferred.makeUnsafe<void>();
      const cancellation = Deferred.await(cancelled).pipe(Effect.as(undefined));
      if (!run.difference) run.observationCancellation = cancelled;
      const current = replayWriteGuard(run, target);
      const canFreezeTarget = () =>
        statusPhase(run) === "paused" &&
        !run.manualControl &&
        current() &&
        !Deferred.isDoneUnsafe(cancelled);
      let permissionPng: string | undefined;
      if (
        !run.difference &&
        !targetFrame &&
        target.platform === "android" &&
        difference.kind === "driver" &&
        difference.reason === systemDeviceSurfaceReason
      ) {
        // Keep My turn available while replay waits on this cancellable read.
        permissionPng = yield* capturePermissionEvidence(run, target, run.index).pipe(
          Effect.raceFirst(cancellation),
        );
        if (statusPhase(run) === "stopped") return;
        if (statusPhase(run) !== "running") permissionPng = undefined;
      }
      run.phase = "paused";
      run.pauseReason = difference.reason;
      const saveProgress = (saveEvidence: boolean) =>
        (saveEvidence ? Effect.asVoid(persistResult(run, target, "stopped")) : Effect.void).pipe(
          Effect.andThen(
            Effect.suspend(() => persistReplayProgress(run, target, run.observation?.screenKey)),
          ),
          Effect.catch((cause) =>
            Effect.sync(() => {
              if (run.phase === "paused") run.pauseReason = `${difference.reason} ${cause.reason}`;
            }),
          ),
        );
      if (targetFrame) run.observation = targetFrame;
      else delete run.observation;
      if (run.difference) return yield* saveProgress(false);
      run.difference = { step: run.index + 1, ...difference };
      let sourcePng = run.steps[run.index]?.[sourceTiming].png;
      if (sourcePng === undefined && run.restoredSessionId && deps.store) {
        sourcePng = yield* deps.store
          .loadReplaySourceFrame(target.threadId, run.id, run.index, sourceTiming)
          .pipe(
            Effect.catch((cause) => Effect.logWarning(cause.reason).pipe(Effect.as(undefined))),
          );
        if (!current()) return;
      }
      run.evidence = sourcePng === undefined ? {} : { sourcePng };
      let targetPng = permissionPng;
      if (targetFrame && canFreezeTarget()) {
        const captured = yield* captureFrame(run, target, "paused", targetFrame).pipe(
          Effect.orElseSucceed(() => undefined),
          Effect.interruptible,
          Effect.raceFirst(cancellation),
        );
        if (canFreezeTarget()) {
          if (!captured) delete run.observation;
          else run.observation = captured;
        }
        targetPng = captured?.png;
      }
      // Publication freezes the authorized bytes synchronously, before the store can yield.
      if (targetPng && canFreezeTarget()) run.evidence = { ...run.evidence, targetPng };
      yield* saveProgress(true);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          delete run.observationCancellation;
        }),
      ),
    );

  const replayScroll = (
    run: Run,
    target: Target,
    direction: DeviceComparisonScrollDirection,
    expected: ObservedControl,
    before: DeviceObservation,
  ) =>
    Effect.gen(function* () {
      let current = before;
      for (let pass = run.replayScroll?.attempts ?? 0; pass < MAX_REPLAY_SCROLLS; pass++) {
        if (statusPhase(run) !== "running" || visibleLabelCount(current, expected.label) > 0) break;
        yield* dispatchInput(
          run,
          target,
          "running",
          (commit) => deps.driver.scroll(target, direction, commit),
          { replayScroll: true },
        );
        if (statusPhase(run) !== "running") break;
        const next = yield* frame(run, target, "running");
        if (!next.screenKey || next.screenKey === current.screenKey) return next;
        current = next;
      }
      return current;
    });

  const replaySteps = (run: Run, target: Target) =>
    Effect.gen(function* () {
      yield* persistReplaySourceFrames(run, target);
      let justOpened = !run.opened;
      if (justOpened) {
        yield* deps.driver.open(target, guard(run, target, "running"));
        run.opened = true;
      }
      if (run.restoredScreenKey) {
        const restoredScreenKey = run.restoredScreenKey;
        const current = yield* frame(run, target, "running").pipe(
          Effect.catch((cause) => Effect.sync(() => pauseReplay(run, cause.reason))),
        );
        if (!current || statusPhase(run) !== "running") return;
        delete run.restoredScreenKey;
        if (current.screenKey !== restoredScreenKey) {
          run.uncertainPreviousApplied = run.applied === "yes";
          run.applied = "unknown";
          pauseReplay(
            run,
            "The screen changed after restoration. Check whether the interrupted step took effect.",
          );
          run.observation = current;
          yield* persistReplayProgress(run, target, current.screenKey);
          return;
        }
      }
      while (run.phase === "running" && run.index < run.steps.length) {
        const step = run.steps[run.index]!;
        const action = step.action;
        let after: DeviceObservation | undefined;
        if (run.applied !== "yes" || run.total?.pending?.timing === "before") {
          let before = yield* frame(run, target, "running");
          if (statusPhase(run) !== "running") return;
          const total = run.total?.settings;
          if (
            justOpened &&
            (before.controls.length === 0 ||
              (total &&
                sourceAmount(step, "before", total) &&
                observeTotal(before, total.targetLabel, total.currency) === undefined))
          ) {
            // The app can expose its outer UI before the checkout controls and total.
            yield* Effect.sleep(100);
            if (statusPhase(run) !== "running") return;
            before = yield* frame(run, target, "running");
          }
          justOpened = false;
          if (statusPhase(run) !== "running") return;
          const atScrollResult =
            action.type === "scroll" &&
            step.expected &&
            visibleLabelCount(before, step.expected.label) === 1;
          // The first committed swipe already passed the pre-scroll total check.
          if (run.total?.pending?.timing === "before" || (!atScrollResult && !run.replayScroll)) {
            const difference = verifyTotalAt(run, step, "before", before);
            if (difference) return yield* pause(run, target, "before", before, difference);
          }
          if (atScrollResult) after = before;
          else if (run.applied !== "yes" && action.type === "scroll") {
            if (!step.expected) return yield* reject("The scroll has no recorded expected result.");
            after = yield* replayScroll(run, target, action.direction, step.expected, before);
            if (statusPhase(run) !== "running") return;
            if (run.replayScroll) run.applied = "yes";
          }
          if (run.applied !== "yes" && action.type === "tap") {
            const match = matchReplayControl(action.control, step.before, before);
            if ("reason" in match)
              return yield* pause(run, target, "before", before, {
                kind: "control",
                reason: match.reason,
              });
            // A consequential destination control pauses unless the user recorded a consequential
            // source step for it and approved this recording. Restored runs are always reviewed.
            if (
              isConsequentialDeviceAction(match.control.label) &&
              (run.requireConsequentialReview ||
                !isConsequentialDeviceAction(action.control.label) ||
                run.approvalId === undefined)
            )
              return yield* pause(run, target, "before", before, {
                kind: "control",
                reason: `Choose My turn to review “${match.control.label}” on the destination.`,
              });
            const receipt = yield* dispatchTap(run, target, "running", match.control.ref);
            if (receipt?.permissionDialog && statusPhase(run) === "running") {
              run.needsPermissionHandoff = true;
              return yield* pause(run, target, "after", undefined, {
                kind: "driver",
                reason: systemDeviceSurfaceReason,
              });
            }
          }
        }
        if (statusPhase(run) !== "running") return;
        after ??= yield* frame(run, target, "running");
        if (statusPhase(run) !== "running") return;
        const difference = verifyTotalAt(run, step, "after", after);
        if (difference) return yield* pause(run, target, "after", after, difference);
        const expected = step.expected;
        if (expected) {
          const matches = after.controls.filter(
            (item) => normalizeLabel(item.label) === normalizeLabel(expected.label),
          );
          if (
            matches.length !== 1 &&
            (action.type === "scroll" || !matchControl(expected, matches))
          )
            return yield* pause(run, target, "after", after, {
              kind: "outcome",
              reason: `The destination did not show a unique “${expected.label}” after the ${action.type}.`,
            });
        }
        run.index += 1;
        run.applied = "no";
        delete run.replayScroll;
        yield* persistReplayProgress(run, target, after.screenKey);
      }
      if (statusPhase(run) === "running") {
        run.phase = "completed";
        delete run.observation;
        yield* persistResult(run, target, "completed").pipe(
          Effect.flatMap((saved) =>
            saved && deps.store ? deps.store.clearReplay(target.threadId, run.id) : Effect.void,
          ),
          Effect.catch((cause) => Effect.logWarning(cause.reason)),
        );
      }
    }).pipe(
      Effect.catch((cause) => {
        if (run.phase === "running" && run.applied === "unknown" && !run.difference) {
          pauseReplay(run, cause.reason);
          return Effect.void;
        }
        return pause(
          run,
          target,
          (run.applied === "yes" || run.replayScroll) && run.total?.pending?.timing !== "before"
            ? "after"
            : "before",
          undefined,
          {
            kind: "driver",
            reason: cause.reason,
          },
        );
      }),
    );

  return { replaySteps };
}
