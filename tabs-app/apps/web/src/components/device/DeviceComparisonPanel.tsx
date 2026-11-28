import { useState } from "react";
import { DeviceComparisonApproval } from "./DeviceComparisonApproval";
import { DeviceComparisonEvidence } from "./DeviceComparisonEvidence";
import { RestorePausedReplayButton } from "./DeviceComparisonRestore";
import { RecordedSteps, StartDemonstrationForm } from "./DeviceComparisonSteps";
import { AGENT_HANDOFF_DESCRIPTIONS, AGENT_HANDOFF_LABELS } from "~/lib/agentHandoffLabels";
import { TotalCheckNote } from "./TotalCheckNote";
import { appIdValid, deviceKey, totalCheckOf } from "./deviceComparisonShared";
import { useDeviceComparison } from "./useDeviceComparison";
import type {
  DeviceComparisonTarget,
  DeviceSession,
  DeviceSummary,
  ThreadId,
} from "@tabs/contracts";

export { DeviceComparisonResultPanel } from "./DeviceComparisonResultPanel";
export { useDeviceComparison };

export function DeviceComparisonPanel({
  target,
  threadId,
  devices,
  sessions,
  comparison,
  manualPending = false,
  canStart = true,
  projectId,
  environmentId,
}: {
  target?: DeviceComparisonTarget;
  threadId: ThreadId;
  devices: ReadonlyArray<DeviceSummary>;
  sessions: ReadonlyArray<DeviceSession>;
  comparison: ReturnType<typeof useDeviceComparison>;
  manualPending?: boolean;
  canStart?: boolean;
  projectId?: string | undefined;
  environmentId?: string | null | undefined;
}) {
  const { status, send, sending, failure } = comparison;
  const [showSetup, setShowSetup] = useState(false);
  const [targetApp, setTargetApp] = useState("");
  const [destinationKey, setDestinationKey] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [compareTotal, setCompareTotal] = useState(false);
  const [sourceLabel, setSourceLabel] = useState("Total");
  const [targetLabel, setTargetLabel] = useState("Total");
  const [currency, setCurrency] = useState<"USD" | "EUR" | "GBP">("USD");
  const run = status?.run;
  const targetKey = target && deviceKey(target);
  const source = run && deviceKey(run.source) === targetKey;
  const destination = run?.target && deviceKey(run.target) === targetKey;
  const owner = status?.ownerThreadId;
  const ownedElsewhere = owner !== undefined && owner !== threadId;

  if (run?.savedAt !== undefined)
    return (
      <section className="dv-comparison" aria-label="Saved device comparison">
        <div className="dv-comparison-header">
          <strong>Saved comparison</strong>
          <span className="dv-muted" role="status">
            {run.phase === "completed" ? "Replay completed" : "Recovered after restart"}
          </span>
        </div>
        <DeviceComparisonEvidence key={run.runId} run={run} send={send} />
        <RecordedSteps steps={run.steps} />
        {status?.canRestoreReplay && destination && run.target && !ownedElsewhere && (
          <RestorePausedReplayButton
            key={`restore:${run.runId}`}
            runId={run.runId}
            target={run.target}
            disabled={sending}
            restore={(request) => send(request)}
          />
        )}
        {canStart &&
          !ownedElsewhere &&
          (target ? (
            <StartDemonstrationForm
              target={target}
              send={send}
              disabled={sending}
              label="Start new demonstration"
            />
          ) : (
            <p className="dv-muted">Choose a device below to start a new comparison.</p>
          ))}
        {failure && (
          <p className="dv-error" role="alert">
            {failure}
          </p>
        )}
      </section>
    );

  if (!target) return null;

  if (ownedElsewhere)
    return (
      <p className="dv-comparison dv-muted" role="status">
        Managed by thread {owner}.
      </p>
    );

  if (!run || (!source && !destination))
    return (
      <section className="dv-comparison" aria-label="Device comparison">
        {!run || run.phase === "stopped" || run.phase === "completed" ? (
          <>
            <button
              type="button"
              className="dv-link"
              aria-expanded={showSetup}
              onClick={() => setShowSetup(!showSetup)}
            >
              Compare devices
            </button>
            {showSetup && (
              <StartDemonstrationForm
                target={target}
                send={send}
                disabled={sending}
                label="Start demonstration"
              />
            )}
          </>
        ) : (
          <p className="dv-muted" role="status">
            Comparison is in progress on {run.target?.name ?? run.source.name}.
          </p>
        )}
        {failure && (
          <p className="dv-error" role="alert">
            {failure}
          </p>
        )}
      </section>
    );

  const candidateDevices = devices.filter(
    (device) =>
      device.platform !== run.source.platform &&
      device.booted &&
      sessions.some(
        (session) =>
          session.threadId === threadId &&
          session.hostId === device.hostId &&
          session.deviceId === device.id,
      ),
  );
  const chosen = candidateDevices.find(
    (device) => deviceKey({ hostId: device.hostId, deviceId: device.id }) === destinationKey,
  );
  const controls = status?.controls ?? [];
  const selected = controls.find((control) => control.id === selectedId);
  const lastStep = run.steps.at(-1);
  const pendingScroll = lastStep?.expected ? undefined : lastStep?.scrollDirection;
  const progress =
    run.phase === "recording"
      ? `${run.steps.length} recorded ${run.steps.length === 1 ? "step" : "steps"}`
      : `${run.completedSteps} of ${run.steps.length} steps completed`;
  const busy = sending || run.busy || manualPending;
  const recording = run.phase === "recording" && source && !run.agentRecording;
  const agentRecording = run.phase === "recording" && source && run.agentRecording;
  const agentDestination = run.agentRecording && run.target;
  const correcting = run.phase === "paused" && destination;
  const totalVerification = run.totalVerification;
  const pendingTotal = totalVerification?.pending;
  const pendingReplayReturn = destination ? status?.pendingReplayReturn : undefined;
  const manualControlId = correcting || agentRecording ? status?.manualControlId : undefined;
  const manual = manualControlId !== undefined;
  const control = manual ? { controlId: manualControlId } : {};
  const command = (action: "finish" | "takeover" | "inspect" | "resume" | "stop") => {
    const runId = run.runId;
    if (action === "resume") void send({ action, runId, ...control });
    else if (action === "takeover")
      void send({
        action,
        runId,
        liveInput: true,
        device: { hostId: target.hostId, deviceId: target.deviceId },
      });
    else void send({ action, runId });
  };

  return (
    <section className="dv-comparison" aria-label="Device comparison">
      <div className="dv-comparison-header">
        <strong>
          {run.target ? `${run.source.name} ↔ ${run.target.name}` : "Device demonstration"}
        </strong>
        {run.phase !== "awaiting_approval" && (
          <span className="dv-muted" role="status">
            {progress}
          </span>
        )}
      </div>
      {run.phase === "awaiting_approval" && agentDestination && (
        <>
          <p>
            The thread requested access to record taps and scrolls and replay them on these devices.
          </p>
          <dl className="dv-comparison-form">
            <div>
              <dt>Record on {run.source.name}</dt>
              <dd title={`${run.source.hostId} · ${run.source.deviceId}`}>{run.source.appId}</dd>
            </div>
            <div>
              <dt>Replay on {agentDestination.name}</dt>
              <dd title={`${agentDestination.hostId} · ${agentDestination.deviceId}`}>
                {agentDestination.appId}
              </dd>
            </div>
          </dl>
          {run.agentRecording?.total && (
            <p>
              Pause for a difference in {run.agentRecording.total.currency} totals. Compare “
              {run.agentRecording.total.sourceLabel}” on {run.source.name} with “
              {run.agentRecording.total.targetLabel}” on {agentDestination.name}.
            </p>
          )}
          <DeviceComparisonApproval
            key={run.runId}
            run={run}
            target={agentDestination}
            threadId={threadId}
            projectId={projectId}
            environmentId={environmentId}
            disabled={busy}
            send={send}
          />
        </>
      )}
      {agentRecording && (
        <p role="status">
          {agentRecording.manual
            ? manual
              ? "Your turn on the recording device."
              : "Waiting for the current device operation to settle."
            : `This thread is recording on ${run.source.name}.`}
        </p>
      )}
      {run.phase === "running" && (
        <p role="status">
          Replay from this thread is controlling {run.target?.name}.
          {pendingTotal
            ? ` Rechecking the total ${pendingTotal.timing} step ${pendingTotal.step}.`
            : totalVerification && run.completedSteps < totalVerification.startsAt.step
              ? ` Total verification starts ${totalVerification.startsAt.timing} step ${totalVerification.startsAt.step}.`
              : null}
        </p>
      )}
      {run.phase === "paused" && (
        <p role="status">
          {run.pauseReason ?? "Replay paused."}
          {run.busy && " Waiting for the current device operation to settle."}
          {source && run.target && ` Open the ${run.target.name} tab for correction and resume.`}
        </p>
      )}
      {run.phase === "stopped" && (
        <p role="status">
          {run.pauseReason}
          {run.busy && " Waiting for the current operation to settle."}
        </p>
      )}
      {run.phase === "recording" && run.pauseReason && <p role="alert">{run.pauseReason}</p>}
      {run.phase === "completed" && <p role="status">Demonstration replayed.</p>}
      {run.target && ["running", "paused", "completed", "stopped"].includes(run.phase) && (
        <TotalCheckNote check={totalCheckOf(run)} suggest={run.suggestTotalCheck === true} />
      )}

      <DeviceComparisonEvidence key={run.runId} run={run} send={send} />

      {recording && (
        <p className="dv-muted">
          {pendingScroll
            ? "Choose a unique label that came into view and mark it as the expected result."
            : comparison.sourceTapId
              ? "Tap the live screen, choose an accessible control, or use the scroll buttons."
              : "Choose an accessible control to tap, or scroll to reveal a result."}
        </p>
      )}
      {manual && correcting && (
        <p className="dv-muted">
          Tap, swipe, or type on the live screen. Resume after clearing a blocker, or mark the
          current step complete if you performed it yourself.
        </p>
      )}
      {manual && agentRecording && (
        <p className="dv-muted">
          Use the live screen to clear a blocker, then return control to the thread.
        </p>
      )}
      {correcting && pendingTotal && (
        <p className="dv-muted">
          Resume will recheck the total {pendingTotal.timing} step {pendingTotal.step}. If you can’t
          clear the difference, stop the comparison.
        </p>
      )}
      {correcting && !manual && !pendingTotal && (
        <p className="dv-muted">Choose a replacement control or clear a blocker before resuming.</p>
      )}
      {(recording || (correcting && !manual)) && (
        <div className="dv-comparison-form">
          <label>
            Accessible control
            <select
              value={selected?.id ?? ""}
              disabled={busy || controls.length === 0}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              <option value="">Choose from the current screen</option>
              {controls.map((control) => (
                <option key={control.id} value={control.id}>
                  {control.label}
                  {control.context ? ` · ${control.context}` : ""}
                  {control.canTap ? "" : " (read only)"}
                </option>
              ))}
            </select>
          </label>
          <div className="dv-comparison-buttons">
            <button
              type="button"
              className="dv-link"
              disabled={busy}
              onClick={() => command("inspect")}
            >
              Refresh controls
            </button>
            <button
              type="button"
              className="sl-primary"
              disabled={busy || !selected?.canTap || run.uncertainTap || !!pendingScroll}
              onClick={() => {
                if (selected)
                  void send({
                    action: "tap",
                    runId: run.runId,
                    controlId: selected.id,
                  });
              }}
            >
              {recording ? "Demonstrate tap" : "Apply correction"}
            </button>
            {correcting && (
              <button
                type="button"
                className="dv-link"
                disabled={busy || !selected?.canTap || run.uncertainTap}
                onClick={() => {
                  if (selected)
                    void send({
                      action: "tap",
                      runId: run.runId,
                      controlId: selected.id,
                      clearsBlocker: true,
                    });
                }}
              >
                Clear blocker
              </button>
            )}
            {recording && run.steps.length > 0 && (
              <button
                type="button"
                className="dv-link"
                disabled={busy || !selected}
                onClick={() => {
                  if (selected)
                    void send({
                      action: "expect",
                      runId: run.runId,
                      controlId: selected.id,
                    });
                }}
              >
                Mark expected result
              </button>
            )}
          </div>
          {recording && (
            <div className="dv-comparison-buttons">
              {(["up", "down"] as const).map((direction) => (
                <button
                  key={direction}
                  type="button"
                  className="dv-link"
                  disabled={
                    busy ||
                    run.uncertainTap ||
                    (pendingScroll !== undefined && pendingScroll !== direction)
                  }
                  onClick={() => void send({ action: "scroll", runId: run.runId, direction })}
                >
                  Scroll {direction}
                </button>
              ))}
            </div>
          )}
          {recording && run.steps.at(-1)?.expected && (
            <span className="dv-muted">Expected on replay · {run.steps.at(-1)?.expected}</span>
          )}
        </div>
      )}

      {run.phase === "ready" && run.agentRecording && (
        <>
          <RecordedSteps steps={run.steps} />
          <p role="status">Waiting for the thread to replay the demonstration.</p>
        </>
      )}
      {run.phase === "ready" && source && !run.agentRecording && (
        <div className="dv-comparison-form">
          <RecordedSteps steps={run.steps} />
          <label>
            Replay on
            <select
              value={destinationKey}
              onChange={(event) => setDestinationKey(event.target.value)}
            >
              <option value="">Select an open device</option>
              {candidateDevices.map((device) => {
                const key = deviceKey({
                  hostId: device.hostId,
                  deviceId: device.id,
                });
                return (
                  <option key={key} value={key}>
                    {device.name}
                  </option>
                );
              })}
            </select>
          </label>
          {candidateDevices.length === 0 && (
            <p className="dv-muted">Open a device from the other platform in this thread.</p>
          )}
          <label>
            Destination app bundle or package ID
            <input
              value={targetApp}
              onChange={(event) => setTargetApp(event.target.value)}
              maxLength={255}
            />
          </label>
          <button
            type="button"
            className="dv-link"
            disabled={busy || !chosen || !appIdValid(targetApp)}
            onClick={() => {
              if (chosen)
                void send({
                  action: "approve",
                  runId: run.runId,
                  target: { hostId: chosen.hostId, deviceId: chosen.id },
                  appId: targetApp.trim(),
                });
            }}
          >
            Approve destination
          </button>
          {run.target && (
            <p className="dv-muted" title={`${run.target.hostId} · ${run.target.deviceId}`}>
              Approved destination · {run.target.name} · {run.target.appId}
            </p>
          )}
          <label className="dv-comparison-check">
            <input
              type="checkbox"
              checked={compareTotal}
              onChange={(event) => setCompareTotal(event.target.checked)}
            />
            Pause if totals differ
          </label>
          {compareTotal && (
            <div className="dv-comparison-breakpoint">
              <label>
                Source total label
                <input
                  value={sourceLabel}
                  onChange={(event) => setSourceLabel(event.target.value)}
                  maxLength={180}
                />
              </label>
              <label>
                Destination total label
                <input
                  value={targetLabel}
                  onChange={(event) => setTargetLabel(event.target.value)}
                  maxLength={180}
                />
              </label>
              <label>
                Currency
                <select
                  value={currency}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "USD" || value === "EUR" || value === "GBP") setCurrency(value);
                  }}
                >
                  <option>USD</option>
                  <option>EUR</option>
                  <option>GBP</option>
                </select>
              </label>
            </div>
          )}
          <button
            type="button"
            className="sl-primary"
            disabled={
              busy ||
              !run.approvalId ||
              (compareTotal && (!sourceLabel.trim() || !targetLabel.trim()))
            }
            onClick={() => {
              if (!run.approvalId) return;
              void send({
                action: "replay",
                runId: run.runId,
                approvalId: run.approvalId,
                ...(compareTotal
                  ? {
                      total: {
                        sourceLabel: sourceLabel.trim(),
                        targetLabel: targetLabel.trim(),
                        currency,
                      },
                    }
                  : {}),
              });
            }}
          >
            Replay demonstration
          </button>
        </div>
      )}

      <div className="dv-comparison-buttons">
        {pendingReplayReturn && (
          <button
            type="button"
            className="dv-link"
            disabled={sending}
            title={AGENT_HANDOFF_DESCRIPTIONS.retryContinuation}
            aria-description={AGENT_HANDOFF_DESCRIPTIONS.retryContinuation}
            onClick={() =>
              void send({
                action: "resume",
                runId: run.runId,
                ...pendingReplayReturn,
              })
            }
          >
            {AGENT_HANDOFF_LABELS.retryContinuation}
          </button>
        )}
        {recording && (
          <button
            type="button"
            className="dv-link"
            disabled={busy || run.steps.length === 0 || !!pendingScroll}
            onClick={() => command("finish")}
          >
            Finish demonstration
          </button>
        )}
        {((run.phase === "running" && destination) ||
          (correcting && !manual) ||
          (agentRecording && !agentRecording.manual)) && (
          <button
            type="button"
            className="dv-link"
            disabled={sending}
            title={AGENT_HANDOFF_DESCRIPTIONS.takeOver}
            onClick={() => command("takeover")}
          >
            {AGENT_HANDOFF_LABELS.takeOver}
          </button>
        )}
        {(correcting || (agentRecording && manual)) && run.uncertainTap && !run.busy && (
          <>
            <p className="dv-muted">
              Inspect the live screen and confirm whether the last action took effect.
            </p>
            <button
              type="button"
              className="dv-link"
              disabled={sending}
              onClick={() =>
                void send({
                  action: "resolve",
                  runId: run.runId,
                  applied: true,
                  ...control,
                })
              }
            >
              It took effect
            </button>
            <button
              type="button"
              className="dv-link"
              disabled={sending}
              onClick={() =>
                void send({
                  action: "resolve",
                  runId: run.runId,
                  applied: false,
                  ...control,
                })
              }
            >
              It did not take effect
            </button>
          </>
        )}
        {correcting && (
          <button
            type="button"
            className="sl-primary"
            disabled={busy || !run.canResume}
            onClick={() => command("resume")}
          >
            Resume replay
          </button>
        )}
        {agentRecording && manual && (
          <button
            type="button"
            className="sl-primary"
            disabled={busy || !run.canResume}
            title={AGENT_HANDOFF_DESCRIPTIONS.returnToAgent}
            onClick={() => command("resume")}
          >
            {AGENT_HANDOFF_LABELS.returnToAgent}
          </button>
        )}
        {manual && correcting && (
          <button
            type="button"
            className="dv-link"
            disabled={busy || !run.canResume}
            onClick={() =>
              void send({
                action: "resume",
                runId: run.runId,
                stepCompleted: true,
                ...control,
              })
            }
          >
            I did this step — resume
          </button>
        )}
        {run.phase !== "completed" && run.phase !== "stopped" && (
          <button
            type="button"
            className="dv-link"
            disabled={sending}
            onClick={() => command("stop")}
          >
            {run.phase === "awaiting_approval" ? "Decline" : "Stop comparison"}
          </button>
        )}
        {(run.phase === "completed" || run.phase === "stopped") && (
          <StartDemonstrationForm
            target={target}
            send={send}
            disabled={busy}
            label="Start new demonstration"
          />
        )}
      </div>
      {failure && (
        <p className="dv-error" role="alert">
          {failure}
        </p>
      )}
    </section>
  );
}
