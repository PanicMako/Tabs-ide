import { useMemo, useState, useRef, useCallback } from "react";
import type { ModelTotals } from "@tabs/shared/usageMerge";
import { isModelCostUnknown } from "@tabs/shared/usageMerge";
import {
  enumerateDays,
  formatDayShort,
  formatPercent,
  formatTokens,
  formatUsd,
} from "@tabs/shared/usageFormat";
import type { UsageSummary } from "@tabs/contracts";
import type { UsageWindowPreset } from "../../../state/usage";
import { cn } from "../../../lib/utils";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogClose,
} from "../../ui/dialog";
import { Button } from "../../ui/button";
import {
  AntigravityIcon,
  ClaudeAI,
  CopilotIcon,
  CursorIcon,
  DroidIcon,
  GoogleGemini,
  GrokIcon,
  KiloIcon,
  OpenAI,
  OpenCodeIcon,
  OpenRouterIcon,
  type Icon,
} from "../../Icons";
import { SparklesIcon, TagIcon } from "lucide-react";

const PROVIDER_ICONS: Record<string, Icon> = {
  codex: OpenAI,
  claude: ClaudeAI,
  claudeAgent: ClaudeAI,
  cursor: CursorIcon,
  copilot: CopilotIcon,
  grok: GrokIcon,
  opencode: OpenCodeIcon,
  kilo: KiloIcon,
  gemini: GoogleGemini,
  googleGemini: GoogleGemini,
  droid: DroidIcon,
  antigravity: AntigravityIcon,
  openrouter: OpenRouterIcon,
};

function getProviderInfo(provider: string): { name: string; icon: Icon } {
  const normKey =
    provider === "claude" ? "claudeAgent" : provider === "gemini" ? "googleGemini" : provider;
  const icon = PROVIDER_ICONS[normKey] ?? PROVIDER_ICONS[provider] ?? SparklesIcon;
  const name =
    provider === "antigravity"
      ? "Antigravity"
      : provider === "claude" || provider === "claudeAgent"
        ? "Claude"
        : provider === "codex"
          ? "Codex"
          : provider === "gemini" || provider === "googleGemini"
            ? "Google Gemini"
            : provider.charAt(0).toUpperCase() + provider.slice(1);
  return { name, icon };
}

const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 200;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 28;
const PADDING_LEFT = 60;
const PADDING_RIGHT = 20;

interface ModelPeriodStats {
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly uncachedInput: number;
  readonly cachedInput: number;
  readonly cacheCreation: number;
  readonly output: number;
  readonly reasoning: number;
  readonly records: number;
}

interface ChartPoint {
  readonly x: number;
  readonly y: number;
  readonly period: string;
  readonly value: number;
  readonly entry?: ModelPeriodStats | undefined;
}

