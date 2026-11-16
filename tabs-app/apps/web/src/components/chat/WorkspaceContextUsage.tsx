import { Minimize2Icon } from "lucide-react";

import { formatContextWindowTokens, type ContextWindowSnapshot } from "~/lib/contextWindow";
import { formatContextWindowCompactionMessage } from "./ContextWindowMeter.logic";

/** How full this conversation's context window is, with Compact, at the top of the Agents pane. */
export function WorkspaceContextUsage({
  context,
  onCompact,
  compactDisabled,
  compactDisabledReason,
}: {
  readonly context: ContextWindowSnapshot | null | undefined;
  readonly onCompact?: (() => void) | undefined;
  readonly compactDisabled?: boolean | undefined;
  readonly compactDisabledReason?: string | null | undefined;
}) {
  const percent = Math.max(0, Math.min(100, context?.usedPercentage ?? 0));
  const reported = context !== null && context !== undefined;
  return (
    <section role="group" aria-label="Context window" className="space-y-1.5 pb-3">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">Context</span>
        <span className="flex items-baseline gap-2 tabular-nums text-muted-foreground">
          {reported
            ? `${Math.round(percent)}% · ${formatContextWindowTokens(context.usedTokens)}${
                context.maxTokens ? ` / ${formatContextWindowTokens(context.maxTokens)}` : ""
              }`
            : "Not reported"}
          {onCompact ? (
            <button
              type="button"
              disabled={compactDisabled}
              title={compactDisabled ? (compactDisabledReason ?? undefined) : "Compact the context"}
              onClick={onCompact}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 disabled:no-underline"
            >
              <Minimize2Icon aria-hidden="true" className="size-3" />
              Compact
            </button>
          ) : null}
        </span>
      </div>
      {reported ? (
        <div
          role="progressbar"
          aria-label="Context used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          className="h-1 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-foreground/70" style={{ width: `${percent}%` }} />
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          This provider does not report context use for this thread.
        </p>
      )}
      {reported && (
        <p className="text-[11px] text-muted-foreground">
          {formatContextWindowCompactionMessage(null, context.autoCompactThreshold)}
        </p>
      )}
    </section>
  );
}
