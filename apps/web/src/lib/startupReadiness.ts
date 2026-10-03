/**
 * Startup Readiness & Telemetry Coordinator
 *
 * Tracks observable startup boundaries. A stage is recorded only where the
 * application has a concrete signal for it; inferred extension-host and
 * provider-refresh completion must not be reported as measurements.
 *
 * Requirements addressed:
 * Instrument observed progressive startup stages without making shell
 * interactivity depend on Code-OSS or provider refreshes.
 *
 * @module lib/startupReadiness
 */

export type StartupStage =
  | "shell-first-paint"
  | "renderer-hydration"
  | "backend-connection-ready"
  | "provider-inventory-available"
  | "code-host-session-ready"
  | "provider-update-received";

export interface StartupStageRecord {
  readonly stage: StartupStage;
  readonly timestamp: number;
  readonly durationFromStartMs: number;
}

export interface StartupTelemetryReport {
  readonly stages: ReadonlyArray<StartupStageRecord>;
  readonly totalElapsedMs: number;
}

const startTime =
  typeof performance !== "undefined" && performance.timeOrigin
    ? performance.timeOrigin
    : Date.now();

const completedStages = new Map<StartupStage, StartupStageRecord>();
const stageListeners = new Set<(record: StartupStageRecord) => void>();

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? Math.round(performance.now())
    : Date.now() - startTime;
}

/**
 * Marks a startup stage as reached. Idempotent — only the first occurrence is recorded.
 */
export function markStartupStage(stage: StartupStage): StartupStageRecord {
  const existing = completedStages.get(stage);
  if (existing) {
    return existing;
  }

  const durationFromStartMs = nowMs();
  const timestamp = Date.now();
  const record: StartupStageRecord = {
    stage,
    timestamp,
    durationFromStartMs,
  };

  completedStages.set(stage, record);

  // Performance timeline marker
  if (typeof performance !== "undefined" && typeof performance.mark === "function") {
    try {
      performance.mark(`tabs:${stage}`);
    } catch {
      // Ignore performance mark failures
    }
  }

  // One line per idempotent stage keeps startup diagnostics bounded.
  console.info(`[startup] ${stage}: ${durationFromStartMs}ms`);

  // Notify listeners
  for (const listener of stageListeners) {
    try {
      listener(record);
    } catch {
      // Ignore listener failures
    }
  }

  return record;
}

export function isStartupStageComplete(stage: StartupStage): boolean {
  return completedStages.has(stage);
}

export function getStartupStageRecord(stage: StartupStage): StartupStageRecord | undefined {
  return completedStages.get(stage);
}

export function onStartupStage(listener: (record: StartupStageRecord) => void): () => void {
  stageListeners.add(listener);
  return () => {
    stageListeners.delete(listener);
  };
}

export function getStartupTelemetryReport(): StartupTelemetryReport {
  const stages = Array.from(completedStages.values()).sort(
    (a, b) => a.durationFromStartMs - b.durationFromStartMs,
  );
  const totalElapsedMs = stages.length > 0 ? stages[stages.length - 1]!.durationFromStartMs : 0;
  return {
    stages,
    totalElapsedMs,
  };
}
