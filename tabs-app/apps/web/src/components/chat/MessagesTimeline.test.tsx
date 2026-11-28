import { MessageId, type BrowserWorkflowResultRef } from "@tabs/contracts";
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

async function renderBrowserWorkflowTimeline(
  results: readonly BrowserWorkflowResultRef[],
  observedBrowserWorkflowResults: ReadonlyMap<string, BrowserWorkflowResultRef> = new Map(),
) {
  const { MessagesTimeline } = await import("./MessagesTimeline");
  return renderToStaticMarkup(
    <MessagesTimeline
      hasMessages
      isWorking={false}
      activeTurnInProgress={false}
      activeTurnStartedAt={null}
      scrollContainer={null}
      timelineEntries={results.map((browserWorkflowResult, index) => {
        const id = `browser-workflow-${index}`;
        const createdAt = `2026-03-17T19:12:${20 + index}.000Z`;
        return {
          id,
          kind: "work",
          createdAt,
          entry: {
            id,
            createdAt,
            label: "Checked browser workflow",
            tone: "tool",
            browserWorkflowResult,
          },
        };
      })}
      completionDividerBeforeEntryId={null}
      completionSummary={null}
      turnDiffSummaryByAssistantMessageId={new Map()}
      nowIso="2026-03-17T19:12:30.000Z"
      expandedWorkGroups={{}}
      onToggleWorkGroup={() => {}}
      onOpenTurnDiff={() => {}}
      onOpenBrowserWorkflow={() => {}}
      observedBrowserWorkflowResults={observedBrowserWorkflowResults}
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
}

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
    expect(markup).toMatch(/\d+ steps?</);
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

  it("renders collapsible work groups and one action per saved receipt", async () => {
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
          {
            id: "quick-action-request",
            kind: "work",
            createdAt: "2026-03-17T19:12:22.000Z",
            entry: {
              id: "quick-action-request",
              createdAt: "2026-03-17T19:12:22.000Z",
              label: "Requested a Quick Action",
              tone: "tool",
              browserQuickActionRequest: { actionId: "9d8446b7-7524-4305-b22e-d336291c583e" },
            },
          },
          ...(["uploaded", "submitted", "submitted", "certified", "published"] as const).map(
            (stage, index) => ({
              id: `browser-result-${index}`,
              kind: "work" as const,
              createdAt: "2026-03-17T19:12:21.000Z",
              entry: {
                id: `browser-result-${index}`,
                createdAt: "2026-03-17T19:12:21.000Z",
                label: "Checked browser receipt",
                tone: "tool" as const,
                browserWorkflowResult: { workflowId: "a".repeat(64), stage },
              },
            }),
          ),
          ...(
            [
              { workflowId: "a".repeat(64), stage: "uploaded", pendingAction: "submit" },
              { workflowId: "b".repeat(64), stage: "uploaded", pendingAction: "submit" },
              { workflowId: "c".repeat(64), stage: "ready_to_upload", pendingAction: "upload" },
              { workflowId: "d".repeat(64), stage: "uploaded" },
              { workflowId: "d".repeat(64), stage: "uploaded", submitRequiresUser: true },
              { workflowId: "d".repeat(64), stage: "uploaded", submitRequiresUser: true },
              { workflowId: "a".repeat(64), stage: "uploaded", submitRequiresUser: true },
            ] as const
          ).map((browserWorkflowResult, index) => ({
            id: `pending-browser-result-${index}`,
            kind: "work" as const,
            createdAt: "2026-03-17T19:12:20.000Z",
            entry: {
              id: `pending-browser-result-${index}`,
              createdAt: "2026-03-17T19:12:20.000Z",
              label: "Checking browser status",
              tone: "tool" as const,
              browserWorkflowResult,
            },
          })),
          {
            id: "store-result",
            kind: "work",
            createdAt: "2026-03-17T19:12:23.000Z",
            entry: {
              id: "store-result",
              createdAt: "2026-03-17T19:12:23.000Z",
              label: "Verified Microsoft Store receipt",
              tone: "tool",
              browserWorkflowResult: {
                workflowId: "a".repeat(64),
                stage: "certified",
                partnerCenter: { storeStatus: "Published", observedAt: "2026-03-17T19:12:23.000Z" },
              },
            },
          },
          ...["figma-result-1", "figma-result-2"].map((id) => ({
            id,
            kind: "work" as const,
            createdAt: "2026-03-17T19:12:22.000Z",
            entry: {
              id,
              createdAt: "2026-03-17T19:12:22.000Z",
              label: "Created an editable frame",
              tone: "tool" as const,
              figmaCanvasResult: { operationId: "f".repeat(64) },
            },
          })),
          ...["quick-action-file-1", "quick-action-file-2"].map((id) => ({
            id,
            kind: "work" as const,
            createdAt: "2026-03-17T19:12:24.000Z",
            entry: {
              id,
              createdAt: "2026-03-17T19:12:24.000Z",
              label: "Verified report",
              tone: "tool" as const,
              browserQuickActionFileResult: {
                resultId: "226f5b60-d213-49c1-94a1-bc17a181aa71",
                tabId: "work-tab",
                profileId: "work",
                filename: "report.csv",
              },
            },
          })),
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:28.000Z"
        expandedWorkGroups={{ "work-group-1": true }}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        onOpenBrowserWorkflow={() => {}}
        onOpenBrowserQuickActionRequest={() => {}}
        onOpenBrowserQuickActionFile={() => {}}
        onOpenFigmaCanvasResult={() => {}}
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
    expect(markup).toContain("The page shows Uploaded");
    expect(markup.match(/Check submission status/g)).toHaveLength(2);
    expect(markup.match(/Submit in the original draft/g)).toHaveLength(1);
    expect(markup).toMatch(
      /Check submission status<\/button><span[^>]*>Submit in the original draft/,
    );
    expect(markup.match(/Submission outcome unverified/g)).toHaveLength(1);
    expect(markup).toContain("Check upload status");
    expect(markup).toContain("Upload outcome unverified");
    expect(markup.match(/The page shows Submitted/g)).toHaveLength(1);
    expect(markup).toContain("The page shows Certified");
    expect(markup).toContain("The page shows Published");
    expect(markup).toContain("Microsoft Store · Published · Observed");
    expect(markup).toContain("Review Quick Action");
    expect(markup.match(/Open verified file/g)).toHaveLength(1);
    expect(markup).toContain("report.csv");
    expect(markup).toContain('dateTime="2026-03-17T19:12:23.000Z"');
    expect(markup.match(/Open editable frame/g)).toHaveLength(1);
  });

  it("hides the earlier ready action for a workflow with a pending upload", async () => {
    const workflowId = "a".repeat(64);
    const ready = { workflowId, stage: "ready_to_upload" } as const;
    const pending = { ...ready, pendingAction: "upload" } as const;

    const markup = await renderBrowserWorkflowTimeline([ready, pending]);
    expect(markup).toContain("Check upload status");
    expect(markup).toContain("Upload outcome unverified");
    expect(markup).not.toContain("The page shows Ready to upload");

    const withOtherWorkflow = await renderBrowserWorkflowTimeline([
      ready,
      { ...ready, workflowId: "b".repeat(64) },
      pending,
    ]);
    expect(withOtherWorkflow.match(/The page shows Ready to upload/g)).toHaveLength(1);
  });

  it("replaces the upload check when the journal confirms the uploaded draft", async () => {
    const workflowId = "a".repeat(64);
    const ready = { workflowId, stage: "ready_to_upload" } as const;
    const pending = { ...ready, pendingAction: "upload" } as const;
    const uploaded = { workflowId, stage: "uploaded" } as const;
    const markup = await renderBrowserWorkflowTimeline(
      [ready, pending],
      new Map([[workflowId, uploaded]]),
    );

    expect(markup.match(/The page shows Uploaded/g)).toHaveLength(1);
    expect(markup).not.toContain("Check upload status");
    expect(markup).not.toContain("Upload outcome unverified");
  });

  it("preserves a later pending submission when the journal confirms the upload", async () => {
    const workflowId = "a".repeat(64);
    const pendingUpload = {
      workflowId,
      stage: "ready_to_upload",
      pendingAction: "upload",
    } as const;
    const uploaded = { workflowId, stage: "uploaded" } as const;
    const pendingSubmit = { ...uploaded, pendingAction: "submit" } as const;
    const markup = await renderBrowserWorkflowTimeline(
      [pendingUpload, pendingSubmit],
      new Map([[workflowId, uploaded]]),
    );

    expect(markup.match(/Check submission status/g)).toHaveLength(1);
    expect(markup).toContain("Submission outcome unverified");
    expect(markup).not.toContain("Check upload status");
  });

  it("hides an earlier manual Submit when a guarded Submit is pending for the same draft", async () => {
    const workflowId = "a".repeat(64);
    const manual = { workflowId, stage: "uploaded", submitRequiresUser: true } as const;
    const pending = { workflowId, stage: "uploaded", pendingAction: "submit" } as const;

    const markup = await renderBrowserWorkflowTimeline([manual, pending]);
    expect(markup.match(/Check submission status/g)).toHaveLength(1);
    expect(markup).toContain("Submission outcome unverified");
    expect(markup).not.toContain("Submit in the original draft");

    const withOtherWorkflow = await renderBrowserWorkflowTimeline([
      manual,
      { ...manual, workflowId: "b".repeat(64) },
      pending,
    ]);
    expect(withOtherWorkflow.match(/Submit in the original draft/g)).toHaveLength(1);
  });

  it("updates a manual Submit when its journal reports a pending guarded Submit at the same stage", async () => {
    const workflowId = "a".repeat(64);
    const manual = { workflowId, stage: "uploaded", submitRequiresUser: true } as const;
    const pending = { workflowId, stage: "uploaded", pendingAction: "submit" } as const;
    const observed = new Map([[workflowId, pending]]);

    const markup = await renderBrowserWorkflowTimeline([manual], observed);
    expect(markup.match(/Check submission status/g)).toHaveLength(1);
    expect(markup).toContain("Submission outcome unverified");
    expect(markup).not.toContain("Submit in the original draft");

    const withLaterReceipt = await renderBrowserWorkflowTimeline(
      [manual, { workflowId, stage: "submitted" }],
      observed,
    );
    expect(withLaterReceipt).toContain("The page shows Submitted");
    expect(withLaterReceipt).not.toContain("Check submission status");
  });

  it("preserves later tool receipts when the journal confirms an earlier stage", async () => {
    const workflowId = "a".repeat(64);
    const pendingUpload = {
      workflowId,
      stage: "ready_to_upload",
      pendingAction: "upload",
    } as const;
    const uploaded = { workflowId, stage: "uploaded" } as const;
    const laterReceipt = {
      workflowId,
      stage: "certified",
      partnerCenter: {
        storeStatus: "Certification",
        observedAt: "2026-03-17T19:12:21.000Z",
      },
    } as const;
    const markup = await renderBrowserWorkflowTimeline(
      [pendingUpload, laterReceipt],
      new Map([[workflowId, uploaded]]),
    );

    expect(markup.match(/Confirmed by Partner Center/g)).toHaveLength(1);
    expect(markup).toContain("Microsoft Store · Certification · Observed");
    expect(markup).not.toContain("Check upload status");
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

    // Seven steps collapse to the latest six behind an expandable header.
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Show 1 earlier step");
    expect(markup).toContain("7 steps");
  });
});
