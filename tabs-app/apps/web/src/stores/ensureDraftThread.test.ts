import { expect, test, vi } from "vitest";
import { ensureDraftThreadExists, type DraftThreadCreation } from "./ensureDraftThread";
import type { ThreadId } from "@tabs/contracts";
const threadId = "draft-thread" as ThreadId;
const creation = {
  projectId: "project",
  modelSelection: { instanceId: "antigravity", model: "gemini-3.8-flash-low" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
} as DraftThreadCreation;

test("persists a missing draft once before simultaneous callers can continue intake", async () => {
  const order: string[] = [];
  const api = {
    getThreadProjection: vi
      .fn()
      .mockRejectedValue(new Error("No orchestration projection exists for thread draft-thread")),
    dispatchCommand: vi.fn(async () => {
      order.push("persisted");
    }),
  };
  await Promise.all([
    ensureDraftThreadExists(api, threadId, creation).then(() => order.push("intake-1")),
    ensureDraftThreadExists(api, threadId, creation).then(() => order.push("intake-2")),
  ]);
  expect(api.dispatchCommand).toHaveBeenCalledOnce();
  expect(api.getThreadProjection).not.toHaveBeenCalled();
  expect(order).toEqual(["persisted", "intake-1", "intake-2"]);
  expect(api.dispatchCommand).toHaveBeenCalledWith(
    expect.objectContaining({ type: "thread.create", modelSelection: creation.modelSelection }),
  );
});
test("recovers an already persisted draft after a creation conflict", async () => {
  const api = {
    getThreadProjection: vi.fn().mockResolvedValue({ threadId }),
    dispatchCommand: vi.fn().mockRejectedValue(new Error("Thread already exists")),
  };
  await ensureDraftThreadExists(api, threadId, creation);
  expect(api.getThreadProjection).toHaveBeenCalledWith({ threadId });
});
test("retains transport failures rather than treating them as missing threads", async () => {
  const api = {
    getThreadProjection: vi.fn().mockRejectedValue(new Error("Disconnected")),
    dispatchCommand: vi.fn().mockRejectedValue(new Error("Disconnected")),
  };
  await expect(ensureDraftThreadExists(api, threadId, creation)).rejects.toThrow("Disconnected");
  expect(api.dispatchCommand).toHaveBeenCalledOnce();
});
