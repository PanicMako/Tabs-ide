import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  formatHeadlessInfo,
  getPidFilePath,
  getServiceUnitPath,
  isProcessRunning,
  readPidFile,
  removePidFile,
  renderLaunchdPlist,
  renderSystemdUnit,
  writePidFile,
} from "./BackgroundService.ts";

describe("BackgroundService", () => {
  const sampleOptions = {
    name: "tabs",
    nodePath: "/usr/local/bin/node",
    scriptPath: "/opt/tabs/dist/index.mjs",
    baseDir: "/var/tabs",
    logPath: "/var/tabs/logs/server.log",
    environment: {
      NODE_ENV: "production",
    },
  };

  it("renders a valid systemd service unit", () => {
    const unit = renderSystemdUnit(sampleOptions);
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("Description=Tabs headless server");
    expect(unit).toContain("[Service]");
    expect(unit).toContain("Environment=NODE_ENV=production");
    expect(unit).toContain("Environment=TABS_HOME=/var/tabs");
    expect(unit).toContain(
      'ExecStart="/usr/local/bin/node" "/opt/tabs/dist/index.mjs" serve --home-dir "/var/tabs"',
    );
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("[Install]");
    expect(unit).toContain("WantedBy=default.target");
  });

  it("renders a valid launchd plist", () => {
    const plist = renderLaunchdPlist(sampleOptions);
    expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(plist).toContain("<key>Label</key>");
    expect(plist).toContain("<string>com.tabs.server</string>");
    expect(plist).toContain("<key>ProgramArguments</key>");
    expect(plist).toContain("<string>/usr/local/bin/node</string>");
    expect(plist).toContain("<string>serve</string>");
    expect(plist).toContain("<string>--home-dir</string>");
    expect(plist).toContain("<string>/var/tabs</string>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<true/>");
    expect(plist).toContain("<key>StandardOutPath</key>");
    expect(plist).toContain("<string>/var/tabs/logs/server.log</string>");
  });

  it("resolves service unit paths for supported platforms", () => {
    const darwinPath = getServiceUnitPath("darwin", "/Users/test");
    expect(darwinPath).toBe("/Users/test/Library/LaunchAgents/com.tabs.server.plist");

    const linuxPath = getServiceUnitPath("linux", "/home/test");
    expect(linuxPath).toBe("/home/test/.config/systemd/user/tabs.service");

    const winPath = getServiceUnitPath("win32", "C:\\Users\\test");
    expect(winPath).toBeNull();
  });

  it("manages PID file lifecycle", async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tabs-pid-test-"));
    try {
      const pidFile = getPidFilePath(tempDir);
      expect(pidFile).toBe(path.join(tempDir, "tabs.pid"));

      // Non-existent file reads as null
      expect(await readPidFile(tempDir)).toBeNull();

      // Write PID
      await writePidFile(tempDir, 12345);
      expect(await readPidFile(tempDir)).toBe(12345);

      // Remove PID
      await removePidFile(tempDir);
      expect(await readPidFile(tempDir)).toBeNull();
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("checks whether a process is alive", () => {
    expect(isProcessRunning(process.pid)).toBe(true);
    expect(isProcessRunning(99999999)).toBe(false);
  });

  it("formats headless server startup info", () => {
    const info = formatHeadlessInfo({
      port: 4000,
      host: "0.0.0.0",
      authToken: "secret-token-123",
      baseDir: "/data/tabs",
    });
    expect(info).toContain("Tabs headless server is active and running in background.");
    expect(info).toContain("Listening at: http://0.0.0.0:4000");
    expect(info).toContain("Auth token:   [configured]");
    expect(info).not.toContain("secret-token-123");
    expect(info).toContain("Home dir:     /data/tabs");
  });
});
