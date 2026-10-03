import type {
  GitActionProgressEvent,
  GitListBranchesResult,
  GitStackedAction,
  GitStatusFile,
  GitStatusResult,
  ThreadId,
} from "@tabs/contracts";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { CloudUploadIcon, GitCommitIcon } from "lucide-react";

import {
  gitInitMutationOptions,
  gitMutationKeys,
  gitRunStackedActionMutationOptions,
  invalidateGitQueries,
} from "../lib/gitReactQuery";
import { cn, randomUUID } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { GitHubIcon } from "./Icons";
import {
  buildGitActionProgressStages,
  type DefaultBranchConfirmableAction,
  requiresDefaultBranchConfirmation,
  resolveDefaultBranchActionDialogCopy,
  summarizeGitResult,
} from "./GitActionsControl.logic";
import { buildGitCommitComposerState } from "./GitCommitComposer.logic";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { toastManager } from "./ui/toast";

interface GitCommitComposerProps {
  gitCwd: string | null;
  activeThreadId: ThreadId | null;
  gitStatus: GitStatusResult | null;
  branchList: GitListBranchesResult | null;
  stagedFiles: ReadonlyArray<GitStatusFile>;
  externalBusy?: boolean;
  workspaceMode?: "basic" | "advanced";
}

interface PendingDefaultBranchAction {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  includesCommit: boolean;
  commitMessage?: string;
  forcePushOnlyProgress: boolean;
  filePaths?: string[];
}

type GitActionToastId = ReturnType<typeof toastManager.add>;

interface ActiveGitActionProgress {
  toastId: GitActionToastId;
  actionId: string;
  title: string;
  phaseStartedAtMs: number | null;
  hookStartedAtMs: number | null;
  hookName: string | null;
  lastOutputLine: string | null;
  currentPhaseLabel: string | null;
}

function formatElapsedDescription(startedAtMs: number | null): string | undefined {
  if (startedAtMs === null) {
    return undefined;
  }
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `Running for ${elapsedSeconds}s`;
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `Running for ${minutes}m ${seconds}s`;
}

function resolveProgressDescription(progress: ActiveGitActionProgress): string | undefined {
  if (progress.lastOutputLine) {
    return progress.lastOutputLine;
  }
  return formatElapsedDescription(progress.hookStartedAtMs ?? progress.phaseStartedAtMs);
}

function GitComposerActionIcon(props: { actionId: GitStackedAction | "open_pr" }) {
  const className = "size-3.5";
  if (props.actionId === "commit") return <GitCommitIcon className={className} />;
  if (props.actionId === "open_pr" || props.actionId === "commit_push_pr") {
    return <GitHubIcon className={className} />;
  }
  return <CloudUploadIcon className={className} />;
}

