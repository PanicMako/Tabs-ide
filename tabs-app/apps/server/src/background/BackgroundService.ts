import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runProcess } from "../processRunner.ts";

export interface ServiceOptions {
  readonly name?: string;
  readonly nodePath: string;
  readonly scriptPath: string;
  readonly baseDir: string;
  readonly logPath: string;
  readonly unitPath?: string;
  readonly environment?: Record<string, string>;
}

export interface BackgroundServiceStatus {
  readonly supported: boolean;
  readonly platform: NodeJS.Platform;
  readonly installed: boolean;
  readonly running: boolean;
  readonly unitPath: string | null;
  readonly logPath: string;
  readonly pid: number | null;
}

export function renderSystemdUnit(options: ServiceOptions): string {
  const envPairs = Object.entries(options.environment ?? {}).map(
    ([k, v]) => `Environment=${k}=${v}`,
  );
  envPairs.push(`Environment=TABS_HOME=${options.baseDir}`);
  const envLines = envPairs.join("\n");

  return [
    "[Unit]",
    "Description=Tabs headless server",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    "WorkingDirectory=%h",
    envLines,
    `ExecStart="${options.nodePath}" "${options.scriptPath}" serve --home-dir "${options.baseDir}"`,
    "Restart=always",
    "RestartSec=5",
    `StandardOutput=append:${options.logPath}`,
    `StandardError=append:${options.logPath}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

export function renderLaunchdPlist(options: ServiceOptions): string {
  const label = options.name ? `com.${options.name}.server` : "com.tabs.server";
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  <string>${label}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    `    <string>${options.nodePath}</string>`,
    `    <string>${options.scriptPath}</string>`,
    `    <string>serve</string>`,
    `    <string>--home-dir</string>`,
    `    <string>${options.baseDir}</string>`,
    `  </array>`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    `  <key>KeepAlive</key>`,
    `  <true/>`,
    `  <key>ThrottleInterval</key>`,
    `  <integer>5</integer>`,
    `  <key>StandardOutPath</key>`,
    `  <string>${options.logPath}</string>`,
    `  <key>StandardErrorPath</key>`,
    `  <string>${options.logPath}</string>`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    `    <key>TABS_HOME</key>`,
    `    <string>${options.baseDir}</string>`,
    `  </dict>`,
    `</dict>`,
    `</plist>`,
  ].join("\n");
}

export function getServiceUnitPath(
  platform: NodeJS.Platform = process.platform,
  homeDir = os.homedir(),
): string | null {
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "LaunchAgents", "com.tabs.server.plist");
  }
  if (platform === "linux") {
    return path.join(homeDir, ".config", "systemd", "user", "tabs.service");
  }
  return null;
}

export function getPidFilePath(baseDir: string): string {
  return path.join(baseDir, "tabs.pid");
}

export async function writePidFile(baseDir: string, pid: number = process.pid): Promise<string> {
  const pidFile = getPidFilePath(baseDir);
  await fs.promises.mkdir(baseDir, { recursive: true });
  await fs.promises.writeFile(pidFile, String(pid), "utf8");
  return pidFile;
}

export async function readPidFile(baseDir: string): Promise<number | null> {
  const pidFile = getPidFilePath(baseDir);
  try {
    const content = await fs.promises.readFile(pidFile, "utf8");
    const pid = parseInt(content.trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export async function removePidFile(baseDir: string): Promise<void> {
  const pidFile = getPidFilePath(baseDir);
  try {
    await fs.promises.unlink(pidFile);
  } catch {
    // ignore if already deleted
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function stopDaemon(
  baseDir: string,
  timeoutMs = 5000,
): Promise<{ stopped: boolean; pid: number | null; message: string }> {
  const pid = await readPidFile(baseDir);
  if (!pid) {
    return { stopped: false, pid: null, message: "No active Tabs daemon PID file found." };
  }

  if (!isProcessRunning(pid)) {
    await removePidFile(baseDir);
    return {
      stopped: true,
      pid,
      message: `Process ${pid} was not running; cleaned up stale PID file.`,
    };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    return { stopped: false, pid, message: `Failed to signal process ${pid}: ${error}` };
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessRunning(pid)) {
      await removePidFile(baseDir);
      return { stopped: true, pid, message: `Tabs daemon (PID ${pid}) stopped gracefully.` };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Fallback force kill
  try {
    process.kill(pid, "SIGKILL");
    await removePidFile(baseDir);
    return { stopped: true, pid, message: `Tabs daemon (PID ${pid}) killed after timeout.` };
  } catch (error) {
    return { stopped: false, pid, message: `Failed to terminate process ${pid}: ${error}` };
  }
}

export async function checkServiceStatus(
  baseDir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<BackgroundServiceStatus> {
  const supported = platform === "darwin" || platform === "linux";
  const unitPath = getServiceUnitPath(platform);
  const logPath = path.join(baseDir, "logs", "tabs-service.log");
  const daemonPid = await readPidFile(baseDir);
  const running = daemonPid !== null && isProcessRunning(daemonPid);

  let installed = false;
  if (unitPath) {
    try {
      await fs.promises.access(unitPath);
      installed = true;
    } catch {
      installed = false;
    }
  }

  return {
    supported,
    platform,
    installed,
    running,
    unitPath,
    logPath,
    pid: running ? daemonPid : null,
  };
}

export async function installService(
  options: ServiceOptions,
): Promise<{ success: boolean; unitPath: string }> {
  const unitPath = options.unitPath ?? getServiceUnitPath(process.platform);
  if (!unitPath) {
    throw new Error(`Background service installation is not supported on ${process.platform}.`);
  }

  await fs.promises.mkdir(path.dirname(unitPath), { recursive: true });
  await fs.promises.mkdir(path.dirname(options.logPath), { recursive: true });

  if (process.platform === "darwin") {
    const plistContent = renderLaunchdPlist(options);
    await fs.promises.writeFile(unitPath, plistContent, "utf8");
    try {
      await runProcess("launchctl", ["load", "-w", unitPath], { allowNonZeroExit: true });
    } catch {
      // ignore
    }
  } else if (process.platform === "linux") {
    const unitContent = renderSystemdUnit(options);
    await fs.promises.writeFile(unitPath, unitContent, "utf8");
    try {
      await runProcess("systemctl", ["--user", "daemon-reload"], { allowNonZeroExit: true });
      await runProcess("systemctl", ["--user", "enable", "--now", "tabs.service"], {
        allowNonZeroExit: true,
      });
    } catch {
      // ignore
    }
  }

  return { success: true, unitPath };
}

export async function uninstallService(
  platform: NodeJS.Platform = process.platform,
): Promise<{ removed: boolean }> {
  const unitPath = getServiceUnitPath(platform);
  if (!unitPath) return { removed: false };

  try {
    if (platform === "darwin") {
      await runProcess("launchctl", ["unload", "-w", unitPath], { allowNonZeroExit: true });
    } else if (platform === "linux") {
      await runProcess("systemctl", ["--user", "disable", "--now", "tabs.service"], {
        allowNonZeroExit: true,
      });
      await runProcess("systemctl", ["--user", "daemon-reload"], { allowNonZeroExit: true });
    }
    await fs.promises.unlink(unitPath);
    return { removed: true };
  } catch {
    return { removed: false };
  }
}

export function formatHeadlessInfo(config: {
  readonly port: number;
  readonly host?: string | undefined;
  readonly authToken?: string | undefined;
  readonly baseDir: string;
}): string {
  const bindHost = config.host ?? "127.0.0.1";
  const url = `http://${bindHost}:${config.port}`;
  const lines = [
    "----------------------------------------------------------------",
    "Tabs headless server is active and running in background.",
    `Listening at: ${url}`,
    `Home dir:     ${config.baseDir}`,
  ];
  if (config.authToken) {
    // The token can be recovered from the configured environment/state. Never
    // echo it into terminals, CI logs, crash reports, or screen recordings.
    lines.push("Auth token:   [configured]");
  }
  lines.push("----------------------------------------------------------------");
  return lines.join("\n");
}
