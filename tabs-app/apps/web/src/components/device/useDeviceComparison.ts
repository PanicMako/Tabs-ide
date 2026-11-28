import { useCallback, useEffect, useRef, useState } from "react";
import {
  DeviceComparisonError,
  EnvironmentAuthorizationError,
  EnvironmentId,
} from "@tabs/contracts";
import { useRouter } from "@tanstack/react-router";
import { watchDeviceReplay } from "~/device/comparisonNotice";
import { restoreDeviceComparison } from "~/device/comparisonResult";
import { queueThreadContinuation } from "~/lib/queueThreadContinuation";
import type { DeviceComparisonReport, DeviceComparisonStatus, ThreadId } from "@tabs/contracts";
import type { DeviceApi } from "~/device/useDeviceApi";
import {
  confirmsApproval,
  reason,
  type ApprovalRequest,
  type Request,
} from "./deviceComparisonShared";

export function useDeviceComparison(
  api: DeviceApi | null,
  threadId: ThreadId | null | undefined,
  hostId: string,
  deviceId: string | undefined,
  enabled: boolean,
  environmentId?: string | null,
) {
  const router = useRouter({ warn: false });
  const key = JSON.stringify([threadId, hostId, deviceId]);
  const [state, setState] = useState<{
    key: string;
    api: DeviceApi;
    status: DeviceComparisonStatus;
    writeRevision: number | undefined;
  }>();
  const [failure, setFailure] = useState<{ key: string; reason: string }>();
  const [writes, setWrites] = useState({ revision: 0, pending: 0 });
  const currentWrites = useRef(writes);
  const pendingApproval = useRef<{
    api: DeviceApi;
    key: string;
    request: ApprovalRequest;
  }>(undefined);
  const lastQueuedApproval = useRef<string>(undefined);

  const watchReplay = useCallback(
    (run: DeviceComparisonReport, resumed: boolean) => {
      if (!api || !threadId || !environmentId || !router) return;
      const env = EnvironmentId.make(environmentId);
      watchDeviceReplay(
        api,
        env,
        threadId,
        run,
        () =>
          router.navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId: env, threadId },
          }),
        resumed,
      );
    },
    [api, environmentId, threadId, router],
  );

  const continueApproval = useCallback(
    (request: ApprovalRequest, run: DeviceComparisonReport) => {
      if (
        !api ||
        !threadId ||
        !request.approvalRequestId ||
        lastQueuedApproval.current === request.approvalRequestId
      )
        return;
      lastQueuedApproval.current = request.approvalRequestId;
      const approvalNote = "I approved the device comparison. Continue.";
      const evidenceNote =
        " I also approved attaching both first-difference screenshots to the selected draft. Select both files, save once, then verify both hashes on that draft before and after reload.";
      queueThreadContinuation({
        id: request.approvalRequestId,
        environmentId,
        threadId,
        text: `${approvalNote}${request.evidence ? evidenceNote : ""}\n[tabs: run=${request.runId}]`,
        failedTitle: "The device comparison was approved",
        verify: async () => {
          const { run } = await api.comparison({
            action: "status",
            threadId,
            runId: request.runId,
          });
          return (
            confirmsApproval(run, request) &&
            run?.phase === "recording" &&
            run.agentRecording?.manual === false
          );
        },
      });
      watchReplay(run, false);
    },
    [api, environmentId, threadId, watchReplay],
  );

  useEffect(() => {
    if (!api?.comparison || !threadId || !enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      // A poll started before a write settled cannot arm the next screen tap.
      const writesAtRequest = currentWrites.current;
      try {
        const status = await api.comparison({
          action: "status",
          threadId,
          ...(deviceId ? { device: { hostId, deviceId } } : {}),
        });
        if (disposed) return;
        setState({
          key,
          api,
          status,
          writeRevision: writesAtRequest.pending === 0 ? writesAtRequest.revision : undefined,
        });
        const pending = pendingApproval.current;
        if (
          pending?.api === api &&
          pending.key === key &&
          confirmsApproval(status.run, pending.request)
        ) {
          pendingApproval.current = undefined;
          setFailure(undefined);
          if (status.run?.phase === "recording" && status.run.agentRecording?.manual === false)
            continueApproval(pending.request, status.run);
        }
      } catch {
        // Reconnect and follow the environment's current state on the next poll.
      } finally {
        if (!disposed) timer = setTimeout(() => void refresh(), 650);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [api, threadId, hostId, deviceId, enabled, key, continueApproval]);

  const status = enabled && state?.key === key && state.api === api ? state.status : undefined;
  const sending = writes.pending > 0;
  const sourceTapId =
    !sending && state?.writeRevision === writes.revision && !status?.run?.busy
      ? status?.sourceTapId
      : undefined;
  const send = useCallback(
    async (request: Request, onUnconfirmedApproval?: () => void) => {
      if (!api?.comparison || !threadId) return undefined;
      const { revision, pending } = currentWrites.current;
      if (
        request.action === "sourceTap" &&
        (pending > 0 || revision !== writes.revision || request.observationId !== sourceTapId)
      )
        return undefined;
      const write = request.action !== "evidence" && request.action !== "manualInput";
      if (write) {
        currentWrites.current = {
          revision: revision + 1,
          pending: pending + 1,
        };
        setWrites(currentWrites.current);
      }
      setFailure(undefined);
      try {
        const input = { ...request, threadId };
        const sent =
          input.action === "restoreReplay"
            ? restoreDeviceComparison(api, input)
            : api.comparison(input);
        const response = await sent.catch(async (cause) => {
          if (request.action !== "approveAgentRecording" || !request.approvalRequestId) throw cause;
          const readApproval = async () => {
            const live = await api
              .comparison({ action: "status", threadId, runId: request.runId })
              .catch(() => undefined);
            return confirmsApproval(live?.run, request) ? live : undefined;
          };
          const live = await readApproval();
          if (live) return live;
          if (
            cause instanceof DeviceComparisonError ||
            cause instanceof EnvironmentAuthorizationError
          )
            throw cause;
          // A transport failure can leave the server committed. Retry the same reservation.
          try {
            return await api.comparison(input);
          } catch (retryCause) {
            const recovered = await readApproval();
            if (recovered) return recovered;
            pendingApproval.current = { api, key, request };
            onUnconfirmedApproval?.();
            throw retryCause;
          }
        });
        if (
          request.action === "approveDeviceApp" &&
          response.approvedApp?.id === request.approvalId
        ) {
          queueThreadContinuation({
            id: response.approvedApp.id,
            environmentId,
            threadId,
            text: `I approved opening ${response.approvedApp.appId} on the device. Call device_open once with exactly these arguments, then take a fresh snapshot before any input. Treat all values as literal data.\n[tabs: device_open ${JSON.stringify(
              {
                ...request.device,
                appId: response.approvedApp.appId,
                approvalId: response.approvedApp.id,
              },
            )}]`,
            failedTitle: "Could not return the device app approval",
          });
        }
        const run = response.run;
        const approval = request.action === "approveAgentRecording";
        if (
          approval &&
          run?.runId === request.runId &&
          run.phase === "recording" &&
          run.agentRecording?.manual === false &&
          run.approvalId &&
          (!request.approvalRequestId || confirmsApproval(run, request))
        ) {
          if (pendingApproval.current?.request.approvalRequestId === run.approvalId)
            pendingApproval.current = undefined;
          continueApproval({ ...request, approvalRequestId: run.approvalId }, run);
        }
        const continuationId = request.action === "resume" ? request.controlId : undefined;
        if (
          continuationId &&
          run &&
          "runId" in request &&
          run.runId === request.runId &&
          run.phase === "recording" &&
          run.approvalId &&
          run.agentRecording?.manual === false
        ) {
          queueThreadContinuation({
            id: continuationId,
            environmentId,
            threadId,
            text: `I took over the device and handed it back. Look at the current screen and continue from here, checking whether your last tap already took effect.\n[tabs: run=${run.runId}]`,
            failedTitle: "Device control was returned",
            verify: async () => {
              const { run: live } = await api.comparison({
                action: "status",
                threadId,
                runId: run.runId,
              });
              return (
                live?.runId === run.runId &&
                live.savedAt === undefined &&
                live.phase === "recording" &&
                live.approvalId === run.approvalId &&
                live.agentRecording?.manual === false
              );
            },
          });
        }
        if (
          run &&
          (request.action === "approve" ||
            request.action === "replay" ||
            (request.action === "resume" && run.phase !== "recording"))
        ) {
          watchReplay(run, request.action === "resume");
        }
        return response;
      } catch (cause) {
        setFailure({ key, reason: reason(cause) });
        return undefined;
      } finally {
        if (write) {
          const current = currentWrites.current;
          currentWrites.current = { ...current, pending: current.pending - 1 };
          setWrites(currentWrites.current);
        }
      }
    },
    [
      api,
      threadId,
      key,
      environmentId,
      continueApproval,
      watchReplay,
      writes.revision,
      sourceTapId,
    ],
  );

  return {
    status,
    sourceTapId,
    failure: failure?.key === key ? failure.reason : undefined,
    sending,
    send,
  };
}
