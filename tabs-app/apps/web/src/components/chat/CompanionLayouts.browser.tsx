import "../../index.css";
import "../agents/companion/designs/designs.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { PromptStashEntry } from "~/promptStashStore";
import type { UnifiedQueueItem } from "./MessageQueuePanel";
import { QueueLedgerView } from "./QueueLayouts";
import { StashLedgerView } from "./StashLayouts";
import type { MessageQueueController } from "./useMessageQueue";
import type { PromptStashController } from "./usePromptStash";

const entry: PromptStashEntry = {
  id: "draft-1",
  createdAt: new Date().toISOString(),
  prompt: "Refactor the settings page into sections",
  attachments: [],
  files: [],
};

function stash(overrides: Partial<PromptStashController> = {}): PromptStashController {
  return {
    activeThreadId: "thread-1" as never,
    currentEnvironmentId: null,
    entries: [entry],
    filteredEntries: [entry],
    searchQuery: "",
    setSearchQuery: vi.fn(),
    selectedId: entry.id,
    setSelectedId: vi.fn(),
    editingId: null,
    setEditingId: vi.fn(),
    edit: vi.fn(async () => true),
    saving: false,
    copiedId: null,
    hasStashableDraft: true,
    restore: vi.fn(async () => undefined),
    stashCurrentDraft: vi.fn(async () => undefined),
    copy: vi.fn(async () => undefined),
    remove: vi.fn(),
    clearAll: vi.fn(async () => undefined),
    ...overrides,
  };
}

const items: UnifiedQueueItem[] = ["First follow up", "Second follow up"].map((text, index) => ({
  id: `q-${index}`,
  userMessageId: `m-${index}`,
  text,
  isServerAuthoritative: false,
  createdAt: new Date().toISOString(),
}));

function queue(overrides: Partial<MessageQueueController> = {}): MessageQueueController {
  return {
    activeThreadId: "thread-1" as never,
    queuedItems: items,
    expandedId: null,
    setExpandedId: vi.fn(),
    editingId: null,
    setEditingId: vi.fn(),
    edit: vi.fn(async () => true),
    schedulingMsgId: null,
    setSchedulingMsgId: vi.fn(),
    inFlightActionIds: new Set(),
    clear: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    sendOrRetry: vi.fn(async () => undefined),
    updateSchedule: vi.fn(async () => undefined),
    reorder: vi.fn(async () => undefined),
    ...overrides,
  };
}

it("stash ledger moves a draft to the composer and deletes it", async () => {
  const controller = stash();
  const view = await render(
    <div data-companion-design="grouped" style={{ width: 480, height: 600 }}>
      <StashLedgerView stash={controller} />
    </div>,
  );
  try {
    await page.getByRole("button", { name: "Move to composer" }).click();
    expect(controller.restore).toHaveBeenCalledWith(entry);
    await page.getByRole("button", { name: "Delete saved draft" }).click();
    expect(controller.remove).toHaveBeenCalledWith(entry.id);
  } finally {
    await view.unmount();
  }
});

it("stash ledger keeps a short draft against the left edge of its cell", async () => {
  const short = { ...entry, prompt: "hi" };
  const view = await render(
    <div data-companion-design="grouped" style={{ width: 560, height: 400 }}>
      <StashLedgerView
        stash={stash({ entries: [short], filteredEntries: [short], selectedId: null })}
      />
    </div>,
  );
  try {
    const text = view.container.querySelector<HTMLElement>(".ql-ledger-text");
    const cell = view.container.querySelector<HTMLElement>(".ql-ledger-cell");
    expect(text && getComputedStyle(text).textAlign).toBe("left");
    // The label starts at the cell's left padding, not centred in the stretched button.
    const range = document.createRange();
    range.selectNodeContents(text!);
    const gap = range.getBoundingClientRect().left - cell!.getBoundingClientRect().left;
    expect(gap).toBeLessThan(24);
  } finally {
    await view.unmount();
  }
});

it("queue ledger sends and reorders", async () => {
  const controller = queue();
  const view = await render(
    <div data-companion-design="grouped" style={{ width: 480, height: 600 }}>
      <QueueLedgerView queue={controller} />
    </div>,
  );
  try {
    await page
      .getByRole("button", { name: /Send (queued message 1 next|next)/ })
      .first()
      .click();
    expect(controller.sendOrRetry).toHaveBeenCalledWith(items[0]);
    await page.getByRole("button", { name: "Move queued message 2 up" }).click();
    expect(controller.reorder).toHaveBeenCalledWith(1, 0);
  } finally {
    await view.unmount();
  }
});
