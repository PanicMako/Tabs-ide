import { type DeviceComparisonInput } from "@tabs/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { isLiveDeviceAttachment } from "./AgentDeviceControl.ts";
import { deviceKey as key } from "./DeviceIdentity.ts";
import {
  reject,
  canRestore,
  restoreSteps,
  resolveTarget,
  type Run,
  createRun,
} from "./DeviceComparisonRun.ts";
import { type ComparisonContext, type RunControl } from "./DeviceComparisonControl.ts";
import { makeStatusReader } from "./DeviceComparisonStatus.ts";
import { type ActionArgs } from "./DeviceComparisonActions.ts";

export function makeRestore(
  ctx: ComparisonContext,
  control: RunControl,
  status: ReturnType<typeof makeStatusReader>["status"],
) {
  const { deps, runs, owners, access } = ctx;
  const { reconcile, savedAccessAllowed, installRun, launch, frame, stop } = control;
  const restoreReplay = (
    args: ActionArgs<Extract<DeviceComparisonInput, { action: "restoreReplay" }>, Run | undefined>,
  ) =>
    Effect.gen(function* () {
      const { input, run, state: initialState, sessionId, caller } = args;
      let state = initialState;
      const { threadId } = input;
      if (caller || !sessionId || !deps.store || !savedAccessAllowed(state))
        return yield* reject("Restore the saved replay from its Device panel.");
      const epoch = access.epoch;
      const restoredStatus = (restored: Run) =>
        Effect.gen(function* () {
          if (restored.id !== input.runId)
            return yield* reject("A newer comparison is already open in the thread.");
          const target = restored.target;
          if (!target || key(input.device) !== key(target) || input.appId !== target.appId)
            return yield* reject("Open the saved replay on its original destination device.");
          if (restored.restoredSessionId !== sessionId)
            return yield* reject("Continue from the Tabs session that restored this replay.");
          if (restored.phase === "paused" && restored.settled)
            yield* Deferred.await(restored.settled);
          const latest = yield* deps.state;
          reconcile(latest);
          if (epoch !== access.epoch || !savedAccessAllowed(latest))
            return yield* reject("Device access is off.");
          if (runs.get(threadId) !== restored || restored.phase !== "paused")
            return yield* reject(
              (restored.phase === "stopped" && restored.pauseReason) ||
                "This replay is no longer paused.",
            );
          if (restored.busy)
            return yield* reject("Wait for the current device operation to settle.");
          if (
            owners.get(key(target))?.run !== restored ||
            !isLiveDeviceAttachment(latest, restored.source.attachment) ||
            !isLiveDeviceAttachment(latest, target.attachment)
          )
            return yield* reject("The original device attachments changed.");
          return status(threadId, target, true, sessionId);
        });
      if (run && !canRestore(run, input.runId)) return yield* restoredStatus(run);

      const saved = yield* deps.store.load(threadId, input.runId, true);
      const replay = yield* deps.store.loadReplay(threadId, input.runId);
      const current = runs.get(threadId);
      if (current && !canRestore(current, input.runId)) return yield* restoredStatus(current);
      const report = saved?.report ?? replay?.report;
      const destination = report?.target;
      if (
        !report ||
        report.phase !== "stopped" ||
        !destination ||
        key(input.device) !== key(destination) ||
        input.appId !== destination.appId
      )
        return yield* reject("Open the saved replay on its original destination device.");
      const checkpoint = replay?.checkpoint;
      state = yield* deps.state;
      reconcile(state);
      if (!checkpoint || epoch !== access.epoch || !savedAccessAllowed(state))
        return yield* reject("This replay checkpoint is no longer available.");
      const source = resolveTarget(state, threadId, report.source, report.source.appId);
      const target = resolveTarget(state, threadId, destination, destination.appId);
      if (
        !source ||
        !target ||
        source.platform !== report.source.platform ||
        target.platform !== destination.platform
      )
        return yield* reject("Open both original devices in this thread before restoring replay.");
      // A retry can see the installed run while the first request is launching the snapshot.
      const settled = Deferred.makeUnsafe<void>();
      const restored: Run = {
        ...createRun(source),
        id: report.runId,
        target,
        phase: "paused",
        busy: true,
        settled,
        index: checkpoint.index,
        steps: restoreSteps(checkpoint),
        opened: true,
        applied: "unknown",
        ...(checkpoint.scroll && { replayScroll: checkpoint.scroll }),
        requireConsequentialReview: checkpoint.requireConsequentialReview,
        restoredSessionId: sessionId,
        ...(report.firstDifference && { difference: report.firstDifference }),
        ...(saved?.evidence && { evidence: saved.evidence }),
        ...(checkpoint.total && { total: { ...checkpoint.total } }),
      };
      const opened = yield* Effect.gen(function* () {
        const current = runs.get(threadId);
        if (current && !canRestore(current, input.runId)) return current;
        yield* installRun(threadId, restored, target);
        yield* launch(
          restored,
          Effect.gen(function* () {
            const observed = yield* frame(restored, target, "paused", "human");
            restored.observation = observed;
            if (observed.screenKey) restored.restoredScreenKey = observed.screenKey;
            const unchanged = !!checkpoint.screenKey && checkpoint.screenKey === observed.screenKey;
            restored.applied = unchanged ? checkpoint.applied : "unknown";
            restored.uncertainPreviousApplied = checkpoint.previouslyApplied;
            restored.uncertainClearsBlocker = checkpoint.clearsBlocker;
            restored.pauseReason =
              restored.applied === "unknown"
                ? "Inspect the current screen and confirm whether the interrupted step took effect."
                : "Saved replay restored at the last checkpoint. Review the current screen before resuming.";
          }),
          false,
          (cause) => {
            stop(restored, cause.reason);
            if (runs.get(threadId) === restored) runs.delete(threadId);
          },
          settled,
        );
        return restored;
      }).pipe(Effect.uninterruptible);
      return yield* restoredStatus(opened);
    });

  return { restoreReplay };
}
