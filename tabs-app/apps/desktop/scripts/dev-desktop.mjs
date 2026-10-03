import { spawn, spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const children = new Set();
const ownedDesktopGroups = new Set();
let shuttingDown = false;

const jobs = [
  { name: "desktop bundle", args: ["run", "dev:bundle"] },
  { name: "backend bundle", args: ["run", "dev:backend-bundle"] },
  { name: "Electron", args: ["run", "dev:electron"] },
];

function terminateDetachedDesktopApps(signal) {
  if (isWindows) return;
  const marker = `--tabs-dev-root=${process.cwd()}`;
  const result = spawnSync("ps", ["-ax", "-o", "pid=,ppid=,pgid=,command="], {
    encoding: "utf8",
  });
  const processes = [];
  for (const line of (result.stdout ?? "").split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const pgid = Number(match[3]);
    const command = match[4] ?? "";
    if (![pid, ppid, pgid].every(Number.isSafeInteger) || pid <= 1 || pgid <= 1) continue;
    processes.push({ pid, ppid, pgid, command });
    if (command.includes(marker)) ownedDesktopGroups.add(pgid);
  }

  // Provider runtimes intentionally lead their own process groups. Discover
  // those groups while their parent chain is still intact, before terminating
  // Electron can reparent them to launchd.
  const ownedPids = new Set(
    processes.filter(({ pgid }) => ownedDesktopGroups.has(pgid)).map(({ pid }) => pid),
  );
  let discoveredDescendant = true;
  while (discoveredDescendant) {
    discoveredDescendant = false;
    for (const processInfo of processes) {
      if (ownedPids.has(processInfo.pid) || !ownedPids.has(processInfo.ppid)) continue;
      ownedPids.add(processInfo.pid);
      ownedDesktopGroups.add(processInfo.pgid);
      discoveredDescendant = true;
    }
  }

  // Retain every group discovered during the first pass. The Electron group
  // leader may exit after SIGTERM while a backend descendant ignores the
  // signal and is reparented to launchd; rescanning by the leader's command
  // would then lose the only reliable ownership handle before SIGKILL.
  for (const pid of ownedDesktopGroups) {
    try {
      process.kill(-pid, signal);
    } catch {
      // The exact app process group may already have exited.
    }
  }
}

function terminate(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }

  try {
    // Each job owns a process group so its compiler/Electron descendants are
    // stopped too. This prevents repeated dev launches from accumulating
    // orphaned watchers after Turbo terminates the package script.
    process.kill(-child.pid, signal);
  } catch {
    // The process may have completed between the exit check and the signal.
  }
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  // Turbo may SIGKILL persistent tasks almost immediately after SIGTERM. Do
  // all ownership discovery and cleanup synchronously so the supervisor
  // cannot disappear midway and strand a detached provider runtime.
  terminateDetachedDesktopApps("SIGTERM");
  for (const child of children) terminate(child, "SIGTERM");
  terminateDetachedDesktopApps("SIGKILL");
  for (const child of children) terminate(child, "SIGKILL");
  process.exit(exitCode);
}

for (const job of jobs) {
  const child = spawn(process.execPath, job.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    detached: !isWindows,
  });

  children.add(child);
  child.once("error", (error) => {
    console.error(`[desktop-dev] Failed to start ${job.name}:`, error);
    shutdown(1);
  });
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(
        `[desktop-dev] ${job.name} exited unexpectedly (code=${String(code)}, signal=${String(signal)}).`,
      );
      shutdown(code && code > 0 ? code : 1);
    }
  });
}

process.once("SIGINT", () => shutdown(130));
process.once("SIGTERM", () => shutdown(143));
process.once("SIGHUP", () => shutdown(129));
