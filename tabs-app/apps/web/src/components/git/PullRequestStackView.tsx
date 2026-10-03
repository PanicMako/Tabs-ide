import React, { useState, useTransition } from "react";
import type {
  GitPullRequestStack,
  GitPullRequestStackHead,
  GitPullRequestStackLayer,
} from "@tabs/contracts";
import {
  Layers,
  GitMerge,
  RefreshCw,
  Check,
  TriangleAlert,
  GitPullRequest,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";

export interface PullRequestStackViewProps {
  readonly stack: GitPullRequestStack;
  readonly currentNumber: number;
  readonly cwd: string;
  readonly canMerge?: boolean;
  readonly canRebase?: boolean;
  readonly mergeMethod?: "merge" | "squash" | "rebase";
  readonly onSelectPullRequest?: (prNumber: number) => void;
  readonly onMutatePullRequest?: (
    prNumber: number,
    action: "stack_rebase" | "stack_merge",
    params: {
      stackNumber: number;
      expectedStackHeads: ReadonlyArray<GitPullRequestStackHead>;
      mergeMethod?: "merge" | "squash" | "rebase";
    },
  ) => Promise<boolean>;
}

function resolveLayerStateBadge(layer: GitPullRequestStackLayer) {
  if (layer.state === "merged") {
    return {
      label: "Merged",
      variant: "secondary" as const,
      icon: CheckCircle2,
      colorClass: "text-purple-600 dark:text-purple-400",
    };
  }
  if (layer.state === "closed") {
    return {
      label: "Closed",
      variant: "destructive" as const,
      icon: XCircle,
      colorClass: "text-red-600 dark:text-red-400",
    };
  }
  if (layer.isDraft) {
    return {
      label: "Draft",
      variant: "outline" as const,
      icon: Clock,
      colorClass: "text-muted-foreground",
    };
  }
  return {
    label: "Open",
    variant: "success" as const,
    icon: GitPullRequest,
    colorClass: "text-emerald-600 dark:text-emerald-400",
  };
}

export function PullRequestStackView({
  stack,
  currentNumber,
  cwd,
  canMerge = true,
  canRebase = true,
  mergeMethod = "squash",
  onSelectPullRequest,
  onMutatePullRequest,
}: PullRequestStackViewProps) {
  const [confirmation, setConfirmation] = useState<"merge" | "rebase" | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [, startTransition] = useTransition();

  const layers = stack.layers;
  const currentPosition = layers.findIndex((l) => l.number === currentNumber) + 1;
  const currentLayer = layers[currentPosition - 1];

  const unmergedLayers = layers.filter((l) => l.state !== "merged");
  const hasClosedInUnmerged = unmergedLayers.some((l) => l.state === "closed");
  const hasDraftInUnmerged = unmergedLayers.some((l) => l.isDraft);

  // For stack merge: all layers up to currentLayer
  const mergeSlice =
    currentPosition > 0 ? layers.slice(0, currentPosition).filter((l) => l.state !== "merged") : [];
  const hasDraftInMergeSlice = mergeSlice.some((l) => l.isDraft);
  const hasClosedInMergeSlice = mergeSlice.some((l) => l.state === "closed");
  const hasUnknownHeadInMergeSlice = mergeSlice.some((l) => !l.headSha);

  const isMergeDisabled =
    isPending ||
    !canMerge ||
    !currentLayer ||
    currentLayer.state !== "open" ||
    currentLayer.isDraft ||
    mergeSlice.length === 0 ||
    hasDraftInMergeSlice ||
    hasClosedInMergeSlice ||
    hasUnknownHeadInMergeSlice;

  const topLayer = layers.at(-1);
  const hasUnknownHeadInUnmerged = unmergedLayers.some((l) => !l.headSha);
  const isRebaseDisabled =
    isPending ||
    !canRebase ||
    unmergedLayers.length === 0 ||
    hasClosedInUnmerged ||
    hasUnknownHeadInUnmerged;

  const handleExecuteAction = async () => {
    if (!confirmation || !onMutatePullRequest) return;
    const action = confirmation === "merge" ? "stack_merge" : "stack_rebase";
    const targetLayer = action === "stack_merge" ? currentLayer : topLayer;
    if (!targetLayer) return;

    const actionLayers = action === "stack_merge" ? mergeSlice : unmergedLayers;
    const expectedStackHeads: GitPullRequestStackHead[] = actionLayers.flatMap((layer) =>
      layer.headSha ? [{ number: layer.number, headSha: layer.headSha }] : [],
    );

    setIsPending(true);
    try {
      const ok = await onMutatePullRequest(targetLayer.number, action, {
        stackNumber: stack.number,
        expectedStackHeads,
        ...(action === "stack_merge" ? { mergeMethod } : {}),
      });

      if (ok) {
        toastManager.add({
          type: "success",
          title: action === "stack_merge" ? "Stack merge initiated" : "Stack rebased successfully",
          description:
            action === "stack_merge"
              ? `GitHub merged or queued ${actionLayers.length} pull request${actionLayers.length === 1 ? "" : "s"}.`
              : `Remote branches were rebased bottom-up onto ${stack.base}.`,
        });
        setConfirmation(null);
      }
    } catch (err: any) {
      toastManager.add({
        type: "error",
        title: "Stack operation failed",
        description: err?.message || String(err),
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div
      className="rounded-lg border border-border bg-card p-3.5 space-y-3 shadow-xs"
      data-testid="pull-request-stack-view"
    >
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-foreground">
            <Layers className="size-3.5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">Stack #{stack.number}</span>
              {currentPosition > 0 && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4.5">
                  Layer {currentPosition} of {layers.length}
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Base target:{" "}
              <code className="text-foreground/80 font-mono text-[10px]">{stack.base}</code>
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          {canRebase && (
            <Button
              variant="outline"
              size="xs"
              disabled={isRebaseDisabled}
              title={
                hasClosedInUnmerged
                  ? "Cannot rebase stack containing closed pull requests"
                  : hasUnknownHeadInUnmerged
                    ? "Head commit SHA missing for one or more layers"
                    : "Rebase unmerged stack layers onto base"
              }
              onClick={() => setConfirmation("rebase")}
              className="gap-1 text-xs"
            >
              <RefreshCw
                className={`size-3 ${isPending ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              Rebase stack
            </Button>
          )}

          {canMerge && currentLayer?.state === "open" && (
            <Button
              variant="default"
              size="xs"
              disabled={isMergeDisabled}
              title={
                hasDraftInMergeSlice
                  ? "Cannot merge stack with draft pull requests in merge order"
                  : hasClosedInMergeSlice
                    ? "Cannot merge stack with closed pull requests in merge order"
                    : `Merge ${mergeSlice.length} pull request${mergeSlice.length === 1 ? "" : "s"} through #${currentNumber}`
              }
              onClick={() => setConfirmation("merge")}
              className="gap-1 text-xs"
            >
              <GitMerge className="size-3" aria-hidden="true" />
              Merge stack ({mergeSlice.length})
            </Button>
          )}
        </div>
      </div>

      {/* Layers list - rendered from top (highest child) down to base */}
      <div
        className="space-y-1.5"
        role="list"
        aria-label={`Pull request stack ${stack.number} layers`}
      >
        {layers
          .slice()
          .reverse()
          .map((layer, reverseIndex) => {
            const index = layers.length - 1 - reverseIndex;
            const isCurrent = layer.number === currentNumber;
            const stateInfo = resolveLayerStateBadge(layer);
            const StateIcon = stateInfo.icon;

            return (
              <div
                key={layer.number}
                role="listitem"
                aria-current={isCurrent ? "true" : undefined}
                className={`group flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 transition-colors border ${
                  isCurrent
                    ? "bg-primary/10 border-primary/40 font-medium"
                    : "bg-muted/30 border-transparent hover:bg-muted/60 hover:border-border/50"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-mono text-muted-foreground border border-border/60 bg-background">
                    {index + 1}
                  </span>
                  <StateIcon
                    className={`size-3.5 shrink-0 ${stateInfo.colorClass}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onSelectPullRequest?.(layer.number)}
                        className={`truncate text-xs hover:underline text-left cursor-pointer ${
                          isCurrent ? "text-foreground font-semibold" : "text-foreground/90"
                        }`}
                        title={layer.title || layer.headBranch}
                      >
                        {layer.title || layer.headBranch}
                      </button>
                      {isCurrent && (
                        <Badge
                          variant="secondary"
                          className="text-[9px] px-1 py-0 h-4 shrink-0 font-normal"
                        >
                          Current
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>#{layer.number}</span>
                      <span>·</span>
                      <code className="font-mono">{layer.headBranch}</code>
                      {layer.headSha && (
                        <>
                          <span>·</span>
                          <span className="font-mono text-muted-foreground/80">
                            {layer.headSha.slice(0, 7)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={stateInfo.variant} className="text-[10px] px-1.5 py-0 h-4.5">
                    {stateInfo.label}
                  </Badge>
                  {!isCurrent && onSelectPullRequest && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => onSelectPullRequest(layer.number)}
                      className="text-xs text-muted-foreground hover:text-foreground h-6 px-1.5"
                    >
                      View
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {/* Base root connection */}
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground px-1 pt-0.5">
        <span className="text-muted-foreground/60 font-mono">↳</span>
        <span>Base branch:</span>
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">
          {stack.base}
        </code>
      </div>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !isPending) setConfirmation(null);
        }}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmation === "merge"
                ? `Merge ${mergeSlice.length} pull request${mergeSlice.length === 1 ? "" : "s"}?`
                : `Rebase ${unmergedLayers.length} pull request${unmergedLayers.length === 1 ? "" : "s"}?`}
            </DialogTitle>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {confirmation === "merge"
                ? `Merge pull request #${currentNumber} and all unmerged parent layers below it into ${stack.base} using ${mergeMethod}. GitHub checks branch rules and rebases the remaining stack.`
                : `Rebase all unmerged remote branches in this stack bottom-up onto ${stack.base}. This rewrites remote branch history without touching your local worktree.`}
            </p>

            <div className="max-h-48 overflow-y-auto space-y-1 rounded-md border border-border/60 bg-muted/20 p-2">
              {(confirmation === "merge" ? mergeSlice : unmergedLayers).map((layer) => (
                <div
                  key={layer.number}
                  className="flex items-center justify-between text-xs py-1 px-1.5 rounded bg-background/50"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="font-mono text-muted-foreground">#{layer.number}</span>
                    <span className="truncate">{layer.title || layer.headBranch}</span>
                  </div>
                  <Badge variant="outline" className="text-[9px] px-1 h-4 shrink-0">
                    {layer.headBranch}
                  </Badge>
                </div>
              ))}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={isPending}
              onClick={() => void handleExecuteAction()}
            >
              {isPending
                ? "Working…"
                : confirmation === "merge"
                  ? "Confirm & merge stack"
                  : "Confirm & rebase stack"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
