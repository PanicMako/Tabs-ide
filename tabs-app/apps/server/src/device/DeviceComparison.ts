import {
  DeviceComparisonError,
  type AuthSessionId,
  type DeviceComparisonGesture,
  type DeviceComparisonInput,
  type DeviceComparisonRecording,
  type DeviceComparisonStatus,
  type DeviceServiceState,
  type DeviceSession,
  type ThreadId,
} from "@tabs/contracts";
import { randomUUID } from "node:crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import {
  isConsequentialDeviceAction,
  matchControl,
  normalizeLabel,
  sourceControlAtPoint,
} from "./DeviceComparisonSemantics.ts";
import { type SemanticDriver } from "./DeviceSemanticDriver.ts";
import { type DeviceComparisonStore } from "./DeviceComparisonStore.ts";
import {
  isLiveDeviceAttachment,
  makeAgentDeviceControl,
  type DispatchDeviceReturn,
  type RequiredDeviceAppAccess,
} from "./AgentDeviceControl.ts";
import { deviceKey as key } from "./DeviceIdentity.ts";
import { type McpThreadCaller } from "../mcp/McpInvocationContext.ts";
import {
  reject,
  MAX_STEPS,
  sourceTapObservation,
  canRestore,
  sameEvidenceApproval,
  reportFor,
  resolveTarget,
  createRun,
  visibleLabelCount,
  type Target,
  type Run,
} from "./DeviceComparisonRun.ts";
import { makeRunControl, type ComparisonContext } from "./DeviceComparisonControl.ts";
import { makePersistence } from "./DeviceComparisonPersistence.ts";
import { makeRecording } from "./DeviceComparisonRecording.ts";
import { makeReplay } from "./DeviceComparisonReplay.ts";
import { makeRestore } from "./DeviceComparisonRestore.ts";
import { makeHandoff } from "./DeviceComparisonHandoff.ts";
import { makeStatusReader } from "./DeviceComparisonStatus.ts";

