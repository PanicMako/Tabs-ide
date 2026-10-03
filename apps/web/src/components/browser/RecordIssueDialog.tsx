import { saveIssueReproduction } from "./saveIssueReproduction";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  CopyIcon,
  ExternalLinkIcon,
  FileCodeIcon,
  PlayIcon,
  RadioIcon,
  RefreshCwIcon,
  SendIcon,
  SquareIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
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
import { Textarea } from "~/components/ui/textarea";
import { readNativeApi } from "~/nativeApi";
import type { BrowserVerificationResult } from "@tabs/contracts";
import { toastManager } from "~/components/ui/toast";

export type VerificationStatus = "not_verified" | "pass" | "fail" | "interrupted";

export type { BrowserReproductionStep as RecordedStep } from "@tabs/contracts";
import type { BrowserReproductionStep as RecordedStep } from "@tabs/contracts";

export interface IssueReproduction {
  id: string;
  projectId: string;
  route: string;
  profileId?: string | undefined;
  viewport?: { width: number; height: number } | undefined;
  taskId?: string | undefined;
  steps: RecordedStep[];
  expectedResult: string;
  generatedCode: string;
  specPath?: string | undefined;
  beforeScreenshot?: string | undefined;
  afterScreenshot?: string | undefined;
  verificationStatus: VerificationStatus;
  verificationMessage?: string | undefined;
  createdAt: string;
}

interface RecordIssueDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectCwd: string;
  onRecordingChange?: (recording: boolean) => void;
  sessionId?: string | undefined;
  currentUrl: string;
  viewport?: { width: number; height: number } | undefined;
  profileId?: string | undefined;
  assignedTaskId?: string | null | undefined;
  availableTasks?: Array<{ id: string; title: string }> | undefined;
  onReproductionCreated?: (reproduction: IssueReproduction) => Promise<void>;
}

import {
  isFragileSelector,
  generateReproductionPlaywrightCode,
} from "@tabs/shared/browserReproduction";
export {
  isFragileSelector,
  generateReproductionPlaywrightCode,
} from "@tabs/shared/browserReproduction";

export function evaluateVerification(
  hasAssertions: boolean,
  _expectedResult: string,
  error?: Error | string | null,
): { status: VerificationStatus; message: string } {
  if (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("human") || msg.includes("interrupted") || msg.includes("cancelled")) {
      return { status: "interrupted", message: `Verification was interrupted: ${msg}` };
    }
    return { status: "fail", message: `Verification failed: ${msg}` };
  }
  if (!hasAssertions) {
    return {
      status: "not_verified",
      message:
        "Steps completed, but no expected-result assertions were defined. Add an assertion to verify the fix.",
    };
  }
  return {
    status: "pass",
    message: "All reproduction steps and assertions passed successfully!",
  };
}

type ReviewDraft = {
  phase: "idle" | "recording" | "review" | "verifying" | "verified";
  recordedUrl: string;
  steps: RecordedStep[];
  expectedResult: string;
  selectedTaskId: string;
  beforeScreenshot: string | null;
  afterScreenshot: string | null;
  verificationStatus: VerificationStatus;
  verificationMessage: string;
  dispatched: boolean;
  pendingDispatch: IssueReproduction | null;
};
// Keep review work when switching tabs. Drafts remain in memory, not browser storage.
const reviewDrafts = new Map<string, ReviewDraft>();

