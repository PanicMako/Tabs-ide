import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly status: string;
  readonly cpuPercent: number;
  readonly rssBytes: number;
  readonly elapsedSeconds: number;
  readonly command: string;
}

export interface WindowsProcessTreeModule {
  ProcessDataFlag: {
    None: number;
    Memory: number;
    CommandLine: number;
  };
  getProcessList(
    rootPid: number,
    callback: (processList: WindowsProcessInfo[] | undefined) => void,
    flags?: number,
  ): void;
  getProcessCpuUsage(
    processList: WindowsProcessInfo[],
    callback: (completeProcessList: WindowsProcessCpuInfo[]) => void,
  ): void;
}

export interface WindowsProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  memory?: number;
  commandLine?: string;
}

export interface WindowsProcessCpuInfo extends WindowsProcessInfo {
  cpu?: number;
}

export function cleanUNCPrefix(value: string): string {
  if (value.startsWith("\\\\?\\")) {
    return value.substring(4);
  } else if (value.startsWith("\\??\\")) {
    return value.substring(4);
  } else if (value.startsWith('"\\\\?\\')) {
    return '"' + value.substring(5);
  } else if (value.startsWith('"\\??\\')) {
    return '"' + value.substring(5);
  }
  return value;
}

export function parseElapsed(value: string): number {
  const [clock, days = "0"] = value.split("-").reverse();
  const parts = (clock ?? "").split(":").map(Number);
  const seconds = parts.pop() ?? 0;
  const minutes = parts.pop() ?? 0;
  const hours = parts.pop() ?? 0;
  return Number(days) * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

export function parseProcessRows(output: string): ProcessRow[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = /^(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/u.exec(line);
      if (!match) return [];
      return [
        {
          pid: Number(match[1]),
          ppid: Number(match[2]),
          status: match[3]!,
          cpuPercent: Number(match[4]),
          rssBytes: Number(match[5]) * 1_024,
          elapsedSeconds: parseElapsed(match[6]!),
          command: match[7]!,
        },
      ];
    });
}

// ============================================================================
// Windows Integration via @vscode/windows-process-tree
// ============================================================================

let cachedWindowsProcessTree: WindowsProcessTreeModule | null | undefined = undefined;

export function resolveWindowsProcessTreeModule(): WindowsProcessTreeModule | null {
  if (cachedWindowsProcessTree !== undefined) {
    return cachedWindowsProcessTree;
  }

  const require = createRequire(import.meta.url);

  // Candidate 1: Standard Node module resolution (if installed in node_modules)
  try {
    const mod = require("@vscode/windows-process-tree");
    if (mod && typeof mod.getProcessList === "function") {
      cachedWindowsProcessTree = mod;
      return mod;
    }
  } catch {}

  // Candidate 2: Vendored tabs-code-oss in packaged resources or development checkouts
  const candidateDirs = [
    // Packaged Electron app resources
    typeof (process as unknown as { resourcesPath?: string }).resourcesPath === "string"
      ? path.join(
          (process as unknown as { resourcesPath: string }).resourcesPath,
          "tabs-code-oss",
          "node_modules",
          "@vscode",
          "windows-process-tree",
        )
      : null,
    // Development checkout: ../tabs-code-oss from apps/server
    path.resolve(
      process.cwd(),
      "..",
      "tabs-code-oss",
      "node_modules",
      "@vscode",
      "windows-process-tree",
    ),
    // Development checkout: ../../tabs-code-oss
    path.resolve(
      process.cwd(),
      "..",
      "..",
      "tabs-code-oss",
      "node_modules",
      "@vscode",
      "windows-process-tree",
    ),
    // Development checkout relative to __dirname / import.meta.url
    path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "..",
      "..",
      "..",
      "..",
      "tabs-code-oss",
      "node_modules",
      "@vscode",
      "windows-process-tree",
    ),
    // Explicit environment override if configured
    process.env.TABS_CODE_OSS_BUILD_DIR
      ? path.join(
          process.env.TABS_CODE_OSS_BUILD_DIR,
          "node_modules",
          "@vscode",
          "windows-process-tree",
        )
      : null,
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidateDirs) {
    try {
      if (fs.existsSync(candidate)) {
        const mod = require(candidate);
        if (mod && typeof mod.getProcessList === "function") {
          cachedWindowsProcessTree = mod;
          return mod;
        }
      }
    } catch {}
  }

  cachedWindowsProcessTree = null;
  return null;
}

