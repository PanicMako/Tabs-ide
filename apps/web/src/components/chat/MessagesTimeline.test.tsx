import { MessageId } from "@tabs/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

beforeAll(() => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("self", {
    addEventListener: () => {},
    removeEventListener: () => {},
    postMessage: () => {},
  });
  vi.stubGlobal("navigator", {
    userAgent: "node",
  });
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    matchMedia,
    addEventListener: () => {},
    removeEventListener: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList,
      offsetHeight: 0,
    },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    return setTimeout(() => callback(Date.now()), 16) as unknown as number;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    clearTimeout(id);
  });
});

describe("MessagesTimeline", { timeout: 30000 }, () => {
  it("renders inline terminal labels with the composer chip UI", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.makeUnsafe("message-2"),
              role: "user",
              text: [
                "yoo what's @terminal-1:1-5 mean",
                "",
                "<terminal_context>",
                "- Terminal 1 lines 1-5:",
                "  1 | julius@mac effect-http-ws-cli % bun i",
                "  2 | bun install v1.3.9 (cf6cdbbb)",
                "</terminal_context>",
              ].join("\n"),
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
        latestTaskDescription={null}
      />,
    );

    expect(markup).toContain("Terminal 1 lines 1-5");
    expect(markup).toContain("lucide-terminal");
    expect(markup).toContain("yoo what&#x27;s ");
  });

  it("renders context compaction entries in the normal work log", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Context compacted",
              tone: "info",
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
        latestTaskDescription={null}
      />,
    );

    expect(markup).toContain("Context compacted");
    expect(markup).toContain("Work log");
  });

  it("places each turn's tasks after its assistant response and before the next user message", async () => {
    const { placeTaskRowsAtTurnEnds } = await import("./MessagesTimeline");
    const rows = placeTaskRowsAtTurnEnds([
      {
        id: "user-1",
        kind: "message",
        createdAt: "2026-03-17T19:12:20.000Z",
        message: {
          id: MessageId.makeUnsafe("user-1"),
          role: "user",
          text: "First prompt marker",
          createdAt: "2026-03-17T19:12:20.000Z",
          streaming: false,
        },
        durationStart: "2026-03-17T19:12:20.000Z",
        showCompletionDivider: false,
      },
      {
        id: "tasks-turn-1",
        kind: "tasks",
        createdAt: "2026-03-17T19:12:21.000Z",
        tasks: [
          {
            taskId: "task-1",
            description: "First task",
            status: "completed",
            startedAt: "2026-03-17T19:12:21.000Z",
          },
          {
            taskId: "task-2",
            description: "Second task",
            status: "completed",
            startedAt: "2026-03-17T19:12:21.000Z",
          },
        ],
      },
      {
        id: "assistant-1",
        kind: "message",
        createdAt: "2026-03-17T19:12:22.000Z",
        message: {
          id: MessageId.makeUnsafe("assistant-1"),
          role: "assistant",
          text: "",
          createdAt: "2026-03-17T19:12:22.000Z",
          streaming: false,
        },
        durationStart: "2026-03-17T19:12:22.000Z",
        showCompletionDivider: false,
      },
      {
        id: "user-2",
        kind: "message",
        createdAt: "2026-03-17T19:12:23.000Z",
        message: {
          id: MessageId.makeUnsafe("user-2"),
          role: "user",
          text: "Second prompt marker",
          createdAt: "2026-03-17T19:12:23.000Z",
          streaming: false,
        },
        durationStart: "2026-03-17T19:12:23.000Z",
        showCompletionDivider: false,
      },
    ]);

    expect(rows.map((row) => row.id)).toEqual(["user-1", "assistant-1", "tasks-turn-1", "user-2"]);
  });

  it("renders work log groups with AnimatedHeight for smooth expansion", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "work-group-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:20.000Z",
            entry: {
              id: "work-1",
              label: "Searching code",
              tone: "tool",
              detail: "ripgrep",
              command: "rg search",
              createdAt: "2026-03-17T19:12:20.000Z",
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:28.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="dark"
        timestampFormat="12-hour"
        workspaceRoot={undefined}
        latestTaskDescription={null}
      />,
    );

    expect(markup).toContain('data-slot="animated-height"');
    expect(markup).toContain("Searching code");
  });

  it("renders user and assistant action bars with pointer-coarse, focus-within, and reduced-motion support", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "user-entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:20.000Z",
            message: {
              id: MessageId.makeUnsafe("user-msg-1"),
              role: "user",
              text: "Hello Tabs",
              createdAt: "2026-03-17T19:12:20.000Z",
              streaming: false,
            },
          },
          {
            id: "assistant-entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:22.000Z",
            message: {
              id: MessageId.makeUnsafe("assistant-msg-1"),
              role: "assistant",
              text: "Hello! How can I help?",
              createdAt: "2026-03-17T19:12:22.000Z",
              streaming: false,
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:28.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map([[MessageId.makeUnsafe("user-msg-1"), 1]])}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="dark"
        timestampFormat="12-hour"
        workspaceRoot={undefined}
        latestTaskDescription={null}
      />,
    );

    // Verify pointer-coarse and focus-within visibility
    expect(markup).toContain("pointer-coarse:opacity-100");
    expect(markup).toContain("focus-within:opacity-100");
    expect(markup).toContain("motion-reduce:transition-none");

    // Verify accessible copy button
    expect(markup).toContain('aria-label="Copy message to clipboard"');

    // Verify accessible revert button
    expect(markup).toContain('aria-label="Revert to this message"');
    expect(markup).toContain("pointer-coarse:after:min-h-11");
    expect(markup).toContain("pointer-coarse:after:min-w-11");
  });

  it("provides aria-expanded on collapsible work group headers and action buttons", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "work-group-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:20.000Z",
            entry: {
              id: "work-1",
              label: "Running build 1",
              tone: "tool",
              detail: "output 1",
              createdAt: "2026-03-17T19:12:20.000Z",
            },
          },
          {
            id: "work-group-2",
            kind: "work",
            createdAt: "2026-03-17T19:12:21.000Z",
            entry: {
              id: "work-2",
              label: "Running build 2",
              tone: "tool",
              detail: "output 2",
              createdAt: "2026-03-17T19:12:21.000Z",
            },
          },
          {
            id: "work-group-3",
            kind: "work",
            createdAt: "2026-03-17T19:12:22.000Z",
            entry: {
              id: "work-3",
              label: "Running build 3",
              tone: "tool",
              detail: "output 3",
              createdAt: "2026-03-17T19:12:22.000Z",
            },
          },
          {
            id: "work-group-4",
            kind: "work",
            createdAt: "2026-03-17T19:12:23.000Z",
            entry: {
              id: "work-4",
              label: "Running build 4",
              tone: "tool",
              detail: "output 4",
              createdAt: "2026-03-17T19:12:23.000Z",
            },
          },
          {
            id: "work-group-5",
            kind: "work",
            createdAt: "2026-03-17T19:12:24.000Z",
            entry: {
              id: "work-5",
              label: "Running build 5",
              tone: "tool",
              detail: "output 5",
              createdAt: "2026-03-17T19:12:24.000Z",
            },
          },
          {
            id: "work-group-6",
            kind: "work",
            createdAt: "2026-03-17T19:12:25.000Z",
            entry: {
              id: "work-6",
              label: "Running build 6",
              tone: "tool",
              detail: "output 6",
              createdAt: "2026-03-17T19:12:25.000Z",
            },
          },
          {
            id: "work-group-7",
            kind: "work",
            createdAt: "2026-03-17T19:12:26.000Z",
            entry: {
              id: "work-7",
              label: "Running build 7",
              tone: "tool",
              detail: "output 7",
              createdAt: "2026-03-17T19:12:26.000Z",
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:28.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="dark"
        timestampFormat="12-hour"
        workspaceRoot={undefined}
        latestTaskDescription={null}
      />,
    );

    // Verify aria-expanded on header button
    expect(markup).toContain('aria-expanded="false"');
    // Verify aria-label on details toggle
    expect(markup).toContain('aria-label="View details for Tool call"');
  });
});
