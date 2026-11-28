import {
  DeviceComparisonError,
  type DeviceComparisonGesture,
  type DeviceComparisonTarget,
  type DeviceServiceState,
  type ThreadId,
} from "@tabs/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import {
  needsPrivateDeviceInput,
  observeDevice,
  screenshotPng,
  type DeviceObservation,
} from "./DeviceComparisonSemantics.ts";
import {
  isDeviceSystemSurface,
  systemDeviceSurface,
  type SemanticDriver,
} from "./DeviceSemanticDriver.ts";
import { type DeviceComparisonStore } from "./DeviceComparisonStore.ts";
import {
  isLiveDeviceAttachment,
  makeAgentDeviceControl,
  type DispatchDeviceReturn,
} from "./AgentDeviceControl.ts";
import { deviceKey as key, sameCaller } from "./DeviceIdentity.ts";
import { type McpThreadCaller } from "../mcp/McpInvocationContext.ts";
import {
  reject,
  MAX_SESSIONS,
  active,
  replaceable,
  type Target,
  type Phase,
  type ReplayReturn,
  type Run,
  cancelObservation,
} from "./DeviceComparisonRun.ts";

export interface ComparisonContext {
  readonly deps: {
    readonly state: Effect.Effect<DeviceServiceState>;
    readonly driver: SemanticDriver;
    readonly screenshot: (
      target: Target,
      guard: Effect.Effect<void, DeviceComparisonError>,
    ) => Effect.Effect<Uint8Array | undefined>;
    readonly manualInput?: (
      target: Target,
      gesture: DeviceComparisonGesture,
      guard: Effect.Effect<void, DeviceComparisonError>,
    ) => Effect.Effect<void, DeviceComparisonError>;
    readonly providerActive?: (caller: McpThreadCaller) => boolean;
    readonly store?: DeviceComparisonStore;
  };
  readonly runs: Map<ThreadId, Run>;
  readonly owners: Map<string, { target: Target; run: Run; releasing?: boolean }>;
  readonly manualWrites: Map<string, number>;
  readonly access: { blocked: boolean; epoch: number };
  readonly providerActive: (caller: McpThreadCaller) => boolean;
  readonly agent: ReturnType<typeof makeAgentDeviceControl>;
}

export type RunControl = ReturnType<typeof makeRunControl>;

