import { beforeEach, describe, expect, it } from "vitest";
import { EnvironmentId, MessageId, ThreadId } from "@tabs/contracts";
import { serializeAssistantCitation } from "@tabs/shared/assistantCitations";

import {
  MAX_PROMPT_STASH_ENTRIES,
  MAX_STASH_ENTRY_ATTACHMENT_CHARS,
  partitionStashAttachments,
  promptStashSnippet,
  usePromptStashStore,
  writePromptStashStorageForTest,
  type PromptStashEntry,
} from "./promptStashStore";

function entry(
  id: string,
  prompt = `prompt ${id}`,
  options?: {
    environmentId?: EnvironmentId;
    attachments?: PromptStashEntry["attachments"];
    files?: PromptStashEntry["files"];
  },
): PromptStashEntry {
  return {
    id,
    prompt,
    createdAt: "2026-09-10T12:00:00.000Z",
    attachments: options?.attachments ?? [],
    ...(options?.environmentId ? { environmentId: options.environmentId } : {}),
    ...(options?.files ? { files: options.files } : {}),
  };
}

describe("partitionStashAttachments", () => {
  it("keeps attachments within the budget and reports dropped names in order", () => {
    const small = {
      id: "a",
      name: "small.png",
      mimeType: "image/png",
      sizeBytes: 10,
      dataUrl: "x".repeat(10),
    };
    const huge = {
      id: "b",
      name: "huge.png",
      mimeType: "image/png",
      sizeBytes: MAX_STASH_ENTRY_ATTACHMENT_CHARS,
      dataUrl: "x".repeat(MAX_STASH_ENTRY_ATTACHMENT_CHARS),
    };
    const alsoSmall = {
      id: "c",
      name: "also-small.png",
      mimeType: "image/png",
      sizeBytes: 10,
      dataUrl: "x".repeat(10),
    };
    const { kept, droppedNames } = partitionStashAttachments([small, huge, alsoSmall]);
    expect(kept.map((attachment) => attachment.id)).toEqual(["a", "c"]);
    expect(droppedNames).toEqual(["huge.png"]);
  });

  it("admits a single attachment that fits the budget", () => {
    const exact = {
      id: "a",
      name: "exact.png",
      mimeType: "image/png",
      sizeBytes: 100,
      dataUrl: "x".repeat(100),
    };
    const { kept, droppedNames } = partitionStashAttachments([exact]);
    expect(kept).toHaveLength(1);
    expect(droppedNames).toEqual([]);
  });
});

describe("promptStashStore", () => {
  beforeEach(() => {
    usePromptStashStore.setState({ entries: [] });
  });

  it("stores newest entries first and returns a restored entry exactly once", () => {
    const store = usePromptStashStore.getState();
    store.stash(entry("one"));
    store.stash(entry("two"));

    expect(usePromptStashStore.getState().entries.map(({ id }) => id)).toEqual(["two", "one"]);
    expect(usePromptStashStore.getState().take("one")?.id).toBe("one");
    expect(usePromptStashStore.getState().take("one")).toBeNull();
  });

  it("caps the queue and reports the evicted oldest entry", () => {
    const store = usePromptStashStore.getState();
    for (let index = 0; index < MAX_PROMPT_STASH_ENTRIES; index += 1) {
      store.stash(entry(String(index)));
    }

    const evicted = usePromptStashStore.getState().stash(entry("newest"));

    expect(evicted?.id).toBe("0");
    expect(usePromptStashStore.getState().entries).toHaveLength(MAX_PROMPT_STASH_ENTRIES);
  });

  it("builds a bounded readable label", () => {
    expect(promptStashSnippet(entry("long", "  a   very long prompt  "))).toBe(
      "a very long prompt",
    );
    expect(
      promptStashSnippet({
        ...entry("image", ""),
        attachments: [
          {
            id: "img-1",
            name: "test.png",
            mimeType: "image/png",
            sizeBytes: 100,
            dataUrl: "data:image/png;base64,abc",
          },
        ],
      }),
    ).toBe("(1 image)");
  });

  it("formats assistant citations as plain text in promptStashSnippet", () => {
    const citation = {
      version: 1 as const,
      environmentId: EnvironmentId.make("env-1"),
      threadId: ThreadId.make("thread-1"),
      messageId: MessageId.make("msg-1"),
      text: "Quoted assistant response",
      start: 0,
      end: 25,
      prefix: "",
      suffix: "",
    };
    const promptWithCitation = `${serializeAssistantCitation(citation)} What do you think?`;
    expect(promptStashSnippet(entry("cite", promptWithCitation))).toContain(
      "Quoted assistant response What do you think?",
    );
  });

  it("clears entries globally or by environment", () => {
    const envA = EnvironmentId.make("env-a");
    const envB = EnvironmentId.make("env-b");
    const store = usePromptStashStore.getState();

    store.stash(entry("1", "prompt 1", { environmentId: envA }));
    store.stash(entry("2", "prompt 2", { environmentId: envB }));
    store.stash(entry("3", "prompt 3", { environmentId: envA }));

    expect(usePromptStashStore.getState().entries).toHaveLength(3);

    // Clear only envA entries
    store.clear(envA);
    const remaining = usePromptStashStore.getState().entries;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("2");

    // Clear all
    store.clear();
    expect(usePromptStashStore.getState().entries).toHaveLength(0);
  });

  it("finalizes entry images and clears pending count", () => {
    const store = usePromptStashStore.getState();
    store.stashEntry({
      ...entry("async-entry"),
      pendingImageCount: 2,
    });

    expect(usePromptStashStore.getState().entries[0]?.pendingImageCount).toBe(2);

    const result = store.finalizeEntryImages("async-entry", {
      attachments: [
        {
          id: "img-final",
          name: "final.png",
          mimeType: "image/png",
          sizeBytes: 50,
          dataUrl: "data:image/png;base64,zzz",
        },
      ],
      droppedImageNames: ["oversized.png"],
      unreadableImageNames: [],
    });

    expect(result.attached).toBe(true);
    const updated = usePromptStashStore.getState().entries[0];
    expect(updated?.pendingImageCount).toBe(0);
    expect(updated?.attachments).toHaveLength(1);
    expect(updated?.droppedImageNames).toEqual(["oversized.png"]);
  });
});
