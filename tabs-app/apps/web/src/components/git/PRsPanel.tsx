import { OrbitGroup } from "../ui/orbit-group";
import { openLink } from "../../browserLinkTarget";
import { cn } from "../../lib/utils";
import {
  ArrowLeft,
  ArrowUpDown,
  Copy as CopyIcon,
  ExternalLink as ExternalLinkIcon,
  BookOpen,
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
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import { AssistantBubbleIcon } from "../AssistantBubbleIcon";
import { formatRelativeTime } from "~/timestampFormat";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import type {
  EnvironmentId,
  GitPullRequestAction,
  GitPullRequestReviewThread,
  GitPullRequestStackMembership,
  GitPullRequestStackHead,
  GitPullRequestStack,
  PullRequestInvolvement,
  PullRequestListFilters,
  PullRequestRef,
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
  gitEnvironmentQueryOptions,
  gitResolvePullRequestQueryOptions,
  PULL_REQUEST_FIRST_PAGE,
} from "../../lib/gitReactQuery";
import { toGitUserFacingErrorMessage } from "../../lib/gitErrorMessages";
import { GitCheckingState } from "./GitCheckingState";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SuggestInput } from "../ui/suggest-input";
import { toastManager } from "../ui/toast";
import { SegmentedControl } from "../ui/segmented-control";
import { Popover, PopoverTrigger, PopoverPopup, PopoverTitle } from "../ui/popover";
import { useStaggerIn } from "../agents/companion/designs/motion";
import type { ReactNode } from "react";
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
import { projectsAtom, threadsAtom } from "../../state/threads";
import { usePullRequestSuggestions } from "./usePullRequestSuggestions";
import { PullRequestComposerTextarea } from "./PullRequestComposerTextarea";
import { HostPullRequestsPanel, isHostPullRequestProvider } from "./HostPullRequestsPanel";
import { PullRequestFilterBar } from "./PullRequestFilterBar";
import { PullRequestReactionBar } from "./PullRequestReactionBar";
import { PullRequestLinkPreview } from "./PullRequestLinkPreview";
import { PullRequestGuideTab } from "./PullRequestGuideTab";
import { useReviewGuide } from "./useReviewGuide";
import { pullRequestLinkTarget } from "./pullRequestLinkTarget";
import { groupPullRequestRows } from "./pullRequestListGroups";
import { usePullRequestFilesViewed } from "./usePullRequestFilesViewed";
import { countViewed } from "./pullRequestFilesViewed.logic";
import { Checkbox } from "../ui/checkbox";
import { findThreadsForPullRequest } from "@tabs/shared/threadPullRequests";
import { Details, Summary } from "../ui/disclosure";

interface PullRequestRow {
  n: number;
  title: string;
  state: "open" | "draft" | "merged" | "closed";
  branch: string;
  url: string;
  provider?:
    | "github"
    | "gitlab"
    | "azure-devops"
    | "bitbucket"
    | "forgejo"
    | "gitcafe"
    | "cursor-origin"
    | "unknown";
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
  /** Only the service's listing knows whether the reader's review was asked for. */
  viewerReviewRequested?: boolean;
}

function formatPrErrorMessage(rawError: unknown): { message: string; details?: string } {
  if (!rawError) {
    return { message: "The pull-request provider returned an unknown error." };
  }
  let raw = "";
  if (rawError instanceof Error) {
    raw = rawError.message;
  } else if (typeof rawError === "object" && rawError !== null && "message" in rawError) {
    raw = String((rawError as { message: unknown }).message);
  } else {
    raw = String(rawError);
  }

  // Attempt to parse structured error JSON
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  let detailStr = "";
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
      detailStr = String(parsed.detail || parsed.message || "");
    } catch {
      // not valid JSON
    }
  }

  const candidate = detailStr || raw;
  if (/no git remotes found/i.test(candidate)) {
    return {
      message: "No Git remotes configured for this repository.",
      ...(candidate !== "No Git remotes configured for this repository."
        ? { details: candidate }
        : {}),
    };
  }

  const failedMatch = candidate.match(/failed \([^)]+\),\s*(.+)$/i);
  if (failedMatch && failedMatch[1]) {
    return {
      message: failedMatch[1].trim(),
      details: candidate,
    };
  }

  const cleanMessage = candidate
    .replace(/^Server request failed:\s*/i, "")
    .replace(/^GitHub CLI command failed:\s*/i, "")
    .trim();

  return {
    message: cleanMessage || "The pull-request provider returned an unknown error.",
    ...(raw !== cleanMessage ? { details: raw } : {}),
  };
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
    case "forgejo":
      return "Forgejo";
    case "gitcafe":
      return "GitCafe";
    case "cursor-origin":
      return "Cursor Origin";
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

function SecondaryActions({
  compact,
  number,
  children,
}: {
  compact: boolean;
  number: number;
  children: ReactNode;
}) {
  if (!compact) return <>{children}</>;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            aria-label={`More actions for pull request ${number}`}
          />
        }
      >
        <MoreHorizontal size={16} />
      </PopoverTrigger>
      <PopoverPopup align="end" viewportClassName="p-2">
        <PopoverTitle className="sr-only">Pull request {number} actions</PopoverTitle>
        <div className="flex flex-col items-stretch gap-1 [&>button]:justify-start">{children}</div>
      </PopoverPopup>
    </Popover>
  );
}