export function RecordIssueDialog({
  isOpen,
  onOpenChange,
  projectId,
  projectCwd,
  onRecordingChange,
  sessionId,
  currentUrl,
  viewport,
  profileId,
  assignedTaskId,
  availableTasks = [],
  onReproductionCreated,
}: RecordIssueDialogProps) {
  const bridge = window.desktopBridge;
  const api = readNativeApi();
  const draftKey = `${projectId}:${sessionId ?? "default"}`;
  const saved = useRef(reviewDrafts.get(draftKey)).current;
  const pendingDispatch = useRef<IssueReproduction | null>(saved?.pendingDispatch ?? null);

  const [phase, setPhase] = useState<"idle" | "recording" | "review" | "verifying" | "verified">(
    saved?.phase === "verifying" ? "review" : (saved?.phase ?? "idle"),
  );
  const [busy, setBusy] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState(saved?.recordedUrl ?? currentUrl);
  const [dispatched, setDispatched] = useState(saved?.dispatched ?? false);
  const operationGeneration = useRef(0);
  const reproductionId = useRef<string | null>(null);
  const verifyActive = useRef(false);
  useEffect(() => {
    let alive = true;
    void bridge
      ?.runBrowserAutomation({ projectId, sessionId, source: "human", operation: "recordStatus" })
      .then(async (result) => {
        if (!alive) return;
        const status = result as { recording?: boolean; count?: number; interrupted?: boolean };
        if (status.recording) {
          setPhase("recording");
          return;
        }
        if ((status.count ?? 0) > 0 && (!saved || saved.phase === "recording")) {
          const recording = (await bridge.runBrowserAutomation({
            projectId,
            sessionId,
            source: "human",
            operation: "recordStop",
          })) as { steps: RecordedStep[]; initialUrl: string };
          if (!alive) return;
          setSteps(recording.steps);
          setRecordedUrl(recording.initialUrl);
          setPhase("review");
          if (status.interrupted)
            setVerificationMessage(
              "Recording was interrupted. Review the captured steps before replaying.",
            );
        } else if (saved?.phase === "recording") setPhase("idle");
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      operationGeneration.current++;
      if (verifyActive.current)
        void bridge?.runBrowserAutomation({
          projectId,
          sessionId,
          source: "human",
          operation: "cancelVerification",
        });
    };
  }, [bridge, projectId, sessionId, saved]);
  useEffect(() => {
    onRecordingChange?.(phase === "recording");
  }, [phase, onRecordingChange]);
  const [steps, setSteps] = useState<RecordedStep[]>(saved?.steps ?? []);
  const [expectedResult, setExpectedResult] = useState(saved?.expectedResult ?? "");
  const [selectedTaskId, setSelectedTaskId] = useState<string>(
    saved?.selectedTaskId ?? assignedTaskId ?? "",
  );
  const [beforeScreenshot, setBeforeScreenshot] = useState<string | null>(
    saved?.beforeScreenshot ?? null,
  );
  const [afterScreenshot, setAfterScreenshot] = useState<string | null>(
    saved?.afterScreenshot ?? null,
  );
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>(
    saved?.verificationStatus ?? "not_verified",
  );
  const [verificationMessage, setVerificationMessage] = useState<string>(
    saved?.verificationMessage ?? "",
  );
  const [activeTab, setActiveTab] = useState<"steps" | "code" | "evidence">("steps");

  useEffect(() => {
    if (assignedTaskId) {
      setSelectedTaskId(assignedTaskId);
    }
  }, [assignedTaskId]);

  useEffect(() => {
    reviewDrafts.set(draftKey, {
      phase,
      recordedUrl,
      steps,
      expectedResult,
      selectedTaskId,
      beforeScreenshot,
      afterScreenshot,
      verificationStatus,
      verificationMessage,
      dispatched,
      pendingDispatch: pendingDispatch.current,
    });
    if (reviewDrafts.size > 50) reviewDrafts.delete(reviewDrafts.keys().next().value!);
  }, [
    draftKey,
    phase,
    recordedUrl,
    steps,
    expectedResult,
    selectedTaskId,
    beforeScreenshot,
    afterScreenshot,
    verificationStatus,
    verificationMessage,
    dispatched,
    busy,
  ]);

  const resetState = useCallback(() => {
    pendingDispatch.current = null;
    reproductionId.current = null;
    setDispatched(false);
    setPhase("idle");
    setBusy(false);
    setSteps([]);
    setExpectedResult("");
    setBeforeScreenshot(null);
    setAfterScreenshot(null);
    setVerificationStatus("not_verified");
    setVerificationMessage("");
    setActiveTab("steps");
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open && verifyActive.current) {
      operationGeneration.current++;
      verifyActive.current = false;
      void bridge?.runBrowserAutomation({
        projectId,
        sessionId,
        source: "human",
        operation: "cancelVerification",
      });
      setBusy(false);
      setPhase("review");
      setVerificationStatus("interrupted");
      setVerificationMessage("Verification cancelled when review was closed.");
    }
    onOpenChange(open);
  };

  const startRecording = async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      await bridge.runBrowserAutomation({
        source: "human",
        projectId,
        sessionId,
        operation: "recordStart",
      });
      resetState();
      reproductionId.current = null;
      setDispatched(false);
      setRecordedUrl(currentUrl);
      setPhase("recording");
      onOpenChange(false);
      toastManager.add({
        type: "success",
        title: "Issue recording started",
        description: "Interact with the application tab to demonstrate the issue.",
      });
    } catch (err) {
      toastManager.add({
        type: "error",
        title: "Could not start recording",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const stopRecording = async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      const result = (await bridge.runBrowserAutomation({
        source: "human",
        projectId,
        sessionId,
        operation: "recordStop",
      })) as {
        count: number;
        steps?: RecordedStep[];
        initialUrl?: string;
      };

      // Capture before screenshot as failure evidence
      try {
        const screenshot = await bridge.captureBrowserScreenshot({ projectId, sessionId });
        if (screenshot?.path) {
          setBeforeScreenshot(screenshot.path);
        }
      } catch {
        // Non-fatal
      }

      const recorded = (result.steps ?? []).map((s, idx) => ({
        ...s,
        id: s.id || `step-${idx + 1}`,
        isFragile: s.isFragile ?? isFragileSelector(s.selector),
      }));
      setSteps(recorded);
      setRecordedUrl(result.initialUrl || currentUrl);
      setPhase("review");
      toastManager.add({
        type: "success",
        title: "Recording captured",
        description: `${recorded.length} action(s) recorded. Review steps and enter expected result.`,
      });
    } catch (err) {
      toastManager.add({
        type: "error",
        title: "Could not stop recording",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const addAssertion = (action: "assertVisible" | "assertText" | "assertValue") => {
    const newStep: RecordedStep = {
      id: `assert-${Date.now()}`,
      action,
      selector: "",
      expectedValue: "",
      isFragile: false,
      reviewed: true,
    };
    setSteps((prev) => [...prev, newStep]);
  };

  const updateStep = (id: string, updates: Partial<RecordedStep>) => {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const updated = { ...s, ...updates };
        if (updates.selector !== undefined && updates.isFragile === undefined) {
          updated.isFragile = isFragileSelector(updates.selector);
        }
        return updated;
      }),
    );
  };

  const removeStep = (id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  };

  const generatedCode = useMemo(() => {
    return generateReproductionPlaywrightCode(recordedUrl, steps, expectedResult);
  }, [recordedUrl, steps, expectedResult]);

  const hasAssertions = useMemo(() => {
    return steps.some((s) => s.action.startsWith("assert"));
  }, [steps]);

  const fragileLocatorsCount = useMemo(() => {
    return steps.filter((s) => s.isFragile && !s.reviewed).length;
  }, [steps]);

  const sendReproductionToTask = async () => {
    if (!expectedResult.trim()) {
      toastManager.add({
        type: "error",
        title: "Expected result required",
        description: "Please specify the expected outcome before dispatching to a coding task.",
      });
      return;
    }

    if (dispatched || busy) return;
    setBusy(true);
    try {
      if (
        !projectCwd ||
        !api?.projects?.writeFile ||
        !onReproductionCreated ||
        !availableTasks.some(
          (task) => task.id === (pendingDispatch.current?.taskId ?? selectedTaskId),
        )
      )
        throw new Error("Select an available project task before sending this reproduction.");
      const repId =
        pendingDispatch.current?.id ??
        reproductionId.current ??
        `issue-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
      reproductionId.current = repId;
      const specPath = `tests/e2e/reproductions/${repId}.spec.ts`;

      const reproduction: IssueReproduction = pendingDispatch.current ?? {
        id: repId,
        projectId,
        route: recordedUrl,
        profileId,
        viewport,
        taskId: selectedTaskId || undefined,
        steps,
        expectedResult,
        generatedCode,
        specPath,
        beforeScreenshot: beforeScreenshot ?? undefined,
        afterScreenshot: afterScreenshot ?? undefined,
        verificationStatus,
        verificationMessage: verificationMessage || undefined,
        createdAt: new Date().toISOString(),
      };

      pendingDispatch.current = reproduction;
      await saveIssueReproduction(reproduction, {
        cwd: projectCwd,
        writeFile: (input) => api.projects.writeFile(input),
        dispatch: onReproductionCreated,
      });
      setDispatched(true);

      toastManager.add({
        type: "success",
        title: "Reproduction dispatched to task",
        description: `Saved reproduction spec to ${specPath}`,
      });
    } catch (err) {
      toastManager.add({
        type: "error",
        title: "Failed to dispatch reproduction",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const rerunReproduction = async () => {
    if (!bridge || busy) return;
    const generation = ++operationGeneration.current;
    verifyActive.current = true;
    setBusy(true);
    setPhase("verifying");
    setVerificationStatus("not_verified");
    setAfterScreenshot(null);
    setVerificationMessage("Running all reviewed actions and assertions…");
    try {
      const result = (await bridge.runBrowserAutomation({
        projectId,
        sessionId,
        source: "human",
        operation: "verify",
        input: { url: recordedUrl, steps },
      })) as BrowserVerificationResult;
      if (generation !== operationGeneration.current) return;
      setVerificationStatus(result.status);
      setVerificationMessage(result.message);
      setAfterScreenshot(result.afterScreenshotPath ?? null);
    } catch {
      if (generation !== operationGeneration.current) return;
      setVerificationStatus("fail");
      setVerificationMessage("Verification could not run. Check the tab and retry.");
    } finally {
      if (generation === operationGeneration.current) {
        verifyActive.current = false;
        setBusy(false);
        setPhase("verified");
        setActiveTab("evidence");
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogPopup className="max-w-2xl">
        {pendingDispatch.current && !dispatched && (
          <p className="text-xs text-muted-foreground">
            Retry sends the same saved reproduction to its original task. Start a new recording to
            submit different content.
          </p>
        )}
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <RadioIcon
                className={`size-4 ${phase === "recording" ? "animate-pulse text-red-500" : "text-foreground"}`}
              />
              Record Issue Reproduction
            </DialogTitle>
            {verificationStatus !== "not_verified" && (
              <Badge
                variant={
                  verificationStatus === "pass"
                    ? "default"
                    : verificationStatus === "fail"
                      ? "destructive"
                      : "secondary"
                }
                className="text-xs capitalize"
              >
                {verificationStatus === "pass" && <CheckCircle2Icon className="mr-1 size-3" />}
                {verificationStatus === "fail" && <XCircleIcon className="mr-1 size-3" />}
                {verificationStatus === "interrupted" && (
                  <AlertTriangleIcon className="mr-1 size-3" />
                )}
                {verificationStatus}
              </Badge>
            )}
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Demonstrate a bug, capture deterministic reproduction steps, specify expected results,
            and verify fixes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-2">
          {/* Metadata bar */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Target:</span>
            <span className="max-w-[200px] truncate font-mono text-[11px]" title={currentUrl}>
              {currentUrl}
            </span>
            {viewport && (
              <>
                <span className="text-border">|</span>
                <span>
                  {viewport.width}x{viewport.height}
                </span>
              </>
            )}
            {profileId && (
              <>
                <span className="text-border">|</span>
                <span>Profile: {profileId}</span>
              </>
            )}
            {selectedTaskId && (
              <>
                <span className="text-border">|</span>
                <span>Task: {selectedTaskId.slice(0, 8)}</span>
              </>
            )}
          </div>

          {/* Recording Controls */}
          {phase === "idle" && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-8 text-center">
              <RadioIcon className="size-8 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Ready to record issue reproduction</p>
                <p className="text-xs text-muted-foreground">
                  Click start, then interact with the page to demonstrate the problem.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => void startRecording()}
                disabled={busy}
                className="gap-1.5"
              >
                <RadioIcon className="size-3.5 text-red-600 dark:text-red-400" />
                Start recording issue
              </Button>
            </div>
          )}

          {phase === "recording" && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-red-500/30 bg-red-500/5 py-8 text-center">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400">
                <span className="size-2.5 animate-ping rounded-full bg-red-500" />
                Recording in progress…
              </div>
              <p className="max-w-md text-xs text-muted-foreground">
                Demonstrate the bug in the browser tab. Clicks, inputs, and navigations are captured
                without persisting sensitive passwords or tokens.
              </p>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void stopRecording()}
                disabled={busy}
                className="gap-1.5"
              >
                <SquareIcon className="size-3.5" />
                Stop & review issue
              </Button>
            </div>
          )}

          {/* Review & Verification Phases */}
          {(phase === "review" || phase === "verifying" || phase === "verified") && (
            <div className="space-y-3">
              {/* Tabs */}
              <div className="flex items-center gap-1 border-b pb-1 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab("steps")}
                  className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                    activeTab === "steps"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Steps ({steps.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("code")}
                  className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                    activeTab === "code"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Playwright Spec
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("evidence")}
                  className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                    activeTab === "evidence"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Evidence & Verification
                </button>
              </div>

              {/* Steps Tab */}
              {activeTab === "steps" && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Expected Result (Required)</label>
                    <Input
                      placeholder="e.g. Save button remains enabled and shows success notification"
                      value={expectedResult}
                      onChange={(e) => setExpectedResult(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium">Recorded Steps & Assertions</label>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => addAssertion("assertVisible")}
                        >
                          + Assert Visible
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => addAssertion("assertText")}
                        >
                          + Assert Text
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => addAssertion("assertValue")}
                        >
                          + Assert Value
                        </Button>
                      </div>
                    </div>

                    <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border p-2">
                      {steps.length === 0 ? (
                        <p className="py-4 text-center text-xs text-muted-foreground">
                          No steps recorded yet.
                        </p>
                      ) : (
                        steps.map((step, idx) => (
                          <div
                            key={step.id}
                            className="flex items-center gap-2 rounded border bg-card/60 p-1.5 text-xs"
                          >
                            <span className="w-5 text-muted-foreground">{idx + 1}.</span>
                            <Badge variant="outline" className="h-5 text-[10px] uppercase">
                              {step.action}
                            </Badge>
                            <Input
                              value={step.selector}
                              onChange={(e) => updateStep(step.id, { selector: e.target.value })}
                              placeholder="Selector"
                              className="h-6 flex-1 font-mono text-[11px]"
                            />
                            {(step.action === "assertText" || step.action === "assertValue") && (
                              <Input
                                value={step.expectedValue ?? ""}
                                onChange={(e) =>
                                  updateStep(step.id, { expectedValue: e.target.value })
                                }
                                placeholder="Expected text"
                                className="h-6 w-32 text-[11px]"
                              />
                            )}
                            {(step.action === "fill" || step.action === "selectOption") && (
                              <Input
                                value={step.placeholder ?? ""}
                                placeholder="Environment variable"
                                aria-label="Input environment variable"
                                className="h-6 w-32 text-[11px]"
                                onChange={(event) =>
                                  updateStep(step.id, { placeholder: event.target.value })
                                }
                              />
                            )}
                            {step.action === "goto" && (
                              <Input
                                value={step.url ?? ""}
                                placeholder="Navigation URL"
                                className="h-6 w-40 text-[11px]"
                                onChange={(event) =>
                                  updateStep(step.id, { url: event.target.value })
                                }
                              />
                            )}
                            {step.isFragile && (
                              <label className="flex gap-1">
                                <input
                                  type="checkbox"
                                  checked={step.reviewed ?? false}
                                  onChange={(event) =>
                                    updateStep(step.id, { reviewed: event.target.checked })
                                  }
                                />
                                Reviewed
                              </label>
                            )}
                            {step.isFragile && (
                              <Badge
                                variant="destructive"
                                className="h-5 text-[9px]"
                                title="Positional selector may be fragile"
                              >
                                fragile
                              </Badge>
                            )}
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              onClick={() => removeStep(step.id)}
                            >
                              <Trash2Icon className="size-3 text-muted-foreground hover:text-red-500" />
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {fragileLocatorsCount > 0 && (
                    <div className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangleIcon className="size-4 shrink-0" />
                      <span>
                        {fragileLocatorsCount} step(s) use fragile positional locators. Consider
                        using test-ids or aria labels for stability.
                      </span>
                    </div>
                  )}

                  {/* Task Association */}
                  <div className="space-y-1.5 pt-1">
                    <label className="text-xs font-medium">Assign to Coding Task</label>
                    {availableTasks.length > 0 ? (
                      <Select
                        value={selectedTaskId || "unassigned"}
                        onValueChange={(val) =>
                          setSelectedTaskId(val === "unassigned" ? "" : (val ?? ""))
                        }
                      >
                        <SelectTrigger className="h-8 w-full rounded-md border bg-background px-2 text-xs">
                          <SelectValue placeholder="No task selected (unassigned)" />
                        </SelectTrigger>
                        <SelectPopup>
                          <SelectItem value="unassigned">No task selected (unassigned)</SelectItem>
                          {availableTasks.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.title || t.id}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Create a coding task in this project, then reopen this review to select it.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Code Tab */}
              {activeTab === "code" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Playwright Test Reproduction
                    </span>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard?.writeText(generatedCode);
                        toastManager.add({
                          type: "success",
                          title: "Copied code to clipboard",
                        });
                      }}
                      className="gap-1"
                    >
                      <CopyIcon className="size-3" />
                      Copy
                    </Button>
                  </div>
                  <pre className="max-h-64 overflow-y-auto rounded-md border bg-muted/60 p-3 font-mono text-[11px] text-foreground">
                    {generatedCode}
                  </pre>
                </div>
              )}

              {/* Evidence Tab */}
              {activeTab === "evidence" && (
                <div className="space-y-3">
                  <div className="rounded-lg border p-3">
                    <div className="flex items-center justify-between pb-2">
                      <span className="text-xs font-semibold">Verification Outcome</span>
                      <Badge
                        variant={
                          verificationStatus === "pass"
                            ? "default"
                            : verificationStatus === "fail"
                              ? "destructive"
                              : "secondary"
                        }
                        className="capitalize"
                      >
                        {verificationStatus}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {verificationMessage ||
                        "Run verification to test the reproduction against the current application state."}
                    </p>
                  </div>

                  {/* Before & After Screenshots */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Before (Recorded Failing State)
                      </span>
                      <div className="flex h-36 items-center justify-center rounded-md border bg-muted/40 p-2 text-center text-xs text-muted-foreground">
                        {beforeScreenshot ? (
                          <div className="space-y-1">
                            <span className="font-mono text-[10px]">
                              {beforeScreenshot.split("/").pop()}
                            </span>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => void bridge?.revealBrowserArtifact(beforeScreenshot)}
                            >
                              Show screenshot
                            </Button>
                          </div>
                        ) : (
                          <span>No capture available</span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        After (Verification State)
                      </span>
                      <div className="flex h-36 items-center justify-center rounded-md border bg-muted/40 p-2 text-center text-xs text-muted-foreground">
                        {afterScreenshot ? (
                          <div className="space-y-1">
                            <span className="font-mono text-[10px]">
                              {afterScreenshot.split("/").pop()}
                            </span>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => void bridge?.revealBrowserArtifact(afterScreenshot)}
                            >
                              Show screenshot
                            </Button>
                            <p className="text-[10px] text-green-500">Verified evidence</p>
                          </div>
                        ) : (
                          <span>Rerun verification to capture</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <DialogClose render={<Button variant="outline" size="sm" />}>Close</DialogClose>

          {(phase === "review" || phase === "verified") && (
            <>
              <Button size="sm" variant="ghost" disabled={busy} onClick={resetState}>
                New recording
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void rerunReproduction()}
                className="gap-1.5"
              >
                <RefreshCwIcon className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
                Rerun & Verify
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={busy || dispatched || !selectedTaskId || !expectedResult.trim()}
                onClick={() => void sendReproductionToTask()}
                className="gap-1.5"
              >
                <SendIcon className="size-3.5" />
                Send to Task
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
