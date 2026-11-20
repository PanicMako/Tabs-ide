import { Atom } from "@tabs/client-runtime/state";
import {
  type ServerListProviderUsageResult,
  type UsageSummary,
  type UsageSummaryInput,
} from "@tabs/contracts";
import { makeWindow } from "@tabs/shared/usageFormat";
import { ALL_TIME_SINCE_DAY } from "../components/settings/usage/usageLedger";
import { ensureNativeApi } from "../nativeApi";
import { appAtomRegistry } from "./atomRegistry";
import { onUsageUpdated } from "../wsNativeApi";
import { usageCommandEffect, type UsageCommand, type UsageMetric } from "./usageCommands";

export type UsageSubTab = "usage" | "limits";
export type UsageWindowPreset = "24h" | "7d" | "30d" | "90d" | "all";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
}

export const usageTimeWindowAtom = Atom.make<UsageWindowPreset>("30d").pipe(
  Atom.withLabel("tabs-usage-time-window"),
  Atom.keepAlive,
);

export const usageActiveSubTabAtom = Atom.make<UsageSubTab>("usage").pipe(
  Atom.withLabel("tabs-usage-active-subtab"),
  Atom.keepAlive,
);

export const usageMetricAtom = Atom.make<UsageMetric>("tokens").pipe(
  Atom.withLabel("tabs-usage-metric"),
  Atom.keepAlive,
);

export type UsageChartStyle = "bars" | "lines";
const CHART_STYLE_KEY = "tabs:usage-chart-style";

function storedChartStyle(): UsageChartStyle {
  try {
    return globalThis.localStorage?.getItem(CHART_STYLE_KEY) === "lines" ? "lines" : "bars";
  } catch {
    return "bars";
  }
}

/** A per-device viewing preference, so it lives beside the browser rather than in settings. */
export const usageChartStyleAtom = Atom.make<UsageChartStyle>(storedChartStyle()).pipe(
  Atom.withLabel("tabs-usage-chart-style"),
  Atom.keepAlive,
);

export function setUsageChartStyle(style: UsageChartStyle): void {
  appAtomRegistry.set(usageChartStyleAtom, style);
  try {
    globalThis.localStorage?.setItem(CHART_STYLE_KEY, style);
  } catch {
    // Storage can be blocked; the choice still holds for this session.
  }
}

/** Applies a usage shortcut to the page's state; the caller opens Settings on the usage page. */
export function applyUsageCommand(command: UsageCommand): void {
  const effect = usageCommandEffect(command);
  appAtomRegistry.set(usageActiveSubTabAtom, effect.tab);
  if (effect.metric) appAtomRegistry.set(usageMetricAtom, effect.metric);
  if (effect.window) {
    appAtomRegistry.set(usageTimeWindowAtom, effect.window);
    void fetchUsageSummary(effect.window);
  }
}

export const usageSummaryStateAtom = Atom.make<AsyncState<UsageSummary>>({
  data: null,
  loading: false,
  error: null,
  lastFetchedAt: null,
}).pipe(Atom.withLabel("tabs-usage-summary-state"), Atom.keepAlive);

export const providerUsageSnapshotsAtom = Atom.make<AsyncState<ServerListProviderUsageResult>>({
  data: null,
  loading: false,
  error: null,
  lastFetchedAt: null,
}).pipe(Atom.withLabel("tabs-provider-usage-snapshots"), Atom.keepAlive);

export function presetToSummaryInput(preset: UsageWindowPreset): UsageSummaryInput {
  switch (preset) {
    case "24h":
      return makeWindow(1, undefined, "hour");
    case "7d":
      return makeWindow(7);
    case "30d":
      return makeWindow(30);
    case "90d":
      return makeWindow(90);
    case "all": {
      const standard = makeWindow(3650); // 10 years
      return {
        ...standard,
        sinceDay: ALL_TIME_SINCE_DAY as UsageSummaryInput["sinceDay"],
      };
    }
  }
}

let initialized = false;

export function initUsageListeners() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  onUsageUpdated((payload) => {
    if (payload && Array.isArray(payload)) {
      appAtomRegistry.update(providerUsageSnapshotsAtom, (prev) => ({
        ...prev,
        data: payload as ServerListProviderUsageResult,
        loading: false,
        error: null,
        lastFetchedAt: Date.now(),
      }));
    }
  });
}

