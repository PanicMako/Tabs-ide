import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { Minimize2Icon } from "lucide-react";

import { cn } from "~/lib/utils";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  HOLD_TO_COMPACT_MS,
  PIP_COUNT,
  THRESHOLD_STEP,
  clampThresholdFraction,
  computePips,
  describeContextRoom,
  thresholdFraction as deriveThresholdFraction,
  tokensKeptAfterCompaction,
} from "./ContextWindowMeter.logic";

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
  /** Move the auto-compact line (0.4-1). Omit when the provider has no adjustable line. */
  onAutoCompactFractionChange?: ((fraction: number) => void) | undefined;
}

export function ContextWindowMeter(props: ContextWindowMeterProps) {
  const {
    usage,
    onCompact,
    compactDisabled = false,
    compactDisabledReason,
    onAutoCompactFractionChange,
  } = props;
  const usedPercentage = formatPercentage(usage.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const hasLimit = usage.maxTokens !== null && usedPercentage !== null;
  const room = describeContextRoom(usage.usedPercentage);
  const tone = room.level === "nearlyFull" ? "hot" : room.level === "filling" ? "warm" : "ok";
  const reportedLineFraction = deriveThresholdFraction(usage.autoCompactThreshold, usage.maxTokens);
  // The line moves the instant it is clicked; the saved setting catches up afterwards.
  const [pickedFraction, setPickedFraction] = useState<number | null>(null);
  useEffect(() => setPickedFraction(null), [reportedLineFraction]);
  const lineFraction = pickedFraction ?? reportedLineFraction;
  const canAdjustLine = hasLimit && onAutoCompactFractionChange !== undefined;

  const [holdProgress, setHoldProgress] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const holdFrameRef = useRef(0);

  const stopHold = useCallback(() => {
    cancelAnimationFrame(holdFrameRef.current);
    setHoldProgress(0);
  }, []);
  useEffect(() => () => cancelAnimationFrame(holdFrameRef.current), []);

  const startHold = (event: PointerEvent<HTMLButtonElement>) => {
    if (!onCompact || compactDisabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / HOLD_TO_COMPACT_MS);
      if (progress >= 1) {
        setHoldProgress(0);
        onCompact();
        return;
      }
      setHoldProgress(progress);
      holdFrameRef.current = requestAnimationFrame(tick);
    };
    holdFrameRef.current = requestAnimationFrame(tick);
  };

  const pips = useMemo(
    () =>
      computePips({
        usedFraction: normalizedPercentage / 100,
        thresholdFraction: lineFraction,
        holdProgress,
        previewing,
      }),
    [normalizedPercentage, lineFraction, holdProgress, previewing],
  );

  const moveLine = (fraction: number) => {
    const next = clampThresholdFraction(fraction);
    setPickedFraction(next);
    onAutoCompactFractionChange?.(next);
  };
  const onPipsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    moveLine(lineFraction + (event.key === "ArrowRight" ? THRESHOLD_STEP : -THRESHOLD_STEP));
  };

  const lineLabel =
    lineFraction >= 1
      ? "Auto-compacts when full"
      : `Auto-compacts at ${Math.round(lineFraction * 100)}% \u00b7 ${formatContextWindowTokens(lineFraction * (usage.maxTokens ?? 0))}`;
  const freedTokens = Math.max(0, usage.usedTokens - tokensKeptAfterCompaction(usage.usedTokens));
  const isHolding = holdProgress > 0;

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
            <span
              className="ctx-tide relative flex h-6 w-6 items-center justify-center"
              data-tone={tone}
              style={
                {
                  "--ctx-level": (0.08 + (normalizedPercentage / 100) * 0.84).toFixed(3),
                } as CSSProperties
              }
            >
              <span
                aria-hidden="true"
                className="absolute inset-px overflow-hidden rounded-full bg-foreground/[0.06] shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-foreground)_22%,transparent)]"
              >
                <span className="ctx-liq absolute inset-0" />
              </span>
              <span className="relative text-[9px] font-semibold tabular-nums text-foreground [text-shadow:0_1px_3px_rgb(0_0_0/0.45)]">
                {usage.usedPercentage !== null
                  ? Math.round(usage.usedPercentage)
                  : formatContextWindowTokens(usage.usedTokens)}
              </span>
            </span>
          </button>
        }
      />
      <PopoverPopup
        tooltipStyle
        side="top"
        align="end"
        alignOffset={-84}
        sideOffset={8}
        className="w-[min(24rem,92vw)] max-w-none px-3 pb-2.5 pt-2.5"
      >
        <div className="pb-3.5 leading-tight" data-context-window-card="true">
          <div className="flex items-center gap-3">
            <span className="min-w-9 text-sm font-semibold tabular-nums text-foreground">
              {hasLimit ? usedPercentage : formatContextWindowTokens(usage.usedTokens)}
            </span>
            <div className="relative min-w-0 flex-1">
              {hasLimit ? (
                <div
                  className={cn(
                    "flex h-6 items-center gap-[2px] px-0.5 outline-none",
                    canAdjustLine && "cursor-pointer",
                  )}
                  role={canAdjustLine ? "slider" : "meter"}
                  tabIndex={canAdjustLine ? 0 : undefined}
                  aria-label={canAdjustLine ? "Auto-compact threshold" : "Context window used"}
                  aria-valuemin={canAdjustLine ? 40 : 0}
                  aria-valuemax={100}
                  aria-valuenow={
                    canAdjustLine
                      ? Math.round(lineFraction * 100)
                      : Math.round(normalizedPercentage)
                  }
                  onKeyDown={canAdjustLine ? onPipsKeyDown : undefined}
                  onPointerMove={(event) => {
                    if (!canAdjustLine) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    setHoverIndex(((event.clientX - rect.left) / rect.width) * PIP_COUNT);
                  }}
                  onPointerLeave={() => setHoverIndex(null)}
                  onClick={(event) => {
                    if (!canAdjustLine) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    moveLine(
                      Math.ceil(((event.clientX - rect.left) / rect.width) * PIP_COUNT) / PIP_COUNT,
                    );
                  }}
                >
                  {pips.map((pip, index) => {
                    const swell =
                      hoverIndex === null
                        ? 0
                        : Math.pow(Math.max(0, 1 - Math.abs(index + 0.5 - hoverIndex) / 4), 2);
                    return (
                      <i
                        key={index}
                        data-on={pip.filled}
                        className={cn(
                          "ctx-pip max-w-[6px] flex-1 rounded-[2px]",
                          pip.threshold
                            ? "bg-foreground shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-background)_60%,transparent)]"
                            : pip.freed
                              ? "bg-foreground/35"
                              : pip.filled
                                ? tone === "hot"
                                  ? "bg-destructive"
                                  : tone === "warm"
                                    ? "bg-amber-500"
                                    : "bg-foreground/65"
                                : pip.zone
                                  ? "bg-foreground/[0.07]"
                                  : "bg-foreground/[0.13]",
                        )}
                        style={
                          {
                            height: `${(pip.threshold ? 18 : 10) + swell * (pip.threshold ? 8 : 10)}px`,
                            "--ctx-bob-delay": `${((index * 0.37) % 2.6).toFixed(2)}s`,
                          } as CSSProperties
                        }
                      />
                    );
                  })}
                </div>
              ) : (
                <span className="text-[11px] text-muted-foreground">tokens so far</span>
              )}
              {hasLimit ? (
                <span className="pointer-events-none absolute left-0.5 top-full mt-1 whitespace-nowrap text-[10px] text-muted-foreground">
                  {lineLabel}
                  {canAdjustLine ? " \u00b7 click a bar to move it" : ""}
                </span>
              ) : null}
            </div>
            <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
              <b className="font-semibold text-foreground">
                {formatContextWindowTokens(usage.usedTokens)}
              </b>
              {hasLimit ? ` / ${formatContextWindowTokens(usage.maxTokens ?? null)}` : ""}
            </span>
            {onCompact ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="ctx-hold relative grid size-9 shrink-0 touch-none select-none place-items-center rounded-full outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [&>svg]:transition-transform"
                      data-holding={isHolding}
                      style={{
                        background: `conic-gradient(var(--color-foreground) ${holdProgress * 360}deg, color-mix(in oklab, var(--color-foreground) 14%, transparent) 0)`,
                      }}
                      aria-label="Compact context (hold)"
                      disabled={compactDisabled}
                      onPointerDown={startHold}
                      onPointerUp={stopHold}
                      onPointerCancel={stopHold}
                      onPointerEnter={() => setPreviewing(true)}
                      onPointerLeave={() => {
                        stopHold();
                        setPreviewing(false);
                      }}
                      onFocus={() => setPreviewing(true)}
                      onBlur={() => {
                        stopHold();
                        setPreviewing(false);
                      }}
                      onKeyDown={(event) => {
                        if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
                          event.preventDefault();
                          onCompact();
                        }
                      }}
                    >
                      <span
                        className="absolute inset-[3px] rounded-full bg-popover"
                        aria-hidden="true"
                      />
                      <Minimize2Icon
                        className={cn("relative size-3.5", isHolding && "scale-[0.65]")}
                        aria-hidden="true"
                      />
                      <span className="sr-only">
                        {compactDisabled && compactDisabledReason
                          ? compactDisabledReason
                          : "Compact context"}
                      </span>
                    </button>
                  }
                />
                <TooltipPopup side="top" className="max-w-52">
                  <span className="block text-pretty text-[11px] leading-snug">
                    {compactDisabled && compactDisabledReason
                      ? compactDisabledReason
                      : `Hold to compact \u00b7 summarizes the chat and frees about ${formatContextWindowTokens(freedTokens)} tokens`}
                  </span>
                </TooltipPopup>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
