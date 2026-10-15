import { describe, expect, it } from "vitest";
import { watchSubmission } from "./watch.ts";

describe("submission watching", () => {
  it("waits through approval until signed publication", async () => {
    const states = [
      { status: "review" },
      { status: "approved", published: false },
      { status: "approved", published: true },
    ];
    const updates: unknown[] = [];
    await watchSubmission(
      async () => states.shift(),
      (value) => updates.push(value),
      new AbortController().signal,
      { intervalMs: 1, timeoutMs: 1000 },
    );
    expect(updates).toHaveLength(3);
    expect(updates[1]).toMatchObject({ lifecycle: { code: "approved", terminal: false } });
    expect(updates[2]).toMatchObject({ lifecycle: { code: "published", terminal: true } });
  });
  it("ends at rejection without claiming publication", async () => {
    const updates: unknown[] = [];
    await watchSubmission(
      async () => ({ status: "rejected" }),
      (value) => updates.push(value),
      new AbortController().signal,
    );
    expect(updates[0]).toMatchObject({ lifecycle: { code: "rejected" } });
  });
  it("bounds pending watching and distinguishes timeout from rejection", async () => {
    await expect(
      watchSubmission(
        async () => ({ status: "review" }),
        () => {},
        new AbortController().signal,
        { intervalMs: 5, timeoutMs: 20 },
      ),
    ).rejects.toThrow("not a rejection");
  });
  it("cancels without another request and rejects invented registry states", async () => {
    const cancel = new AbortController();
    cancel.abort();
    let calls = 0;
    await expect(
      watchSubmission(
        async () => {
          calls++;
          return { status: "review" };
        },
        () => {},
        cancel.signal,
      ),
    ).rejects.toThrow();
    expect(calls).toBe(0);
    await expect(
      watchSubmission(
        async () => ({ status: "done" }),
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow("unknown submission state");
  });
});
