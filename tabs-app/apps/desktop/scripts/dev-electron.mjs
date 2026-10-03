import { spawn, spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { join } from "node:path";
import waitOn from "wait-on";

import { desktopDir, resolveElectronPath } from "./electron-launcher.mjs";

const port = Number(process.env.ELECTRON_RENDERER_PORT ?? 5733);
const devServerUrl = `http://localhost:${port}`;
const requiredFiles = [
  "dist-electron/main.js",
  "dist-electron/preload.js",
  "../server/dist/index.mjs",
];
const watchedDirectories = [
  { directory: "dist-electron", files: new Set(["main.js", "preload.js"]) },
  { directory: "../server/dist", files: new Set(["index.mjs"]) },
];
const forcedShutdownTimeoutMs = 750;
const restartDebounceMs = 120;

await waitOn({
  resources: [`tcp:${port}`, ...requiredFiles.map((filePath) => `file:${filePath}`)],
});

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

let shuttingDown = false;
let restartTimer = null;
let currentApp = null;
let hasLaunchedApp = false;
let restartQueue = Promise.resolve();
const expectedExits = new WeakSet();
const watchers = [];

function killChildTreeByPid(pid, signal) {
  if (typeof pid !== "number") {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", ...(signal === "KILL" ? ["/f"] : [])], {
      stdio: "ignore",
    });
    return;
  }
  try {
    // Each Electron app is launched as a process-group leader. Signaling the
    // group remains reliable even after the main process exits and its backend
    // has been reparented to launchd.
    process.kill(-pid, signal === "KILL" ? "SIGKILL" : "SIGTERM");
  } catch {
    // Compatibility fallback for platforms that did not create the group.
    spawnSync("pkill", [`-${signal}`, "-P", String(pid)], { stdio: "ignore" });
  }
}

function isProcessGroupAlive(pid) {
  if (process.platform === "win32") return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function discoverDescendantProcessGroups(rootPid) {
  if (process.platform === "win32" || typeof rootPid !== "number") return new Set();
  const result = spawnSync("ps", ["-ax", "-o", "pid=,ppid=,pgid="], { encoding: "utf8" });
  const processes = [];
  for (const line of (result.stdout ?? "").split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/u);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const pgid = Number(match[3]);
    if ([pid, ppid, pgid].every(Number.isSafeInteger)) processes.push({ pid, ppid, pgid });
  }

  const ownedPids = new Set([rootPid]);
  const ownedGroups = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const processInfo of processes) {
      if (ownedPids.has(processInfo.pid) || !ownedPids.has(processInfo.ppid)) continue;
      ownedPids.add(processInfo.pid);
      ownedGroups.add(processInfo.pgid);
      changed = true;
    }
  }
  return ownedGroups;
}

function signalProcessGroups(groups, signal) {
  for (const pgid of groups) {
    try {
      process.kill(-pgid, signal);
    } catch {
      // The process group may already have exited.
    }
  }
}

function cleanupStaleDevApps() {
  if (process.platform === "win32") {
    return;
  }

  const pgrepArgs = ["-f", "--", `[eE]lectron.*--tabs-dev-root=${desktopDir}`];
  const result = spawnSync("pgrep", pgrepArgs, { encoding: "utf8" });
  if (result.status !== 0) {
    return;
  }

  const appPids = (result.stdout ?? "")
    .split(/\s+/u)
    .map(Number)
    .filter((pid) => Number.isSafeInteger(pid) && pid > 1);
  for (const pid of appPids) killChildTreeByPid(pid, "TERM");

  const start = Date.now();
  while (appPids.some(isProcessGroupAlive) && Date.now() - start <= 5000) {
    spawnSync("sleep", ["0.1"]);
  }
  for (const pid of appPids.filter(isProcessGroupAlive)) killChildTreeByPid(pid, "KILL");
}

