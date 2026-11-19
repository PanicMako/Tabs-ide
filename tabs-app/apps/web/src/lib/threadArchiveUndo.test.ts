import { describe, expect, it, vi } from "vitest";
import { announceThreadArchived } from "./threadArchiveUndo";

function fakeToast() {
  const added: Array<Record<string, unknown>> = [];
  return {
    added,
    toast: {
      add: vi.fn((options: Record<string, unknown>) => {
        added.push(options);
        return `toast-${added.length}`;
      }),
      close: vi.fn(),
    },
  };
}

describe("announceThreadArchived", () => {
  it("offers an Undo that restores the thread and closes the toast", async () => {
    const { added, toast } = fakeToast();
    const undo = vi.fn(async () => undefined);
    announceThreadArchived({ title: "Fix the sidebar", undo, toast: toast as never });
    expect(added[0]).toMatchObject({ title: "Thread archived", description: "Fix the sidebar" });
    (added[0] as { actionProps: { onClick: () => void } }).actionProps.onClick();
    expect(toast.close).toHaveBeenCalledWith("toast-1");
    expect(undo).toHaveBeenCalledOnce();
  });

  it("reports an error when the thread cannot be restored", async () => {
    const { added, toast } = fakeToast();
    announceThreadArchived({
      title: "Fix the sidebar",
      undo: async () => {
        throw new Error("gone");
      },
      toast: toast as never,
    });
    (added[0] as { actionProps: { onClick: () => void } }).actionProps.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(added[1]).toMatchObject({
      type: "error",
      title: "Could not restore the thread",
      description: "gone",
    });
  });
});
