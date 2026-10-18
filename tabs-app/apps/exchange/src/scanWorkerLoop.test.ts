import { expect, it, vi } from "vitest";
import { runScanWorkerLoop } from "./scanWorkerLoop";

it("drains a claimed scan before shutdown and records its completion", async () => {
  const controller = new AbortController();
  let finish!: (completed: boolean) => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const heartbeat = vi.fn(async () => {});
  const scan = vi.fn(() => {
    started();
    return new Promise<boolean>((resolve) => {
      finish = resolve;
    });
  });
  let stopped = false;
  const running = runScanWorkerLoop({
    signal: controller.signal,
    heartbeat,
    scan,
    report: vi.fn(),
  }).then(() => {
    stopped = true;
  });
  await began;
  controller.abort();
  await Promise.resolve();
  expect(stopped).toBe(false);
  finish(true);
  await running;
  expect(scan).toHaveBeenCalledTimes(1);
  expect(heartbeat).toHaveBeenCalledWith(true);
});

it("retries a failed scan without overlapping jobs and stops idle waits promptly", async () => {
  const controller = new AbortController();
  const report = vi.fn();
  const scan = vi
    .fn()
    .mockRejectedValueOnce(new Error("temporary failure"))
    .mockImplementation(async () => {
      controller.abort();
      return false;
    });
  await runScanWorkerLoop({
    signal: controller.signal,
    heartbeat: async () => {},
    scan,
    report,
    retryMs: 1,
    idleMs: 60_000,
  });
  expect(scan).toHaveBeenCalledTimes(2);
  expect(report).toHaveBeenCalledTimes(1);
});
