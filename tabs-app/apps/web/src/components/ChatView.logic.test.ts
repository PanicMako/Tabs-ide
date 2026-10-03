import { MessageId, ThreadId } from "@tabs/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  FOLLOW_UP_COMPOSER_PLACEHOLDER,
  GENERIC_COMPOSER_PLACEHOLDER,
  MAX_REMEMBERED_SCROLL_POSITIONS,
  MAX_REMEMBERED_THREAD_TIMELINES,
  buildExpiredTerminalContextToastCopy,
  deriveComposerSendState,
  isPaintOnlyThreadTimeline,
  peekHeldThreadTimeline,
  peekRememberedThreadScrollTop,
  peekRememberedThreadTimeline,
  rememberReadyThreadTimeline,
  rememberThreadScrollTop,
  resetHeldThreadTimeline,
  resetRememberedThreadScrollTops,
  resolveBaseComposerPlaceholder,
  resolveThreadSwitchTimeline,
  shouldPauseAutoScrollOnUserScrollIntent,
  shouldUseCenteredEmptyComposer,
  threadKeysShareEnvironment,
  timelineHasEphemeralPreviewUrls,
} from "./ChatView.logic";

describe("deriveComposerSendState", () => {
  it("treats structured preview context as sendable without typed text", () => {
    const state = deriveComposerSendState({
      prompt: "",
      imageCount: 0,
      contextCount: 1,
      terminalContexts: [],
    });

    expect(state.hasSendableContent).toBe(true);
  });

  it("treats an attached file as sendable without typed text", () => {
    const state = deriveComposerSendState({
      prompt: "",
      imageCount: 0,
      fileCount: 1,
      terminalContexts: [],
    });

    expect(state.hasSendableContent).toBe(true);
  });

  it("treats expired terminal pills as non-sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "\uFFFC",
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.sendableTerminalContexts).toEqual([]);
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(false);
  });

  it("keeps text sendable while excluding expired terminal pills", () => {
    const state = deriveComposerSendState({
      prompt: `yoo \uFFFC waddup`,
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("yoo  waddup");
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(true);
  });
});

describe("buildExpiredTerminalContextToastCopy", () => {
  it("formats clear empty-state guidance", () => {
    expect(buildExpiredTerminalContextToastCopy(1, "empty")).toEqual({
      title: "Expired terminal context won't be sent",
      description: "Remove it or re-add it to include terminal output.",
    });
  });

  it("formats omission guidance for sent messages", () => {
    expect(buildExpiredTerminalContextToastCopy(2, "omitted")).toEqual({
      title: "Expired terminal contexts omitted from message",
      description: "Re-add it if you want that terminal output included.",
    });
  });
});

describe("shouldPauseAutoScrollOnUserScrollIntent", () => {
  it("pauses auto-scroll for upward user scroll intent while streaming", () => {
    expect(
      shouldPauseAutoScrollOnUserScrollIntent({
        shouldAutoScroll: true,
        intentDirection: "up",
        canScrollUp: true,
      }),
    ).toBe(true);
  });

  it("keeps auto-scroll enabled for downward movement", () => {
    expect(
      shouldPauseAutoScrollOnUserScrollIntent({
        shouldAutoScroll: true,
        intentDirection: "down",
        canScrollUp: true,
      }),
    ).toBe(false);
  });

  it("does not change state when auto-scroll is already paused", () => {
    expect(
      shouldPauseAutoScrollOnUserScrollIntent({
        shouldAutoScroll: false,
        intentDirection: "up",
        canScrollUp: true,
      }),
    ).toBe(false);
  });

  it("does not pause auto-scroll when the viewport cannot move upward", () => {
    expect(
      shouldPauseAutoScrollOnUserScrollIntent({
        shouldAutoScroll: true,
        intentDirection: "up",
        canScrollUp: false,
      }),
    ).toBe(false);
  });
});

describe("shouldUseCenteredEmptyComposer", () => {
  it("centers only a truly fresh local draft thread", () => {
    expect(
      shouldUseCenteredEmptyComposer({
        isLocalDraftThread: true,
        hasTimelineEntries: false,
        isWorking: false,
      }),
    ).toBe(true);
  });

  it("keeps existing server threads docked even when they have no timeline entries", () => {
    expect(
      shouldUseCenteredEmptyComposer({
        isLocalDraftThread: false,
        hasTimelineEntries: false,
        isWorking: false,
      }),
    ).toBe(false);
  });

  it("keeps the welcome text visible even when a draft already has content", () => {
    expect(
      shouldUseCenteredEmptyComposer({
        isLocalDraftThread: true,
        hasTimelineEntries: false,
        isWorking: false,
      }),
    ).toBe(true);
  });
});

