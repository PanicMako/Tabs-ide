import * as Path from "node:path";
import { describe, expect, it } from "vitest";
import { runExtensionLogicSpike, runInDisposableLogicWorker } from "./extensionLogicSpike.ts";

describe("disposable QuickJS-in-WASM logic probe", () => {
  it("passes JSON input and output without exposing Node or network APIs", async () => {
    const result = await runExtensionLogicSpike(
      `globalThis.run = (input) => ({
        sum: input.a + input.b,
        process: typeof process,
        require: typeof require,
        fetch: typeof fetch,
        tabs: typeof tabsExtension
      });`,
      { a: 2, b: 3 },
    );
    expect(result).toEqual({
      sum: 5,
      process: "undefined",
      require: "undefined",
      fetch: "undefined",
      tabs: "undefined",
    });
  });

  it("interrupts an infinite loop and recovers for a subsequent invocation", async () => {
    await expect(
      runExtensionLogicSpike("globalThis.run = () => { while (true) {} };", null, {
        timeoutMs: 500,
      }),
    ).rejects.toThrow();
    await expect(runExtensionLogicSpike("globalThis.run = () => 42;", null)).resolves.toBe(42);
  });

  it("terminates a worker stuck outside QuickJS and recovers", async () => {
    const hung = Path.join(__dirname, "extensionLogicHangWorker.fixture.js");
    await expect(
      runInDisposableLogicWorker(hung, "globalThis.run = () => 1;", null, { timeoutMs: 100 }),
    ).rejects.toThrow("deadline exceeded");
    await expect(runExtensionLogicSpike("globalThis.run = () => 7;", null)).resolves.toBe(7);
  });

  it("reports a crashed worker without poisoning the next invocation", async () => {
    const crashed = Path.join(__dirname, "extensionLogicCrashWorker.fixture.js");
    await expect(
      runInDisposableLogicWorker(crashed, "globalThis.run = () => 1;", null),
    ).rejects.toThrow("worker exited (42)");
    await expect(runExtensionLogicSpike("globalThis.run = () => 9;", null)).resolves.toBe(9);
  });

  it("fails closed on guest memory exhaustion", async () => {
    await expect(
      runExtensionLogicSpike("globalThis.run = () => new Array(2_000_000).fill(1);", null),
    ).rejects.toThrow();
  });

  it("cancels a running guest and starts a fresh worker afterwards", async () => {
    const controller = new AbortController();
    const active = runExtensionLogicSpike("globalThis.run = () => { while (true) {} };", null, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(active).rejects.toThrow("cancelled");
    await expect(
      runExtensionLogicSpike("globalThis.run = (input) => input.value;", { value: "ready" }),
    ).resolves.toBe("ready");
  });

  it("rejects oversized input, output, and asynchronous results", async () => {
    await expect(
      runExtensionLogicSpike("globalThis.run = () => 1;", "x".repeat(70_000)),
    ).rejects.toThrow("input exceeds");
    await expect(
      runExtensionLogicSpike("globalThis.run = () => 'x'.repeat(70_000);", null),
    ).rejects.toThrow("output exceeds");
    await expect(runExtensionLogicSpike("globalThis.run = async () => 1;", null)).rejects.toThrow(
      "Async extension logic",
    );
  });
});
