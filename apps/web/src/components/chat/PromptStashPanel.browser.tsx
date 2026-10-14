import "../../index.css";
import "../agents/companion/companion.css";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ThreadId } from "@tabs/contracts";
import { PromptStashPanel } from "./PromptStashPanel";
import {
  usePromptStashStore,
  MAX_STASH_ENTRY_ATTACHMENT_CHARS,
  PROMPT_STASH_STORAGE_KEY,
} from "~/promptStashStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { composerDraftActions } from "~/state/composerDrafts";
const fixture = vi.hoisted(() => ({ confirm: vi.fn(async () => false), toast: vi.fn() }));
vi.mock("~/lib/customConfirm", () => ({ showCustomConfirm: fixture.confirm }));
vi.mock("../ui/toast", () => ({ toastManager: { add: fixture.toast } }));
vi.mock("~/state/composerDrafts", async (original) => {
  const actual = await original<typeof import("~/state/composerDrafts")>();
  const { useComposerDraftStore } = await import("~/composerDraftStore");
  return {
    ...actual,
    useComposerDraft: (threadId: ThreadId) =>
      useComposerDraftStore((state) => state.draftsByThreadId[threadId]),
  };
});
const thread = ThreadId.makeUnsafe("stash-ui-test");
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
beforeEach(() => {
  usePromptStashStore.setState({ entries: [] });
  useComposerDraftStore.setState({ draftsByThreadId: {} });
  fixture.confirm.mockClear();
  fixture.toast.mockClear();
});
it("saves and restores text, image bytes and file bytes without sending a message", async () => {
  composerDraftActions.setPrompt(thread, "Build this layout");
  const image = new File([await (await fetch(png)).arrayBuffer()], "layout.png", {
    type: "image/png",
  });
  composerDraftActions.addImages(thread, [
    {
      type: "image",
      id: "image",
      name: image.name,
      mimeType: image.type,
      sizeBytes: image.size,
      file: image,
      previewUrl: png,
    },
  ]);
  const file = new File(["file context"], "notes.txt", { type: "text/plain" });
  composerDraftActions.addFiles(thread, [
    { type: "file", id: "file", name: file.name, mimeType: file.type, sizeBytes: file.size, file },
  ]);
  const view = await render(<PromptStashPanel activeThreadId={thread} />);
  try {
    await page.getByRole("button", { name: "Save current draft" }).click();
    await expect.poll(() => usePromptStashStore.getState().entries.length).toBe(1);
    expect(useComposerDraftStore.getState().draftsByThreadId[thread]?.prompt ?? "").toBe("");
    await expect.element(page.getByRole("img", { name: "layout.png" })).toBeVisible();
    expect(
      document.querySelector(".stash-toolbar")!.getBoundingClientRect().height,
    ).toBeLessThanOrEqual(46);
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect.poll(() => usePromptStashStore.getState().entries.length).toBe(0);
    const draft = useComposerDraftStore.getState().draftsByThreadId[thread]!;
    expect(draft.prompt).toBe("Build this layout");
    expect(await draft.files[0]!.file.text()).toBe("file context");
    expect(await draft.images[0]!.file.arrayBuffer()).toEqual(await image.arrayBuffer());
  } finally {
    await view.unmount();
  }
});
it("adds saved text and images to a draft while keeping the saved copy", async () => {
  composerDraftActions.setPrompt(thread, "Existing draft");
  usePromptStashStore.getState().stashEntry({
    id: "saved",
    createdAt: new Date().toISOString(),
    prompt: "Saved idea",
    attachments: [
      { id: "image", name: "layout.png", mimeType: "image/png", sizeBytes: 68, dataUrl: png },
    ],
  });
  const view = await render(<PromptStashPanel activeThreadId={thread} />);
  try {
    await page.getByRole("button", { name: "Add", exact: true }).click();
    expect(useComposerDraftStore.getState().draftsByThreadId[thread]?.prompt).toBe(
      "Existing draft\n\nSaved idea",
    );
    expect(useComposerDraftStore.getState().draftsByThreadId[thread]?.images).toHaveLength(1);
    expect(usePromptStashStore.getState().entries).toHaveLength(1);
    expect(fixture.confirm).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    expect(fixture.confirm).toHaveBeenCalled();
    expect(usePromptStashStore.getState().entries).toHaveLength(1);
  } finally {
    await view.unmount();
  }
});
it("keeps oversized image drafts intact and explains why saving failed", async () => {
  composerDraftActions.setPrompt(thread, "Keep me");
  const image = new File([new Uint8Array(MAX_STASH_ENTRY_ATTACHMENT_CHARS)], "large.png", {
    type: "image/png",
  });
  composerDraftActions.addImages(thread, [
    {
      type: "image",
      id: "large",
      name: image.name,
      mimeType: image.type,
      sizeBytes: image.size,
      file: image,
      previewUrl: png,
    },
  ]);
  const view = await render(<PromptStashPanel activeThreadId={thread} />);
  try {
    await page.getByRole("button", { name: "Save current draft" }).click();
    await expect
      .poll(() =>
        fixture.toast.mock.calls.some(([toast]) => toast.title === "Could not save draft"),
      )
      .toBe(true);
    expect(usePromptStashStore.getState().entries).toHaveLength(0);
    expect(useComposerDraftStore.getState().draftsByThreadId[thread]?.prompt).toBe("Keep me");
    expect(useComposerDraftStore.getState().draftsByThreadId[thread]?.images).toHaveLength(1);
  } finally {
    await view.unmount();
  }
});

it("preserves terminal context even in a draft with no text or images", async () => {
  composerDraftActions.addTerminalContexts(thread, [
    {
      id: "terminal-context",
      threadId: thread,
      terminalId: "terminal",
      terminalLabel: "Build",
      lineStart: 1,
      lineEnd: 1,
      text: "Build failed: missing import",
      createdAt: new Date().toISOString(),
    },
  ]);
  const view = await render(<PromptStashPanel activeThreadId={thread} />);
  try {
    await page.getByRole("button", { name: "Save current draft" }).click();
    await expect.poll(() => usePromptStashStore.getState().entries.length).toBe(1);
    expect(usePromptStashStore.getState().entries[0]!.prompt).toContain(
      "Build failed: missing import",
    );
    expect(
      useComposerDraftStore.getState().draftsByThreadId[thread]?.terminalContexts ?? [],
    ).toHaveLength(0);
    await page.getByRole("button", { name: /Preview saved draft:/ }).click();
    await expect
      .element(page.getByRole("button", { name: /Preview saved draft:/ }))
      .toHaveAttribute("aria-expanded", "true");
  } finally {
    await view.unmount();
  }
});

it("keeps the draft when durable stash storage rejects the write", async () => {
  composerDraftActions.setPrompt(thread, "Do not lose this draft");
  const original = Storage.prototype.setItem;
  const storage = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, value) {
      if (key === PROMPT_STASH_STORAGE_KEY)
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return original.call(this, key, value);
    });
  const view = await render(<PromptStashPanel activeThreadId={thread} />);
  try {
    await page.getByRole("button", { name: "Save current draft" }).click();
    await expect
      .poll(() =>
        fixture.toast.mock.calls.some(([toast]) => toast.title === "Could not save draft"),
      )
      .toBe(true);
    expect(usePromptStashStore.getState().entries).toHaveLength(0);
    expect(useComposerDraftStore.getState().draftsByThreadId[thread]?.prompt).toBe(
      "Do not lose this draft",
    );
  } finally {
    storage.mockRestore();
    await view.unmount();
  }
});
