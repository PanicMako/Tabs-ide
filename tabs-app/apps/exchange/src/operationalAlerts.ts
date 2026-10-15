import type { MetadataFreshness } from "./metadataFreshness.ts";

export interface OperationalAlert {
  readonly level: "critical" | "warning";
  readonly subsystem: "worker" | "queue" | "tuf" | "database" | "storage";
  readonly message: string;
}

export interface ReviewQueueInfo {
  readonly queued: number;
  readonly oldest_queued_at: string | null;
  readonly last_worker_heartbeat_at: string | null;
  readonly last_scan_at: string | null;
  readonly worker_recently_seen: boolean;
  readonly metadataFreshness: ReadonlyArray<MetadataFreshness>;
}

export interface OperationalReadinessResult {
  readonly ready: boolean;
  readonly healthzOk: boolean;
  readonly alerts: ReadonlyArray<OperationalAlert>;
}

const MAX_QUEUE_AGE_MS = 10 * 60 * 1_000; // 10 minutes
const MAX_QUEUE_SIZE_WARNING = 20;

export function evaluateOperationalReadiness(
  healthzOk: boolean,
  queueInfo: ReviewQueueInfo,
  now = Date.now(),
): OperationalReadinessResult {
  const alerts: OperationalAlert[] = [];

  if (!healthzOk) {
    alerts.push({
      level: "critical",
      subsystem: "database",
      message: "Database ping failed; service is unhealthy.",
    });
  }

  // Worker Heartbeat
  if (!queueInfo.worker_recently_seen) {
    alerts.push({
      level: "critical",
      subsystem: "worker",
      message: `No active scan worker heartbeat observed in the last 15 seconds. Last seen: ${queueInfo.last_worker_heartbeat_at ?? "never"}.`,
    });
  }

  // Queue Backlog
  if (queueInfo.queued > MAX_QUEUE_SIZE_WARNING) {
    alerts.push({
      level: "warning",
      subsystem: "queue",
      message: `Review queue backlog (${queueInfo.queued} packages) exceeds operational threshold (${MAX_QUEUE_SIZE_WARNING}).`,
    });
  }

  if (queueInfo.oldest_queued_at) {
    const age = now - Date.parse(queueInfo.oldest_queued_at);
    if (age > MAX_QUEUE_AGE_MS) {
      alerts.push({
        level: "warning",
        subsystem: "queue",
        message: `Oldest package in scan queue has been waiting for ${Math.round(age / 1000)}s (threshold: ${MAX_QUEUE_AGE_MS / 1000}s).`,
      });
    }
  }

  // TUF Metadata Freshness
  for (const item of queueInfo.metadataFreshness) {
    if (item.status === "expired") {
      alerts.push({
        level: "critical",
        subsystem: "tuf",
        message: `TUF metadata role '${item.role}' has expired (${item.expiresAt}). Clients will reject updates.`,
      });
    } else if (item.status === "expiring") {
      alerts.push({
        level: "warning",
        subsystem: "tuf",
        message: `TUF metadata role '${item.role}' expires within warning window (${item.expiresAt}). Publication required.`,
      });
    } else if (item.status === "missing") {
      alerts.push({
        level: "critical",
        subsystem: "tuf",
        message: `TUF metadata role '${item.role}' is missing from database.`,
      });
    } else if (item.status === "invalid") {
      alerts.push({
        level: "critical",
        subsystem: "tuf",
        message: `TUF metadata role '${item.role}' is corrupted or invalid in database.`,
      });
    }
  }

  const hasCritical = alerts.some((a) => a.level === "critical");
  return {
    ready: healthzOk && !hasCritical,
    healthzOk,
    alerts,
  };
}
