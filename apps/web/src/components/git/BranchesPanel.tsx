import type { GitBranch as GitBranchType } from "@tabs/contracts";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  GitBranch as GitBranchIcon,
  GitMerge,
  GitPullRequest,
  Loader2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { toGitUserFacingErrorMessage } from "../../lib/gitErrorMessages";
import { invalidateGitQueries } from "../../lib/gitReactQuery";
import { useGitApi, useGitScopeKey } from "./gitApiContext";
import { toastManager } from "../ui/toast";
import { GitCheckingState } from "./GitCheckingState";
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
import { Banner, Card, InlineForm, PanelToolbar } from "./gitPrimitives";

import { useProjectGitState } from "../../state/scopedStateStore";

export function BranchesPanel({
  cwd,
  activeBranch,
  allBranches,
  aheadCount,
  behindCount,
  isDetached,
  loadingBranches,
  onOpenNewBranch,
  onOpenNewWorktree,
  onGoToChanges,
}: {
  cwd: string;
  activeBranch: GitBranchType | null;
  allBranches: ReadonlyArray<GitBranchType>;
  aheadCount: number;
  behindCount: number;
  isDetached: boolean;
  loadingBranches?: boolean;
  onOpenNewBranch: () => void;
  onOpenNewWorktree: () => void;
  onGoToChanges?: () => void;
}) {
  const [gitState, setGitState] = useProjectGitState(useGitScopeKey());
  const form = gitState.branchForm;
  const setForm = useCallback(
    (f: "new" | "rename" | null) => {
      setGitState({ branchForm: f });
    },
    [setGitState],
  );
  const [confirmModal, setConfirmModal] = useState<{
    type: "merge" | "rebase";
    targetBranch: string;
  } | null>(null);
  const [conflictState, setConflictState] = useState<{ active: boolean; message: string }>({
    active: false,
    message: "",
  });
  const [actionBranchMap, setActionBranchMap] = useState<Record<string, "checkout" | "delete">>({});
  const [isSubmittingModal, setIsSubmittingModal] = useState(false);

  const api = useGitApi();
  const queryClient = useQueryClient();

  const otherBranches = useMemo(() => allBranches.filter((b) => !b.current), [allBranches]);

  const checkoutBranch = useCallback(
    async (name: string) => {
      if (!api) return;
      setActionBranchMap((prev) => ({ ...prev, [name]: "checkout" }));
      try {
        await api.git.checkout({ cwd, branch: name });
        await invalidateGitQueries(queryClient);
        toastManager.add({ type: "success", title: `Switched to ${name}` });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Checkout failed",
          description: toGitUserFacingErrorMessage(error),
        });
      } finally {
        setActionBranchMap((prev) => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }
    },
    [api, cwd, queryClient],
  );

  const mergeBranch = useCallback(
    async (name: string) => {
      if (!api) return;
      setIsSubmittingModal(true);
      try {
        await api.git.merge({ cwd, branch: name });
        await invalidateGitQueries(queryClient);
        setConflictState({ active: false, message: "" });
        setConfirmModal(null);
        toastManager.add({ type: "success", title: `Merged ${name} into current branch` });
      } catch (error) {
        const errMsg = toGitUserFacingErrorMessage(error);
        if (errMsg.toLowerCase().includes("conflict")) {
          setConflictState({ active: true, message: `Merge conflict while merging ${name}.` });
        }
        toastManager.add({ type: "error", title: "Merge failed", description: errMsg });
      } finally {
        setIsSubmittingModal(false);
      }
    },
    [api, cwd, queryClient],
  );

  const rebaseBranch = useCallback(
    async (name: string) => {
      if (!api) return;
      setIsSubmittingModal(true);
      try {
        await api.git.rebase({ cwd, branch: name });
        await invalidateGitQueries(queryClient);
        setConflictState({ active: false, message: "" });
        setConfirmModal(null);
        toastManager.add({ type: "success", title: `Rebased current branch onto ${name}` });
      } catch (error) {
        const errMsg = toGitUserFacingErrorMessage(error);
        if (errMsg.toLowerCase().includes("conflict")) {
          setConflictState({
            active: true,
            message: `Rebase conflict while rebasing onto ${name}.`,
          });
        }
        toastManager.add({ type: "error", title: "Rebase failed", description: errMsg });
      } finally {
        setIsSubmittingModal(false);
      }
    },
    [api, cwd, queryClient],
  );

  const deleteBranch = useCallback(
    async (name: string, force = false) => {
      if (!api) return;
      setActionBranchMap((prev) => ({ ...prev, [name]: "delete" }));
      try {
        await api.git.deleteBranch({ cwd, branch: name, force });
        await invalidateGitQueries(queryClient);
        toastManager.add({ type: "success", title: `Deleted branch ${name}` });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Delete failed",
          description: toGitUserFacingErrorMessage(error),
        });
      } finally {
        setActionBranchMap((prev) => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }
    },
    [api, cwd, queryClient],
  );

  const createBranch = useCallback(
    async (name: string) => {
      if (!api) return;
      try {
        await api.git.createBranch({ cwd, branch: name });
        await api.git.checkout({ cwd, branch: name });
        await invalidateGitQueries(queryClient);
        toastManager.add({ type: "success", title: `Created and switched to ${name}` });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Create branch failed",
          description: toGitUserFacingErrorMessage(error),
        });
      }
    },
    [api, cwd, queryClient],
  );

  const renameBranch = useCallback(
    async (name: string) => {
      if (!api || !activeBranch) return;
      try {
        await api.git.renameBranch({ cwd, oldBranch: activeBranch.name, newBranch: name });
        await invalidateGitQueries(queryClient);
        toastManager.add({ type: "success", title: `Renamed branch to ${name}` });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Rename branch failed",
          description: toGitUserFacingErrorMessage(error),
        });
      }
    },
    [api, activeBranch, cwd, queryClient],
  );

  if (loadingBranches) {
    return <GitCheckingState message="Loading branches…" size={36} />;
  }

  return (
    <div>
      {form === null && (
        <PanelToolbar>
          <Button size="sm" onClick={() => setForm("new")}>
            New branch
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenNewWorktree}>
            New worktree
          </Button>
        </PanelToolbar>
      )}

      {conflictState.active && (
        <Banner
          tone="bad"
          title="Merge / Rebase Conflict Detected"
          body={conflictState.message}
          actions={
            onGoToChanges && (
              <Button size="sm" onClick={onGoToChanges}>
                Resolve in Changes
              </Button>
            )
          }
        />
      )}
      {aheadCount > 0 && behindCount > 0 && (
        <Banner
          tone="info"
          title={`${activeBranch?.name} has diverged`}
          body={`${aheadCount} ahead, ${behindCount} behind origin/${activeBranch?.name}.`}
        />
      )}
      {isDetached && (
        <Banner
          tone="warn"
          title="Detached HEAD"
          body="You're viewing a specific commit, not a branch."
        />
      )}

      <Card className="p-2">
        <div className="flex items-center gap-2.5 px-2 py-2 border-b border-border/50">
          <Badge variant="warning">
            <GitBranchIcon />{" "}
            {isDetached ? `${activeBranch?.name ?? "HEAD"} (detached)` : activeBranch?.name}
          </Badge>
          <span className="text-[11px] font-mono text-muted-foreground/70 flex-1">
            {aheadCount || behindCount ? `↑${aheadCount} ↓${behindCount}` : "up to date"}
          </span>
          {!isDetached && (
            <Button variant="ghost" size="sm" onClick={() => setForm("rename")}>
              Rename
            </Button>
          )}
        </div>
        {otherBranches.length === 0 ? (
          <div className="text-[11px] text-muted-foreground/70 px-3 py-4 text-center">
            No other branches in this repository.
          </div>
        ) : (
          otherBranches.map((b) => {
            const action = actionBranchMap[b.name];
            return (
              <div
                key={b.name}
                className="flex items-center gap-2.5 px-2 py-2 border-b border-border/50 last:border-0"
              >
                <span className="text-xs font-mono text-foreground/90 flex-1 truncate">
                  {b.name}
                </span>
                <Badge variant="outline">{b.isRemote ? "remote" : "local"}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={Boolean(action)}
                  onClick={() => setConfirmModal({ type: "merge", targetBranch: b.name })}
                >
                  Merge into current
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={Boolean(action)}
                  onClick={() => setConfirmModal({ type: "rebase", targetBranch: b.name })}
                >
                  Rebase onto…
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={Boolean(action)}
                  onClick={() => void checkoutBranch(b.name)}
                >
                  {action === "checkout" ? <Loader2 size={12} className="animate-spin" /> : null}
                  {action === "checkout" ? "Switching…" : "Switch"}
                </Button>
                {!b.isRemote && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={Boolean(action)}
                    onClick={() => void deleteBranch(b.name, false)}
                  >
                    {action === "delete" ? <Loader2 size={12} className="animate-spin" /> : null}
                    {action === "delete" ? "Deleting…" : "Delete"}
                  </Button>
                )}
              </div>
            );
          })
        )}
      </Card>

      {form === "new" && (
        <div className="mt-3">
          <InlineForm
            placeholder="new-branch-name"
            submitLabel="Create"
            onSubmit={async (name) => {
              await createBranch(name);
              setForm(null);
            }}
            onCancel={() => setForm(null)}
          />
        </div>
      )}
      {form === "rename" && (
        <div className="mt-3">
          <InlineForm
            placeholder="new name"
            initial={activeBranch?.name ?? ""}
            submitLabel="Rename"
            onSubmit={async (name) => {
              await renameBranch(name);
              setForm(null);
            }}
            onCancel={() => setForm(null)}
          />
        </div>
      )}

      {confirmModal && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !isSubmittingModal) setConfirmModal(null);
          }}
        >
          <DialogPopup className="git-tool-v2 max-w-md">
            <DialogHeader>
              <DialogTitle>
                {confirmModal.type === "merge"
                  ? `Merge ${confirmModal.targetBranch}`
                  : `Rebase onto ${confirmModal.targetBranch}`}
              </DialogTitle>
            </DialogHeader>
            <DialogPanel className="space-y-4">
              <p className="text-xs text-foreground/90">
                {confirmModal.type === "merge"
                  ? `Are you sure you want to merge '${confirmModal.targetBranch}' into '${activeBranch?.name}'?`
                  : `Are you sure you want to rebase '${activeBranch?.name}' onto '${confirmModal.targetBranch}'?`}
              </p>
              <p className="text-[11px] text-muted-foreground/70">
                This operation modifies the current working tree and commit history. If conflicts
                occur, you can resolve them in the Changes panel.
              </p>
            </DialogPanel>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                disabled={isSubmittingModal}
                onClick={() => setConfirmModal(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isSubmittingModal}
                onClick={() => {
                  const { type, targetBranch } = confirmModal;
                  if (type === "merge") {
                    void mergeBranch(targetBranch);
                  } else {
                    void rebaseBranch(targetBranch);
                  }
                }}
              >
                {isSubmittingModal ? <Loader2 size={12} className="animate-spin" /> : null}
                {isSubmittingModal
                  ? confirmModal.type === "merge"
                    ? "Merging…"
                    : "Rebasing…"
                  : `Confirm ${confirmModal.type === "merge" ? "Merge" : "Rebase"}`}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      )}
    </div>
  );
}
