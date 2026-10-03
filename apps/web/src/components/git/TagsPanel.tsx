import type { GitHistoryCommit, GitPushAccess } from "@tabs/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  Rocket,
  Search,
  Tag,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { toGitUserFacingErrorMessage } from "../../lib/gitErrorMessages";
import { gitWorkflowRunsQueryOptions, invalidateGitQueries } from "../../lib/gitReactQuery";
import { useGitApi, useGitScopeKey } from "./gitApiContext";
import { toastManager } from "../ui/toast";
import { GitCheckingState } from "./GitCheckingState";
import { Button } from "../ui/button";
import { Card, InlineForm } from "./gitPrimitives";

/**
 * Production-grade CI status badge — compact, theme-aware badge pill.
 * Features a vivid semantic status icon paired with neutral font-mono status typography.
 */
function TagCiStatus({ cwd, tagName }: { cwd: string; tagName: string }) {
  const { data, isLoading, isError } = useQuery(gitWorkflowRunsQueryOptions(cwd, tagName, null));

  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono text-muted-foreground/50 bg-muted/30 border border-border/30 select-none">
        <Loader2 size={10} className="animate-spin text-muted-foreground/70 shrink-0" />
        <span>Checking…</span>
      </span>
    );
  }

  if (isError || !data || !data.hasWorkflows) return null;

  const latestRun = data.runs[0];
  if (!latestRun) return null;

  const isRunning =
    latestRun.status === "in_progress" ||
    latestRun.status === "queued" ||
    latestRun.status === "waiting";
  const isSuccess = latestRun.conclusion === "success";
  const isFailure =
    latestRun.conclusion === "failure" ||
    latestRun.conclusion === "cancelled" ||
    latestRun.conclusion === "timed_out";

  const statusLabel = isRunning
    ? "RUNNING"
    : isSuccess
      ? "PASSED"
      : isFailure
        ? "FAILED"
        : (latestRun.conclusion ?? latestRun.status ?? "UNKNOWN").toUpperCase();

  return (
    <a
      href={latestRun.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${latestRun.workflowName || latestRun.name} · ${latestRun.status} (${latestRun.conclusion ?? "running"})\nClick to view run on GitHub Actions`}
      className="group/ci inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold border bg-muted/40 border-border/50 text-foreground/80 hover:bg-muted/70 hover:border-border/80 hover:text-foreground transition-all duration-150 shadow-xs cursor-pointer select-none shrink-0"
    >
      {/* Vivid Semantic Icon */}
      {isRunning ? (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-sky-400" />
        </span>
      ) : isSuccess ? (
        <span className="flex items-center justify-center text-[var(--sem-emerald,#10b981)] shrink-0">
          <CheckCircle2 size={11} strokeWidth={2.3} />
        </span>
      ) : isFailure ? (
        <span className="flex items-center justify-center text-[var(--sem-red,#ef4444)] shrink-0">
          <XCircle size={11} strokeWidth={2.3} />
        </span>
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 shrink-0" />
      )}

      {/* Neutral Monospace Text */}
      <span className="tracking-wider">{statusLabel}</span>

      {/* Hover External Link Arrow */}
      <ExternalLink
        size={9}
        className="opacity-0 group-hover/ci:opacity-70 group-hover/ci:translate-x-0.5 transition-all duration-150 shrink-0 text-muted-foreground ml-0.5"
      />
    </a>
  );
}

import { useProjectGitState } from "../../state/scopedStateStore";

export function TagsPanel({
  cwd,
  commits,
  pushAccess = "unknown",
  onOpenDraftRelease,
}: {
  cwd: string;
  commits: ReadonlyArray<GitHistoryCommit>;
  pushAccess?: GitPushAccess | undefined;
  onOpenDraftRelease: () => void;
}) {
  const [gitState, setGitState] = useProjectGitState(useGitScopeKey());
  const form = gitState.tagForm;
  const setForm = useCallback(
    (f: boolean) => {
      setGitState({ tagForm: f });
    },
    [setGitState],
  );
  const [realTags, setRealTags] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(true);
  const searchQuery = gitState.tagSearch;
  const setSearchQuery = useCallback(
    (q: string) => {
      setGitState({ tagSearch: q });
    },
    [setGitState],
  );

  const api = useGitApi();
  const queryClient = useQueryClient();

  const pushTag = useCallback(
    async (tag: string) => {
      if (!api) return;
      try {
        await api.git.performRepositoryAction({
          cwd,
          operation: { action: "push_tag", remote: "origin", tag },
        });
        await invalidateGitQueries(queryClient);
        toastManager.add({ type: "success", title: `Pushed tag ${tag}` });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not push tag",
          description: toGitUserFacingErrorMessage(error),
        });
      }
    },
    [api, cwd, queryClient],
  );

  const fetchTags = useCallback(async () => {
    if (!api || !cwd) {
      setLoadingTags(false);
      return;
    }
    const foundTags = new Set<string>();

    try {
      const res = await api.git.listTags({ cwd });
      if (res?.tags) {
        for (const t of res.tags) {
          if (t.name) foundTags.add(t.name);
        }
      }
    } catch {
      // Fallback to commits refs if RPC fails
    }

    for (const c of commits) {
      for (const r of c.refs || []) {
        if (r.startsWith("tag: ")) {
          const tagName = r.slice(5).trim();
          if (tagName) foundTags.add(tagName);
        }
      }
    }

    const tagCommitIndex = new Map<string, number>();
    commits.forEach((c, idx) => {
      for (const r of c.refs || []) {
        if (r.startsWith("tag: ")) {
          const tagName = r.slice(5).trim();
          if (tagName && !tagCommitIndex.has(tagName)) {
            tagCommitIndex.set(tagName, idx);
          }
        }
      }
    });

    const sortedTags = Array.from(foundTags).sort((a, b) => {
      const idxA = tagCommitIndex.get(a) ?? Number.MAX_SAFE_INTEGER;
      const idxB = tagCommitIndex.get(b) ?? Number.MAX_SAFE_INTEGER;
      if (idxA !== idxB) return idxA - idxB;
      return b.localeCompare(a, undefined, { numeric: true });
    });

    setRealTags(sortedTags);
    setLoadingTags(false);
  }, [api, cwd, commits]);

  useEffect(() => {
    void fetchTags();
  }, [fetchTags]);

  const createTag = useCallback(
    async (name: string) => {
      if (!api) return;
      try {
        await api.git.createTag({ cwd, name });
        await invalidateGitQueries(queryClient);
        await fetchTags();
        setForm(false);
        toastManager.add({ type: "success", title: `Tag ${name} created` });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Create tag failed",
          description: toGitUserFacingErrorMessage(error),
        });
      }
    },
    [api, cwd, fetchTags, queryClient],
  );

  // Filter tags based on user search query
  const filteredTags = useMemo(() => {
    if (!searchQuery.trim()) return realTags;
    const q = searchQuery.toLowerCase().trim();
    return realTags.filter((tagName) => {
      if (tagName.toLowerCase().includes(q)) return true;
      const commit = commits.find((c) =>
        c.refs?.some((r) => r === `tag: ${tagName}` || r.endsWith(`/${tagName}`)),
      );
      if (commit) {
        if (commit.shortSha.toLowerCase().includes(q)) return true;
        if (commit.subject.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [realTags, searchQuery, commits]);

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    toastManager.add({ type: "info", title: `Copied "${text}" to clipboard` });
  };

  return (
    <div className="space-y-3">
      {/* Top Controls Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card/60 p-3 rounded-xl border border-border/60">
        {/* Search Input */}
        <div className="relative flex-1 min-w-0">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground shrink-0 z-10"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${realTags.length} tag${realTags.length === 1 ? "" : "s"}…`}
            className="w-full bg-background/80 border border-border/60 rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 transition-all"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" onClick={() => setForm(true)} className="gap-1.5">
            <Plus size={13} />
            <span>Create tag</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenDraftRelease} className="gap-1.5">
            <Rocket size={13} className="text-muted-foreground" />
            <span>Draft release</span>
          </Button>
        </div>
      </div>

      {/* Create Tag Inline Form */}
      {form && (
        <Card className="p-3.5 border-border bg-muted/20">
          <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
            <Tag size={12} className="text-muted-foreground" />
            <span>Create new tag</span>
          </div>
          <InlineForm
            placeholder="v1.5.0"
            submitLabel="Create tag"
            className="mb-0"
            onSubmit={(name) => {
              void createTag(name);
            }}
            onCancel={() => setForm(false)}
          />
        </Card>
      )}

      {/* Main Content Area */}
      {loadingTags ? (
        <GitCheckingState message="Loading tags…" size={36} />
      ) : realTags.length === 0 ? (
        <Card className="p-8 text-center bg-card/40 border-dashed">
          <Tag className="mx-auto mb-2 text-muted-foreground/50" size={28} />
          <p className="text-sm font-medium text-foreground mb-1">No tags created yet</p>
          <p className="text-xs text-muted-foreground/70 mb-4 max-w-sm mx-auto">
            Tags mark specific release versions or milestones in your repository history.
          </p>
          <Button size="sm" onClick={() => setForm(true)}>
            Create your first tag
          </Button>
        </Card>
      ) : filteredTags.length === 0 ? (
        <Card className="p-6 text-center text-xs text-muted-foreground">
          No tags found matching &ldquo;{searchQuery}&rdquo;
        </Card>
      ) : (
        <Card className="divide-y divide-border/40 overflow-hidden border-border/60">
          {filteredTags.map((tagName) => {
            const commit = commits.find((c) =>
              c.refs?.some((r) => r === `tag: ${tagName}` || r.endsWith(`/${tagName}`)),
            );

            return (
              <div
                key={tagName}
                className="group/row flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-muted/30 transition-colors duration-150 min-h-[42px]"
              >
                {/* Left: Tag Badge & Optional Commit Info */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div
                    onClick={() => copyToClipboard(tagName)}
                    title="Click to copy tag name"
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/70 bg-muted/50 text-xs font-mono font-semibold text-foreground/90 shrink-0 cursor-pointer hover:bg-muted/80 transition-colors"
                  >
                    <Tag size={11} className="text-muted-foreground/60 shrink-0" />
                    <span>{tagName}</span>
                    <Copy
                      size={9}
                      className="opacity-0 group-hover/row:opacity-60 transition-opacity ml-0.5 text-muted-foreground"
                    />
                  </div>

                  {commit && (
                    <div className="hidden lg:flex items-center gap-2 min-w-0 overflow-hidden">
                      <span className="text-[11px] font-mono text-muted-foreground/60 bg-muted/30 px-1.5 py-0.5 rounded border border-border/40 shrink-0">
                        {commit.shortSha}
                      </span>
                      <span
                        className="text-xs text-muted-foreground/80 truncate font-sans"
                        title={commit.subject}
                      >
                        {commit.subject}
                      </span>
                    </div>
                  )}
                </div>

                {/* Right: CI Status & Action Buttons */}
                <div className="flex items-center gap-2 shrink-0 ml-auto">
                  <TagCiStatus cwd={cwd} tagName={tagName} />

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pushAccess === "read_only"}
                    title={
                      pushAccess === "read_only"
                        ? "Pushing tags is disabled for read-only remotes."
                        : `Push ${tagName} to origin`
                    }
                    className="opacity-0 group-hover/row:opacity-100 transition-opacity duration-150 h-6 px-2 text-[11px] shrink-0"
                    onClick={() => void pushTag(tagName)}
                  >
                    Push tag
                  </Button>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