describe("resolveBaseComposerPlaceholder", () => {
  it("uses the generic placeholder for a history-less thread", () => {
    expect(
      resolveBaseComposerPlaceholder({
        hasConversationHistory: false,
        phase: "disconnected",
      }),
    ).toBe(GENERIC_COMPOSER_PLACEHOLDER);
  });

  it("uses the follow-up placeholder only for disconnected threads with history", () => {
    expect(
      resolveBaseComposerPlaceholder({
        hasConversationHistory: true,
        phase: "disconnected",
      }),
    ).toBe(FOLLOW_UP_COMPOSER_PLACEHOLDER);
  });
});

describe("resolveThreadSwitchTimeline", () => {
  afterEach(() => {
    resetHeldThreadTimeline();
  });

  const held = { threadKey: "env-1:thread-a", entries: ["a1", "a2"] };

  it("keeps the previous thread's entries while the next thread is loading", () => {
    expect(
      resolveThreadSwitchTimeline({
        loading: true,
        activeThreadKey: "env-1:thread-b",
        nextEntries: [],
        lastReady: held,
      }),
    ).toEqual({ entries: ["a1", "a2"], displayThreadKey: "env-1:thread-a" });
  });

  it("shows the new thread once its detail is ready", () => {
    expect(
      resolveThreadSwitchTimeline({
        loading: false,
        activeThreadKey: "env-1:thread-b",
        nextEntries: ["b1"],
        lastReady: held,
      }),
    ).toEqual({ entries: ["b1"], displayThreadKey: "env-1:thread-b" });
  });

  it("does not invent a timeline on the first open of a thread", () => {
    expect(
      resolveThreadSwitchTimeline({
        loading: true,
        activeThreadKey: "env-1:thread-a",
        nextEntries: [],
        lastReady: null,
      }),
    ).toEqual({ entries: [], displayThreadKey: "env-1:thread-a" });
  });

  it("keeps the held thread workspace cwd and root with the snapshot", () => {
    rememberReadyThreadTimeline({
      ...held,
      markdownCwd: "/repo/a",
      workspaceRoot: "/repo/a",
    });
    expect(peekHeldThreadTimeline<string[]>()).toEqual({
      ...held,
      markdownCwd: "/repo/a",
      workspaceRoot: "/repo/a",
    });
  });

  it("survives a ChatView remount by remembering the last ready timeline", () => {
    rememberReadyThreadTimeline(held);
    expect(peekHeldThreadTimeline<string[]>()).toEqual(held);
    expect(
      resolveThreadSwitchTimeline({
        loading: true,
        activeThreadKey: "env-1:thread-b",
        nextEntries: [],
      }),
    ).toEqual({ entries: ["a1", "a2"], displayThreadKey: "env-1:thread-a" });
  });

  it("paints a remembered destination instead of the last-viewed thread", () => {
    rememberReadyThreadTimeline(held);
    rememberReadyThreadTimeline({ threadKey: "env-1:thread-b", entries: ["b1", "b2"] });
    expect(peekRememberedThreadTimeline<string[]>("env-1:thread-a")).toEqual(["a1", "a2"]);
    expect(
      resolveThreadSwitchTimeline({
        loading: true,
        activeThreadKey: "env-1:thread-a",
        nextEntries: [],
      }),
    ).toEqual({ entries: ["a1", "a2"], displayThreadKey: "env-1:thread-a" });
  });

  it("prefers live entries over a remembered snapshot (including during active streaming)", () => {
    rememberReadyThreadTimeline({ threadKey: "env-1:thread-b", entries: ["stale-b"] });
    expect(
      resolveThreadSwitchTimeline({
        loading: false,
        activeThreadKey: "env-1:thread-b",
        nextEntries: ["streaming-line-1", "streaming-line-2"],
      }),
    ).toEqual({
      entries: ["streaming-line-1", "streaming-line-2"],
      displayThreadKey: "env-1:thread-b",
    });
  });

  it("does not keep a remembered snapshot on a resolved empty thread", () => {
    rememberReadyThreadTimeline(held);
    expect(
      resolveThreadSwitchTimeline({
        loading: false,
        activeThreadKey: "env-1:thread-a",
        nextEntries: [],
      }),
    ).toEqual({ entries: [], displayThreadKey: "env-1:thread-a" });
  });

  it("does not hold another environment's timeline across a jump", () => {
    expect(threadKeysShareEnvironment("env-1:thread-a", "env-2:thread-b")).toBe(false);
    expect(
      resolveThreadSwitchTimeline({
        loading: true,
        activeThreadKey: "env-2:thread-b",
        nextEntries: [],
        lastReady: held,
      }),
    ).toEqual({ entries: [], displayThreadKey: "env-2:thread-b" });
  });

  it("isolates identical thread IDs in separate environments", () => {
    expect(threadKeysShareEnvironment("env-1:thread-shared", "env-2:thread-shared")).toBe(false);
    rememberReadyThreadTimeline({ threadKey: "env-1:thread-shared", entries: ["env1-content"] });
    expect(
      resolveThreadSwitchTimeline({
        loading: true,
        activeThreadKey: "env-2:thread-shared",
        nextEntries: [],
      }),
    ).toEqual({ entries: [], displayThreadKey: "env-2:thread-shared" });
  });

  it("treats a foreign held timeline as paint-only", () => {
    expect(isPaintOnlyThreadTimeline("env-1:thread-a", "env-1:thread-b")).toBe(true);
    expect(isPaintOnlyThreadTimeline("env-1:thread-b", "env-1:thread-b")).toBe(false);
  });

  it("does not remember a timeline that contains ephemeral blob preview URLs", () => {
    expect(
      timelineHasEphemeralPreviewUrls([
        {
          kind: "message",
          message: {
            id: MessageId.make("preview-message"),
            role: "user",
            text: "Preview",
            streaming: false,
            createdAt: "2026-09-10T12:00:00.000Z",
            attachments: [
              {
                type: "image",
                id: "preview",
                name: "preview.png",
                mimeType: "image/png",
                sizeBytes: 1,
                previewUrl: "blob:handoff",
              },
            ],
          },
        },
      ]),
    ).toBe(true);

    expect(
      timelineHasEphemeralPreviewUrls([
        {
          kind: "message",
          message: {
            id: MessageId.make("preview-message"),
            role: "user",
            text: "Preview",
            streaming: false,
            createdAt: "2026-09-10T12:00:00.000Z",
            attachments: [
              {
                type: "image",
                id: "preview",
                name: "preview.png",
                mimeType: "image/png",
                sizeBytes: 1,
                previewUrl: "https://cdn.example/a.png",
              },
            ],
          },
        },
      ]),
    ).toBe(false);
  });

  it("bounds remembered timelines to 16 entries and evicts older ones in LRU order", () => {
    // Add 20 threads to exceed MAX_REMEMBERED_THREAD_TIMELINES (16)
    for (let i = 1; i <= 20; i++) {
      rememberReadyThreadTimeline({
        threadKey: `env-1:thread-${i}`,
        entries: [`msg-${i}`],
      });
    }

    // Threads 1 to 4 should be evicted
    for (let i = 1; i <= 4; i++) {
      expect(peekRememberedThreadTimeline(`env-1:thread-${i}`)).toBeNull();
    }

    // Threads 5 to 20 should still be retained
    for (let i = 5; i <= 20; i++) {
      expect(peekRememberedThreadTimeline(`env-1:thread-${i}`)).toEqual([`msg-${i}`]);
    }
    expect(MAX_REMEMBERED_THREAD_TIMELINES).toBe(16);
  });
});