function GitPRsPanel({
  cwd,
  environmentId,
  branchName,
  onOpenCreatePR,
  compact = false,
}: {
  cwd: string;
  environmentId?: string | undefined;
  branchName: string;
  onOpenCreatePR: () => void;
  compact?: boolean;
}) {
  const api = useGitApi();
  // The redesigned side panel lists pull requests as quiet single rows with a compact header.
  const redesigned = compact;
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
  // A row's detail is read once the pointer or focus has rested on it for a moment, so opening
  // it paints from what was already fetched. Passing over rows asks the host nothing.
  const queryClient = useQueryClient();
  const intentTimer = useRef<number | undefined>(undefined);
  const prefetchOnIntent = useCallback(
    (number: number | null) => {
      window.clearTimeout(intentTimer.current);
      if (number === null || !cwd) return;
      intentTimer.current = window.setTimeout(() => {
        void queryClient.prefetchQuery(
          gitResolvePullRequestQueryOptions({
            cwd,
            reference: String(number),
            environmentId,
          }),
        );
      }, 150);
    },
    [cwd, environmentId, queryClient],
  );
  useEffect(() => () => window.clearTimeout(intentTimer.current), []);
  const [detailTab, setDetailTab] = useState<
    "summary" | "code" | "guide" | "checks" | "commits" | "activity"
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
  const [listLimit, setListLimit] = useState(PULL_REQUEST_FIRST_PAGE);
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

  // The host-side suggestion reads address a project and a repository, which this panel derives
  // from the checkout it shows and from the open pull request's own URL.
  const projects = useAtomValue(projectsAtom);
  const panelProjectId =
    projects.find(
      (project) =>
        project.cwd === cwd &&
        (environmentId === undefined || project.environmentId === environmentId),
    )?.id ?? null;

  // T3's list filters: who the pull request involves, and a few facets of its review state. The
  // host reads these as a search, so they are answered by the pull request service's own list
  // (which the plain listing below cannot narrow) and only while one is switched on; the plain
  // listing stays the default because it is the quicker read.
  const [involvement, setInvolvement] = useState<PullRequestInvolvement>("all");
  const [facetFilters, setFacetFilters] = useState<PullRequestListFilters>({});
  const filtersActive = involvement !== "all" || Object.keys(facetFilters).length > 0;
  const serviceListActive = viewMode === "all" && filtersActive && panelProjectId !== null;
  const serviceListQuery = useQuery({
    queryKey: [
      "git",
      "service-pull-requests",
      environmentId ?? "local",
      panelProjectId,
      filterState,
      involvement,
      facetFilters,
      listLimit,
      searchQuery,
    ],
    enabled: serviceListActive && api !== null,
    queryFn: () =>
      api!.pullRequests.list({
        state: filterState,
        involvement,
        ...(Object.keys(facetFilters).length > 0 ? { filters: facetFilters } : {}),
        projectId: panelProjectId!,
        limit: Math.min(listLimit, 100),
        ...(searchQuery ? { query: searchQuery } : {}),
      }),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const openPullRequestUrl = detailQuery.data?.pullRequest?.url ?? null;
  const suggestionTarget = (() => {
    try {
      if (openPullRequestUrl === null) return { host: undefined, repository: "" };
      const parsed = new URL(openPullRequestUrl);
      return {
        host: parsed.hostname,
        repository: parsed.pathname.replace(/^\//, "").split(/\/pulls?\//)[0] ?? "",
      };
    } catch {
      return { host: undefined, repository: "" };
    }
  })();
  const suggestions = usePullRequestSuggestions(
    {
      api,
      projectId: panelProjectId,
      repository: suggestionTarget.repository,
      host: suggestionTarget.host,
    },
    expandedPrNumber,
  );
  // Where a reaction on the open pull request is saved. Null leaves reactions read-only.
  const reactionRef: PullRequestRef | null =
    panelProjectId !== null && expandedPrNumber !== null && suggestionTarget.repository
      ? {
          projectId: panelProjectId,
          repository: suggestionTarget.repository,
          number: expandedPrNumber,
          ...(suggestionTarget.host ? { host: suggestionTarget.host } : {}),
        }
      : null;
  // Links to this repository's own pull requests show a card on hover.
  const decorateLink = useCallback(
    (href: string, link: ReactElement) => {
      const target = pullRequestLinkTarget(href, {
        projectId: panelProjectId,
        repository: suggestionTarget.repository,
        ...(suggestionTarget.host ? { host: suggestionTarget.host } : {}),
      });
      return target === null ? null : <PullRequestLinkPreview link={link} reference={target} />;
    },
    [panelProjectId, suggestionTarget.repository, suggestionTarget.host],
  );
  // The review guide is read only while its tab is open.
  const reviewGuide = useReviewGuide({
    api,
    reference: reactionRef,
    enabled: detailTab === "guide",
  });
  // "Viewed" ticks live with the host, per pull request, so they follow the reader across
  // devices; only the open pull request's Code tab asks for them.
  const filesViewed = usePullRequestFilesViewed({
    api,
    reference:
      panelProjectId !== null && expandedPrNumber !== null && suggestionTarget.repository
        ? {
            projectId: panelProjectId,
            repository: suggestionTarget.repository,
            number: expandedPrNumber,
            ...(suggestionTarget.host ? { host: suggestionTarget.host } : {}),
          }
        : null,
    enabled: detailTab === "code" && detailQuery.data?.pullRequest?.provider !== "gitlab",
  });
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

  const activeQuery =
    viewMode === "branch" ? branchPrQuery : serviceListActive ? serviceListQuery : allPrsQuery;
  // Only the plain queries know what a host supports; the filtered list is an answer, not a host.
  const capabilities = (viewMode === "branch" ? branchPrQuery : allPrsQuery).data?.capabilities;

  const authorMatch = /^author:(\S*)$/iu.exec(searchInput.trim());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads author suggestions while an author: filter is typed
  useEffect(() => {
    if (authorMatch === null || !capabilities?.search) return;
    const query = authorMatch[1] ?? "";
    const timer = window.setTimeout(() => suggestions.requestAuthors(query), 200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorMatch?.[1], capabilities?.search]);

  const supportsAction = useCallback(
    (action: GitPullRequestAction) =>
      capabilities ? capabilities.actions.includes(action) : action !== "request_changes",
    [capabilities],
  );
  const branchHasNoPullRequest =
    viewMode === "branch" &&
    activeQuery.error instanceof Error &&
    /pull request not found|no pull requests? found|no pull request associated/i.test(
      activeQuery.error.message,
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
      const serviceRows: PullRequestRow[] | null = serviceListActive
        ? (serviceListQuery.data?.entries ?? []).map((entry) => ({
            n: entry.number,
            title: entry.title,
            state: entry.state,
            branch: `${entry.headBranch} → ${entry.baseBranch}`,
            url: entry.url,
            provider: entry.provider,
            isDraft: entry.isDraft,
            author: entry.author?.login ?? null,
            labels: entry.labels.map((label) => ({
              name: label.name,
              ...(label.color ? { color: label.color } : {}),
            })),
            ...(entry.reviewDecision
              ? {
                  reviewDecision: entry.reviewDecision.replaceAll("-", "_") as
                    | "approved"
                    | "changes_requested"
                    | "review_required",
                }
              : {}),
            mergeability: entry.mergeability,
            viewerReviewRequested: entry.viewerReviewRequested,
            ...(entry.checksState ? { checksState: entry.checksState } : {}),
            ...(entry.additions > 0 ? { additions: entry.additions } : {}),
            ...(entry.deletions > 0 ? { deletions: entry.deletions } : {}),
          }))
        : null;
      if (serviceRows !== null) return serviceRows;
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
  }, [
    viewMode,
    branchPrQuery.data,
    allPrsQuery.data,
    serviceListActive,
    serviceListQuery.data,
    branchName,
    searchQuery,
    threads,
  ]);

  // Grouped by involvement only in the repository-wide list: "This branch" is one row.
  const viewerLogin =
    useQuery(gitEnvironmentQueryOptions(cwd || null, environmentId)).data?.gitHub.activeLogin ??
    null;
  // In the redesigned panel an open pull request is a page of its own.
  const detailPage =
    redesigned && expandedPrNumber !== null && prs.some((pr) => pr.n === expandedPrNumber);
  const prList = useRef<HTMLDivElement>(null);
  useStaggerIn(
    prList,
    ".pr-row, .pr-page",
    `${viewMode}:${filterState}:${prs.length}:${prs[0]?.n ?? 0}:${detailPage ? expandedPrNumber : "list"}`,
    { y: 8, stagger: 0.025 },
  );
  const groupedPrs = useMemo(
    () =>
      viewMode === "all" && involvement === "all"
        ? groupPullRequestRows(prs, viewerLogin)
        : groupPullRequestRows(prs, null),
    [prs, viewMode, involvement, viewerLogin],
  );

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
    <div className={compact ? "companion-pr-list" : "space-y-3"}>
      {/* Top Controls Toolbar: Segmented View Selector, State Filters & Create PR Button */}
      {detailPage ? null : redesigned ? (
        <div className="pr-head">
          <div className="pr-head-row">
            <div className="cd-seg" role="group" aria-label="Pull request scope">
              <button
                type="button"
                aria-pressed={viewMode === "branch"}
                title={`Pull request for ${branchName}`}
                onClick={() => setViewMode("branch")}
              >
                This branch
              </button>
              <button
                type="button"
                aria-pressed={viewMode === "all"}
                onClick={() => setViewMode("all")}
              >
                Repository
              </button>
            </div>
            {viewMode === "all" ? (
              <div className="cd-seg" role="group" aria-label="Pull request state">
                {(["all", "open", "merged", "closed"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filterState === value}
                    onClick={() => setFilterState(value)}
                  >
                    {value === "all" ? "All" : value[0]!.toUpperCase() + value.slice(1)}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="pr-head-end">
              {viewMode === "all" && panelProjectId !== null ? (
                <Popover>
                  <PopoverTrigger
                    render={
                      <button
                        type="button"
                        className="pr-filter-button"
                        data-active={filtersActive}
                        aria-label="Filter pull requests"
                      />
                    }
                  >
                    <Filter size={13} aria-hidden="true" />
                    Filters
                    {filtersActive ? (
                      <span className="pr-filter-count">
                        {Object.keys(facetFilters).length + (involvement !== "all" ? 1 : 0)}
                      </span>
                    ) : null}
                  </PopoverTrigger>
                  <PopoverPopup align="end" className="pr-filter-popup">
                    <PullRequestFilterBar
                      involvement={involvement}
                      onInvolvement={(next) => {
                        setListLimit(PULL_REQUEST_FIRST_PAGE);
                        setInvolvement(next);
                      }}
                      filters={facetFilters}
                      onFilters={(next) => {
                        setListLimit(PULL_REQUEST_FIRST_PAGE);
                        setFacetFilters(next);
                      }}
                    />
                  </PopoverPopup>
                </Popover>
              ) : null}
              {capabilities?.create !== false ? (
                <button type="button" className="sl-primary pr-new" onClick={onOpenCreatePR}>
                  <Plus size={13} aria-hidden="true" />
                  New PR
                </button>
              ) : null}
            </div>
          </div>
          {viewMode === "all" && capabilities?.search ? (
            <div className="pr-head-row">
              <form
                role="search"
                aria-label="Search pull requests"
                className="sl-search pr-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  setListLimit(PULL_REQUEST_FIRST_PAGE);
                  setSearchQuery(searchInput.trim());
                }}
              >
                <Search size={14} aria-hidden="true" />
                <SuggestInput
                  type="search"
                  aria-label="Search pull requests"
                  value={searchInput}
                  onValueChange={setSearchInput}
                  placeholder="Search titles, branches or author:name"
                  suggestions={
                    authorMatch !== null
                      ? suggestions.authors.map((login) => `author:${login}`)
                      : []
                  }
                />
                {searchQuery ? (
                  <button
                    type="button"
                    className="pr-search-clear"
                    onClick={() => {
                      setSearchInput("");
                      setSearchQuery("");
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </form>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div
            className={
              compact
                ? "companion-pr-controls"
                : "flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card/60 p-3 rounded-xl border border-border/60"
            }
          >
            {/* Segmented Scope Control */}
            <div className={compact ? "companion-pr-filters" : "flex items-center gap-2 flex-wrap"}>
              <SegmentedControl
                size="sm"
                aria-label="Pull request scope"
                value={viewMode}
                onValueChange={setViewMode}
                options={[
                  {
                    value: "branch",
                    label: compact ? "This branch" : `This branch (${branchName})`,
                  },
                  { value: "all", label: compact ? "Repository" : "All repository PRs" },
                ]}
              />
              {viewMode === "all" && (
                <SegmentedControl
                  size="sm"
                  aria-label="Pull request state"
                  value={filterState}
                  onValueChange={setFilterState}
                  options={(["all", "open", "merged", "closed"] as const).map((value) => ({
                    value,
                    label: value === "all" ? "All" : value[0]!.toUpperCase() + value.slice(1),
                  }))}
                />
              )}
              {viewMode === "all" && panelProjectId !== null ? (
                <PullRequestFilterBar
                  involvement={involvement}
                  onInvolvement={(next) => {
                    setListLimit(PULL_REQUEST_FIRST_PAGE);
                    setInvolvement(next);
                  }}
                  filters={facetFilters}
                  onFilters={(next) => {
                    setListLimit(PULL_REQUEST_FIRST_PAGE);
                    setFacetFilters(next);
                  }}
                />
              ) : null}
              {viewMode === "all" && capabilities?.search ? (
                <form
                  role="search"
                  aria-label="Search pull requests"
                  className={compact ? "companion-pr-search" : "flex min-w-56 items-center gap-1"}
                  onSubmit={(event) => {
                    event.preventDefault();
                    setListLimit(PULL_REQUEST_FIRST_PAGE);
                    setSearchQuery(searchInput.trim());
                  }}
                >
                  <SuggestInput
                    aria-label="Search pull requests"
                    type="search"
                    value={searchInput}
                    onValueChange={setSearchInput}
                    placeholder="Search pull requests"
                    suggestions={
                      authorMatch !== null
                        ? suggestions.authors.map((login) => `author:${login}`)
                        : []
                    }
                    className="min-w-0 flex-1 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs outline-none focus-blur-glow"
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
                <span>{compact ? "New PR" : "Create pull request"}</span>
              </Button>
            ) : null}
          </div>
        </>
      )}

      {activeQuery.isError && !branchHasNoPullRequest ? (
        <div role="alert">
          <Card className="border-destructive/40 bg-destructive/5 p-6 text-center">
            <GitPullRequest className="mx-auto mb-2 text-destructive" size={28} />
            <p className="text-sm font-medium text-foreground">Unable to load pull requests</p>
            {(() => {
              const formatted = formatPrErrorMessage(activeQuery.error);
              return (
                <div className="mx-auto mt-2 max-w-xl text-center">
                  <p className="text-xs text-muted-foreground break-words [overflow-wrap:anywhere] leading-relaxed">
                    {formatted.message}
                  </p>
                  {formatted.details && formatted.details !== formatted.message ? (
                    <Details className="mt-2 text-left">
                      <Summary className="cursor-pointer text-[11px] text-muted-foreground/75 hover:text-foreground">
                        Technical details
                      </Summary>
                      <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[10px] text-muted-foreground whitespace-pre-wrap break-all">
                        {formatted.details}
                      </pre>
                    </Details>
                  ) : null}
                </div>
              );
            })()}
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
        <div ref={prList} className="space-y-2.5">
          {groupedPrs.map((group) => (
            <Fragment key={group.key}>
              {group.label && !detailPage ? (
                <div className="flex items-center gap-2 px-1 pt-1 text-[11px] font-medium text-muted-foreground">
                  <h3>{group.label}</h3>
                  <span className="tabular-nums text-muted-foreground/70">{group.rows.length}</span>
                  <span className="h-px min-w-2 flex-1 bg-border/60" aria-hidden="true" />
                </div>
              ) : null}
              {group.rows.map((pr) => {
                const actions = (
                  <div className={compact ? "companion-pr-actions" : "flex items-center gap-2"}>
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
                          className="gap-1.5 text-xs text-foreground border-primary/30 bg-primary/5 hover:bg-primary/10 h-7 px-2 shrink-0"
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
                    {!redesigned && (
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
                    )}
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
                          const methods = capabilities?.mergeMethods ?? [
                            "squash",
                            "merge",
                            "rebase",
                          ];
                          if (!methods.includes(mergeMethod)) {
                            setMergeMethod(methods[0] ?? "squash");
                          }
                          setMergePr(pr);
                        }}
                      >
                        <GitMerge /> Merge…
                      </Button>
                    )}
                    <SecondaryActions compact={compact} number={pr.n}>
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
                              if (!methods.includes(mergeMethod))
                                setMergeMethod(methods[0] ?? "merge");
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
                          void openLink(pr.url).catch((error) => {
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
                    </SecondaryActions>
                  </div>
                );
                const details =
                  expandedPrNumber === pr.n ? (
                    <div className="mt-3 border-t border-border/60 pt-3">
                      {detailQuery.isLoading ? (
                        <GitCheckingState message={`Loading pull request #${pr.n}…`} size={24} />
                      ) : detailQuery.isError ? (
                        <div
                          role="alert"
                          className="rounded-lg border border-destructive/40 p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-destructive break-words [overflow-wrap:anywhere]">
                              {formatPrErrorMessage(detailQuery.error).message}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => detailQuery.refetch()}
                          >
                            Retry
                          </Button>
                        </div>
                      ) : detailQuery.data?.pullRequest ? (
                        <div className="space-y-3">
                          <OrbitGroup
                            role="tablist"
                            aria-label={`Pull request #${pr.n} details`}
                            onKeyDown={handleTabListKeyDown}
                            className="tabs-segmented inline-flex flex-wrap w-fit"
                          >
                            {(
                              [
                                ["summary", "Summary", GitPullRequest],
                                ["code", "Code", FileDiff],
                                ["guide", "Guide", BookOpen],
                                ["checks", "Checks", CheckCircle2],
                                ["commits", "Commits", GitCommit],
                                ["activity", "Activity", AssistantBubbleIcon],
                              ] as const
                            )
                              .filter(
                                ([id]) =>
                                  (id !== "code" ||
                                    detailQuery.data?.capabilities?.diff !== false) &&
                                  // A guide is written from a project's host-backed diff.
                                  (id !== "guide" || reactionRef !== null),
                              )
                              .map(([id, label, Icon]) => (
                                <button
                                  key={id}
                                  id={`pr-${pr.n}-${id}-tab`}
                                  type="button"
                                  role="tab"
                                  aria-controls={`pr-${pr.n}-detail-panel`}
                                  aria-selected={detailTab === id}
                                  tabIndex={detailTab === id ? 0 : -1}
                                  className={cn(
                                    "h-7 px-3 text-xs font-medium rounded-full transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5",
                                    detailTab === id
                                      ? "text-foreground font-semibold"
                                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                                  )}
                                  onClick={() => setDetailTab(id)}
                                >
                                  <Icon className="size-3.5 shrink-0" />
                                  <span className="orbit-label">{label}</span>
                                </button>
                              ))}
                          </OrbitGroup>
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
                                  <ChatMarkdown
                                    text={detailQuery.data.pullRequest.body}
                                    cwd={cwd}
                                    decorateLink={decorateLink}
                                  />
                                ) : (
                                  <p className="text-muted-foreground">No description provided.</p>
                                )}
                                {detailQuery.data.pullRequest.reactions !== undefined ? (
                                  <PullRequestReactionBar
                                    reactions={detailQuery.data.pullRequest.reactions}
                                    canReact
                                    reference={reactionRef}
                                    onSaved={() => void detailQuery.refetch()}
                                  />
                                ) : null}
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
                                  suggestions={suggestions.reviewers}
                                  onRequestSuggestions={suggestions.requestReviewers}
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
                                  suggestions={suggestions.labels}
                                  onRequestSuggestions={suggestions.requestLabels}
                                />
                              </div>
                            ) : detailTab === "code" ? (
                              (() => {
                                const allFiles = detailQuery.data.pullRequest.files ?? [];
                                const reviewThreads =
                                  detailQuery.data.pullRequest.reviewThreads ?? [];

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

                                      {filesViewed.enabled ? (
                                        <div className="flex items-center justify-between border-b border-border/60 px-2.5 py-1.5 text-[10px] text-muted-foreground">
                                          <span className="tabular-nums">
                                            {countViewed(
                                              allFiles.map((file) => file.path),
                                              filesViewed.states,
                                            )}{" "}
                                            of {allFiles.length} viewed
                                            {filesViewed.truncated
                                              ? " (more files than were read)"
                                              : ""}
                                          </span>
                                        </div>
                                      ) : null}

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

                                            const viewed = filesViewed.isViewed(file.path);
                                            return (
                                              <div
                                                key={file.path}
                                                className="flex items-stretch border-b border-border/40 last:border-b-0"
                                              >
                                                {filesViewed.enabled ? (
                                                  <label
                                                    className="flex shrink-0 cursor-pointer items-start px-2.5 py-2.5"
                                                    title={
                                                      filesViewed.isStale(file.path)
                                                        ? "Changed since you viewed it"
                                                        : viewed
                                                          ? "Viewed"
                                                          : "Mark as viewed"
                                                    }
                                                  >
                                                    <Checkbox
                                                      checked={viewed}
                                                      aria-label={`Mark ${file.path} as viewed`}
                                                      onCheckedChange={(next) =>
                                                        filesViewed.setViewed(
                                                          file.path,
                                                          next === true,
                                                        )
                                                      }
                                                    />
                                                  </label>
                                                ) : null}
                                                <button
                                                  type="button"
                                                  aria-current={isSelected ? "true" : undefined}
                                                  className={`flex min-w-0 flex-1 items-start justify-between gap-2 px-2.5 py-2 text-left transition-colors ${viewed ? "opacity-60" : ""} ${
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
                                                          <AssistantBubbleIcon className="size-2.5" />
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
                                              </div>
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
                                          No textual patch is available. The file may be binary or
                                          the provider may have omitted a very large patch.
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
                                                        className="border-r border-border/40 px-1 text-right text-muted-foreground hover:bg-primary/20 hover:text-foreground focus-visible:z-10 cursor-pointer"
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
                                                          {inlineSide === "right"
                                                            ? "new"
                                                            : "original"}
                                                          )
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
                                                        onChange={(e) =>
                                                          setInlineBody(e.target.value)
                                                        }
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
                                                            !inlineBody.trim() ||
                                                            pendingAction !== null
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
                                          This patch was truncated to keep the review responsive.
                                          Open the pull request on the provider for the complete
                                          diff.
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
                                              <AssistantBubbleIcon className="size-3.5" />
                                              <span>
                                                Outdated or File Discussions (
                                                {unmappedThreads.length})
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
                                            ))}
                                          </section>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                );
                              })()
                            ) : detailTab === "guide" ? (
                              <PullRequestGuideTab
                                guide={reviewGuide.data?.guide ?? null}
                                run={reviewGuide.data?.run ?? null}
                                currentHeadSha={reviewGuide.data?.currentHeadSha ?? null}
                                isLoading={reviewGuide.isLoading}
                                writing={reviewGuide.writing}
                                error={reviewGuide.error}
                                onWrite={reviewGuide.write}
                                patchOf={(path) =>
                                  detailQuery.data?.pullRequest.files?.find(
                                    (file) => file.path === path,
                                  )?.patch
                                }
                                onOpenFile={(path) => {
                                  setSelectedFilePath(path);
                                  setDetailTab("code");
                                }}
                              />
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
                                  reactionRef={reactionRef}
                                  onReactionSaved={() => void detailQuery.refetch()}
                                  decorateLink={decorateLink}
                                  onEditComment={
                                    api && panelProjectId && suggestionTarget.repository
                                      ? async (comment, body) => {
                                          try {
                                            await api.pullRequests.updateComment({
                                              projectId: panelProjectId,
                                              repository: suggestionTarget.repository,
                                              ...(suggestionTarget.host
                                                ? { host: suggestionTarget.host }
                                                : {}),
                                              number: pr.n,
                                              commentId: comment.id,
                                              kind: "issue-comment",
                                              body,
                                            });
                                            await detailQuery.refetch();
                                            return true;
                                          } catch (error) {
                                            toastManager.add({
                                              type: "error",
                                              title: "Could not edit the comment",
                                              description:
                                                error instanceof Error
                                                  ? error.message
                                                  : String(error),
                                            });
                                            return false;
                                          }
                                        }
                                      : undefined
                                  }
                                />
                                {detailQuery.data.pullRequest.state === "open" ? (
                                  <div className="space-y-2 border-t border-border/60 pt-3">
                                    <label
                                      className="block text-[11px] font-medium"
                                      htmlFor={`pr-action-${pr.n}`}
                                    >
                                      Add review feedback
                                    </label>
                                    <PullRequestComposerTextarea
                                      id={`pr-action-${pr.n}`}
                                      value={actionBody}
                                      onValueChange={setActionBody}
                                      className="min-h-20 w-full rounded-lg border border-border bg-background p-2 text-xs"
                                      placeholder="Write a comment or review…"
                                      support={{
                                        mentions: capabilities?.mentions === true,
                                        referenceSigils: capabilities?.referenceSigils ?? [],
                                      }}
                                      searchMentions={
                                        api && panelProjectId && suggestionTarget.repository
                                          ? (query) =>
                                              api.pullRequests
                                                .authorCandidates({
                                                  projectId: panelProjectId,
                                                  repository: suggestionTarget.repository,
                                                  ...(suggestionTarget.host
                                                    ? { host: suggestionTarget.host }
                                                    : {}),
                                                  query,
                                                })
                                                .then((list) => list.candidates)
                                          : undefined
                                      }
                                      searchReferences={
                                        api && panelProjectId && suggestionTarget.repository
                                          ? (query, sigil) =>
                                              api.pullRequests
                                                .referenceCandidates({
                                                  projectId: panelProjectId,
                                                  repository: suggestionTarget.repository,
                                                  ...(suggestionTarget.host
                                                    ? { host: suggestionTarget.host }
                                                    : {}),
                                                  query,
                                                  sigil,
                                                })
                                                .then((list) => list.candidates)
                                          : undefined
                                      }
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
                  ) : null;
                if (redesigned) {
                  // An open pull request takes the whole panel, with a way back to the list.
                  if (detailPage && pr.n !== expandedPrNumber) return null;
                  if (detailPage) {
                    const pageState = pr.isDraft
                      ? "Draft"
                      : pr.state[0]!.toUpperCase() + pr.state.slice(1);
                    return (
                      <div key={pr.n} className="pr-page">
                        <div className="pr-page-bar">
                          <button
                            type="button"
                            className="pr-page-back"
                            onClick={() => setExpandedPrNumber(null)}
                          >
                            <ArrowLeft size={14} aria-hidden="true" />
                            Pull requests
                          </button>
                          {actions}
                        </div>
                        <PullRequestPageHead
                          number={pr.n}
                          title={pr.title}
                          state={pr.isDraft ? "draft" : pr.state}
                          stateLabel={pageState}
                          url={pr.url}
                          author={pr.author}
                          base={detailQuery.data?.pullRequest?.baseBranch}
                          head={detailQuery.data?.pullRequest?.headBranch}
                          branchFallback={pr.branch}
                          updatedAt={detailQuery.data?.pullRequest?.updatedAt}
                          additions={pr.additions}
                          deletions={pr.deletions}
                          changedFiles={pr.changedFiles}
                          checksState={pr.checksState}
                          reviewDecision={pr.reviewDecision}
                          conflicting={pr.mergeability === "conflicting"}
                        />
                        {details}
                      </div>
                    );
                  }
                  const expanded = expandedPrNumber === pr.n;
                  const stateLabel = pr.isDraft
                    ? "Draft"
                    : pr.state[0]!.toUpperCase() + pr.state.slice(1);
                  return (
                    <div
                      key={pr.n}
                      className="pr-row"
                      data-open={expanded}
                      onPointerEnter={() => prefetchOnIntent(pr.n)}
                      onPointerLeave={() => prefetchOnIntent(null)}
                      onFocusCapture={() => prefetchOnIntent(pr.n)}
                    >
                      <div className="pr-row-main">
                        <button
                          type="button"
                          className="pr-row-hit"
                          aria-expanded={expanded}
                          aria-label={`#${pr.n} ${pr.title}, ${stateLabel}`}
                          onClick={() => {
                            setExpandedPrNumber((current) => (current === pr.n ? null : pr.n));
                            setDetailTab("summary");
                            setSelectedFilePath(null);
                          }}
                        >
                          <span
                            className="pr-state"
                            data-state={pr.isDraft ? "draft" : pr.state}
                            title={stateLabel}
                          />
                          <span className="pr-row-text">
                            <span className="pr-row-title">{pr.title}</span>
                            <span className="pr-row-meta">
                              <span className="pr-num">#{pr.n}</span>
                              <span className="pr-branch">{pr.branch}</span>
                              {pr.author ? <span>@{pr.author}</span> : null}
                              {pr.checksState ? (
                                <span className="pr-checks" data-checks={pr.checksState}>
                                  {pr.checksState === "passing"
                                    ? "Checks pass"
                                    : pr.checksState === "failing"
                                      ? "Checks fail"
                                      : "Checks running"}
                                </span>
                              ) : null}
                              {pr.reviewDecision ? (
                                <span>{pr.reviewDecision.replaceAll("_", " ")}</span>
                              ) : null}
                              {pr.mergeability === "conflicting" ? (
                                <span className="pr-conflict">Conflicts</span>
                              ) : null}
                              {pr.stackMembership ? (
                                <span title={`Stack #${pr.stackMembership.number}`}>
                                  Stack {pr.stackMembership.position}/{pr.stackMembership.size}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          {pr.additions !== undefined || pr.deletions !== undefined ? (
                            <span className="pr-row-stat">
                              <span className="cd-diff-add">+{pr.additions ?? 0}</span>
                              <span className="cd-diff-del">−{pr.deletions ?? 0}</span>
                            </span>
                          ) : null}
                          <ChevronRight aria-hidden="true" className="pr-row-chevron" />
                        </button>
                        {actions}
                      </div>
                      {details ? <div className="pr-row-details">{details}</div> : null}
                    </div>
                  );
                }
                return (
                  <div
                    key={pr.n}
                    onPointerEnter={() => prefetchOnIntent(pr.n)}
                    onPointerLeave={() => prefetchOnIntent(null)}
                    onFocusCapture={() => prefetchOnIntent(pr.n)}
                  >
                    <Card
                      className={
                        compact ? "companion-pr-card" : "p-3.5 hover:bg-muted/20 transition-colors"
                      }
                    >
                      <div className={compact ? "companion-pr-summary" : "flex items-center gap-3"}>
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
                          <div
                            className={
                              compact
                                ? "companion-pr-title"
                                : "text-xs font-semibold text-foreground/90 truncate"
                            }
                          >
                            {pr.title}{" "}
                            {pr.isDraft ? (
                              <span className="text-muted-foreground">(draft)</span>
                            ) : null}
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
                              <Badge variant="outline">
                                {pr.reviewDecision.replaceAll("_", " ")}
                              </Badge>
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
                                <Layers className="size-3 text-foreground" aria-hidden="true" />
                                {pr.stackMembership.position}/{pr.stackMembership.size}
                              </Badge>
                            ) : null}
                            {pr.mergeability === "conflicting" ? (
                              <Badge variant="destructive">Conflicts</Badge>
                            ) : null}
                            {pr.changedFiles !== undefined ? (
                              <span>{pr.changedFiles} files</span>
                            ) : null}
                            {pr.additions !== undefined ? (
                              <span className="text-diff-addition font-medium">
                                +{pr.additions}
                              </span>
                            ) : null}
                            {pr.deletions !== undefined ? (
                              <span className="text-diff-deletion font-medium">
                                −{pr.deletions}
                              </span>
                            ) : null}
                            {pr.labels.slice(0, 3).map((label) => (
                              <Badge key={label.name} variant="secondary">
                                {label.name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        {actions}
                      </div>
                      {details}
                    </Card>
                  </div>
                );
              })}
            </Fragment>
          ))}
          {viewMode === "all" &&
          !detailPage &&
          (serviceListActive
            ? serviceListQuery.data?.truncated === true && listLimit < 100
            : allPrsQuery.data?.hasMore) ? (
            <div className="flex justify-center pt-1">
              <Button
                type="button"
                variant="outline"
                disabled={activeQuery.isFetching || listLimit >= (serviceListActive ? 100 : 200)}
                onClick={() =>
                  setListLimit((current) => Math.min(serviceListActive ? 100 : 200, current + 50))
                }
              >
                {activeQuery.isFetching ? "Loading more…" : "Load 50 more pull requests"}
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

/**
 * Pull requests for a checkout. A repository on a host the git layer cannot read (Forgejo,
 * GitCafe, Cursor Origin) is listed through the server's pull-request service instead.
 */
export function PRsPanel(props: {
  cwd: string;
  environmentId?: string | undefined;
  branchName: string;
  onOpenCreatePR: () => void;
  compact?: boolean;
}) {
  const api = useGitApi();
  const projects = useAtomValue(projectsAtom);
  const project = projects.find(
    (candidate) =>
      candidate.cwd === props.cwd &&
      (props.environmentId === undefined || candidate.environmentId === props.environmentId),
  );
  const provider = project?.repositoryIdentity?.provider;
  if (project && isHostPullRequestProvider(provider)) {
    return (
      <HostPullRequestsPanel
        api={api}
        projectId={project.id}
        provider={provider!}
        branchName={props.branchName}
      />
    );
  }
  return <GitPRsPanel {...props} />;
}

/**
 * The top of an open pull request: what state it is in, where it merges, who opened it, how big
 * it is and whether checks pass, plus the one command that checks it out locally. Every fact is
 * a sentence a newcomer can read without knowing the host's vocabulary.
 */
function PullRequestPageHead(props: {
  number: number;
  title: string;
  state: "open" | "draft" | "merged" | "closed";
  stateLabel: string;
  url: string;
  author: string | null;
  base?: string | undefined;
  head?: string | undefined;
  branchFallback: string;
  updatedAt?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
  changedFiles?: number | undefined;
  checksState?: "passing" | "failing" | "pending" | undefined;
  reviewDecision?: "approved" | "changes_requested" | "review_required" | undefined;
  conflicting: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const command = `gh pr checkout ${props.number}`;
  const updated = props.updatedAt ? formatRelativeTime(props.updatedAt) : null;
  const checks =
    props.checksState === "passing"
      ? { label: "All checks passed", tone: "good" }
      : props.checksState === "failing"
        ? { label: "Some checks failed", tone: "bad" }
        : props.checksState === "pending"
          ? { label: "Checks are running", tone: "wait" }
          : null;
  const review =
    props.reviewDecision === "approved"
      ? "Approved"
      : props.reviewDecision === "changes_requested"
        ? "Changes requested"
        : props.reviewDecision === "review_required"
          ? "Waiting for review"
          : null;
  return (
    <header className="pr-page-head">
      <p className="pr-page-kicker">
        <span className="pr-state" data-state={props.state} />
        <span className="pr-page-status">{props.stateLabel}</span>
        <button
          type="button"
          className="pr-page-link"
          title="Open this pull request in your browser"
          onClick={() => {
            void openLink(props.url).catch(() => undefined);
          }}
        >
          #{props.number}
          <ExternalLinkIcon aria-hidden="true" size={11} />
        </button>
        {props.author ? <span>by @{props.author}</span> : null}
        {updated ? (
          <span>
            · updated {updated.value}
            {updated.suffix ? ` ${updated.suffix}` : ""}
          </span>
        ) : null}
      </p>
      <h2 className="pr-page-title">{props.title}</h2>
      <div className="pr-page-flow" title="Changes from the right branch merge into the left one">
        {props.base && props.head ? (
          <>
            <span className="pr-page-ref">{props.base}</span>
            <ArrowLeft aria-hidden="true" size={12} />
            <span className="pr-page-ref">{props.head}</span>
          </>
        ) : (
          <span className="pr-page-ref">{props.branchFallback}</span>
        )}
      </div>
      <div className="pr-page-facts">
        {props.changedFiles !== undefined ? (
          <span className="pr-page-fact">
            {props.changedFiles} {props.changedFiles === 1 ? "file" : "files"}
            <span className="cd-diff-add">+{props.additions ?? 0}</span>
            <span className="cd-diff-del">−{props.deletions ?? 0}</span>
          </span>
        ) : null}
        {checks ? (
          <span className="pr-page-fact" data-tone={checks.tone}>
            <CheckCircle2 aria-hidden="true" size={12} />
            {checks.label}
          </span>
        ) : null}
        {review ? <span className="pr-page-fact">{review}</span> : null}
        {props.conflicting ? (
          <span className="pr-page-fact" data-tone="bad">
            Has merge conflicts
          </span>
        ) : null}
        <button
          type="button"
          className="pr-page-copy"
          title="Copy the command that checks this pull request out in a terminal"
          onClick={() => {
            void navigator.clipboard
              .writeText(command)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              })
              .catch(() => undefined);
          }}
        >
          <code>{command}</code>
          {copied ? (
            <span className="pr-page-copied">Copied</span>
          ) : (
            <CopyIcon aria-hidden="true" size={12} />
          )}
        </button>
      </div>
    </header>
  );
}
