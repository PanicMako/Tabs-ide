import "../../../index.css";
import { createRef } from "react";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { ComposerLayout, type ComposerSlots } from "./ComposerLayout";
import { WorkspaceModeSwitch } from "./WorkspaceModeSwitch";
import type { ComposerDraftsModel, ComposerQueueModel } from "./composerSheets";

vi.mock("../../../panelAnimations", () => ({
  usePanelAnimationSettings: () => ({ reducedMotion: true }),
  useSurfaceMotionSettings: () => ({
    active: false,
    reducedMotion: true,
    seconds: (s: number) => s,
  }),
}));

function slots(): ComposerSlots {
  const slot = (name: string) => <span data-testid={`slot-${name}`}>{name}</span>;
  return {
    banner: null,
    model: slot("model"),
    runtime: (
      <button type="button" data-testid="slot-runtime">
        runtime
      </button>
    ),
    planSidebar: null,
    contextMeter: slot("contextMeter"),
    pendingPanels: null,
    attachments: null,
    editor: <div contentEditable data-testid="slot-editor" />,
    dictation: slot("dictation"),
    primaryAction: <button type="submit">Send</button>,
    lengthValidation: null,
    workspace: slot("workspace"),
  };
}

function drafts(overrides: Partial<ComposerDraftsModel> = {}): ComposerDraftsModel {
  return {
    entries: [
      {
        id: "d1",
        prompt: "Refactor the settings page\nwith more detail",
        createdAt: new Date().toISOString(),
        attachmentCount: 1,
      },
    ],
    canSave: true,
    saveShortcut: "⌘S",
    onSave: () => {},
    onRestore: () => {},
    onDelete: () => {},
    onOpenAll: () => {},
    ...overrides,
  };
}

function renderLayout(
  extra: {
    drafts?: ComposerDraftsModel;
    queue?: ComposerQueueModel;
    onSchedule?: () => void;
    onToggle?: () => void;
  } = {},
) {
  return render(
    <div style={{ paddingTop: 400, width: 760 }}>
      <ComposerLayout
        slots={slots()}
        drafts={extra.drafts ?? drafts()}
        queue={extra.queue ?? { items: [], onOpenAll: () => {} }}
        cardRef={createRef()}
        controlsRef={createRef()}
        isDragOver={false}
        interactionMode="default"
        onToggleInteractionMode={extra.onToggle ?? (() => {})}
        onAttach={() => {}}
        onSchedule={extra.onSchedule}
      />
    </div>,
  );
}

it("keeps every control inside one card, with mic and send joined", async () => {
  const view = await renderLayout();
  try {
    const card = document.querySelector('[data-chat-composer-card="true"]')!;
    for (const name of ["model", "runtime", "editor", "dictation", "workspace", "contextMeter"]) {
      expect(card.querySelector(`[data-testid="slot-${name}"]`), name).not.toBeNull();
    }
    const send = card.querySelector('[role="group"][aria-label="Speak or send"]')!;
    expect(send.querySelector('[data-testid="slot-dictation"]')).not.toBeNull();
    expect(send.querySelector('button[type="submit"]')).not.toBeNull();
    expect(card.querySelector('[data-chat-composer-footer="true"]')).not.toBeNull();
    await expect.element(page.getByText("Runs in")).toBeInTheDocument();
  } finally {
    await view.unmount();
  }
});

it("reads the setup as a sentence and toggles build and plan", async () => {
  const onToggle = vi.fn();
  const view = await renderLayout({ onToggle });
  try {
    await expect.element(page.getByText("with", { exact: true })).toBeInTheDocument();
    await page.getByRole("button", { name: "Build mode, switch to plan" }).click();
    expect(onToggle).toHaveBeenCalledOnce();
  } finally {
    await view.unmount();
  }
});

it("folds attach and send later behind +, on one line, and closes when something else opens", async () => {
  const onSchedule = vi.fn();
  const view = await renderLayout({ onSchedule });
  try {
    await page.getByRole("button", { name: "More: attach, send later" }).click();
    const sendLater = page.getByRole("button", { name: /Send later/ });
    await expect.element(sendLater).toBeVisible();
    // One line: the label's height is a single line of text.
    const box = (sendLater.element() as HTMLElement).getBoundingClientRect();
    expect(box.height).toBeLessThan(32);
    await sendLater.click();
    expect(onSchedule).toHaveBeenCalledOnce();
    // Opening something else (the access picker) folds the tools away.
    await page.getByTestId("slot-runtime").click();
    await expect
      .element(page.getByRole("button", { name: "More: attach, send later" }))
      .toHaveAttribute("aria-expanded", "false");
  } finally {
    await view.unmount();
  }
});

it("explains why Send later is unavailable before anything is written", async () => {
  const view = await renderLayout();
  try {
    await page.getByRole("button", { name: "More: attach, send later" }).click();
    const sendLater = page.getByRole("button", { name: /Send later — write a message first/ });
    await expect.element(sendLater).toHaveAttribute("aria-disabled", "true");
    await sendLater.hover();
    await expect
      .element(page.getByText("Write a message first, then choose when it sends."))
      .toBeVisible();
  } finally {
    await view.unmount();
  }
});

it("opens saved drafts as a sheet and restores one", async () => {
  const onRestore = vi.fn();
  const view = await renderLayout({ drafts: drafts({ onRestore }) });
  try {
    await page.getByRole("button", { name: "Saved drafts: 1" }).click();
    await expect.element(page.getByRole("dialog", { name: "Saved drafts" })).toBeInTheDocument();
    await page.getByTitle("Put this draft back in the composer").click();
    expect(onRestore).toHaveBeenCalledWith("d1");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await view.unmount();
  }
});

it("shows a scheduled message as waiting, with when it sends", async () => {
  const inAnHour = new Date(Date.now() + 61 * 60_000).toISOString();
  const view = await renderLayout({
    queue: {
      items: [{ id: "q1", text: "hi", scheduledFor: inAnHour, failed: false }],
      onOpenAll: () => {},
    },
  });
  try {
    const strip = page.getByRole("button", { name: /Scheduled/ });
    await expect.element(strip).toHaveTextContent("hi");
    await expect.element(strip).toHaveTextContent(/in 1 hr/);
    await strip.click();
    await expect.element(page.getByRole("dialog", { name: "Queued messages" })).toBeInTheDocument();
  } finally {
    await view.unmount();
  }
});

it("picks where the agent works from two plain choices", async () => {
  const onChange = vi.fn();
  const view = await render(
    <WorkspaceModeSwitch mode="local" locked={false} inWorktree={false} onChange={onChange} />,
  );
  try {
    await expect
      .element(page.getByRole("radio", { name: /This checkout/ }))
      .toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: /New worktree/ }).click();
    expect(onChange).toHaveBeenCalledWith("worktree");
  } finally {
    await view.unmount();
  }
});
