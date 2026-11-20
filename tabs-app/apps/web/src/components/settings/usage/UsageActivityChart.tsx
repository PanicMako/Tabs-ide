import { useLayoutEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import gsap from "gsap";
import { useAtomValue } from "@effect/atom-react";
import type { UsageProviderKind } from "@tabs/contracts";
import { formatTokens, formatUsd } from "@tabs/shared/usageFormat";
import { ChartColumnIcon, ChartSplineIcon } from "lucide-react";
import { SegmentedControl } from "../../ui/segmented-control";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION } from "../../usage/usageProviders";
import { useSurfaceMotionSettings } from "../../../panelAnimations";
import {
  setUsageChartStyle,
  usageChartStyleAtom,
  type UsageChartStyle,
} from "../../../state/usage";
import { smoothPath, type LedgerPeriod } from "./usageLedger";
import { morphTarget, useInlineMorph } from "./useUsageMorph";

type Metric = "cost" | "tokens";

const W = 1000;
const H = 200;
const HEADROOM = 8;

const amount = (metric: Metric, value: { costUsd: number; totalTokens: number }) =>
  metric === "cost" ? formatUsd(value.costUsd) : formatTokens(value.totalTokens);

/**
 * The window over time, as stacked bars or as nested lines. Scrubbing
 * previews a period in the figures above; a click pins it, a second click or
 * Escape lets it go. Arrow keys step through periods.
 */
export function ActivityChart({
  periods,
  metric,
  hourly,
  activeKey,
  pinnedKey,
  highlight,
  onHover,
  onPin,
}: {
  readonly periods: readonly LedgerPeriod[];
  readonly metric: Metric;
  readonly hourly: boolean;
  readonly activeKey: string | null;
  readonly pinnedKey: string | null;
  readonly highlight: UsageProviderKind | null;
  readonly onHover: (key: string | null) => void;
  readonly onPin: (key: string | null) => void;
}) {
  const style = useAtomValue(usageChartStyleAtom);
  const motion = useSurfaceMotionSettings();
  const bodyRef = useRef<HTMLDivElement>(null);
  const value = (period: LedgerPeriod) => (metric === "cost" ? period.costUsd : period.totalTokens);
  const peak = periods.reduce((max, period) => Math.max(max, value(period)), 0);
  const peakPeriod = periods.find((period) => value(period) === peak && peak > 0);
  const activeIndex = periods.findIndex((period) => period.key === activeKey);
  const pinnedIndex = periods.findIndex((period) => period.key === pinnedKey);
  const active = activeIndex >= 0 ? periods[activeIndex] : undefined;
  const unit = hourly ? "Hourly" : "Daily";

  // Bars and lines cross-fade rather than cut; each then plays its own entrance.
  const firstStyle = useRef(true);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (firstStyle.current || !body || !motion.active) {
      firstStyle.current = false;
      return;
    }
    const tween = gsap.fromTo(
      body,
      { opacity: 0 },
      {
        opacity: 1,
        duration: motion.seconds(0.26),
        ease: motion.profile.ease,
        clearProps: "opacity",
      },
    );
    return () => {
      tween.progress(1).kill();
    };
  }, [style, motion]);

  const indexAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const share = Math.max(0, Math.min(0.9999, (event.clientX - rect.left) / rect.width));
    return style === "bars"
      ? Math.floor(share * periods.length)
      : Math.round(share * Math.max(0, periods.length - 1));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const period = periods[indexAt(event)];
    if (period && period.key !== activeKey) onHover(period.key);
  };
  const onClick = (event: PointerEvent<HTMLDivElement>) => {
    const period = periods[indexAt(event)];
    if (period) onPin(period.key === pinnedKey ? null : period.key);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const from = activeIndex >= 0 ? activeIndex : delta > 0 ? -1 : periods.length;
      const next = periods[Math.max(0, Math.min(periods.length - 1, from + delta))];
      if (next) onPin(next.key);
    } else if (event.key === "Escape" && pinnedKey) {
      event.preventDefault();
      onPin(null);
    }
  };

  return (
    <section className="usage-strip" aria-label={`${unit} activity`}>
      <div className="usage-strip-head">
        <span className="usage-caption">{unit} activity</span>
        <div className="usage-strip-head-end">
          <span className="usage-caption">
            {active
              ? `${active.label} · ${amount(metric, active)}`
              : peakPeriod
                ? `Peak ${peakPeriod.label} · ${amount(metric, peakPeriod)}`
                : "No activity"}
          </span>
          <SegmentedControl<UsageChartStyle>
            value={style}
            onValueChange={setUsageChartStyle}
            options={[
              { value: "bars", label: <ChartColumnIcon className="size-3.5" aria-label="Bars" /> },
              {
                value: "lines",
                label: <ChartSplineIcon className="size-3.5" aria-label="Lines" />,
              },
            ]}
            aria-label="Chart style"
            size="sm"
          />
        </div>
      </div>
      <div
        className="usage-strip-plot"
        data-style={style}
        role="slider"
        tabIndex={0}
        aria-label={`${unit} ${metric === "cost" ? "cost" : "token usage"} across ${periods.length} intervals`}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, periods.length - 1)}
        aria-valuenow={Math.max(0, activeIndex)}
        aria-valuetext={
          active
            ? `${active.label}: ${amount(metric, active)}`
            : "Whole window. Use arrow keys to step through periods."
        }
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => onHover(null)}
        onClick={onClick}
        data-scrubbing={activeKey ? "" : undefined}
      >
        <div ref={bodyRef} className="usage-strip-body">
          {style === "bars" ? (
            <Bars
              periods={periods}
              metric={metric}
              peak={peak}
              activeKey={activeKey}
              pinnedKey={pinnedKey}
              highlight={highlight}
            />
          ) : (
            <Lines
              periods={periods}
              metric={metric}
              activeIndex={activeIndex}
              pinnedIndex={pinnedIndex}
              highlight={highlight}
            />
          )}
        </div>
      </div>
      <div className="usage-strip-axis" aria-hidden>
        <span>{periods[0]?.label}</span>
        <span>{periods[Math.floor(periods.length / 2)]?.label}</span>
        <span>{periods.at(-1)?.label}</span>
      </div>
    </section>
  );
}