export default function GitCommitComposer(props: GitCommitComposerProps) {
  const {
    gitCwd,
    activeThreadId,
    gitStatus,
    branchList,
    stagedFiles,
    externalBusy = false,
    workspaceMode = "basic",
  } = props;
  const threadToastData = useMemo(
    () => (activeThreadId ? { threadId: activeThreadId } : undefined),
    [activeThreadId],
  );
  const queryClient = useQueryClient();
  const [commitMessage, setCommitMessage] = useState("");
  const [pendingDefaultBranchAction, setPendingDefaultBranchAction] =
    useState<PendingDefaultBranchAction | null>(null);
  const activeGitActionProgressRef = useRef<ActiveGitActionProgress | null>(null);

  const updateActiveProgressToast = useCallback(() => {
    const progress = activeGitActionProgressRef.current;
    if (!progress) return;
    toastManager.update(progress.toastId, {
      type: "loading",
      title: progress.title,
      description: resolveProgressDescription(progress),
      timeout: 0,
      data: threadToastData,
    });
  }, [threadToastData]);

  const initMutation = useMutation(gitInitMutationOptions({ cwd: gitCwd, queryClient }));
  const runImmediateGitActionMutation = useMutation(
    gitRunStackedActionMutationOptions({
      cwd: gitCwd,
      queryClient,
    }),
  );
  const isRunStackedActionRunning =
    useIsMutating({ mutationKey: gitMutationKeys.runStackedAction(gitCwd) }) > 0;
  const currentBranch = branchList?.branches.find((branch) => branch.current)?.name ?? null;
  const isGitStatusOutOfSync =
    !!gitStatus?.branch && !!currentBranch && gitStatus.branch !== currentBranch;

  useEffect(() => {
    if (!isGitStatusOutOfSync) return;
    void invalidateGitQueries(queryClient);
  }, [isGitStatusOutOfSync, queryClient]);

  const gitStatusForActions = isGitStatusOutOfSync ? null : gitStatus;
  const isBusy = externalBusy || initMutation.isPending || isRunStackedActionRunning;
  const composerState = useMemo(
    () =>
      buildGitCommitComposerState({
        gitStatus: gitStatusForActions,
        branchList,
        isBusy,
        stagedCount: stagedFiles.length,
      }),
    [branchList, gitStatusForActions, isBusy, stagedFiles.length],
  );
  const pendingDefaultBranchActionCopy = pendingDefaultBranchAction
    ? resolveDefaultBranchActionDialogCopy({
        action: pendingDefaultBranchAction.action,
        branchName: pendingDefaultBranchAction.branchName,
        includesCommit: pendingDefaultBranchAction.includesCommit,
      })
    : null;
  const stagedInsertions = stagedFiles.reduce((sum, file) => sum + file.insertions, 0);
  const stagedDeletions = stagedFiles.reduce((sum, file) => sum + file.deletions, 0);

  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;

    const applyProgressEvent = (event: GitActionProgressEvent) => {
      const progress = activeGitActionProgressRef.current;
      if (!progress) return;
      if (gitCwd && event.cwd !== gitCwd) return;
      if (progress.actionId !== event.actionId) return;

      const now = Date.now();
      switch (event.kind) {
        case "action_started":
          progress.phaseStartedAtMs = now;
          progress.hookStartedAtMs = null;
          progress.hookName = null;
          progress.lastOutputLine = null;
          break;
        case "phase_started":
          progress.title = event.label;
          progress.currentPhaseLabel = event.label;
          progress.phaseStartedAtMs = now;
          progress.hookStartedAtMs = null;
          progress.hookName = null;
          progress.lastOutputLine = null;
          break;
        case "hook_started":
          progress.title = `Running ${event.hookName}...`;
          progress.hookName = event.hookName;
          progress.hookStartedAtMs = now;
          progress.lastOutputLine = null;
          break;
        case "hook_output":
          progress.lastOutputLine = event.text;
          break;
        case "hook_finished":
          progress.title = progress.currentPhaseLabel ?? "Committing...";
          progress.hookName = null;
          progress.hookStartedAtMs = null;
          progress.lastOutputLine = null;
          break;
        case "action_finished":
        case "action_failed":
          return;
      }

      updateActiveProgressToast();
    };

    return api.git.onActionProgress(applyProgressEvent);
  }, [gitCwd, updateActiveProgressToast]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!activeGitActionProgressRef.current) return;
      updateActiveProgressToast();
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [updateActiveProgressToast]);

  const openExistingPr = useCallback(async () => {
    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
        data: threadToastData,
      });
      return;
    }
    const prUrl = gitStatusForActions?.pr?.state === "open" ? gitStatusForActions.pr.url : null;
    if (!prUrl) {
      toastManager.add({
        type: "error",
        title: "No open PR found.",
        data: threadToastData,
      });
      return;
    }
    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: error instanceof Error ? error.message : "An error occurred.",
        data: threadToastData,
      });
    });
  }, [gitStatusForActions, threadToastData]);

  const runGitActionWithToast = useEffectEvent(
    async (input: {
      action: GitStackedAction;
      commitMessage?: string;
      forcePushOnlyProgress?: boolean;
      filePaths?: string[];
      featureBranch?: boolean;
      skipDefaultBranchPrompt?: boolean;
      statusOverride?: GitStatusResult | null;
      isDefaultBranchOverride?: boolean;
    }) => {
      const actionStatus = input.statusOverride ?? gitStatusForActions;
      const actionBranch = actionStatus?.branch ?? null;
      const actionIsDefaultBranch =
        input.isDefaultBranchOverride ??
        (input.featureBranch ? false : composerState.isDefaultBranch);
      const includesCommit =
        !input.forcePushOnlyProgress && (input.action === "commit" || stagedFiles.length > 0);

      if (
        !input.skipDefaultBranchPrompt &&
        requiresDefaultBranchConfirmation(input.action, actionIsDefaultBranch) &&
        actionBranch
      ) {
        if (input.action !== "commit_push" && input.action !== "commit_push_pr") {
          return;
        }
        setPendingDefaultBranchAction({
          action: input.action,
          branchName: actionBranch,
          includesCommit,
          ...(input.commitMessage ? { commitMessage: input.commitMessage } : {}),
          forcePushOnlyProgress: input.forcePushOnlyProgress ?? false,
          ...(input.filePaths ? { filePaths: input.filePaths } : {}),
        });
        return;
      }

      const progressStages = buildGitActionProgressStages({
        action: input.action,
        hasCustomCommitMessage: !!input.commitMessage?.trim(),
        hasWorkingTreeChanges: stagedFiles.length > 0,
        ...(input.forcePushOnlyProgress !== undefined
          ? { forcePushOnly: input.forcePushOnlyProgress }
          : {}),
        ...(input.featureBranch !== undefined ? { featureBranch: input.featureBranch } : {}),
      });
      const actionId = randomUUID();
      if (workspaceMode === "basic") {
        window.dispatchEvent(
          new CustomEvent("tabs:git-telemetry", {
            detail: {
              event: "git_basic_primary_action_executed",
              action: input.action,
            },
          }),
        );
      }
      const toastId = toastManager.add({
        type: "loading",
        title: progressStages[0] ?? "Running git action...",
        description: "Waiting for Git...",
        timeout: 0,
        data: threadToastData,
      });

      activeGitActionProgressRef.current = {
        toastId,
        actionId,
        title: progressStages[0] ?? "Running git action...",
        phaseStartedAtMs: null,
        hookStartedAtMs: null,
        hookName: null,
        lastOutputLine: null,
        currentPhaseLabel: progressStages[0] ?? "Running git action...",
      };

      try {
        const result = await runImmediateGitActionMutation.mutateAsync({
          actionId,
          action: input.action,
          ...(input.commitMessage ? { commitMessage: input.commitMessage } : {}),
          ...(input.featureBranch ? { featureBranch: input.featureBranch } : {}),
          ...(input.filePaths ? { filePaths: input.filePaths } : {}),
        });
        activeGitActionProgressRef.current = null;
        const resultToast = summarizeGitResult(result);
        const existingOpenPrUrl =
          actionStatus?.pr?.state === "open" ? actionStatus.pr.url : undefined;
        const prUrl = result.pr.url ?? existingOpenPrUrl;
        const shouldOfferPushCta = input.action === "commit" && result.commit.status === "created";
        const shouldOfferOpenPrCta =
          (input.action === "commit_push" || input.action === "commit_push_pr") &&
          !!prUrl &&
          (!actionIsDefaultBranch ||
            result.pr.status === "created" ||
            result.pr.status === "opened_existing");
        const shouldOfferCreatePrCta =
          input.action === "commit_push" &&
          !prUrl &&
          result.push.status === "pushed" &&
          !actionIsDefaultBranch;
        const closeToast = () => {
          toastManager.close(toastId);
        };

        toastManager.update(toastId, {
          type: "success",
          title: resultToast.title,
          description: resultToast.description,
          timeout: 0,
          data: {
            ...threadToastData,
            dismissAfterVisibleMs: 10_000,
          },
          ...(shouldOfferPushCta
            ? {
                actionProps: {
                  children: "Push",
                  onClick: () => {
                    void runGitActionWithToast({
                      action: "commit_push",
                      forcePushOnlyProgress: true,
                      statusOverride: actionStatus,
                      isDefaultBranchOverride: actionIsDefaultBranch,
                    });
                    closeToast();
                  },
                },
              }
            : shouldOfferOpenPrCta
              ? {
                  actionProps: {
                    children: "View PR",
                    onClick: () => {
                      const api = readNativeApi();
                      if (!api) return;
                      closeToast();
                      void api.shell.openExternal(prUrl);
                    },
                  },
                }
              : shouldOfferCreatePrCta
                ? {
                    actionProps: {
                      children: "Create PR",
                      onClick: () => {
                        closeToast();
                        void runGitActionWithToast({
                          action: "commit_push_pr",
                          forcePushOnlyProgress: true,
                          statusOverride: actionStatus,
                          isDefaultBranchOverride: actionIsDefaultBranch,
                        });
                      },
                    },
                  }
                : {}),
        });
        setCommitMessage("");
      } catch (error) {
        activeGitActionProgressRef.current = null;
        toastManager.update(toastId, {
          type: "error",
          title: "Action failed",
          description: error instanceof Error ? error.message : "An error occurred.",
          data: threadToastData,
        });
      }
    },
  );

  const continuePendingDefaultBranchAction = useCallback(() => {
    if (!pendingDefaultBranchAction) return;
    const {
      action,
      commitMessage: pendingCommitMessage,
      forcePushOnlyProgress,
      filePaths,
    } = pendingDefaultBranchAction;
    setPendingDefaultBranchAction(null);
    void runGitActionWithToast({
      action,
      ...(pendingCommitMessage ? { commitMessage: pendingCommitMessage } : {}),
      forcePushOnlyProgress,
      ...(filePaths ? { filePaths } : {}),
      skipDefaultBranchPrompt: true,
    });
  }, [pendingDefaultBranchAction, runGitActionWithToast]);

  const checkoutFeatureBranchAndContinuePendingAction = useCallback(() => {
    if (!pendingDefaultBranchAction) return;
    const {
      action,
      commitMessage: pendingCommitMessage,
      forcePushOnlyProgress,
      filePaths,
    } = pendingDefaultBranchAction;
    setPendingDefaultBranchAction(null);
    void runGitActionWithToast({
      action,
      ...(pendingCommitMessage ? { commitMessage: pendingCommitMessage } : {}),
      forcePushOnlyProgress,
      ...(filePaths ? { filePaths } : {}),
      featureBranch: true,
      skipDefaultBranchPrompt: true,
    });
  }, [pendingDefaultBranchAction, runGitActionWithToast]);

  const runComposerAction = useCallback(
    (action: GitStackedAction) => {
      const trimmedCommitMessage = commitMessage.trim();
      const filePaths = stagedFiles.length > 0 ? stagedFiles.map((file) => file.path) : undefined;
      const forcePushOnlyProgress = action !== "commit" && stagedFiles.length === 0;
      void runGitActionWithToast({
        action,
        ...(trimmedCommitMessage ? { commitMessage: trimmedCommitMessage } : {}),
        ...(filePaths ? { filePaths } : {}),
        forcePushOnlyProgress,
      });
    },
    [commitMessage, runGitActionWithToast, stagedFiles],
  );

  const primaryAction = composerState.actions.find((action) => action.kind !== "open_pr") ?? null;
  const secondaryActions = composerState.actions.filter((action) => action !== primaryAction);

  return (
    <>
      <div className="min-w-0 rounded-2xl border border-border/40 bg-background/50 p-5 shadow-sm backdrop-blur-xl">
        {!branchList?.isRepo ? (
          <div className="flex min-w-0 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/60 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
            <div className="space-y-1.5">
              <div className="text-base font-medium text-foreground">
                Initialize Git for this project
              </div>
              <p className="mx-auto max-w-sm break-words">
                This workspace is not a Git repository yet. Initialize it to unlock commits,
                branches, and syncing.
              </p>
            </div>
            <Button
              type="button"
              className="rounded-full shadow-sm"
              disabled={initMutation.isPending}
              onClick={() => initMutation.mutate()}
            >
              {initMutation.isPending ? "Initializing..." : "Initialize Git"}
            </Button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-foreground">
                  <GitCommitIcon className="size-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-foreground">Commit changes</h3>
                  <p className="truncate text-xs text-muted-foreground">
                    {stagedFiles.length > 0
                      ? `${stagedFiles.length} file${stagedFiles.length === 1 ? "" : "s"} ready to commit`
                      : "Stage files below to include them"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {composerState.isDefaultBranch && gitStatusForActions?.branch ? (
                  <Badge size="sm" variant="warning" className="shadow-none">
                    Default branch
                  </Badge>
                ) : null}
                {stagedFiles.length > 0 ? (
                  <span className="rounded-md bg-muted/40 px-2 py-1 font-mono text-xs font-medium">
                    <span className="text-diff-addition font-medium">+{stagedInsertions}</span>
                    <span className="px-1 text-muted-foreground/40">/</span>
                    <span className="text-diff-deletion font-medium">-{stagedDeletions}</span>
                  </span>
                ) : null}
              </div>
            </div>

            <Textarea
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="Summarize your change — or leave empty to auto-generate one"
              className="min-h-24 resize-none border-border/40 bg-background/50 shadow-inner focus-visible:ring-1 focus-visible:ring-primary/50"
            />

            {isGitStatusOutOfSync ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-primary/60" />
                Refreshing Git status…
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-4">
              <div
                className={cn(
                  "min-w-0 text-xs",
                  primaryAction?.disabledReason ? "text-warning" : "text-muted-foreground",
                )}
              >
                {primaryAction?.disabledReason ??
                  primaryAction?.description ??
                  "Leave the message empty to auto-generate one."}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {secondaryActions.map((action) => (
                  <Button
                    key={action.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-full gap-1.5"
                    disabled={action.disabled}
                    onClick={() => {
                      if (action.kind === "open_pr") {
                        void openExistingPr();
                        return;
                      }
                      if (action.action) {
                        runComposerAction(action.action);
                      }
                    }}
                  >
                    <GitComposerActionIcon
                      actionId={action.kind === "open_pr" ? "open_pr" : (action.action ?? "commit")}
                    />
                    {action.label}
                  </Button>
                ))}
                <Button
                  type="button"
                  className="rounded-full gap-1.5 px-5 shadow-sm active:scale-95"
                  disabled={!primaryAction || primaryAction.disabled}
                  onClick={() => {
                    if (!primaryAction) return;
                    if (primaryAction.kind === "open_pr") {
                      void openExistingPr();
                      return;
                    }
                    if (primaryAction.action) {
                      runComposerAction(primaryAction.action);
                    }
                  }}
                >
                  {primaryAction ? (
                    <GitComposerActionIcon
                      actionId={
                        primaryAction.kind === "open_pr"
                          ? "open_pr"
                          : (primaryAction.action ?? "commit")
                      }
                    />
                  ) : null}
                  {primaryAction?.label ?? "Commit"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={pendingDefaultBranchAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDefaultBranchAction(null);
          }
        }}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {pendingDefaultBranchActionCopy?.title ?? "Run action on default branch?"}
            </DialogTitle>
            <DialogDescription>{pendingDefaultBranchActionCopy?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingDefaultBranchAction(null)}>
              Abort
            </Button>
            <Button variant="outline" size="sm" onClick={continuePendingDefaultBranchAction}>
              {pendingDefaultBranchActionCopy?.continueLabel ?? "Continue"}
            </Button>
            <Button size="sm" onClick={checkoutFeatureBranchAndContinuePendingAction}>
              Create feature branch first
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
