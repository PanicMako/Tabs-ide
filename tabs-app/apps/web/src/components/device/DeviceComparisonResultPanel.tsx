import { useEffect, useState } from "react";
import type {
  DeviceComparisonStatus,
  DeviceComparisonViewRef,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@tabs/contracts";
import { environmentApi } from "~/connection/environmentApiRegistry";
import {
  findComparisonDeviceTab,
  openDeviceComparisonResult,
  openLiveComparisonTarget,
  restoreDeviceComparison,
} from "~/device/comparisonResult";
import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import { DeviceComparisonDraftLink } from "./DeviceComparisonDraftLink";
import { DeviceComparisonScreens } from "./DeviceComparisonEvidence";
import { LiveComparisonTargetButton, RestorePausedReplayButton } from "./DeviceComparisonRestore";
import { RecordedSteps } from "./DeviceComparisonSteps";
import { TotalCheckNote } from "./TotalCheckNote";
import { deviceKey, reason, totalCheckOf } from "./deviceComparisonShared";

export function DeviceComparisonResultPanel({
  environmentId,
  projectId,
  threadId,
  reference,
  visible,
}: {
  environmentId: EnvironmentId;
  projectId?: ProjectId | undefined;
  threadId: ThreadId;
  reference: DeviceComparisonViewRef;
  visible: boolean;
}) {
  const { runId, step } = reference;
  const resultKey = JSON.stringify([environmentId, threadId, runId, step]);
  const [loaded, setLoaded] = useState<{
    key: string;
    response: DeviceComparisonStatus;
  }>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const response = loaded?.key === resultKey ? loaded.response : undefined;
  const run = response?.run;
  const differenceStep = run?.firstDifference?.step;
  const restoreTarget = run?.target;
  const scope = `${environmentId}:${threadId}`;
  const originalTabsOpen = useCompanionSurfaceStore((surfaces) =>
    Boolean(
      run?.target &&
      findComparisonDeviceTab(scope, run.source, surfaces) &&
      findComparisonDeviceTab(scope, run.target, surfaces),
    ),
  );
  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const api = await environmentApi(environmentId);
        if (disposed) return;
        const current = await api.device.comparison({
          action: step === undefined ? "status" : "evidence",
          threadId,
          runId,
        });
        if (disposed) return;
        const run = current.run;
        if (run?.runId === runId && run.busy) {
          timer = setTimeout(() => void load(), 500);
        } else if (
          run?.runId !== runId ||
          (step === undefined
            ? run.phase !== "completed" || !run.target
            : run.firstDifference?.step !== step)
        ) {
          setError(
            step === undefined
              ? "This comparison result is no longer available in this thread."
              : "This first difference is no longer available in this thread.",
          );
        } else {
          setLoaded({ key: resultKey, response: current });
        }
      } catch (cause) {
        if (!disposed) setError(reason(cause));
      }
    };
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [environmentId, threadId, runId, step, visible, attempt, resultKey]);
  return (
    <div className="dv-panel">
      {error ? (
        <section className="dv-comparison" aria-label="Device comparison">
          <p className="dv-error" role="alert">
            {error}
          </p>
          <button
            type="button"
            className="dv-link"
            onClick={() => {
              setError(undefined);
              setAttempt(attempt + 1);
            }}
          >
            Try again
          </button>
        </section>
      ) : response?.run ? (
        <section className="dv-comparison" aria-label="Device comparison">
          {response.run.phase === "completed" && (
            <p role="status">
              {response.run.completedSteps} of {response.run.steps.length} steps completed.
            </p>
          )}
          {response.run.phase === "completed" && (
            <TotalCheckNote
              check={totalCheckOf(response.run)}
              suggest={response.run.suggestTotalCheck === true}
            />
          )}
          {step === undefined ? (
            <>
              {differenceStep !== undefined ? (
                <button
                  type="button"
                  className="dv-link"
                  onClick={() =>
                    openDeviceComparisonResult(environmentId, threadId, {
                      runId,
                      step: differenceStep,
                    })
                  }
                >
                  Open first difference · Step {differenceStep}
                </button>
              ) : (
                <p>No difference found in the recorded steps.</p>
              )}
              <ul className="grid gap-2">
                {[response.run.source, response.run.target].map(
                  (device) =>
                    device && (
                      <li key={deviceKey(device)} title={`${device.hostId} · ${device.deviceId}`}>
                        {device.name}
                        <p className="dv-muted">{device.appId}</p>
                      </li>
                    ),
                )}
              </ul>
            </>
          ) : (
            <DeviceComparisonScreens run={response.run} images={response.evidence} showIdentity />
          )}
          {visible && response.liveTargetAvailable && response.run.target && (
            <LiveComparisonTargetButton
              environmentId={environmentId}
              threadId={threadId}
              reference={reference}
              target={response.run.target}
            />
          )}
          {visible && step !== undefined && response.canRestoreReplay && run && restoreTarget && (
            <>
              <RestorePausedReplayButton
                key={resultKey}
                runId={runId}
                target={restoreTarget}
                disabled={!originalTabsOpen}
                restore={async (request, isCurrent) => {
                  const { device } = await environmentApi(environmentId);
                  if (!isCurrent()) return;
                  if (
                    !findComparisonDeviceTab(scope, run.source) ||
                    !findComparisonDeviceTab(scope, restoreTarget)
                  )
                    throw new Error("Reopen both original device tabs in this thread first.");
                  const restored = await restoreDeviceComparison(device, {
                    ...request,
                    threadId,
                  });
                  if (!isCurrent()) return;
                  if (restored.run?.runId !== runId || restored.run.phase !== "paused")
                    throw new Error("The saved replay is no longer paused in this thread.");
                  await openLiveComparisonTarget(
                    environmentId,
                    threadId,
                    reference,
                    restoreTarget,
                    isCurrent,
                  );
                }}
              />
              {!originalTabsOpen && (
                <p className="dv-muted">Reopen both original devices in this thread to restore.</p>
              )}
            </>
          )}
          {visible &&
            projectId &&
            step !== undefined &&
            response.run.availableEvidence?.source &&
            response.run.availableEvidence.target && (
              <DeviceComparisonDraftLink
                key={JSON.stringify([environmentId, projectId, threadId, runId, step])}
                environmentId={environmentId}
                projectId={projectId}
                threadId={threadId}
                reference={{ runId, step }}
              />
            )}
          <RecordedSteps steps={response.run.steps} />
        </section>
      ) : (
        <p className="dv-page dv-muted" role="status">
          {step === undefined ? "Loading comparison result…" : "Loading first difference…"}
        </p>
      )}
    </div>
  );
}
