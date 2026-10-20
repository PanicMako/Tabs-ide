import "../../index.css";
import "../agents/companion/companion.css";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ThreadId } from "@tabs/contracts";
import { MessageQueuePanel } from "./MessageQueuePanel";
import { useMessageQueueStore } from "~/stores/messageQueueStore";
const fixture = vi.hoisted(() => ({
  confirm: vi.fn(async () => false),
  send: vi.fn(),
  toast: vi.fn(),
  sendNext: vi.fn(async () => {}),
}));
vi.mock("~/stores/messageQueueStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/stores/messageQueueStore")>()),
  sendNextQueuedItem: fixture.sendNext,
}));
vi.mock("~/connection/environmentApiRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/connection/environmentApiRegistry")>()),
  environmentApi: async () => ({}),
}));
vi.mock("~/lib/customConfirm", () => ({ showCustomConfirm: fixture.confirm }));
vi.mock("../ui/toast", () => ({ toastManager: { add: fixture.toast } }));
vi.mock("../ui/SchedulePicker", () => ({
  SchedulePicker: ({ onConfirm }: { onConfirm: (date: Date) => void }) => (
    <button onClick={() => onConfirm(new Date("2030-01-01T12:00:00Z"))}>
      Confirm test schedule
    </button>
  ),
}));
const thread = ThreadId.makeUnsafe("queue-ui");
const other = ThreadId.makeUnsafe("queue-other");
beforeEach(() => {
  fixture.confirm.mockReset().mockResolvedValue(false);
  fixture.send.mockClear();
  fixture.sendNext.mockReset().mockResolvedValue(undefined);
  fixture.toast.mockClear();
  useMessageQueueStore.setState({
    queueByThread: {
      [thread]: [
        {
          id: "first",
          threadId: thread,
          text: "First follow-up",
          createdAt: new Date().toISOString(),
          attachments: [
            {
              id: "image",
              name: "layout.png",
              mimeType: "image/png",
              sizeBytes: 68,
              dataUrl:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
            },
          ],
        },
        {
          id: "second",
          threadId: thread,
          text: "Second follow-up",
          createdAt: new Date().toISOString(),
          scheduledFor: "2030-01-01T12:00:00Z",
        },
      ],
      [other]: [
        { id: "other", threadId: other, text: "Other thread", createdAt: new Date().toISOString() },
      ],
    },
  });
});
it.each([360, 700])("keeps queue cards compact and expandable at %ipx", async (width) => {
  const view = await render(
    <div style={{ width }}>
      <MessageQueuePanel activeThreadId={thread} onSendNow={fixture.send} />
    </div>,
  );
  try {
    expect(
      document.querySelector(".queue-toolbar")!.getBoundingClientRect().height,
    ).toBeLessThanOrEqual(46);
    for (const card of document.querySelectorAll(".queue-message"))
      expect(card.scrollWidth).toBeLessThanOrEqual(Math.ceil(card.getBoundingClientRect().width));
    await expect.element(page.getByRole("img", { name: "layout.png" })).toBeVisible();
    const preview = page.getByRole("button", { name: "Preview queued message: First follow-up" });
    await preview.click();
    await expect.element(preview).toHaveAttribute("aria-expanded", "true");
    await preview.click();
    await expect.element(preview).toHaveAttribute("aria-expanded", "false");
    await expect
      .element(page.getByRole("button", { name: "Move queued message 1 up" }))
      .toBeDisabled();
  } finally {
    await view.unmount();
  }
});
it("reorders and deletes messages and confirms before clearing only the active thread", async () => {
  const view = await render(<MessageQueuePanel activeThreadId={thread} />);
  try {
    await page.getByRole("button", { name: "Move queued message 1 down" }).click();
    expect(useMessageQueueStore.getState().queueByThread[thread]!.map((item) => item.id)).toEqual([
      "second",
      "first",
    ]);
    await page.getByRole("button", { name: "Delete queued message 2" }).click();
    expect(useMessageQueueStore.getState().queueByThread[thread]).toHaveLength(1);
    await page.getByRole("button", { name: "Clear queue", exact: true }).click();
    expect(useMessageQueueStore.getState().queueByThread[thread]).toHaveLength(1);
    fixture.confirm.mockResolvedValue(true);
    await page.getByRole("button", { name: "Clear queue", exact: true }).click();
    expect(useMessageQueueStore.getState().queueByThread[thread]).toEqual([]);
    expect(useMessageQueueStore.getState().queueByThread[other]).toHaveLength(1);
  } finally {
    await view.unmount();
  }
});
it("changes and clears a schedule and passes Send next to the existing handler", async () => {
  const view = await render(<MessageQueuePanel activeThreadId={thread} onSendNow={fixture.send} />);
  try {
    await page.getByRole("button", { name: "Schedule queued message 1", exact: true }).click();
    await page.getByRole("button", { name: "Confirm test schedule" }).click();
    expect(useMessageQueueStore.getState().queueByThread[thread]![0]!.scheduledFor).toBe(
      "2030-01-01T12:00:00.000Z",
    );
    await page.getByRole("button", { name: "Clear time", exact: true }).first().click();
    expect(useMessageQueueStore.getState().queueByThread[thread]![0]!.scheduledFor).toBeNull();
    await page.getByRole("button", { name: "Send queued message 1 next", exact: true }).click();
    expect(fixture.send).toHaveBeenCalledWith(expect.objectContaining({ id: "first" }));
    expect(useMessageQueueStore.getState().queueByThread[thread]).toHaveLength(2);
  } finally {
    await view.unmount();
  }
});

it("reports a failed Send next without invoking the success callback", async () => {
  fixture.sendNext.mockRejectedValue(new Error("Upload unavailable"));
  const view = await render(<MessageQueuePanel activeThreadId={thread} onSendNow={fixture.send} />);
  try {
    await page.getByRole("button", { name: "Send queued message 1 next", exact: true }).click();
    await vi.waitFor(() =>
      expect(fixture.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          title: "Failed to send next",
          description: "Upload unavailable",
        }),
      ),
    );
    expect(fixture.send).not.toHaveBeenCalled();
    expect(fixture.toast).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
  } finally {
    await view.unmount();
  }
});
