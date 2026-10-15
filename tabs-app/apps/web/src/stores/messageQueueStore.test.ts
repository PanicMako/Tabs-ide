import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadId } from "@tabs/contracts";
import { useMessageQueueStore, getThreadQueuedMessages } from "./messageQueueStore";

const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
});
vi.mock("~/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/storage")>()),
  createMemoryStorage: () => storage,
}));

describe("messageQueueStore", () => {
  const threadId1 = "thread-1" as ThreadId;
  const threadId2 = "thread-2" as ThreadId;

  beforeEach(() => {
    useMessageQueueStore.getState().clearQueue(threadId1);
    useMessageQueueStore.getState().clearQueue(threadId2);
  });

  it("enqueues and retrieves queued messages for a thread", () => {
    const store = useMessageQueueStore.getState();
    expect(getThreadQueuedMessages(store.queueByThread, threadId1)).toEqual([]);

    store.enqueueMessage({
      id: "msg-1",
      threadId: threadId1,
      text: "First queued prompt",
      createdAt: "2026-03-09T10:00:00.000Z",
    });

    store.enqueueMessage({
      id: "msg-2",
      threadId: threadId1,
      text: "Second queued prompt",
      createdAt: "2026-03-09T10:01:00.000Z",
    });

    const updated = useMessageQueueStore.getState();
    const queued = getThreadQueuedMessages(updated.queueByThread, threadId1);
    expect(queued).toHaveLength(2);
    expect(queued[0]?.text).toBe("First queued prompt");
    expect(queued[1]?.text).toBe("Second queued prompt");
  });

  it("dequeues messages FIFO", () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "msg-1",
      threadId: threadId1,
      text: "First",
      createdAt: "2026-03-09T10:00:00.000Z",
    });
    store.enqueueMessage({
      id: "msg-2",
      threadId: threadId1,
      text: "Second",
      createdAt: "2026-03-09T10:01:00.000Z",
    });

    const next = useMessageQueueStore.getState().dequeueMessage(threadId1);
    expect(next?.id).toBe("msg-1");

    const remaining = getThreadQueuedMessages(
      useMessageQueueStore.getState().queueByThread,
      threadId1,
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("msg-2");

    const second = useMessageQueueStore.getState().dequeueMessage(threadId1);
    expect(second?.id).toBe("msg-2");

    expect(useMessageQueueStore.getState().dequeueMessage(threadId1)).toBeNull();
  });

  it("peeks without removing", () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "msg-1",
      threadId: threadId1,
      text: "Peek item",
      createdAt: "2026-03-09T10:00:00.000Z",
    });

    const peeked = useMessageQueueStore.getState().peekNextMessage(threadId1);
    expect(peeked?.id).toBe("msg-1");

    const remaining = getThreadQueuedMessages(
      useMessageQueueStore.getState().queueByThread,
      threadId1,
    );
    expect(remaining).toHaveLength(1);
  });

  it("removes a specific message by id", () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "msg-1",
      threadId: threadId1,
      text: "First",
      createdAt: "2026-03-09T10:00:00.000Z",
    });
    store.enqueueMessage({
      id: "msg-2",
      threadId: threadId1,
      text: "Second",
      createdAt: "2026-03-09T10:01:00.000Z",
    });

    store.removeQueuedMessage(threadId1, "msg-1");
    const remaining = getThreadQueuedMessages(
      useMessageQueueStore.getState().queueByThread,
      threadId1,
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("msg-2");
  });

  it("reorders queued messages", () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "msg-1",
      threadId: threadId1,
      text: "First",
      createdAt: "2026-03-09T10:00:00.000Z",
    });
    store.enqueueMessage({
      id: "msg-2",
      threadId: threadId1,
      text: "Second",
      createdAt: "2026-03-09T10:01:00.000Z",
    });

    store.reorderQueue(threadId1, 0, 1);
    const reordered = getThreadQueuedMessages(
      useMessageQueueStore.getState().queueByThread,
      threadId1,
    );
    expect(reordered[0]?.id).toBe("msg-2");
    expect(reordered[1]?.id).toBe("msg-1");
  });

  it("handles scheduled messages and ready checks", () => {
    const store = useMessageQueueStore.getState();
    const now = 1000000;

    // Message 1 is scheduled for future
    store.enqueueMessage({
      id: "msg-future",
      threadId: threadId1,
      text: "Future prompt",
      createdAt: new Date(now).toISOString(),
      scheduledFor: new Date(now + 60000).toISOString(),
    });

    // Message 2 is immediate (no schedule)
    store.enqueueMessage({
      id: "msg-immediate",
      threadId: threadId1,
      text: "Immediate prompt",
      createdAt: new Date(now).toISOString(),
    });

    // Ready message should be msg-immediate because msg-future is in future
    const ready = store.peekNextReadyMessage(threadId1, now);
    expect(ready?.id).toBe("msg-immediate");

    // Dequeue next ready message
    const dequeued = store.dequeueNextReadyMessage(threadId1, now);
    expect(dequeued?.id).toBe("msg-immediate");

    // After dequeuing immediate, only msg-future is left (not ready at `now`)
    expect(store.peekNextReadyMessage(threadId1, now)).toBeNull();

    // At `now + 60000`, msg-future is now ready
    expect(store.peekNextReadyMessage(threadId1, now + 60000)?.id).toBe("msg-future");

    // Can update schedule of a message
    store.updateMessageSchedule(threadId1, "msg-future", null);
    expect(store.peekNextReadyMessage(threadId1, now)?.id).toBe("msg-future");
  });
});

it("retains failed messages, excludes invalid schedules, and clears errors on retry", () => {
  const threadId = "retry-thread" as ThreadId;
  const store = useMessageQueueStore.getState();
  store.clearQueue(threadId);
  store.enqueueMessage({
    id: "failed",
    threadId,
    text: "keep me",
    createdAt: "2026-10-08",
    scheduledFor: "invalid",
  });
  expect(store.peekNextReadyMessage(threadId)).toBeNull();
  store.updateMessageSchedule(threadId, "failed", null);
  store.setMessageError(threadId, "failed", "offline");
  expect(store.peekNextReadyMessage(threadId)).toBeNull();
  expect(useMessageQueueStore.getState().queueByThread[threadId]?.[0]?.text).toBe("keep me");
  store.updateMessageSchedule(threadId, "failed", null);
  expect(store.peekNextReadyMessage(threadId)?.id).toBe("failed");
  store.clearQueue(threadId);
});

it("keeps memory unchanged when durable enqueue fails, and prevents duplicate IDs", () => {
  const threadId = "durable-thread" as ThreadId;
  const message = { id: "durable", threadId, text: "preserve my draft", createdAt: "2026-10-08" };
  useMessageQueueStore.getState().clearQueue(threadId);
  storage.setItem.mockImplementationOnce(() => {
    throw new Error("QuotaExceededError");
  });
  expect(() => useMessageQueueStore.getState().enqueueMessage(message)).toThrow(
    "QuotaExceededError",
  );
  expect(useMessageQueueStore.getState().queueByThread[threadId]).toBeUndefined();
  useMessageQueueStore.getState().enqueueMessage(message);
  useMessageQueueStore.getState().enqueueMessage(message);
  expect(useMessageQueueStore.getState().queueByThread[threadId]).toHaveLength(1);
  useMessageQueueStore.getState().clearQueue(threadId);
});

