import { isListedThreadLineage, type OrchestrationV2ThreadProjection } from "@tabs/contracts";
import { IDLE_COMPACTION_TEXT } from "@tabs/contracts";
import { derivePendingBackgroundWork } from "@tabs/shared/orchestrationV2PendingBackgroundWork";
import * as DateTime from "effect/DateTime";

/**
 * Below this a cold re-read is cheap, so compacting would mostly lose context
 * for little saving.
 */
export const IDLE_COMPACTION_MIN_CONTEXT_TOKENS = 100_000;
/**
 * Start this long before the cache expires: enough for the session to resume
 * and send the compaction while the cache is still warm.
 */
export const IDLE_COMPACTION_LEAD_MS = 2 * 60_000;

export type IdleCompactionRecords = Pick<
  OrchestrationV2ThreadProjection,
  | "thread"
  | "runs"
  | "messages"
  | "providerThreads"
  | "providerTurns"
  | "runtimeRequests"
  | "turnItems"
  | "contextTransfers"
>;

export interface IdleCompactionWindow {
  readonly runId: OrchestrationV2ThreadProjection["runs"][number]["id"];
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * When an idle Claude thread should compact, or null when it should not. The
 * window ends when the prompt cache of Claude's last request expires; compacting
 * after that pays a full uncached read.
 */
export function idleCompactionWindow(
  {
    thread,
    runs,
    messages,
    providerThreads,
    providerTurns,
    runtimeRequests,
    turnItems,
    contextTransfers,
  }: IdleCompactionRecords,
  nowMs: number,
): IdleCompactionWindow | null {
  if (thread.deletedAt !== null || thread.archivedAt !== null) return null;
  if (thread.settledAt !== null || thread.settledOverride === "settled") return null;
  if (thread.snoozedUntil != null && DateTime.toEpochMillis(thread.snoozedUntil) > nowMs)
    return null;
  if (!isListedThreadLineage(thread.lineage)) return null;

  // A removed or steered queued message leaves a cancelled run that never started.
  const latestRun = runs
    .filter((run) => run.status !== "cancelled" || run.startedAt !== null)
    .reduce<(typeof runs)[number] | null>(
      (latest, run) => (latest === null || run.ordinal > latest.ordinal ? run : latest),
      null,
    );
  if (latestRun?.status !== "completed" || latestRun.completedAt === null) return null;

  // Never compact a compaction, so one idle spell compacts at most once.
  const message = messages.find((candidate) => candidate.id === latestRun.userMessageId);
  if (message === undefined || message.text.trim().toLowerCase() === IDLE_COMPACTION_TEXT) {
    return null;
  }

  if (
    runtimeRequests.some((request) => request.status === "pending") ||
    // A pending merge-back belongs to the user's next message.
    contextTransfers.some(
      (transfer) =>
        transfer.type === "merge_back" &&
        transfer.targetThreadId === thread.id &&
        transfer.status === "pending",
    ) ||
    // Background work reports into the next turn; compaction would swallow it.
    derivePendingBackgroundWork({
      latestRun,
      runs,
      providerThreads,
      turnItems,
      activeProviderThreadId: thread.activeProviderThreadId,
    }).length > 0
  ) {
    return null;
  }

  // The thread's current selection receives the /compact, so it must still be this Claude session.
  const providerThread = providerThreads.find(
    (candidate) => candidate.id === thread.activeProviderThreadId,
  );
  if (
    providerThread?.driver !== "claudeAgent" ||
    providerThread.id !== latestRun.providerThreadId ||
    providerThread.providerInstanceId !== thread.providerInstanceId ||
    latestRun.providerInstanceId !== thread.providerInstanceId
  ) {
    return null;
  }

  const latestUsage = providerTurns
    .filter((turn) => turn.providerThreadId === providerThread.id && turn.tokenUsage !== undefined)
    .map((turn) => turn.tokenUsage!)
    .toSorted((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  if ((latestUsage?.usedTokens ?? 0) < IDLE_COMPACTION_MIN_CONTEXT_TOKENS) return null;

  // A request served fully from cache reports no lifetime, so the expiry is unknown: skip.
  const endMs = latestUsage?.promptCacheExpiresAt
    ? Date.parse(latestUsage.promptCacheExpiresAt)
    : Number.NaN;
  if (!Number.isFinite(endMs) || nowMs >= endMs) return null;
  return { runId: latestRun.id, startMs: endMs - IDLE_COMPACTION_LEAD_MS, endMs };
}
