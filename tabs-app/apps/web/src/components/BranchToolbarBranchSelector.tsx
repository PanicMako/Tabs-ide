import { selectWorkspaceBranch } from "./workspaceBranchSelection";
import type { GitBranch } from "@tabs/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckIcon,
  ChevronDownIcon,
  GitBranchIcon,
  GitForkIcon,
  GitPullRequestIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { cn } from "~/lib/utils";

import {
  gitBranchesQueryOptions,
  gitStatusQueryOptions,
  invalidateGitQueries,
} from "../lib/gitReactQuery";
import { toGitUserFacingErrorMessage } from "../lib/gitErrorMessages";
import { environmentApi } from "../connection/environmentApiRegistry";
import { parsePullRequestReference } from "../pullRequestReference";
import {
  dedupeRemoteBranchesWithLocalMatches,
  deriveLocalBranchNameFromRemoteRef,
  EnvMode,
  resolveBranchToolbarValue,
} from "./BranchToolbar.logic";
import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPrimitive,
  ComboboxTrigger,
} from "./ui/combobox";
import { Switch } from "./ui/switch";
import { toastManager } from "./ui/toast";

interface BranchToolbarBranchSelectorProps {
  activeProjectCwd: string;
  activeThreadBranch: string | null;
  activeWorktreePath: string | null;
  branchCwd: string | null;
  environmentId?: string | undefined;
  effectiveEnvMode: EnvMode;
  envLocked: boolean;
  onSetThreadBranch: (branch: string | null, worktreePath: string | null) => Promise<boolean>;
  onPrepareBranchChange: () => Promise<boolean>;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
}

function toBranchActionErrorMessage(error: unknown): string {
  return toGitUserFacingErrorMessage(error);
}

function getBranchTriggerLabel(input: {
  activeWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
  resolvedActiveBranch: string | null;
}): string {
  const { activeWorktreePath, effectiveEnvMode, resolvedActiveBranch } = input;
  if (!resolvedActiveBranch) {
    return "Select branch";
  }
  if (effectiveEnvMode === "worktree" && !activeWorktreePath) {
    return `From ${resolvedActiveBranch}`;
  }
  return resolvedActiveBranch;
}

