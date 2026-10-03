import { describe, expect, it } from "vitest";
import * as Option from "effect/Option";

import {
  readProcessDiagnostics,
  readProcessResourceHistory,
  signalProcess,
} from "./ProcessDiagnostics.ts";

describe("ProcessDiagnostics", () => {
  it("reports the server and only its process tree", async () => {
    const result = await readProcessDiagnostics();
    expect(result.serverPid).toBe(process.pid);
    expect(result.processes.some((entry) => entry.pid === process.pid)).toBe(true);
    expect(result.processCount).toBe(result.processes.length);
    expect(result.totalRssBytes).toBeGreaterThan(0);
    expect(result.processes.find((entry) => entry.pid === process.pid)).toMatchObject({
      category: "server",
      attribution: "Tabs backend",
    });
  });

  it("refuses to signal the server process", async () => {
    const result = await signalProcess({ pid: process.pid, signal: "SIGINT" });
    expect(result.signaled).toBe(false);
    expect(Option.isSome(result.message)).toBe(true);
  });

  it("retains samples for resource history", async () => {
    const result = await readProcessResourceHistory({ windowMs: 60_000, bucketMs: 5_000 });
    expect(result.retainedSampleCount).toBeGreaterThan(0);
    expect(result.topProcesses.some((entry) => entry.pid === process.pid)).toBe(true);
  });
});
