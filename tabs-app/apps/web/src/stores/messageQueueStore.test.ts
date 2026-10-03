import { beforeEach, describe, expect, it } from "vitest";
import { ThreadId } from "@tabs/contracts";
import { useMessageQueueStore, getThreadQueuedMessages } from "./messageQueueStore";

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
