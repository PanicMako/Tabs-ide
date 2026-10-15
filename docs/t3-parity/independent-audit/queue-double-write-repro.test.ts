import { expect, it, vi } from "vitest";
import type { ThreadId } from "@tabs/contracts";
const storage = vi.hoisted(() => ({
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));
vi.mock("~/lib/storage", () => ({ createMemoryStorage: () => storage }));
import { useMessageQueueStore } from "./messageQueueStore";
it("records enqueue outcome when the middleware second write fails", () => {
  storage.setItem.mockClear();
  storage.setItem
    .mockImplementationOnce(() => {})
    .mockImplementationOnce(() => {
      throw new Error("second write unavailable");
    });
  const message = {
    id: "audit-message",
    threadId: "audit-thread" as ThreadId,
    text: "keep composer",
    createdAt: "2026-10-09",
  };
  expect(() => useMessageQueueStore.getState().enqueueMessage(message)).toThrow(
    "second write unavailable",
  );
  expect(storage.setItem).toHaveBeenCalledTimes(2);
  expect(useMessageQueueStore.getState().queueByThread[message.threadId]).toEqual([message]);
  expect(storage.setItem.mock.calls[0]?.[1]).toContain("audit-message");
});
