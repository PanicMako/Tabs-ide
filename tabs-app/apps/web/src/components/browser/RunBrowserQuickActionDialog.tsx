import { useCallback, useEffect, useRef, useState } from "react";
import {
  BrowserQuickActionVerifiedRepair,
  type BrowserQuickAction,
  type BrowserQuickActionPauseRef,
  type BrowserQuickActionResult,
  type BrowserQuickActionTarget,
  type EnvironmentId,
} from "@tabs/contracts";
import * as Schema from "effect/Schema";
import { browserQuickActionParameters } from "@tabs/shared/browserQuickAction";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { toastManager } from "~/components/ui/toast";
import { queueThreadContinuation } from "~/lib/queueThreadContinuation";
import { saveVerifiedBrowserQuickActionRepair } from "~/lib/browserQuickActionRepair";

const isVerifiedRepair = Schema.is(BrowserQuickActionVerifiedRepair);

function quickActionInstructions(tabId: string, actionId: string, approvalId: string) {
  return `Run this approved project browser action once using preview_run_quick_action with ${JSON.stringify(
    { tabId, actionId, approvalId },
  )}.`;
}

export function RunBrowserQuickActionDialog({
  projectId,
  initialAction,
  threads,
  currentThreadId,
  requestEnvironmentId,
  pauseRequest,
  onClose,
}: {
  projectId: string;
  initialAction: BrowserQuickAction;
  threads: readonly { id: string; title: string }[];
  currentThreadId: string | null;
  requestEnvironmentId?: EnvironmentId;
  pauseRequest?: BrowserQuickActionPauseRef | undefined;
  onClose: () => void;
}) {
  const bridge = window.desktopBridge;
  const [action, setAction] = useState(initialAction);
  const [targets, setTargets] = useState<BrowserQuickActionTarget[] | null>(null);
  const [selection, setSelection] = useState<Pick<
    BrowserQuickActionTarget,
    "sessionId" | "token"
  > | null>(null);
  const [taskId, setTaskId] = useState(currentThreadId);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"run" | "approval" | "pick" | "resolve" | null>(null);
  const [result, setResult] = useState<BrowserQuickActionResult | null>(null);
  const [error, setError] = useState("");
  const selectedTarget = targets?.find(
    (entry) => entry.sessionId === (pauseRequest?.tabId ?? selection?.sessionId),
  );
  const reviewingAgentRun = requestEnvironmentId !== undefined && !pauseRequest;
  const tabChanged =
    reviewingAgentRun && selection !== null && selectedTarget?.token !== selection.token;
  const target = tabChanged ? undefined : selectedTarget;
  const pausedAt = target?.pausedAt;
  const unconfirmedStepId = target?.unconfirmedStepId;
  const repairAt = target?.repairAt ?? pausedAt;
  const lockedParameters = target?.lockedParameters ?? [];
  const editableParameters = browserQuickActionParameters(action, pausedAt).filter(
    (parameter) => !lockedParameters.includes(parameter),
  );
  const ready = editableParameters.every((parameter) => Object.hasOwn(values, parameter));
  const allowsThread =
    threads.some((thread) => thread.id === taskId) &&
    (!requestEnvironmentId || taskId === currentThreadId) &&
    (!target?.assignedTaskId || taskId === target.assignedTaskId) &&
    (!target?.pauseOwner || taskId === target.pauseOwner.taskId);
  const canResolveStep = !busy && !target?.running && (!target?.pauseOwner || allowsThread);
  const pauseInput = pauseRequest ? { pauseId: pauseRequest.pauseId } : {};
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    const sequence = ++requestSequence.current;
    try {
      const response = (await bridge.runBrowserAutomation({
        source: "human",
        projectId,
        operation: "listQuickActionTargets",
        input: { action },
      })) as BrowserQuickActionTarget[];
      if (sequence === requestSequence.current)
        setTargets(
          pauseRequest
            ? response.filter(
                (entry) =>
                  entry.sessionId === pauseRequest.tabId &&
                  entry.profileId === pauseRequest.profileId &&
                  entry.pauseOwner?.pauseId === pauseRequest.pauseId &&
                  entry.pauseOwner.taskId === currentThreadId,
              )
            : response,
        );
    } catch (cause) {
      if (sequence === requestSequence.current)
        setError(cause instanceof Error ? cause.message : "Could not load browser tabs.");
    }
  }, [action, bridge, currentThreadId, pauseRequest, projectId]);

  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = bridge?.onBrowserSessionState((state) => {
      if (state.projectId !== projectId || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        void refresh();
      }, 150);
    });
    return () => {
      requestSequence.current++;
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [refresh, bridge, projectId]);

  const resolveStep = async (applied: boolean) => {
    if (!bridge || !target || unconfirmedStepId === undefined || !canResolveStep) return;
    const pauseId = pauseRequest?.pauseId ?? target.pauseOwner?.pauseId;
    setBusy("resolve");
    setError("");
    try {
      await bridge.runBrowserAutomation({
        source: "human",
        projectId,
        sessionId: target.sessionId,
        ...(target.pauseOwner ? { taskId: target.pauseOwner.taskId } : {}),
        operation: "resolveQuickActionStep",
        input: {
          action,
          token: target.token,
          ...(pauseId !== undefined ? { pauseId } : {}),
          unconfirmedStepId,
          applied,
        },
      });
      setResult(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not confirm whether the step took effect.",
      );
    } finally {
      await refresh();
      setBusy(null);
    }
  };

  const run = async (authorize: boolean) => {
    if (
      !bridge ||
      !target ||
      !ready ||
      busy ||
      unconfirmedStepId !== undefined ||
      (authorize && !allowsThread)
    )
      return;
    setBusy(authorize ? "approval" : "run");
    setError("");
    setResult(null);
    try {
      const response = await bridge.runBrowserAutomation({
        source: "human",
        projectId,
        sessionId: target.sessionId,
        ...(authorize && taskId ? { taskId } : {}),
        operation: authorize ? "authorizeQuickAction" : "runQuickAction",
        input: {
          action,
          token: target.token,
          resume: pausedAt !== undefined,
          values: Object.fromEntries(
            editableParameters.map((parameter) => [parameter, values[parameter]]),
          ),
          ...pauseInput,
        },
      });
      if (authorize) {
        setValues({});
        if (requestEnvironmentId && taskId) {
          if (
            typeof response !== "object" ||
            response === null ||
            !("id" in response) ||
            typeof response.id !== "string"
          )
            throw new Error("The browser did not confirm the approval.");
          const approvalId = response.id;
          queueThreadContinuation({
            id: approvalId,
            threadId: taskId,
            environmentId: requestEnvironmentId,
            text: quickActionInstructions(target.sessionId, action.id, approvalId),
            failedTitle: "Could not return the Quick Action approval",
            verify: async () => {
              const available = (await bridge.runBrowserAutomation({
                source: "human",
                projectId,
                operation: "listQuickActionTargets",
                input: { action },
              })) as BrowserQuickActionTarget[];
              return available.some(
                (entry) =>
                  entry.sessionId === target.sessionId &&
                  entry.token === target.token &&
                  entry.approval?.id === approvalId &&
                  entry.approval.taskId === taskId,
              );
            },
          });
          onClose();
        }
      } else {
        const { verifiedRepair, ...runResult } = response as BrowserQuickActionResult & {
          verifiedRepair?: unknown;
        };
        if (
          runResult.status === "pass" &&
          runResult.fileReceipt &&
          isVerifiedRepair(verifiedRepair) &&
          verifiedRepair.replacement.id === action.id
        )
          saveVerifiedBrowserQuickActionRepair(projectId, verifiedRepair);
        setResult(runResult);
        if (runResult.status !== "paused") setValues({});
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not run the browser action.");
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const revoke = async () => {
    if (!bridge || !target) return;
    try {
      await bridge.runBrowserAutomation({
        source: "human",
        projectId,
        sessionId: target.sessionId,
        ...(pauseRequest && taskId ? { taskId } : {}),
        operation: "revokeQuickAction",
        input: { actionId: action.id, ...pauseInput },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not stop the action.");
    } finally {
      void refresh();
    }
  };

  const repair = async () => {
    if (!bridge || !target || !target.visible || unconfirmedStepId !== undefined) return;
    setBusy("pick");
    setError("");
    toastManager.add({ type: "info", title: "Choose the replacement control in the browser" });
    try {
      const repairResult = (await bridge.runBrowserAutomation({
        source: "human",
        projectId,
        sessionId: target.sessionId,
        ...(pauseRequest && taskId ? { taskId } : {}),
        operation: "repairQuickAction",
        input: { action, token: target.token, ...pauseInput },
      })) as {
        action: BrowserQuickAction;
        pendingFileVerification: boolean;
        verifiedRepair?: unknown;
      } | null;
      if (!repairResult) return;
      const { action: repaired, pendingFileVerification, verifiedRepair } = repairResult;
      // The host verifies a file replacement immediately once all steps have run.
      if (!pendingFileVerification)
        saveVerifiedBrowserQuickActionRepair(
          projectId,
          isVerifiedRepair(verifiedRepair)
            ? verifiedRepair
            : { previous: action, replacement: repaired },
        );
      setAction(repaired);
      setResult(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not repair this step.");
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const copyApproval = async () => {
    if (!target?.approval) return;
    try {
      await navigator.clipboard.writeText(
        quickActionInstructions(target.sessionId, action.id, target.approval.id),
      );
      toastManager.add({ type: "success", title: "Agent instructions copied" });
    } catch {
      setError("Could not copy the agent instructions.");
    }
  };

  const isRunning = busy === "run" || target?.running;
  return (
    <Dialog
      open={busy !== "pick"}
      onOpenChange={(open) => {
        if (!open && busy !== "pick") onClose();
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{action.label}</DialogTitle>
          <DialogDescription>{action.outcome.description}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4 text-sm">
          {action.outcome.filenamePattern && (
            <p>
              Verify file <code>{action.outcome.filenamePattern}</code>
            </p>
          )}
          {!bridge && <p>Browser Quick Actions run in the Tabs desktop app.</p>}
          {bridge && targets === null && !error && <p role="status">Loading browser tabs…</p>}
          {targets?.length === 0 && (
            <p>
              {pauseRequest
                ? "This pause is no longer available in the original tab."
                : `Open the starting page at ${action.origin} in the browser profile you want to use.`}
            </p>
          )}
          {pauseRequest && target && (
            <p>
              {target.profileId} · {target.page}
            </p>
          )}
          {tabChanged && <p role="status">The selected tab changed. Choose a tab again.</p>}
          {!pauseRequest && !!targets?.length && (
            <div className="space-y-1">
              <p id="quick-action-tab-label" className="font-medium">
                Browser tab and profile
              </p>
              <Select
                value={tabChanged ? null : (selection?.sessionId ?? null)}
                onValueChange={(id) => {
                  const entry = targets.find((candidate) => candidate.sessionId === id);
                  setSelection(entry ? { sessionId: entry.sessionId, token: entry.token } : null);
                  if (reviewingAgentRun) setValues({});
                  setResult(null);
                  setError("");
                }}
                disabled={!!isRunning || !!busy}
              >
                <SelectTrigger aria-labelledby="quick-action-tab-label" className="w-full">
                  <SelectValue placeholder="Choose an open tab">
                    {target && `${target.profileId} · ${target.page} · ${target.sessionId}`}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {targets.map((entry) => (
                    <SelectItem key={entry.sessionId} value={entry.sessionId}>
                      {entry.profileId} · {entry.page} · {entry.sessionId}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          )}
          {target && (
            <>
              {unconfirmedStepId !== undefined && (
                <div data-shape="surface" className="space-y-2 border border-border p-3">
                  <p>
                    {pausedAt === undefined
                      ? "A step needs checking."
                      : `Step ${pausedAt + 1} needs checking.`}{" "}
                    Did it take effect on the page?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canResolveStep}
                      onClick={() => void resolveStep(true)}
                    >
                      It took effect
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canResolveStep}
                      onClick={() => void resolveStep(false)}
                    >
                      It did not take effect
                    </Button>
                  </div>
                </div>
              )}
              {unconfirmedStepId === undefined && repairAt !== undefined && (
                <div data-shape="surface" className="space-y-2 border border-border p-3">
                  <p>
                    {repairAt < action.steps.length
                      ? `Paused before step ${repairAt + 1} (${action.steps[repairAt]?.selector}).`
                      : pausedAt === action.steps.length
                        ? "All steps ran. The result still needs verification."
                        : "Select a unique element to verify the expected result."}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!target.visible || !!busy}
                    onClick={() => void repair()}
                  >
                    Pick replacement on page
                  </Button>
                  {!target.visible && (
                    <p className="text-muted-foreground">
                      Bring this browser tab into view to pick a replacement.
                    </p>
                  )}
                </div>
              )}
              {lockedParameters.length > 0 && !target.approval && (
                <p className="text-muted-foreground">Previously approved inputs will be reused.</p>
              )}
              {editableParameters.length > 0 && !target.approval && (
                <fieldset className="space-y-2" disabled={!!busy || !!isRunning}>
                  <legend className="mb-2 font-medium">Inputs for this run</legend>
                  <p className="text-muted-foreground">
                    Use workflow inputs. Enter passwords and verification codes directly on the
                    page.
                  </p>
                  {editableParameters.map((parameter) => (
                    <label key={parameter} className="block space-y-1">
                      <span>{parameter}</span>
                      <Input
                        autoComplete="off"
                        maxLength={4096}
                        value={Object.hasOwn(values, parameter) ? values[parameter] : ""}
                        onChange={(event) =>
                          setValues((current) => ({ ...current, [parameter]: event.target.value }))
                        }
                      />
                    </label>
                  ))}
                </fieldset>
              )}
              {threads.length > 0 && !target.approval && !isRunning && (
                <div className="space-y-2">
                  <p id="quick-action-thread-label" className="font-medium">
                    {requestEnvironmentId
                      ? `Approve one run in ${threads.find((thread) => thread.id === taskId)?.title ?? "this conversation"}`
                      : "Approve one agent run"}
                  </p>
                  <div className="flex items-center gap-2">
                    {!requestEnvironmentId && (
                      <Select value={taskId} onValueChange={setTaskId} disabled={!!busy}>
                        <SelectTrigger
                          aria-labelledby="quick-action-thread-label"
                          className="min-w-0 flex-1"
                        >
                          <SelectValue placeholder="Choose a conversation" />
                        </SelectTrigger>
                        <SelectPopup>
                          {threads
                            .filter(
                              (thread) =>
                                (!target.assignedTaskId || target.assignedTaskId === thread.id) &&
                                (!target.pauseOwner || target.pauseOwner.taskId === thread.id),
                            )
                            .map((thread) => (
                              <SelectItem key={thread.id} value={thread.id}>
                                {thread.title}
                              </SelectItem>
                            ))}
                        </SelectPopup>
                      </Select>
                    )}
                    <Button
                      variant="outline"
                      disabled={
                        !allowsThread || !ready || !!busy || unconfirmedStepId !== undefined
                      }
                      onClick={() => void run(true)}
                    >
                      Approve once
                    </Button>
                  </div>
                </div>
              )}
              {target.approval && (
                <div data-shape="surface" className="space-y-2 border border-border p-3">
                  <p>
                    Approved for one run in{" "}
                    {threads.find((thread) => thread.id === target.approval?.taskId)?.title ??
                      "the selected conversation"}
                    .
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => void copyApproval()}>
                      Copy agent instructions
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void revoke()}>
                      Revoke approval
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
          {result && (
            <p role="status">
              {result.status === "pass" ? "Verified · " : ""}
              {result.message}
              {result.fileReceipt && (
                <>
                  {" "}
                  · {result.fileReceipt.filename} ({result.fileReceipt.byteLength.toLocaleString()}{" "}
                  bytes)
                </>
              )}
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {isRunning ? (
            <Button variant="outline" disabled={!target} onClick={() => void revoke()}>
              Stop replay
            </Button>
          ) : !requestEnvironmentId ? (
            <Button
              disabled={
                !target ||
                !ready ||
                !!busy ||
                unconfirmedStepId !== undefined ||
                !!target.approval ||
                result?.status === "pass"
              }
              onClick={() => void run(false)}
            >
              {pausedAt === undefined ? "Run in selected tab" : "Continue from pause"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
