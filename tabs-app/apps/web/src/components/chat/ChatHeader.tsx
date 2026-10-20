import {
  type EditorId,
  type GitWatchedBranchStatus,
  type ProjectId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@tabs/contracts";
import { memo, useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  SquareMenuIcon,
  GitBranchIcon,
  DiffIcon,
  Maximize2Icon,
  Minimize2Icon,
  PanelRightIcon,
  PanelBottomIcon,
  XIcon,
  FolderGit2Icon,
  CheckIcon,
  ChevronDownIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  GitMergeIcon,
  SearchIcon,
  PlayIcon,
  DownloadIcon,
  Telescope,
  Loader2,
  Pin,
} from "lucide-react";
import GitActionsControl from "../GitActionsControl";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";
import { useVcs } from "~/state/vcs";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/stores/rightPanelStore";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  gitBranchesQueryOptions,
  gitCheckoutMutationOptions,
  gitCreateWorktreeMutationOptions,
  gitPullMutationOptions,
  gitWatchedBranchesQueryOptions,
  invalidateGitQueries,
} from "~/lib/gitReactQuery";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { environmentApi } from "~/connection/environmentApiRegistry";
import { gitWorkspaceScopeKey } from "~/components/git/gitApiContext";
import {
  loadPinnedBranches,
  togglePinnedBranch,
  MAX_PINNED_BRANCHES,
} from "~/components/git/pinnedBranches";
import { useScopedStateStore } from "~/state/scopedStateStore";
import { workspaceShellActions } from "~/state/workspaceShell";

interface ChatHeaderProps {
  scripts?: ReadonlyArray<ProjectScript> | undefined;
  onRunScript?: ((script: ProjectScript) => void) | undefined;
  projectId?: ProjectId | undefined;
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  activeProjectFavicon?: ProjectFaviconProject | null | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  environmentId?: string | undefined;
  diffOpen: boolean;
  rightPanelOpen?: boolean | undefined;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
  onToggleRightPanel?: (() => void) | undefined;
  rightPanelShortcutLabel?: string | null | undefined;
  isSplitActive?: boolean | undefined;
  isActivePane?: boolean | undefined;
  isMaximized?: boolean | undefined;
  onToggleMaximize?: (() => void) | undefined;
  onClosePane?: (() => void) | undefined;
}

