import type {
  OrchestrationThreadActivity,
  OrchestrationV2ThreadProjection,
  ThreadTokenUsageSnapshot,
} from "@tabs/contracts";
import * as DateTime from "effect/DateTime";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

type NullableContextWindowUsage = {
  readonly [Key in keyof ThreadTokenUsageSnapshot]: undefined extends ThreadTokenUsageSnapshot[Key]
    ? Exclude<ThreadTokenUsageSnapshot[Key], undefined> | null
    : ThreadTokenUsageSnapshot[Key];
};

export type ContextWindowSnapshot = NullableContextWindowUsage & {
  readonly remainingTokens: number | null;
  readonly usedPercentage: number | null;
  readonly remainingPercentage: number | null;
  readonly autoCompactThreshold?: number | null;
  readonly updatedAt: string;
};

export function deriveLatestContextWindowSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ContextWindowSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== "context-window.updated") {
      continue;
    }

    const payload = asRecord(activity.payload);
    const usedTokens = asFiniteNumber(payload?.usedTokens);
    if (usedTokens === null || usedTokens <= 0) {
      continue;
    }

    const maxTokens = asFiniteNumber(payload?.maxTokens);
    const usedPercentage =
      maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
    const remainingTokens =
      maxTokens !== null ? Math.max(0, Math.round(maxTokens - usedTokens)) : null;
    const remainingPercentage = usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;

    return {
      usedTokens,
      totalProcessedTokens: asFiniteNumber(payload?.totalProcessedTokens),
      maxTokens,
      remainingTokens,
      usedPercentage,
      remainingPercentage,
      inputTokens: asFiniteNumber(payload?.inputTokens),
      cachedInputTokens: asFiniteNumber(payload?.cachedInputTokens),
      outputTokens: asFiniteNumber(payload?.outputTokens),
      reasoningOutputTokens: asFiniteNumber(payload?.reasoningOutputTokens),
      lastUsedTokens: asFiniteNumber(payload?.lastUsedTokens),
      lastInputTokens: asFiniteNumber(payload?.lastInputTokens),
      lastCachedInputTokens: asFiniteNumber(payload?.lastCachedInputTokens),
      lastOutputTokens: asFiniteNumber(payload?.lastOutputTokens),
      lastReasoningOutputTokens: asFiniteNumber(payload?.lastReasoningOutputTokens),
      toolUses: asFiniteNumber(payload?.toolUses),
      durationMs: asFiniteNumber(payload?.durationMs),
      compactsAutomatically: asBoolean(payload?.compactsAutomatically) ?? false,
      autoCompactThreshold: asFiniteNumber(payload?.autoCompactThreshold),
      updatedAt: activity.createdAt,
    };
  }

  return null;
}

function toIso(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return DateTime.formatIso(value as DateTime.Utc);
  } catch {
    return new Date().toISOString();
  }
}

function snapshotFromUsage(input: {
  readonly usedTokens: number;
  readonly maxTokens?: number | null | undefined;
  readonly totalProcessedTokens?: number | null | undefined;
  readonly inputTokens?: number | undefined;
  readonly cachedInputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly reasoningOutputTokens?: number | undefined;
  readonly lastUsedTokens?: number | undefined;
  readonly lastInputTokens?: number | undefined;
  readonly lastCachedInputTokens?: number | undefined;
  readonly lastOutputTokens?: number | undefined;
  readonly lastReasoningOutputTokens?: number | undefined;
  readonly toolUses?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly compactsAutomatically?: boolean | undefined;
  readonly autoCompactThreshold?: number | undefined;
  readonly cost?: ThreadTokenUsageSnapshot["cost"];
  readonly updatedAt: string;
}): ContextWindowSnapshot {
  const usedTokens = Math.max(0, input.usedTokens);
  const maxTokens = asFiniteNumber(input.maxTokens);
  const usedPercentage =
    maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
  return {
    usedTokens,
    totalProcessedTokens: input.totalProcessedTokens ?? null,
    maxTokens,
    remainingTokens: maxTokens === null ? null : Math.max(0, Math.round(maxTokens - usedTokens)),
    usedPercentage,
    remainingPercentage: usedPercentage === null ? null : Math.max(0, 100 - usedPercentage),
    inputTokens: input.inputTokens ?? null,
    cachedInputTokens: input.cachedInputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    reasoningOutputTokens: input.reasoningOutputTokens ?? null,
    lastUsedTokens: input.lastUsedTokens ?? null,
    lastInputTokens: input.lastInputTokens ?? null,
    lastCachedInputTokens: input.lastCachedInputTokens ?? null,
    lastOutputTokens: input.lastOutputTokens ?? null,
    lastReasoningOutputTokens: input.lastReasoningOutputTokens ?? null,
    toolUses: input.toolUses ?? null,
    durationMs: input.durationMs ?? null,
    compactsAutomatically: input.compactsAutomatically ?? true,
    autoCompactThreshold: input.autoCompactThreshold ?? null,
    cost: input.cost ?? null,
    updatedAt: input.updatedAt,
  } as ContextWindowSnapshot;
}

/**
 * Context use as the V2 orchestrator records it: the newest token report on a
 * provider turn of the active provider thread, else the provider thread's own
 * context usage. Adapters no longer write `context-window.updated` activities.
 */
export function deriveProjectionContextWindowSnapshot(
  projection: Pick<
    OrchestrationV2ThreadProjection,
    "thread" | "providerThreads" | "providerTurns"
  > | null,
): ContextWindowSnapshot | null {
  if (projection === null) return null;
  const activeId = projection.thread.activeProviderThreadId;
  const turns = projection.providerTurns.filter(
    (turn) => activeId === null || turn.providerThreadId === activeId,
  );
  let latest: NonNullable<(typeof turns)[number]["tokenUsage"]> | null = null;
  for (const turn of turns) {
    const usage = turn.tokenUsage;
    if (usage === undefined || usage.usedTokens <= 0) continue;
    if (latest === null || Date.parse(usage.updatedAt) >= Date.parse(latest.updatedAt)) {
      latest = usage;
    }
  }
  if (latest !== null) return snapshotFromUsage(latest);
  const providerThread = projection.providerThreads.find((thread) => thread.id === activeId);
  const usage = providerThread?.contextUsage;
  if (providerThread && usage && usage.usedTokens > 0) {
    return snapshotFromUsage({ ...usage, updatedAt: toIso(providerThread.updatedAt) });
  }
  return null;
}

export function formatContextWindowTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0";
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (value < 1_000_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
