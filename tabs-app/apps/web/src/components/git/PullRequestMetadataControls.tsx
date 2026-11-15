import type { PullRequestRef } from "@tabs/contracts";
import type { ReactElement } from "react";
import { PullRequestReactionBar } from "./PullRequestReactionBar";
import { useId, useState } from "react";
import type {
  GitPullRequestActor,
  GitPullRequestReview,
  GitPullRequestComment,
  GitPullRequestAction,
} from "@tabs/contracts";
import { User, Tag, Check, X, AlertCircle } from "lucide-react";
import { AssistantBubbleIcon } from "../AssistantBubbleIcon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import ChatMarkdown from "../ChatMarkdown";

export function PullRequestReviewersSection({
  reviewers,
  reviews = [],
  supportsAction,
  onAddReviewer,
  onRemoveReviewer,
  isPending,
  isOpen = true,
  suggestions,
  onRequestSuggestions,
}: {
  reviewers: ReadonlyArray<GitPullRequestActor>;
  reviews?: ReadonlyArray<GitPullRequestReview>;
  supportsAction: (action: GitPullRequestAction) => boolean;
  onAddReviewer: (login: string) => Promise<boolean | void>;
  onRemoveReviewer: (idOrLogin: string) => Promise<boolean | void>;
  isPending: boolean;
  isOpen?: boolean;
  /** Logins the host offers as reviewers; typing is never limited to them. */
  suggestions?: ReadonlyArray<string> | undefined;
  /** Asked once the field is first focused, so the host is only read when somebody adds one. */
  onRequestSuggestions?: (() => void) | undefined;
}) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const listId = useId();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = input.trim().replace(/^@/, "");
    if (!clean) return;
    setSubmitting(true);
    try {
      const ok = await onAddReviewer(clean);
      if (ok !== false) {
        setInput("");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Reviewers ({reviewers.length})
        </span>
      </div>

      {reviewers.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Reviewers list">
          {reviewers.map((reviewer) => {
            // Find latest review from this reviewer if available
            const matchingReview = [...reviews]
              .reverse()
              .find((r) => r.author?.login?.toLowerCase() === reviewer.login.toLowerCase());
            const reviewState = matchingReview?.state?.toUpperCase();

            let stateBadge = null;
            if (reviewState === "APPROVED") {
              stateBadge = (
                <span
                  className="inline-flex items-center text-emerald-600 dark:text-emerald-400 text-[10px]"
                  title="Approved"
                >
                  <Check className="size-3" />
                </span>
              );
            } else if (reviewState === "CHANGES_REQUESTED") {
              stateBadge = (
                <span
                  className="inline-flex items-center text-red-600 dark:text-red-400 text-[10px]"
                  title="Changes requested"
                >
                  <AlertCircle className="size-3" />
                </span>
              );
            } else if (reviewState === "COMMENTED") {
              stateBadge = (
                <span
                  className="inline-flex items-center text-muted-foreground text-[10px]"
                  title="Commented"
                >
                  <AssistantBubbleIcon className="size-3" />
                </span>
              );
            }

            return (
              <span
                key={reviewer.login}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-muted/30 px-2 py-1 text-xs font-medium text-foreground"
              >
                <span className="size-4 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-foreground">
                  {reviewer.login.slice(0, 1).toUpperCase()}
                </span>
                <span>@{reviewer.login}</span>
                {stateBadge}
                {isOpen && supportsAction("remove_reviewer") ? (
                  <button
                    type="button"
                    disabled={isPending || submitting}
                    aria-label={`Remove reviewer ${reviewer.login}`}
                    className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                    onClick={() => void onRemoveReviewer(reviewer.id ?? reviewer.login)}
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No reviewers requested yet.</p>
      )}

      {isOpen && supportsAction("add_reviewer") ? (
        <form onSubmit={handleSubmit} className="flex gap-1.5 pt-1">
          <div className="relative flex-1 min-w-0">
            <User className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground z-10" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Add reviewer by username…"
              aria-label="Reviewer username"
              list={suggestions && suggestions.length > 0 ? listId : undefined}
              onFocus={() => onRequestSuggestions?.()}
              className="w-full rounded-md border border-border bg-background pl-8 pr-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={isPending || submitting}
            />
            {suggestions && suggestions.length > 0 ? (
              <datalist id={listId}>
                {suggestions.map((login) => (
                  <option key={login} value={login} />
                ))}
              </datalist>
            ) : null}
          </div>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            className="h-7 text-xs px-2.5"
            disabled={!input.trim() || isPending || submitting}
          >
            Add
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function PullRequestLabelsSection({
  labels,
  supportsAction,
  onAddLabel,
  onRemoveLabel,
  isPending,
  isOpen = true,
  suggestions,
  onRequestSuggestions,
}: {
  labels: ReadonlyArray<{
    readonly name: string;
    readonly color?: string | null | undefined;
    readonly description?: string | null | undefined;
  }>;
  supportsAction: (action: GitPullRequestAction) => boolean;
  onAddLabel: (name: string) => Promise<boolean | void>;
  onRemoveLabel: (name: string) => Promise<boolean | void>;
  isPending: boolean;
  isOpen?: boolean;
  /** Labels the repository defines that this pull request does not wear yet. */
  suggestions?: ReadonlyArray<string> | undefined;
  /** Asked once the field is first focused, so the host is only read when somebody adds one. */
  onRequestSuggestions?: (() => void) | undefined;
}) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const listId = useId();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = input.trim();
    if (!clean) return;
    setSubmitting(true);
    try {
      const ok = await onAddLabel(clean);
      if (ok !== false) {
        setInput("");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Labels ({labels.length})
        </span>
      </div>

      {labels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Labels list">
          {labels.map((label) => (
            <span
              key={label.name}
              className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-foreground"
              title={label.description ?? label.name}
            >
              {label.color ? (
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{ backgroundColor: `#${label.color.replace(/^#/, "")}` }}
                />
              ) : null}
              <span>{label.name}</span>
              {isOpen && supportsAction("remove_label") ? (
                <button
                  type="button"
                  disabled={isPending || submitting}
                  aria-label={`Remove label ${label.name}`}
                  className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                  onClick={() => void onRemoveLabel(label.name)}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No labels assigned.</p>
      )}

      {isOpen && supportsAction("add_label") ? (
        <form onSubmit={handleSubmit} className="flex gap-1.5 pt-1">
          <div className="relative flex-1 min-w-0">
            <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground z-10" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Add label name…"
              aria-label="Label name"
              list={suggestions && suggestions.length > 0 ? listId : undefined}
              onFocus={() => onRequestSuggestions?.()}
              className="w-full rounded-md border border-border bg-background pl-8 pr-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={isPending || submitting}
            />
            {suggestions && suggestions.length > 0 ? (
              <datalist id={listId}>
                {suggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            ) : null}
          </div>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            className="h-7 text-xs px-2.5"
            disabled={!input.trim() || isPending || submitting}
          >
            Add
          </Button>
        </form>
      ) : null}
    </div>
  );
}

type ChatMarkdownDecorateLink = (href: string, link: ReactElement) => ReactElement | null;

function EditableComment({
  comment,
  cwd,
  onEdit,
  reactionRef,
  onReactionSaved,
  decorateLink,
}: {
  comment: GitPullRequestComment;
  cwd?: string | null | undefined;
  onEdit?: ((comment: GitPullRequestComment, body: string) => Promise<boolean | void>) | undefined;
  reactionRef?: PullRequestRef | null | undefined;
  onReactionSaved?: (() => void) | undefined;
  decorateLink?: ChatMarkdownDecorateLink | undefined;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const body = draft?.trim() ?? "";
    if (!onEdit || body.length === 0) return;
    setSaving(true);
    try {
      const ok = await onEdit(comment, body);
      if (ok !== false) setDraft(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border/70 bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="size-5 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-foreground">
            {comment.author?.login?.slice(0, 1).toUpperCase() ?? "?"}
          </span>
          <span className="text-xs font-semibold text-foreground">
            @{comment.author?.login ?? "Unknown"}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {new Date(comment.createdAt).toLocaleString()}
          </span>
        </div>
        {onEdit && draft === null ? (
          <button
            type="button"
            aria-label={`Edit comment by ${comment.author?.login ?? "unknown"}`}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setDraft(comment.body)}
          >
            Edit
          </button>
        ) : null}
      </div>
      {draft === null ? (
        <div className="pl-7">
          <div className="text-xs text-foreground/90">
            <ChatMarkdown
              text={comment.body}
              cwd={cwd ?? undefined}
              decorateLink={decorateLink}
            />
          </div>
          {comment.reactions !== undefined ? (
            <PullRequestReactionBar
              className="mt-2"
              reactions={comment.reactions}
              canReact
              subjectId={comment.id}
              reference={reactionRef ?? null}
              onSaved={onReactionSaved ?? (() => undefined)}
            />
          ) : null}
        </div>
      ) : (
        <div className="space-y-2 pl-7">
          <textarea
            aria-label="Edit comment"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            disabled={saving}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              className="h-7 text-xs px-2.5"
              disabled={saving || draft.trim().length === 0 || draft === comment.body}
              onClick={() => void save()}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs px-2.5"
              disabled={saving}
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PullRequestActivityView({
  reviews = [],
  comments = [],
  cwd,
  onEditComment,
  reactionRef,
  onReactionSaved,
  decorateLink,
}: {
  /** Lets pull request links in the text show a hover card. */
  decorateLink?: ChatMarkdownDecorateLink | undefined;
  /** Where reactions are saved; absent leaves them read-only. */
  reactionRef?: PullRequestRef | null | undefined;
  onReactionSaved?: (() => void) | undefined;
  reviews?: ReadonlyArray<GitPullRequestReview>;
  comments?: ReadonlyArray<GitPullRequestComment>;
  cwd?: string | null;
  /** Present when this host can rewrite a conversation comment; the host refuses other people's. */
  onEditComment?:
    | ((comment: GitPullRequestComment, body: string) => Promise<boolean | void>)
    | undefined;
}) {
  const hasContent = reviews.length > 0 || comments.length > 0;

  if (!hasContent) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        No formal reviews or conversation comments on this pull request yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Formal Reviews */}
      {reviews.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Formal Reviews ({reviews.length})
          </h4>
          <div className="space-y-2">
            {reviews.map((review) => {
              const state = review.state.toUpperCase();
              let badgeVariant: "default" | "secondary" | "destructive" | "outline" = "outline";
              let badgeLabel = review.state.replaceAll("_", " ");
              let badgeClass = "";

              if (state === "APPROVED") {
                badgeVariant = "default";
                badgeClass =
                  "bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
              } else if (state === "CHANGES_REQUESTED") {
                badgeVariant = "destructive";
              } else if (state === "COMMENTED") {
                badgeVariant = "secondary";
              }

              return (
                <div
                  key={review.id}
                  className="rounded-lg border border-border/70 bg-card p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="size-5 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-foreground">
                        {review.author?.login?.slice(0, 1).toUpperCase() ?? "?"}
                      </span>
                      <span className="text-xs font-semibold text-foreground">
                        @{review.author?.login ?? "Unknown"}
                      </span>
                      {review.submittedAt ? (
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(review.submittedAt).toLocaleString()}
                        </span>
                      ) : null}
                    </div>
                    <Badge variant={badgeVariant} className={`text-xs capitalize ${badgeClass}`}>
                      {badgeLabel}
                    </Badge>
                  </div>
                  {review.body ? (
                    <div className="text-xs text-foreground/90 pl-7">
                      <ChatMarkdown text={review.body} cwd={cwd ?? undefined} decorateLink={decorateLink} />
                    </div>
                  ) : null}
                  {review.reactions !== undefined ? (
                    <PullRequestReactionBar
                      className="pl-7"
                      reactions={review.reactions}
                      canReact
                      subjectId={review.id}
                      reference={reactionRef ?? null}
                      onSaved={onReactionSaved ?? (() => undefined)}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Conversation Comments */}
      {comments.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Conversation ({comments.length})
          </h4>
          <div className="space-y-2">
            {comments.map((comment) => (
              <EditableComment
                key={comment.id}
                comment={comment}
                cwd={cwd}
                onEdit={onEditComment}
                reactionRef={reactionRef}
                onReactionSaved={onReactionSaved}
                decorateLink={decorateLink}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