export async function readWindowsProcessRowsWithModule(
  windowsProcessTree: WindowsProcessTreeModule,
  rootPids: number[] = [process.ppid, process.pid],
): Promise<ProcessRow[]> {
  const flags =
    windowsProcessTree.ProcessDataFlag.CommandLine | windowsProcessTree.ProcessDataFlag.Memory;

  // Try finding process tree from root PIDs (e.g. parent Electron main process, or self)
  let processList: WindowsProcessInfo[] | undefined;
  for (const rootPid of rootPids) {
    if (!rootPid || rootPid <= 0) continue;
    try {
      processList = await new Promise<WindowsProcessInfo[] | undefined>((resolve) => {
        windowsProcessTree.getProcessList(rootPid, (list) => resolve(list), flags);
      });
      if (processList && processList.length > 0) {
        break;
      }
    } catch {}
  }

  if (!processList || processList.length === 0) {
    return [];
  }

  // Fetch CPU usage for the process list
  const completeList = await new Promise<WindowsProcessCpuInfo[]>((resolve) => {
    windowsProcessTree.getProcessCpuUsage(processList!, (list) => resolve(list));
  });

  const uptime = process.uptime();
  return completeList.map((proc) => {
    const rawCmd = proc.commandLine || proc.name || `pid-${proc.pid}`;
    const cleanCmd = cleanUNCPrefix(rawCmd);
    return {
      pid: proc.pid,
      ppid: proc.ppid,
      status: "running",
      cpuPercent: typeof proc.cpu === "number" ? Math.round(proc.cpu * 10) / 10 : 0,
      rssBytes: typeof proc.memory === "number" ? proc.memory : 0,
      elapsedSeconds: uptime,
      command: cleanCmd,
    };
  });
}

export async function readWindowsProcessRowsFallback(): Promise<ProcessRow[]> {
  try {
    const { stdout } = await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,WorkingSetSize | ConvertTo-Json -Compress",
      ],
      { maxBuffer: 10 * 1024 * 1024, timeout: 5000 },
    );

    const parsed = JSON.parse(stdout.trim()) as
      | Array<{
          ProcessId?: number;
          ParentProcessId?: number;
          CommandLine?: string | null;
          WorkingSetSize?: number | null;
        }>
      | {
          ProcessId?: number;
          ParentProcessId?: number;
          CommandLine?: string | null;
          WorkingSetSize?: number | null;
        };

    const items = Array.isArray(parsed) ? parsed : [parsed];
    const uptime = process.uptime();

    return items
      .filter(
        (item): item is typeof item & { ProcessId: number } => typeof item.ProcessId === "number",
      )
      .map((item) => ({
        pid: item.ProcessId,
        ppid: item.ParentProcessId ?? 0,
        status: "running",
        cpuPercent: 0,
        rssBytes: typeof item.WorkingSetSize === "number" ? item.WorkingSetSize : 0,
        elapsedSeconds: uptime,
        command: cleanUNCPrefix(item.CommandLine || `pid-${item.ProcessId}`),
      }));
  } catch {
    // Ultimate fallback if PowerShell is unavailable: self process row
    const memory = process.memoryUsage();
    return [
      {
        pid: process.pid,
        ppid: process.ppid,
        status: "running",
        cpuPercent: 0,
        rssBytes: memory.rss,
        elapsedSeconds: process.uptime(),
        command: process.argv.join(" ") || "tabs",
      },
    ];
  }
}

// ============================================================================
// Linux Delta CPU Calculation
// ============================================================================

interface LinuxCpuSnapshot {
  readonly timestampMs: number;
  readonly totalSystemTicks: number;
  readonly processTicks: Map<number, number>; // pid -> utime + stime
}

let lastLinuxCpuSnapshot: LinuxCpuSnapshot | null = null;

export function readLinuxTotalSystemTicks(): number | null {
  try {
    const stat = fs.readFileSync("/proc/stat", "utf8");
    const firstLine = stat.split("\n", 1)[0];
    if (!firstLine || !firstLine.startsWith("cpu ")) return null;
    const parts = firstLine.trim().split(/\s+/).slice(1).map(Number);
    return parts.reduce((acc, val) => acc + (Number.isFinite(val) ? val : 0), 0);
  } catch {
    return null;
  }
}

export function readLinuxProcessTicks(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const lastParen = stat.lastIndexOf(")");
    if (lastParen === -1) return null;
    const fields = stat
      .slice(lastParen + 1)
      .trim()
      .split(/\s+/);
    // fields[11] is utime (14th stat field), fields[12] is stime (15th stat field)
    const utime = Number(fields[11]);
    const stime = Number(fields[12]);
    if (Number.isFinite(utime) && Number.isFinite(stime)) {
      return utime + stime;
    }
    return null;
  } catch {
    return null;
  }
}

