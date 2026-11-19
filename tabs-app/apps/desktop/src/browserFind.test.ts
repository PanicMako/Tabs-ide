import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { findInPage, stopFindInPage, type FindableContents } from "./browserFind";

function fakeContents(script: (emit: EventEmitter, id: number) => void) {
  const emitter = new EventEmitter();
  const calls: unknown[] = [];
  const contents = {
    findInPage: vi.fn((text: string, options?: unknown) => {
      calls.push([text, options]);
      const id = 7;
      queueMicrotask(() => script(emitter, id));
      return id;
    }),
    stopFindInPage: vi.fn(),
    on: (event: string, listener: (...args: any[]) => void) => emitter.on(event, listener),
    removeListener: (event: string, listener: (...args: any[]) => void) =>
      emitter.removeListener(event, listener),
  } as unknown as FindableContents;
  return { contents, emitter, calls };
}

describe("findInPage", () => {
  it("resolves with the final count for its own request", async () => {
    const { contents, emitter } = fakeContents((e, id) => {
      e.emit(
        "found-in-page",
        {},
        { requestId: 99, activeMatchOrdinal: 1, matches: 50, finalUpdate: true },
      );
      e.emit(
        "found-in-page",
        {},
        { requestId: id, activeMatchOrdinal: 1, matches: 2, finalUpdate: false },
      );
      e.emit(
        "found-in-page",
        {},
        { requestId: id, activeMatchOrdinal: 2, matches: 3, finalUpdate: true },
      );
    });
    await expect(findInPage(contents, "term")).resolves.toEqual({ matches: 3, activeMatch: 2 });
    expect(emitter.listenerCount("found-in-page")).toBe(0);
  });

  it("searches forward by default and can step backwards", async () => {
    const forward = fakeContents((e, id) =>
      e.emit(
        "found-in-page",
        {},
        { requestId: id, activeMatchOrdinal: 1, matches: 1, finalUpdate: true },
      ),
    );
    await findInPage(forward.contents, "a");
    expect(forward.calls[0]).toEqual(["a", { forward: true, findNext: false }]);
    const back = fakeContents((e, id) =>
      e.emit(
        "found-in-page",
        {},
        { requestId: id, activeMatchOrdinal: 1, matches: 1, finalUpdate: true },
      ),
    );
    await findInPage(back.contents, "a", { forward: false, findNext: true });
    expect(back.calls[0]).toEqual(["a", { forward: false, findNext: true }]);
  });

  it("gives up with what it has if the page never answers", async () => {
    const { contents, emitter } = fakeContents(() => {});
    await expect(findInPage(contents, "x", {}, 20)).resolves.toEqual({
      matches: 0,
      activeMatch: 0,
    });
    expect(emitter.listenerCount("found-in-page")).toBe(0);
  });

  it("clears the highlights for an empty search", async () => {
    const { contents } = fakeContents(() => {});
    await expect(findInPage(contents, "")).resolves.toEqual({ matches: 0, activeMatch: 0 });
    expect(contents.stopFindInPage).toHaveBeenCalledWith("clearSelection");
    stopFindInPage(contents);
    expect(contents.stopFindInPage).toHaveBeenCalledTimes(2);
  });
});