function startApp() {
  if (shuttingDown || currentApp !== null) {
    return;
  }

  const app = spawn(
    resolveElectronPath(),
    ["--tabs-dev-root=" + desktopDir, "--remote-debugging-port=9222", "dist-electron/main.js"],
    {
      cwd: desktopDir,
      env: {
        ...childEnv,
        TABS_DEV_RESTART: hasLaunchedApp ? "1" : "0",
        VITE_DEV_SERVER_URL: devServerUrl,
      },
      stdio: "inherit",
      detached: process.platform !== "win32",
    },
  );

  currentApp = app;
  hasLaunchedApp = true;

  app.once("error", () => {
    if (currentApp === app) {
      currentApp = null;
    }

    if (!shuttingDown) {
      scheduleRestart();
    }
  });

  app.once("exit", (code, signal) => {
    if (currentApp === app) {
      currentApp = null;
    }

    const exitedAbnormally =
      (code !== 0 && code !== null) ||
      (signal !== null && signal !== "SIGTERM" && signal !== "SIGINT");
    console.log(
      `[DEV-SCRIPT] App exited with code=${code} signal=${signal} abnormally=${exitedAbnormally}`,
    );
    if (!shuttingDown && !expectedExits.has(app) && exitedAbnormally) {
      scheduleRestart();
    }
  });
}

async function stopApp() {
  const app = currentApp;
  if (!app) {
    return;
  }

  currentApp = null;
  expectedExits.add(app);
  // Provider servers intentionally create their own process groups. Capture
  // those groups before terminating Electron: after the backend exits they
  // are reparented to launchd and can no longer be discovered from app.pid.
  const ownedGroups = discoverDescendantProcessGroups(app.pid);

  await new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;
    let forceTimer = null;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (forceTimer) clearTimeout(forceTimer);
      resolve();
    };

    app.once("exit", () => {
      if (process.platform === "win32" || !Array.from(ownedGroups).some(isProcessGroupAlive))
        finish();
    });
    app.kill("SIGTERM");
    if (process.platform === "win32") killChildTreeByPid(app.pid, "TERM");
    else signalProcessGroups(ownedGroups, "SIGTERM");

    pollTimer = setInterval(() => {
      if (!Array.from(ownedGroups).some(isProcessGroupAlive)) finish();
    }, 50);
    forceTimer = setTimeout(() => {
      if (settled) return;
      app.kill("SIGKILL");
      if (process.platform === "win32") killChildTreeByPid(app.pid, "KILL");
      else signalProcessGroups(ownedGroups, "SIGKILL");
      finish();
    }, forcedShutdownTimeoutMs);
  });
}

function scheduleRestart() {
  if (shuttingDown) {
    return;
  }

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    restartQueue = restartQueue
      .catch(() => undefined)
      .then(async () => {
        await stopApp();
        if (!shuttingDown) {
          startApp();
        }
      });
  }, restartDebounceMs);
}

function startWatchers() {
  for (const { directory, files } of watchedDirectories) {
    const watcher = watch(
      join(desktopDir, directory),
      { persistent: true },
      (_eventType, filename) => {
        if (typeof filename !== "string" || !files.has(filename)) {
          return;
        }

        scheduleRestart();
      },
    );

    watchers.push(watcher);
  }
}

function killChildTree(signal) {
  if (process.platform === "win32") {
    return;
  }

  // Kill direct children as a final fallback in case normal shutdown leaves stragglers.
  spawnSync("pkill", [`-${signal}`, "-P", String(process.pid)], { stdio: "ignore" });
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  for (const watcher of watchers) {
    watcher.close();
  }

  await stopApp();
  killChildTree("TERM");
  killChildTree("KILL");

  process.exit(exitCode);
}

startWatchers();
cleanupStaleDevApps();
startApp();

process.once("SIGINT", () => {
  void shutdown(130);
});
process.once("SIGTERM", () => {
  void shutdown(143);
});
process.once("SIGHUP", () => {
  void shutdown(129);
});
