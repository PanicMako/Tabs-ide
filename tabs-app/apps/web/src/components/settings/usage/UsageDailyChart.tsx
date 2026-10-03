import { useMemo, useRef, useState, useCallback } from "react";
import type { DailyTotals } from "@tabs/shared/usageMerge";
import { formatDayShort, formatTokens, formatUsd } from "@tabs/shared/usageFormat";
import { PROVIDER_DISPLAY_NAMES } from "@tabs/contracts";
import { cn } from "../../../lib/utils";

const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 220;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 30;
const PADDING_LEFT = 72; // Generous margin so numbers like $2,843.97 never collide
const PADDING_RIGHT = 24;

export interface UsageDailyChartProps {
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly metric?: "cost" | "tokens";
  readonly className?: string;
}

interface Point {
  readonly x: number;
  readonly y: number;
  readonly day: string;
  readonly value: number;
  readonly entry?: DailyTotals | undefined;
}

function normalizeProviderName(provider: string): string {
  if (provider === "claude" || provider === "claudeAgent") return "Claude";
  if (provider === "gemini") return "Google Gemini";
  if (provider === "codex") return "Codex";
  if (provider === "cursor") return "Cursor";
  if (provider === "copilot") return "GitHub Copilot";
  if (provider === "grok") return "Grok";
  if (provider === "opencode") return "OpenCode";
  if (provider === "droid") return "Factory Droid";
  if (provider === "kilo") return "Kilo";
  if (provider === "antigravity") return "Antigravity";
  return (PROVIDER_DISPLAY_NAMES as Record<string, string>)[provider] ?? provider;
}