/** Branch picker + checkout + worktree-creation with search, ahead/behind, pull, merge, and divergence */
function BranchSelectorControl({
  projectId,
  gitCwd,
  environmentId,
  currentBranch,
  isGitRepo,
  aheadCount,
  behindCount,
  hasUpstream,
  onOpenDivergence,
}: {
  projectId?: ProjectId | undefined;
  gitCwd: string | null;
  environmentId?: string | undefined;
  currentBranch: string | null;
  isGitRepo: boolean;
  aheadCount?: number | undefined;
  behindCount?: number | undefined;
  hasUpstream?: boolean | undefined;
  onOpenDivergence?: (() => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const [newWorktreeOpen, setNewWorktreeOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [search, setSearch] = useState("");
  const [isMerging, setIsMerging] = useState(false);
  const [mergingBranch, setMergingBranch] = useState<string | null>(null);

  const gitScopeKey = useMemo(
    () => (gitCwd ? gitWorkspaceScopeKey(environmentId, gitCwd) : ""),
    [environmentId, gitCwd],
  );

  const [pinnedBranches, setPinnedBranches] = useState<string[]>(() =>
    loadPinnedBranches(gitScopeKey),
  );

  useEffect(() => {
    setPinnedBranches(loadPinnedBranches(gitScopeKey));
  }, [gitScopeKey]);

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ gitScopeKey: string; branches: string[] }>;
      if (custom.detail?.gitScopeKey === gitScopeKey && Array.isArray(custom.detail.branches)) {
        setPinnedBranches(custom.detail.branches);
      }
    };
    window.addEventListener("tabs:pinned-branches-changed", handler);
    return () => window.removeEventListener("tabs:pinned-branches-changed", handler);
  }, [gitScopeKey]);

  const handlePinBranch = useCallback(
    (branchName: string) => {
      const res = togglePinnedBranch(gitScopeKey, pinnedBranches, branchName);
      if (res.action === "limit_reached") {
        toastManager.add({
          type: "warning",
          title: `Maximum ${MAX_PINNED_BRANCHES} branches can be pinned`,
          description: `Unpin a branch first to pin '${branchName}'.`,
        });
        return;
      }
      setPinnedBranches(res.branches);
      if (res.action === "pinned") {
        toastManager.add({
          type: "success",
          title: `Pinned '${branchName}' for divergence (${res.branches.length}/${MAX_PINNED_BRANCHES})`,
        });
      } else {
        toastManager.add({
          type: "info",
          title: `Unpinned '${branchName}'`,
        });
      }
    },
    [gitScopeKey, pinnedBranches],
  );

  const watchedBranchesQuery = useQuery({
    ...gitWatchedBranchesQueryOptions(gitCwd, [], environmentId),
    enabled: Boolean(gitCwd && isGitRepo),
  });
  const watchedBranches = watchedBranchesQuery.data?.branches ?? [];

  const watchedBranchesMap = useMemo(() => {
    const map = new Map<string, GitWatchedBranchStatus>();
    for (const b of watchedBranches) {
      map.set(b.name.toLowerCase(), b);
    }
    return map;
  }, [watchedBranches]);

  const pinnedBranchStatuses = useMemo(() => {
    return pinnedBranches.map((bName) => {
      const norm = bName.trim().toLowerCase();
      const stat = watchedBranches.find((w) => w.name.toLowerCase() === norm);
      const isCurrent = Boolean(currentBranch && currentBranch.toLowerCase() === norm);
      const behind = stat?.behindCount ?? 0;
      const ahead = stat?.aheadCount ?? 0;
      return { branchName: bName, status: stat, isCurrent, behind, ahead };
    });
  }, [pinnedBranches, watchedBranches, currentBranch]);

  const { data: branchData } = useQuery(gitBranchesQueryOptions(gitCwd, environmentId));
  const branches = branchData?.branches ?? [];

  const filteredBranches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? branches.filter((b) => b.name.toLowerCase().includes(q)) : branches;
  }, [branches, search]);

  const checkoutMutation = useMutation(
    gitCheckoutMutationOptions({ cwd: gitCwd, queryClient, environmentId }),
  );

  const pullMutation = useMutation(
    gitPullMutationOptions({ cwd: gitCwd, queryClient, environmentId }),
  );

  const worktreeMutation = useMutation(
    gitCreateWorktreeMutationOptions({ queryClient, environmentId }),
  );

  const handleCheckout = useCallback(
    (branch: string) => {
      checkoutMutation.mutate(branch, {
        onSuccess: () => {
          toastManager.add({ type: "success", title: `Switched to branch '${branch}'` });
        },
        onError: (err) => {
          toastManager.add({
            type: "error",
            title: "Checkout failed",
            description: err instanceof Error ? err.message : "An error occurred.",
          });
        },
      });
    },
    [checkoutMutation],
  );

  const handlePull = useCallback(() => {
    pullMutation.mutate(undefined, {
      onSuccess: () => {
        toastManager.add({ type: "success", title: "Pulled latest changes from upstream" });
      },
      onError: (err) => {
        toastManager.add({
          type: "error",
          title: "Pull failed",
          description: err instanceof Error ? err.message : "An error occurred.",
        });
      },
    });
  }, [pullMutation]);

  const handleMergeBranch = useCallback(
    async (targetName: string) => {
      if (!gitCwd) return;
      setIsMerging(true);
      setMergingBranch(targetName);
      try {
        const api = await environmentApi(environmentId);
        await api.git.merge({ cwd: gitCwd, branch: targetName });
        await invalidateGitQueries(queryClient);
        toastManager.add({
          type: "success",
          title: `Merged '${targetName}' into '${currentBranch ?? "HEAD"}'`,
        });
      } catch (err) {
        toastManager.add({
          type: "error",
          title: "Merge failed",
          description: err instanceof Error ? err.message : "An error occurred.",
        });
      } finally {
        setIsMerging(false);
        setMergingBranch(null);
      }
    },
    [gitCwd, environmentId, currentBranch, queryClient],
  );

  const handleCreateWorktree = useCallback(() => {
    const name = newBranchName.trim();
    if (!name || !gitCwd) return;
    worktreeMutation.mutate(
      { cwd: gitCwd, branch: currentBranch ?? "main", newBranch: name, environmentId },
      {
        onSuccess: () => {
          setNewWorktreeOpen(false);
          setNewBranchName("");
          toastManager.add({ type: "success", title: `Worktree created for '${name}'` });
        },
        onError: (err) => {
          toastManager.add({
            type: "error",
            title: "Worktree creation failed",
            description: err instanceof Error ? err.message : "An error occurred.",
          });
        },
      },
    );
  }, [newBranchName, gitCwd, currentBranch, worktreeMutation, environmentId]);

  const displayBranch = !isGitRepo ? "No repository" : (currentBranch ?? "Reading…");

  const showDivergence =
    isGitRepo && hasUpstream && ((aheadCount ?? 0) > 0 || (behindCount ?? 0) > 0);
  const hasBehind = (behindCount ?? 0) > 0;

  return (
    <div className="space-y-1.5">
      {/* Branch row: picker + pull button + divergence shortcut */}
      <div className="flex items-center gap-1">
        <Menu
          onOpenChange={(open) => {
            if (!open) setSearch("");
          }}
        >
          <MenuTrigger
            render={
              <button
                type="button"
                disabled={!isGitRepo || branches.length === 0}
                className="surface-control flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 group"
              />
            }
          >
            {checkoutMutation.isPending ? (
              <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <GitBranchIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
            )}
            <span className="flex-1 truncate text-left text-xs font-medium font-mono">
              {displayBranch}
            </span>
            {/* Ahead/behind badges */}
            {showDivergence && (
              <span className="flex shrink-0 items-center gap-0.5 font-mono text-[10px]">
                {(aheadCount ?? 0) > 0 && (
                  <span className="flex items-center gap-0.5 text-amber-500 font-semibold">
                    <ArrowUpIcon className="size-2.5" />
                    {aheadCount}
                  </span>
                )}
                {hasBehind && (
                  <span className="flex items-center gap-0.5 text-sky-500 font-semibold">
                    <ArrowDownIcon className="size-2.5" />
                    {behindCount}
                  </span>
                )}
              </span>
            )}
            {isGitRepo && branches.length > 0 && (
              <ChevronDownIcon
                aria-hidden="true"
                className="size-3 shrink-0 text-muted-foreground opacity-60 transition-transform duration-150 group-data-[popup-open]:rotate-180"
              />
            )}
          </MenuTrigger>

          <MenuPopup
            align="start"
            className="w-68 p-0 overflow-hidden shadow-lg border border-border/80"
          >
            {/* Search bar */}
            <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-1.5 bg-muted/20">
              <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search branches…"
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 py-0.5"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="size-4 flex items-center justify-center text-muted-foreground hover:text-foreground rounded"
                >
                  <XIcon className="size-3" />
                </button>
              )}
            </div>

            {/* New worktree — prominent top CTA */}
            <div className="border-b border-border/60 p-1 bg-accent/20">
              <MenuItem
                onClick={() => {
                  setSearch("");
                  setNewWorktreeOpen(true);
                }}
                className="gap-2 rounded-md bg-primary/10 text-primary hover:bg-primary/20 font-medium py-1.5"
              >
                <FolderGit2Icon className="size-3.5 shrink-0 text-primary" />
                <span className="flex-1 text-xs">New worktree…</span>
              </MenuItem>
            </div>

            {/* Branch list */}
            <div className="max-h-56 overflow-y-auto p-1 divide-y divide-border/20">
              {filteredBranches.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">No branches found</p>
              ) : (
                filteredBranches.map((b) => {
                  const wbStat = watchedBranchesMap.get(b.name.toLowerCase());
                  const isThisPinned = pinnedBranches.some(
                    (p) => p.toLowerCase() === b.name.toLowerCase(),
                  );
                  return (
                    <div
                      key={b.name}
                      className={cn(
                        "group/item flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/40",
                        b.current && "bg-accent/30 font-medium",
                      )}
                    >
                      <button
                        type="button"
                        disabled={b.current || checkoutMutation.isPending}
                        onClick={() => handleCheckout(b.name)}
                        className="flex flex-1 items-center gap-2 min-w-0 text-left disabled:cursor-default"
                      >
                        {checkoutMutation.isPending && checkoutMutation.variables === b.name ? (
                          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                        ) : (
                          <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground group-hover/item:text-foreground" />
                        )}
                        <span className="flex-1 truncate text-xs font-mono">{b.name}</span>
                        {b.current && (
                          <span className="flex items-center gap-1 text-[10px] text-primary shrink-0">
                            <CheckIcon className="size-3" />
                            <span>current</span>
                          </span>
                        )}
                      </button>

                      {/* Divergence stats relative to HEAD if available */}
                      {wbStat && (wbStat.behindCount > 0 || wbStat.aheadCount > 0) && (
                        <span className="flex items-center gap-1 font-mono text-[10px] shrink-0">
                          {wbStat.behindCount > 0 && (
                            <span
                              className="flex items-center text-amber-500 font-semibold"
                              title={`${wbStat.behindCount} commits behind ${b.name}`}
                            >
                              <ArrowDownIcon className="size-2.5" />
                              {wbStat.behindCount}
                            </span>
                          )}
                          {wbStat.aheadCount > 0 && (
                            <span
                              className="flex items-center text-emerald-500 font-semibold"
                              title={`${wbStat.aheadCount} commits ahead of ${b.name}`}
                            >
                              <ArrowUpIcon className="size-2.5" />
                              {wbStat.aheadCount}
                            </span>
                          )}
                        </span>
                      )}

                      {/* Pin branch for divergence tracking */}
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePinBranch(b.name);
                              }}
                              aria-label={
                                isThisPinned
                                  ? `Unpin ${b.name}`
                                  : `Pin ${b.name} for comparison (${pinnedBranches.length}/${MAX_PINNED_BRANCHES})`
                              }
                              className={cn(
                                "size-6 shrink-0 rounded flex items-center justify-center transition-all",
                                isThisPinned
                                  ? "text-sky-500 hover:bg-sky-500/20 opacity-100"
                                  : "opacity-30 hover:opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground",
                              )}
                            />
                          }
                        >
                          <Pin className={cn("size-3", isThisPinned && "fill-sky-500")} />
                        </TooltipTrigger>
                        <TooltipPopup side="left">
                          {isThisPinned
                            ? `Pinned (${pinnedBranches.length}/${MAX_PINNED_BRANCHES}) — click to unpin`
                            : `Pin ${b.name} for divergence tracking (${pinnedBranches.length}/${MAX_PINNED_BRANCHES})`}
                        </TooltipPopup>
                      </Tooltip>

                      {/* Quick Merge into current branch button */}
                      {!b.current && (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                disabled={isMerging}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleMergeBranch(b.name);
                                }}
                                aria-label={`Merge ${b.name} into ${currentBranch ?? "current branch"}`}
                                className="size-6 shrink-0 rounded flex items-center justify-center opacity-40 hover:opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground transition-all"
                              />
                            }
                          >
                            {isMerging && mergingBranch === b.name ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <GitMergeIcon className="size-3" />
                            )}
                          </TooltipTrigger>
                          <TooltipPopup side="left">
                            Merge {b.name} into {currentBranch ?? "HEAD"}
                          </TooltipPopup>
                        </Tooltip>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </MenuPopup>
        </Menu>

        {/* Pull button — shown when behind upstream */}
        {isGitRepo && hasUpstream && hasBehind && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  disabled={pullMutation.isPending}
                  onClick={handlePull}
                  aria-label={`Pull ${behindCount} commit${behindCount === 1 ? "" : "s"} from upstream`}
                  className="surface-control flex size-8 shrink-0 items-center justify-center rounded-lg text-sky-500 hover:bg-sky-500/10 transition-colors disabled:opacity-40"
                />
              }
            >
              {pullMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <DownloadIcon className="size-3.5" />
              )}
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              Pull {behindCount} commit{behindCount === 1 ? "" : "s"} from upstream
            </TooltipPopup>
          </Tooltip>
        )}

        {/* Divergence Space shortcut button */}
        {isGitRepo && onOpenDivergence && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={onOpenDivergence}
                  aria-label="Open Divergence space in Git view"
                  className="surface-control flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
                />
              }
            >
              <Telescope className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">Open Divergence space</TooltipPopup>
          </Tooltip>
        )}
      </div>

      {/* Pinned branches divergence banners (up to 4) */}
      {isGitRepo && pinnedBranchStatuses.length > 0 && (
        <div className="space-y-1">
          {pinnedBranchStatuses.map(({ branchName, isCurrent, behind, ahead }) => (
            <div
              key={branchName}
              className={cn(
                "flex items-center justify-between gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors",
                behind > 0
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : ahead > 0
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : isCurrent
                      ? "border-sky-500/20 bg-sky-500/5 text-sky-600 dark:text-sky-400"
                      : "border-border/70 bg-muted/20 text-muted-foreground",
              )}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Pin className="size-3 shrink-0 fill-current opacity-80" />
                <span className="truncate text-[10px] leading-tight font-mono">
                  {isCurrent ? (
                    <span>
                      Current branch (<strong>{branchName}</strong>)
                    </span>
                  ) : (
                    <>
                      vs <strong>{branchName}</strong>:
                      {behind > 0 && (
                        <span className="text-amber-500 font-semibold ml-1">+{behind} behind</span>
                      )}
                      {ahead > 0 && (
                        <span className="text-emerald-500 font-normal ml-1">+{ahead} ahead</span>
                      )}
                      {behind === 0 && ahead === 0 && (
                        <span className="text-emerald-500 font-medium ml-1">✓ Synced</span>
                      )}
                    </>
                  )}
                </span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {!isCurrent && behind > 0 && (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={isMerging}
                    onClick={() => void handleMergeBranch(branchName)}
                    className="h-5 px-1.5 text-[10px] border-amber-500/40 hover:bg-amber-500/20 shrink-0 gap-1 text-amber-600 dark:text-amber-400"
                  >
                    {isMerging && mergingBranch === branchName ? (
                      <Loader2 className="size-2.5 animate-spin" />
                    ) : (
                      <>
                        <GitMergeIcon className="size-2.5" />
                        Merge
                      </>
                    )}
                  </Button>
                )}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={() => handlePinBranch(branchName)}
                        aria-label={`Unpin ${branchName}`}
                        className="size-5 rounded flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-accent transition-colors"
                      />
                    }
                  >
                    <XIcon className="size-2.5" />
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">Unpin branch</TooltipPopup>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New worktree dialog */}
      <Dialog open={newWorktreeOpen} onOpenChange={setNewWorktreeOpen}>
        <DialogPopup>
          <DialogPanel>
            <DialogHeader>
              <DialogTitle>Create worktree</DialogTitle>
              <DialogDescription>
                Creates a new Git worktree from <strong>{currentBranch ?? "HEAD"}</strong> with a
                fresh branch.
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 pb-2">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                New branch name
              </label>
              <input
                type="text"
                autoFocus
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateWorktree();
                }}
                placeholder="e.g. feature/my-feature"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setNewWorktreeOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!newBranchName.trim() || worktreeMutation.isPending}
                onClick={handleCreateWorktree}
              >
                {worktreeMutation.isPending ? "Creating…" : "Create worktree"}
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </div>
  );
}