describe("migrateLocalQueueToServer", () => {
  const threadId = "migrate-thread" as ThreadId;
  const otherThreadId = "other-env-thread" as ThreadId;

  beforeEach(() => {
    useMessageQueueStore.setState({ queueByThread: {} });
  });

  it("migrates entries with stable commandIds and removes only after server ACK", async () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "q-1",
      threadId,
      text: "Migrate 1",
      createdAt: "2026-10-13T10:00:00Z",
    });
    store.enqueueMessage({
      id: "q-2",
      threadId,
      text: "Migrate 2",
      createdAt: "2026-10-13T10:01:00Z",
    });

    const dispatched: any[] = [];
    const mockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          dispatched.push(cmd);
          return { sequence: 100 };
        }),
      },
    };

    const { migratedCount, failedCount } = await (
      await import("./messageQueueStore")
    ).migrateLocalQueueToServer(undefined, mockApi);

    expect(migratedCount).toBe(2);
    expect(failedCount).toBe(0);
    expect(dispatched).toHaveLength(2);
    expect(dispatched[0]?.commandId).toBe("migrated-queue-q-1");
    expect(dispatched[0]?.dispatchMode).toEqual({ type: "queue_after_active" });
    expect(dispatched[1]?.commandId).toBe("migrated-queue-q-2");

    // Both removed after successful ack
    expect(useMessageQueueStore.getState().queueByThread[threadId]).toEqual([]);
  });

  it("preserves local entry and sets error when server dispatch fails", async () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "q-fail",
      threadId,
      text: "Will fail",
      createdAt: "2026-10-13T10:00:00Z",
    });

    const mockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async () => {
          throw new Error("Network timeout");
        }),
      },
    };

    const { migratedCount, failedCount } = await (
      await import("./messageQueueStore")
    ).migrateLocalQueueToServer(undefined, mockApi);

    expect(migratedCount).toBe(0);
    expect(failedCount).toBe(1);

    // Entry preserved with error
    const remaining = useMessageQueueStore.getState().queueByThread[threadId];
    expect(remaining).toHaveLength(1);
    expect(remaining?.[0]?.dispatchError).toBe("Network timeout");
  });

  it("never routes secondary environment entries through primary environment", async () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "q-primary",
      threadId,
      text: "Primary env entry",
      createdAt: "2026-10-13T10:00:00Z",
    });
    store.enqueueMessage({
      id: "q-secondary",
      threadId: otherThreadId,
      environmentId: "env-secondary" as any,
      text: "Secondary env entry",
      createdAt: "2026-10-13T10:00:00Z",
    });

    const dispatched: any[] = [];
    const mockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          dispatched.push(cmd);
          return { sequence: 100 };
        }),
      },
    };

    // Migrate for primary environment (undefined)
    const result = await (
      await import("./messageQueueStore")
    ).migrateLocalQueueToServer(undefined, mockApi);

    expect(result.migratedCount).toBe(1);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.messageId).toBe("q-primary");

    // Secondary env entry is untouched and remains in local storage
    expect(useMessageQueueStore.getState().queueByThread[otherThreadId]).toHaveLength(1);
  });

  it("uploads attachments via assets.persistChatAttachments before dispatching", async () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "q-attach",
      threadId,
      text: "With attachment",
      createdAt: "2026-10-13T10:00:00Z",
      attachments: [
        {
          id: "att-1",
          name: "image.png",
          mimeType: "image/png",
          sizeBytes: 1024,
          dataUrl: "data:image/png;base64,abc",
        },
      ],
      terminalContextIds: ["term-1"],
    });

    const persistedInputs: any[] = [];
    const dispatched: any[] = [];
    const mockApi = {
      assets: {
        persistChatAttachments: vi.fn(async (input: any) => {
          persistedInputs.push(input);
          return {
            attachments: [
              {
                id: "att-1",
                type: "image",
                name: "image.png",
                mimeType: "image/png",
                sizeBytes: 1024,
                path: "/path/to/att-1.png",
              },
            ],
          };
        }),
      },
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          dispatched.push(cmd);
          return { sequence: 101 };
        }),
      },
    };

    const result = await (
      await import("./messageQueueStore")
    ).migrateLocalQueueToServer(undefined, mockApi);

    expect(result.migratedCount).toBe(1);
    expect(persistedInputs).toHaveLength(1);
    expect(persistedInputs[0]?.threadId).toBe(threadId);
    expect(persistedInputs[0]?.attachments[0]?.dataUrl).toBe("data:image/png;base64,abc");
    expect(dispatched[0]?.attachments[0]?.path).toBe("/path/to/att-1.png");
    expect(dispatched[0]?.context).toEqual({ terminalContextIds: ["term-1"] });
    expect(useMessageQueueStore.getState().queueByThread[threadId]).toEqual([]);
  });

  it("distinguishes non-image files from images using source collections and explicit types", async () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "q-typed",
      threadId,
      text: "With both image and file",
      createdAt: "2026-10-13T10:00:00Z",
      attachments: [
        {
          id: "img-1",
          name: "screenshot.png",
          mimeType: "image/png",
          sizeBytes: 2048,
          dataUrl: "data:image/png;base64,imgdata",
        },
      ],
      files: [
        {
          id: "file-1",
          name: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 4096,
          dataUrl: "data:application/pdf;base64,pdfdata",
        },
      ],
    });

    const persistedAttachments: any[] = [];
    const mockApi = {
      assets: {
        persistChatAttachments: vi.fn(async (input: any) => {
          persistedAttachments.push(...input.attachments);
          return {
            attachments: input.attachments.map((att: any) => ({
              ...att,
              path: `/stored/${att.name}`,
            })),
          };
        }),
      },
      orchestration: {
        dispatchCommand: vi.fn(async () => ({ sequence: 102 })),
      },
    };

    const result = await (
      await import("./messageQueueStore")
    ).migrateLocalQueueToServer(undefined, mockApi);

    expect(result.migratedCount).toBe(1);
    expect(persistedAttachments).toHaveLength(2);
    expect(persistedAttachments[0]?.type).toBe("image");
    expect(persistedAttachments[0]?.name).toBe("screenshot.png");
    expect(persistedAttachments[1]?.type).toBe("file");
    expect(persistedAttachments[1]?.name).toBe("report.pdf");
  });

  it("never silently discards attachments when upload is unavailable and preserves entry with error", async () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "q-no-upload",
      threadId,
      text: "Must not lose file",
      createdAt: "2026-10-13T10:00:00Z",
      files: [
        {
          id: "doc-1",
          name: "doc.txt",
          mimeType: "text/plain",
          sizeBytes: 50,
          dataUrl: "data:text/plain;base64,hello",
        },
      ],
    });

    const mockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async () => ({ sequence: 103 })),
      },
    };

    const result = await (
      await import("./messageQueueStore")
    ).migrateLocalQueueToServer(undefined, mockApi);

    expect(result.migratedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(mockApi.orchestration.dispatchCommand).not.toHaveBeenCalled();

    // The message is retained with a clear error
    const remaining = useMessageQueueStore.getState().queueByThread[threadId];
    expect(remaining).toHaveLength(1);
    expect(remaining?.[0]?.dispatchError).toContain("unavailable");
  });

  it("guards against duplicate dispatch during concurrent migration calls", async () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "q-concurrent",
      threadId,
      text: "Single execution",
      createdAt: "2026-10-13T10:00:00Z",
    });

    let dispatchCount = 0;
    const mockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async () => {
          dispatchCount += 1;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { sequence: 104 };
        }),
      },
    };

    const { migrateLocalQueueToServer } = await import("./messageQueueStore");
    // Run two migrations concurrently
    const [res1, res2] = await Promise.all([
      migrateLocalQueueToServer(undefined, mockApi),
      migrateLocalQueueToServer(undefined, mockApi),
    ]);

    expect(dispatchCount).toBe(1);
    expect(res1.migratedCount + res2.migratedCount).toBe(1);
    expect(useMessageQueueStore.getState().queueByThread[threadId]).toEqual([]);
  });

  it("enqueueAndSyncQueuedMessage enqueues and immediately initiates migration", async () => {
    const dispatched: any[] = [];
    const mockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          dispatched.push(cmd);
          return { sequence: 105 };
        }),
      },
    };

    const { enqueueAndSyncQueuedMessage } = await import("./messageQueueStore");
    await enqueueAndSyncQueuedMessage(
      {
        id: "q-sync-immediate",
        threadId,
        text: "Immediate sync",
        createdAt: "2026-10-13T10:00:00Z",
      },
      mockApi,
    );

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.messageId).toBe("q-sync-immediate");
    expect(useMessageQueueStore.getState().queueByThread[threadId]).toEqual([]);
  });

  it("a secondary environment cannot migrate an untagged legacy primary entry", async () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "q-legacy-untagged",
      threadId,
      text: "Untagged legacy entry",
      createdAt: "2026-10-13T10:00:00Z",
    });

    const dispatched: any[] = [];
    const secondaryMockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          dispatched.push(cmd);
          return { sequence: 200 };
        }),
      },
    };

    const { migrateLocalQueueToServer } = await import("./messageQueueStore");
    const result = await migrateLocalQueueToServer("env-secondary" as any, secondaryMockApi);

    expect(result.migratedCount).toBe(0);
    expect(secondaryMockApi.orchestration.dispatchCommand).not.toHaveBeenCalled();
    expect(dispatched).toHaveLength(0);

    const remaining = useMessageQueueStore.getState().queueByThread[threadId];
    expect(remaining).toHaveLength(1);
    expect(remaining?.[0]?.id).toBe("q-legacy-untagged");
  });

  it("explicit primary and secondary entries are routed only to their owners", async () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "q-explicit-primary",
      threadId,
      environmentId: "env-primary" as any,
      text: "Explicit primary entry",
      createdAt: "2026-10-13T10:00:00Z",
    });
    store.enqueueMessage({
      id: "q-explicit-secondary",
      threadId: otherThreadId,
      environmentId: "env-secondary" as any,
      text: "Explicit secondary entry",
      createdAt: "2026-10-13T10:00:00Z",
    });

    const primaryDispatched: any[] = [];
    const primaryMockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          primaryDispatched.push(cmd);
          return { sequence: 201 };
        }),
      },
    };

    const secondaryDispatched: any[] = [];
    const secondaryMockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          secondaryDispatched.push(cmd);
          return { sequence: 202 };
        }),
      },
    };

    const { migrateLocalQueueToServer } = await import("./messageQueueStore");
    const { setPrimaryEnvironmentIdForTesting } =
      await import("~/connection/environmentApiRegistry");
    setPrimaryEnvironmentIdForTesting("env-primary");

    try {
      const secResult = await migrateLocalQueueToServer("env-secondary" as any, secondaryMockApi);
      expect(secResult.migratedCount).toBe(1);
      expect(secondaryDispatched).toHaveLength(1);
      expect(secondaryDispatched[0]?.messageId).toBe("q-explicit-secondary");
      expect(useMessageQueueStore.getState().queueByThread[threadId]).toHaveLength(1);

      const primResult = await migrateLocalQueueToServer("env-primary" as any, primaryMockApi);
      expect(primResult.migratedCount).toBe(1);
      expect(primaryDispatched).toHaveLength(1);
      expect(primaryDispatched[0]?.messageId).toBe("q-explicit-primary");
      expect(useMessageQueueStore.getState().queueByThread[threadId]).toHaveLength(0);
    } finally {
      setPrimaryEnvironmentIdForTesting(null);
    }
  });

  it("two environments mounting concurrently cannot take each other's work", async () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "q-concurrent-primary",
      threadId,
      environmentId: "env-primary" as any,
      text: "Primary concurrent work",
      createdAt: "2026-10-13T10:00:00Z",
    });
    store.enqueueMessage({
      id: "q-concurrent-secondary",
      threadId: otherThreadId,
      environmentId: "env-secondary" as any,
      text: "Secondary concurrent work",
      createdAt: "2026-10-13T10:00:00Z",
    });

    const primaryDispatched: any[] = [];
    const secondaryDispatched: any[] = [];

    const primaryMockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          primaryDispatched.push(cmd);
          await new Promise((r) => setTimeout(r, 20));
          return { sequence: 203 };
        }),
      },
    };

    const secondaryMockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          secondaryDispatched.push(cmd);
          await new Promise((r) => setTimeout(r, 20));
          return { sequence: 204 };
        }),
      },
    };

    const { migrateLocalQueueToServer } = await import("./messageQueueStore");
    const { setPrimaryEnvironmentIdForTesting } =
      await import("~/connection/environmentApiRegistry");
    setPrimaryEnvironmentIdForTesting("env-primary");

    try {
      const [resPrim, resSec] = await Promise.all([
        migrateLocalQueueToServer("env-primary" as any, primaryMockApi),
        migrateLocalQueueToServer("env-secondary" as any, secondaryMockApi),
      ]);

      expect(resPrim.migratedCount).toBe(1);
      expect(resSec.migratedCount).toBe(1);
      expect(primaryDispatched).toHaveLength(1);
      expect(primaryDispatched[0]?.messageId).toBe("q-concurrent-primary");
      expect(secondaryDispatched).toHaveLength(1);
      expect(secondaryDispatched[0]?.messageId).toBe("q-concurrent-secondary");
    } finally {
      setPrimaryEnvironmentIdForTesting(null);
    }
  });

  it("upload failure, dispatch failure and retry preserve ownership and content", async () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "q-retryable",
      threadId: otherThreadId,
      environmentId: "env-secondary" as any,
      text: "Retryable secondary prompt",
      createdAt: "2026-10-13T10:00:00Z",
      scheduledFor: "2026-10-13T11:00:00Z",
      attachments: [
        {
          id: "att-retry",
          name: "diagram.png",
          mimeType: "image/png",
          sizeBytes: 500,
          dataUrl: "data:image/png;base64,123",
        },
      ],
      terminalContextIds: ["term-abc"],
    });

    const { migrateLocalQueueToServer } = await import("./messageQueueStore");

    // Attempt 1: Upload fails
    let failApi: any = {
      assets: {
        persistChatAttachments: vi.fn(async () => {
          throw new Error("S3 Upload Failed");
        }),
      },
      orchestration: {
        dispatchCommand: vi.fn(),
      },
    };

    const res1 = await migrateLocalQueueToServer("env-secondary" as any, failApi);
    expect(res1.migratedCount).toBe(0);
    expect(res1.failedCount).toBe(1);

    let saved = useMessageQueueStore.getState().queueByThread[otherThreadId]?.[0];
    expect(saved?.dispatchError).toBe("S3 Upload Failed");
    expect(saved?.environmentId).toBe("env-secondary");
    expect(saved?.attachments?.[0]?.name).toBe("diagram.png");
    expect(saved?.scheduledFor).toBe("2026-10-13T11:00:00Z");
    expect(saved?.terminalContextIds).toEqual(["term-abc"]);

    // Attempt 2: Upload succeeds, but dispatchCommand fails
    failApi = {
      assets: {
        persistChatAttachments: vi.fn(async () => ({
          attachments: [
            {
              id: "att-retry",
              type: "image",
              name: "diagram.png",
              mimeType: "image/png",
              sizeBytes: 500,
              path: "/p",
            },
          ],
        })),
      },
      orchestration: {
        dispatchCommand: vi.fn(async () => {
          throw new Error("Server Reject Overload");
        }),
      },
    };

    const res2 = await migrateLocalQueueToServer("env-secondary" as any, failApi);
    expect(res2.migratedCount).toBe(0);
    expect(res2.failedCount).toBe(1);

    saved = useMessageQueueStore.getState().queueByThread[otherThreadId]?.[0];
    expect(saved?.dispatchError).toBe("Server Reject Overload");
    expect(saved?.environmentId).toBe("env-secondary");
    expect(saved?.attachments?.[0]?.name).toBe("diagram.png");

    // Attempt 3: Succeeds fully
    const successDispatched: any[] = [];
    const successApi: any = {
      assets: {
        persistChatAttachments: vi.fn(async () => ({
          attachments: [
            {
              id: "att-retry",
              type: "image",
              name: "diagram.png",
              mimeType: "image/png",
              sizeBytes: 500,
              path: "/p",
            },
          ],
        })),
      },
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          successDispatched.push(cmd);
          return { sequence: 300 };
        }),
      },
    };

    const res3 = await migrateLocalQueueToServer("env-secondary" as any, successApi);
    expect(res3.migratedCount).toBe(1);
    expect(res3.failedCount).toBe(0);
    expect(successDispatched).toHaveLength(1);
    expect(successDispatched[0]?.messageId).toBe("q-retryable");
    expect(successDispatched[0]?.context).toEqual({ terminalContextIds: ["term-abc"] });
    expect(useMessageQueueStore.getState().queueByThread[otherThreadId]).toHaveLength(0);
  });

  it("migration ACK removes only the acknowledged local entry", async () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "q-ack-1",
      threadId,
      text: "Ack 1",
      createdAt: "2026-10-13T10:00:00Z",
    });
    store.enqueueMessage({
      id: "q-ack-2",
      threadId,
      text: "Ack 2",
      createdAt: "2026-10-13T10:01:00Z",
    });

    const mockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          if (cmd.messageId === "q-ack-1") {
            return { sequence: 301 };
          }
          throw new Error("Failed dispatch for 2");
        }),
      },
    };

    const { migrateLocalQueueToServer } = await import("./messageQueueStore");
    const res = await migrateLocalQueueToServer(undefined, mockApi);

    expect(res.migratedCount).toBe(1);
    expect(res.failedCount).toBe(1);

    const remaining = useMessageQueueStore.getState().queueByThread[threadId];
    expect(remaining).toHaveLength(1);
    expect(remaining?.[0]?.id).toBe("q-ack-2");
    expect(remaining?.[0]?.dispatchError).toBe("Failed dispatch for 2");
  });

  it("cancellation during an in-flight upload or dispatch cannot silently resurrect queued work", async () => {
    const store = useMessageQueueStore.getState();
    store.enqueueMessage({
      id: "q-in-flight-cancel",
      threadId,
      text: "To be cancelled",
      createdAt: "2026-10-13T10:00:00Z",
      attachments: [
        {
          id: "att-flight",
          name: "f.png",
          mimeType: "image/png",
          sizeBytes: 100,
          dataUrl: "data:image/png;base64,fff",
        },
      ],
    });

    let uploadStarted = false;
    let dispatchCalled = false;

    const mockApi = {
      assets: {
        persistChatAttachments: vi.fn(async () => {
          uploadStarted = true;
          await new Promise((r) => setTimeout(r, 30));
          useMessageQueueStore.getState().removeQueuedMessage(threadId, "q-in-flight-cancel");
          return {
            attachments: [
              {
                id: "att-flight",
                type: "image",
                name: "f.png",
                mimeType: "image/png",
                sizeBytes: 100,
                path: "/p",
              },
            ],
          };
        }),
      },
      orchestration: {
        dispatchCommand: vi.fn(async () => {
          dispatchCalled = true;
          return { sequence: 302 };
        }),
      },
    };

    const { migrateLocalQueueToServer } = await import("./messageQueueStore");
    const res = await migrateLocalQueueToServer(undefined, mockApi as any);

    expect(uploadStarted).toBe(true);
    expect(dispatchCalled).toBe(false);
    expect(res.migratedCount).toBe(0);

    const remaining = useMessageQueueStore.getState().queueByThread[threadId] ?? [];
    expect(remaining.find((m) => m.id === "q-in-flight-cancel")).toBeUndefined();
  });

  it("cancellation after dispatch begins cancels server work upon delayed successful ACK", async () => {
    const threadId = "thread-1" as ThreadId;
    const store = useMessageQueueStore.getState();
    store.clearQueue(threadId);
    store.enqueueMessage({
      id: "q-dispatch-cancel-race",
      threadId,
      text: "Scheduled prompt awaiting dispatch ACK",
      createdAt: "2026-10-14T01:00:00Z",
    });

    let dispatchCalled = false;
    let releaseAck!: () => void;
    const ackPromise = new Promise<void>((resolve) => {
      releaseAck = resolve;
    });

    const sentCommands: any[] = [];
    const mockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          sentCommands.push(cmd);
          if (cmd.type === "message.dispatch") {
            dispatchCalled = true;
            await ackPromise;
            return { sequence: 401, runId: "run:thread-1:1" };
          }
          if (cmd.type === "queued-run.cancel") {
            return { sequence: 402 };
          }
          return { sequence: 400 };
        }),
      },
    };

    const { migrateLocalQueueToServer } = await import("./messageQueueStore");
    const migrationPromise = migrateLocalQueueToServer(undefined, mockApi as any);

    // Wait until dispatchCommand has been invoked
    while (!dispatchCalled) {
      await new Promise((r) => setTimeout(r, 5));
    }

    // Now user requests cancellation while ACK is in flight
    store.removeQueuedMessage(threadId, "q-dispatch-cancel-race");

    // Release delayed successful ACK
    releaseAck();

    await migrationPromise;

    // Must issue queued-run.cancel to the server!
    const cancelCommands = sentCommands.filter((c) => c.type === "queued-run.cancel");
    expect(cancelCommands).toHaveLength(1);
    expect(cancelCommands[0]?.runId).toBe("run:thread-1:1");

    // No uncancelled queued run remains in local queue
    const remaining = useMessageQueueStore.getState().queueByThread[threadId] ?? [];
    expect(remaining.find((m) => m.id === "q-dispatch-cancel-race")).toBeUndefined();
  });

  it("cancel before upload removes local entry and never uploads or dispatches", async () => {
    const threadId = "thread-1" as ThreadId;
    const store = useMessageQueueStore.getState();
    store.clearQueue(threadId);
    store.enqueueMessage({
      id: "q-cancel-before-upload",
      threadId,
      text: "Prompt before upload",
      createdAt: "2026-10-14T01:00:00Z",
    });

    // Remove before migration starts
    store.removeQueuedMessage(threadId, "q-cancel-before-upload");

    let uploadCalled = false;
    let dispatchCalled = false;
    const mockApi = {
      assets: {
        persistChatAttachments: vi.fn(async () => {
          uploadCalled = true;
          return { attachments: [] };
        }),
      },
      orchestration: {
        dispatchCommand: vi.fn(async () => {
          dispatchCalled = true;
          return { sequence: 1 };
        }),
      },
    };

    const { migrateLocalQueueToServer } = await import("./messageQueueStore");
    const res = await migrateLocalQueueToServer(undefined, mockApi as any);

    expect(uploadCalled).toBe(false);
    expect(dispatchCalled).toBe(false);
    expect(res.migratedCount).toBe(0);
    const remaining = useMessageQueueStore.getState().queueByThread[threadId] ?? [];
    expect(remaining.find((m) => m.id === "q-cancel-before-upload")).toBeUndefined();
  });

  it("cancel with lost ACK and subsequent reconnect reconciliation", async () => {
    const threadId = "thread-1" as ThreadId;
    const store = useMessageQueueStore.getState();
    store.clearQueue(threadId);
    store.enqueueMessage({
      id: "q-lost-ack",
      threadId,
      text: "Prompt with lost ACK",
      createdAt: "2026-10-14T01:00:00Z",
    });

    let dispatchCalled = false;
    const sentCommands: any[] = [];
    const disconnectedApi = {
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          sentCommands.push(cmd);
          if (cmd.type === "message.dispatch") {
            dispatchCalled = true;
            // User requested cancel while in flight
            store.removeQueuedMessage(threadId, "q-lost-ack");
            // Simulate network disconnect / dropped socket
            throw new Error("WebSocket connection lost");
          }
          return { sequence: 1 };
        }),
      },
    };

    const { migrateLocalQueueToServer } = await import("./messageQueueStore");
    await migrateLocalQueueToServer(undefined, disconnectedApi as any);

    // After dropped connection, pending cancellation should be preserved
    const pendingCancellations = useMessageQueueStore.getState().pendingCancellations ?? {};
    const hasPending = Object.values(pendingCancellations).some(
      (p) => p.messageId === "q-lost-ack",
    );
    expect(hasPending).toBe(true);

    // Now reconnect occurs with healthy server where run was created
    const reconnectedCommands: any[] = [];
    const reconnectedApi = {
      orchestration: {
        getThreadProjection: vi.fn(async () => ({
          runs: [
            {
              id: "run:recovered:1",
              userMessageId: "q-lost-ack",
              status: "queued",
            },
          ],
        })),
        dispatchCommand: vi.fn(async (cmd: any) => {
          reconnectedCommands.push(cmd);
          return { sequence: 2 };
        }),
      },
    };

    // Migration runs upon reconnect
    await migrateLocalQueueToServer(undefined, reconnectedApi as any);

    // Must issue queued-run.cancel for the discovered runId
    const cancelCmds = reconnectedCommands.filter((c) => c.type === "queued-run.cancel");
    expect(cancelCmds).toHaveLength(1);
    expect(cancelCmds[0]?.runId).toBe("run:recovered:1");

    // Local entry and pending cancellation should be cleared
    const remaining = useMessageQueueStore.getState().queueByThread[threadId] ?? [];
    expect(remaining.find((m) => m.id === "q-lost-ack")).toBeUndefined();
    const finalPending = useMessageQueueStore.getState().pendingCancellations ?? {};
    expect(Object.values(finalPending).some((p) => p.messageId === "q-lost-ack")).toBe(false);
  });

  it("server cancellation rejection preserves visible recoverable state and error", async () => {
    const threadId = "thread-1" as ThreadId;
    const store = useMessageQueueStore.getState();
    store.clearQueue(threadId);
    store.enqueueMessage({
      id: "q-rejection-test",
      threadId,
      text: "Prompt where cancel is rejected",
      createdAt: "2026-10-14T01:00:00Z",
    });

    let dispatchCalled = false;
    let releaseAck!: () => void;
    const ackPromise = new Promise<void>((r) => {
      releaseAck = r;
    });

    const mockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          if (cmd.type === "message.dispatch") {
            dispatchCalled = true;
            await ackPromise;
            return { sequence: 501, runId: "run:reject:1" };
          }
          if (cmd.type === "queued-run.cancel") {
            throw new Error("Server rejected queued run cancellation");
          }
          return { sequence: 500 };
        }),
      },
    };

    const { migrateLocalQueueToServer } = await import("./messageQueueStore");
    const migrationPromise = migrateLocalQueueToServer(undefined, mockApi as any);

    while (!dispatchCalled) {
      await new Promise((r) => setTimeout(r, 5));
    }

    store.removeQueuedMessage(threadId, "q-rejection-test");
    releaseAck();
    await migrationPromise;

    // Item must NOT be silently hidden! It should be preserved with cancellation_failed and error!
    const queue = useMessageQueueStore.getState().queueByThread[threadId] ?? [];
    const item = queue.find((m) => m.id === "q-rejection-test");
    expect(item).toBeDefined();
    expect(item?.intakeStatus).toBe("cancellation_failed");
    expect(item?.cancellationError).toContain("Server rejected queued run cancellation");
  });

  it("already-running case issues run.interrupt instead of queued-run.cancel", async () => {
    const threadId = "thread-1" as ThreadId;
    const store = useMessageQueueStore.getState();
    store.clearQueue(threadId);
    store.enqueueMessage({
      id: "q-running-test",
      threadId,
      text: "Prompt that starts immediately",
      createdAt: "2026-10-14T01:00:00Z",
    });

    let dispatchCalled = false;
    let releaseAck!: () => void;
    const ackPromise = new Promise<void>((r) => {
      releaseAck = r;
    });

    const sentCommands: any[] = [];
    const mockApi = {
      orchestration: {
        getThreadProjection: vi.fn(async () => ({
          runs: [
            {
              id: "run:running:1",
              userMessageId: "q-running-test",
              status: "running",
            },
          ],
        })),
        dispatchCommand: vi.fn(async (cmd: any) => {
          sentCommands.push(cmd);
          if (cmd.type === "message.dispatch") {
            dispatchCalled = true;
            await ackPromise;
            return { sequence: 601 };
          }
          return { sequence: 602 };
        }),
      },
    };

    const { migrateLocalQueueToServer } = await import("./messageQueueStore");
    const migrationPromise = migrateLocalQueueToServer(undefined, mockApi as any);

    while (!dispatchCalled) {
      await new Promise((r) => setTimeout(r, 5));
    }

    store.removeQueuedMessage(threadId, "q-running-test");
    releaseAck();
    await migrationPromise;

    const interruptCmds = sentCommands.filter((c) => c.type === "run.interrupt");
    expect(interruptCmds).toHaveLength(1);
    expect(interruptCmds[0]?.runId).toBe("run:running:1");
  });

  it("Send next on server run reorders before clearing schedule deadline", async () => {
    const threadId = "thread-1" as ThreadId;
    const sentCommands: any[] = [];
    const mockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          sentCommands.push(cmd);
          return { sequence: 700 };
        }),
      },
    };

    const { sendNextQueuedItem } = await import("./messageQueueStore");
    await sendNextQueuedItem(
      threadId,
      {
        userMessageId: "msg-1",
        runId: "run:server:2" as any,
        isServerAuthoritative: true,
        text: "Important prompt",
        attachments: [{ id: "att-1", name: "f.png" }],
      },
      mockApi as any,
      [{ id: "run:server:1" as any }, { id: "run:server:2" as any }],
    );

    // Reorder must happen FIRST before edit schedule
    expect(sentCommands).toHaveLength(2);
    expect(sentCommands[0]?.type).toBe("queued-run.reorder");
    expect(sentCommands[0]?.runId).toBe("run:server:2");
    expect(sentCommands[0]?.beforeRunId).toBe("run:server:1");

    expect(sentCommands[1]?.type).toBe("queued-run.edit");
    expect(sentCommands[1]?.runId).toBe("run:server:2");
    expect(sentCommands[1]?.scheduledFor).toBeNull();
    expect(sentCommands[1]?.text).toBe("Important prompt");
    expect(sentCommands[1]?.attachments).toEqual([{ id: "att-1", name: "f.png" }]);
  });

  it("Retry after failed intake preserves message and initiates durable intake", async () => {
    const threadId = "thread-1" as ThreadId;
    const store = useMessageQueueStore.getState();
    store.clearQueue(threadId);
    store.enqueueMessage({
      id: "q-retry-msg",
      threadId,
      text: "Retry me",
      createdAt: "2026-10-14T01:00:00Z",
      dispatchError: "Previous network failure",
    });

    const sentCommands: any[] = [];
    const mockApi = {
      orchestration: {
        getThreadProjection: vi.fn(async () => ({ runs: [] })),
        dispatchCommand: vi.fn(async (cmd: any) => {
          sentCommands.push(cmd);
          return { sequence: 801, runId: "run:retried:1" };
        }),
      },
    };

    const { retryQueuedMessage } = await import("./messageQueueStore");
    const success = await retryQueuedMessage(threadId, "q-retry-msg", mockApi as any);

    expect(success).toBe(true);
    expect(sentCommands.some((c) => c.type === "message.dispatch")).toBe(true);
    const remaining = useMessageQueueStore.getState().queueByThread[threadId] ?? [];
    expect(remaining.find((m) => m.id === "q-retry-msg")).toBeUndefined();
  });

  it("Send next on an ACKed server run when local queue is empty preserves queue hold", async () => {
    const threadId = "thread-1" as ThreadId;
    const store = useMessageQueueStore.getState();
    store.clearQueue(threadId); // Local queue is completely empty!

    const sentCommands: any[] = [];
    const mockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          sentCommands.push(cmd);
          return { sequence: 900 };
        }),
      },
    };

    const { sendNextQueuedItem } = await import("./messageQueueStore");
    await sendNextQueuedItem(
      threadId,
      {
        userMessageId: "msg-server-acked",
        runId: "run:acked:3" as any,
        isServerAuthoritative: true,
        text: "Direct server message",
        attachments: [{ id: "att-x", name: "doc.pdf" }],
        environmentId: "env-1" as any,
      },
      mockApi as any,
      [{ id: "run:acked:1" as any }, { id: "run:acked:2" as any }, { id: "run:acked:3" as any }],
    );

    // Moves ahead of the first other run (run:acked:1)
    expect(sentCommands).toHaveLength(2);
    expect(sentCommands[0]).toMatchObject({
      type: "queued-run.reorder",
      threadId,
      runId: "run:acked:3",
      beforeRunId: "run:acked:1",
    });
    expect(sentCommands[1]).toMatchObject({
      type: "queued-run.edit",
      threadId,
      runId: "run:acked:3",
      text: "Direct server message",
      scheduledFor: null,
      attachments: [{ id: "att-x", name: "doc.pdf" }],
    });
    // Never sends an unhold / resume command
    expect(sentCommands.some((c) => c.type.includes("resume") || c.type.includes("unhold"))).toBe(
      false,
    );
  });

  it("Send next reorder rejection prevents schedule edit and throws useful error", async () => {
    const threadId = "thread-1" as ThreadId;
    const sentCommands: any[] = [];
    const mockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          sentCommands.push(cmd);
          if (cmd.type === "queued-run.reorder") {
            throw new Error("Reorder failed: permission denied or run active");
          }
          return { sequence: 901 };
        }),
      },
    };

    const { sendNextQueuedItem } = await import("./messageQueueStore");
    await expect(
      sendNextQueuedItem(
        threadId,
        {
          userMessageId: "msg-reorder-fail",
          runId: "run:fail:1" as any,
          isServerAuthoritative: true,
          text: "Will fail reorder",
        },
        mockApi as any,
        [{ id: "run:first:0" as any }, { id: "run:fail:1" as any }],
      ),
    ).rejects.toThrow("Reorder failed");

    // Must NOT proceed to clear schedule if reorder was rejected!
    expect(sentCommands.some((c) => c.type === "queued-run.edit")).toBe(false);
  });

  it("Send next schedule-edit rejection throws error after reorder", async () => {
    const threadId = "thread-1" as ThreadId;
    const sentCommands: any[] = [];
    const mockApi = {
      orchestration: {
        dispatchCommand: vi.fn(async (cmd: any) => {
          sentCommands.push(cmd);
          if (cmd.type === "queued-run.edit") {
            throw new Error("Schedule edit rejected by server");
          }
          return { sequence: 902 };
        }),
      },
    };

    const { sendNextQueuedItem } = await import("./messageQueueStore");
    await expect(
      sendNextQueuedItem(
        threadId,
        {
          userMessageId: "msg-edit-fail",
          runId: "run:edit-fail:1" as any,
          isServerAuthoritative: true,
          text: "Will fail schedule edit",
        },
        mockApi as any,
        [{ id: "run:other:0" as any }, { id: "run:edit-fail:1" as any }],
      ),
    ).rejects.toThrow("Schedule edit rejected by server");

    expect(sentCommands.find((c) => c.type === "queued-run.reorder")).toBeDefined();
    expect(sentCommands.find((c) => c.type === "queued-run.edit")).toBeDefined();
  });

  it("Retry after upload failure retries upload and dispatch with preserved attachments and stable messageId", async () => {
    const threadId = "thread-1" as ThreadId;
    const store = useMessageQueueStore.getState();
    store.clearQueue(threadId);
    store.enqueueMessage({
      id: "q-upload-retry",
      threadId,
      text: "Retry with attachments",
      createdAt: "2026-10-14T01:00:00Z",
      dispatchError: "Upload failed: network error",
      attachments: [
        {
          id: "att-upload-1",
          name: "diagram.png",
          mimeType: "image/png",
          sizeBytes: 100,
          dataUrl: "data:image/png;base64,abc",
        },
      ],
    });

    let uploadedThreadId: any = null;
    let uploadedMessageId: any = null;
    let dispatchedCommand: any = null;

    const mockApi = {
      assets: {
        persistChatAttachments: vi.fn(async (input: any) => {
          uploadedThreadId = input.threadId;
          uploadedMessageId = input.messageId;
          return {
            attachments: [
              {
                id: "att-staged-1",
                name: "diagram.png",
                mimeType: "image/png",
                sizeBytes: 100,
                type: "image",
              },
            ],
          };
        }),
      },
      orchestration: {
        getThreadProjection: vi.fn(async () => ({ runs: [] })),
        dispatchCommand: vi.fn(async (cmd: any) => {
          dispatchedCommand = cmd;
          return { sequence: 903, runId: "run:uploaded:1" };
        }),
      },
    };

    const { retryQueuedMessage } = await import("./messageQueueStore");
    const success = await retryQueuedMessage(threadId, "q-upload-retry", mockApi as any);

    expect(success).toBe(true);
    expect(uploadedThreadId).toBe(threadId);
    expect(uploadedMessageId).toBe("q-upload-retry");
    expect(dispatchedCommand?.type).toBe("message.dispatch");
    expect(dispatchedCommand?.messageId).toBe("q-upload-retry");
    expect(dispatchedCommand?.attachments).toEqual([
      {
        id: "att-staged-1",
        name: "diagram.png",
        mimeType: "image/png",
        sizeBytes: 100,
        type: "image",
      },
    ]);
  });

  it("Retry after lost ACK does not duplicate delivery when server already has the run", async () => {
    const threadId = "thread-1" as ThreadId;
    const store = useMessageQueueStore.getState();
    store.clearQueue(threadId);
    store.enqueueMessage({
      id: "q-lost-ack-retry",
      threadId,
      text: "Already accepted on server",
      createdAt: "2026-10-14T01:00:00Z",
      dispatchError: "WebSocket connection lost before ACK",
    });

    let dispatchCalled = false;
    const mockApi = {
      orchestration: {
        getThreadProjection: vi.fn(async () => ({
          runs: [
            {
              id: "run:prior-accepted:1",
              userMessageId: "q-lost-ack-retry",
              status: "queued",
            },
          ],
        })),
        dispatchCommand: vi.fn(async () => {
          dispatchCalled = true;
          return { sequence: 904 };
        }),
      },
    };

    const { retryQueuedMessage } = await import("./messageQueueStore");
    const success = await retryQueuedMessage(threadId, "q-lost-ack-retry", mockApi as any);

    expect(success).toBe(true);
    // MUST NOT issue duplicate message.dispatch!
    expect(dispatchCalled).toBe(false);
    // Local queue must be cleared
    const remaining = useMessageQueueStore.getState().queueByThread[threadId] ?? [];
    expect(remaining.find((m) => m.id === "q-lost-ack-retry")).toBeUndefined();
  });

  it("Rapid repeated calls to migrate or retry do not duplicate intake", async () => {
    const threadId = "thread-1" as ThreadId;
    const store = useMessageQueueStore.getState();
    store.clearQueue(threadId);
    store.enqueueMessage({
      id: "q-rapid-clicks",
      threadId,
      text: "Rapid click test",
      createdAt: "2026-10-14T01:00:00Z",
    });

    let dispatchCount = 0;
    const mockApi = {
      orchestration: {
        getThreadProjection: vi.fn(async () => ({ runs: [] })),
        dispatchCommand: vi.fn(async (cmd: any) => {
          if (cmd.type === "message.dispatch") {
            dispatchCount += 1;
            await new Promise((r) => setTimeout(r, 20));
            return { sequence: 905, runId: "run:rapid:1" };
          }
          return { sequence: 906 };
        }),
      },
    };

    const { migrateLocalQueueToServer } = await import("./messageQueueStore");
    // Fire two concurrent migration passes
    const [res1, res2] = await Promise.all([
      migrateLocalQueueToServer(undefined, mockApi as any),
      migrateLocalQueueToServer(undefined, mockApi as any),
    ]);

    expect(dispatchCount).toBe(1);
    expect(res1.migratedCount + res2.migratedCount).toBe(1);
  });

  describe("Part 1 & 2: Correct cancellation targeting and durable recovery", () => {
    it("cancelled message absent locally while unrelated run is active NEVER interrupts unrelated run", async () => {
      const threadId = "thread-1" as ThreadId;
      const {
        useMessageQueueStore,
        requestCancellation,
        reconcilePendingCancellation,
        hasPendingCancellation,
      } = await import("./messageQueueStore");

      const store = useMessageQueueStore.getState();
      store.clearQueue(threadId);

      // Record pending cancellation for absent message
      const pending = requestCancellation(
        threadId,
        "msg-absent-target" as any,
        "env-1" as any,
        "cmd-absent-1" as any,
      );
      expect(hasPendingCancellation(threadId, "msg-absent-target" as any, "env-1" as any)).toBe(
        true,
      );

      const dispatchedCommands: any[] = [];
      const mockApi = {
        orchestration: {
          getSnapshot: vi.fn(async () => ({
            threads: [
              {
                id: threadId,
                environmentId: "env-1" as any,
                activeRunId: "run:unrelated:active" as any,
                activeRunUserMessageId: "msg-unrelated-prompt" as any,
                queuedRuns: [],
              },
            ],
          })),
          dispatchCommand: vi.fn(async (cmd: any) => {
            dispatchedCommands.push(cmd);
            return { sequence: 1001 };
          }),
        },
      };

      await reconcilePendingCancellation(pending, mockApi as any);

      // EXPLICIT ASSERTION: Unrelated active run MUST remain untouched!
      const unrelatedInterrupted = dispatchedCommands.some(
        (c) => c.runId === "run:unrelated:active",
      );
      expect(unrelatedInterrupted).toBe(false);
      expect(dispatchedCommands).toHaveLength(0);

      // Pending intent MUST be retained because identity is unresolved
      expect(hasPendingCancellation(threadId, "msg-absent-target" as any, "env-1" as any)).toBe(
        true,
      );
    });

    it("same thread ID in two environments isolates cancellations", async () => {
      const threadId = "thread-multi-env" as ThreadId;
      const { useMessageQueueStore, requestCancellation, reconcilePendingCancellation } =
        await import("./messageQueueStore");

      const store = useMessageQueueStore.getState();
      store.clearQueue(threadId);

      // Intent recorded for env-A
      const pendingEnvA = requestCancellation(threadId, "msg-target-a" as any, "env-A" as any);

      const dispatchedCommands: any[] = [];
      const mockApi = {
        orchestration: {
          getSnapshot: vi.fn(async () => ({
            threads: [
              {
                id: threadId,
                environmentId: "env-B" as any, // Different environment!
                activeRunId: "run:env-B:active" as any,
                activeRunUserMessageId: "msg-target-a" as any,
                queuedRuns: [],
              },
            ],
          })),
          dispatchCommand: vi.fn(async (cmd: any) => {
            dispatchedCommands.push(cmd);
            return { sequence: 1002 };
          }),
        },
      };

      // Reconciling pendingEnvA against env-B thread MUST NOT touch env-B!
      await reconcilePendingCancellation(pendingEnvA, mockApi as any);

      expect(dispatchedCommands).toHaveLength(0);
    });

    it("correct target queued issues queued-run.cancel and never touches unrelated run", async () => {
      const threadId = "thread-1" as ThreadId;
      const {
        useMessageQueueStore,
        requestCancellation,
        reconcilePendingCancellation,
        hasPendingCancellation,
      } = await import("./messageQueueStore");

      useMessageQueueStore.getState().clearQueue(threadId);

      const pending = requestCancellation(threadId, "msg-target-queued" as any, "env-1" as any);

      const dispatchedCommands: any[] = [];
      const mockApi = {
        orchestration: {
          getSnapshot: vi.fn(async () => ({
            threads: [
              {
                id: threadId,
                environmentId: "env-1" as any,
                activeRunId: "run:unrelated:active" as any,
                activeRunUserMessageId: "msg-unrelated" as any,
                queuedRuns: [
                  {
                    id: "run:target:queued" as any,
                    userMessageId: "msg-target-queued" as any,
                    status: "queued",
                  },
                ],
              },
            ],
          })),
          dispatchCommand: vi.fn(async (cmd: any) => {
            dispatchedCommands.push(cmd);
            return { sequence: 1003 };
          }),
        },
      };

      await reconcilePendingCancellation(pending, mockApi as any);

      // Targeted cancel issued for target queued run
      expect(dispatchedCommands).toHaveLength(1);
      expect(dispatchedCommands[0]?.type).toBe("queued-run.cancel");
      expect(dispatchedCommands[0]?.runId).toBe("run:target:queued");

      // Unrelated active run untouched
      expect(dispatchedCommands.some((c) => c.runId === "run:unrelated:active")).toBe(false);

      // Intent confirmed and cleared
      expect(hasPendingCancellation(threadId, "msg-target-queued" as any, "env-1" as any)).toBe(
        false,
      );
    });

    it("correct target running issues run.interrupt and never touches unrelated run", async () => {
      const threadId = "thread-1" as ThreadId;
      const {
        useMessageQueueStore,
        requestCancellation,
        reconcilePendingCancellation,
        hasPendingCancellation,
      } = await import("./messageQueueStore");

      useMessageQueueStore.getState().clearQueue(threadId);

      const pending = requestCancellation(threadId, "msg-target-running" as any, "env-1" as any);

      const dispatchedCommands: any[] = [];
      const mockApi = {
        orchestration: {
          getSnapshot: vi.fn(async () => ({
            threads: [
              {
                id: threadId,
                environmentId: "env-1" as any,
                activeRunId: "run:target:running" as any,
                activeRunUserMessageId: "msg-target-running" as any,
                queuedRuns: [],
              },
            ],
          })),
          dispatchCommand: vi.fn(async (cmd: any) => {
            dispatchedCommands.push(cmd);
            return { sequence: 1004 };
          }),
        },
      };

      await reconcilePendingCancellation(pending, mockApi as any);

      // Targeted interrupt issued for proven active run
      expect(dispatchedCommands).toHaveLength(1);
      expect(dispatchedCommands[0]?.type).toBe("run.interrupt");
      expect(dispatchedCommands[0]?.runId).toBe("run:target:running");

      expect(hasPendingCancellation(threadId, "msg-target-running" as any, "env-1" as any)).toBe(
        false,
      );
    });

    it("correct target already terminal confirms cancellation without issuing commands", async () => {
      const threadId = "thread-1" as ThreadId;
      const {
        useMessageQueueStore,
        requestCancellation,
        reconcilePendingCancellation,
        hasPendingCancellation,
      } = await import("./messageQueueStore");

      useMessageQueueStore.getState().clearQueue(threadId);

      const pending = requestCancellation(threadId, "msg-target-terminal" as any, "env-1" as any);

      const dispatchedCommands: any[] = [];
      const mockApi = {
        orchestration: {
          reconcileIntake: vi.fn(async () => ({
            outcome: "already_completed" as const,
            runId: "run:terminal:1",
            runStatus: "succeeded",
          })),
          dispatchCommand: vi.fn(async (cmd: any) => {
            dispatchedCommands.push(cmd);
            return { sequence: 1005 };
          }),
        },
      };

      await reconcilePendingCancellation(pending, mockApi as any);

      // No cancel or interrupt commands issued for already completed work
      expect(dispatchedCommands).toHaveLength(0);

      // Intent confirmed and cleared
      expect(hasPendingCancellation(threadId, "msg-target-terminal" as any, "env-1" as any)).toBe(
        false,
      );
    });

    it("stale or empty client projection retains cancellation intent as requested", async () => {
      const threadId = "thread-1" as ThreadId;
      const {
        useMessageQueueStore,
        requestCancellation,
        reconcilePendingCancellation,
        hasPendingCancellation,
        getCancellationKey,
      } = await import("./messageQueueStore");

      useMessageQueueStore.getState().clearQueue(threadId);

      const pending = requestCancellation(threadId, "msg-empty-projection" as any, "env-1" as any);

      const mockApi = {
        orchestration: {
          getSnapshot: vi.fn(async () => ({
            threads: [
              {
                id: threadId,
                environmentId: "env-1" as any,
                activeRunId: null,
                activeRunUserMessageId: null,
                queuedRuns: [],
              },
            ],
          })),
        },
      };

      await reconcilePendingCancellation(pending, mockApi as any);

      // MUST NOT wipe or confirm intent on empty/stale projection!
      expect(hasPendingCancellation(threadId, "msg-empty-projection" as any, "env-1" as any)).toBe(
        true,
      );
      const remainingPending = useMessageQueueStore.getState().pendingCancellations ?? {};
      const key = getCancellationKey(pending.threadId, pending.messageId, pending.environmentId);
      expect(remainingPending[key]?.status).toBe("requested");
    });

    it("repeated cancellation and concurrent reconciliation deduplicates operations", async () => {
      const threadId = "thread-1" as ThreadId;
      const { useMessageQueueStore, requestCancellation, reconcilePendingCancellation } =
        await import("./messageQueueStore");

      useMessageQueueStore.getState().clearQueue(threadId);

      const pending = requestCancellation(threadId, "msg-concurrent-cancel" as any, "env-1" as any);

      let reconcileCalls = 0;
      const mockApi = {
        orchestration: {
          reconcileIntake: vi.fn(async () => {
            reconcileCalls += 1;
            await new Promise((r) => setTimeout(r, 25));
            return {
              outcome: "cancelled" as const,
              runId: "run:concurrent:1",
              runStatus: "cancelled",
            };
          }),
        },
      };

      // Fire 3 concurrent reconciliation attempts
      await Promise.all([
        reconcilePendingCancellation(pending, mockApi as any),
        reconcilePendingCancellation(pending, mockApi as any),
        reconcilePendingCancellation(pending, mockApi as any),
      ]);

      // In-flight mutex ensures only 1 call runs
      expect(reconcileCalls).toBe(1);
    });
  });
});