/** Monotone cubic spline curve generator for smooth, non-overshooting curves */
function buildSmoothPath(
  points: readonly ChartPoint[],
  height: number,
  bottomY: number,
): { linePath: string; areaPath: string } {
  if (points.length === 0) return { linePath: "", areaPath: "" };
  if (points.length === 1) {
    const pt = points[0]!;
    return {
      linePath: `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)} L ${(pt.x + 1).toFixed(1)} ${pt.y.toFixed(1)}`,
      areaPath: `M ${pt.x.toFixed(1)} ${bottomY} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)} L ${(pt.x + 1).toFixed(1)} ${pt.y.toFixed(1)} L ${(pt.x + 1).toFixed(1)} ${bottomY} Z`,
    };
  }

  const n = points.length;
  const dxs: number[] = [];
  const dys: number[] = [];
  const slopes: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1]!.x - points[i]!.x;
    const dy = points[i + 1]!.y - points[i]!.y;
    dxs.push(dx);
    dys.push(dy);
    slopes.push(dx === 0 ? 0 : dy / dx);
  }

  const tangents: number[] = [slopes[0]!];
  for (let i = 1; i < n - 1; i++) {
    const m0 = slopes[i - 1]!;
    const m1 = slopes[i]!;
    if (m0 * m1 <= 0) {
      tangents.push(0);
    } else {
      tangents.push((m0 + m1) / 2);
    }
  }
  tangents.push(slopes[n - 2]!);

  for (let i = 0; i < n - 1; i++) {
    if (dys[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const alpha = tangents[i]! / slopes[i]!;
      const beta = tangents[i + 1]! / slopes[i]!;
      if (alpha < 0) tangents[i] = 0;
      if (beta < 0) tangents[i + 1] = 0;
      const dist = alpha * alpha + beta * beta;
      if (dist > 9) {
        const tau = 3 / Math.sqrt(dist);
        tangents[i] = tau * alpha * slopes[i]!;
        tangents[i + 1] = tau * beta * slopes[i]!;
      }
    }
  }

  let lineD = `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    const dx = dxs[i]!;
    const cp1x = p0.x + dx / 3;
    const cp1y = p0.y + (tangents[i]! * dx) / 3;
    const cp2x = p1.x - dx / 3;
    const cp2y = p1.y - (tangents[i + 1]! * dx) / 3;
    lineD += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const areaD = `${lineD} L ${last.x.toFixed(1)} ${bottomY} L ${first.x.toFixed(1)} ${bottomY} Z`;

  return { linePath: lineD, areaPath: areaD };
}

export interface ModelDetailModalProps {
  readonly model: ModelTotals | null;
  readonly summary?: UsageSummary | null;
  readonly timeWindow?: UsageWindowPreset;
  readonly parentDays?: readonly string[];
  readonly onClose: () => void;
  readonly onSetPrice: (modelId: string) => void;
}

export function ModelDetailModal({
  model,
  summary,
  timeWindow,
  parentDays,
  onClose,
  onSetPrice,
}: ModelDetailModalProps) {
  if (!model) return null;

  const { name: providerName, icon: ProviderIcon } = getProviderInfo(model.provider);
  const isUnpriced = isModelCostUnknown(model);

  // Group tokens for this model
  const uncachedInput = model.tokens.uncachedInputTokens;
  const cachedInput = model.tokens.cachedInputTokens;
  const cacheCreation = model.tokens.cacheCreationTokens;
  const totalCached = cachedInput + cacheCreation;
  const outputTokens = model.tokens.outputTokens;
  const reasoningTokens = model.tokens.reasoningTokens;
  const totalInput = uncachedInput + totalCached;
  const cacheHitRate = totalInput > 0 ? cachedInput / totalInput : 0;

  // Aggregate bucket stats for this specific model by period
  const modelBucketsByPeriod = useMemo(() => {
    const map = new Map<string, ModelPeriodStats>();
    if (!summary?.buckets) return map;

    for (const b of summary.buckets) {
      if (b.model !== model.model) continue;
      const key = b.hourStart ?? b.day;
      const existing = map.get(key) ?? {
        totalTokens: 0,
        costUsd: 0,
        uncachedInput: 0,
        cachedInput: 0,
        cacheCreation: 0,
        output: 0,
        reasoning: 0,
        records: 0,
      };
      const bucketTokens =
        b.totals.uncachedInputTokens +
        b.totals.cachedInputTokens +
        b.totals.cacheCreationTokens +
        b.totals.outputTokens;

      map.set(key, {
        totalTokens: existing.totalTokens + bucketTokens,
        costUsd: existing.costUsd + b.costUsd,
        uncachedInput: existing.uncachedInput + b.totals.uncachedInputTokens,
        cachedInput: existing.cachedInput + b.totals.cachedInputTokens,
        cacheCreation: existing.cacheCreation + b.totals.cacheCreationTokens,
        output: existing.output + b.totals.outputTokens,
        reasoning: existing.reasoning + b.totals.reasoningTokens,
        records: existing.records + b.records,
      });
    }
    return map;
  }, [summary, model.model]);

  // Active periods where this model was actively used
  const activePeriods = useMemo(() => {
    return Array.from(modelBucketsByPeriod.keys()).sort();
  }, [modelBucketsByPeriod]);

  // Full timeline periods matching the parent usage window
  const windowPeriods = useMemo(() => {
    if (parentDays && parentDays.length > 0) {
      return [...parentDays].sort();
    }
    if (summary?.sinceDay && summary?.untilDay) {
      const enumerated = enumerateDays(summary.sinceDay, summary.untilDay);
      if (enumerated.length > 0) return enumerated;
    }
    if (summary?.buckets && summary.buckets.length > 0) {
      const set = new Set<string>();
      for (const b of summary.buckets) {
        set.add(b.hourStart ?? b.day);
      }
      const sorted = Array.from(set).sort();
      if (sorted.length > 0) return sorted;
    }
    return activePeriods;
  }, [parentDays, summary, activePeriods]);

  const [viewMode, setViewMode] = useState<"window" | "active">("window");

  const selectedPeriods = useMemo(() => {
    if (viewMode === "window" && windowPeriods.length > 0) {
      return windowPeriods;
    }
    return activePeriods.length > 0 ? activePeriods : windowPeriods;
  }, [viewMode, windowPeriods, activePeriods]);

  const isHourly =
    timeWindow === "24h" ||
    (selectedPeriods.length > 0 &&
      selectedPeriods[0] !== undefined &&
      selectedPeriods[0].includes("T"));

  const plotWidth = VIEW_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = VIEW_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const bottomY = VIEW_HEIGHT - PADDING_BOTTOM;

  const values = useMemo(() => {
    return selectedPeriods.map((period) => {
      const data = modelBucketsByPeriod.get(period);
      return data ? data.totalTokens : 0;
    });
  }, [selectedPeriods, modelBucketsByPeriod]);

  const maxValue = useMemo(() => {
    const rawMax = Math.max(...values, 0);
    if (rawMax === 0) return 1000;
    return rawMax * 1.15; // 15% headroom
  }, [values]);

  const points = useMemo<ChartPoint[]>(() => {
    if (selectedPeriods.length === 0) return [];
    const step = selectedPeriods.length > 1 ? plotWidth / (selectedPeriods.length - 1) : 0;

    return selectedPeriods.map((period, idx) => {
      const val = values[idx] ?? 0;
      const x = PADDING_LEFT + (selectedPeriods.length === 1 ? plotWidth / 2 : idx * step);
      const y = bottomY - (val / maxValue) * plotHeight;
      const entry = modelBucketsByPeriod.get(period);
      return {
        x,
        y: Math.max(PADDING_TOP, Math.min(bottomY, y)),
        period,
        value: val,
        entry,
      };
    });
  }, [selectedPeriods, values, maxValue, plotWidth, plotHeight, bottomY, modelBucketsByPeriod]);

  const { linePath, areaPath } = useMemo(
    () => buildSmoothPath(points, VIEW_HEIGHT, bottomY),
    [points, bottomY],
  );

  const yTicks = useMemo(() => {
    const count = 4;
    return Array.from({ length: count }, (_, i) => {
      const ratio = (count - 1 - i) / (count - 1);
      const val = maxValue * ratio;
      const y = PADDING_TOP + (1 - ratio) * plotHeight;
      const label = formatTokens(val);
      return { y, label };
    });
  }, [maxValue, plotHeight]);

  const xTicks = useMemo(() => {
    if (points.length <= 1) return points;
    const maxLabels = Math.min(6, points.length);
    const step = Math.ceil((points.length - 1) / (maxLabels - 1));
    const ticks: ChartPoint[] = [];
    for (let i = 0; i < points.length; i += step) {
      ticks.push(points[i]!);
    }
    const last = points[points.length - 1]!;
    if (ticks[ticks.length - 1]?.period !== last.period) {
      ticks.push(last);
    }
    return ticks;
  }, [points]);

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!svgRef.current || points.length === 0) return;
      const rect = svgRef.current.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const scaleX = VIEW_WIDTH / rect.width;
      const svgX = clientX * scaleX;

      let closestIdx = 0;
      let minDistance = Infinity;
      for (let i = 0; i < points.length; i++) {
        const dist = Math.abs(points[i]!.x - svgX);
        if (dist < minDistance) {
          minDistance = dist;
          closestIdx = i;
        }
      }
      setHoverIndex(closestIdx);
    },
    [points],
  );

  const handlePointerLeave = useCallback(() => {
    setHoverIndex(null);
  }, []);

  const activePoint = hoverIndex !== null ? points[hoverIndex] : null;

  const totalBreakdown = uncachedInput + totalCached + outputTokens;
  const inputShare = totalBreakdown > 0 ? (uncachedInput / totalBreakdown) * 100 : 0;
  const cacheShare = totalBreakdown > 0 ? (totalCached / totalBreakdown) * 100 : 0;
  const outputShare = totalBreakdown > 0 ? (outputTokens / totalBreakdown) * 100 : 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-2xl bg-card/95 border-border/80 backdrop-blur-2xl shadow-2xl rounded-3xl p-6 sm:p-7">
        <DialogHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <ProviderIcon className="size-4.5" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold font-sans tracking-tight text-foreground break-all">
                  {model.model}
                </DialogTitle>
                <p className="text-xs text-muted-foreground font-medium">{providerName}</p>
              </div>
            </div>
            <DialogClose />
          </div>
        </DialogHeader>

        <DialogPanel className="space-y-6 pt-4">
          {/* Top 3 Stat Cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-border/60 bg-muted/20 p-3.5 space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Cost
              </span>
              <div className="text-lg font-bold font-sans tabular-nums text-foreground">
                {isUnpriced ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-500 border border-amber-500/30">
                    Unpriced
                  </span>
                ) : (
                  formatUsd(model.costUsd)
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-muted/20 p-3.5 space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Tokens
              </span>
              <div className="text-lg font-bold font-sans tabular-nums text-foreground">
                {formatTokens(model.totalTokens)}
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-muted/20 p-3.5 space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Cache hit
              </span>
              <div className="text-lg font-bold font-sans tabular-nums text-foreground">
                {formatPercent(cacheHitRate)}
              </div>
            </div>
          </div>

          {/* Activity Chart */}
          <div className="rounded-2xl border border-border/70 bg-card/40 backdrop-blur-sm p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">Token activity</span>
                <span className="text-muted-foreground text-[11px] font-sans tabular-nums">
                  {selectedPeriods.length} {selectedPeriods.length === 1 ? "period" : "periods"}
                  {viewMode === "window" && activePeriods.length < windowPeriods.length
                    ? ` · ${activePeriods.length} active`
                    : null}
                </span>
              </div>
              {windowPeriods.length > activePeriods.length && activePeriods.length > 1 ? (
                <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border/50 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setViewMode("window")}
                    className={cn(
                      "px-2.5 py-0.5 rounded-md transition-all font-sans font-medium text-[11px]",
                      viewMode === "window"
                        ? "bg-background text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Full window ({windowPeriods.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("active")}
                    className={cn(
                      "px-2.5 py-0.5 rounded-md transition-all font-sans font-medium text-[11px]",
                      viewMode === "active"
                        ? "bg-background text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Active only ({activePeriods.length})
                  </button>
                </div>
              ) : null}
            </div>

            {points.length > 0 ? (
              <div className="relative aspect-[800/200] w-full select-none">
                <svg
                  role="img"
                  aria-label={`Token activity chart for ${model.model} across ${points.length} intervals`}
                  ref={svgRef}
                  viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
                  className="size-full overflow-visible"
                  onPointerMove={handlePointerMove}
                  onPointerLeave={handlePointerLeave}
                >
                  <defs>
                    <linearGradient id="modelAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--color-primary, #3b82f6)"
                        stopOpacity="0.28"
                      />
                      <stop
                        offset="70%"
                        stopColor="var(--color-primary, #3b82f6)"
                        stopOpacity="0.06"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--color-primary, #3b82f6)"
                        stopOpacity="0.00"
                      />
                    </linearGradient>
                    <linearGradient id="modelLineGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop
                        offset="0%"
                        stopColor="var(--color-primary, #3b82f6)"
                        stopOpacity="0.85"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--color-primary, #3b82f6)"
                        stopOpacity="1"
                      />
                    </linearGradient>
                  </defs>

                  {/* Horizontal Grid lines */}
                  {yTicks.map((tick, i) => (
                    <g key={i}>
                      <line
                        x1={PADDING_LEFT}
                        y1={tick.y}
                        x2={VIEW_WIDTH - PADDING_RIGHT}
                        y2={tick.y}
                        stroke="currentColor"
                        strokeOpacity={i === yTicks.length - 1 ? "0.15" : "0.07"}
                        strokeDasharray={i === yTicks.length - 1 ? undefined : "3 3"}
                        strokeWidth="1"
                      />
                      <text
                        x={PADDING_LEFT - 10}
                        y={tick.y + 3.5}
                        textAnchor="end"
                        className="fill-muted-foreground text-[10px] tabular-nums font-sans font-medium"
                      >
                        {tick.label}
                      </text>
                    </g>
                  ))}

                  {/* Area fill */}
                  {areaPath ? (
                    <path
                      d={areaPath}
                      fill="url(#modelAreaGrad)"
                      className="transition-all duration-300"
                    />
                  ) : null}

                  {/* Stroke Line */}
                  {linePath ? (
                    <path
                      d={linePath}
                      fill="none"
                      stroke="url(#modelLineGrad)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="transition-all duration-300"
                    />
                  ) : null}

                  {/* Subtle anchor dots when zoomed into small number of periods */}
                  {points.length <= 5
                    ? points.map((pt, i) => (
                        <circle
                          key={i}
                          cx={pt.x}
                          cy={pt.y}
                          r="3"
                          className="fill-background stroke-primary"
                          strokeWidth="2"
                        />
                      ))
                    : null}

                  {/* X-axis Date Labels */}
                  {xTicks.map((tick, i) => (
                    <text
                      key={i}
                      x={tick.x}
                      y={VIEW_HEIGHT - 8}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[10px] tabular-nums font-sans font-medium"
                    >
                      {isHourly
                        ? new Date(tick.period).toLocaleTimeString(undefined, { hour: "numeric" })
                        : formatDayShort(tick.period)}
                    </text>
                  ))}

                  {/* Active hover vertical crosshair and marker */}
                  {activePoint ? (
                    <g>
                      <line
                        x1={activePoint.x}
                        y1={PADDING_TOP}
                        x2={activePoint.x}
                        y2={bottomY}
                        stroke="currentColor"
                        strokeOpacity="0.3"
                        strokeWidth="1.5"
                        strokeDasharray="2 2"
                      />
                      <circle
                        cx={activePoint.x}
                        cy={activePoint.y}
                        r="5"
                        className="fill-primary stroke-background"
                        strokeWidth="2.5"
                      />
                      <circle
                        cx={activePoint.x}
                        cy={activePoint.y}
                        r="9"
                        className="fill-primary/20 animate-ping"
                      />
                    </g>
                  ) : null}
                </svg>

                {/* Floating Tooltip */}
                {activePoint && hoverIndex !== null ? (
                  <div
                    className="pointer-events-none absolute z-30 flex flex-col gap-1.5 rounded-xl border border-border/80 bg-popover/95 p-3 shadow-xl backdrop-blur-md transition-all duration-75 text-xs"
                    style={{
                      left: `${(activePoint.x / VIEW_WIDTH) * 100}%`,
                      top: `${(activePoint.y / VIEW_HEIGHT) * 100}%`,
                      transform: `translate(${activePoint.x > VIEW_WIDTH * 0.65 ? "-105%" : "12px"}, ${
                        activePoint.y > VIEW_HEIGHT * 0.6 ? "-100%" : "0"
                      })`,
                      minWidth: "180px",
                    }}
                  >
                    <div className="flex items-center justify-between border-b border-border/50 pb-1 font-semibold text-foreground">
                      <span>
                        {isHourly
                          ? new Date(activePoint.period).toLocaleTimeString(undefined, {
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : formatDayShort(activePoint.period)}
                      </span>
                      <span className="text-[11px] font-normal text-muted-foreground tabular-nums font-sans">
                        {activePoint.period.slice(0, 10)}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between gap-4 pt-0.5">
                      <span className="text-muted-foreground">Tokens:</span>
                      <span className="font-semibold text-foreground tabular-nums font-sans">
                        {formatTokens(activePoint.value)}
                      </span>
                    </div>

                    {activePoint.entry && activePoint.entry.totalTokens > 0 ? (
                      <>
                        <div className="flex items-baseline justify-between gap-4 text-[11px]">
                          <span className="text-muted-foreground">Cost:</span>
                          <span className="text-foreground tabular-nums font-sans font-medium">
                            {activePoint.entry.costUsd > 0
                              ? formatUsd(activePoint.entry.costUsd)
                              : isUnpriced
                                ? "Unpriced"
                                : "$0.00"}
                          </span>
                        </div>
                        <div className="mt-1 border-t border-border/40 pt-1.5 space-y-1 text-[11px]">
                          <div className="flex items-center justify-between gap-3 text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                              <span className="size-1.5 rounded-full bg-sky-500" />
                              Input
                            </span>
                            <span className="tabular-nums font-sans text-foreground">
                              {formatTokens(activePoint.entry.uncachedInput)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                              <span className="size-1.5 rounded-full bg-purple-500" />
                              Cache read
                            </span>
                            <span className="tabular-nums font-sans text-foreground">
                              {formatTokens(
                                activePoint.entry.cachedInput + activePoint.entry.cacheCreation,
                              )}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                              <span className="size-1.5 rounded-full bg-amber-500" />
                              Output
                            </span>
                            <span className="tabular-nums font-sans text-foreground">
                              {formatTokens(activePoint.entry.output)}
                            </span>
                          </div>
                          {activePoint.entry.reasoning > 0 ? (
                            <div className="flex items-center justify-between gap-3 text-muted-foreground">
                              <span className="flex items-center gap-1.5">
                                <span className="size-1.5 rounded-full bg-emerald-500" />
                                Reasoning
                              </span>
                              <span className="tabular-nums font-sans text-foreground">
                                {formatTokens(activePoint.entry.reasoning)}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <span className="text-[11px] text-muted-foreground italic">
                        No tokens recorded
                      </span>
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="h-28 flex items-center justify-center text-xs text-muted-foreground/70 border border-dashed border-border/60 rounded-xl">
                No activity recorded for this period
              </div>
            )}
          </div>

          {/* Tokens by type */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground">Tokens by type</span>
              <span className="text-muted-foreground text-[11px] font-sans tabular-nums">
                {model.records} requests recorded
              </span>
            </div>

            {/* Progress Bar */}
            <div className="h-3 w-full rounded-full overflow-hidden flex bg-muted/40 p-0.5 border border-border/50">
              {inputShare > 0 ? (
                <div
                  style={{ width: `${inputShare}%` }}
                  className="h-full bg-sky-500 rounded-l-full transition-all"
                  title={`Input: ${formatTokens(uncachedInput)}`}
                />
              ) : null}
              {cacheShare > 0 ? (
                <div
                  style={{ width: `${cacheShare}%` }}
                  className="h-full bg-purple-500 transition-all"
                  title={`Cache read: ${formatTokens(totalCached)}`}
                />
              ) : null}
              {outputShare > 0 ? (
                <div
                  style={{ width: `${outputShare}%` }}
                  className="h-full bg-amber-500 rounded-r-full transition-all"
                  title={`Output: ${formatTokens(outputTokens)}`}
                />
              ) : null}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 text-xs font-sans text-muted-foreground pt-1">
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-sky-500" />
                <span>
                  Input:{" "}
                  <b className="text-foreground tabular-nums">{formatTokens(uncachedInput)}</b>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-purple-500" />
                <span>
                  Cache read:{" "}
                  <b className="text-foreground tabular-nums">{formatTokens(totalCached)}</b>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-amber-500" />
                <span>
                  Output:{" "}
                  <b className="text-foreground tabular-nums">{formatTokens(outputTokens)}</b>
                </span>
              </div>
              {reasoningTokens > 0 ? (
                <div className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  <span>
                    Reasoning:{" "}
                    <b className="text-foreground tabular-nums">{formatTokens(reasoningTokens)}</b>
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Footer banner / Action */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/60">
            <span className="text-xs text-muted-foreground">
              {isUnpriced
                ? `${formatTokens(model.totalTokens)} tokens have no known price.`
                : "Automatic rates applied from LiteLLM registry."}
            </span>
            <Button
              onClick={() => {
                onClose();
                onSetPrice(model.model);
              }}
              size="sm"
              className="gap-2 shadow-sm font-medium"
            >
              <TagIcon className="size-3.5" />
              <span>{isUnpriced ? "Set price" : "Edit custom price"}</span>
            </Button>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
