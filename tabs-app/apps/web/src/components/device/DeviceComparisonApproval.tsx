import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  DeviceComparisonEvidenceApproval,
  type DeviceComparisonReport,
  type ThreadId,
} from "@tabs/contracts";
import { isUserBrowserTab } from "@tabs/shared/preview";
import * as Schema from "effect/Schema";
import { isPrimaryEnvironment } from "~/connection/environmentApiRegistry";
import { useSettings } from "~/hooks/useSettings";
import { AGENT_APPROVAL_LABEL, approvalSummary, totalCheckOf } from "./deviceComparisonShared";
import { TotalCheckNote } from "./TotalCheckNote";
import type { useDeviceComparison } from "./useDeviceComparison";

export function DeviceComparisonApproval({
  run,
  target,
  threadId,
  projectId,
  environmentId,
  disabled,
  send,
}: {
  run: DeviceComparisonReport;
  target: NonNullable<DeviceComparisonReport["target"]>;
  threadId: ThreadId;
  projectId?: string | undefined;
  environmentId?: string | null | undefined;
  disabled: boolean;
  send: ReturnType<typeof useDeviceComparison>["send"];
}) {
  const destination = run.agentRecording?.evidenceDestination;
  const { tabId, profileId, instanceId, pageRef } = destination ?? {};
  const bridge = window.desktopBridge;
  const local = isPrimaryEnvironment(environmentId ?? undefined);
  const profiles = useSettings((settings) => settings.browserProfiles);
  const [refresh, setRefresh] = useState(0);
  const [draft, setDraft] = useState<{
    key: string;
    url: string;
    title: string;
    pageApprovalToken: string | undefined;
  }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [retryState, setRetry] = useState<{
    key: string;
    approvalRequestId: string;
    evidence: typeof DeviceComparisonEvidenceApproval.Type;
  }>();
  const key = JSON.stringify([
    environmentId,
    projectId,
    threadId,
    run.runId,
    tabId,
    profileId,
    instanceId,
    pageRef,
    local,
    refresh,
  ]);
  const reviewed = draft?.key === key ? draft : undefined;
  const retry = retryState?.key === key ? retryState : undefined;
  const activeReview = useRef<AbortSignal>(null);

  useLayoutEffect(() => {
    const review = new AbortController();
    activeReview.current = review.signal;
    return () => review.abort();
  }, [bridge, key]);

  useEffect(() => {
    if (!bridge || !local || !projectId || !tabId || !isUserBrowserTab(tabId)) return;
    let disposed = false;
    void bridge
      .getBrowserSessionState({ projectId, sessionId: tabId })
      .then((state) => {
        if (disposed) return;
        if (
          state.projectId === projectId &&
          state.sessionId === tabId &&
          state.assignedTaskId === threadId &&
          state.browserPageAuthorized &&
          state.controller !== "human" &&
          !state.loading &&
          !state.resting &&
          state.instanceId === instanceId &&
          state.pageRef === pageRef &&
          (state.profileId ?? "default") === profileId &&
          state.currentUrl &&
          /^https?:\/\//i.test(state.currentUrl) &&
          URL.canParse(state.currentUrl)
        ) {
          setDraft({
            key,
            url: state.currentUrl,
            title: state.pageTitle ?? "",
            pageApprovalToken: state.pageApprovalToken,
          });
        } else setDraft(undefined);
      })
      .catch(() => {
        if (!disposed) setDraft(undefined);
      });
    return () => {
      disposed = true;
    };
  }, [bridge, instanceId, key, local, pageRef, profileId, projectId, tabId, threadId]);

  const approve = async () => {
    if (!bridge || !projectId || !destination || !local || pending || disabled) return;
    const review = activeReview.current;
    if (!review || review.aborted || (!retry && !reviewed)) return;
    setPending(true);
    setError(undefined);
    const { tabId, profileId, pageRef, instanceId } = destination;
    const { runId, source } = run;
    const approvalRequestId = retry?.approvalRequestId ?? crypto.randomUUID();
    const args = {
      projectId,
      sessionId: tabId,
      taskId: threadId,
      source: "human" as const,
    };
    const sourceDevice = { hostId: source.hostId, deviceId: source.deviceId };
    const targetDevice = { hostId: target.hostId, deviceId: target.deviceId };
    try {
      let evidence = retry?.evidence;
      if (!evidence && reviewed) {
        const receipt = await bridge.runBrowserAutomation({
          ...args,
          operation: "authorizeDeviceComparisonEvidence",
          input: {
            url: reviewed.url,
            profileId,
            pageRef,
            instanceId,
            ...(reviewed.pageApprovalToken !== undefined
              ? { pageApprovalToken: reviewed.pageApprovalToken }
              : {}),
            runId,
            source: sourceDevice,
            target: targetDevice,
          },
        });
        evidence = Schema.decodeUnknownSync(DeviceComparisonEvidenceApproval)({
          tabId,
          grantIds:
            typeof receipt === "object" && receipt !== null && "grantIds" in receipt
              ? receipt.grantIds
              : undefined,
        });
      }
      if (!evidence) {
        setPending(false);
        return;
      }
      let unconfirmed = Boolean(retry);
      if (!review.aborted) {
        const response = await send(
          {
            action: "approveAgentRecording",
            runId,
            approvalRequestId,
            evidence,
          },
          () => {
            unconfirmed = true;
          },
        );
        if (
          response?.run?.runId === runId &&
          response.run.approvalId === approvalRequestId &&
          response.run.phase !== "stopped"
        ) {
          if (review.aborted) setPending(false);
          return;
        }
      }
      if (unconfirmed && !review.aborted) {
        setRetry({ key, approvalRequestId, evidence });
        setError("Approval could not be confirmed. Retry the same approval.");
      } else if (!unconfirmed) {
        await bridge.runBrowserAutomation({
          ...args,
          operation: "revokeDeviceScreenshot",
          input: { grantIds: evidence.grantIds },
        });
      }
      setPending(false);
    } catch (cause) {
      if (!review.aborted) {
        setDraft(undefined);
        setError(
          cause instanceof Error ? cause.message : "Could not approve evidence for this draft.",
        );
      }
      setPending(false);
    }
  };

  const address = reviewed ? new URL(reviewed.url) : undefined;
  const profile = profiles.find((item) => item.id === profileId)?.label ?? profileId;
  const attaching = destination !== undefined && (retry !== undefined || reviewed !== undefined);
  const draftTitle = reviewed ? reviewed.title || address?.pathname : undefined;
  const summary = approvalSummary({
    source: run.source,
    target,
    total: run.agentRecording?.total !== undefined,
    ...(attaching ? { draft: draftTitle ?? "the attached draft", profile } : {}),
  });
  const devicesOnly = (
    <button
      type="button"
      className={attaching ? "dv-link" : "sl-primary"}
      disabled={disabled || pending || retry !== undefined}
      onClick={() => void send({ action: "approveAgentRecording", runId: run.runId })}
    >
      {attaching ? "Approve devices only" : AGENT_APPROVAL_LABEL}
    </button>
  );
  return (
    <>
      <p>{summary}</p>
      <TotalCheckNote check={totalCheckOf(run)} />
      {destination &&
        (retry ? (
          <button
            type="button"
            className="sl-primary"
            disabled={disabled || pending}
            onClick={() => void approve()}
          >
            Send approval again
          </button>
        ) : reviewed && address ? (
          <>
            <dl className="dv-comparison-form">
              <div>
                <dt>Draft for first-difference screenshots</dt>
                <dd>{reviewed.title || address.pathname}</dd>
                <dd>
                  {address.origin}
                  {address.pathname} · {profile}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              className="sl-primary"
              disabled={disabled || pending}
              onClick={() => void approve()}
            >
              {AGENT_APPROVAL_LABEL}
            </button>
          </>
        ) : (
          <>
            <p>
              Open the attached draft in its original profile and allow this thread to use that tab.
            </p>
            {bridge && local && projectId && (
              <button
                type="button"
                className="dv-link"
                disabled={disabled || pending}
                onClick={() => {
                  setError(undefined);
                  setRefresh(refresh + 1);
                }}
              >
                Check draft again
              </button>
            )}
          </>
        ))}
      {devicesOnly}
      {error && (
        <p className="dv-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