export function computeLinuxDeltaCpu(
  rows: ProcessRow[],
  currentSnapshot: LinuxCpuSnapshot,
  previousSnapshot: LinuxCpuSnapshot | null,
  cpuCount = os.cpus().length || 1,
): ProcessRow[] {
  if (!previousSnapshot) {
    return rows;
  }

  const deltaSystem = currentSnapshot.totalSystemTicks - previousSnapshot.totalSystemTicks;
  if (deltaSystem <= 0) {
    return rows;
  }

  return rows.map((row) => {
    const prevTicks = previousSnapshot.processTicks.get(row.pid);
    const currTicks = currentSnapshot.processTicks.get(row.pid);
    if (prevTicks !== undefined && currTicks !== undefined && currTicks >= prevTicks) {
      const deltaProc = currTicks - prevTicks;
      const accurateCpu = Math.min(
        100 * cpuCount,
        Math.max(0, (deltaProc / deltaSystem) * 100 * cpuCount),
      );
      return {
        ...row,
        cpuPercent: Math.round(accurateCpu * 10) / 10,
      };
    }
    return row;
  });
}

async function correctLinuxProcessRows(initialRows: ProcessRow[]): Promise<ProcessRow[]> {
  const now = Date.now();
  const currentTotalTicks = readLinuxTotalSystemTicks();
  if (currentTotalTicks === null) {
    return initialRows;
  }

  const currentProcessTicks = new Map<number, number>();
  for (const row of initialRows) {
    const ticks = readLinuxProcessTicks(row.pid);
    if (ticks !== null) {
      currentProcessTicks.set(row.pid, ticks);
    }
  }

  const currentSnapshot: LinuxCpuSnapshot = {
    timestampMs: now,
    totalSystemTicks: currentTotalTicks,
    processTicks: currentProcessTicks,
  };

  // If we had a recent previous sample (between 400ms and 15s old), use it directly
  if (
    lastLinuxCpuSnapshot &&
    now - lastLinuxCpuSnapshot.timestampMs >= 400 &&
    now - lastLinuxCpuSnapshot.timestampMs <= 15_000
  ) {
    const result = computeLinuxDeltaCpu(initialRows, currentSnapshot, lastLinuxCpuSnapshot);
    lastLinuxCpuSnapshot = currentSnapshot;
    return result;
  }

  // If no recent sample exists (e.g. cold start or manual refresh after long idle),
  // sample over a 500ms interval matching VS Code's cpuUsage.sh pattern
  lastLinuxCpuSnapshot = currentSnapshot;
  await new Promise((resolve) => setTimeout(resolve, 500));

  const secondTotalTicks = readLinuxTotalSystemTicks();
  if (secondTotalTicks === null) {
    return initialRows;
  }

  const secondProcessTicks = new Map<number, number>();
  for (const row of initialRows) {
    const ticks = readLinuxProcessTicks(row.pid);
    if (ticks !== null) {
      secondProcessTicks.set(row.pid, ticks);
    }
  }

  const secondSnapshot: LinuxCpuSnapshot = {
    timestampMs: Date.now(),
    totalSystemTicks: secondTotalTicks,
    processTicks: secondProcessTicks,
  };

  const result = computeLinuxDeltaCpu(initialRows, secondSnapshot, currentSnapshot);
  lastLinuxCpuSnapshot = secondSnapshot;
  return result;
}

// ============================================================================
// Main Cross-Platform Process Enumeration Entry Point
// ============================================================================

export async function readSystemProcessRows(): Promise<ProcessRow[]> {
  // 1. Windows: Use @vscode/windows-process-tree with fallback
  if (process.platform === "win32") {
    const mod = resolveWindowsProcessTreeModule();
    if (mod) {
      try {
        const rows = await readWindowsProcessRowsWithModule(mod);
        if (rows.length > 0) return rows;
      } catch {}
    }
    return readWindowsProcessRowsFallback();
  }

  // 2. macOS & Linux: Run ps -axo
  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-axo", "pid=,ppid=,state=,%cpu=,rss=,etime=,command="],
      { maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_NUMERIC: "en_US.UTF-8" } },
    );
    const parsedRows = parseProcessRows(stdout);

    // 3. Linux: Correct lifetime-average %cpu using real-time interval sampling
    if (process.platform === "linux" && fs.existsSync("/proc/stat")) {
      return await correctLinuxProcessRows(parsedRows);
    }

    return parsedRows;
  } catch (error) {
    const memory = process.memoryUsage();
    return [
      {
        pid: process.pid,
        ppid: process.ppid,
        status: "running",
        cpuPercent: 0,
        rssBytes: memory.rss,
        elapsedSeconds: process.uptime(),
        command: process.argv.join(" ") || "tabs",
      },
    ];
  }
}
