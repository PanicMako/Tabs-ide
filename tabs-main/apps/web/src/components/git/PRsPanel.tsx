import {
  ArrowUpDown,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Filter,
  GitCommit,
  FileDiff,
  GitMerge,
  GitPullRequest,
  Layers,
  MessageSquare,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import type {
  EnvironmentId,
  GitPullRequestAction,
  GitPullRequestReviewThread,
  GitPullRequestStackMembership,
  GitPullRequestStackHead,
  GitPullRequestStack,
} from "@tabs/contracts";
import { PullRequestReviewThreadCard } from "./PullRequestReviewThreadCard";
import { PullRequestChecksView, PullRequestChecksRollupBadge } from "./PullRequestChecksSummary";
import {
  PullRequestReviewersSection,
  PullRequestLabelsSection,
  PullRequestActivityView,
} from "./PullRequestMetadataControls";
import { PullRequestEditDialog } from "./PullRequestEditDialog";
import { PullRequestThreadIntegration } from "./PullRequestThreadIntegration";
import { PullRequestStackView } from "./PullRequestStackView";
import { environmentApi } from "../../connection/environmentApiRegistry";
import { newCommandId } from "../../lib/utils";

import {
  gitAllPullRequestsQueryOptions,
  gitResolvePullRequestQueryOptions,
} from "../../lib/gitReactQuery";
import { toGitUserFacingErrorMessage } from "../../lib/gitErrorMessages";
import { GitCheckingState } from "./GitCheckingState";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Switch } from "~/components/ui/switch";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Card, Select } from "./gitPrimitives";
import { useProjectGitState } from "../../state/scopedStateStore";
import { useGitApi, useGitScopeKey } from "./gitApiContext";
import ChatMarkdown from "../ChatMarkdown";
import { parseUnifiedDiff } from "./unifiedDiff";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { threadsAtom } from "../../state/threads";
import { findThreadsForPullRequest } from "@tabs/shared/threadPullRequests";

interface PullRequestRow {
  n: number;
  title: string;
  state: "open" | "draft" | "merged" | "closed";
  branch: string;
  url: string;
  provider?: "github" | "gitlab" | "azure-devops" | "bitbucket" | "unknown";
  isDraft: boolean;
  author: string | null;
  labels: ReadonlyArray<{ name: string; color?: string | undefined }>;
  reviewDecision?: "approved" | "changes_requested" | "review_required";
  mergeability?: "mergeable" | "conflicting" | "unknown";
  checksState?: "passing" | "failing" | "pending";
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  autoMergeEnabled?: boolean;
  autoMergeMethod?: "merge" | "squash" | "rebase";
  stackMembership?: GitPullRequestStackMembership;
  stack?: GitPullRequestStack;
}

const REACTION_OPTIONS = [
  ["THUMBS_UP", "👍"],
  ["THUMBS_DOWN", "👎"],
  ["LAUGH", "😄"],
  ["HOORAY", "🎉"],
  ["CONFUSED", "😕"],
  ["HEART", "❤️"],
  ["ROCKET", "🚀"],
  ["EYES", "👀"],
] as const;

function formatProviderName(provider: PullRequestRow["provider"]): string {
  switch (provider) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "azure-devops":
      return "Azure DevOps";
    case "bitbucket":
      return "Bitbucket";
    default:
      return "provider";
  }
}

function handleTabListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[role='tab']"));
  const currentIndex = tabs.indexOf(document.activeElement as HTMLElement);
  if (currentIndex < 0 || tabs.length === 0) return;
  event.preventDefault();
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}

