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
  return (
    <section role="group" aria-label="Context window" className="space-y-2 pb-3">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">Context window</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {context ? `${Math.round(percent)}% used` : "Not reported"}
        </span>
      </div>
      {context ? (
        <>
          <div
            role="progressbar"
            aria-label="Context used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-foreground/70"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-[11px] tabular-nums text-muted-foreground">
            {formatContextWindowTokens(context.usedTokens)}
            {context.maxTokens
              ? ` of ${formatContextWindowTokens(context.maxTokens)} tokens`
              : " tokens"}
            {" · "}
            {formatContextWindowCompactionMessage(null, context.autoCompactThreshold)}
          </p>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          This provider does not report context use for this thread.
        </p>
      )}
      {onCompact ? (
        <button
          type="button"
          disabled={compactDisabled}
          title={compactDisabled ? (compactDisabledReason ?? undefined) : "Compact the context"}
          onClick={onCompact}
          className="surface-control flex h-8 w-full items-center justify-center gap-2 rounded-lg px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
        >
          <Minimize2Icon aria-hidden="true" className="size-3.5" />
          Compact context
        </button>
      ) : null}
    </section>
  );
}
