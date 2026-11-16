import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";

import { clearGitHubReadMemo, memoizeGitHubRead } from "./GitHubReadMemo.ts";

describe("memoizeGitHubRead", () => {
  it("serves a held success without reading again, until cleared", async () => {
    clearGitHubReadMemo();
    let reads = 0;
    const read = Effect.sync(() => ++reads);
    const run = () => Effect.runPromise(memoizeGitHubRead("k", 60_000, read));
    expect(await run()).toBe(1);
    expect(await run()).toBe(1);
    clearGitHubReadMemo();
    expect(await run()).toBe(2);
  });

  it("never holds a failure", async () => {
    clearGitHubReadMemo();
    let reads = 0;
    const read = Effect.suspend(() =>
      ++reads === 1 ? Effect.fail("boom") : Effect.succeed(reads),
    );
    const run = () => Effect.runPromise(memoizeGitHubRead("f", 60_000, read));
    await expect(run()).rejects.toBeDefined();
    expect(await run()).toBe(2);
  });

  it("expires after the ttl", async () => {
    clearGitHubReadMemo();
    let reads = 0;
    const read = Effect.sync(() => ++reads);
    await Effect.runPromise(memoizeGitHubRead("t", 0, read));
    expect(await Effect.runPromise(memoizeGitHubRead("t", 0, read))).toBe(2);
  });
});