describe("scroll restoration", () => {
  afterEach(() => {
    resetRememberedThreadScrollTops();
  });

  it("remembers and restores scroll positions per thread key", () => {
    rememberThreadScrollTop("env-1:thread-1", 450);
    rememberThreadScrollTop("env-1:thread-2", 1200);

    expect(peekRememberedThreadScrollTop("env-1:thread-1")).toBe(450);
    expect(peekRememberedThreadScrollTop("env-1:thread-2")).toBe(1200);
    expect(peekRememberedThreadScrollTop("env-1:thread-unknown")).toBeNull();
  });

  it("bounds remembered scroll positions to 32 entries and evicts older ones", () => {
    for (let i = 1; i <= 40; i++) {
      rememberThreadScrollTop(`env-1:thread-${i}`, i * 10);
    }

    // First 8 should be evicted (40 - 32 = 8)
    for (let i = 1; i <= 8; i++) {
      expect(peekRememberedThreadScrollTop(`env-1:thread-${i}`)).toBeNull();
    }

    // Remaining 32 should still be present
    for (let i = 9; i <= 40; i++) {
      expect(peekRememberedThreadScrollTop(`env-1:thread-${i}`)).toBe(i * 10);
    }
    expect(MAX_REMEMBERED_SCROLL_POSITIONS).toBe(32);
  });
});
