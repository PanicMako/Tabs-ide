import type {
  ServerProcessDiagnosticsEntry,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerProcessCategory,
  ServerSignalProcessInput,
  ServerSignalProcessResult,
} from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { type ProcessRow, readSystemProcessRows } from "./ProcessEnumerator.ts";

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
          category: last.process.category,
          attribution: last.process.attribution,
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