it("creates a queued local draft before message intake and preserves the selected native model", async () => {
  const threadId = "queued-new-draft" as ThreadId;
  useMessageQueueStore.getState().enqueueMessage({
    id: "new-draft-message",
    threadId,
    text: "hello",
    createdAt: new Date().toISOString(),
    modelSelection: { instanceId: "antigravity", model: "gemini-3.8-flash-low" },
    threadCreation: {
      projectId: "project" as any,
      modelSelection: { instanceId: "antigravity" as any, model: "gemini-3.8-flash-low" },
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
    },
  });
  const commands: any[] = [];
  const api = {
    orchestration: {
      getThreadProjection: vi
        .fn()
        .mockRejectedValue(new Error(`No orchestration projection exists for thread ${threadId}`)),
      dispatchCommand: vi.fn(async (command) => {
        commands.push(command);
        return { sequence: 1, runId: "run" };
      }),
    },
  };
  const { migrateLocalQueueToServer } = await import("./messageQueueStore");
  const result = await migrateLocalQueueToServer(undefined, api);
  expect(result.failedCount).toBe(0);
  expect(commands.map((command) => command.type)).toEqual(["thread.create", "message.dispatch"]);
  expect(commands[1].modelSelection).toEqual({
    instanceId: "antigravity",
    model: "gemini-3.8-flash-low",
  });
  expect(useMessageQueueStore.getState().queueByThread[threadId]).toEqual([]);
});

