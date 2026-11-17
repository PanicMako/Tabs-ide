import { describe, expect, it } from "vitest";

import { bringBackBlockedReason, isUnusedSideChat, sideChatScope } from "./useSideChat";

describe("isUnusedSideChat", () => {
  it("is unused until a message, an item or a turn exists", () => {
    expect(isUnusedSideChat({ messages: [], visibleItemCount: 0, latestTurn: null })).toBe(true);
    expect(isUnusedSideChat({ messages: [], latestTurn: null })).toBe(true);
    expect(isUnusedSideChat({ messages: [{}], latestTurn: null })).toBe(false);
    expect(isUnusedSideChat({ messages: [], visibleItemCount: 2, latestTurn: null })).toBe(false);
    expect(isUnusedSideChat({ messages: [], latestTurn: {} })).toBe(false);
  });
});

describe("bringBackBlockedReason", () => {
  it("only allows Bring back while the parent is idle and the side chat has a reply", () => {
    expect(bringBackBlockedReason({ parentIdle: false, sideChatHasReply: true })).toBe(
      "Available when the main thread is idle.",
    );
    expect(bringBackBlockedReason({ parentIdle: true, sideChatHasReply: false })).toBe(
      "Available after a finished reply.",
    );
    expect(bringBackBlockedReason({ parentIdle: true, sideChatHasReply: true })).toBeNull();
  });
});

describe("sideChatScope", () => {
  it("matches the right panel's per-thread scope", () => {
    expect(sideChatScope("env", "thread-1" as never)).toBe("env:thread-1");
    expect(sideChatScope(undefined, "thread-1" as never)).toBe("local:thread-1");
  });
});
