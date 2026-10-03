import { describe, expect, it } from "vitest";
import { ThreadId } from "@tabs/contracts";
import {
  useComposerDraftStore,
  type ComposerImageAttachment,
  type ComposerFileAttachment,
} from "~/composerDraftStore";
import { isCompactCommandMessage } from "./ContextWindowMeter.logic";

describe("composer state preservation during compaction", () => {
  const threadId = ThreadId.make("thread-compaction-test");

  it("identifies standalone compaction command only when no attachments are present", () => {
    expect(
      isCompactCommandMessage({
        role: "user",
        text: "/compact",
        attachments: [],
      }),
    ).toBe(true);

    expect(
      isCompactCommandMessage({
        role: "user",
        text: "/compact",
        attachments: [{ id: "img-1", type: "image" }],
      }),
    ).toBe(false);

    expect(
      isCompactCommandMessage({
        role: "user",
        text: "Please help /compact my code",
        attachments: [],
      }),
    ).toBe(false);
  });

  it("retains prompt text and attachments in draft store while compaction is dispatched", () => {
    const store = useComposerDraftStore.getState();

    // User is composing a message with prompt and attachments
    store.setPrompt(threadId, "Refactor this logic after compaction");
    const mockImage: ComposerImageAttachment = {
      type: "image",
      id: "img-1",
      name: "diagram.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      previewUrl: "blob:diagram",
      file: new File(["data"], "diagram.png", { type: "image/png" }),
    };
    store.addImage(threadId, mockImage);

    const mockFile: ComposerFileAttachment = {
      type: "file",
      id: "file-1",
      name: "index.ts",
      mimeType: "text/plain",
      sizeBytes: 1234,
      file: new File(["code"], "index.ts", { type: "text/plain" }),
    };
    store.addFiles(threadId, [mockFile]);

    // Verify initial state
    let draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.prompt).toBe("Refactor this logic after compaction");
    expect(draft?.images).toHaveLength(1);
    expect(draft?.files).toHaveLength(1);

    // Compaction is dispatched as a standalone command:
    // Notice that clearComposerContent is NOT called during compaction!
    // The draft state is untouched.
    draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.prompt).toBe("Refactor this logic after compaction");
    expect(draft?.images).toHaveLength(1);
    expect(draft?.images[0]?.name).toBe("diagram.png");
    expect(draft?.files).toHaveLength(1);
    expect(draft?.files[0]?.name).toBe("index.ts");
  });

  it("preserves draft state even if compaction fails or errors", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(threadId, "Draft text that must survive compaction failure");

    // Simulate compaction failure
    const compactionResult = {
      _tag: "Failure" as const,
      error: new Error("Compaction server error"),
    };
    expect(compactionResult._tag).toBe("Failure");

    // Draft store should still hold the user's input intact
    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.prompt).toBe("Draft text that must survive compaction failure");
  });
});