it("recovers a scoped legacy draft in its owner before attachment upload and scheduled intake", async () => {
  const { EnvironmentId, ProjectId } = await import("@tabs/contracts");
  const { createScopedComposerDraftActions } = await import("~/state/composerDrafts");
  const { migrateLocalQueueToServer } = await import("./messageQueueStore");
  const env = EnvironmentId.makeUnsafe("legacy-owner");
  const thread = ThreadId.makeUnsafe("legacy-scoped-draft");
  createScopedComposerDraftActions(env).setProjectDraftThreadId(
    ProjectId.makeUnsafe("physical-project"),
    thread,
  );
  const selection = { instanceId: "codex", model: "native-model" };
  const scheduledFor = "2026-12-01T10:00:00.000Z";
  useMessageQueueStore.getState().enqueueMessage({
    id: "legacy-scoped-message",
    threadId: thread,
    environmentId: env,
    text: "recover me",
    createdAt: new Date().toISOString(),
    modelSelection: selection,
    scheduledFor,
    files: [
      {
        id: "file",
        name: "note.txt",
        mimeType: "text/plain",
        sizeBytes: 2,
        dataUrl: "data:text/plain;base64,aGk=",
      },
    ],
  });
  const order: string[] = [];
  const commands: any[] = [];
  const api = {
    assets: {
      persistChatAttachments: vi.fn(async () => {
        order.push("upload");
        return { attachments: [] };
      }),
    },
    orchestration: {
      dispatchCommand: vi.fn(async (command) => {
        order.push(command.type);
        commands.push(command);
        return { runId: "run" };
      }),
    },
  };
  await migrateLocalQueueToServer(EnvironmentId.makeUnsafe("wrong-owner"), api);
  expect(commands).toEqual([]);
  const result = await migrateLocalQueueToServer(env, api);
  expect(result.failedCount).toBe(0);
  expect(order).toEqual(["thread.create", "upload", "message.dispatch"]);
  expect(commands[0].projectId).toBe("physical-project");
  expect(commands[1]).toMatchObject({
    messageId: "legacy-scoped-message",
    text: "recover me",
    modelSelection: selection,
  });
  expect(commands[1].scheduledFor).toBeDefined();
  expect(useMessageQueueStore.getState().queueByThread[thread]).toEqual([]);
});

