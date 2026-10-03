import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CornerDownRight,
  MessageSquare,
  Smile,
  Undo2,
  Wrench,
} from "lucide-react";
import { useState, useRef, type KeyboardEvent } from "react";
import type { GitPullRequestAction, GitPullRequestReviewThread } from "@tabs/contracts";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import ChatMarkdown from "../ChatMarkdown";

export const REACTION_OPTIONS = [
  ["THUMBS_UP", "👍"],
  ["THUMBS_DOWN", "👎"],
  ["LAUGH", "😄"],
  ["HOORAY", "🎉"],
  ["CONFUSED", "😕"],
  ["HEART", "❤️"],
  ["ROCKET", "🚀"],
  ["EYES", "👀"],
] as const;

export interface PullRequestReviewThreadCardProps {
  readonly thread: GitPullRequestReviewThread;
  readonly prNumber: number;
  readonly cwd: string | null;
  readonly supportsAction: (action: GitPullRequestAction) => boolean;
  readonly onMutate: (
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
  ) => Promise<boolean>;
  readonly onFixInThread?: ((thread: GitPullRequestReviewThread) => void) | undefined;
  readonly isPending?: boolean;
}

export function PullRequestReviewThreadCard({
  thread,
  prNumber,
  cwd,
  supportsAction,
  onMutate,
  onFixInThread,
  isPending = false,
}: PullRequestReviewThreadCardProps) {
  const [isExpanded, setIsExpanded] = useState(!thread.resolved);
  const [isReplying, setIsReplying] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [showReactionPickerForCommentId, setShowReactionPickerForCommentId] = useState<
    string | null
  >(null);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);

  const comments = thread.comments ?? [];
  const commentCount = comments.length;
  const isResolved = thread.resolved ?? false;

  const handleReplyKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setIsReplying(false);
      setReplyBody("");
    } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submitReply();
    }
  };

  const submitReply = async () => {
    const trimmed = replyBody.trim();
    if (!trimmed || isPending) return;
    const ok = await onMutate("reply_to_thread", trimmed, undefined, { threadId: thread.id });
    if (ok) {
      setReplyBody("");
      setIsReplying(false);
    }
  };

  const toggleResolution = async () => {
    if (isPending) return;
    const action = isResolved ? "unresolve_thread" : "resolve_thread";
    await onMutate(action, undefined, undefined, { threadId: thread.id });
  };

  return (
    <article
      className={`my-1.5 overflow-hidden rounded-lg border text-xs shadow-sm transition-all ${
        isResolved
          ? "border-border/50 bg-muted/20 opacity-90"
          : "border-primary/30 bg-background/95 ring-1 ring-primary/10"
      }`}
      aria-label={`Review thread on line ${thread.line} (${isResolved ? "resolved" : "open"})`}
    >
      {/* Thread Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 bg-muted/30 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 font-medium text-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((prev) => !prev)}
          >
            {isExpanded ? (
              <ChevronDown className="size-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3.5 text-muted-foreground" />
            )}
            {isResolved ? (
              <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-500" />
            ) : (
              <Circle className="size-3.5 text-blue-500" />
            )}
            <span>{isResolved ? "Resolved" : "Open"}</span>
          </button>
          <span className="text-[11px] text-muted-foreground">
            · {commentCount} {commentCount === 1 ? "comment" : "comments"}
          </span>
          {thread.outdated ? (
            <Badge
              variant="outline"
              className="border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400"
            >
              Outdated
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          {onFixInThread ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px] text-foreground hover:bg-primary/10"
              title="Fix in an agent thread"
              disabled={isPending}
              onClick={() => onFixInThread(thread)}
            >
              <Wrench className="size-3 shrink-0" />
              <span>Fix in thread</span>
            </Button>
          ) : null}

          {supportsAction("resolve_thread") ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`h-6 gap-1 px-1.5 text-[11px] ${
                isResolved
                  ? "text-muted-foreground hover:text-foreground"
                  : "text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
              }`}
              disabled={isPending}
              onClick={() => void toggleResolution()}
            >
              {isResolved ? (
                <>
                  <Undo2 className="size-3" />
                  Unresolve
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-3" />
                  Resolve
                </>
              )}
            </Button>
          ) : null}

          {supportsAction("reply_to_thread") && isExpanded ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px]"
              disabled={isPending}
              onClick={() => {
                setIsReplying((prev) => !prev);
                setTimeout(() => replyInputRef.current?.focus(), 50);
              }}
            >
              <CornerDownRight className="size-3" />
              Reply
            </Button>
          ) : null}
        </div>
      </div>

      {/* Thread Body (if expanded) */}
      {isExpanded ? (
        <div className="space-y-3 p-3">
          {comments.map((comment, index) => {
            const authorLogin = comment.author?.login ?? "Unknown author";
            const dateLabel = comment.createdAt ? new Date(comment.createdAt).toLocaleString() : "";

            return (
              <div
                key={comment.id}
                className={`space-y-1.5 ${index > 0 ? "border-t border-border/40 pt-2.5" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {comment.author?.avatarUrl ? (
                      <img src={comment.author.avatarUrl} alt="" className="size-4 rounded-full" />
                    ) : null}
                    <span className="font-semibold text-foreground">@{authorLogin}</span>
                    {dateLabel ? (
                      <time className="text-[10px] text-muted-foreground" title={dateLabel}>
                        {dateLabel}
                      </time>
                    ) : null}
                  </div>

                  {supportsAction("add_reaction") ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                      title="Add reaction"
                      disabled={isPending}
                      onClick={() =>
                        setShowReactionPickerForCommentId((curr) =>
                          curr === comment.id ? null : comment.id,
                        )
                      }
                    >
                      <Smile className="size-3" />
                    </Button>
                  ) : null}
                </div>

                {/* Reaction Picker Dropdown */}
                {showReactionPickerForCommentId === comment.id ? (
                  <div className="flex flex-wrap gap-1 rounded-md border border-border/60 bg-muted/40 p-1">
                    {REACTION_OPTIONS.map(([content, emoji]) => {
                      const existingReaction = comment.reactions?.find(
                        (r) => r.content === content,
                      );
                      return (
                        <button
                          key={content}
                          type="button"
                          className={`rounded px-1.5 py-0.5 text-xs hover:bg-background ${
                            existingReaction?.viewerHasReacted
                              ? "bg-primary/10 ring-1 ring-primary/40"
                              : ""
                          }`}
                          disabled={isPending}
                          onClick={() => {
                            setShowReactionPickerForCommentId(null);
                            void onMutate(
                              existingReaction?.viewerHasReacted
                                ? "remove_reaction"
                                : "add_reaction",
                              undefined,
                              undefined,
                              { subjectId: comment.id, reaction: content },
                            );
                          }}
                        >
                          {emoji}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {/* Markdown Content */}
                <div className="text-foreground/90">
                  <ChatMarkdown text={comment.body} cwd={cwd ?? undefined} />
                </div>

                {/* Reactions Summary */}
                {comment.reactions && comment.reactions.length > 0 ? (
                  <div className="flex flex-wrap gap-1 pt-1" aria-label="Reactions">
                    {comment.reactions.map((reaction) => {
                      const emojiMatch = REACTION_OPTIONS.find(([c]) => c === reaction.content);
                      const emoji = emojiMatch ? emojiMatch[1] : reaction.content;
                      return (
                        <button
                          key={reaction.content}
                          type="button"
                          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                            reaction.viewerHasReacted
                              ? "border-primary/40 bg-primary/10 text-foreground"
                              : "border-border/60 bg-background text-muted-foreground hover:bg-muted/40"
                          }`}
                          disabled={isPending}
                          onClick={() =>
                            void onMutate(
                              reaction.viewerHasReacted ? "remove_reaction" : "add_reaction",
                              undefined,
                              undefined,
                              { subjectId: comment.id, reaction: reaction.content as any },
                            )
                          }
                        >
                          <span>{emoji}</span>
                          <span>{reaction.count}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}

          {/* In-place reply box */}
          {isReplying ? (
            <form
              className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                void submitReply();
              }}
            >
              <textarea
                ref={replyInputRef}
                autoFocus
                required
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                onKeyDown={handleReplyKeyDown}
                placeholder="Write a reply… (⌘+Enter to send, Esc to cancel)"
                className="min-h-16 w-full rounded-md border border-border bg-background p-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">⌘+Enter to submit</span>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={isPending}
                    onClick={() => {
                      setIsReplying(false);
                      setReplyBody("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!replyBody.trim() || isPending}
                  >
                    Reply
                  </Button>
                </div>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
