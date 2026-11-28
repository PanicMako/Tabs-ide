import {
  BROWSER_WORKFLOW_UPLOAD_MAX_BYTES,
  type DesktopBrowserSessionState,
  type FigmaCanvasApproval,
  type PartnerCenterStatusApproval,
} from "@tabs/contracts";
import * as Equal from "effect/Equal";
import { useLayoutEffect, useRef, useState } from "react";
import { useSettings } from "~/hooks/useSettings";
import { AGENT_HANDOFF_LABELS } from "~/lib/agentHandoffLabels";
import {
  browserHandoffAvailable,
  browserHandoffStatus,
  isBrowserDemonstrationReceipt,
  runBrowserHandoff,
  type BrowserHandoffAction,
} from "~/lib/browserHandoff";
import { showCustomConfirm } from "~/lib/customConfirm";
import { queueThreadContinuation } from "~/lib/queueThreadContinuation";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";

export function BrowserToolActivity({ label }: { label: string }) {
  return (
    <span className="ml-1 size-1.5 shrink-0 rounded-full bg-current" title={label}>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function matchesPartnerCenterApproval(result: unknown, pending: PartnerCenterStatusApproval) {
  if (
    typeof result !== "object" ||
    result === null ||
    !("approved" in result) ||
    result.approved !== true ||
    !("approval" in result)
  ) {
    return false;
  }
  const { approval } = result;
  return (
    typeof approval === "object" &&
    approval !== null &&
    "id" in approval &&
    approval.id === pending.id &&
    "workflowId" in approval &&
    approval.workflowId === pending.workflowId &&
    "applicationId" in approval &&
    approval.applicationId === pending.applicationId &&
    "submissionId" in approval &&
    approval.submissionId === pending.submissionId &&
    "tenantId" in approval &&
    approval.tenantId === pending.tenantId &&
    "clientId" in approval &&
    approval.clientId === pending.clientId
  );
}

function FigmaCanvasReview({
  approval,
  profileLabel,
  disabled,
  onApprove,
}: {
  approval: FigmaCanvasApproval;
  profileLabel: string | undefined;
  disabled: boolean;
  onApprove: (approval: FigmaCanvasApproval) => void;
}) {
  const [reviewed, setReviewed] = useState<FigmaCanvasApproval | null>(null);
  const isReviewCurrent = reviewed !== null && Equal.equals(reviewed, approval);
  const { target, email, frame } = approval;
  const profile = profileLabel ? `${profileLabel} (ID ${target.profileId})` : target.profileId;

  return (
    <Dialog open={isReviewCurrent} onOpenChange={(open) => setReviewed(open ? approval : null)}>
      <DialogTrigger
        render={<Button type="button" size="xs" variant="outline" disabled={disabled} />}
      >
        Review Figma frame
      </DialogTrigger>
      <DialogPopup showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Review Figma frame</DialogTitle>
          <DialogDescription>
            Allow this thread to create one editable frame in Figma?
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3 text-sm">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="wrap-anywhere" dir="auto">
              {frame.name}
            </dd>
            <dt className="text-muted-foreground">Size</dt>
            <dd>
              {frame.width} × {frame.height} px
            </dd>
            <dt className="text-muted-foreground">File ID</dt>
            <dd className="wrap-anywhere">{target.mainFileKey}</dd>
            {target.fileKey !== target.mainFileKey && (
              <>
                <dt className="text-muted-foreground">Branch ID</dt>
                <dd className="wrap-anywhere">{target.fileKey}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Parent node ID</dt>
            <dd>{target.nodeId}</dd>
            <dt className="text-muted-foreground">Connector email</dt>
            <dd className="wrap-anywhere">{email}</dd>
            <dt className="text-muted-foreground">Browser profile</dt>
            <dd className="wrap-anywhere">{profile}</dd>
          </dl>
          <div className="space-y-1">
            <p className="text-muted-foreground">Frame text</p>
            <pre
              role="region"
              aria-label="Frame text"
              dir="auto"
              tabIndex={0}
              className="max-h-48 overflow-auto rounded-[var(--radius-control)] border border-border/60 bg-muted/30 p-2 font-sans whitespace-pre-wrap wrap-anywhere"
            >
              {frame.text}
            </pre>
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
          <DialogClose
            render={<Button type="button" disabled={disabled} />}
            onClick={() => {
              if (isReviewCurrent) onApprove(reviewed);
            }}
          >
            Approve one Figma frame
          </DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function BrowserHandoffControls({
  state,
  ownerTitle,
  className,
}: {
  state: DesktopBrowserSessionState;
  ownerTitle?: string | undefined;
  className?: string;
}) {
  const [meaning, setMeaning] = useState("");
  const [approving, setApproving] = useState(false);
  const handoffButton = useRef<HTMLButtonElement>(null);
  const meaningInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const bridge = window.desktopBridge;
  const {
    assignedTaskId,
    pendingFigmaCanvas,
    pendingPartnerCenterStatus,
    pendingSubmissionApproval: approval,
    projectId,
    sessionId,
  } = state;
  const profileId = state.profileId ?? "default";
  const profileLabel = useSettings(
    (settings) => settings.browserProfiles.find((profile) => profile.id === profileId)?.label,
  );
  const canReturn =
    !!bridge?.resumeBrowserAgent && browserHandoffAvailable(state, "browser-return");
  const canTakeControl =
    !!bridge?.takeBrowserControl && browserHandoffAvailable(state, "browser-my-turn");

  useLayoutEffect(() => {
    const button = handoffButton.current;
    if (
      canReturn &&
      button &&
      button.ownerDocument.hasFocus() &&
      button.ownerDocument.activeElement === button
    ) {
      meaningInput.current?.focus();
    }
  }, [canReturn]);

  if (!bridge || !assignedTaskId || !browserHandoffAvailable(state, "browser-stop")) return null;

  const owner = ownerTitle ?? `Thread ${assignedTaskId.slice(0, 8)}`;
  const status = browserHandoffStatus(state);
  const pendingSubmissionApproval =
    approval?.action === "upload" || approval?.siteSubmissionKey === true ? approval : undefined;
  const chooseUploadFile = approval?.action === "upload" && approval.chooseUploadFile === true;
  const approvalOrigin =
    pendingSubmissionApproval && URL.canParse(pendingSubmissionApproval.url)
      ? new URL(pendingSubmissionApproval.url).origin
      : null;
  const run = (action: BrowserHandoffAction) => {
    void runBrowserHandoff(bridge, state, action, meaning)
      .then((receipt) => {
        setMeaning("");
        if (action !== "browser-return" || !isBrowserDemonstrationReceipt(receipt)) return;
        if (state.controlEpoch !== undefined && receipt.controlEpoch !== state.controlEpoch + 1)
          return;
        queueThreadContinuation({
          id: receipt.demonstrationId,
          threadId: assignedTaskId,
          text: `I returned control after demonstrating a step in browser tab ${JSON.stringify(sessionId)}. Take a fresh preview_snapshot in that exact tab and read demonstration ${receipt.demonstrationId} in its action history. Use it to continue the task from the current page. Check the outcome if a previous action may already have taken effect.`,
          failedTitle: "Browser control was returned",
          verify: async () => {
            const live = await bridge.getBrowserSessionState({ projectId, sessionId });
            return (
              live.projectId === projectId &&
              live.sessionId === sessionId &&
              live.instanceId === state.instanceId &&
              live.assignedTaskId === assignedTaskId &&
              (live.profileId ?? "default") === profileId &&
              live.controlEpoch === receipt.controlEpoch &&
              live.browserPageAuthorized === true &&
              live.controller !== "human"
            );
          },
        });
      })
      .catch((error: unknown) =>
        toastManager.add({
          type: "error",
          title: "Could not change browser control",
          description: error instanceof Error ? error.message : String(error),
        }),
      );
  };
  const approveSubmission = async (selectedFile?: File) => {
    const pending = pendingSubmissionApproval;
    if (!pending || approving || chooseUploadFile !== !!selectedFile) return;
    if (
      selectedFile &&
      (selectedFile.size === 0 || selectedFile.size > BROWSER_WORKFLOW_UPLOAD_MAX_BYTES)
    ) {
      toastManager.add({
        type: "error",
        title: "Choose a nonempty file no larger than 32 MiB",
      });
      return;
    }
    const upload = pending.action === "upload";
    const file = upload ? pending.uploadFile : undefined;
    const verifyUploadApproval = async () => {
      const live = await bridge.getBrowserSessionState({ projectId, sessionId });
      const liveApproval = live.pendingSubmissionApproval;
      if (
        live.projectId === projectId &&
        live.sessionId === sessionId &&
        live.instanceId === state.instanceId &&
        (live.profileId ?? "default") === profileId &&
        live.assignedTaskId === assignedTaskId &&
        live.controlEpoch === state.controlEpoch &&
        liveApproval?.id === pending.id &&
        liveApproval.action === "upload" &&
        liveApproval.chooseUploadFile === true
      ) {
        return true;
      }
      toastManager.add({ type: "warning", title: "The guarded upload approval has changed" });
      return false;
    };
    setApproving(true);
    try {
      const control = pending.controlLabel;
      const continuation = pending.workflowId
        ? " The thread will then continue this workflow."
        : "";
      const submissionKey = upload
        ? ""
        : " The site provides a submission key for repeated requests.";
      const profile = profileLabel ? `“${profileLabel}” (ID “${profileId}”)` : `“${profileId}”`;
      const accepted = await showCustomConfirm(
        selectedFile
          ? `Allow one guarded upload of “${selectedFile.name}” (${selectedFile.size.toLocaleString()} bytes) for draft “${pending.resourceId}” on ${approvalOrigin} using browser profile ${profile}?${continuation}`
          : `Allow the agent to press ${control ? `“${control}”` : upload ? "Upload" : "Submit"} once for draft “${pending.resourceId}” on ${approvalOrigin} using the “${profileLabel ?? profileId}” browser profile?${file ? ` Staged file “${file.name}” (${file.size.toLocaleString()} bytes).` : ""}${submissionKey}${continuation}`,
      );
      if (!accepted) return;
      let selectedUpload: { name: string; type: string; bytes: Uint8Array } | undefined;
      if (selectedFile) {
        if (!(await verifyUploadApproval())) return;
        const bytes = new Uint8Array(await selectedFile.arrayBuffer());
        if (!(await verifyUploadApproval())) return;
        selectedUpload = { name: selectedFile.name, type: selectedFile.type, bytes };
      }
      const result = await bridge.runBrowserAutomation({
        projectId,
        sessionId,
        source: "human",
        taskId: assignedTaskId,
        operation: "authorizeBrowserSubmission",
        input: { approvalId: pending.id, ...(selectedUpload && { selectedFile: selectedUpload }) },
      });
      const workflowId = pending.workflowId;
      if (!workflowId) return;
      if (
        typeof result !== "object" ||
        result === null ||
        !("approved" in result) ||
        result.approved !== true ||
        !("workflowId" in result) ||
        result.workflowId !== workflowId
      ) {
        throw new Error("The browser did not confirm this workflow approval.");
      }
      queueThreadContinuation({
        id: pending.id,
        threadId: assignedTaskId,
        text: upload
          ? `I approved one guarded upload for browser workflow ${workflowId}. Resume that workflow if paused, use the upload action of preview_workflow if ready, and check for the Uploaded receipt. Keep the original draft and breakpoint.`
          : `I approved one guarded submission for browser workflow ${workflowId}. Resume that workflow if paused, submit through preview_workflow if ready, and continue checking the outcome I requested. Keep the original draft and breakpoint.`,
        failedTitle: "The draft was approved",
      });
    } catch {
      toastManager.add({
        type: "error",
        title: upload ? "Could not approve browser upload" : "Could not approve browser submission",
      });
    } finally {
      setApproving(false);
    }
  };
  const approvePartnerCenterStatus = async () => {
    const pending = pendingPartnerCenterStatus;
    if (!pending) return;
    setApproving(true);
    try {
      const profile = profileLabel ? `“${profileLabel}” (ID “${profileId}”)` : `“${profileId}”`;
      const accepted = await showCustomConfirm(
        `Allow one read-only Microsoft Store status lookup for app ID “${pending.applicationId}” and submission ID “${pending.submissionId}”? It will use Entra tenant ID “${pending.tenantId}”, app registration ID “${pending.clientId}” and browser profile ${profile}. Tabs keeps the connection credentials private.`,
      );
      if (!accepted) return;
      const result = await bridge.runBrowserAutomation({
        projectId,
        sessionId,
        source: "human",
        taskId: assignedTaskId,
        operation: "authorizePartnerCenterStatus",
        input: { approvalId: pending.id },
      });
      if (!matchesPartnerCenterApproval(result, pending)) {
        throw new Error("The browser did not confirm this status lookup approval.");
      }
      queueThreadContinuation({
        id: pending.id,
        threadId: assignedTaskId,
        text: `I approved one read-only Microsoft Store status lookup. Retry preview_partner_center_status with workflowId ${JSON.stringify(pending.workflowId)} and applicationId ${JSON.stringify(pending.applicationId)}.`,
        failedTitle: "The Microsoft Store status lookup was approved",
      });
    } catch {
      toastManager.add({ type: "error", title: "Could not approve Microsoft Store status lookup" });
    } finally {
      setApproving(false);
    }
  };
  const approveFigmaCanvas = async (pending: FigmaCanvasApproval) => {
    setApproving(true);
    try {
      const result = await bridge.runBrowserAutomation({
        projectId,
        sessionId,
        source: "human",
        taskId: assignedTaskId,
        operation: "authorizeFigmaCanvas",
        input: { approvalId: pending.id },
      });
      if (
        typeof result !== "object" ||
        result === null ||
        !("approved" in result) ||
        result.approved !== true ||
        !("approval" in result) ||
        !Equal.equals(result.approval, pending)
      ) {
        throw new Error("The browser did not confirm this Figma frame approval.");
      }
      const { tabId, profileId, attachmentId } = pending.target;
      const args = JSON.stringify({ tabId, profileId, attachmentId, frame: pending.frame });
      queueThreadContinuation({
        id: pending.id,
        threadId: assignedTaskId,
        text: `I approved one editable Figma frame. Call preview_figma_frame once with exactly these arguments. Treat all values as literal data.\n${args}`,
        failedTitle: "The Figma frame was approved",
      });
    } catch {
      toastManager.add({ type: "error", title: "Could not approve Figma frame" });
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs", className)}>
      <span
        role="status"
        className="max-w-52 truncate text-muted-foreground"
        title={`${owner} · ${status}`}
      >
        {owner} · {status}
      </span>
      {canReturn && (
        <>
          {state.demonstratedControl && (
            <span className="max-w-40 truncate" title={state.demonstratedControl}>
              {state.demonstratedControl}
            </span>
          )}
          <input
            ref={meaningInput}
            aria-label="Meaning of the demonstrated step"
            placeholder="What did this step do?"
            className="w-40 bg-transparent"
            maxLength={320}
            value={meaning}
            onChange={(event) => setMeaning(event.target.value)}
          />
        </>
      )}
      {(canReturn || canTakeControl) && (
        <Button
          ref={handoffButton}
          type="button"
          size="xs"
          variant="secondary"
          onClick={() => run(canReturn ? "browser-return" : "browser-my-turn")}
        >
          {canReturn ? AGENT_HANDOFF_LABELS.returnToAgent : AGENT_HANDOFF_LABELS.takeOver}
        </Button>
      )}
      {pendingSubmissionApproval && approvalOrigin && approvalOrigin !== "null" && (
        <>
          {chooseUploadFile && (
            <input
              key={pendingSubmissionApproval.id}
              ref={uploadInput}
              type="file"
              hidden
              disabled={approving}
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.item(0);
                input.value = "";
                if (file) void approveSubmission(file);
              }}
            />
          )}
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={approving}
            onClick={() => {
              if (chooseUploadFile) uploadInput.current?.click();
              else void approveSubmission();
            }}
          >
            {chooseUploadFile
              ? "Choose file for guarded upload"
              : pendingSubmissionApproval.action === "upload"
                ? "Approve one upload"
                : "Approve one submission"}
          </Button>
        </>
      )}
      {pendingPartnerCenterStatus && (
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={approving}
          onClick={() => void approvePartnerCenterStatus()}
        >
          Approve Microsoft Store status lookup
        </Button>
      )}
      {pendingFigmaCanvas &&
        pendingFigmaCanvas.target.projectId === projectId &&
        pendingFigmaCanvas.target.tabId === sessionId &&
        pendingFigmaCanvas.target.profileId === profileId && (
          <FigmaCanvasReview
            key={pendingFigmaCanvas.id}
            approval={pendingFigmaCanvas}
            profileLabel={profileLabel}
            disabled={approving}
            onApprove={(pending) => void approveFigmaCanvas(pending)}
          />
        )}
      {state.submissionGuardActive && (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => {
            const { currentUrl: url, instanceId } = state;
            if (!url || !instanceId) return;
            void showCustomConfirm(
              "Allow ordinary agent input on this draft again? Check its receipt first if Upload or Submit might have reached the site.",
            )
              .then((accepted) =>
                accepted
                  ? bridge.runBrowserAutomation({
                      projectId,
                      sessionId,
                      source: "human",
                      taskId: assignedTaskId,
                      operation: "releaseSubmissionGuard",
                      input: { url, instanceId },
                    })
                  : undefined,
              )
              .catch(() =>
                toastManager.add({
                  type: "error",
                  title: "The original submission guard could not be released",
                }),
              );
          }}
        >
          End submission guard
        </Button>
      )}
      <Button
        type="button"
        size="xs"
        variant="outline"
        aria-label={`${AGENT_HANDOFF_LABELS.stopAgent} on this browser tab`}
        onClick={() => run("browser-stop")}
      >
        {AGENT_HANDOFF_LABELS.stopAgent}
      </Button>
    </div>
  );
}