it("retries an uncertain direct send with the original identity, mode, provider and attachment", async () => {
  const { migrateLocalQueueToServer } = await import("./messageQueueStore");
  const threadId = ThreadId.makeUnsafe("direct-recovery");
  const attachment = {
    id: "image-id",
    type: "image" as const,
    name: "image.png",
    mimeType: "image/png",
    sizeBytes: 1,
    dataUrl: "data:image/png;base64,AA==",
  };
  const selection = { instanceId: "grok", model: "native-grok" };
  useMessageQueueStore.getState().enqueueMessage({
    id: "direct-identity",
    threadId,
    text: "retained direct",
    createdAt: new Date().toISOString(),
    dispatchMode: "start_immediately",
    modelSelection: selection,
    attachments: [attachment],
  });
  const persistChatAttachments = vi
    .fn()
    .mockResolvedValue({ attachments: [{ ...attachment, dataUrl: undefined }] });
  const dispatchCommand = vi
    .fn()
    .mockRejectedValueOnce(new Error("ACK lost"))
    .mockResolvedValueOnce({ runId: "accepted" });
  const api = { assets: { persistChatAttachments }, orchestration: { dispatchCommand } };
  await migrateLocalQueueToServer(undefined, api);
  expect(useMessageQueueStore.getState().queueByThread[threadId]?.[0]).toMatchObject({
    id: "direct-identity",
    dispatchError: "ACK lost",
    attachments: [attachment],
  });
  await migrateLocalQueueToServer(undefined, api);
  expect(dispatchCommand.mock.calls[0]?.[0]).toEqual(dispatchCommand.mock.calls[1]?.[0]);
  expect(dispatchCommand.mock.calls[1]?.[0]).toMatchObject({
    messageId: "direct-identity",
    dispatchMode: { type: "start_immediately" },
    modelSelection: selection,
  });
  expect(useMessageQueueStore.getState().queueByThread[threadId]).toEqual([]);
});

it("waits for concurrent intake to finish before reporting direct delivery", async () => {
  const { migrateLocalQueueToServer } = await import("./messageQueueStore");
  const threadId = ThreadId.makeUnsafe("direct-concurrent");
  useMessageQueueStore.getState().enqueueMessage({
    id: "direct-concurrent-message",
    threadId,
    text: "once",
    createdAt: new Date().toISOString(),
    dispatchMode: "start_immediately",
  });
  let finish!: () => void;
  const dispatchCommand = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const api = { orchestration: { dispatchCommand } };
  const first = migrateLocalQueueToServer(undefined, api);
  await vi.waitFor(() => expect(dispatchCommand).toHaveBeenCalledOnce());
  let completed = false;
  const second = migrateLocalQueueToServer(undefined, api).then(() => {
    completed = true;
  });
  await Promise.resolve();
  expect(completed).toBe(false);
  finish();
  await Promise.all([first, second]);
  expect(dispatchCommand).toHaveBeenCalledOnce();
  expect(useMessageQueueStore.getState().queueByThread[threadId]).toEqual([]);
});