export function makeRunControl(ctx: ComparisonContext) {
  const { deps, runs, owners, manualWrites, access, providerActive, agent } = ctx;
  const savedAccessAllowed = (state: DeviceServiceState) =>
    !access.blocked && state.agentAccessEnabled && state.hostStatus !== "disabled";

  const inputAllowed = (hostId: string, deviceId?: string) =>
    agent.inputAllowed(hostId, deviceId) &&
    (deviceId === undefined
      ? ![...owners.values()].some(({ target }) => target.hostId === hostId)
      : !owners.has(key({ hostId, deviceId })));

  const manual = <A, E, R>(
    target: DeviceComparisonTarget,
    operation: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | DeviceComparisonError, R> =>
    Effect.suspend<A, E | DeviceComparisonError, R>(() => {
      if (!inputAllowed(target.hostId, target.deviceId)) {
        return reject(
          "This device is under agent control. Stop control from the Device panel first.",
        );
      }
      const id = key(target);
      const count = manualWrites.get(id) ?? 0;
      manualWrites.set(id, count + 1);
      return operation.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            const remaining = manualWrites.get(id)! - 1;
            if (remaining === 0) manualWrites.delete(id);
            else manualWrites.set(id, remaining);
          }),
        ),
      );
    });

  const release = (run: Run) => {
    for (const [id, owner] of owners) {
      if (owner.run !== run || owner.releasing) continue;
      const cleanup = deps.driver.release?.(owner.target);
      if (!cleanup) {
        owners.delete(id);
        continue;
      }
      owner.releasing = true;
      Effect.runFork(
        cleanup.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              owners.delete(id);
            }),
          ),
        ),
      );
    }
  };

  const stop = (run: Run, reason: string, interrupted = false) => {
    // A verified outcome can still be committing while a stop or attachment change arrives.
    if (run.phase === "completed") return false;
    if (interrupted && (run.phase === "running" || run.phase === "paused"))
      run.replayInterrupted = true;
    if (!interrupted) delete run.replayInterrupted;
    run.phase = "stopped";
    run.pauseReason = reason;
    cancelObservation(run);
    delete run.manualControl;
    delete run.replayReturn;
    delete run.approvedEvidence;
    if (!run.busy) release(run);
    return true;
  };

  const reconcile = (state: DeviceServiceState) => {
    agent.reconcile(state);
    for (const run of runs.values()) {
      if (
        run.replayReturn &&
        (!run.agentRecording ||
          !providerActive(run.agentRecording.caller) ||
          !run.target ||
          !savedAccessAllowed(state) ||
          !isLiveDeviceAttachment(state, run.source.attachment) ||
          !isLiveDeviceAttachment(state, run.target.attachment))
      )
        delete run.replayReturn;
      if (!run.agentRecording || run.phase === "stopped" || run.phase === "completed") continue;
      if (!providerActive(run.agentRecording.caller)) {
        stop(run, "The agent session that requested this comparison has ended.", true);
      } else if (
        (run.phase === "awaiting_approval" || run.phase === "recording" || run.phase === "ready") &&
        (!run.target ||
          !isLiveDeviceAttachment(state, run.source.attachment) ||
          !isLiveDeviceAttachment(state, run.target.attachment))
      ) {
        stop(run, "The requested device attachments changed. Ask for a new comparison.");
      }
    }
    for (const { run, target } of owners.values()) {
      if (!isLiveDeviceAttachment(state, target.attachment)) {
        stop(run, "Device access was removed.", true);
      }
    }
  };

  const revoke = () => {
    access.blocked = true;
    access.epoch += 1;
    agent.revoke();
    for (const { run } of owners.values()) stop(run, "Device access was removed.");
    runs.clear();
  };

  const allowSavedResults = () => {
    access.blocked = false;
  };

  const claim = (run: Run, target: Target) => {
    const id = key(target);
    if (owners.has(id) || manualWrites.has(id) || agent.blocksComparison(target)) return false;
    owners.set(id, { run, target });
    return true;
  };

  const guard = (
    run: Run,
    target: Target,
    phase: Phase,
    mode: "automation" | "human" | "panelCorrection" | "sourceObservation" = "automation",
  ) =>
    Effect.flatMap(deps.state, (state) => {
      if (
        run.phase !== phase ||
        owners.get(key(target))?.run !== run ||
        !isLiveDeviceAttachment(state, target.attachment) ||
        ((mode === "automation" || mode === "panelCorrection") && run.manualControl)
      )
        return reject("Device control was handed back before the action started.");
      if (run.agentRecording && mode !== "human" && mode !== "panelCorrection") {
        if (!providerActive(run.agentRecording.caller))
          return reject("The agent session that requested this comparison has ended.");
        if (phase === "recording" && !isLiveDeviceAttachment(state, run.target!.attachment))
          return reject("The approved destination attachment changed. Start a new comparison.");
      }
      return Effect.void;
    });

  const replayWriteGuard = (run: Run, target: Target) => {
    const epoch = access.epoch;
    return () =>
      epoch === access.epoch &&
      !access.blocked &&
      runs.get(target.threadId) === run &&
      owners.get(key(target))?.run === run &&
      (run.phase === "paused" || run.phase === "running");
  };

  const frame = (
    run: Run,
    target: Target,
    phase: Phase,
    mode?: Parameters<typeof guard>[3],
  ): Effect.Effect<DeviceObservation, DeviceComparisonError> =>
    Effect.gen(function* () {
      const check = guard(run, target, phase, mode);
      yield* check;
      const snapshot = yield* deps.driver.snapshot(target, check);
      yield* check;
      if (isDeviceSystemSurface(snapshot)) return yield* systemDeviceSurface();
      if (needsPrivateDeviceInput(snapshot, { allowBrowserLocationDisplay: true }))
        return yield* reject(
          "A protected field or account selection is visible. Complete this step on the device and refresh the controls.",
        );
      return observeDevice(
        snapshot,
        phase === "recording" && run.sourceSessionId !== undefined && target.platform === "ios",
      );
    });

  const captureFrame = (
    run: Run,
    target: Target,
    phase: Phase,
    before: DeviceObservation,
    mode?: Parameters<typeof guard>[3],
  ) =>
    Effect.gen(function* () {
      if (!before.screenKey) return before;
      const check = guard(run, target, phase, mode);
      yield* check;
      const bytes = yield* deps.screenshot(target, check);
      const after = yield* frame(run, target, phase, mode);
      const png = bytes && after.screenKey === before.screenKey ? screenshotPng(bytes) : undefined;
      return png === undefined ? after : { ...after, png };
    });

  // Own a device until the last dispatched operation settles. A takeover or
  // stop changes the generation gate synchronously, so no later input is sent.
  const launch = (
    run: Run,
    work: Effect.Effect<void, DeviceComparisonError>,
    playing: boolean,
    onError: (cause: DeviceComparisonError) => void,
    settleSignal?: Deferred.Deferred<void>,
  ) =>
    Effect.gen(function* () {
      const settled = settleSignal ?? Deferred.makeUnsafe<void>();
      run.busy = true;
      run.playing = playing;
      run.settled = settled;
      yield* work.pipe(
        Effect.catch((cause) =>
          Effect.sync(() => {
            if (run.phase !== "stopped") onError(cause);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            run.playing = false;
            run.busy = false;
            delete run.settled;
            if (!active(run)) release(run);
          }).pipe(Effect.andThen(Deferred.succeed(settled, undefined))),
        ),
        Effect.forkDetach,
      );
    }).pipe(Effect.uninterruptible);

  const installRun = (threadId: ThreadId, run: Run, claimTarget?: Target, supersede = false) => {
    const current = runs.get(threadId);
    if (current && !replaceable(current))
      return reject("Finish or stop the current comparison before recording another.");
    const previous =
      runs.size >= MAX_SESSIONS && !current
        ? [...runs].find(([, entry]) => replaceable(entry))
        : undefined;
    if (runs.size >= MAX_SESSIONS && !current && !previous)
      return reject("Stop an active device comparison before starting another.");
    if (claimTarget && !claim(run, claimTarget))
      return reject("This device is busy or owned by another comparison.");
    if (previous) runs.delete(previous[0]);
    runs.set(threadId, run);
    if (supersede && deps.store)
      return deps.store
        .supersedeReplay(threadId, run.id, () => runs.get(threadId) === run)
        .pipe(
          Effect.tapError((cause) => Effect.sync(() => stop(run, cause.reason))),
          Effect.uninterruptible,
        );
    return Effect.void;
  };

  const startRecording = (run: Run) =>
    launch(
      run,
      Effect.gen(function* () {
        const { source } = run;
        yield* deps.driver.open(source, guard(run, source, "recording"));
        run.sourceOpened = true;
        const observed = yield* frame(run, source, "recording");
        if (run.phase === "recording" && !run.manualControl) run.observation = observed;
      }),
      false,
      (cause) => {
        if (run.agentRecording) run.pauseReason = cause.reason;
        else stop(run, cause.reason);
      },
    );

  const authorizeCaller = (caller: McpThreadCaller, run?: Run) => {
    if (run?.agentRecording && !sameCaller(run.agentRecording.caller, caller))
      return reject("This comparison belongs to a different agent session.");
    return providerActive(caller)
      ? Effect.void
      : reject("The agent session that requested this comparison has ended.");
  };

  const queueReplayReturn = (
    run: Run,
    target: Target,
    returned: ReplayReturn,
    dispatch: DispatchDeviceReturn,
  ) =>
    Effect.gen(function* () {
      const threadId = target.threadId;
      const recording = run.agentRecording;
      const current = () =>
        runs.get(threadId) === run &&
        run.replayReturn === returned &&
        run.phase !== "stopped" &&
        recording !== undefined &&
        providerActive(recording.caller);
      if (!current()) return yield* reject("The original device or conversation changed.");
      if (returned.queued || returned.queueing) return;
      returned.queueing = true;
      yield* dispatch(
        {
          id: returned.controlId,
          threadId,
          target: { hostId: target.hostId, deviceId: target.deviceId },
          appId: target.appId,
          comparisonRunId: run.id,
          changed: undefined,
          meaning: "",
        },
        current,
      ).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            returned.queued = true;
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            returned.queueing = false;
          }),
        ),
      );
    }).pipe(Effect.uninterruptible);

  return {
    savedAccessAllowed,
    inputAllowed,
    manual,
    release,
    stop,
    reconcile,
    revoke,
    allowSavedResults,
    claim,
    guard,
    replayWriteGuard,
    frame,
    captureFrame,
    launch,
    installRun,
    startRecording,
    authorizeCaller,
    queueReplayReturn,
  };
}
