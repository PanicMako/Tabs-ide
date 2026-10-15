import type {
  ResourceTelemetryProcessCategory,
  ServerProcessDiagnosticsEntry,
  ServerProcessDiagnosticsResult,
  ServerProcessSignal,
  ServerSignalProcessResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerSignalProcessInput,
  ServerProcessCategory,
} from "@tabs/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { type ProcessRow, readSystemProcessRows } from "./ProcessEnumerator.ts";
import * as ResourceTelemetry from "../resourceTelemetry/ResourceTelemetry.ts";

export class ProcessSignalFailed extends Schema.TaggedError<ProcessSignalFailed>()(
  "ProcessSignalFailed",
  {
    pid: Schema.Number,
    signal: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to signal process ${this.pid} with ${this.signal}.`;
  }
}

export class ProcessDiagnostics extends Context.Service<
  ProcessDiagnostics,
  {
    readonly read: Effect.Effect<ServerProcessDiagnosticsResult>;
    readonly signal: (input: {
      readonly pid: number;
      readonly startTimeMs?: number | undefined;
      readonly signal: ServerProcessSignal;
    }) => Effect.Effect<ServerSignalProcessResult>;
  }
>()("tabs/diagnostics/ProcessDiagnostics") {}

function formatElapsed(runTimeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(runTimeMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function canSignalCategory(category: ResourceTelemetryProcessCategory): boolean {
  return (
    category === "server-child" || category === "provider-root" || category === "terminal-root"
  );
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.fn("makeProcessDiagnostics")(function* () {
  const telemetry = yield* ResourceTelemetry.ResourceTelemetry;
  const refreshedTelemetry = telemetry.refresh.pipe(Effect.catch(() => telemetry.latest));

  const read: ProcessDiagnostics["Service"]["read"] = refreshedTelemetry.pipe(
    Effect.map((snapshot) => {
      const processes = snapshot.processes
        .filter((entry) => canSignalCategory(entry.category))
        .map(
          (entry): ServerProcessDiagnosticsEntry => ({
            pid: entry.identity.pid,
            startTimeMs: entry.identity.startTimeMs,
            ppid: entry.ppid,
            pgid: Option.none(),
            status: entry.status || "Unknown",
            cpuPercent: entry.cpuPercent,
            rssBytes: entry.residentBytes,
            elapsed: formatElapsed(entry.runTimeMs),
            command: entry.command || entry.name || "unknown",
            depth: Math.max(0, entry.depth - 1),
            childPids: entry.childPids,
          }),
        );
      return {
        serverPid: process.pid,
        readAt: snapshot.readAt,
        processCount: processes.length,
        totalRssBytes: processes.reduce((total, entry) => total + entry.rssBytes, 0),
        totalCpuPercent: processes.reduce((total, entry) => total + entry.cpuPercent, 0),
        processes,
        error: Option.map(snapshot.health.native.lastError, (message) => ({ message })),
      };
    }),
  );

  const signal: ProcessDiagnostics["Service"]["signal"] = Effect.fn("ProcessDiagnostics.signal")(
    function* (input) {
      if (input.pid === process.pid) {
        return {
          pid: input.pid,
          signal: input.signal,
          signaled: false,
          message: Option.some("Refusing to signal the Tabs server process."),
        };
      }
      const current = yield* telemetry.refresh.pipe(Effect.option);
      if (Option.isNone(current)) {
        return {
          pid: input.pid,
          signal: input.signal,
          signaled: false,
          message: Option.some(
            `Could not refresh process ${input.pid}; refusing to signal a stale identity.`,
          ),
        };
      }
      const selected = current.value.processes.find(
        (entry) =>
          entry.identity.pid === input.pid &&
          (input.startTimeMs === undefined || entry.identity.startTimeMs === input.startTimeMs),
      );
      if (!selected) {
        return {
          pid: input.pid,
          signal: input.signal,
          signaled: false,
          message: Option.some(
            `Process ${input.pid} no longer matches the selected process identity.`,
          ),
        };
      }
      if (!canSignalCategory(selected.category)) {
        return {
          pid: input.pid,
          signal: input.signal,
          signaled: false,
          message: Option.some(`Process ${input.pid} is not a signalable Tabs backend descendant.`),
        };
      }
      return yield* Effect.try({
        try: () => {
          process.kill(input.pid, input.signal);
          return {
            pid: input.pid,
            signal: input.signal,
            signaled: true,
            message: Option.none(),
          };
        },
        catch: (cause) =>
          new ProcessSignalFailed({
            pid: input.pid,
            signal: input.signal,
            cause,
          }),
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed({
            pid: input.pid,
            signal: input.signal,
            signaled: false,
            message: Option.some(
              error instanceof Error ? error.message : "Failed to signal process.",
            ),
          }),
        ),
      );
    },
  );

  return ProcessDiagnostics.of({ read, signal });
});

export const layer = Layer.effect(ProcessDiagnostics, make());

interface Sample {
  readonly at: DateTime.Utc;
  readonly processes: readonly ServerProcessDiagnosticsEntry[];
}

const samples: Sample[] = [];
const MAX_SAMPLE_AGE_MS = 60 * 60 * 1_000;

function elapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = Math.floor(seconds % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function descendants(rows: readonly ProcessRow[]): readonly ProcessRow[] {
  const included = new Set([process.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (included.has(row.ppid) && !included.has(row.pid)) {
        included.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => included.has(row.pid));
}

function entries(rows: readonly ProcessRow[]): ServerProcessDiagnosticsEntry[] {
  const children = new Map<number, number[]>();
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid]);
  const depthOf = (row: ProcessRow) => {
    let depth = 0;
    let current = row;
    const seen = new Set<number>();
    while (current.pid !== process.pid && !seen.has(current.pid)) {
      seen.add(current.pid);
      const parent = rows.find((candidate) => candidate.pid === current.ppid);
      if (!parent) break;
      depth += 1;
      current = parent;
    }
    return depth;
  };
  const categoryOf = (
    row: ProcessRow,
  ): { category: ServerProcessCategory; attribution: string } => {
    if (row.pid === process.pid) return { category: "server", attribution: "Tabs backend" };
    const command = row.command.toLowerCase();
    if (/\b(codex|claude|gemini|copilot|cursor|droid|grok|opencode|amp)\b/u.test(command)) {
      return { category: "provider", attribution: "AI provider runtime" };
    }
    if (/\b(git|gh|glab)\b/u.test(command))
      return { category: "git", attribution: "Source control" };
    if (/\b(chromium|chrome|playwright|puppeteer)\b/u.test(command))
      return { category: "browser", attribution: "Browser automation" };
    const parent = rows.find((candidate) => candidate.pid === row.ppid);
    if (
      parent &&
      /\b(shell|terminal|pty|zsh|bash|fish|pwsh|powershell|cmd\.exe)\b/u.test(
        parent.command.toLowerCase(),
      )
    ) {
      return { category: "terminal", attribution: "Interactive terminal" };
    }
    if (/\b(zsh|bash|fish|pwsh|powershell|cmd\.exe)\b/u.test(command)) {
      return { category: "terminal", attribution: "Interactive terminal" };
    }
    return { category: "other", attribution: "Backend child process" };
  };
  return rows.map((row) => ({
    pid: row.pid,
    startTimeMs: Math.max(0, Math.floor(Date.now() - row.elapsedSeconds * 1000)),
    ppid: row.ppid,
    pgid: Option.none(),
    status: row.status,
    cpuPercent: row.cpuPercent,
    rssBytes: row.rssBytes,
    elapsed: elapsed(row.elapsedSeconds),
    command: row.command,
    depth: depthOf(row),
    childPids: children.get(row.pid) ?? [],
    ...categoryOf(row),
  }));
}

export async function readProcessDiagnostics(): Promise<ServerProcessDiagnosticsResult> {
  const readAt = DateTime.nowUnsafe();
  try {
    const processes = entries(descendants(await readSystemProcessRows()));
    samples.push({ at: readAt, processes });
    const cutoff = readAt.epochMilliseconds - MAX_SAMPLE_AGE_MS;
    while (samples[0] && samples[0].at.epochMilliseconds < cutoff) samples.shift();
    return {
      serverPid: process.pid,
      readAt,
      processCount: processes.length,
      totalRssBytes: processes.reduce((sum, entry) => sum + entry.rssBytes, 0),
      totalCpuPercent: processes.reduce((sum, entry) => sum + entry.cpuPercent, 0),
      processes,
      error: Option.none(),
    };
  } catch (error) {
    return {
      serverPid: process.pid,
      readAt,
      processCount: 0,
      totalRssBytes: 0,
      totalCpuPercent: 0,
      processes: [],
      error: Option.some({
        message: error instanceof Error ? error.message : "Could not inspect server processes.",
      }),
    };
  }
}

export async function readProcessResourceHistory(
  input: ServerProcessResourceHistoryInput,
): Promise<ServerProcessResourceHistoryResult> {
  const readAt = DateTime.nowUnsafe();
  const windowMs = Math.max(1_000, input.windowMs);
  const bucketMs = Math.max(1_000, input.bucketMs);

  try {
    await readProcessDiagnostics();
    const retained = samples.filter(
      (sample) => sample.at.epochMilliseconds >= readAt.epochMilliseconds - windowMs,
    );
    const byProcess = new Map<
      string,
      Array<{ sample: Sample; process: ServerProcessDiagnosticsEntry }>
    >();
    for (const sample of retained)
      for (const entry of sample.processes) {
        const key = String(entry.pid);
        byProcess.set(key, [...(byProcess.get(key) ?? []), { sample, process: entry }]);
      }
    const topProcesses = [...byProcess.entries()]
      .map(([key, observations]) => {
        const first = observations[0]!;
        const last = observations.at(-1)!;
        return {
          processKey: key,
          pid: last.process.pid,
          ppid: last.process.ppid,
          command: last.process.command,
          depth: last.process.depth,
          isServerRoot: last.process.pid === process.pid,
          firstSeenAt: first.sample.at,
          lastSeenAt: last.sample.at,
          currentCpuPercent: last.process.cpuPercent,
          avgCpuPercent:
            observations.reduce((sum, item) => sum + item.process.cpuPercent, 0) /
            observations.length,
          maxCpuPercent: Math.max(...observations.map((item) => item.process.cpuPercent)),
          cpuSecondsApprox: observations.reduce(
            (sum, item) => sum + (item.process.cpuPercent * bucketMs) / 100_000,
            0,
          ),
          currentRssBytes: last.process.rssBytes,
          maxRssBytes: Math.max(...observations.map((item) => item.process.rssBytes)),
          sampleCount: observations.length,
          category: last.process.category ?? "other",
          ...(last.process.attribution !== undefined
            ? { attribution: last.process.attribution }
            : {}),
        };
      })
      .sort((left, right) => right.currentCpuPercent - left.currentCpuPercent);
    return {
      readAt,
      windowMs,
      bucketMs,
      sampleIntervalMs: 0,
      retainedSampleCount: retained.length,
      totalCpuSecondsApprox: topProcesses.reduce((sum, entry) => sum + entry.cpuSecondsApprox, 0),
      buckets: retained.map((sample) => ({
        startedAt: sample.at,
        endedAt: DateTime.add(sample.at, { milliseconds: bucketMs }),
        avgCpuPercent: sample.processes.reduce((sum, entry) => sum + entry.cpuPercent, 0),
        maxCpuPercent: sample.processes.reduce((sum, entry) => sum + entry.cpuPercent, 0),
        maxRssBytes: sample.processes.reduce((sum, entry) => sum + entry.rssBytes, 0),
        maxProcessCount: sample.processes.length,
      })),
      topProcesses,
      error: Option.none(),
    };
  } catch (error) {
    return {
      readAt,
      windowMs,
      bucketMs,
      sampleIntervalMs: 0,
      retainedSampleCount: 0,
      totalCpuSecondsApprox: 0,
      buckets: [],
      topProcesses: [],
      error: Option.some({
        failureTag: "ProcessDiagnosticsQueryFailedError",
        message:
          error instanceof Error ? error.message : "Could not read process resource history.",
      }),
    };
  }
}

export async function signalProcess(
  input: ServerSignalProcessInput,
): Promise<ServerSignalProcessResult> {
  try {
    const rows = descendants(await readSystemProcessRows());
    if (input.pid === process.pid || !rows.some((row) => row.pid === input.pid))
      return {
        ...input,
        signaled: false,
        message: Option.some("Refusing to signal a process outside the Tabs backend tree."),
      };
    process.kill(input.pid, input.signal);
    return { ...input, signaled: true, message: Option.none() };
  } catch (error) {
    return {
      ...input,
      signaled: false,
      message: Option.some(error instanceof Error ? error.message : "Failed to signal process."),
    };
  }
}
