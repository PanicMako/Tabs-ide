import { afterEach, describe, expect, it } from "vitest";
import { onQueueShortcut, requestQueueShortcut, resetQueueShortcuts } from "./queueShortcuts";

afterEach(resetQueueShortcuts);

describe("queue shortcuts", () => {
  it("delivers a request to a mounted panel", () => {
    const seen: string[] = [];
    onQueueShortcut((r) => (seen.push(`${r.threadId}:${r.action}`), true));
    requestQueueShortcut("t1", "edit");
    expect(seen).toEqual(["t1:edit"]);
  });

  it("holds a request for a panel that mounts a moment later, once", () => {
    requestQueueShortcut("t1", "sendNow", 1000);
    const seen: string[] = [];
    onQueueShortcut((r) => (seen.push(r.action), true), 1500);
    onQueueShortcut((r) => (seen.push(`again:${r.action}`), true), 1600);
    expect(seen).toEqual(["sendNow"]);
  });

  it("drops a request nobody picked up in time", () => {
    requestQueueShortcut("t1", "edit", 1000);
    const seen: string[] = [];
    onQueueShortcut((r) => (seen.push(r.action), true), 4000);
    expect(seen).toEqual([]);
  });

  it("keeps the request when the listener is for another thread", () => {
    const seen: string[] = [];
    onQueueShortcut((r) => (r.threadId === "t2" ? (seen.push("t2"), true) : false));
    requestQueueShortcut("t1", "edit");
    expect(seen).toEqual([]);
  });
});
