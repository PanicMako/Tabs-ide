import type {
  GitHistoryCommit,
  GitRepositoryActionInput,
  GitWatchedBranchStatus,
  ThreadId,
} from "@tabs/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import "./git/GitToolV2.css";

import {
  gitBranchesQueryOptions,
  gitEnvironmentQueryOptions,
  gitHistoryQueryOptions,
  gitHubLogoutMutationOptions,
  gitHubSwitchAccountMutationOptions,
  gitInitMutationOptions,
  gitStashListQueryOptions,
  gitStatusQueryOptions,
  gitWatchedBranchesQueryOptions,
  invalidateGitQueries,
} from "../lib/gitReactQuery";
import { toGitUserFacingErrorMessage } from "../lib/gitErrorMessages";
import { environmentApi } from "../connection/environmentApiRegistry";
import { AccountsPanel } from "./git/AccountsPanel";
import { BranchesPanel } from "./git/BranchesPanel";
import { ChangesPanel } from "./git/ChangesPanel";
import { DiffPage } from "./git/DiffPage";
import { DivergencePanel } from "./git/DivergencePanel";
import { GitCheckingState } from "./git/GitCheckingState";
import { GitEnvironmentGate } from "./git/GitEnvironmentGate";
import { PanelErrorBoundary } from "./git/PanelErrorBoundary";

import { HistoryPanel } from "./git/HistoryPanel";
import { OverviewPanel } from "./git/OverviewPanel";
import { PRsPanel } from "./git/PRsPanel";
import { SettingsPanel } from "./git/SettingsPanel";
import { Sidebar, type NavPanel } from "./git/Sidebar";
import { StashesPanel } from "./git/StashesPanel";
import { TagsPanel } from "./git/TagsPanel";
import { TopBar } from "./git/TopBar";
import { ReviewPanel } from "./git/ReviewPanel";
import { GitApiProvider, gitWorkspaceScopeKey } from "./git/gitApiContext";
import { useReviewStore } from "./git/reviewStateStore";
import {
  AddRemoteModal,
  CreatePRModal,
  DeviceAuthModal,
  DiscardAllModal,
  DraftReleaseModal,
  ForcePushModal,
  NewWorktreeModal,
  PullSourceModal,
  ResetModal,
  StashModal,
} from "./git/gitModals";
import { toastManager } from "./ui/toast";

/* ============================== Types ============================== */

export interface GitToolV2Props {
  cwd: string;
  environmentId?: string | undefined;
  activeThreadId: ThreadId | null;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  onRunInTerminal: (command: string) => void;
  onOpenAgents: () => void | Promise<void>;
  onRunGitHubLogin: () => void | Promise<void>;
}

/* ============================== Main GitToolV2 ============================== */

/* ============================== OverviewPanel & ChangesPanel moved to ./git/ ============================== */

/* ============================== DiffPage moved to ./git/DiffPage ============================== */

/* ============================== BranchesPanel moved to ./git/BranchesPanel ============================== */

/* ============================== CommitRow & HistoryPanel moved to ./git/HistoryPanel ============================== */

/* ============================== PRsPanel moved to ./git/PRsPanel ============================== */

/* ============================== TagsPanel & StashesPanel moved to ./git/ ============================== */

/* ============================== AccountsPanel & SettingsPanel moved to ./git/ ============================== */

/* ============================== Main GitToolV2 ============================== */

import { useProjectGitState } from "../state/scopedStateStore";