/** Monotone cubic spline curve generator for smooth, non-overshooting curves */
function buildSmoothPath(
  points: readonly Point[],
  height: number,
  bottomY: number,
): { linePath: string; areaPath: string } {
  if (points.length === 0) return { linePath: "", areaPath: "" };
  if (points.length === 1) {
    const pt = points[0]!;
    return {
      linePath: `M ${pt.x} ${pt.y} L ${pt.x + 1} ${pt.y}`,
      areaPath: `M ${pt.x} ${bottomY} L ${pt.x} ${pt.y} L ${pt.x + 1} ${pt.y} L ${pt.x + 1} ${bottomY} Z`,
    };
  }

  // Generate cubic bezier control points using Fritsch-Carlson monotone interpolation
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

  let lineD = `M ${points[0]!.x} ${points[0]!.y}`;
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

export function UsageDailyChart({ days, daily, metric = "cost", className }: UsageDailyChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const dailyByDay = useMemo(() => {
    const map = new Map<string, DailyTotals>();
    for (const d of daily) {
      map.set(d.day, d);
    }
    return map;
  }, [daily]);

  const effectiveDays = useMemo(() => {
    if (days.length > 0) return days;
    return daily.map((d) => d.day);
  }, [days, daily]);

  const values = useMemo(() => {
    return effectiveDays.map((day) => {
      const entry = dailyByDay.get(day);
      if (!entry) return 0;
      return metric === "cost" ? entry.costUsd : entry.totalTokens;
    });
  }, [effectiveDays, dailyByDay, metric]);

  const maxValue = useMemo(() => {
    const max = Math.max(...values, 0);
    if (max === 0) return metric === "cost" ? 1 : 1000;
    return max * 1.15; // 15% headroom
  }, [values, metric]);

  const plotWidth = VIEW_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = VIEW_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const bottomY = VIEW_HEIGHT - PADDING_BOTTOM;

  const points = useMemo<Point[]>(() => {
    if (effectiveDays.length === 0) return [];
    const step = effectiveDays.length > 1 ? plotWidth / (effectiveDays.length - 1) : 0;

    return effectiveDays.map((day, idx) => {
      const val = values[idx] ?? 0;
      const x = PADDING_LEFT + (effectiveDays.length === 1 ? plotWidth / 2 : idx * step);
      const y = bottomY - (val / maxValue) * plotHeight;
      return {
        x,
        y: Math.max(PADDING_TOP, Math.min(bottomY, y)),
        day,
        value: val,
        entry: dailyByDay.get(day),
      };
    });
  }, [effectiveDays, values, maxValue, plotWidth, plotHeight, bottomY, dailyByDay]);

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
      const label = metric === "cost" ? formatUsd(val) : formatTokens(val);
      return { y, label };
    });
  }, [maxValue, plotHeight, metric]);

  const xTicks = useMemo(() => {
    if (points.length <= 1) return points;
    const maxLabels = Math.min(6, points.length);
    const step = Math.ceil((points.length - 1) / (maxLabels - 1));
    const ticks: Point[] = [];
    for (let i = 0; i < points.length; i += step) {
      ticks.push(points[i]!);
    }
    const last = points[points.length - 1]!;
    if (ticks[ticks.length - 1]?.day !== last.day) {
      ticks.push(last);
    }
    return ticks;
  }, [points]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!svgRef.current || points.length === 0) return;
      const rect = svgRef.current.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const scaleX = VIEW_WIDTH / rect.width;
      const svgX = clientX * scaleX;

      // Find closest point
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

  return (
    <div className={cn("relative w-full select-none", className)}>
      <div className="w-full overflow-hidden rounded-xl border border-border bg-card/40 p-4 backdrop-blur-sm shadow-xs">
        <div className="relative aspect-[800/220] w-full">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            className="size-full overflow-visible"
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
          >
            <defs>
              <linearGradient id="usageAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-primary, #3b82f6)" stopOpacity="0.28" />
                <stop offset="70%" stopColor="var(--color-primary, #3b82f6)" stopOpacity="0.06" />
                <stop offset="100%" stopColor="var(--color-primary, #3b82f6)" stopOpacity="0.00" />
              </linearGradient>
              <linearGradient id="usageLineGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--color-primary, #3b82f6)" stopOpacity="0.85" />
                <stop offset="100%" stopColor="var(--color-primary, #3b82f6)" stopOpacity="1" />
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
                  className="fill-muted-foreground text-[10px] tabular-nums font-medium"
                >
                  {tick.label}
                </text>
              </g>
            ))}

            {/* Area fill */}
            {areaPath ? (
              <path
                d={areaPath}
                fill="url(#usageAreaGradient)"
                className="transition-all duration-300"
              />
            ) : null}

            {/* Stroke Line */}
            {linePath ? (
              <path
                d={linePath}
                fill="none"
                stroke="url(#usageLineGradient)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-all duration-300"
              />
            ) : null}

            {/* X-axis Date Labels */}
            {xTicks.map((tick, i) => (
              <text
                key={i}
                x={tick.x}
                y={VIEW_HEIGHT - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px] tabular-nums font-medium"
              >
                {formatDayShort(tick.day)}
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
              className="pointer-events-none absolute z-30 flex flex-col gap-1.5 rounded-lg border border-border/80 bg-popover/95 p-3 shadow-xl backdrop-blur-md transition-all duration-75 text-xs"
              style={{
                left: `${(activePoint.x / VIEW_WIDTH) * 100}%`,
                top: `${(activePoint.y / VIEW_HEIGHT) * 100}%`,
                transform: `translate(${activePoint.x > VIEW_WIDTH * 0.65 ? "-105%" : "12px"}, ${
                  activePoint.y > VIEW_HEIGHT * 0.6 ? "-100%" : "0"
                })`,
                minWidth: "160px",
              }}
            >
              <div className="flex items-center justify-between border-b border-border/50 pb-1 font-semibold text-foreground">
                <span>{formatDayShort(activePoint.day)}</span>
                <span className="text-[11px] font-normal text-muted-foreground tabular-nums">
                  {activePoint.day}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-muted-foreground">
                  Total {metric === "cost" ? "Cost" : "Tokens"}:
                </span>
                <span className="font-semibold text-foreground tabular-nums">
                  {metric === "cost"
                    ? formatUsd(activePoint.entry?.costUsd ?? 0)
                    : formatTokens(activePoint.entry?.totalTokens ?? 0)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4 text-[11px]">
                <span className="text-muted-foreground">Tokens:</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatTokens(activePoint.entry?.totalTokens ?? 0)}
                </span>
              </div>

              {activePoint.entry && activePoint.entry.byProvider.size > 0 ? (
                <div className="mt-1 border-t border-border/40 pt-1.5 space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    By Provider
                  </span>
                  {Array.from(activePoint.entry.byProvider.entries()).map(([prov, stats]) => (
                    <div
                      key={prov}
                      className="flex items-center justify-between gap-3 text-[11px] tabular-nums"
                    >
                      <span className="text-foreground/90 truncate">
                        {normalizeProviderName(prov)}
                      </span>
                      <span className="font-medium text-foreground">
                        {metric === "cost"
                          ? formatUsd(stats.costUsd)
                          : formatTokens(stats.totalTokens)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
