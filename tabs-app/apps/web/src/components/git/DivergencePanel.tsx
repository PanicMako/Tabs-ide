import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  CheckSquare,
  Download,
  GitCompare,
  Loader2,
  MousePointerClick,
  RefreshCw,
  Search,
  Telescope,
  Square,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { GitWatchedBranchStatus } from "@tabs/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateGitQueries } from "../../lib/gitReactQuery";
import { toGitUserFacingErrorMessage } from "../../lib/gitErrorMessages";
import { useGitApi, useGitScopeKey } from "./gitApiContext";
import { toastManager } from "../ui/toast";
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
import { Card } from "./gitPrimitives";

type ViewMode = "active" | "spotlight" | "archived";

function useLocalStorageSet(key: string) {
  const [set, setSet] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
      return [];
    }
  });

  const save = useCallback(
    (next: string[]) => {
      setSet(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
    },
    [key],
  );

  return [set, save] as const;
}

export function DivergencePanel({
  cwd,
  watchedBranchStatuses,
  isFullScan = false,
  isScanning = false,
  onScanAllBranches,
}: {
  cwd: string;
  watchedBranchStatuses: ReadonlyArray<GitWatchedBranchStatus>;
  isFullScan?: boolean;
  isScanning?: boolean;
  onScanAllBranches: () => void;
}) {
  const gitScopeKey = useGitScopeKey();
  const [confirmMergeBranch, setConfirmMergeBranch] = useState<string | null>(null);
  const [confirmRebaseBranch, setConfirmRebaseBranch] = useState<string | null>(null);
  const [isSubmittingModal, setIsSubmittingModal] = useState(false);

  // Search & Tab State
  const [searchQuery, setSearchQuery] = useState("");
  const [activeView, setActiveView] = useState<ViewMode>("active");

  // Selection mode — explicit toggle, not hover-driven
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedBranchNames, setSelectedBranchNames] = useState<Set<string>>(new Set());

  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedBranchNames(new Set());
  };

  // Per-repo persisted sets
  const [archivedBranches, saveArchivedBranches] = useLocalStorageSet(
    `tabs_archived_watched_branches_${gitScopeKey}`,
  );
  const [spotlightBranches, saveSpotlightBranches] = useLocalStorageSet(
    `tabs_spotlight_watched_branches_${gitScopeKey}`,
  );

  const archiveSet = useMemo(
    () => new Set(archivedBranches.map((b) => b.toLowerCase())),
    [archivedBranches],
  );
  const spotlightSet = useMemo(
    () => new Set(spotlightBranches.map((b) => b.toLowerCase())),
    [spotlightBranches],
  );

  // Derive the three lists
  const activeBranchList = useMemo(
    () =>
      watchedBranchStatuses.filter(
        (b) => !archiveSet.has(b.name.toLowerCase()) && !spotlightSet.has(b.name.toLowerCase()),
      ),
    [watchedBranchStatuses, archiveSet, spotlightSet],
  );

  const spotlightBranchList = useMemo(
    () =>
      watchedBranchStatuses.filter(
        (b) => spotlightSet.has(b.name.toLowerCase()) && !archiveSet.has(b.name.toLowerCase()),
      ),
    [watchedBranchStatuses, archiveSet, spotlightSet],
  );

  const archivedBranchList = useMemo(
    () => watchedBranchStatuses.filter((b) => archiveSet.has(b.name.toLowerCase())),
    [watchedBranchStatuses, archiveSet],
  );

  // Filtered list based on view + search
  const displayedBranches = useMemo(() => {
    const baseList =
      activeView === "active"
        ? activeBranchList
        : activeView === "spotlight"
          ? spotlightBranchList
          : archivedBranchList;
    if (!searchQuery.trim()) return baseList;
    const q = searchQuery.trim().toLowerCase();
    return baseList.filter((b) => b.name.toLowerCase().includes(q));
  }, [activeView, activeBranchList, spotlightBranchList, archivedBranchList, searchQuery]);

  // --- Archive toggle ---
  const handleToggleArchive = (branchName: string) => {
    const lc = branchName.toLowerCase();
    const isArchived = archiveSet.has(lc);
    if (isArchived) {
      saveArchivedBranches(archivedBranches.filter((b) => b.toLowerCase() !== lc));
      toastManager.add({ type: "info", title: `Removed ${branchName} from archive` });
    } else {
      // archiving also removes from spotlight
      saveSpotlightBranches(spotlightBranches.filter((b) => b.toLowerCase() !== lc));
      saveArchivedBranches([...archivedBranches, branchName]);
      toastManager.add({ type: "info", title: `Archived ${branchName}` });
    }
    setSelectedBranchNames((prev) => {
      const copy = new Set(prev);
      copy.delete(branchName);
      return copy;
    });
  };

  // --- Spotlight toggle ---
  const handleToggleSpotlight = (branchName: string) => {
    const lc = branchName.toLowerCase();
    const isSpotlit = spotlightSet.has(lc);
    if (isSpotlit) {
      saveSpotlightBranches(spotlightBranches.filter((b) => b.toLowerCase() !== lc));
      toastManager.add({ type: "info", title: `Removed ${branchName} from Spotlight` });
    } else {
      // spotlighting also removes from archive
      saveArchivedBranches(archivedBranches.filter((b) => b.toLowerCase() !== lc));
      saveSpotlightBranches([...spotlightBranches, branchName]);
      toastManager.add({ type: "info", title: `Added ${branchName} to Spotlight ✦` });
    }
    setSelectedBranchNames((prev) => {
      const copy = new Set(prev);
      copy.delete(branchName);
      return copy;
    });
  };

  // --- Bulk operations ---
  const handleBulkArchiveToggle = (archive: boolean) => {
    if (selectedBranchNames.size === 0) return;
    const targets = Array.from(selectedBranchNames);
    const targetSet = new Set(targets.map((t) => t.toLowerCase()));

    if (archive) {
      const nextArchived = Array.from(new Set([...archivedBranches, ...targets]));
      const nextSpotlight = spotlightBranches.filter((b) => !targetSet.has(b.toLowerCase()));
      saveArchivedBranches(nextArchived);
      saveSpotlightBranches(nextSpotlight);
      toastManager.add({
        type: "info",
        title: `Archived ${targets.length} branch${targets.length === 1 ? "" : "es"}`,
      });
    } else {
      saveArchivedBranches(archivedBranches.filter((b) => !targetSet.has(b.toLowerCase())));
      toastManager.add({
        type: "info",
        title: `Removed ${targets.length} branch${targets.length === 1 ? "" : "es"} from archive`,
      });
    }
    exitSelectMode();
  };

  const handleBulkSpotlightToggle = (spotlight: boolean) => {
    if (selectedBranchNames.size === 0) return;
    const targets = Array.from(selectedBranchNames);
    const targetSet = new Set(targets.map((t) => t.toLowerCase()));

    if (spotlight) {
      const nextSpotlight = Array.from(new Set([...spotlightBranches, ...targets]));
      const nextArchived = archivedBranches.filter((b) => !targetSet.has(b.toLowerCase()));
      saveSpotlightBranches(nextSpotlight);
      saveArchivedBranches(nextArchived);
      toastManager.add({
        type: "info",
        title: `Added ${targets.length} branch${targets.length === 1 ? "" : "es"} to Spotlight`,
      });
    } else {
      saveSpotlightBranches(spotlightBranches.filter((b) => !targetSet.has(b.toLowerCase())));
      toastManager.add({
        type: "info",
        title: `Removed ${targets.length} branch${targets.length === 1 ? "" : "es"} from Spotlight`,
      });
    }
    exitSelectMode();
  };

  // --- Selection helpers ---
  const handleToggleSelectAll = () => {
    if (selectedBranchNames.size === displayedBranches.length && displayedBranches.length > 0) {
      setSelectedBranchNames(new Set());
    } else {
      setSelectedBranchNames(new Set(displayedBranches.map((b) => b.name)));
    }
  };

  const toggleSelectOne = (branchName: string) => {
    setSelectedBranchNames((prev) => {
      const copy = new Set(prev);
      if (copy.has(branchName)) copy.delete(branchName);
      else copy.add(branchName);
      return copy;
    });
  };

  const switchView = (view: ViewMode) => {
    setActiveView(view);
    exitSelectMode();
    setSearchQuery("");
  };

  const api = useGitApi();
  const queryClient = useQueryClient();

  const handleExecuteMerge = async (targetBranch: string) => {
    if (!api) return;
    setIsSubmittingModal(true);
    try {
      await api.git.merge({ cwd, branch: targetBranch });
      await invalidateGitQueries(queryClient);
      setConfirmMergeBranch(null);
      toastManager.add({ type: "success", title: `Merged ${targetBranch} into current branch` });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Merge failed",
        description: toGitUserFacingErrorMessage(error),
      });
    } finally {
      setIsSubmittingModal(false);
    }
  };

  const handleExecuteRebase = async (targetBranch: string) => {
    if (!api) return;
    setIsSubmittingModal(true);
    try {
      await api.git.rebase({ cwd, branch: targetBranch });
      await invalidateGitQueries(queryClient);
      setConfirmRebaseBranch(null);
      toastManager.add({ type: "success", title: `Rebased current branch onto ${targetBranch}` });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Rebase failed",
        description: toGitUserFacingErrorMessage(error),
      });
    } finally {
      setIsSubmittingModal(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 custom-scrollbar">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <GitCompare size={18} className="text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground tracking-tight">
              Watched branch divergence
            </h2>
          </div>
          <p className="text-xs text-muted-foreground/80 leading-relaxed mt-0.5">
            Compare all branches against your current HEAD. Spotlight key branches, archive noise.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 block">
              {isFullScan ? "Full scan view" : "Bounded scan view"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {isFullScan ? "All branches checked" : "Top 30 active branches checked"}
            </span>
          </div>

          <Button
            size="sm"
            variant={!isFullScan ? "default" : "outline"}
            disabled={isScanning}
            onClick={onScanAllBranches}
          >
            {isScanning ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw />}
            {isScanning
              ? "Scanning all branches…"
              : isFullScan
                ? "Rescan all branches"
                : "Scan all branches"}
          </Button>
        </div>
      </div>

      {/* Control Bar */}
      <div className="flex items-center justify-between gap-3 mb-4">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground z-10"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search branches by name..."
            className="w-full pl-8 pr-8 py-1.5 text-xs font-mono bg-muted/50 border border-border rounded-lg text-foreground outline-none focus:border-sky-500 transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear branch search"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* View Switcher — three tabs: Spotlight | Active | Archived */}
          <div className="tabs-segmented flex items-center" role="group" aria-label="Branch view">
            <button
              type="button"
              aria-pressed={activeView === "spotlight"}
              onClick={() => switchView("spotlight")}
              className={`flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
                activeView === "spotlight"
                  ? "font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Telescope size={11} />
              Spotlight ({spotlightBranchList.length})
            </button>
            <button
              type="button"
              aria-pressed={activeView === "active"}
              onClick={() => switchView("active")}
              className={`px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
                activeView === "active"
                  ? "bg-accent text-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Active ({activeBranchList.length})
            </button>
            <button
              type="button"
              aria-pressed={activeView === "archived"}
              onClick={() => switchView("archived")}
              className={`px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
                activeView === "archived"
                  ? "bg-accent text-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Archived ({archivedBranchList.length})
            </button>
          </div>

          {/* Explicit Select Mode Toggle */}
          {!isSelectMode ? (
            <button
              type="button"
              onClick={() => setIsSelectMode(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border border-border bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
              title="Enter selection mode"
            >
              <MousePointerClick size={13} />
              Select
            </button>
          ) : (
            <button
              type="button"
              onClick={exitSelectMode}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-700 dark:border-sky-700 dark:bg-sky-900/30 dark:text-sky-300 transition-colors"
            >
              <X size={13} />
              Done
            </button>
          )}
        </div>
      </div>

      {/* Bulk Operations Bar — only visible in selection mode with items selected */}
      {isSelectMode && selectedBranchNames.size > 0 && (
        <div className="flex items-center justify-between bg-sky-500/10 dark:bg-sky-950/40 border border-sky-500/20 dark:border-sky-800/50 rounded-lg px-3.5 py-2.5 mb-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleToggleSelectAll}
              className="flex items-center gap-2 text-xs font-mono text-sky-800 dark:text-sky-200 cursor-pointer"
            >
              {selectedBranchNames.size === displayedBranches.length ? (
                <CheckSquare size={15} className="text-sky-600 dark:text-sky-400" />
              ) : (
                <Square size={15} className="text-sky-600/70 dark:text-sky-400/60" />
              )}
              <span>Select all ({displayedBranches.length})</span>
            </button>
            <span className="text-muted-foreground/70">|</span>
            <span className="text-xs font-mono text-sky-800 dark:text-sky-300 font-medium">
              {selectedBranchNames.size} selected
            </span>
          </div>

          <div className="flex items-center gap-2">
            {activeView !== "spotlight" && (
              <Button size="sm" onClick={() => handleBulkSpotlightToggle(true)}>
                <Telescope /> Add to Spotlight
              </Button>
            )}
            {activeView === "spotlight" && (
              <Button variant="ghost" size="sm" onClick={() => handleBulkSpotlightToggle(false)}>
                <Telescope /> Remove from Spotlight
              </Button>
            )}
            {activeView !== "archived" && (
              <Button variant="ghost" size="sm" onClick={() => handleBulkArchiveToggle(true)}>
                <Archive /> Archive
              </Button>
            )}
            {activeView === "archived" && (
              <Button variant="ghost" size="sm" onClick={() => handleBulkArchiveToggle(false)}>
                <ArchiveRestore /> Un-archive
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Main list */}
      {isScanning && watchedBranchStatuses.length === 0 ? (
        <Card className="p-8 text-center">
          <RefreshCw className="animate-spin mx-auto mb-3 text-muted-foreground/70" size={24} />
          <div className="text-xs font-medium text-foreground">
            Scanning all branches for divergence…
          </div>
          <p className="text-[11px] text-muted-foreground/70 mt-1">
            Comparing all local and remote branches against HEAD
          </p>
        </Card>
      ) : displayedBranches.length === 0 ? (
        <Card className="p-8 text-center">
          {activeView === "spotlight" && (
            <Telescope
              className="mx-auto mb-3"
              size={24}
              style={{ color: "var(--primary)", opacity: 0.5 }}
            />
          )}
          <div className="text-xs font-medium text-muted-foreground mb-1">
            {searchQuery
              ? `No ${activeView} branches matching "${searchQuery}"`
              : activeView === "archived"
                ? "No archived branches"
                : activeView === "spotlight"
                  ? "No branches in Spotlight"
                  : "No active divergent branches found"}
          </div>
          <p className="text-[11px] text-muted-foreground/70">
            {searchQuery
              ? "Try clearing your search query"
              : activeView === "archived"
                ? "Branches you archive will appear here."
                : activeView === "spotlight"
                  ? "Use the ✦ button on any branch to add it to Spotlight for quick access."
                  : "All watched branches are fully in sync with your current HEAD."}
          </p>
        </Card>
      ) : (
        <Card className="p-4">
          {/* List header */}
          <div className="flex items-center justify-between pb-2 border-b border-border/50 mb-1">
            {isSelectMode ? (
              <button
                type="button"
                onClick={handleToggleSelectAll}
                className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground hover:text-foreground cursor-pointer"
              >
                {selectedBranchNames.size > 0 &&
                selectedBranchNames.size === displayedBranches.length ? (
                  <CheckSquare size={14} className="text-sky-600 dark:text-sky-400" />
                ) : (
                  <Square size={14} className="text-muted-foreground/70" />
                )}
                <span>Select all ({displayedBranches.length})</span>
              </button>
            ) : (
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
                {activeView === "active"
                  ? "Active divergent branches"
                  : activeView === "spotlight"
                    ? "✦ Spotlight branches"
                    : "Archived branches"}
              </span>
            )}
            <span className="text-[11px] font-mono text-muted-foreground/70">
              Showing {displayedBranches.length} branch{displayedBranches.length === 1 ? "" : "es"}
            </span>
          </div>

          {/* Rows */}
          <div className="flex flex-col">
            {displayedBranches.map((b, idx, arr) => {
              const isSelected = selectedBranchNames.has(b.name);
              const isSpotlit = spotlightSet.has(b.name.toLowerCase());
              return (
                <div
                  key={b.name}
                  className={`flex items-center justify-between gap-3 py-2.5 px-2 -mx-2 rounded-md transition-colors ${
                    isSelected ? "bg-accent" : "hover:bg-muted/50"
                  } ${idx === arr.length - 1 ? "" : "border-b border-border/50"}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {/* Checkbox — only visible in select mode */}
                    {isSelectMode && (
                      <button
                        type="button"
                        aria-label={isSelected ? `Deselect ${b.name}` : `Select ${b.name}`}
                        aria-pressed={isSelected}
                        onClick={() => toggleSelectOne(b.name)}
                        className="cursor-pointer shrink-0"
                        title={isSelected ? "Deselect" : "Select"}
                      >
                        {isSelected ? (
                          <CheckSquare size={14} className="text-sky-600 dark:text-sky-400" />
                        ) : (
                          <Square size={14} className="text-muted-foreground/70" />
                        )}
                      </button>
                    )}

                    <span className="text-xs font-mono font-semibold text-foreground/90 truncate">
                      {b.name}
                    </span>
                    {b.isRemote && <Badge variant="outline">remote</Badge>}
                    {b.isDefault && <Badge variant="success">default</Badge>}

                    {b.behindCount > 0 && (
                      <span
                        className="flex items-center gap-0.5 text-[11px] font-mono shrink-0"
                        style={{ color: "var(--sem-amber)" }}
                      >
                        <ArrowDown size={12} />
                        {b.behindCount} behind
                      </span>
                    )}
                    {b.aheadCount > 0 && (
                      <span
                        className="flex items-center gap-0.5 text-[11px] font-mono shrink-0"
                        style={{ color: "var(--sem-emerald)" }}
                      >
                        <ArrowDown size={12} className="rotate-180" />
                        {b.aheadCount} ahead
                      </span>
                    )}
                  </div>

                  {/* Row actions */}
                  <div className="flex items-center gap-2 shrink-0 ml-auto">
                    <Button variant="ghost" size="sm" onClick={() => setConfirmMergeBranch(b.name)}>
                      <Download /> Merge
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmRebaseBranch(b.name)}
                    >
                      Rebase
                    </Button>

                    {/* Spotlight toggle */}
                    <button
                      type="button"
                      aria-label={
                        isSpotlit ? `Remove ${b.name} from Spotlight` : `Add ${b.name} to Spotlight`
                      }
                      aria-pressed={isSpotlit}
                      title={isSpotlit ? "Remove from Spotlight" : "Add to Spotlight"}
                      onClick={() => handleToggleSpotlight(b.name)}
                      className={`p-1 rounded transition-colors cursor-pointer ${
                        isSpotlit
                          ? "text-amber-600 dark:text-amber-400 hover:bg-muted/50"
                          : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/50"
                      }`}
                    >
                      <Telescope size={14} />
                    </button>

                    {/* Archive toggle */}
                    <button
                      type="button"
                      aria-label={
                        activeView === "archived"
                          ? `Restore ${b.name} from archive`
                          : `Archive ${b.name}`
                      }
                      title={activeView === "archived" ? "Remove from archive" : "Archive branch"}
                      onClick={() => handleToggleArchive(b.name)}
                      className="p-1 rounded text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                    >
                      {activeView === "archived" ? (
                        <ArchiveRestore size={14} />
                      ) : (
                        <Archive size={14} />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Confirmation Modals */}
      {confirmMergeBranch && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !isSubmittingModal) setConfirmMergeBranch(null);
          }}
        >
          <DialogPopup className="git-tool-v2 max-w-md">
            <DialogHeader>
              <DialogTitle>Merge {confirmMergeBranch}</DialogTitle>
            </DialogHeader>
            <DialogPanel>
              <p className="text-xs text-muted-foreground">
                This will merge commits from <strong>{confirmMergeBranch}</strong> into your current
                working branch.
              </p>
            </DialogPanel>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                disabled={isSubmittingModal}
                onClick={() => setConfirmMergeBranch(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isSubmittingModal}
                onClick={() => void handleExecuteMerge(confirmMergeBranch)}
              >
                {isSubmittingModal ? <Loader2 size={13} className="animate-spin" /> : <Download />}
                {isSubmittingModal ? "Merging…" : `Merge ${confirmMergeBranch}`}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      )}

      {confirmRebaseBranch && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !isSubmittingModal) setConfirmRebaseBranch(null);
          }}
        >
          <DialogPopup className="git-tool-v2 max-w-md">
            <DialogHeader>
              <DialogTitle>Rebase onto {confirmRebaseBranch}</DialogTitle>
            </DialogHeader>
            <DialogPanel>
              <p className="text-xs text-muted-foreground">
                This will rebase your current working branch commits onto{" "}
                <strong>{confirmRebaseBranch}</strong>.
              </p>
            </DialogPanel>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                disabled={isSubmittingModal}
                onClick={() => setConfirmRebaseBranch(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isSubmittingModal}
                onClick={() => void handleExecuteRebase(confirmRebaseBranch)}
              >
                {isSubmittingModal ? <Loader2 size={13} className="animate-spin" /> : null}
                {isSubmittingModal ? "Rebasing…" : `Rebase onto ${confirmRebaseBranch}`}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      )}
    </div>
  );
}