export function GitToolV2({
  cwd,
  environmentId,
  activeThreadId,
  terminalAvailable,
  terminalOpen,
  onToggleTerminal,
  onRunInTerminal,
  onOpenAgents,
  onRunGitHubLogin,
}: GitToolV2Props) {
  const gitScopeKey = useMemo(() => gitWorkspaceScopeKey(environmentId, cwd), [cwd, environmentId]);
  const [api, setApi] = useState<Awaited<ReturnType<typeof environmentApi>> | null>(null);
  useEffect(() => {
    let active = true;
    setApi(null);
    void environmentApi(environmentId).then((next) => {
      if (active) setApi(next);
    });
    return () => {
      active = false;
    };
  }, [environmentId]);
  const queryClient = useQueryClient();
  const { unreadCount, clearUnread } = useReviewStore(gitScopeKey);
  const [gitState, setGitState] = useProjectGitState(gitScopeKey);

  const panel = gitState.panel;
  const setPanel = useCallback(
    (p: NavPanel) => {
      if (p === "review") {
        clearUnread();
      }
      setGitState({ panel: p });
    },
    [clearUnread, setGitState],
  );

  const [collapsed, setCollapsedState] = useState<boolean>(() => {
    try {
      if (window.localStorage?.getItem("tabs.alwaysMinimizeGitSidebar") === "true") {
        return true;
      }
      return window.localStorage?.getItem(`tabs_git_sidebar_collapsed_${gitScopeKey}`) === "true";
    } catch {
      return false;
    }
  });

  const setCollapsed = useCallback(
    (c: boolean) => {
      setCollapsedState(c);
      try {
        window.localStorage?.setItem(`tabs_git_sidebar_collapsed_${gitScopeKey}`, String(c));
      } catch {}
    },
    [gitScopeKey],
  );

  const [historyLimit, setHistoryLimit] = useState(50);

  // Queries
  const gitStatusQuery = useQuery(gitStatusQueryOptions(cwd, environmentId));
  const gitEnvironmentQuery = useQuery(gitEnvironmentQueryOptions(cwd, environmentId));
  const branchesQuery = useQuery(gitBranchesQueryOptions(cwd, environmentId));
  const historyQuery = useQuery({
    ...gitHistoryQueryOptions({ cwd, limit: historyLimit, environmentId }),
    enabled: ["overview", "diff", "history", "tags"].includes(panel),
  });

  const stashQuery = useQuery({
    ...gitStashListQueryOptions(cwd, environmentId),
    enabled: panel === "stashes",
  });
  const gitInitMutation = useMutation(gitInitMutationOptions({ cwd, queryClient, environmentId }));
  const switchMutation = useMutation(
    gitHubSwitchAccountMutationOptions({ cwd, queryClient, environmentId }),
  );
  const logoutMutation = useMutation(
    gitHubLogoutMutationOptions({ cwd, queryClient, environmentId }),
  );

  const [excludedWatchedBranches, setExcludedWatchedBranches] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`tabs_excluded_watched_branches_${gitScopeKey}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const addExcludedBranch = useCallback(
    (branch: string) => {
      setExcludedWatchedBranches((prev) => {
        if (prev.includes(branch)) return prev;
        const updated = [...prev, branch];
        try {
          localStorage.setItem(
            `tabs_excluded_watched_branches_${gitScopeKey}`,
            JSON.stringify(updated),
          );
        } catch {}
        return updated;
      });
    },
    [gitScopeKey],
  );

  const removeExcludedBranch = useCallback(
    (branch: string) => {
      setExcludedWatchedBranches((prev) => {
        const updated = prev.filter((b) => b !== branch);
        try {
          localStorage.setItem(
            `tabs_excluded_watched_branches_${gitScopeKey}`,
            JSON.stringify(updated),
          );
        } catch {}
        return updated;
      });
    },
    [gitScopeKey],
  );

  const watchedBranchesQuery = useQuery({
    ...gitWatchedBranchesQueryOptions(cwd, excludedWatchedBranches, environmentId),
    enabled: panel === "overview" || panel === "divergence",
  });
  const watchedBranchStatuses = watchedBranchesQuery.data?.branches ?? [];

  const [isFullScanning, setIsFullScanning] = useState(false);
  const [fullScanResult, setFullScanResult] =
    useState<ReadonlyArray<GitWatchedBranchStatus> | null>(null);

  const handleScanAllBranches = useCallback(async () => {
    if (!api || !cwd) return;
    setIsFullScanning(true);
    try {
      const res = await api.git.watchedBranchStatuses({
        cwd,
        excludedBranches: excludedWatchedBranches,
        maxCandidates: 0,
      });
      setFullScanResult(res.branches);
      toastManager.add({
        type: "success",
        title: "Full scan completed",
        description: `Scanned all branches in repository (${res.branches.length} diverged).`,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Scan failed",
        description: toGitUserFacingErrorMessage(error),
      });
    } finally {
      setIsFullScanning(false);
    }
  }, [api, cwd, excludedWatchedBranches]);

  const statusData = gitStatusQuery.data ?? null;
  const environmentData = gitEnvironmentQuery.data ?? null;
  const branchList = branchesQuery.data ?? null;
  const allBranches = branchList?.branches ?? [];
  const activeBranch = allBranches.find((b) => b.current) ?? null;
  const branchName = activeBranch?.name ?? statusData?.branch ?? "main";
  const aheadCount = statusData?.aheadCount ?? 0;
  const behindCount = statusData?.behindCount ?? 0;
  const stagedFiles = statusData?.staged?.files ?? [];
  const unstagedFiles = statusData?.unstaged?.files ?? [];
  const conflictedFiles = statusData?.conflicted?.files ?? [];
  const changeCount = useMemo(
    () =>
      new Set([...stagedFiles, ...unstagedFiles, ...conflictedFiles].map((file) => file.path)).size,
    [conflictedFiles, stagedFiles, unstagedFiles],
  );
  const hasConflict = conflictedFiles.length > 0;
  const commits = historyQuery.data?.commits ?? [];
  const stashes = stashQuery.data?.entries ?? [];
  const accounts = environmentData?.gitHub.accounts ?? [];
  const activeAccountLogin = environmentData?.gitHub.activeLogin ?? null;

  const systemActiveLogin = accounts.find((a) => a.active)?.login ?? null;
  const isCredentialMismatch =
    Boolean(activeAccountLogin) &&
    Boolean(systemActiveLogin) &&
    activeAccountLogin !== systemActiveLogin;

  // Modals
  const [modal, setModal] = useState<
    | null
    | "stash"
    | "discardAll"
    | "forcePush"
    | "createPR"
    | "addRemote"
    | "deviceAuth"
    | "newWorktree"
    | "draftRelease"
    | "pullSource"
    | { kind: "reset"; commit: GitHistoryCommit }
  >(null);

  const closeModal = useCallback(() => setModal(null), []);

  const doStash = useCallback(
    async (msg: string) => {
      if (!api) return;
      try {
        await api.git.saveStash({ cwd, message: msg || undefined });
        await invalidateGitQueries(queryClient);
        closeModal();
        toastManager.add({ type: "success", title: "Stashed changes" });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Stash failed",
          description: toGitUserFacingErrorMessage(error),
        });
      }
    },
    [api, closeModal, cwd, queryClient],
  );

  const doDiscardAll = useCallback(async () => {
    if (!api) return;
    try {
      await api.git.discardChanges({ cwd, discardStaged: true, discardUnstaged: true });
      await invalidateGitQueries(queryClient);
      closeModal();
      toastManager.add({ type: "success", title: "Discarded all changes" });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Discard failed",
        description: toGitUserFacingErrorMessage(error),
      });
    }
  }, [api, closeModal, cwd, queryClient]);

  const stashPullReapply = useCallback(
    async (sourceBranch: string) => {
      if (!api) return;
      const hasChanges = changeCount > 0;
      try {
        if (hasChanges) {
          await api.git.saveStash({ cwd });
          await invalidateGitQueries(queryClient);
        }
        await api.git.pull({ cwd });
        await invalidateGitQueries(queryClient);
        if (hasChanges) {
          await api.git.applyStash({ cwd, stashRef: "stash@{0}", pop: true });
          await invalidateGitQueries(queryClient);
        }
        closeModal();
        toastManager.add({
          type: "success",
          title: `Pulled from origin/${sourceBranch} and reapplied stash`,
        });
      } catch (error) {
        await invalidateGitQueries(queryClient);
        closeModal();
        toastManager.add({
          type: "error",
          title: "Stash, pull & reapply failed",
          description: toGitUserFacingErrorMessage(error),
        });
      }
    },
    [api, changeCount, closeModal, cwd, queryClient],
  );

  const applyStash = useCallback(
    async (ref: string) => {
      if (!api) return;
      try {
        await api.git.applyStash({ cwd, stashRef: ref, pop: true });
        await invalidateGitQueries(queryClient);
        toastManager.add({ type: "success", title: `Applied ${ref}` });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Apply stash failed",
          description: toGitUserFacingErrorMessage(error),
        });
      }
    },
    [api, cwd, queryClient],
  );

  const dropStash = useCallback(
    async (ref: string) => {
      if (!api) return;
      try {
        await api.git.dropStash({ cwd, stashRef: ref });
        await invalidateGitQueries(queryClient);
        toastManager.add({ type: "success", title: `Dropped ${ref}` });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Drop stash failed",
          description: toGitUserFacingErrorMessage(error),
        });
      }
    },
    [api, cwd, queryClient],
  );

  const runCommitOperation = useCallback(
    async (action: "revert" | "cherry-pick", commit: GitHistoryCommit) => {
      if (!api) return;
      try {
        if (action === "revert") await api.git.revertCommit({ cwd, sha: commit.sha });
        else await api.git.cherryPick({ cwd, sha: commit.sha });
        await invalidateGitQueries(queryClient);
        toastManager.add({
          type: "success",
          title: `${action === "revert" ? "Reverted" : "Cherry-picked"} ${commit.shortSha}`,
        });
      } catch (error) {
        await invalidateGitQueries(queryClient);
        toastManager.add({
          type: "error",
          title: `${action === "revert" ? "Revert" : "Cherry-pick"} failed`,
          description: toGitUserFacingErrorMessage(error),
        });
      }
    },
    [api, cwd, queryClient],
  );

  const performRepositoryAction = useCallback(
    async (operation: GitRepositoryActionInput["operation"], successTitle: string) => {
      if (!api) return;
      try {
        await api.git.performRepositoryAction({ cwd, operation });
        await invalidateGitQueries(queryClient);
        closeModal();
        toastManager.add({ type: "success", title: successTitle });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Git operation failed",
          description: toGitUserFacingErrorMessage(error),
        });
      }
    },
    [api, closeModal, cwd, queryClient],
  );

  const publishRelease = useCallback(
    async (release: { tag: string; title: string; notes: string; prerelease: boolean }) => {
      if (!api) return;
      try {
        await api.git.publishRelease({ cwd, ...release });
        await invalidateGitQueries(queryClient);
        closeModal();
        toastManager.add({ type: "success", title: `Published release ${release.tag}` });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Release creation failed",
          description: toGitUserFacingErrorMessage(error),
        });
      }
    },
    [api, closeModal, cwd, queryClient],
  );

  const createWorktree = useCallback(
    async (input: { base: string; branch: string; path: string }) => {
      if (!api) return;
      try {
        const created = await api.git.createWorktree({
          cwd,
          branch: input.base,
          ...(input.branch !== input.base ? { newBranch: input.branch } : {}),
          path: input.path,
        });
        await invalidateGitQueries(queryClient);
        closeModal();
        toastManager.add({
          type: "success",
          title: `Created worktree for ${created.worktree.branch}`,
          description: created.worktree.path,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Create worktree failed",
          description: toGitUserFacingErrorMessage(error),
        });
      }
    },
    [api, closeModal, cwd, queryClient],
  );

  const switchAccount = useCallback(
    (login: string) => {
      void switchMutation.mutateAsync({ host: "github.com", login });
    },
    [switchMutation],
  );

  const removeAccount = useCallback(
    (login: string) => {
      void logoutMutation.mutateAsync({ host: "github.com", login });
    },
    [logoutMutation],
  );

  const repoName = cwd.split("/").pop() ?? cwd;
  const panelIdPrefix = `git-${useId().replaceAll(":", "")}`;

  const panelContainer = (panelName: string, content: React.ReactNode) => (
    <PanelErrorBoundary panelName={panelName}>
      <div
        id={`${panelIdPrefix}-panel-${panel}`}
        role="tabpanel"
        aria-labelledby={`${panelIdPrefix}-tab-${panel}`}
        tabIndex={0}
      >
        {content}
      </div>
    </PanelErrorBoundary>
  );

  const renderPanel = () => {
    switch (panel) {
      case "overview":
        return panelContainer(
          "Overview",
          <OverviewPanel
            cwd={cwd}
            repoName={repoName}
            statusData={statusData}
            environmentData={environmentData}
            branchList={branchList}
            commits={commits}
            watchedBranchStatuses={watchedBranchStatuses}
            onGoToChanges={() => setPanel("changes")}
            onGoToAccounts={() => setPanel("accounts")}
            onGoToDivergence={() => setPanel("divergence")}
            onOpenSignIn={() => setModal("deviceAuth")}
            onOpenAddRemote={() => setModal("addRemote")}
            onOpenCreateBranch={() => setModal("newWorktree")}
            onOpenCreatePullRequest={() => setModal("createPR")}
            onRunInTerminal={onRunInTerminal}
            onInitRepo={() => void gitInitMutation.mutateAsync()}
          />,
        );
      case "changes":
        return panelContainer(
          "Changes",
          <ChangesPanel
            cwd={cwd}
            statusData={statusData}
            onOpenDiff={() => setPanel("diff")}
            onOpenStash={() => setModal("stash")}
            onOpenDiscardAll={() => setModal("discardAll")}
            onRunInTerminal={onRunInTerminal}
          />,
        );
      case "review":
        return panelContainer("Review", <ReviewPanel cwd={cwd} activePanel={panel} />);
      case "diff":
        return panelContainer(
          "Diff",
          <DiffPage cwd={cwd} statusData={statusData} commits={commits} />,
        );
      case "divergence":
        return panelContainer(
          "Divergence",
          <DivergencePanel
            cwd={cwd}
            watchedBranchStatuses={fullScanResult ?? watchedBranchStatuses}
            isFullScan={Boolean(fullScanResult)}
            isScanning={isFullScanning}
            onScanAllBranches={handleScanAllBranches}
          />,
        );
      case "branches":
        return panelContainer(
          "Branches",
          <BranchesPanel
            cwd={cwd}
            activeBranch={activeBranch}
            allBranches={allBranches}
            aheadCount={aheadCount}
            behindCount={behindCount}
            isDetached={!activeBranch}
            loadingBranches={branchesQuery.isLoading}
            onOpenNewBranch={() => setModal("newWorktree")}
            onOpenNewWorktree={() => setModal("newWorktree")}
            onGoToChanges={() => setPanel("changes")}
          />,
        );
      case "history":
        return panelContainer(
          "History",
          <HistoryPanel
            cwd={cwd}
            commits={commits}
            loadingHistory={historyQuery.isLoading}
            onReset={(c) => setModal({ kind: "reset", commit: c })}
            onRevert={(c) => void runCommitOperation("revert", c)}
            onCherryPick={(c) => void runCommitOperation("cherry-pick", c)}
            onLoadMoreHistory={() => setHistoryLimit((l) => l + 50)}
          />,
        );
      case "prs":
        return panelContainer(
          "PRs",
          <PRsPanel
            cwd={cwd}
            environmentId={environmentId}
            branchName={branchName}
            onOpenCreatePR={() => setModal("createPR")}
          />,
        );
      case "tags":
        return panelContainer(
          "Tags",
          <TagsPanel
            cwd={cwd}
            commits={commits}
            pushAccess={branchesQuery.data?.pushAccess}
            onOpenDraftRelease={() => setModal("draftRelease")}
          />,
        );
      case "stashes":
        return panelContainer(
          "Stashes",
          <StashesPanel
            stashes={stashes}
            hasChanges={changeCount > 0}
            behindCount={behindCount}
            hasConflict={hasConflict}
            onOpenStash={() => setModal("stash")}
            onOpenStashPullReapply={() => setModal("pullSource")}
            onApplyStash={(ref) => void applyStash(ref)}
            onDropStash={(ref) => void dropStash(ref)}
          />,
        );
      case "accounts":
        return panelContainer(
          "Accounts",
          <AccountsPanel
            accounts={accounts}
            activeAccountLogin={activeAccountLogin}
            repoName={repoName}
            credentialMismatch={isCredentialMismatch}
            onOpenConnectAccount={() => setModal("deviceAuth")}
            onSwitchAccount={switchAccount}
            onRemoveAccount={removeAccount}
          />,
        );
      case "settings":
        return panelContainer(
          "Settings",
          <SettingsPanel
            cwd={cwd}
            environmentData={environmentData}
            excludedBranches={excludedWatchedBranches}
            onAddExcludedBranch={addExcludedBranch}
            onRemoveExcludedBranch={removeExcludedBranch}
            onOpenAddRemote={() => setModal("addRemote")}
          />,
        );
    }
  };

  return (
    <GitApiProvider api={api} scopeKey={gitScopeKey}>
      <GitEnvironmentGate
        key={gitScopeKey}
        environment={environmentData ?? undefined}
        isRepo={branchList?.isRepo}
        isLoading={gitEnvironmentQuery.isLoading || branchesQuery.isLoading}
        initPending={gitInitMutation.isPending}
        onInitRepo={() => void gitInitMutation.mutateAsync()}
      >
        <div
          className="git-tool-v2 flex h-full min-h-0 overflow-hidden"
          style={{ backgroundColor: "var(--bg-base)", color: "var(--fg)" }}
        >
          {/* Sidebar (w-64 expanded, w-16 collapsed) */}
          <Sidebar
            repoName={repoName}
            panel={panel}
            setPanel={setPanel}
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            changeCount={changeCount}
            reviewBadgeCount={unreadCount}
            hasConflict={hasConflict}
            idPrefix={panelIdPrefix}
          />

          {/* Main Panel Area */}
          <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
            <TopBar
              repoName={repoName}
              branchLabel={branchName}
              accentDotTone={hasConflict ? "bad" : behindCount > 0 ? "warn" : "ok"}
              accounts={accounts}
              activeAccountLogin={activeAccountLogin}
              terminalOpen={terminalOpen}
              onToggleTerminal={onToggleTerminal}
              onSwitchAccount={switchAccount}
              onOpenAccounts={() => setPanel("accounts")}
              onOpenSignIn={() => setModal("deviceAuth")}
            />
            <div className="flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
              <div className="w-full max-w-[1400px] mx-auto">{renderPanel()}</div>
            </div>
          </div>
        </div>

        {/* Modals */}
        {modal === "stash" && (
          <StashModal onClose={closeModal} onStash={(msg) => void doStash(msg)} />
        )}
        {modal === "discardAll" && (
          <DiscardAllModal
            count={changeCount}
            onClose={closeModal}
            onConfirm={() => void doDiscardAll()}
          />
        )}
        {modal === "forcePush" && (
          <ForcePushModal
            branch={branchName}
            onClose={closeModal}
            onConfirm={() => {
              void performRepositoryAction(
                {
                  action: "push_ref",
                  remote: "origin",
                  ref: branchName,
                  forceWithLease: true,
                },
                `Force-pushed ${branchName}`,
              );
            }}
          />
        )}
        {modal === "createPR" && (
          <CreatePRModal
            currentBranch={branchName}
            branches={allBranches}
            lastSubject={commits[0]?.subject || ""}
            onClose={closeModal}
            onCreate={async (pr) => {
              if (!api) return;
              try {
                await api.git.createPullRequest({
                  cwd,
                  title: pr.title,
                  body: pr.body,
                  headBranch: pr.head,
                  baseBranch: pr.base,
                  draft: pr.draft,
                });
                await invalidateGitQueries(queryClient);
                closeModal();
                toastManager.add({ type: "success", title: "Pull request created" });
              } catch (error) {
                toastManager.add({
                  type: "error",
                  title: "Pull request creation failed",
                  description: toGitUserFacingErrorMessage(error),
                });
              }
            }}
          />
        )}
        {modal === "addRemote" && (
          <AddRemoteModal
            onClose={closeModal}
            onAdd={(r) =>
              void performRepositoryAction(
                { action: "add_remote", name: r.name, url: r.url },
                `Added remote ${r.name}`,
              )
            }
          />
        )}
        {modal === "deviceAuth" && (
          <DeviceAuthModal
            cwd={cwd}
            onRunGitHubLogin={onRunGitHubLogin}
            onClose={closeModal}
            onConfirm={() => {
              closeModal();
            }}
          />
        )}
        {modal === "newWorktree" && (
          <NewWorktreeModal
            branches={allBranches}
            currentBranch={branchName}
            onClose={closeModal}
            onCreate={createWorktree}
          />
        )}
        {modal === "draftRelease" && (
          <DraftReleaseModal
            tags={commits.map((c) => ({ name: c.shortSha }))}
            commits={commits}
            onClose={closeModal}
            onPublish={(release) => void publishRelease(release)}
          />
        )}
        {modal === "pullSource" && (
          <PullSourceModal
            branches={allBranches}
            currentBranch={branchName}
            onClose={closeModal}
            onConfirm={(sourceBranch) => void stashPullReapply(sourceBranch)}
          />
        )}
        {modal !== null && typeof modal === "object" && modal.kind === "reset" && (
          <ResetModal
            commit={modal.commit}
            onClose={closeModal}
            onReset={(mode) =>
              void performRepositoryAction(
                { action: "reset", mode, sha: modal.commit.sha },
                `Reset to ${modal.commit.shortSha}`,
              )
            }
          />
        )}
      </GitEnvironmentGate>
    </GitApiProvider>
  );
}