function Bars({
  periods,
  metric,
  peak,
  activeKey,
  pinnedKey,
  highlight,
}: {
  readonly periods: readonly LedgerPeriod[];
  readonly metric: Metric;
  readonly peak: number;
  readonly activeKey: string | null;
  readonly pinnedKey: string | null;
  readonly highlight: UsageProviderKind | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Columns rise from the baseline on entry and ease between heights on a
  // metric or window change, as do the provider bands inside them.
  useInlineMorph(ref, ".usage-strip-stack", "height", [periods, metric, peak]);
  useInlineMorph(ref, ".usage-strip-stack > i", "flexGrow", [periods, metric]);
  return (
    <div ref={ref} className="usage-bars">
      {periods.map((period) => {
        const total = metric === "cost" ? period.costUsd : period.totalTokens;
        const height = `${Math.max(peak > 0 ? (total / peak) * 100 : 0, total > 0 ? 2 : 0)}%`;
        return (
          <div
            key={period.key}
            className="usage-strip-col"
            data-active={period.key === activeKey ? "" : undefined}
            data-pinned={period.key === pinnedKey ? "" : undefined}
          >
            <div
              className="usage-strip-stack"
              data-key={period.key}
              {...morphTarget("height", height)}
              style={{ height }}
            >
              {PROVIDER_ORDER.map((provider) => {
                const part = period.byProvider.get(provider);
                const share =
                  part && total > 0
                    ? (metric === "cost" ? part.costUsd : part.totalTokens) / total
                    : 0;
                return (
                  <i
                    key={provider}
                    data-key={`${period.key}:${provider}`}
                    {...morphTarget("flexGrow", share)}
                    style={{
                      flexGrow: share,
                      background: PROVIDER_PRESENTATION[provider].color,
                    }}
                    data-dim={highlight && highlight !== provider ? "" : undefined}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Numbers in a path, so a morph can tell whether two shapes line up point for point. */
const pathShape = (d: string) => d.match(/-?[\d.]+/g)?.length ?? 0;

/**
 * Nested curves: each provider's line is the running total up to it, so the
 * outermost curve is the whole period and every band between two lines is one
 * provider. A metric change morphs each curve into its new shape; a new shape
 * (another window, or switching to lines) draws in from the left.
 */
function Lines({
  periods,
  metric,
  activeIndex,
  pinnedIndex,
  highlight,
}: {
  readonly periods: readonly LedgerPeriod[];
  readonly metric: Metric;
  readonly activeIndex: number;
  readonly pinnedIndex: number;
  readonly highlight: UsageProviderKind | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const shown = useRef(new Map<string, string>());
  const motion = useSurfaceMotionSettings();

  const chart = useMemo(() => {
    const pick = (period: LedgerPeriod, provider: UsageProviderKind) => {
      const part = period.byProvider.get(provider);
      return part ? (metric === "cost" ? part.costUsd : part.totalTokens) : 0;
    };
    const providers = PROVIDER_ORDER.filter((provider) =>
      periods.some((period) => pick(period, provider) > 0),
    );
    const stacks = providers.map((_, depth) =>
      periods.map((period) => {
        let sum = 0;
        for (let i = 0; i <= depth; i++) sum += pick(period, providers[i]!);
        return sum;
      }),
    );
    const peak = Math.max(0, ...(stacks.at(-1) ?? []));
    const x = (i: number) => (periods.length > 1 ? (i / (periods.length - 1)) * W : W / 2);
    const y = (v: number) => H - (peak > 0 ? (v / peak) * (H - HEADROOM) : 0);
    return {
      providers,
      stacks,
      peak,
      x,
      y,
      paths: stacks.map((series) => smoothPath(series.map((v, i) => [x(i), y(v)]))),
    };
  }, [metric, periods]);

  // Targets come from `data-d`, which React owns; GSAP rewrites `d` mid-morph.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const curves = [...svg.querySelectorAll<SVGPathElement>("path[data-key]")].map((curve) => ({
      curve,
      key: curve.dataset.key ?? "",
      to: curve.dataset.d ?? "",
    }));
    const settle = () => {
      for (const { curve, key, to } of curves) {
        curve.setAttribute("d", to);
        shown.current.set(key, to);
      }
    };
    const morphable =
      curves.length > 0 &&
      curves.every(({ key, to }) => {
        const from = shown.current.get(key);
        return from !== undefined && pathShape(from) === pathShape(to);
      });
    if (!motion.active) {
      settle();
      return;
    }
    if (!morphable) {
      settle();
      const draw = gsap.fromTo(
        svg,
        { clipPath: "inset(0 100% 0 0)" },
        {
          clipPath: "inset(0 0% 0 0)",
          duration: motion.seconds(0.6),
          ease: motion.profile.ease,
          clearProps: "clipPath",
        },
      );
      return () => {
        if (draw.progress() < 1) {
          // Cut short (Strict Mode remounts at once): show the lines, and let
          // the next run draw them in again rather than morph from nothing.
          draw.kill();
          gsap.set(svg, { clearProps: "clipPath" });
          shown.current.clear();
        }
      };
    }
    const tweens: gsap.core.Tween[] = [];
    for (const { curve, key, to } of curves) {
      const from = shown.current.get(key)!;
      if (from === to) {
        curve.setAttribute("d", to);
        continue;
      }
      tweens.push(
        gsap.fromTo(
          curve,
          { attr: { d: from } },
          {
            attr: { d: to },
            duration: motion.seconds(0.48),
            ease: motion.profile.ease,
            overwrite: "auto",
            onUpdate: () => {
              shown.current.set(key, curve.getAttribute("d") ?? to);
            },
            onComplete: () => {
              shown.current.set(key, to);
            },
          },
        ),
      );
    }
    return () => {
      for (const tween of tweens) tween.kill();
    };
  }, [chart, motion]);

  // The scrub cursor and its dots glide between periods instead of jumping.
  useInlineMorph(rootRef, ".usage-lines-cursor, .usage-lines-dot", "left", [activeIndex], {
    duration: 0.18,
    fromZero: false,
  });
  useInlineMorph(rootRef, ".usage-lines-dot", "top", [activeIndex, chart], {
    duration: 0.18,
    fromZero: false,
  });

  const format = metric === "cost" ? formatUsd : formatTokens;
  const marker = activeIndex >= 0 ? activeIndex : pinnedIndex;
  const markerX = marker >= 0 ? (chart.x(marker) / W) * 100 : null;
  return (
    <div ref={rootRef} className="usage-lines">
      <span className="usage-lines-scale">{format(chart.peak)}</span>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        {[0.5, 1].map((share) => (
          <line
            key={share}
            className="usage-lines-grid"
            x1={0}
            x2={W}
            y1={H - share * (H - HEADROOM)}
            y2={H - share * (H - HEADROOM)}
          />
        ))}
        <line className="usage-lines-axis" x1={0} x2={W} y1={H} y2={H} />
        {chart.paths.map((d, depth) => (
          <path
            key={chart.providers[depth]}
            data-key={chart.providers[depth]}
            data-d={d}
            d={d}
            className="usage-lines-curve"
            stroke={PROVIDER_PRESENTATION[chart.providers[depth]!].color}
            data-dim={highlight && highlight !== chart.providers[depth] ? "" : undefined}
          />
        ))}
        {pinnedIndex >= 0 ? (
          <line
            className="usage-lines-pin"
            x1={chart.x(pinnedIndex)}
            x2={chart.x(pinnedIndex)}
            y1={0}
            y2={H}
          />
        ) : null}
      </svg>
      {markerX !== null ? (
        <>
          <span
            className="usage-lines-cursor"
            data-key="cursor"
            {...morphTarget("left", `${markerX}%`)}
            style={{ left: `${markerX}%` }}
            aria-hidden
          />
          {chart.stacks.map((series, depth) => {
            const provider = chart.providers[depth]!;
            if (highlight && highlight !== provider) return null;
            const top = `${(chart.y(series[marker] ?? 0) / H) * 100}%`;
            return (
              <span
                key={provider}
                data-key={`dot:${provider}`}
                className="usage-lines-dot"
                aria-hidden
                {...morphTarget("left", `${markerX}%`)}
                {...morphTarget("top", top)}
                style={{
                  left: `${markerX}%`,
                  top,
                  borderColor: PROVIDER_PRESENTATION[provider].color,
                }}
              />
            );
          })}
        </>
      ) : null}
    </div>
  );
}