/** The window the shown summary covers, which lags the selected one while a scan runs. */
export const usageShownWindowAtom = Atom.make<UsageWindowPreset | null>(null).pipe(
  Atom.withLabel("tabs-usage-shown-window"),
  Atom.keepAlive,
);

let summaryRequest = 0;
const SUMMARY_FRESH_MS = 30_000;
const summaryCache = new Map<UsageWindowPreset, { fetchedAt: number; value: UsageSummary }>();

function showSummary(preset: UsageWindowPreset, value: UsageSummary, fetchedAt: number) {
  appAtomRegistry.set(usageShownWindowAtom, preset);
  appAtomRegistry.update(usageSummaryStateAtom, (prev) => ({
    ...prev,
    data: value,
    error: null,
    lastFetchedAt: fetchedAt,
  }));
}

/**
 * Shows whatever this window last returned at once, then rescans when that is
 * older than {@link SUMMARY_FRESH_MS}. Switching back to a window never blanks
 * the page; only a window never seen this session waits on its first scan.
 */
export async function fetchUsageSummary(
  customPreset?: UsageWindowPreset,
  options: { force?: boolean } = {},
): Promise<UsageSummary | null> {
  const preset = customPreset ?? appAtomRegistry.get(usageTimeWindowAtom);
  const requestId = ++summaryRequest;
  const cached = summaryCache.get(preset);
  if (cached) showSummary(preset, cached.value, cached.fetchedAt);
  if (cached && !options.force && Date.now() - cached.fetchedAt < SUMMARY_FRESH_MS) {
    appAtomRegistry.update(usageSummaryStateAtom, (prev) => ({ ...prev, loading: false }));
    return cached.value;
  }
  appAtomRegistry.update(usageSummaryStateAtom, (prev) => ({
    ...prev,
    loading: true,
    error: null,
  }));

  try {
    const api = ensureNativeApi();
    // Built per request so rolling windows end now, not when the page opened.
    const result = await api.server.readUsageSummary(presetToSummaryInput(preset));
    const fetchedAt = Date.now();
    summaryCache.delete(preset);
    summaryCache.set(preset, { fetchedAt, value: result });
    if (requestId !== summaryRequest) return result;
    showSummary(preset, result, fetchedAt);
    appAtomRegistry.update(usageSummaryStateAtom, (prev) => ({ ...prev, loading: false }));
    return result;
  } catch (err: unknown) {
    if (requestId !== summaryRequest) return null;
    const errorMsg = err instanceof Error ? err.message : String(err);
    appAtomRegistry.update(usageSummaryStateAtom, (prev) => ({
      ...prev,
      loading: false,
      error: errorMsg,
    }));
    return null;
  }
}

export async function fetchProviderUsageSnapshots(): Promise<ServerListProviderUsageResult | null> {
  appAtomRegistry.update(providerUsageSnapshotsAtom, (prev) => ({
    ...prev,
    loading: true,
    error: null,
  }));

  try {
    const api = ensureNativeApi();
    const result = await api.server.listUsageSnapshots({});
    appAtomRegistry.update(providerUsageSnapshotsAtom, (prev) => ({
      ...prev,
      data: result,
      loading: false,
      error: null,
      lastFetchedAt: Date.now(),
    }));
    return result;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    appAtomRegistry.update(providerUsageSnapshotsAtom, (prev) => ({
      ...prev,
      loading: false,
      error: errorMsg,
    }));
    return null;
  }
}

export async function refreshAllProviderUsage(): Promise<ServerListProviderUsageResult | null> {
  appAtomRegistry.update(providerUsageSnapshotsAtom, (prev) => ({
    ...prev,
    loading: true,
    error: null,
  }));

  try {
    const api = ensureNativeApi();
    const result = await api.server.refreshAllUsageSnapshots();
    appAtomRegistry.update(providerUsageSnapshotsAtom, (prev) => ({
      ...prev,
      data: result,
      loading: false,
      error: null,
      lastFetchedAt: Date.now(),
    }));
    return result;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    appAtomRegistry.update(providerUsageSnapshotsAtom, (prev) => ({
      ...prev,
      loading: false,
      error: errorMsg,
    }));
    return null;
  }
}
