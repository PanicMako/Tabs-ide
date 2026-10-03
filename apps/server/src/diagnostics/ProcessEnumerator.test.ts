import { describe, expect, it } from "vitest";

import {
  cleanUNCPrefix,
  computeLinuxDeltaCpu,
  parseElapsed,
  parseProcessRows,
  readSystemProcessRows,
  readWindowsProcessRowsWithModule,
  type ProcessRow,
  type WindowsProcessCpuInfo,
  type WindowsProcessInfo,
  type WindowsProcessTreeModule,
} from "./ProcessEnumerator.ts";

describe("ProcessEnumerator", () => {
  describe("cleanUNCPrefix", () => {
    it("strips Win32 device and NT namespaces from command lines", () => {
      expect(cleanUNCPrefix("\\\\?\\C:\\Program Files\\Tabs\\tabs.exe")).toBe(
        "C:\\Program Files\\Tabs\\tabs.exe",
      );
      expect(cleanUNCPrefix("\\??\\C:\\Windows\\System32\\cmd.exe")).toBe(
        "C:\\Windows\\System32\\cmd.exe",
      );
      expect(cleanUNCPrefix('"\\\\?\\C:\\Users\\dev\\node.exe" server.js')).toBe(
        '"C:\\Users\\dev\\node.exe" server.js',
      );
      expect(cleanUNCPrefix('"\\??\\C:\\Users\\dev\\powershell.exe"')).toBe(
        '"C:\\Users\\dev\\powershell.exe"',
      );
      expect(cleanUNCPrefix("node ./dist/index.mjs")).toBe("node ./dist/index.mjs");
    });
  });

  describe("parseElapsed", () => {
    it("parses diverse ps etime string formats into total seconds", () => {
      expect(parseElapsed("05:30")).toBe(330);
      expect(parseElapsed("01:15:20")).toBe(4520);
      expect(parseElapsed("2-04:10:05")).toBe(2 * 86400 + 4 * 3600 + 10 * 60 + 5);
      expect(parseElapsed("00:00")).toBe(0);
    });
  });

  describe("parseProcessRows", () => {
    it("parses ps output format accurately", () => {
      const output = [
        "  PID  PPID STAT %CPU   RSS     ELAPSED COMMAND",
        "  101     1 S     0.5 45056       02:15 /Applications/Tabs.app/Contents/MacOS/Tabs",
        "  102   101 R    12.4 92160       01:30 node apps/server/dist/index.mjs",
      ].join("\n");

      const rows = parseProcessRows(output);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({
        pid: 101,
        ppid: 1,
        status: "S",
        cpuPercent: 0.5,
        rssBytes: 45056 * 1024,
        elapsedSeconds: 135,
        command: "/Applications/Tabs.app/Contents/MacOS/Tabs",
      });
      expect(rows[1]).toEqual({
        pid: 102,
        ppid: 101,
        status: "R",
        cpuPercent: 12.4,
        rssBytes: 92160 * 1024,
        elapsedSeconds: 90,
        command: "node apps/server/dist/index.mjs",
      });
    });
  });

  describe("Windows process tree mapping", () => {
    it("converts @vscode/windows-process-tree data into standard ProcessRow format", async () => {
      const mockProcessList: WindowsProcessInfo[] = [
        {
          pid: 1000,
          ppid: 500,
          name: "Tabs.exe",
          memory: 150 * 1024 * 1024,
          commandLine: "\\\\?\\C:\\Users\\dev\\AppData\\Local\\Tabs\\Tabs.exe",
        },
        {
          pid: 1001,
          ppid: 1000,
          name: "node.exe",
          memory: 85 * 1024 * 1024,
          commandLine: '"C:\\Program Files\\nodejs\\node.exe" server.mjs',
        },
        {
          pid: 1002,
          ppid: 1001,
          name: "cmd.exe",
          memory: 12 * 1024 * 1024,
          commandLine: "C:\\Windows\\System32\\cmd.exe /c dir",
        },
      ];

      const mockCpuList: WindowsProcessCpuInfo[] = [
        { ...mockProcessList[0]!, cpu: 2.5 },
        { ...mockProcessList[1]!, cpu: 14.8 },
        { ...mockProcessList[2]!, cpu: 0.1 },
      ];

      const mockModule: WindowsProcessTreeModule = {
        ProcessDataFlag: { None: 0, Memory: 1, CommandLine: 2 },
        getProcessList: (rootPid, callback) => {
          callback(mockProcessList);
        },
        getProcessCpuUsage: (processList, callback) => {
          callback(mockCpuList);
        },
      };

      const rows = await readWindowsProcessRowsWithModule(mockModule, [1000]);
      expect(rows).toHaveLength(3);

      expect(rows[0]).toMatchObject({
        pid: 1000,
        ppid: 500,
        status: "running",
        cpuPercent: 2.5,
        rssBytes: 150 * 1024 * 1024,
        command: "C:\\Users\\dev\\AppData\\Local\\Tabs\\Tabs.exe",
      });

      expect(rows[1]).toMatchObject({
        pid: 1001,
        ppid: 1000,
        status: "running",
        cpuPercent: 14.8,
        rssBytes: 85 * 1024 * 1024,
        command: '"C:\\Program Files\\nodejs\\node.exe" server.mjs',
      });

      expect(rows[2]).toMatchObject({
        pid: 1002,
        ppid: 1001,
        status: "running",
        cpuPercent: 0.1,
        rssBytes: 12 * 1024 * 1024,
        command: "C:\\Windows\\System32\\cmd.exe /c dir",
      });
    });
  });

  describe("Linux CPU delta calculation", () => {
    it("corrects lifetime average by computing delta usage over system ticks", () => {
      const initialRows: ProcessRow[] = [
        {
          pid: 100,
          ppid: 1,
          status: "R",
          cpuPercent: 1.2, // ps lifetime average was low
          rssBytes: 50000000,
          elapsedSeconds: 3600,
          command: "tabs-server",
        },
        {
          pid: 101,
          ppid: 100,
          status: "S",
          cpuPercent: 15.0, // ps lifetime average was high from past spike
          rssBytes: 20000000,
          elapsedSeconds: 3600,
          command: "idle-worker",
        },
      ];

      // Previous sample: system had 100,000 ticks
      const prevSnapshot = {
        timestampMs: 1000,
        totalSystemTicks: 100_000,
        processTicks: new Map([
          [100, 1_000],
          [101, 2_000],
        ]),
      };

      // Current sample 1 second later: system gained 1,000 ticks across 4 CPU cores
      // PID 100 consumed 250 ticks (25% of all CPU capacity)
      // PID 101 consumed 0 ticks (0% active CPU)
      const currSnapshot = {
        timestampMs: 2000,
        totalSystemTicks: 101_000,
        processTicks: new Map([
          [100, 1_250],
          [101, 2_000],
        ]),
      };

      const corrected = computeLinuxDeltaCpu(initialRows, currSnapshot, prevSnapshot, 4);

      // PID 100: (250 / 1000) * 100 * 4 = 100% of a single core (or 25% of 4 cores)
      // With cpuCount=4, (250/1000)*100*4 = 100%
      expect(corrected[0]!.cpuPercent).toBe(100);

      // PID 101: 0 ticks delta = 0% CPU (overriding the stale 15% lifetime average)
      expect(corrected[1]!.cpuPercent).toBe(0);
    });
  });

  describe("readSystemProcessRows live execution", () => {
    it("returns active processes including the current process", async () => {
      const rows = await readSystemProcessRows();
      expect(rows.length).toBeGreaterThan(0);
      const self = rows.find((r) => r.pid === process.pid);
      expect(self).toBeDefined();
      expect(self!.rssBytes).toBeGreaterThan(0);
      expect(typeof self!.command).toBe("string");
      expect(self!.command.length).toBeGreaterThan(0);
    });
  });
});
