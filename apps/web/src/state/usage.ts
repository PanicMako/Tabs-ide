import { Atom } from "@tabs/client-runtime/state";
import {
  type ServerListProviderUsageResult,
  type UsageSummary,
  type UsageSummaryInput,
} from "@tabs/contracts";
import { makeWindow } from "@tabs/shared/usageFormat";
import { ensureNativeApi } from "../nativeApi";
import { appAtomRegistry } from "./atomRegistry";
import { onUsageUpdated } from "../wsNativeApi";

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
        sinceDay: "2020-01-01" as UsageSummaryInput["sinceDay"],
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

let summaryRequest = 0;
const summaryCache = new Map<string, { fetchedAt: number; value: UsageSummary }>();

export async function fetchUsageSummary(
  customPreset?: UsageWindowPreset,
  options: { force?: boolean } = {},
): Promise<UsageSummary | null> {
  const presetToFetch = customPreset ?? appAtomRegistry.get(usageTimeWindowAtom);
  const input = presetToSummaryInput(presetToFetch);
  const requestId = ++summaryRequest;
  const cacheKey = JSON.stringify(input);
  if (options.force) summaryCache.clear();
  const cached = summaryCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 30_000) {
    appAtomRegistry.update(usageSummaryStateAtom, (prev) => ({
      ...prev,
      data: cached.value,
      loading: false,
      error: null,
      lastFetchedAt: cached.fetchedAt,
    }));
    return cached.value;
  }
  appAtomRegistry.update(usageSummaryStateAtom, (prev) => ({
    ...prev,
    loading: true,
    error: null,
  }));

  try {
    const api = ensureNativeApi();
    const result = await api.server.readUsageSummary(input);
    summaryCache.set(cacheKey, { fetchedAt: Date.now(), value: result });
    while (summaryCache.size > 8) summaryCache.delete(summaryCache.keys().next().value!);
    if (requestId !== summaryRequest) return result;
    appAtomRegistry.update(usageSummaryStateAtom, (prev) => ({
      ...prev,
      data: result,
      loading: false,
      error: null,
      lastFetchedAt: Date.now(),
    }));
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
