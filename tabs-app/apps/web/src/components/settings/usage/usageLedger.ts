import type { UsageProviderKind, UsageSummary } from "@tabs/contracts";
import { enumerateDays, formatDayShort, formatHourShort } from "@tabs/shared/usageFormat";
import type { MergedUsage } from "@tabs/shared/usageMerge";

const HOUR_MS = 60 * 60 * 1000;
/** The far-past bound the all-time preset requests. */
export const ALL_TIME_SINCE_DAY = "2020-01-01";

export interface LedgerPeriod {
  /** The bucket `day`, or the hour start's epoch millis for hourly windows. */
  readonly key: string;
  readonly label: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly byProvider: ReadonlyMap<UsageProviderKind, { costUsd: number; totalTokens: number }>;
}

const EMPTY_SPLIT: LedgerPeriod["byProvider"] = new Map();

/**
 * Every period of the window in order, quiet ones included, so the strip reads
 * as a timeline rather than a list of busy days. An all-time window starts at
 * the first active day instead of the request's far-past bound.
 */
export function ledgerPeriods(
  summary: UsageSummary,
  merged: MergedUsage,
  hourly: boolean,
): readonly LedgerPeriod[] {
  if (hourly) {
    const byStart = new Map(merged.hourly.map((hour) => [Date.parse(hour.hourStart), hour]));
    const readAt = Date.parse(summary.readAt);
    // Buckets are fixed hours from the window start, so any bucket anchors the grid.
    const anchor = byStart.keys().next().value ?? readAt - 24 * HOUR_MS;
    const first = anchor - Math.ceil((anchor - (readAt - 24 * HOUR_MS)) / HOUR_MS) * HOUR_MS;
    const periods: LedgerPeriod[] = [];
    for (let start = first; start < readAt; start += HOUR_MS) {
      const hour = byStart.get(start);
      periods.push({
        key: String(start),
        label: formatHourShort(new Date(start).toISOString(), summary.timeZone),
        costUsd: hour?.costUsd ?? 0,
        totalTokens: hour?.totalTokens ?? 0,
        byProvider: hour?.byProvider ?? EMPTY_SPLIT,
      });
    }
    return periods;
  }
  const byDay = new Map(merged.daily.map((day) => [day.day, day]));
  const firstActive = merged.daily[0]?.day;
  const since =
    firstActive !== undefined && summary.sinceDay <= ALL_TIME_SINCE_DAY
      ? firstActive
      : summary.sinceDay;
  return enumerateDays(since, summary.untilDay).map((day) => {
    const totals = byDay.get(day);
    return {
      key: day,
      label: formatDayShort(day),
      costUsd: totals?.costUsd ?? 0,
      totalTokens: totals?.totalTokens ?? 0,
      byProvider: totals?.byProvider ?? EMPTY_SPLIT,
    };
  });
}

/**
 * The summary narrowed to one period and/or provider. Merging the narrowed
 * summary gives models, cache and cost figures for exactly that slice.
 */
export function sliceSummary(
  summary: UsageSummary,
  slice: {
    readonly periodKey?: string | null;
    readonly hourly: boolean;
    readonly provider?: UsageProviderKind | null;
  },
): UsageSummary {
  const { periodKey, hourly, provider } = slice;
  if (!periodKey && !provider) return summary;
  const hourStart = periodKey && hourly ? Number(periodKey) : null;
  return {
    ...summary,
    buckets: summary.buckets.filter(
      (bucket) =>
        (!provider || bucket.provider === provider) &&
        (!periodKey ||
          (hourStart !== null
            ? bucket.hourStart !== undefined && Date.parse(bucket.hourStart) === hourStart
            : bucket.day === periodKey)),
    ),
  };
}

/**
 * A smooth SVG path through points ordered by x. Monotone cubic (Fritsch and
 * Carlson) so a curve never swings past its neighbours: usage cannot dip
 * below zero between two quiet days just because the spline wanted to.
 */
export function smoothPath(points: ReadonlyArray<readonly [number, number]>): string {
  const n = points.length;
  if (n === 0) return "";
  const at = (i: number) => points[i]!;
  if (n === 1) return `M${at(0)[0]},${at(0)[1]}`;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = at(i + 1)[0] - at(i)[0];
    slopes.push(dx === 0 ? 0 : (at(i + 1)[1] - at(i)[1]) / dx);
  }
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0]!;
    if (i === n - 1) return slopes[n - 2]!;
    const left = slopes[i - 1]!;
    const right = slopes[i]!;
    // A turn or a flat side gets a level tangent; otherwise the harmonic mean,
    // which never exceeds three times either slope and so cannot overshoot.
    if (left * right <= 0) return 0;
    return (2 * left * right) / (left + right);
  });
  let d = `M${at(0)[0]},${at(0)[1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = at(i);
    const [x1, y1] = at(i + 1);
    const third = (x1 - x0) / 3;
    d += `C${x0 + third},${y0 + tangents[i]! * third} ${x1 - third},${y1 - tangents[i + 1]! * third} ${x1},${y1}`;
  }
  return d;
}