export function BranchToolbarBranchSelector({
  activeProjectCwd,
  activeThreadBranch,
  activeWorktreePath,
  branchCwd,
  environmentId,
  effectiveEnvMode,
  envLocked,
  onSetThreadBranch,
  onPrepareBranchChange,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
}: BranchToolbarBranchSelectorProps) {
  const queryClient = useQueryClient();
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const deferredBranchQuery = useDeferredValue(branchQuery);

  const branchesOptions = gitBranchesQueryOptions(branchCwd, environmentId);
  const branchesQuery = useQuery(branchesOptions);
  const branchStatusQuery = useQuery(gitStatusQueryOptions(branchCwd, environmentId));
  const startFromRemote = activeThreadBranch?.startsWith("refs/remotes/") ?? false;
  const rawBranches = branchesQuery.data?.branches ?? [];
  const branches = useMemo(
    () =>
      startFromRemote
        ? rawBranches.filter((branch) => branch.isRemote)
        : dedupeRemoteBranchesWithLocalMatches(rawBranches),
    [branchesQuery.data?.branches, startFromRemote],
  );
  const currentGitBranch =
    branchStatusQuery.data?.branch ?? branches.find((branch) => branch.current)?.name ?? null;
  const canonicalActiveBranch = resolveBranchToolbarValue({
    envMode: effectiveEnvMode,
    activeWorktreePath,
    activeThreadBranch: activeThreadBranch?.replace(/^refs\/remotes\//, "") ?? null,
    currentGitBranch,
  });
  const branchNames = useMemo(() => branches.map((branch) => branch.name), [branches]);
  const branchByName = useMemo(
    () => new Map(branches.map((branch) => [branch.name, branch] as const)),
    [branches],
  );
  const trimmedBranchQuery = branchQuery.trim();
  const deferredTrimmedBranchQuery = deferredBranchQuery.trim();
  const normalizedDeferredBranchQuery = deferredTrimmedBranchQuery.toLowerCase();
  const prReference = parsePullRequestReference(trimmedBranchQuery);
  const isSelectingWorktreeBase =
    effectiveEnvMode === "worktree" && !envLocked && !activeWorktreePath;
  const checkoutPullRequestItemValue =
    prReference && onCheckoutPullRequestRequest ? `__checkout_pull_request__:${prReference}` : null;
  const canCreateBranch = !isSelectingWorktreeBase && trimmedBranchQuery.length > 0;
  const hasExactBranchMatch = branchByName.has(trimmedBranchQuery);
  const createBranchItemValue = canCreateBranch
    ? `__create_new_branch__:${trimmedBranchQuery}`
    : null;
  const branchPickerItems = useMemo(() => {
    const items = [...branchNames];
    if (createBranchItemValue && !hasExactBranchMatch) {
      items.push(createBranchItemValue);
    }
    if (checkoutPullRequestItemValue) {
      items.unshift(checkoutPullRequestItemValue);
    }
    return items;
  }, [branchNames, checkoutPullRequestItemValue, createBranchItemValue, hasExactBranchMatch]);
  const filteredBranchPickerItems = useMemo(
    () =>
      normalizedDeferredBranchQuery.length === 0
        ? branchPickerItems
        : branchPickerItems.filter((itemValue) => {
            if (createBranchItemValue && itemValue === createBranchItemValue) return true;
            return itemValue.toLowerCase().includes(normalizedDeferredBranchQuery);
          }),
    [branchPickerItems, createBranchItemValue, normalizedDeferredBranchQuery],
  );
  const [resolvedActiveBranch, setOptimisticBranch] = useOptimistic(
    canonicalActiveBranch,
    (_currentBranch: string | null, optimisticBranch: string | null) => optimisticBranch,
  );
  const [isBranchActionPending, startBranchActionTransition] = useTransition();
  const shouldVirtualizeBranchList = filteredBranchPickerItems.length > 40;

  const runBranchAction = (action: () => Promise<void>) => {
    startBranchActionTransition(async () => {
      await action().catch((error) => {
        toastManager.add({
          type: "error",
          title: "Branch operation failed",
          description: toBranchActionErrorMessage(error),
        });
      });
      await invalidateGitQueries(queryClient).catch(() => undefined);
    });
  };

  const selectBranch = (branch: GitBranch) => {
    if (!branchCwd || isBranchActionPending) return;

    // In new-worktree mode, selecting a branch sets the base branch.
    if (isSelectingWorktreeBase) {
      runBranchAction(async () => {
        await onSetThreadBranch(
          startFromRemote ? `refs/remotes/${branch.name}` : branch.name,
          null,
        );
      });
      setIsBranchMenuOpen(false);
      onComposerFocusRequest?.();
      return;
    }

    setIsBranchMenuOpen(false);
    onComposerFocusRequest?.();
    runBranchAction(async () => {
      const next = await selectWorkspaceBranch({
        branch,
        projectCwd: activeProjectCwd,
        activeWorktreePath,
        environmentId,
        prepare: onPrepareBranchChange,
        setThreadBranch: onSetThreadBranch,
      });
      if (next) setOptimisticBranch(next);
    });
  };

  const createBranch = (rawName: string) => {
    const name = rawName.trim();
    if (!branchCwd || !name || isBranchActionPending) return;

    setIsBranchMenuOpen(false);
    onComposerFocusRequest?.();

    runBranchAction(async () => {
      if (!(await onPrepareBranchChange())) return;
      const api = await environmentApi(environmentId);
      setOptimisticBranch(name);

      try {
        await api.git.createBranch({ cwd: branchCwd, branch: name });
        try {
          await api.git.checkout({ cwd: branchCwd, branch: name });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to checkout branch.",
            description: toBranchActionErrorMessage(error),
          });
          return;
        }
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to create branch.",
          description: toBranchActionErrorMessage(error),
        });
        return;
      }

      setOptimisticBranch(name);
      await onSetThreadBranch(name, activeWorktreePath);
      setBranchQuery("");
    });
  };

  useEffect(() => {
    if (
      effectiveEnvMode !== "worktree" ||
      activeWorktreePath ||
      activeThreadBranch ||
      !currentGitBranch
    ) {
      return;
    }
    void onSetThreadBranch(currentGitBranch, null);
  }, [
    activeThreadBranch,
    activeWorktreePath,
    currentGitBranch,
    effectiveEnvMode,
    onSetThreadBranch,
  ]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsBranchMenuOpen(open);
      if (!open) {
        setBranchQuery("");
        return;
      }
      void queryClient.invalidateQueries({
        queryKey: branchesOptions.queryKey,
      });
    },
    [branchCwd, environmentId, queryClient],
  );

  const branchListScrollElementRef = useRef<HTMLDivElement | null>(null);
  const branchListVirtualizer = useVirtualizer({
    count: filteredBranchPickerItems.length,
    estimateSize: (index) =>
      filteredBranchPickerItems[index] === checkoutPullRequestItemValue ? 44 : 30,
    getScrollElement: () => branchListScrollElementRef.current,
    overscan: 12,
    enabled: isBranchMenuOpen && shouldVirtualizeBranchList,
    initialRect: {
      height: 224,
      width: 0,
    },
  });
  const virtualBranchRows = branchListVirtualizer.getVirtualItems();
  const setBranchListRef = useCallback(
    (element: HTMLDivElement | null) => {
      branchListScrollElementRef.current =
        (element?.parentElement as HTMLDivElement | null) ?? null;
      if (element) {
        branchListVirtualizer.measure();
      }
    },
    [branchListVirtualizer],
  );

  useEffect(() => {
    if (!isBranchMenuOpen || !shouldVirtualizeBranchList) return;
    queueMicrotask(() => {
      branchListVirtualizer.measure();
    });
  }, [
    branchListVirtualizer,
    filteredBranchPickerItems.length,
    isBranchMenuOpen,
    shouldVirtualizeBranchList,
  ]);

  const triggerLabel = getBranchTriggerLabel({
    activeWorktreePath,
    effectiveEnvMode,
    resolvedActiveBranch: resolvedActiveBranch
      ? `${resolvedActiveBranch}${isSelectingWorktreeBase && startFromRemote ? " (remote)" : ""}`
      : null,
  });

  function renderPickerItem(itemValue: string, index: number, style?: CSSProperties) {
    if (checkoutPullRequestItemValue && itemValue === checkoutPullRequestItemValue) {
      return (
        <ComboboxItem
          hideIndicator
          key={itemValue}
          index={index}
          value={itemValue}
          className="group flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-xs transition-colors hover:bg-primary/10"
          style={{ ...style, borderRadius: 8 }}
          onClick={() => {
            if (!prReference || !onCheckoutPullRequestRequest) {
              return;
            }
            setIsBranchMenuOpen(false);
            setBranchQuery("");
            onComposerFocusRequest?.();
            onCheckoutPullRequestRequest(prReference);
          }}
        >
          <div className="flex w-full min-w-0 items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                <GitPullRequestIcon className="size-3.5" aria-hidden="true" />
              </div>
              <div className="flex min-w-0 flex-col items-start">
                <span className="truncate font-medium text-xs text-foreground">
                  Checkout Pull Request
                </span>
                <span className="truncate text-muted-foreground text-[10px] font-mono">
                  {prReference}
                </span>
              </div>
            </div>
          </div>
        </ComboboxItem>
      );
    }
    if (createBranchItemValue && itemValue === createBranchItemValue) {
      return (
        <ComboboxItem
          hideIndicator
          key={itemValue}
          index={index}
          value={itemValue}
          className="group flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-xs transition-colors hover:bg-primary/10 text-primary"
          style={{ ...style, borderRadius: 8 }}
          onClick={() => createBranch(trimmedBranchQuery)}
        >
          <div className="flex w-full min-w-0 items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                <PlusIcon className="size-3.5" aria-hidden="true" />
              </div>
              <span className="truncate text-xs">
                Create branch{" "}
                <span className="font-semibold text-foreground font-mono">
                  "{trimmedBranchQuery}"
                </span>
              </span>
            </div>
          </div>
        </ComboboxItem>
      );
    }

    const branch = branchByName.get(itemValue);
    if (!branch) return null;

    const isCurrent = Boolean(branch.current);
    const isSelected = itemValue === resolvedActiveBranch;
    const hasSecondaryWorktree = Boolean(
      branch.worktreePath && branch.worktreePath !== activeProjectCwd,
    );
    const badge = isCurrent
      ? "current"
      : hasSecondaryWorktree
        ? "worktree"
        : branch.isRemote
          ? "remote"
          : branch.isDefault
            ? "default"
            : null;

    return (
      <ComboboxItem
        hideIndicator
        key={itemValue}
        index={index}
        value={itemValue}
        className={cn(
          "group flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-xs transition-colors",
          isSelected
            ? "bg-accent/80 font-medium text-foreground"
            : "text-foreground/85 hover:bg-muted/60 hover:text-foreground",
        )}
        style={{ ...style, borderRadius: 8 }}
        onClick={() => selectBranch(branch)}
      >
        <div className="flex w-full min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {hasSecondaryWorktree ? (
              <GitForkIcon className="size-3.5 shrink-0 text-amber-500/80 group-hover:text-amber-500 transition-colors" />
            ) : isCurrent ? (
              <GitBranchIcon className="size-3.5 shrink-0 text-primary group-hover:text-primary transition-colors" />
            ) : (
              <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground/60 group-hover:text-foreground/80 transition-colors" />
            )}
            <span className="truncate font-mono text-[11.5px] tracking-tight">{itemValue}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {badge === "current" && (
              <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-primary/15 text-primary border border-primary/20">
                current
              </span>
            )}
            {badge === "default" && (
              <span className="rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider bg-muted text-muted-foreground/80 border border-border/40">
                default
              </span>
            )}
            {badge === "worktree" && (
              <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25">
                worktree
              </span>
            )}
            {badge === "remote" && (
              <span className="rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider bg-muted/60 text-muted-foreground/70 border border-border/30">
                remote
              </span>
            )}
            {isSelected && (
              <CheckIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            )}
          </div>
        </div>
      </ComboboxItem>
    );
  }

  return (
    <Combobox
      items={branchPickerItems}
      filteredItems={filteredBranchPickerItems}
      autoHighlight
      virtualized={shouldVirtualizeBranchList}
      onItemHighlighted={(_value, eventDetails) => {
        if (!isBranchMenuOpen || eventDetails.index < 0) return;
        branchListVirtualizer.scrollToIndex(eventDetails.index, { align: "auto" });
      }}
      onOpenChange={handleOpenChange}
      open={isBranchMenuOpen}
      value={resolvedActiveBranch}
    >
      <ComboboxTrigger
        render={<Button aria-label="Branch or worktree" variant="ghost" size="xs" />}
        className="max-w-full shrink-0 text-muted-foreground/70 hover:text-foreground/80"
        disabled={(branchesQuery.isLoading && branches.length === 0) || isBranchActionPending}
      >
        <span className="max-w-[240px] truncate">{triggerLabel}</span>
        <ChevronDownIcon />
      </ComboboxTrigger>
      <ComboboxPopup
        align="end"
        side="top"
        sideOffset={6}
        style={{ borderRadius: 14 }}
        className="w-88 overflow-hidden border border-border/70 bg-popover/98 p-0 shadow-2xl backdrop-blur-xl ring-1 ring-black/5 dark:ring-white/5"
      >
        {/* Search header: clean unified input row with search icon, native placeholder, and Esc shortcut pill */}
        <div className="flex items-center gap-2.5 border-b border-border/50 bg-muted/20 px-3.5 py-2.5">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
          <ComboboxPrimitive.Input
            value={branchQuery}
            onChange={(event) => setBranchQuery(event.target.value)}
            placeholder="Search branches..."
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 outline-none border-0 p-0 shadow-none focus:outline-none focus:ring-0 font-sans"
            autoFocus
          />
          {branchQuery.length > 0 ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setBranchQuery("")}
              className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            >
              <XIcon className="size-3" />
            </button>
          ) : (
            <kbd className="pointer-events-none hidden h-4 select-none items-center rounded border border-border/50 bg-background/80 px-1 font-mono text-[9px] font-medium text-muted-foreground/60 sm:inline-flex">
              ESC
            </kbd>
          )}
        </div>

        {/* Empty state: empty:hidden prevents any empty space when branches are present */}
        <ComboboxEmpty className="empty:hidden px-4 py-8 text-center">
          <div className="flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <SearchIcon className="size-4 opacity-40 mb-0.5" />
            <p className="text-xs font-medium text-foreground/80">No branches found</p>
            {trimmedBranchQuery ? (
              <p className="text-[11px] text-muted-foreground/60">
                No branches matching "{trimmedBranchQuery}"
              </p>
            ) : null}
          </div>
        </ComboboxEmpty>

        <ComboboxList ref={setBranchListRef} className="max-h-60 p-1.5 space-y-0.5">
          {shouldVirtualizeBranchList ? (
            <div
              className="relative"
              style={{
                height: `${branchListVirtualizer.getTotalSize()}px`,
              }}
            >
              {virtualBranchRows.map((virtualRow) => {
                const itemValue = filteredBranchPickerItems[virtualRow.index];
                if (!itemValue) return null;
                return renderPickerItem(itemValue, virtualRow.index, {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                });
              })}
            </div>
          ) : (
            filteredBranchPickerItems.map((itemValue, index) => renderPickerItem(itemValue, index))
          )}
        </ComboboxList>

        {/* Footer: status and keyboard hints */}
        <div className="flex items-center justify-between border-t border-border/40 bg-muted/15 px-3 py-1.5 text-[10px] text-muted-foreground/60 select-none">
          <span>
            {filteredBranchPickerItems.length}{" "}
            {filteredBranchPickerItems.length === 1 ? "branch" : "branches"}
          </span>
          <span className="flex items-center gap-1.5">
            <span>
              <kbd className="font-mono text-[9px] bg-muted/50 px-1 py-0.5 rounded border border-border/40">
                ↑
              </kbd>
              <kbd className="font-mono text-[9px] bg-muted/50 px-1 py-0.5 rounded border border-border/40">
                ↓
              </kbd>{" "}
              navigate
            </span>
            <span>
              <kbd className="font-mono text-[9px] bg-muted/50 px-1 py-0.5 rounded border border-border/40">
                ↵
              </kbd>{" "}
              select
            </span>
          </span>
        </div>

        {isSelectingWorktreeBase && rawBranches.some((branch) => branch.isRemote) && (
          <label className="flex items-center justify-between gap-3 border-t border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-2 font-medium">
              <RefreshCwIcon className="size-3.5 text-muted-foreground/70" aria-hidden="true" />
              Start from remote
            </span>
            <Switch
              aria-label="Start from remote"
              checked={startFromRemote}
              disabled={isBranchActionPending}
              onCheckedChange={(enabled) => {
                const current = canonicalActiveBranch ?? currentGitBranch;
                const remote =
                  rawBranches.find(
                    (branch) =>
                      branch.isRemote &&
                      deriveLocalBranchNameFromRemoteRef(branch.name, branch.remoteName) ===
                        current,
                  ) ?? rawBranches.find((branch) => branch.isRemote);
                if (enabled && remote)
                  runBranchAction(async () => {
                    await onSetThreadBranch(`refs/remotes/${remote.name}`, null);
                  });
                else if (!enabled)
                  runBranchAction(async () => {
                    await onSetThreadBranch(
                      current ? deriveLocalBranchNameFromRemoteRef(current) : currentGitBranch,
                      null,
                    );
                  });
              }}
            />
          </label>
        )}
      </ComboboxPopup>
    </Combobox>
  );
}
