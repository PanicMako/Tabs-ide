import { cn } from "~/lib/utils";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { Minimize2Icon } from "lucide-react";
import { describeContextRoom, formatAutoCompactHint } from "./ContextWindowMeter.logic";

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

export interface ContextWindowMeterProps {
  usage: ContextWindowSnapshot;
  modelDisplayName?: string | null | undefined;
  onCompact?: (() => void) | undefined;
  compactDisabled?: boolean | undefined;
  compactDisabledReason?: string | null | undefined;
}

export function ContextWindowMeter(props: ContextWindowMeterProps) {
  const { usage, onCompact, compactDisabled = false, compactDisabledReason } = props;
  const usedPercentage = formatPercentage(usage.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (normalizedPercentage / 100) * circumference;
  const hasLimit = usage.maxTokens !== null && usedPercentage !== null;
  const room = describeContextRoom(usage.usedPercentage);
  const thresholdPercentage =
    hasLimit && usage.autoCompactThreshold && usage.maxTokens
      ? Math.max(0, Math.min(100, (usage.autoCompactThreshold / usage.maxTokens) * 100))
      : null;

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={onCompact ? 150 : 0}
        render={
          <button
            type="button"
            className="group inline-flex items-center justify-center rounded-full transition-opacity hover:opacity-85"
            aria-label={
              usage.maxTokens !== null && usedPercentage
                ? `Context window ${usedPercentage} used`
                : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used`
            }
          >
            <span className="relative flex h-6 w-6 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="-rotate-90 absolute inset-0 h-full w-full transform-gpu"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="color-mix(in oklab, var(--color-muted) 70%, transparent)"
                  strokeWidth="3"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="var(--color-muted-foreground)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
                />
              </svg>
              <span
                className={cn(
                  "relative flex h-[15px] w-[15px] items-center justify-center rounded-full bg-background text-[8px] font-medium",
                  "text-muted-foreground",
                )}
              >
                {usage.usedPercentage !== null
                  ? Math.round(usage.usedPercentage)
                  : formatContextWindowTokens(usage.usedTokens)}
              </span>
            </span>
          </button>
        }
      />
      <PopoverPopup tooltipStyle side="top" align="end" className="w-72 max-w-none px-3 py-2.5">
        <div className="space-y-1.5 leading-tight" data-context-window-card="true">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold tabular-nums text-foreground">
              {hasLimit
                ? `${usedPercentage} full`
                : `${formatContextWindowTokens(usage.usedTokens)} used`}
            </span>
            {hasLimit && (
              <span
                className={cn(
                  "text-[11px]",
                  room.level === "nearlyFull"
                    ? "text-destructive"
                    : room.level === "filling"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground",
                )}
              >
                {room.label}
              </span>
            )}
          </div>
          {hasLimit && (
            <div
              className="relative h-1 overflow-hidden rounded-full bg-foreground/10"
              role="meter"
              aria-label="Context window used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(normalizedPercentage)}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
                  room.level === "nearlyFull"
                    ? "bg-destructive"
                    : room.level === "filling"
                      ? "bg-amber-500"
                      : "bg-foreground/60",
                )}
                style={{ width: `${Math.max(2, normalizedPercentage)}%` }}
              />
              {thresholdPercentage !== null && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 w-px bg-foreground/40"
                  style={{ left: `${thresholdPercentage}%` }}
                />
              )}
            </div>
          )}
          <div className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-muted-foreground">
            <span>
              {hasLimit
                ? `${formatContextWindowTokens(usage.usedTokens)} of ${formatContextWindowTokens(usage.maxTokens ?? null)} tokens`
                : "tokens so far"}
            </span>
            {(usage.totalProcessedTokens ?? null) !== null &&
            (usage.totalProcessedTokens ?? 0) > usage.usedTokens ? (
              <span title="Every token read across the conversation, including compacted ones">
                {formatContextWindowTokens(usage.totalProcessedTokens ?? null)} total
              </span>
            ) : null}
          </div>
          {(usage.compactsAutomatically || onCompact) && (
            <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-1.5">
              <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                {usage.compactsAutomatically
                  ? formatAutoCompactHint(usage.autoCompactThreshold, formatContextWindowTokens)
                  : "Frees room by summarizing"}
              </span>
              {onCompact ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="-mr-1 h-6 shrink-0 gap-1 whitespace-nowrap px-2 text-[11px]"
                  aria-label="Compact context"
                  title="Summarize the conversation so far to free up room"
                  disabled={compactDisabled}
                  onClick={onCompact}
                >
                  <Minimize2Icon className="size-3" />
                  Compact
                </Button>
              ) : null}
            </div>
          )}
          {onCompact && compactDisabled && compactDisabledReason ? (
            <div className="text-pretty text-[11px] text-muted-foreground">
              {compactDisabledReason}
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