export function PRsPanel({
  cwd,
  environmentId,
  branchName,
  onOpenCreatePR,
}: {
  cwd: string;
  environmentId?: string | undefined;
  branchName: string;
  onOpenCreatePR: () => void;
}) {
  const api = useGitApi();
  const threads = useAtomValue(threadsAtom);
  const navigate = useNavigate();
  const [gitState, setGitState] = useProjectGitState(useGitScopeKey());
  const viewMode = gitState.prViewMode;
  const setViewMode = useCallback(
    (mode: "branch" | "all") => {
      setGitState({ prViewMode: mode });
    },
    [setGitState],
  );

  const filterState = gitState.prFilter;
  const setFilterState = useCallback(
    (f: "all" | "open" | "merged" | "closed") => {
      setGitState({ prFilter: f });
    },
    [setGitState],
  );

  const [mergePr, setMergePr] = useState<PullRequestRow | null>(null);
  const [editPr, setEditPr] = useState<{
    number: number;
    title: string;
    body: string;
  } | null>(null);
  const [mergeIntent, setMergeIntent] = useState<"merge" | "auto_merge">("merge");
  const [mergeMethod, setMergeMethod] = useState<"squash" | "merge" | "rebase">("squash");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [expandedPrNumber, setExpandedPrNumber] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<
    "summary" | "code" | "checks" | "commits" | "activity"
  >("summary");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [actionBody, setActionBody] = useState("");
  const [reviewerInput, setReviewerInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [inlineLine, setInlineLine] = useState("");
  const [inlineSide, setInlineSide] = useState<"left" | "right">("right");
  const [inlineBody, setInlineBody] = useState("");
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [listLimit, setListLimit] = useState(50);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [fileSortMode, setFileSortMode] = useState<"path" | "additions" | "deletions" | "status">(
    "path",
  );

  // Query 1: Branch PR query
  const branchPrQuery = useQuery(
    gitResolvePullRequestQueryOptions({
      cwd: cwd || null,
      reference: branchName || null,
      environmentId,
    }),
  );

  // Query 2: Repository PRs query (supports state filter for past merged/closed PRs)
  const allPrsQuery = useQuery(
    gitAllPullRequestsQueryOptions(cwd || null, filterState, environmentId, listLimit, searchQuery),
  );
  const detailQuery = useQuery(
    gitResolvePullRequestQueryOptions({
      cwd: cwd || null,
      reference: expandedPrNumber === null ? null : String(expandedPrNumber),
      environmentId,
    }),
  );

  const handleFixInThread = useCallback(
    (thread: GitPullRequestReviewThread) => {
      const firstComment = thread.comments[0]?.body ?? "";
      const prompt = `Please fix the issue identified in this pull request review comment on ${thread.path} line ${thread.line}:\n\n> ${firstComment}`;
      void navigator.clipboard?.writeText(prompt);
      const pr = detailQuery.data?.pullRequest;
      if (pr) {
        const linked = findThreadsForPullRequest(threads, {
          number: pr.number,
          url: pr.url,
        });
        const target = linked[0];
        if (target) {
          if (target.environmentId) {
            void navigate({
              to: "/$environmentId/$threadId",
              params: {
                environmentId: target.environmentId,
                threadId: target.id,
              },
            });
            return;
          } else {
            void navigate({
              to: "/$threadId",
              params: { threadId: target.id },
            });
            return;
          }
        }
      }
      void navigate({ to: "/" });
    },
    [detailQuery.data?.pullRequest, threads, navigate],
  );

  const activeQuery = viewMode === "branch" ? branchPrQuery : allPrsQuery;
  const capabilities = activeQuery.data?.capabilities;
  const supportsAction = useCallback(
    (action: GitPullRequestAction) =>
      capabilities ? capabilities.actions.includes(action) : action !== "request_changes",
    [capabilities],
  );
  const loading = activeQuery.isLoading;

  const prs = useMemo<PullRequestRow[]>(() => {
    if (viewMode === "branch") {
      const pr = branchPrQuery.data?.pullRequest;
      if (!pr) return [];
      return [
        {
          n: pr.number,
          title: pr.title,
          state: (pr.state as "open" | "draft" | "merged" | "closed") || "open",
          branch: `${pr.headBranch ?? branchName} → ${pr.baseBranch ?? "main"}`,
          url: pr.url,
          ...(pr.provider ? { provider: pr.provider } : {}),
          isDraft: pr.isDraft ?? false,
          author: pr.author?.login ?? null,
          labels: pr.labels ?? [],
          ...(pr.reviewDecision ? { reviewDecision: pr.reviewDecision } : {}),
          ...(pr.mergeability ? { mergeability: pr.mergeability } : {}),
          ...(pr.checksState ? { checksState: pr.checksState } : {}),
          ...(pr.additions !== undefined ? { additions: pr.additions } : {}),
          ...(pr.deletions !== undefined ? { deletions: pr.deletions } : {}),
          ...(pr.changedFiles !== undefined ? { changedFiles: pr.changedFiles } : {}),
          ...(pr.autoMergeEnabled !== undefined ? { autoMergeEnabled: pr.autoMergeEnabled } : {}),
          ...(pr.autoMergeMethod ? { autoMergeMethod: pr.autoMergeMethod } : {}),
          ...(pr.stackMembership ? { stackMembership: pr.stackMembership } : {}),
          ...(pr.stack ? { stack: pr.stack } : {}),
        },
      ];
    } else {
      const list = allPrsQuery.data?.pullRequests || [];
      const mapped = list.map((pr) => ({
        n: pr.number,
        title: pr.title,
        state: (pr.state as "open" | "draft" | "merged" | "closed") || "open",
        branch: `${pr.headBranch} → ${pr.baseBranch}`,
        url: pr.url,
        ...(pr.provider ? { provider: pr.provider } : {}),
        isDraft: pr.isDraft ?? false,
        author: pr.author?.login ?? null,
        labels: pr.labels ?? [],
        ...(pr.reviewDecision ? { reviewDecision: pr.reviewDecision } : {}),
        ...(pr.mergeability ? { mergeability: pr.mergeability } : {}),
        ...(pr.checksState ? { checksState: pr.checksState } : {}),
        ...(pr.additions !== undefined ? { additions: pr.additions } : {}),
        ...(pr.deletions !== undefined ? { deletions: pr.deletions } : {}),
        ...(pr.changedFiles !== undefined ? { changedFiles: pr.changedFiles } : {}),
        ...(pr.autoMergeEnabled !== undefined ? { autoMergeEnabled: pr.autoMergeEnabled } : {}),
        ...(pr.autoMergeMethod ? { autoMergeMethod: pr.autoMergeMethod } : {}),
        ...(pr.stackMembership ? { stackMembership: pr.stackMembership } : {}),
        ...(pr.stack ? { stack: pr.stack } : {}),
      }));
      if (!searchQuery.trim()) return mapped;
      const q = searchQuery.trim().toLowerCase();
      return mapped.filter((pr) => {
        if (
          pr.title.toLowerCase().includes(q) ||
          pr.branch.toLowerCase().includes(q) ||
          String(pr.n).includes(q) ||
          `#${pr.n}`.includes(q)
        ) {
          return true;
        }
        const prThreads = findThreadsForPullRequest(threads, { number: pr.n, url: pr.url });
        return prThreads.some(
          (t) => t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q),
        );
      });
    }
  }, [viewMode, branchPrQuery.data, allPrsQuery.data, branchName, searchQuery, threads]);

  const mutatePullRequest = async (
    reference: number,
    action: GitPullRequestAction,
    body?: string,
    value?: string,
    inline?: {
      path?: string;
      line?: number;
      side?: "left" | "right";
      threadId?: string;
      subjectId?: string;
      reaction?: (typeof REACTION_OPTIONS)[number][0];
    },
    title?: string,
    stackParams?: {
      stackNumber?: number | undefined;
      expectedStackHeads?: ReadonlyArray<GitPullRequestStackHead> | undefined;
      mergeMethod?: "merge" | "squash" | "rebase" | undefined;
    },
  ) => {
    if (!api) return false;
    setPendingAction(action);
    try {
      await api.git.mutatePullRequest({
        cwd,
        reference: String(reference),
        action,
        ...(action === "merge" || action === "enable_auto_merge"
          ? { mergeMethod, ...(action === "merge" ? { deleteBranch } : {}) }
          : {}),
        ...(action === "stack_merge"
          ? {
              stackNumber: stackParams?.stackNumber,
              expectedStackHeads: stackParams?.expectedStackHeads,
              mergeMethod: stackParams?.mergeMethod ?? mergeMethod,
            }
          : {}),
        ...(action === "stack_rebase"
          ? {
              stackNumber: stackParams?.stackNumber,
              expectedStackHeads: stackParams?.expectedStackHeads,
            }
          : {}),
        ...(body !== undefined ? { body } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(value !== undefined ? { value } : {}),
        ...(inline?.path ? { path: inline.path } : {}),
        ...(inline?.line ? { line: inline.line } : {}),
        ...(inline?.side ? { side: inline.side } : {}),
        ...(inline?.threadId ? { threadId: inline.threadId } : {}),
        ...(inline?.subjectId ? { subjectId: inline.subjectId } : {}),
        ...(inline?.reaction ? { reaction: inline.reaction } : {}),
      });
      await Promise.all([branchPrQuery.refetch(), allPrsQuery.refetch(), detailQuery.refetch()]);
      toastManager.add({
        type: "success",
        title:
          action === "request_changes"
            ? "Changes requested"
            : `Pull request ${action.replaceAll("_", " ")} succeeded`,
      });
      return true;
    } catch (error) {
      toastManager.add({
        type: "error",
        title: `Pull request ${action.replaceAll("_", " ")} failed`,
        description: toGitUserFacingErrorMessage(error),
      });
      return false;
    } finally {
      setPendingAction(null);
    }
  };

  const handleConfirmMerge = async () => {
    if (!mergePr) return;
    const action = mergeIntent === "auto_merge" ? "enable_auto_merge" : "merge";
    if (await mutatePullRequest(mergePr.n, action)) setMergePr(null);
  };

  return (
    <div className="space-y-3">
      {/* Top Controls Toolbar: Segmented View Selector, State Filters & Create PR Button */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card/60 p-3 rounded-xl border border-border/60">
        {/* Segmented Scope Control */}
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="tabs-segmented grid grid-cols-2 text-xs shrink-0 sm:w-auto"
            role="group"
            aria-label="Pull request scope"
          >
            <button
              type="button"
              aria-pressed={viewMode === "branch"}
              onClick={() => setViewMode("branch")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                viewMode === "branch"
                  ? "font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              This branch ({branchName})
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "all"}
              onClick={() => setViewMode("all")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                viewMode === "all" ? "font-semibold" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All repository PRs
            </button>
          </div>

          {/* State Filter Buttons (Active when viewing Repository PRs) */}
          {viewMode === "all" && (
            <div
              className="tabs-segmented flex items-center text-[11px]"
              role="group"
              aria-label="Pull request state"
            >
              {(["all", "open", "merged", "closed"] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  aria-pressed={filterState === st}
                  onClick={() => setFilterState(st)}
                  className={`px-2.5 py-1 rounded-md capitalize font-medium transition-colors ${
                    filterState === st
                      ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {st === "all" ? "All history" : st}
                </button>
              ))}
            </div>
          )}
          {viewMode === "all" && capabilities?.search ? (
            <form
              role="search"
              aria-label="Search pull requests"
              className="flex min-w-56 items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                setListLimit(50);
                setSearchQuery(searchInput.trim());
              }}
            >
              <label htmlFor="git-pr-search" className="sr-only">
                Search pull requests
              </label>
              <input
                id="git-pr-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search pull requests"
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              />
              <Button type="submit" size="sm">
                Search
              </Button>
              {searchQuery ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSearchInput("");
                    setSearchQuery("");
                  }}
                >
                  Clear
                </Button>
              ) : null}
            </form>
          ) : null}
        </div>

        {/* Action Button */}
        {capabilities?.create !== false ? (
          <Button size="sm" onClick={onOpenCreatePR} className="gap-1.5 shrink-0 ml-auto">
            <Plus size={13} />
            <span>Create pull request</span>
          </Button>
        ) : null}
      </div>

      {activeQuery.isError ? (
        <div role="alert">
          <Card className="border-destructive/40 bg-destructive/5 p-6 text-center">
            <GitPullRequest className="mx-auto mb-2 text-destructive" size={28} />
            <p className="text-sm font-medium text-foreground">Unable to load pull requests</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              {activeQuery.error instanceof Error
                ? activeQuery.error.message
                : "The pull-request provider returned an unknown error."}
            </p>
            <Button
              className="mt-4"
              size="sm"
              variant="outline"
              onClick={() => activeQuery.refetch()}
            >
              Retry
            </Button>
          </Card>
        </div>
      ) : loading ? (
        <GitCheckingState
          message={
            viewMode === "branch"
              ? `Loading pull request for ${branchName}…`
              : `Loading repository pull requests (${filterState})…`
          }
          size={36}
        />
      ) : prs.length === 0 ? (
        <Card className="p-8 text-center bg-card/40 border-dashed">
          <GitPullRequest className="mx-auto mb-2 text-muted-foreground/70" size={28} />
          <p className="text-sm font-medium text-foreground mb-1">
            {viewMode === "branch"
              ? `No pull requests for ${branchName}`
              : `No ${filterState === "all" ? "" : filterState + " "}pull requests in this repository`}
          </p>
          <p className="text-xs text-muted-foreground/70 mb-4 max-w-sm mx-auto">
            {viewMode === "branch"
              ? "Push your branch and open a pull request to request feedback and merge changes."
              : `There are currently no matching ${filterState === "all" ? "" : filterState + " "}pull requests in this repository.`}
          </p>
          <Button size="sm" onClick={onOpenCreatePR}>
            Create pull request
          </Button>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {prs.map((pr) => (
            <Card key={pr.n} className="p-3.5 hover:bg-muted/20 transition-colors">
              <div className="flex items-center gap-3">
                <Badge
                  variant={
                    pr.state === "open"
                      ? "success"
                      : pr.state === "merged"
                        ? "secondary"
                        : pr.state === "closed"
                          ? "destructive"
                          : "outline"
                  }
                >
                  #{pr.n} {pr.state}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground/90 truncate">
                    {pr.title}{" "}
                    {pr.isDraft ? <span className="text-muted-foreground">(draft)</span> : null}
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground/70 truncate">
                    {pr.branch}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    {pr.author ? <span>by @{pr.author}</span> : null}
                    {pr.checksState ? (
                      <Badge
                        variant={
                          pr.checksState === "passing"
                            ? "success"
                            : pr.checksState === "failing"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        Checks {pr.checksState}
                      </Badge>
                    ) : null}
                    {pr.reviewDecision ? (
                      <Badge variant="outline">{pr.reviewDecision.replaceAll("_", " ")}</Badge>
                    ) : null}
                    {pr.stackMembership ? (
                      <Badge
                        variant="outline"
                        className="gap-1 text-[11px] font-normal cursor-pointer hover:bg-muted/60"
                        title={`Stack #${pr.stackMembership.number} · Layer ${pr.stackMembership.position} of ${pr.stackMembership.size}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedPrNumber(pr.n);
                          setDetailTab("summary");
                        }}
                      >
                        <Layers className="size-3 text-primary" aria-hidden="true" />
                        {pr.stackMembership.position}/{pr.stackMembership.size}
                      </Badge>
                    ) : null}
                    {pr.mergeability === "conflicting" ? (
                      <Badge variant="destructive">Conflicts</Badge>
                    ) : null}
                    {pr.changedFiles !== undefined ? <span>{pr.changedFiles} files</span> : null}
                    {pr.additions !== undefined ? (
                      <span className="text-diff-addition font-medium">+{pr.additions}</span>
                    ) : null}
                    {pr.deletions !== undefined ? (
                      <span className="text-diff-deletion font-medium">−{pr.deletions}</span>
                    ) : null}
                    {pr.labels.slice(0, 3).map((label) => (
                      <Badge key={label.name} variant="secondary">
                        {label.name}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(() => {
                    const linkedThreads = findThreadsForPullRequest(threads, {
                      number: pr.n,
                      url: pr.url,
                    }).filter((t) => !environmentId || t.environmentId === environmentId);
                    if (linkedThreads.length === 0) return null;
                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs text-primary border-primary/30 bg-primary/5 hover:bg-primary/10 h-7 px-2 shrink-0"
                        title={
                          linkedThreads.length === 1
                            ? `Open linked agent thread: ${linkedThreads[0]!.title}`
                            : `${linkedThreads.length} linked agent threads`
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          const target = linkedThreads[0]!;
                          if (target.environmentId) {
                            void navigate({
                              to: "/$environmentId/$threadId",
                              params: {
                                environmentId: target.environmentId,
                                threadId: target.id,
                              },
                            });
                          } else {
                            void navigate({
                              to: "/$threadId",
                              params: { threadId: target.id },
                            });
                          }
                        }}
                      >
                        <Bot className="size-3.5 shrink-0" />
                        <span className="truncate max-w-32">
                          {linkedThreads.length === 1
                            ? linkedThreads[0]!.title
                            : `${linkedThreads.length} threads`}
                        </span>
                      </Button>
                    );
                  })()}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={expandedPrNumber === pr.n}
                    onClick={() => {
                      setExpandedPrNumber((current) => (current === pr.n ? null : pr.n));
                      setDetailTab("summary");
                      setSelectedFilePath(null);
                    }}
                  >
                    {expandedPrNumber === pr.n ? <ChevronDown /> : <ChevronRight />}
                    Details
                  </Button>
                  {pr.state === "open" && !pr.isDraft && supportsAction("merge") && (
                    <Button
                      size="sm"
                      disabled={pr.mergeability === "conflicting" || pr.checksState === "failing"}
                      title={
                        pr.mergeability === "conflicting"
                          ? "Resolve merge conflicts before merging"
                          : pr.checksState === "failing"
                            ? "Fix failing checks before merging"
                            : undefined
                      }
                      onClick={() => {
                        setMergeIntent("merge");
                        const methods = capabilities?.mergeMethods ?? ["squash", "merge", "rebase"];
                        if (!methods.includes(mergeMethod)) {
                          setMergeMethod(methods[0] ?? "squash");
                        }
                        setMergePr(pr);
                      }}
                    >
                      <GitMerge /> Merge…
                    </Button>
                  )}
                  {pr.state === "open" && supportsAction("enable_auto_merge") ? (
                    pr.autoMergeEnabled && supportsAction("disable_auto_merge") ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pendingAction !== null}
                        onClick={() => void mutatePullRequest(pr.n, "disable_auto_merge")}
                      >
                        Disable auto-merge
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pendingAction !== null}
                        onClick={() => {
                          setMergeIntent("auto_merge");
                          const methods = capabilities?.mergeMethods ?? ["squash", "merge"];
                          if (!methods.includes(mergeMethod)) setMergeMethod(methods[0] ?? "merge");
                          setMergePr(pr);
                        }}
                      >
                        Enable auto-merge…
                      </Button>
                    )
                  ) : null}
                  {pr.state === "open" && supportsAction("close") ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pendingAction !== null}
                      onClick={() => void mutatePullRequest(pr.n, "close")}
                    >
                      Close
                    </Button>
                  ) : pr.state === "closed" && supportsAction("reopen") ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pendingAction !== null}
                      onClick={() => void mutatePullRequest(pr.n, "reopen")}
                    >
                      Reopen
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void api?.shell.openExternal(pr.url).catch((error) => {
                        toastManager.add({
                          type: "error",
                          title: "Unable to open pull request",
                          description: toGitUserFacingErrorMessage(error),
                        });
                      });
                    }}
                  >
                    Open
                    {pr.provider ? ` on ${formatProviderName(pr.provider)}` : " pull request"}
                  </Button>
                </div>
              </div>
              {expandedPrNumber === pr.n ? (
                <div className="mt-3 border-t border-border/60 pt-3">
                  {detailQuery.isLoading ? (
                    <GitCheckingState message={`Loading pull request #${pr.n}…`} size={24} />
                  ) : detailQuery.isError ? (
                    <div role="alert" className="rounded-lg border border-destructive/40 p-3">
                      <p className="text-xs text-destructive">
                        {detailQuery.error instanceof Error
                          ? detailQuery.error.message
                          : "Unable to load pull-request details."}
                      </p>
                      <Button
                        className="mt-2"
                        variant="outline"
                        size="sm"
                        onClick={() => detailQuery.refetch()}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : detailQuery.data?.pullRequest ? (
                    <div className="space-y-3">
                      <div
                        role="tablist"
                        aria-label={`Pull request #${pr.n} details`}
                        onKeyDown={handleTabListKeyDown}
                        className="tabs-segmented flex flex-wrap"
                      >
                        {(
                          [
                            ["summary", "Summary", GitPullRequest],
                            ["code", "Code", FileDiff],
                            ["checks", "Checks", CheckCircle2],
                            ["commits", "Commits", GitCommit],
                            ["activity", "Activity", MessageSquare],
                          ] as const
                        )
                          .filter(
                            ([id]) =>
                              id !== "code" || detailQuery.data?.capabilities?.diff !== false,
                          )
                          .map(([id, label, Icon]) => (
                            <Button
                              key={id}
                              id={`pr-${pr.n}-${id}-tab`}
                              role="tab"
                              aria-controls={`pr-${pr.n}-detail-panel`}
                              aria-selected={detailTab === id}
                              tabIndex={detailTab === id ? 0 : -1}
                              variant={detailTab === id ? "secondary" : "ghost"}
                              size="sm"
                              onClick={() => setDetailTab(id)}
                            >
                              <Icon /> {label}
                            </Button>
                          ))}
                      </div>
                      <div
                        id={`pr-${pr.n}-detail-panel`}
                        role="tabpanel"
                        aria-labelledby={`pr-${pr.n}-${detailTab}-tab`}
                        tabIndex={0}
                        className="rounded-lg bg-muted/20 p-3 text-xs"
                      >
                        {detailTab === "summary" ? (
                          <div className="space-y-3">
                            {detailQuery.data.pullRequest.stack && (
                              <PullRequestStackView
                                stack={detailQuery.data.pullRequest.stack}
                                currentNumber={detailQuery.data.pullRequest.number}
                                cwd={cwd}
                                canMerge={supportsAction("stack_merge")}
                                canRebase={supportsAction("stack_rebase")}
                                mergeMethod={mergeMethod}
                                onSelectPullRequest={(prNumber) => {
                                  setExpandedPrNumber(prNumber);
                                  setDetailTab("summary");
                                  setSelectedFilePath(null);
                                }}
                                onMutatePullRequest={async (prNumber, action, params) => {
                                  return await mutatePullRequest(
                                    prNumber,
                                    action,
                                    undefined,
                                    undefined,
                                    undefined,
                                    undefined,
                                    {
                                      stackNumber: params.stackNumber,
                                      expectedStackHeads: params.expectedStackHeads,
                                      mergeMethod: params.mergeMethod,
                                    },
                                  );
                                }}
                              />
                            )}
                            {detailQuery.data.pullRequest.state === "open" &&
                            supportsAction(
                              detailQuery.data.pullRequest.isDraft ? "ready" : "draft",
                            ) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pendingAction !== null}
                                onClick={() =>
                                  void mutatePullRequest(
                                    pr.n,
                                    detailQuery.data.pullRequest.isDraft ? "ready" : "draft",
                                  )
                                }
                              >
                                {detailQuery.data.pullRequest.isDraft
                                  ? "Mark ready for review"
                                  : "Convert to draft"}
                              </Button>
                            ) : null}
                            {supportsAction("edit_pull_request") ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pendingAction !== null}
                                onClick={() =>
                                  setEditPr({
                                    number: pr.n,
                                    title: detailQuery.data.pullRequest.title,
                                    body: detailQuery.data.pullRequest.body ?? "",
                                  })
                                }
                              >
                                <Pencil /> Edit title and description
                              </Button>
                            ) : null}
                            <PullRequestThreadIntegration
                              pr={{
                                number: pr.n,
                                title: detailQuery.data.pullRequest.title,
                                url: detailQuery.data.pullRequest.url || pr.url,
                                provider: pr.provider,
                              }}
                              reviewThreads={detailQuery.data.pullRequest.reviewThreads ?? []}
                              threads={threads}
                              environmentId={environmentId}
                              onOpenThread={(target) => {
                                if (target.environmentId) {
                                  void navigate({
                                    to: "/$environmentId/$threadId",
                                    params: {
                                      environmentId: target.environmentId,
                                      threadId: target.id,
                                    },
                                  });
                                } else {
                                  void navigate({
                                    to: "/$threadId",
                                    params: { threadId: target.id },
                                  });
                                }
                              }}
                              onLinkThread={async (targetThreadId, targetEnvId) => {
                                const envId = (targetEnvId ?? environmentId) as EnvironmentId;
                                const api = await environmentApi(envId);
                                let parsedHost = "github.com";
                                let repository = "";
                                try {
                                  const parsed = new URL(
                                    detailQuery.data.pullRequest.url || pr.url,
                                  );
                                  parsedHost = parsed.hostname;
                                  repository =
                                    parsed.pathname.replace(/^\//, "").split("/pull/")[0] ?? "";
                                } catch {}
                                await api.orchestration.dispatchCommand({
                                  type: "thread.pull-request.link",
                                  commandId: newCommandId(),
                                  threadId: targetThreadId,
                                  host: parsedHost,
                                  repository,
                                  number: pr.n,
                                  url: detailQuery.data.pullRequest.url || pr.url,
                                  source: "manual",
                                });
                                toastManager.add({
                                  type: "success",
                                  title: `Linked thread to PR #${pr.n}`,
                                });
                              }}
                              onUnlinkThread={async (targetThreadId, targetEnvId) => {
                                const envId = (targetEnvId ?? environmentId) as EnvironmentId;
                                const api = await environmentApi(envId);
                                let parsedHost = "github.com";
                                let repository = "";
                                try {
                                  const parsed = new URL(
                                    detailQuery.data.pullRequest.url || pr.url,
                                  );
                                  parsedHost = parsed.hostname;
                                  repository =
                                    parsed.pathname.replace(/^\//, "").split("/pull/")[0] ?? "";
                                } catch {}
                                await api.orchestration.dispatchCommand({
                                  type: "thread.pull-request.unlink",
                                  commandId: newCommandId(),
                                  threadId: targetThreadId,
                                  host: parsedHost,
                                  repository,
                                  number: pr.n,
                                });
                                toastManager.add({
                                  type: "success",
                                  title: `Unlinked thread from PR #${pr.n}`,
                                });
                              }}
                              onCreateFixThread={(prompt) => {
                                void navigator.clipboard?.writeText(prompt);
                                toastManager.add({
                                  type: "success",
                                  title: "Review remarks copied to clipboard",
                                  description:
                                    "Prompt copied to clipboard. Ready to create a new thread or paste into an existing thread.",
                                });
                                void navigate({ to: "/" });
                              }}
                            />
                            {detailQuery.data.pullRequest.body ? (
                              <ChatMarkdown text={detailQuery.data.pullRequest.body} cwd={cwd} />
                            ) : (
                              <p className="text-muted-foreground">No description provided.</p>
                            )}
                            <PullRequestReviewersSection
                              reviewers={detailQuery.data.pullRequest.reviewers ?? []}
                              reviews={detailQuery.data.pullRequest.reviews ?? []}
                              supportsAction={supportsAction}
                              onAddReviewer={(login) =>
                                mutatePullRequest(pr.n, "add_reviewer", undefined, login)
                              }
                              onRemoveReviewer={(idOrLogin) =>
                                mutatePullRequest(pr.n, "remove_reviewer", undefined, idOrLogin)
                              }
                              isPending={pendingAction !== null}
                              isOpen={detailQuery.data.pullRequest.state === "open"}
                            />
                            <PullRequestLabelsSection
                              labels={detailQuery.data.pullRequest.labels ?? []}
                              supportsAction={supportsAction}
                              onAddLabel={(name) =>
                                mutatePullRequest(pr.n, "add_label", undefined, name)
                              }
                              onRemoveLabel={(name) =>
                                mutatePullRequest(pr.n, "remove_label", undefined, name)
                              }
                              isPending={pendingAction !== null}
                              isOpen={detailQuery.data.pullRequest.state === "open"}
                            />
                          </div>
                        ) : detailTab === "code" ? (
                          (() => {
                            const allFiles = detailQuery.data.pullRequest.files ?? [];
                            const reviewThreads = detailQuery.data.pullRequest.reviewThreads ?? [];

                            // Filter and sort changed files
                            const filteredAndSortedFiles = (() => {
                              let result = allFiles;
                              if (fileSearchQuery.trim()) {
                                const q = fileSearchQuery.toLowerCase();
                                result = result.filter((f) => f.path.toLowerCase().includes(q));
                              }
                              return [...result].sort((a, b) => {
                                if (fileSortMode === "additions")
                                  return (b.additions ?? 0) - (a.additions ?? 0);
                                if (fileSortMode === "deletions")
                                  return (b.deletions ?? 0) - (a.deletions ?? 0);
                                if (fileSortMode === "status")
                                  return a.status.localeCompare(b.status);
                                return a.path.localeCompare(b.path);
                              });
                            })();

                            const selectedFile =
                              filteredAndSortedFiles.find(
                                (file) => file.path === selectedFilePath,
                              ) ??
                              allFiles.find((file) => file.path === selectedFilePath) ??
                              filteredAndSortedFiles[0] ??
                              allFiles[0];

                            const selectedThreads = reviewThreads.filter(
                              (thread) => thread.path === selectedFile?.path,
                            );

                            const patchLines = selectedFile?.patch
                              ? parseUnifiedDiff(selectedFile.patch)
                              : [];

                            if (!selectedFile) {
                              return (
                                <p className="text-muted-foreground">
                                  This provider did not report any changed files.
                                </p>
                              );
                            }

                            // Keep track of which thread IDs were rendered against specific diff lines
                            const renderedThreadIds = new Set<string>();

                            return (
                              <div className="grid min-h-72 gap-3 md:grid-cols-[minmax(13rem,0.32fr)_minmax(0,1fr)]">
                                {/* Changed Files Sidebar with Search & Sort */}
                                <div
                                  className="flex max-h-[32rem] flex-col overflow-hidden rounded-md border border-border/70 bg-background"
                                  aria-label="Changed files"
                                >
                                  {/* Filter & Sort Bar */}
                                  <div className="border-b border-border/60 bg-muted/20 p-2 space-y-1.5">
                                    <div className="relative">
                                      <Search className="pointer-events-none absolute left-2 top-2 size-3 text-muted-foreground z-10" />
                                      <input
                                        type="text"
                                        value={fileSearchQuery}
                                        onChange={(e) => setFileSearchQuery(e.target.value)}
                                        placeholder="Filter files…"
                                        aria-label="Filter changed files"
                                        className="h-7 w-full rounded border border-border/70 bg-background pl-7 pr-2 text-[11px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                      />
                                    </div>
                                    <div className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                                      <div className="flex items-center gap-1">
                                        <ArrowUpDown className="size-3" />
                                        <span>Sort:</span>
                                      </div>
                                      <Select
                                        value={fileSortMode}
                                        onChange={(e) => setFileSortMode(e.target.value as any)}
                                        className="h-6 rounded border-border/60 bg-background px-2 text-[10px]"
                                      >
                                        <option value="path">Path (A-Z)</option>
                                        <option value="additions">Most additions</option>
                                        <option value="deletions">Most deletions</option>
                                        <option value="status">Status</option>
                                      </Select>
                                    </div>
                                  </div>

                                  {/* Files List */}
                                  <div className="flex-1 overflow-auto">
                                    {filteredAndSortedFiles.length === 0 ? (
                                      <p className="p-3 text-center text-[11px] text-muted-foreground">
                                        No files match &quot;{fileSearchQuery}&quot;
                                      </p>
                                    ) : (
                                      filteredAndSortedFiles.map((file) => {
                                        const fileThreads = reviewThreads.filter(
                                          (t) => t.path === file.path,
                                        );
                                        const unresolvedThreads = fileThreads.filter(
                                          (t) => !t.resolved,
                                        );
                                        const isSelected = selectedFile.path === file.path;

                                        return (
                                          <button
                                            key={file.path}
                                            type="button"
                                            aria-current={isSelected ? "true" : undefined}
                                            className={`flex w-full items-start justify-between gap-2 border-b border-border/40 px-2.5 py-2 text-left last:border-b-0 transition-colors ${
                                              isSelected
                                                ? "bg-accent text-accent-foreground font-medium"
                                                : "hover:bg-muted/40 text-foreground"
                                            }`}
                                            onClick={() => {
                                              setSelectedFilePath(file.path);
                                              setInlineLine("");
                                            }}
                                          >
                                            <div className="min-w-0 flex-1">
                                              <p className="break-all font-mono text-[11px] leading-tight">
                                                {file.path}
                                              </p>
                                              <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                                                <Badge
                                                  variant="outline"
                                                  className="px-1 py-0 text-[9px] font-normal"
                                                >
                                                  {file.status}
                                                </Badge>
                                                {fileThreads.length > 0 ? (
                                                  <span
                                                    className={`flex items-center gap-0.5 rounded px-1 text-[9px] font-medium ${
                                                      unresolvedThreads.length > 0
                                                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                                        : "bg-muted text-muted-foreground"
                                                    }`}
                                                    title={`${fileThreads.length} discussion${fileThreads.length === 1 ? "" : "s"} (${unresolvedThreads.length} unresolved)`}
                                                  >
                                                    <MessageSquare className="size-2.5" />
                                                    {fileThreads.length}
                                                  </span>
                                                ) : null}
                                              </div>
                                            </div>
                                            <span className="shrink-0 text-[10px]">
                                              <span className="text-diff-addition font-medium">
                                                +{file.additions}
                                              </span>{" "}
                                              <span className="text-diff-deletion font-medium">
                                                −{file.deletions}
                                              </span>
                                            </span>
                                          </button>
                                        );
                                      })
                                    )}
                                  </div>
                                </div>

                                {/* Diff and In-place Annotations View */}
                                <div className="min-w-0 overflow-hidden rounded-md border border-border/70 bg-background">
                                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="break-all font-mono text-[11px] font-semibold">
                                        {selectedFile.path}
                                      </span>
                                      <Badge variant="outline">{selectedFile.status}</Badge>
                                    </div>
                                    <span className="text-[11px] text-muted-foreground">
                                      <span className="text-diff-addition font-medium">
                                        +{selectedFile.additions}
                                      </span>{" "}
                                      <span className="text-diff-deletion font-medium">
                                        −{selectedFile.deletions}
                                      </span>
                                    </span>
                                  </div>

                                  {selectedFile.patch === null ? (
                                    <p className="p-4 text-muted-foreground">
                                      No textual patch is available. The file may be binary or the
                                      provider may have omitted a very large patch.
                                    </p>
                                  ) : (
                                    <div
                                      tabIndex={0}
                                      aria-label={`Patch for ${selectedFile.path}`}
                                      className="max-h-[32rem] overflow-auto font-mono text-[11px] leading-5"
                                    >
                                      {patchLines.map((line) => {
                                        const isInlineCommentOpen =
                                          inlineLine &&
                                          ((inlineSide === "right" &&
                                            line.newLine &&
                                            String(line.newLine) === inlineLine) ||
                                            (inlineSide === "left" &&
                                              line.oldLine &&
                                              String(line.oldLine) === inlineLine));

                                        // Find threads that attach directly to this line
                                        const lineThreads = selectedThreads.filter((t) => {
                                          if (
                                            t.side === "right" &&
                                            line.newLine &&
                                            t.line === line.newLine
                                          ) {
                                            renderedThreadIds.add(t.id);
                                            return true;
                                          }
                                          if (
                                            t.side === "left" &&
                                            line.oldLine &&
                                            t.line === line.oldLine
                                          ) {
                                            renderedThreadIds.add(t.id);
                                            return true;
                                          }
                                          return false;
                                        });

                                        return (
                                          <div
                                            key={line.key}
                                            className="border-b border-border/20 last:border-b-0"
                                          >
                                            {/* Code line row */}
                                            <div
                                              className={`grid grid-cols-[2.5rem_2.5rem_minmax(max-content,1fr)] whitespace-pre ${
                                                line.kind === "addition"
                                                  ? "bg-diff-addition-line"
                                                  : line.kind === "deletion"
                                                    ? "bg-diff-deletion-line"
                                                    : line.kind === "header"
                                                      ? "bg-blue-500/10 text-blue-700 dark:text-blue-300 font-bold"
                                                      : ""
                                              }`}
                                            >
                                              {(["left", "right"] as const).map((side) => {
                                                const lineNumber =
                                                  side === "left" ? line.oldLine : line.newLine;
                                                return lineNumber &&
                                                  supportsAction("inline_comment") ? (
                                                  <button
                                                    key={side}
                                                    type="button"
                                                    className="border-r border-border/40 px-1 text-right text-muted-foreground hover:bg-primary/20 hover:text-primary focus-visible:z-10 cursor-pointer"
                                                    aria-label={`Comment on ${side === "left" ? "original" : "new"} line ${lineNumber}`}
                                                    title={`Click to comment on line ${lineNumber}`}
                                                    onClick={() => {
                                                      if (
                                                        inlineLine === String(lineNumber) &&
                                                        inlineSide === side
                                                      ) {
                                                        setInlineLine("");
                                                        setInlineBody("");
                                                      } else {
                                                        setInlineSide(side);
                                                        setInlineLine(String(lineNumber));
                                                      }
                                                    }}
                                                  >
                                                    {lineNumber}
                                                  </button>
                                                ) : (
                                                  <span
                                                    key={side}
                                                    aria-hidden="true"
                                                    className="border-r border-border/40 px-1 text-right text-muted-foreground select-none"
                                                  >
                                                    {lineNumber ?? ""}
                                                  </span>
                                                );
                                              })}
                                              <span className="px-2">{line.text || " "}</span>
                                            </div>

                                            {/* In-place Comment Composer below clicked line */}
                                            {isInlineCommentOpen ? (
                                              <div className="border-y border-primary/30 bg-primary/5 p-2.5">
                                                <form
                                                  className="space-y-2"
                                                  onSubmit={(e) => {
                                                    e.preventDefault();
                                                    const lineNum = Number(inlineLine);
                                                    if (
                                                      !Number.isSafeInteger(lineNum) ||
                                                      lineNum <= 0 ||
                                                      !inlineBody.trim()
                                                    )
                                                      return;
                                                    void mutatePullRequest(
                                                      pr.n,
                                                      "inline_comment",
                                                      inlineBody.trim(),
                                                      undefined,
                                                      {
                                                        path: selectedFile.path,
                                                        line: lineNum,
                                                        side: inlineSide,
                                                      },
                                                    ).then((ok) => {
                                                      if (ok) {
                                                        setInlineBody("");
                                                        setInlineLine("");
                                                      }
                                                    });
                                                  }}
                                                >
                                                  <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-foreground">
                                                    <span>
                                                      Add review comment on line {inlineLine} (
                                                      {inlineSide === "right" ? "new" : "original"})
                                                    </span>
                                                    <Button
                                                      type="button"
                                                      size="sm"
                                                      variant="ghost"
                                                      className="h-5 px-1.5 text-[10px]"
                                                      onClick={() => {
                                                        setInlineLine("");
                                                        setInlineBody("");
                                                      }}
                                                    >
                                                      Cancel
                                                    </Button>
                                                  </div>
                                                  <textarea
                                                    autoFocus
                                                    required
                                                    value={inlineBody}
                                                    onChange={(e) => setInlineBody(e.target.value)}
                                                    onKeyDown={(e) => {
                                                      if (e.key === "Escape") {
                                                        e.preventDefault();
                                                        setInlineLine("");
                                                        setInlineBody("");
                                                      } else if (
                                                        (e.metaKey || e.ctrlKey) &&
                                                        e.key === "Enter"
                                                      ) {
                                                        e.preventDefault();
                                                        const lineNum = Number(inlineLine);
                                                        if (
                                                          Number.isSafeInteger(lineNum) &&
                                                          lineNum > 0 &&
                                                          inlineBody.trim()
                                                        ) {
                                                          void mutatePullRequest(
                                                            pr.n,
                                                            "inline_comment",
                                                            inlineBody.trim(),
                                                            undefined,
                                                            {
                                                              path: selectedFile.path,
                                                              line: lineNum,
                                                              side: inlineSide,
                                                            },
                                                          ).then((ok) => {
                                                            if (ok) {
                                                              setInlineBody("");
                                                              setInlineLine("");
                                                            }
                                                          });
                                                        }
                                                      }
                                                    }}
                                                    placeholder="Write your review comment… (⌘+Enter to submit, Esc to cancel)"
                                                    className="min-h-16 w-full rounded-md border border-border bg-background p-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                  />
                                                  <div className="flex items-center justify-between gap-2">
                                                    <span className="text-[10px] text-muted-foreground">
                                                      ⌘+Enter to submit
                                                    </span>
                                                    <Button
                                                      type="submit"
                                                      size="sm"
                                                      className="h-7 text-xs"
                                                      disabled={
                                                        !inlineBody.trim() || pendingAction !== null
                                                      }
                                                    >
                                                      Comment
                                                    </Button>
                                                  </div>
                                                </form>
                                              </div>
                                            ) : null}

                                            {/* In-place Review Threads on this exact line */}
                                            {lineThreads.map((thread) => (
                                              <div
                                                key={thread.id}
                                                className="bg-background/80 px-3 py-1"
                                              >
                                                <PullRequestReviewThreadCard
                                                  thread={thread}
                                                  prNumber={pr.n}
                                                  cwd={cwd}
                                                  supportsAction={supportsAction}
                                                  onMutate={(action, body, value, inline) =>
                                                    mutatePullRequest(
                                                      pr.n,
                                                      action,
                                                      body,
                                                      value,
                                                      inline,
                                                    )
                                                  }
                                                  onFixInThread={handleFixInThread}
                                                  isPending={pendingAction !== null}
                                                />
                                              </div>
                                            ))}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {selectedFile.patchTruncated ? (
                                    <p
                                      role="status"
                                      className="border-t border-border/60 px-3 py-2 text-amber-700 dark:text-amber-400 text-xs"
                                    >
                                      This patch was truncated to keep the review responsive. Open
                                      the pull request on the provider for the complete diff.
                                    </p>
                                  ) : null}

                                  {/* Outdated / File-level Discussions (threads not mapped to a visible line in this patch) */}
                                  {(() => {
                                    const unmappedThreads = selectedThreads.filter(
                                      (t) => !renderedThreadIds.has(t.id),
                                    );
                                    if (unmappedThreads.length === 0) return null;

                                    return (
                                      <section
                                        aria-label={`Unmapped or outdated discussions for ${selectedFile.path}`}
                                        className="space-y-2 border-t border-border/60 bg-muted/10 p-3"
                                      >
                                        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                          <MessageSquare className="size-3.5" />
                                          <span>
                                            Outdated or File Discussions ({unmappedThreads.length})
                                          </span>
                                        </div>
                                        {unmappedThreads.map((thread) => (
                                          <PullRequestReviewThreadCard
                                            key={thread.id}
                                            thread={thread}
                                            prNumber={pr.n}
                                            cwd={cwd}
                                            supportsAction={supportsAction}
                                            onMutate={(action, body, value, inline) =>
                                              mutatePullRequest(pr.n, action, body, value, inline)
                                            }
                                            onFixInThread={handleFixInThread}
                                            isPending={pendingAction !== null}
                                          />
                                        ))}
                                      </section>
                                    );
                                  })()}
                                </div>
                              </div>
                            );
                          })()
                        ) : detailTab === "checks" ? (
                          <PullRequestChecksView
                            checks={detailQuery.data.pullRequest.checks ?? []}
                          />
                        ) : detailTab === "commits" ? (
                          <div className="space-y-2">
                            {(detailQuery.data.pullRequest.commits ?? []).length > 0 ? (
                              detailQuery.data.pullRequest.commits?.map((commit) => (
                                <div key={commit.sha} className="flex items-start gap-2">
                                  <code className="text-muted-foreground">
                                    {commit.sha.slice(0, 7)}
                                  </code>
                                  <span>{commit.subject}</span>
                                </div>
                              ))
                            ) : (
                              <p className="text-muted-foreground">No commits reported.</p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <PullRequestActivityView
                              reviews={detailQuery.data.pullRequest.reviews ?? []}
                              comments={detailQuery.data.pullRequest.comments ?? []}
                              cwd={cwd}
                            />
                            {detailQuery.data.pullRequest.state === "open" ? (
                              <div className="space-y-2 border-t border-border/60 pt-3">
                                <label
                                  className="block text-[11px] font-medium"
                                  htmlFor={`pr-action-${pr.n}`}
                                >
                                  Add review feedback
                                </label>
                                <textarea
                                  id={`pr-action-${pr.n}`}
                                  value={actionBody}
                                  onChange={(event) => setActionBody(event.target.value)}
                                  className="min-h-20 w-full rounded-lg border border-border bg-background p-2 text-xs"
                                  placeholder="Write a comment or review…"
                                />
                                <div className="flex flex-wrap gap-2">
                                  {supportsAction("comment") ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={!actionBody.trim() || pendingAction !== null}
                                      onClick={async () => {
                                        if (
                                          await mutatePullRequest(
                                            pr.n,
                                            "comment",
                                            actionBody.trim(),
                                          )
                                        ) {
                                          setActionBody("");
                                        }
                                      }}
                                    >
                                      Comment
                                    </Button>
                                  ) : null}
                                  {supportsAction("approve") ? (
                                    <Button
                                      size="sm"
                                      disabled={pendingAction !== null}
                                      onClick={async () => {
                                        if (
                                          await mutatePullRequest(
                                            pr.n,
                                            "approve",
                                            actionBody.trim(),
                                          )
                                        ) {
                                          setActionBody("");
                                        }
                                      }}
                                    >
                                      Approve
                                    </Button>
                                  ) : null}
                                  {supportsAction("request_changes") ? (
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      disabled={!actionBody.trim() || pendingAction !== null}
                                      onClick={async () => {
                                        if (
                                          await mutatePullRequest(
                                            pr.n,
                                            "request_changes",
                                            actionBody.trim(),
                                          )
                                        ) {
                                          setActionBody("");
                                        }
                                      }}
                                    >
                                      Request changes
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ))}
          {viewMode === "all" && allPrsQuery.data?.hasMore ? (
            <div className="flex justify-center pt-1">
              <Button
                type="button"
                variant="outline"
                disabled={allPrsQuery.isFetching || listLimit >= 200}
                onClick={() => setListLimit((current) => Math.min(200, current + 50))}
              >
                {allPrsQuery.isFetching ? "Loading more…" : "Load 50 more pull requests"}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {mergePr && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setMergePr(null);
          }}
        >
          <DialogPopup className="git-tool-v2 max-w-md">
            <DialogHeader>
              <DialogTitle>
                {mergeIntent === "auto_merge" ? "Enable auto-merge" : "Merge Pull Request"} #
                {mergePr.n}
              </DialogTitle>
            </DialogHeader>
            <DialogPanel className="space-y-4">
              <p className="text-xs text-foreground/90">
                {mergeIntent === "auto_merge" ? (
                  <>
                    Merge <strong>{mergePr.title}</strong> automatically after its policies and
                    checks pass.
                  </>
                ) : (
                  <>
                    Are you sure you want to merge <strong>{mergePr.title}</strong> into base
                    branch?
                  </>
                )}
              </p>

              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Merge Strategy
                </label>
                <Select
                  value={mergeMethod}
                  onChange={(e) => setMergeMethod(e.target.value as "squash" | "merge" | "rebase")}
                >
                  {(capabilities?.mergeMethods ?? ["squash", "merge", "rebase"]).map((method) => (
                    <option key={method} value={method}>
                      {method === "squash"
                        ? "Squash and merge (recommended)"
                        : method === "merge"
                          ? "Create a merge commit"
                          : "Rebase and merge"}
                    </option>
                  ))}
                </Select>
              </div>

              {mergeIntent === "merge" ? (
                <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg border border-border/60 bg-muted/20 mt-2">
                  <span className="text-xs text-foreground/90 font-medium">
                    Delete head branch after merging
                  </span>
                  <Switch checked={deleteBranch} onCheckedChange={(c) => setDeleteBranch(!!c)} />
                </div>
              ) : null}
            </DialogPanel>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setMergePr(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={pendingAction !== null}
                onClick={() => void handleConfirmMerge()}
              >
                <CheckCircle2 />
                {mergeIntent === "auto_merge" ? "Enable auto-merge" : "Confirm Merge"}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      )}

      {editPr ? (
        <PullRequestEditDialog
          open={Boolean(editPr)}
          onOpenChange={(open) => {
            if (!open) setEditPr(null);
          }}
          prNumber={editPr.number}
          initialTitle={editPr.title}
          initialBody={editPr.body}
          cwd={cwd}
          isPending={pendingAction !== null}
          onSave={async (title, body) => {
            const current = editPr;
            const ok = await mutatePullRequest(
              current.number,
              "edit_pull_request",
              body,
              undefined,
              undefined,
              title.trim(),
            );
            if (ok) setEditPr(null);
          }}
        />
      ) : null}
    </div>
  );
}
