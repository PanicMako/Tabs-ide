import { useState, useMemo } from "react";
import type { EnvironmentId, GitPullRequestReviewThread, ThreadId } from "@tabs/contracts";
import type { Thread } from "../../types";
import { Bot, ExternalLink, Link2, Unlink, Wrench } from "lucide-react";
import { Button } from "../ui/button";
import { Select } from "./gitPrimitives";
import { findThreadsForPullRequest } from "@tabs/shared/threadPullRequests";

export function formatReviewFixPrompt(
  pr: { number: number; title: string },
  reviewThreads: ReadonlyArray<GitPullRequestReviewThread>,
): string {
  const unresolved = reviewThreads.filter((t) => !t.resolved);
  if (unresolved.length === 0) {
    return `Please review the code changes for pull request #${pr.number} (${pr.title}) and make sure all tests pass.`;
  }

  let prompt = `Please address the following ${unresolved.length} review comment(s) on pull request #${pr.number} ("${pr.title}"):\n\n`;

  unresolved.forEach((thread, index) => {
    const firstComment = thread.comments[0]?.body ?? "(no comment text)";
    const author = thread.comments[0]?.author?.login
      ? `@${thread.comments[0].author.login}`
      : "Reviewer";
    prompt += `### ${index + 1}. ${thread.path} (line ${thread.line})\n`;
    prompt += `**${author}**: ${firstComment}\n\n`;
  });

  prompt +=
    "Please inspect the codebase, fix the issues described in each comment, and run the verification tests.";
  return prompt;
}

export function PullRequestThreadIntegration({
  pr,
  reviewThreads = [],
  threads,
  environmentId,
  onOpenThread,
  onLinkThread,
  onUnlinkThread,
  onCreateFixThread,
}: {
  pr: {
    readonly number: number;
    readonly title: string;
    readonly url: string;
    readonly provider?: string | undefined;
    readonly repository?: string | undefined;
  };
  reviewThreads?: ReadonlyArray<GitPullRequestReviewThread> | undefined;
  threads: ReadonlyArray<Thread>;
  environmentId?: EnvironmentId | string | null | undefined;
  onOpenThread: (thread: Thread) => void;
  onLinkThread: (
    threadId: ThreadId,
    threadEnvId?: EnvironmentId | null | undefined,
  ) => Promise<void>;
  onUnlinkThread: (
    threadId: ThreadId,
    threadEnvId?: EnvironmentId | null | undefined,
  ) => Promise<void>;
  onCreateFixThread: (prompt: string) => void;
}) {
  const [isLinking, setIsLinking] = useState(false);
  const [selectedThreadToLink, setSelectedThreadToLink] = useState<string>("");

  const linkedThreads = useMemo(() => {
    return findThreadsForPullRequest(threads, {
      number: pr.number,
      url: pr.url,
      repository: pr.repository,
    }).filter((t) => !environmentId || t.environmentId === environmentId);
  }, [threads, pr, environmentId]);

  const unlinkedThreads = useMemo(() => {
    const linkedIds = new Set(linkedThreads.map((t) => t.id));
    return threads.filter(
      (t) => (!environmentId || t.environmentId === environmentId) && !linkedIds.has(t.id),
    );
  }, [threads, linkedThreads, environmentId]);

  const unresolvedReviewCount = useMemo(
    () => reviewThreads.filter((t) => !t.resolved).length,
    [reviewThreads],
  );

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedThreadToLink) return;
    const target = unlinkedThreads.find((t) => t.id === selectedThreadToLink);
    if (!target) return;
    setIsLinking(true);
    try {
      await onLinkThread(target.id, target.environmentId);
      setSelectedThreadToLink("");
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 space-y-3">
      {/* Header with counts and shortcut action */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground text-xs">
          <Bot className="size-3.5 text-foreground" />
          <span>Linked Agent Threads ({linkedThreads.length})</span>
        </div>

        {unresolvedReviewCount > 0 ? (
          <Button
            size="sm"
            variant="default"
            className="h-7 px-2.5 text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => {
              const prompt = formatReviewFixPrompt(pr, reviewThreads);
              onCreateFixThread(prompt);
            }}
          >
            <Wrench className="size-3.5" />
            <span>Fix {unresolvedReviewCount} comments with Agent</span>
          </Button>
        ) : null}
      </div>

      {/* Linked Threads list */}
      {linkedThreads.length > 0 ? (
        <div className="space-y-1.5">
          {linkedThreads.map((thread) => (
            <div
              key={thread.id}
              className="flex items-center justify-between gap-2 p-2 rounded-md bg-card border border-border/60 hover:border-primary/40 transition-all text-xs"
            >
              <div className="min-w-0 flex-1 truncate">
                <span className="font-medium text-foreground">{thread.title}</span>
                {thread.branch && (
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                    #{thread.branch}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs gap-1"
                  onClick={() => onOpenThread(thread)}
                >
                  <ExternalLink className="size-3" />
                  <span>Open</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Unlink thread ${thread.title}`}
                  className="h-6 px-1.5 text-muted-foreground hover:text-destructive text-xs"
                  onClick={() => void onUnlinkThread(thread.id, thread.environmentId)}
                >
                  <Unlink className="size-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No agent threads linked to this pull request yet.
        </p>
      )}

      {/* Link Thread form */}
      {unlinkedThreads.length > 0 ? (
        <form onSubmit={handleLinkSubmit} className="flex items-center gap-1.5 pt-1">
          <div className="min-w-0 flex-1">
            <Select
              value={selectedThreadToLink}
              onChange={(e) => setSelectedThreadToLink(e.target.value)}
              disabled={isLinking}
              className="h-7 w-full rounded-md border-border bg-background px-2.5 py-1 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Link another agent thread…</option>
              {unlinkedThreads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} {t.branch ? `(#${t.branch})` : ""}
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            className="h-7 text-xs px-2 gap-1"
            disabled={!selectedThreadToLink || isLinking}
          >
            <Link2 className="size-3" />
            <span>Link</span>
          </Button>
        </form>
      ) : null}
    </div>
  );
}