export const ChatHeader = memo(function ChatHeader({
  scripts,
  onRunScript,
  projectId,
  activeThreadId,
  activeThreadTitle,
  activeProjectName,
  activeProjectFavicon,
  isGitRepo,
  openInCwd,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  gitCwd,
  environmentId,
  diffOpen,
  rightPanelOpen,
  onToggleTerminal,
  onToggleDiff,
  onToggleRightPanel,
  rightPanelShortcutLabel,
  isSplitActive = false,
  isActivePane = true,
  isMaximized = false,
  onToggleMaximize,
  onClosePane,
}: ChatHeaderProps) {
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const workspaceCardRef = useRef<HTMLDivElement | null>(null);
  const workspaceTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!workspaceOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setWorkspaceOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [workspaceOpen]);

  const vcs = useVcs(gitCwd, environmentId);
  const storeIsOpen = useRightPanelStore((s) => s.isOpen);
  const storeToggle = useRightPanelStore((s) => s.toggleOpen);
  const effectiveRightPanelOpen = rightPanelOpen ?? storeIsOpen;
  const handleToggleRightPanel = onToggleRightPanel ?? (() => storeToggle());

  const handleOpenGitDivergence = useCallback(() => {
    if (gitCwd) {
      const gitScopeKey = gitWorkspaceScopeKey(environmentId, gitCwd);
      useScopedStateStore.getState().updateGitState(gitScopeKey, { panel: "divergence" });
      if (projectId) {
        workspaceShellActions.setActiveTool(projectId, "git");
      }
    }
  }, [projectId, environmentId, gitCwd]);

  const formattedProjectName = activeProjectName
    ? activeProjectName.toLowerCase().includes("tabs")
      ? "Tabs IDE"
      : activeProjectName
    : null;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <SidebarTrigger className="size-7 shrink-0 md:hidden" />
          {isSplitActive && (
            <span
              className={cn(
                "size-2 shrink-0 rounded-full transition-colors",
                isActivePane ? "bg-primary shadow-xs shadow-primary/40" : "bg-muted-foreground/30",
              )}
              title={isActivePane ? "Active thread pane" : "Inactive pane — click to activate"}
            />
          )}
          <h2
            className={cn(
              "min-w-0 truncate text-sm font-semibold tracking-tight",
              isSplitActive && !isActivePane
                ? "text-muted-foreground font-normal"
                : "text-foreground",
            )}
            title={activeThreadTitle}
          >
            {activeThreadTitle}
          </h2>
          {!isSplitActive && formattedProjectName && (
            <span
              className="hidden shrink-0 text-xs font-sans text-muted-foreground/50 sm:inline"
              title={activeProjectName}
            >
              · {formattedProjectName}
            </span>
          )}
          {!isSplitActive && !isGitRepo && activeProjectName && (
            <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
              No Git
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {activeProjectName && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    ref={workspaceTriggerRef}
                    type="button"
                    aria-label="Toggle workspace actions"
                    aria-expanded={workspaceOpen}
                    aria-controls={`workspace-card-${activeThreadId}`}
                    onClick={() => setWorkspaceOpen((open) => !open)}
                    className={cn(
                      "surface-control flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                      workspaceOpen && "bg-accent text-accent-foreground shadow-2xs",
                    )}
                  >
                    <SquareMenuIcon aria-hidden="true" className="size-4" />
                  </button>
                }
              />
              <TooltipPopup side="bottom">
                {workspaceOpen ? "Hide workspace actions" : "Workspace actions"}
              </TooltipPopup>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="size-9 rounded-lg border border-border/80 bg-background hover:bg-accent/40 hover:border-border text-foreground transition-colors shrink-0 p-0 shadow-2xs data-pressed:bg-accent data-pressed:text-accent-foreground data-pressed:border-border"
                  pressed={terminalOpen}
                  onPressedChange={onToggleTerminal}
                  aria-label="Toggle terminal drawer"
                  disabled={!terminalAvailable}
                >
                  <PanelBottomIcon className="size-4" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {!terminalAvailable
                ? "Terminal is unavailable until this thread has an active project."
                : terminalToggleShortcutLabel
                  ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
                  : "Toggle terminal drawer"}
            </TooltipPopup>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="size-9 rounded-lg border border-border/80 bg-background hover:bg-accent/40 hover:border-border text-foreground transition-colors shrink-0 p-0 shadow-2xs data-pressed:bg-accent data-pressed:text-accent-foreground data-pressed:border-border cursor-pointer"
                  pressed={effectiveRightPanelOpen}
                  onPressedChange={handleToggleRightPanel}
                  aria-label="Toggle companion side panel"
                >
                  <PanelRightIcon className="size-3.5" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {rightPanelShortcutLabel
                ? `Toggle companion side panel (${rightPanelShortcutLabel})`
                : "Toggle companion side panel (Browser, Files, Terminal, Diffs, PRs)"}
            </TooltipPopup>
          </Tooltip>

          {isSplitActive && (
            <div className="flex items-center gap-1 border-l border-border/60 pl-1.5 ml-0.5">
              {onToggleMaximize && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={isMaximized ? "Restore split layout" : "Maximize pane"}
                        onClick={onToggleMaximize}
                        className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        {isMaximized ? (
                          <Minimize2Icon className="size-3.5" />
                        ) : (
                          <Maximize2Icon className="size-3.5" />
                        )}
                      </button>
                    }
                  />
                  <TooltipPopup side="bottom">
                    {isMaximized ? "Restore split layout" : "Maximize pane"}
                  </TooltipPopup>
                </Tooltip>
              )}
              {onClosePane && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`Close ${activeThreadTitle}`}
                        onClick={onClosePane}
                        className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    }
                  />
                  <TooltipPopup side="bottom">Close pane</TooltipPopup>
                </Tooltip>
              )}
            </div>
          )}
        </div>
      </div>
      {activeProjectName && workspaceOpen && (
        <div
          ref={workspaceCardRef}
          className="absolute right-3 top-full z-40 mt-1 pointer-events-auto"
        >
          <section
            id={`workspace-card-${activeThreadId}`}
            aria-label="Workspace actions"
            className="workspace-card w-72 max-w-[calc(100vw-2rem)] rounded-[20px] border border-border/80 bg-background/95 backdrop-blur-md p-3 text-foreground shadow-xl [-webkit-app-region:no-drag] animate-in fade-in slide-in-from-top-1 duration-150"
          >
            {/* Project header — logo with rich tooltip + name/path + openInPicker + close */}
            <div className="flex items-center gap-2 pb-2.5">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <div
                      tabIndex={0}
                      role="button"
                      aria-label={`Project: ${activeProjectName ?? "Current project"}`}
                      className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border border-border/60 bg-muted/50 overflow-hidden shadow-2xs hover:bg-muted/80 transition-colors focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {activeProjectFavicon ? (
                        <ProjectFavicon project={activeProjectFavicon} className="size-4.5" />
                      ) : (
                        <GitBranchIcon
                          aria-hidden="true"
                          className="size-3.5 text-muted-foreground"
                        />
                      )}
                    </div>
                  }
                />
                <TooltipPopup
                  side="bottom"
                  align="start"
                  className="max-w-xs z-50 p-2.5 shadow-lg border border-border/80 bg-popover text-popover-foreground"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded border border-border/60 bg-muted/60 overflow-hidden">
                        {activeProjectFavicon ? (
                          <ProjectFavicon project={activeProjectFavicon} className="size-3.5" />
                        ) : (
                          <GitBranchIcon className="size-3 text-muted-foreground" />
                        )}
                      </span>
                      <p className="font-semibold text-xs leading-none truncate">
                        {activeProjectName ?? "Active Project"}
                      </p>
                    </div>
                    {openInCwd && (
                      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground break-all bg-muted/40 p-1.5 rounded border border-border/40">
                        {openInCwd}
                      </p>
                    )}
                    {vcs.status?.branch && (
                      <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1 font-mono text-foreground/80">
                          <GitBranchIcon className="size-3 text-primary shrink-0" />
                          <span>{vcs.status.branch}</span>
                        </span>
                        {vcs.status.hasUpstream && (
                          <span className="font-mono text-[9px] text-muted-foreground/70">
                            {(vcs.status.aheadCount ?? 0) > 0 ? `↑${vcs.status.aheadCount} ` : ""}
                            {(vcs.status.behindCount ?? 0) > 0 ? `↓${vcs.status.behindCount}` : ""}
                            {(vcs.status.aheadCount ?? 0) === 0 &&
                            (vcs.status.behindCount ?? 0) === 0
                              ? "Synced"
                              : ""}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </TooltipPopup>
              </Tooltip>

              <div className="min-w-0 flex-1">
                <p className="workspace-project truncate text-xs font-semibold leading-tight">
                  {activeProjectName}
                </p>
                <p
                  title={openInCwd ?? undefined}
                  className="truncate font-mono text-[9px] leading-tight text-muted-foreground/70 mt-0.5"
                >
                  {openInCwd ?? "Path unavailable"}
                </p>
              </div>

              {/* Open-in-editor as icon-only button in header */}
              <OpenInPicker
                keybindings={keybindings}
                availableEditors={availableEditors}
                openInCwd={openInCwd}
                showEditorName={false}
              />

              {/* Close card button */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Close workspace card"
                      onClick={() => setWorkspaceOpen(false)}
                      className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ml-0.5"
                    />
                  }
                >
                  <XIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipPopup side="bottom">Close</TooltipPopup>
              </Tooltip>
            </div>

            <div className="h-px bg-border/50" />

            {!!scripts?.length && onRunScript && (
              <div
                role="group"
                aria-label="Project scripts"
                className="my-2 max-h-48 space-y-1 overflow-y-auto"
              >
                {scripts.map((script) => (
                  <button
                    type="button"
                    key={script.id}
                    title={`Run ${script.name}`}
                    aria-label={`Run ${script.name}`}
                    onClick={() => onRunScript(script)}
                    className="surface-control flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <PlayIcon aria-hidden="true" className="size-3 shrink-0" />
                    <span className="truncate">{script.name}</span>
                  </button>
                ))}
              </div>
            )}
            {/* Git section */}
            <div className="mt-2.5 space-y-1.5">
              {/* Branch selector + pull + divergence */}
              <BranchSelectorControl
                projectId={projectId}
                gitCwd={gitCwd}
                environmentId={environmentId}
                currentBranch={vcs.status?.branch ?? null}
                isGitRepo={isGitRepo}
                aheadCount={vcs.status?.aheadCount}
                behindCount={vcs.status?.behindCount}
                hasUpstream={vcs.status?.hasUpstream}
                onOpenDivergence={handleOpenGitDivergence}
              />

              {/* Commit & Push */}
              <div className="flex w-full">
                <GitActionsControl
                  gitCwd={gitCwd}
                  activeThreadId={activeThreadId}
                  environmentId={environmentId}
                />
              </div>

              {/* Changed files */}
              <button
                type="button"
                disabled={!isGitRepo}
                className="surface-control flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
                onClick={() => {
                  if (!diffOpen) onToggleDiff();
                }}
              >
                <DiffIcon aria-hidden="true" className="size-3 text-muted-foreground" />
                <span className="flex-1 text-left">Changes</span>
                {vcs.status && (
                  <span className="flex gap-2 font-mono tabular-nums text-[11px]">
                    <span className="text-emerald-500 font-medium">
                      +{vcs.status.workingTree.insertions}
                    </span>
                    <span className="text-red-400 font-medium">
                      −{vcs.status.workingTree.deletions}
                    </span>
                  </span>
                )}
              </button>

              {/* Divergence Space shortcut link */}
              {isGitRepo && (
                <button
                  type="button"
                  onClick={handleOpenGitDivergence}
                  className="flex h-7 w-full items-center justify-between rounded-lg px-2 text-[11px] text-muted-foreground hover:bg-accent/40 hover:text-foreground transition-colors group"
                >
                  <span className="flex items-center gap-1.5">
                    <Telescope className="size-3 text-primary shrink-0" />
                    <span>Divergence space</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 group-hover:text-muted-foreground font-sans">
                    Compare all →
                  </span>
                </button>
              )}
            </div>

            {vcs.error && (
              <p role="status" className="mt-2 text-[10px] text-muted-foreground">
                Git status temporarily unavailable.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
});