export function makeDeviceComparison(deps: {
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
}) {
  const providerActive = deps.providerActive ?? (() => false);
  const ctx: ComparisonContext = {
    deps,
    runs: new Map<ThreadId, Run>(),
    owners: new Map(),
    manualWrites: new Map(),
    access: { blocked: false, epoch: 0 },
    providerActive,
    agent: makeAgentDeviceControl(providerActive),
  };
  const { runs, owners, manualWrites, access, agent } = ctx;
  const control = makeRunControl(ctx);
  const persistence = makePersistence(ctx, control);
  const recording = makeRecording(ctx, control, persistence);
  const { status, transferableEvidence, approvedScreenshotIsCurrent, savedStatus } =
    makeStatusReader(ctx, control);
  const { replaySteps } = makeReplay(ctx, control, persistence, recording);
  const { restoreReplay } = makeRestore(ctx, control, status);
  const { takeover, manualInput, startReplay, resumeSource, resumeReplay } = makeHandoff(
    ctx,
    control,
    persistence,
    replaySteps,
    status,
  );
  const {
    release,
    savedAccessAllowed,
    inputAllowed,
    manual,
    stop,
    reconcile,
    revoke,
    allowSavedResults,
    claim,
    frame,
    launch,
    installRun,
    startRecording,
    authorizeCaller,
    queueReplayReturn,
  } = control;
  const { onStepFailure, recordTap, recordScroll } = recording;

  const invoke = Effect.fn("DeviceComparison.invoke")(function* (
    input: DeviceComparisonInput,
    sessionId?: AuthSessionId,
    caller?: McpThreadCaller,
    dispatchReturn?: DispatchDeviceReturn,
  ) {
    const { threadId, action } = input;
    if (caller && caller.threadId !== threadId)
      return yield* reject("This comparison belongs to a different thread.");
    let state = yield* deps.state;
    reconcile(state);
    let run = runs.get(threadId);
    if (action === "status" && input.waitForCheckpoint) {
      if (!input.runId) return yield* reject("Select the exact run ID before waiting for replay.");
      if (run?.id === input.runId && run.playing && run.settled && run.phase !== "stopped") {
        if (caller) yield* authorizeCaller(caller, run);
        // A wait observes the current replay only. Its deadline never stops device work or
        // holds the request open while the user decides how to correct a paused step.
        yield* Deferred.await(run.settled).pipe(Effect.timeoutOption("30 seconds"));
        if (caller) yield* authorizeCaller(caller, run);
        state = yield* deps.state;
        reconcile(state);
        run = runs.get(threadId);
      }
    }
    const liveTargetAvailable =
      !caller &&
      (action === "status" || action === "evidence") &&
      run?.target &&
      (run.difference || run.phase === "completed") &&
      run.phase !== "stopped" &&
      savedAccessAllowed(state) &&
      isLiveDeviceAttachment(state, run.target.attachment);
    const liveNavigation = liveTargetAvailable ? { liveTargetAvailable: true as const } : {};
    if (
      caller &&
      run?.agentRecording &&
      (!("runId" in input) || input.runId === undefined || run.id === input.runId)
    )
      yield* authorizeCaller(caller, run);
    if (action === "status") {
      const withEvidenceApproval = (liveStatus: DeviceComparisonStatus): DeviceComparisonStatus => {
        const live = runs.get(threadId);
        if (live?.id !== liveStatus.run?.runId) return liveStatus;
        const approved = transferableEvidence(state, live, caller);
        return approved
          ? { ...liveStatus, approvedEvidence: approved.approvedEvidence }
          : liveStatus;
      };
      if (input.runId !== undefined) {
        if (!savedAccessAllowed(state)) return {};
        const live = runs.get(threadId);
        if (live?.id === input.runId && !canRestore(live, input.runId))
          return withEvidenceApproval({
            run: reportFor(live),
            ...liveNavigation,
          });
        if (!deps.store) return {};
        const epoch = access.epoch;
        const saved = yield* deps.store.load(threadId, input.runId);
        const result = yield* savedStatus(
          threadId,
          saved?.report ?? (live?.id === input.runId ? reportFor(live) : undefined),
          !caller && !!sessionId,
          input.runId,
        );
        return epoch === access.epoch ? result : {};
      }
      if (input.device) agent.refresh(input.device);
      const attachment =
        !caller && sessionId && input.device
          ? state.sessions.find(
              (candidate) =>
                candidate.threadId === threadId && key(candidate) === key(input.device!),
            )
          : undefined;
      const pending = attachment && agent.pendingApp(attachment);
      const current = () =>
        withEvidenceApproval({
          ...status(threadId, input.device, input.device !== undefined, sessionId),
          ...(pending ? { pendingAppApproval: pending } : {}),
          ...liveNavigation,
        });
      const live = current();
      if (
        !deps.store ||
        !savedAccessAllowed(state) ||
        (live.run && !canRestore(runs.get(threadId), live.run.runId))
      )
        return live;
      const epoch = access.epoch;
      const saved = yield* deps.store
        .load(threadId, live.run?.runId)
        .pipe(Effect.catch(() => Effect.succeed(undefined)));
      const result = yield* savedStatus(
        threadId,
        saved?.report ?? live.run,
        !caller && !!sessionId,
        live.run?.runId,
      );
      const latest = current();
      return !result.run ||
        epoch !== access.epoch ||
        !canRestore(runs.get(threadId), result.run.runId)
        ? latest
        : { ...latest, ...result };
    }
    if (
      action === "requestDeviceApp" ||
      action === "approveDeviceApp" ||
      action === "declineDeviceApp"
    ) {
      const attachment = state.sessions.find(
        (candidate) => candidate.threadId === threadId && key(candidate) === key(input.device),
      );
      if (!attachment || !isLiveDeviceAttachment(state, attachment))
        return yield* reject("Open the exact device in this thread first.");
      if (action === "requestDeviceApp") {
        if (!caller || !providerActive(caller))
          return yield* reject("Ask from the conversation that owns this device attachment.");
        if (owners.has(key(attachment))) return yield* reject("A comparison owns this device.");
        return {
          pendingAppApproval: yield* agent.requestApp(attachment, caller, input.appId),
        };
      }
      if (caller || !sessionId) return yield* reject("Review this request from its Device panel.");
      const approval = yield* agent.reviewApp(
        attachment,
        input.approvalId,
        action === "approveDeviceApp",
      );
      return action === "approveDeviceApp" ? { approvedApp: approval } : {};
    }
    if ("device" in input && "controlId" in input) {
      const attachment = state.sessions.find(
        (session) => session.threadId === threadId && key(session) === key(input.device),
      );
      if (!attachment || !isLiveDeviceAttachment(state, attachment))
        return yield* reject("Open this device in the thread first.");
      if (action === "returnAgentControl") {
        if (caller || !sessionId || !dispatchReturn)
          return yield* reject("Return control from the original Device panel.");
        if (manualWrites.has(key(attachment)))
          return yield* reject("Wait for the current device input to finish.");
        yield* agent.returnControl(
          attachment,
          input.controlId,
          input.appId,
          input.meaning?.trim() ?? "",
          sessionId,
          dispatchReturn,
        );
      } else {
        yield* agent.userAction(
          attachment,
          input.controlId,
          input.action,
          caller ? undefined : sessionId,
        );
      }
      return status(threadId, input.device, false, sessionId);
    }
    if (action === "start") {
      agent.refresh(input.device);
      const source = resolveTarget(state, threadId, input.device, input.appId);
      if (!source)
        return yield* reject(
          "Enable agent device access and open this device in the thread first.",
        );
      const run = createRun(source, caller ? undefined : sessionId);
      yield* installRun(threadId, run, source, true);
      yield* startRecording(run);
      return status(threadId, input.device, true, sessionId);
    }
    if (action === "evidence") {
      if (!savedAccessAllowed(state)) return yield* reject("Device access is off.");
      if (caller) {
        const approved =
          run?.id === input.runId ? transferableEvidence(state, run, caller) : undefined;
        if (!run || !approved)
          return yield* reject("The approved first-difference evidence is unavailable.");
        return { run: reportFor(run), ...approved };
      }
      if (run?.id === input.runId) {
        return {
          ...status(threadId),
          ...liveNavigation,
          ...(run.evidence === undefined ? {} : { evidence: run.evidence }),
        };
      }
      if (deps.store) {
        const epoch = access.epoch;
        const saved = yield* deps.store.load(threadId, input.runId, true);
        if (saved?.evidence) {
          const result = yield* savedStatus(threadId, saved.report, !!sessionId, input.runId);
          if (epoch !== access.epoch) return yield* reject("Device access is off.");
          return { ...result, evidence: saved.evidence };
        }
        if (epoch !== access.epoch) return yield* reject("Device access is off.");
      }
      return yield* reject("This comparison is no longer available in the thread.");
    }
    if (action === "restoreReplay")
      return yield* restoreReplay({
        input,
        run,
        state,
        sessionId,
        caller,
        dispatchReturn,
        agentSource: false,
      });
    if (!run || input.runId !== run.id)
      return yield* reject("This comparison is no longer available in the thread.");
    if (action === "stop") {
      if (stop(run, "Comparison stopped.") && deps.store)
        yield* deps.store.clearReplay(threadId, run.id).pipe(Effect.uninterruptible);
      return status(threadId);
    }
    if (run.restoredSessionId && run.restoredSessionId !== sessionId)
      return yield* reject("Continue from the Tabs session that restored this replay.");
    if (action === "resume" && run.replayReturn && input.controlId === run.replayReturn.controlId) {
      if (
        caller ||
        !dispatchReturn ||
        !run.target ||
        run.replayReturn.sessionId !== sessionId ||
        run.replayReturn.stepCompleted !== (input.stepCompleted === true)
      )
        return yield* reject("Return control from the Tabs session that took over the device.");
      yield* queueReplayReturn(run, run.target, run.replayReturn, dispatchReturn);
      return status(threadId, run.target);
    }
    if (action === "approveAgentRecording") {
      if (!sessionId || caller)
        return yield* reject("Approve agent recording from an authenticated Device panel.");
      // Commit the approval and launch together, even if the panel loses the reply.
      return yield* Effect.gen(function* () {
        const { agentRecording, source, target } = run;
        if (!agentRecording || !target)
          return yield* reject("This recording request is no longer awaiting approval.");
        yield* authorizeCaller(agentRecording.caller, run);
        if (runs.get(threadId) !== run || run.phase === "stopped")
          return yield* reject("This recording request is no longer awaiting approval.");
        if (
          !isLiveDeviceAttachment(state, source.attachment) ||
          !isLiveDeviceAttachment(state, target.attachment)
        )
          return yield* reject(
            "The requested device attachments changed. Ask for a new comparison.",
          );
        if (run.phase !== "awaiting_approval") {
          if (
            input.approvalRequestId !== undefined &&
            run.approvalId === input.approvalRequestId &&
            sameEvidenceApproval(run.approvedEvidence, input.evidence)
          )
            return status(threadId, source);
          return yield* reject("This recording request is no longer awaiting approval.");
        }
        const { evidence } = input;
        if (
          evidence &&
          (evidence.tabId !== agentRecording.evidenceDestination?.tabId ||
            evidence.grantIds[0].toLowerCase() === evidence.grantIds[1].toLowerCase())
        )
          return yield* reject("Approve two distinct screenshot grants for the proposed tab.");
        agent.refresh(source);
        if (!claim(run, source))
          return yield* reject("The source is busy or owned by another controller.");
        if (evidence) run.approvedEvidence = evidence;
        run.approvalId = input.approvalRequestId ?? randomUUID();
        run.phase = "recording";
        yield* startRecording(run);
        return status(threadId, source);
      }).pipe(Effect.uninterruptible);
    }
    const agentSource = run.phase === "recording" && run.agentRecording !== undefined;
    const recordingStatus = () => status(threadId, run.source, !run.busy);
    const recordingAction =
      action === "inspect" ||
      action === "tap" ||
      action === "scroll" ||
      action === "expect" ||
      action === "finish";
    if (caller && recordingAction) {
      if (!run.agentRecording) return yield* reject("This is a user-recorded demonstration.");
      if (action === "inspect") {
        if (run.settled && !run.manualControl) {
          yield* Deferred.await(run.settled);
          if (runs.get(threadId) !== run)
            return yield* reject("This comparison is no longer available in the thread.");
          yield* authorizeCaller(caller, run);
        }
        if (
          run.phase !== "recording" ||
          run.busy ||
          run.manualControl ||
          run.observation ||
          run.pendingSourceStep
        )
          return recordingStatus();
      }
      if (!agentSource || run.manualControl)
        return yield* reject(
          "Wait for the user to approve the recording or return source control.",
        );
      if (run.pendingSourceStep)
        return yield* reject(
          `Choose My turn on the source to verify the previous ${run.pendingSourceStep.action.type}.`,
        );
    }
    if (agentSource && !caller && recordingAction)
      return yield* reject("Source recording belongs to the agent that requested it.");

    if (action === "takeover")
      return yield* takeover({
        input,
        run,
        state,
        sessionId,
        caller,
        dispatchReturn,
        agentSource,
      });
    if (run.busy) return yield* reject("Wait for the current device operation to settle.");
    if (action === "manualInput")
      return yield* manualInput({
        input,
        run,
        state,
        sessionId,
        caller,
        dispatchReturn,
        agentSource,
      });
    if (action === "finish") {
      if (run.phase !== "recording" || run.steps.length === 0)
        return yield* reject("Demonstrate at least one step first.");
      if (run.steps.some((step) => step.action.type === "scroll" && !step.expected))
        return yield* reject("Mark the result revealed by the scroll before finishing.");
      if (run.agentRecording && !run.steps.at(-1)?.expected)
        return yield* reject(
          "Use expect to mark an observable outcome after the final recorded step before finishing.",
        );
      run.phase = "ready";
      release(run);
      delete run.observation;
      return status(threadId);
    }
    if (action === "approve") {
      if (run.agentRecording)
        return yield* reject(
          "The destination for this recording was approved with its original request.",
        );
      if (run.phase !== "ready")
        return yield* reject("Finish the demonstration before selecting a destination.");
      const target = resolveTarget(state, threadId, input.target, input.appId);
      if (!target || target.platform === run.source.platform) {
        return yield* reject(
          "Open a device from the other platform in this thread and select it here.",
        );
      }
      run.target = target;
      run.approvalId = randomUUID();
      return status(threadId);
    }
    if (action === "replay")
      return yield* startReplay({
        input,
        run,
        state,
        sessionId,
        caller,
        dispatchReturn,
        agentSource,
      });
    if ((action === "resume" || action === "resolve") && agentSource)
      return yield* resumeSource({
        input,
        run,
        state,
        sessionId,
        caller,
        dispatchReturn,
        agentSource,
      });
    if (action === "resume" || action === "resolve")
      return yield* resumeReplay({
        input,
        run,
        state,
        sessionId,
        caller,
        dispatchReturn,
        agentSource,
      });

    const phase = run.phase;
    const target = phase === "recording" ? run.source : phase === "paused" ? run.target : undefined;
    if (!target || (phase !== "recording" && phase !== "paused"))
      return yield* reject("The device is not available for demonstration or correction.");
    if (run.manualControl)
      return yield* reject(
        "Return control from the live device screen before selecting a control.",
      );
    if (action === "inspect") {
      yield* launch(
        run,
        Effect.gen(function* () {
          const observed = yield* frame(
            run,
            target,
            phase,
            phase === "paused" ? "human" : undefined,
          );
          if (run.phase === phase && !run.manualControl) {
            run.observation = observed;
            if (phase === "recording") delete run.pauseReason;
          }
        }),
        false,
        (cause) => {
          run.pauseReason = cause.reason;
        },
      );
      if (caller && run.settled) yield* Deferred.await(run.settled);
      if (caller) {
        if (runs.get(threadId) !== run)
          return yield* reject("This comparison is no longer available in the thread.");
        yield* authorizeCaller(caller, run);
        return recordingStatus();
      }
      return status(threadId);
    }
    const last = run.steps.at(-1);
    const pendingScroll = last?.action.type === "scroll" && !last.expected ? last : undefined;
    if (action === "scroll") {
      if (phase !== "recording" || (!caller && !sessionId))
        return yield* reject("Record scrolls from the Device panel during a user demonstration.");
      if (
        pendingScroll?.action.type === "scroll" &&
        pendingScroll.action.direction !== input.direction
      )
        return yield* reject("Mark the result of the current scroll before changing direction.");
      if (!pendingScroll && run.steps.length >= MAX_STEPS)
        return yield* reject(`A demonstration supports up to ${MAX_STEPS} steps.`);
      if (agentSource) delete run.observation;
      yield* launch(run, recordScroll(run, input.direction, pendingScroll), false, (cause) =>
        onStepFailure(run, phase, cause),
      );
      return status(threadId);
    }
    if (action === "sourceTap") {
      const observed = sourceTapObservation(run, input.device, caller ? undefined : sessionId);
      const screenKey = observed?.screenKey;
      if (!observed || !screenKey || observed.sourceTap?.id !== input.observationId)
        return yield* reject("Choose a control on the current source device screen.");
      if (!sourceControlAtPoint(observed, input))
        return yield* reject(
          "Tap a single accessible control, or choose it from the control list.",
        );
      yield* launch(
        run,
        recordTap(
          run,
          run.source,
          "recording",
          (before) =>
            before.screenKey === screenKey ? sourceControlAtPoint(before, input) : undefined,
          false,
        ),
        false,
        (cause) => onStepFailure(run, "recording", cause),
      );
      return status(threadId, input.device, true, sessionId);
    }
    const observation = run.observation;
    const selected = observation?.controls.find((control) => control.id === input.controlId);
    if (!observation || !selected)
      return yield* reject("The screen changed. Refresh controls before choosing.");
    if (action === "expect") {
      const step = run.steps.at(-1);
      // A refresh issues new IDs, but the same screen key preserves control order.
      const recorded =
        step?.after.controls.find((control) => control.id === selected.id) ??
        (step?.after.screenKey && step.after.screenKey === observation.screenKey
          ? step.after.controls[observation.controls.indexOf(selected)]
          : undefined);
      if (phase !== "recording" || !step || recorded?.label !== selected.label) {
        return yield* reject(
          "Pick an expected result from the screen captured after the last demonstrated step.",
        );
      }
      const matches = step.after.controls.filter(
        (item) => normalizeLabel(item.label) === normalizeLabel(selected.label),
      );
      if (matches.length !== 1 && matchControl(recorded, matches)?.id !== recorded.id) {
        return yield* reject("Choose an observable result with a unique label.");
      }
      if (
        step.action.type === "scroll" &&
        (matches.length !== 1 || visibleLabelCount(step.before, recorded.label) > 0)
      )
        return yield* reject("Choose a unique label that came into view during the scroll.");
      step.expected = recorded;
      return caller ? recordingStatus() : status(threadId);
    }
    if (phase === "recording" && pendingScroll)
      return yield* reject("Mark the result revealed by the scroll before recording a tap.");
    if (agentSource && isConsequentialDeviceAction(selected.label))
      return yield* reject("Choose My turn before using this control on the source.");
    if (!selected.canTap || run.applied === "unknown")
      return yield* reject("This control cannot be tapped safely.");
    if (phase === "recording" && run.steps.length >= MAX_STEPS)
      return yield* reject(`A demonstration supports up to ${MAX_STEPS} steps.`);
    if (phase === "recording" && input.clearsBlocker) {
      return yield* reject("Blocker correction is available when replay is paused.");
    }
    if (agentSource) delete run.observation;
    yield* launch(
      run,
      recordTap(
        run,
        target,
        phase,
        (before) => {
          const current = matchControl(selected, before.controls);
          return current?.role === selected.role && current.context === selected.context
            ? current
            : undefined;
        },
        input.clearsBlocker ?? false,
      ),
      false,
      (cause) => onStepFailure(run, phase, cause),
    );
    return status(threadId);
  });

  const record = Effect.fn("DeviceComparison.record")(function* (
    input: DeviceComparisonRecording,
    caller: McpThreadCaller,
  ) {
    const { threadId } = caller;
    if (input.action !== "propose") {
      yield* authorizeCaller(caller);
      return yield* invoke({ ...input, threadId }, undefined, caller);
    }

    const state = yield* deps.state;
    reconcile(state);
    yield* authorizeCaller(caller);
    const source = resolveTarget(state, threadId, input.source, input.source.appId);
    const target = resolveTarget(state, threadId, input.target, input.target.appId);
    if (!source || !target || source.platform === target.platform)
      return yield* reject(
        "Open the exact source and destination from different platforms in this thread.",
      );
    yield* installRun(
      threadId,
      {
        ...createRun(source),
        target,
        phase: "awaiting_approval",
        agentRecording: {
          caller,
          ...(input.total && { total: input.total }),
          ...(input.evidenceDestination && {
            evidenceDestination: input.evidenceDestination,
          }),
        },
      },
      undefined,
      true,
    );
    return status(threadId);
  });

  const claimAgent = (
    attachment: DeviceSession,
    caller: McpThreadCaller,
    access?: RequiredDeviceAppAccess,
  ) => {
    const id = key(attachment);
    if (owners.has(id) || manualWrites.has(id)) return undefined;
    return agent.claim(attachment, caller, access);
  };
  return {
    invoke,
    record,
    reconcile,
    revoke,
    allowSavedResults,
    inputAllowed,
    manual,
    agent,
    claimAgent,
    approvedScreenshotIsCurrent,
  };
}
