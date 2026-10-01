import { describe, expect, it } from "vitest";
import { createNativeCodeHostShutdown } from "./nativeCodeHostShutdown";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("native Code-OSS shutdown", () => {
  it("keeps dependencies alive until every lifecycle join settles", async () => {
    const first = deferred();
    const second = deferred();
    const calls: string[] = [];
    const shutdown = createNativeCodeHostShutdown(
      (event) => {
        calls.push("event");
        event.join("first", first.promise);
        event.join("second", second.promise);
      },
      () => {
        calls.push("cleanup");
      },
    );
    const pending = shutdown();
    expect(shutdown()).toBe(pending);
    await Promise.resolve();
    first.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["event"]);
    second.resolve();
    await pending;
    expect(calls).toEqual(["event", "cleanup"]);
    await shutdown();
    expect(calls).toEqual(["event", "cleanup"]);
  });

  it("reports failed joins after other joins finish and cleanup runs", async () => {
    const failing = deferred();
    const finishing = deferred();
    let cleaned = false;
    const shutdown = createNativeCodeHostShutdown(
      (event) => {
        event.join("failed", failing.promise);
        event.join("finishing", finishing.promise);
      },
      () => {
        cleaned = true;
      },
    );
    const pending = shutdown();
    const assertion = expect(pending).rejects.toThrow("Code-OSS shutdown joins failed");
    await Promise.resolve();
    failing.reject(new Error("host failed"));
    await Promise.resolve();
    expect(cleaned).toBe(false);
    finishing.resolve();
    await assertion;
    expect(cleaned).toBe(true);
  });

  it("cleans up when event delivery throws and shares reentrant shutdown", async () => {
    let cleaned = false;
    let reentrant: Promise<void> | undefined;
    const shutdown = createNativeCodeHostShutdown(
      () => {
        reentrant = shutdown();
        throw new Error("delivery failed");
      },
      () => {
        cleaned = true;
      },
    );
    const pending = shutdown();
    await expect(pending).rejects.toThrow("Code-OSS shutdown joins failed");
    expect(reentrant).toBe(pending);
    expect(cleaned).toBe(true);
  });
});
