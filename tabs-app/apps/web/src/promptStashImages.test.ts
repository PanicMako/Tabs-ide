import { beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryStashImageBackend,
  setStashImageBackendForTest,
  stashImageKey,
} from "./promptStashImageStore";
import {
  flushStashImageWrites,
  hydrateStashImages,
  stashEntryImageBudgetChars,
  MAX_STASH_ENTRY_ATTACHMENT_CHARS,
  usePromptStashStore,
  type PromptStashEntry,
} from "./promptStashStore";

const image = (id: string) => ({
  id,
  name: `${id}.png`,
  mimeType: "image/png",
  sizeBytes: 10,
  dataUrl: `data:image/png;base64,${id}`,
});

const draft = (id: string, imageIds: string[]): PromptStashEntry => ({
  id,
  prompt: `prompt ${id}`,
  createdAt: "2026-11-17T10:00:00.000Z",
  attachments: imageIds.map(image),
});

let run = 0;
/** Draft ids are unique per test: the store remembers which images it already saved. */
const id = (name: string) => `${name}${run}`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("stash images in the image store", () => {
  let backend: ReturnType<typeof createMemoryStashImageBackend>;

  beforeEach(() => {
    run += 1;
    backend = createMemoryStashImageBackend();
    setStashImageBackendForTest(backend);
    usePromptStashStore.setState({ entries: [] });
  });

  it("keeps every image of a draft with several screenshots", async () => {
    usePromptStashStore.getState().stashEntry(draft(id("a"), ["one", "two", "three"]));
    await flushStashImageWrites();
    expect([...(await backend.keys())].sort()).toEqual(
      ["one", "two", "three"].map((imageId) => stashImageKey(id("a"), imageId)).sort(),
    );
  });

  it("brings the images back after a restart", async () => {
    usePromptStashStore.getState().stashEntry(draft(id("a"), ["one", "two"]));
    await flushStashImageWrites();
    // After a restart the saved list has image names but no pixels.
    usePromptStashStore.setState((state) => ({
      entries: state.entries.map((entry) => ({
        ...entry,
        attachments: entry.attachments.map((attachment) => ({ ...attachment, dataUrl: "" })),
      })),
    }));
    await hydrateStashImages();
    const restored = usePromptStashStore.getState().entries[0];
    expect(restored?.attachments.map((attachment) => attachment.dataUrl)).toEqual([
      image("one").dataUrl,
      image("two").dataUrl,
    ]);
  });

  it("frees the stored images when a draft is used", async () => {
    usePromptStashStore.getState().stashEntry(draft(id("a"), ["one"]));
    await flushStashImageWrites();
    usePromptStashStore.getState().takeEntry(id("a"));
    await settle();
    expect(backend.size()).toBe(0);
  });

  it("frees the stored images when a draft is removed or the stash is cleared", async () => {
    const store = usePromptStashStore.getState();
    store.stashEntry(draft(id("a"), ["one"]));
    store.stashEntry(draft(id("b"), ["two", "three"]));
    await flushStashImageWrites();
    store.remove(id("a"));
    await settle();
    expect(backend.size()).toBe(2);
    store.clear();
    await settle();
    expect(backend.size()).toBe(0);
  });

  it("marks an image that is no longer stored instead of showing an empty picture", async () => {
    usePromptStashStore.setState({
      entries: [{ ...draft(id("a"), ["one", "two"]), attachments: [image("one"), image("two")] }],
    });
    usePromptStashStore.setState((state) => ({
      entries: state.entries.map((entry) => ({
        ...entry,
        attachments: entry.attachments.map((attachment) => ({ ...attachment, dataUrl: "" })),
      })),
    }));
    await backend.put(stashImageKey(id("a"), "one"), image("one").dataUrl);
    await hydrateStashImages();
    const restored = usePromptStashStore.getState().entries[0];
    expect(restored?.attachments.map((attachment) => attachment.id)).toEqual(["one"]);
    expect(restored?.unreadableImageNames).toEqual(["two.png"]);
  });

  it("sweeps stored images that no draft owns", async () => {
    await backend.put("ghost/old", "data:image/png;base64,old");
    await hydrateStashImages();
    expect(backend.size()).toBe(0);
  });

  it("allows far more image data per draft when the image store exists", () => {
    expect(stashEntryImageBudgetChars()).toBeGreaterThan(MAX_STASH_ENTRY_ATTACHMENT_CHARS);
    setStashImageBackendForTest(null);
    expect(stashEntryImageBudgetChars()).toBe(MAX_STASH_ENTRY_ATTACHMENT_CHARS);
  });
});
