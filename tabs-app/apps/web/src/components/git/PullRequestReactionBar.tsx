import type {
  PullRequestReaction,
  PullRequestReactionContent,
  PullRequestRef,
} from "@tabs/contracts";
import { SmilePlusIcon } from "lucide-react";
import { useState } from "react";

import { useGitApi } from "./gitApiContext";
import {
  applyPendingPullRequestReactions,
  PULL_REQUEST_REACTION_ORDER,
  pullRequestReactionEmoji,
  pullRequestReactionName,
  pullRequestReactionTooltip,
  pullRequestReactionsSignature,
} from "./pullRequestReactions";
import { cn } from "../../lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// Neutral pills: a pressed one is told apart by a stronger surface, not an accent outline.
const PILL =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border/70 px-2 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const NO_PENDING: ReadonlyMap<PullRequestReactionContent, boolean> = new Map();

/**
 * Reactions on a pull request's description, a comment or a review: the counts as pills, a
 * picker for the other seven, and a press that shows at once and is put back if the host
 * refuses it. Ported from T3's reaction bar.
 */
export function PullRequestReactionBar({
  reactions,
  canReact,
  subjectId,
  reference,
  onSaved,
  className,
}: {
  reactions: ReadonlyArray<PullRequestReaction>;
  canReact: boolean;
  /** Omit to react to the pull request's own description. */
  subjectId?: string | undefined;
  /** Null where the pull request cannot be addressed, which leaves the counts read-only. */
  reference: PullRequestRef | null;
  onSaved: () => void;
  className?: string | undefined;
}) {
  const api = useGitApi();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<{
    signature: string;
    values: ReadonlyMap<PullRequestReactionContent, boolean>;
  }>({ signature: "", values: NO_PENDING });

  const signature = pullRequestReactionsSignature(reactions);
  const values = pending.signature === signature ? pending.values : NO_PENDING;
  const shown = applyPendingPullRequestReactions(reactions, values);
  const interactive = canReact && api !== null && reference !== null;

  const toggle = async (content: PullRequestReactionContent, reacted: boolean) => {
    if (api === null || reference === null) return;
    setPending({ signature, values: new Map([...values, [content, reacted]]) });
    try {
      await api.pullRequests.setReaction({
        ...reference,
        ...(subjectId === undefined ? {} : { subjectId }),
        content,
        reacted,
      });
      onSaved();
    } catch {
      setPending((current) => {
        const next = new Map(current.values);
        next.delete(content);
        return { signature: current.signature, values: next };
      });
      toastManager.add({ type: "error", title: "The reaction could not be saved" });
    }
  };

  if (shown.length === 0 && !interactive) return null;

  return (
    <div className={cn("flex min-w-0 max-w-full flex-wrap items-center gap-1", className)}>
      {shown.map((reaction) => (
        <Tooltip key={reaction.content}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-pressed={reaction.viewerHasReacted}
                aria-label={`${pullRequestReactionName(reaction.content)}, ${reaction.count}`}
                disabled={!interactive}
                className={cn(
                  PILL,
                  reaction.viewerHasReacted
                    ? "bg-muted text-foreground"
                    : "bg-transparent text-muted-foreground",
                  interactive ? "hover:bg-muted" : "cursor-default",
                )}
                onClick={() => void toggle(reaction.content, !reaction.viewerHasReacted)}
              />
            }
          >
            <span aria-hidden>{pullRequestReactionEmoji(reaction.content)}</span>
            <span className="tabular-nums">{reaction.count}</span>
          </TooltipTrigger>
          <TooltipPopup side="top">{pullRequestReactionTooltip(reaction)}</TooltipPopup>
        </Tooltip>
      ))}

      {interactive ? (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label="Add a reaction"
                className={cn(PILL, "px-1.5 text-muted-foreground hover:bg-muted")}
              />
            }
          >
            <SmilePlusIcon aria-hidden className="size-3.5" />
          </PopoverTrigger>
          <PopoverPopup align="start" side="top">
            <div className="flex items-center gap-0.5">
              {PULL_REQUEST_REACTION_ORDER.map((content) => {
                const reacted =
                  shown.find((reaction) => reaction.content === content)?.viewerHasReacted ?? false;
                return (
                  <button
                    key={content}
                    type="button"
                    aria-pressed={reacted}
                    aria-label={pullRequestReactionName(content)}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-md text-base outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      reacted && "bg-muted",
                    )}
                    onClick={() => {
                      setPickerOpen(false);
                      void toggle(content, !reacted);
                    }}
                  >
                    <span aria-hidden>{pullRequestReactionEmoji(content)}</span>
                  </button>
                );
              })}
            </div>
          </PopoverPopup>
        </Popover>
      ) : null}
    </div>
  );
}
