import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  THREAD_UNDO_WINDOW_MS,
  clearThreadUndo,
  hasThreadUndo,
  keyEndsThreadUndo,
  registerThreadUndo,
  takeThreadUndo,
} from "./threadUndo";

const entry = (label: string) => ({ label, undo: vi.fn(async () => undefined) });

describe("thread undo", () => {
  beforeEach(clearThreadUndo);

  it("hands back the latest action once", () => {
    const archive = entry("archive");
    registerThreadUndo(archive, 1000);
    expect(hasThreadUndo(1500)).toBe(true);
    expect(takeThreadUndo(1500)).toBe(archive);
    expect(takeThreadUndo(1500)).toBeNull();
  });

  it("a newer action replaces the older one", () => {
    registerThreadUndo(entry("pin"), 1000);
    const settle = entry("settle");
    registerThreadUndo(settle, 1200);
    expect(takeThreadUndo(1300)).toBe(settle);
  });

  it("expires after five seconds", () => {
    registerThreadUndo(entry("archive"), 1000);
    expect(hasThreadUndo(1000 + THREAD_UNDO_WINDOW_MS)).toBe(false);
    expect(takeThreadUndo(1000 + THREAD_UNDO_WINDOW_MS)).toBeNull();
  });

  it("is ended by any real key but not by a lone modifier", () => {
    expect(keyEndsThreadUndo("a")).toBe(true);
    expect(keyEndsThreadUndo("Enter")).toBe(true);
    expect(keyEndsThreadUndo("Meta")).toBe(false);
    expect(keyEndsThreadUndo("Shift")).toBe(false);
  });
});
