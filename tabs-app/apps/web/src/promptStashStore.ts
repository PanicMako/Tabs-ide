import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import { assistantCitationsToPlainText } from "@tabs/shared/assistantCitations";
import type { PersistedComposerImageAttachment } from "./composerDraftStore";
import { createMemoryStorage } from "./lib/storage";
import { create } from "zustand";
import { stashImageBackend, stashImageKey } from "./promptStashImageStore";

export const PROMPT_STASH_STORAGE_KEY = "tabs:prompt-stash:v1";
export const MAX_PROMPT_STASH_ENTRIES = 20;
export const MAX_STASH_ENTRY_ATTACHMENT_CHARS = 2_700_000;
/** Images live in IndexedDB when it exists, which has room for far more than localStorage. */
export const MAX_STASH_ENTRY_STORED_IMAGE_CHARS = 24_000_000;

/** How much image data one saved draft may hold in this browser. */
export function stashEntryImageBudgetChars(): number {
  return stashImageBackend()
    ? MAX_STASH_ENTRY_STORED_IMAGE_CHARS
    : MAX_STASH_ENTRY_ATTACHMENT_CHARS;
}

export interface StashedFileReference {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly dataUrl?: string;
  readonly attachmentId?: string;
  readonly environmentId?: EnvironmentId;
}

export interface PromptStashEntry {
  readonly id: string;
  readonly createdAt: string;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<PersistedComposerImageAttachment>;
  readonly files?: ReadonlyArray<StashedFileReference>;
  readonly environmentId?: EnvironmentId;
  readonly threadId?: ThreadId;
  readonly droppedImageNames?: ReadonlyArray<string>;
  readonly unreadableImageNames?: ReadonlyArray<string>;
  readonly pendingImageCount?: number;
}

interface PromptStashState {
  readonly entries: ReadonlyArray<PromptStashEntry>;
  stash: (entry: PromptStashEntry) => PromptStashEntry | null;
  stashEntry: (entry: PromptStashEntry) => {
    evicted: PromptStashEntry | null;
    written: boolean;
    durable: boolean;
  };
  take: (id: string) => PromptStashEntry | null;
  takeEntry: (id: string) => { entry: PromptStashEntry | null; durable: boolean };
  remove: (id: string) => void;
  clear: (environmentId?: EnvironmentId) => void;
  finalizeEntryImages: (
    entryId: string,
    images: {
      attachments: ReadonlyArray<PersistedComposerImageAttachment>;
      droppedImageNames: ReadonlyArray<string>;
      unreadableImageNames: ReadonlyArray<string>;
    },
  ) => { attached: boolean; durable: boolean };
}

interface SyncStorage {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
}

function resolveStorage(): { storage: SyncStorage; durable: boolean } {
  try {
    if (typeof localStorage !== "undefined") {
      return { storage: localStorage, durable: true };
    }
  } catch {
    // Sandboxed or policy-disabled renderers retain an in-memory stash.
  }
  return { storage: createMemoryStorage() as SyncStorage, durable: false };
}

const { storage: promptStashStorage, durable: storageIsDurable } = resolveStorage();

function clearOrphanedPendingImages(
  entries: ReadonlyArray<PromptStashEntry>,
): ReadonlyArray<PromptStashEntry> {
  return entries.map((entry) => {
    if (!entry.pendingImageCount) return entry;
    const lostCount = entry.pendingImageCount;
    return {
      ...entry,
      pendingImageCount: 0,
      unreadableImageNames: [
        ...(entry.unreadableImageNames ?? []),
        ...Array.from(
          { length: lostCount },
          (_, index) => `image ${index + 1} (not saved before reload)`,
        ),
      ],
    };
  });
}

function readEntries(): PromptStashEntry[] {
  try {
    const raw = promptStashStorage.getItem(PROMPT_STASH_STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const valid = value.filter(
      (entry): entry is PromptStashEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as PromptStashEntry).id === "string" &&
        typeof (entry as PromptStashEntry).createdAt === "string" &&
        typeof (entry as PromptStashEntry).prompt === "string" &&
        Array.isArray((entry as PromptStashEntry).attachments),
    );
    return [...clearOrphanedPendingImages(valid)];
  } catch {
    return [];
  }
}

/** Image keys whose pixels are confirmed in the image store, so localStorage can drop them. */
const storedImageKeys = new Set<string>();
const pendingImageWrites = new Set<Promise<void>>();

function entryImageKeys(entry: PromptStashEntry): string[] {
  return entry.attachments.map((attachment) => stashImageKey(entry.id, attachment.id));
}

/** Frees the pixels of drafts that were used, removed, replaced or cleared. */
function releaseStoredImages(keys: ReadonlyArray<string>): void {
  const backend = stashImageBackend();
  for (const key of keys) storedImageKeys.delete(key);
  if (!backend || keys.length === 0) return;
  void backend.deleteMany(keys).catch((error: unknown) => {
    console.error("[PROMPT-STASH] Could not free stashed images.", error);
  });
}

/** Copies new images to the image store, then rewrites the draft list without their pixels. */
function storeImagesInBackground(entries: ReadonlyArray<PromptStashEntry>): void {
  const backend = stashImageBackend();
  if (!backend) return;
  const fresh = entries.flatMap((entry) =>
    entry.attachments
      .filter(
        (attachment) =>
          attachment.dataUrl && !storedImageKeys.has(stashImageKey(entry.id, attachment.id)),
      )
      .map((attachment) => ({
        key: stashImageKey(entry.id, attachment.id),
        dataUrl: attachment.dataUrl,
      })),
  );
  if (fresh.length === 0) return;
  const write: Promise<void> = Promise.all(fresh.map((item) => backend.put(item.key, item.dataUrl)))
    .then(() => {
      for (const item of fresh) storedImageKeys.add(item.key);
      // Rewrite the list so localStorage stops carrying the same pixels.
      persist(usePromptStashStore.getState().entries);
    })
    .catch((error: unknown) => {
      console.error("[PROMPT-STASH] Could not save images; keeping them in the draft list.", error);
    })
    .finally(() => void pendingImageWrites.delete(write));
  pendingImageWrites.add(write);
}

/** Resolves once every image handed to the image store has been written. */
export async function flushStashImageWrites(): Promise<void> {
  while (pendingImageWrites.size > 0) await Promise.all([...pendingImageWrites]);
}

function withoutStoredPixels(entry: PromptStashEntry): PromptStashEntry {
  if (!entry.attachments.some((a) => storedImageKeys.has(stashImageKey(entry.id, a.id))))
    return entry;
  return {
    ...entry,
    attachments: entry.attachments.map((attachment) =>
      storedImageKeys.has(stashImageKey(entry.id, attachment.id))
        ? { ...attachment, dataUrl: "" }
        : attachment,
    ),
  };
}

function persist(entries: ReadonlyArray<PromptStashEntry>): {
  written: boolean;
  durable: boolean;
} {
  try {
    promptStashStorage.setItem(
      PROMPT_STASH_STORAGE_KEY,
      JSON.stringify(entries.map(withoutStoredPixels)),
    );
    return { written: true, durable: storageIsDurable };
  } catch (error) {
    console.error("[PROMPT-STASH] Could not persist stash.", error);
    return { written: false, durable: false };
  }
}

export function partitionStashAttachments(
  attachments: ReadonlyArray<PersistedComposerImageAttachment>,
  maxChars: number = MAX_STASH_ENTRY_ATTACHMENT_CHARS,
): {
  kept: PersistedComposerImageAttachment[];
  droppedNames: string[];
} {
  const kept: PersistedComposerImageAttachment[] = [];
  const droppedNames: string[] = [];
  let usedChars = 0;
  for (const attachment of attachments) {
    if (usedChars + attachment.dataUrl.length > maxChars) {
      droppedNames.push(attachment.name);
      continue;
    }
    usedChars += attachment.dataUrl.length;
    kept.push(attachment);
  }
  return { kept, droppedNames };
}

export const usePromptStashStore = create<PromptStashState>()((set, get) => ({
  entries: readEntries(),
  stashEntry: (entry) => {
    const next = [entry, ...get().entries];
    const evicted = next.length > MAX_PROMPT_STASH_ENTRIES ? (next.pop() ?? null) : null;
    const { written, durable } = persist(next);
    if (!written) {
      return { evicted: null, written: false, durable: false };
    }
    set({ entries: next });
    if (evicted) releaseStoredImages(entryImageKeys(evicted));
    storeImagesInBackground(next);
    return { evicted, written: true, durable };
  },
  stash: (entry) => {
    const result = get().stashEntry(entry);
    return result.evicted;
  },
  takeEntry: (id) => {
    const entry = get().entries.find((candidate) => candidate.id === id) ?? null;
    if (!entry) return { entry: null, durable: true };
    const next = get().entries.filter((candidate) => candidate.id !== id);
    const { durable } = persist(next);
    set({ entries: next });
    // The draft is leaving Stash, so its stored pixels go with it.
    releaseStoredImages(entryImageKeys(entry));
    return { entry, durable };
  },
  take: (id) => {
    return get().takeEntry(id).entry;
  },
  remove: (id) => {
    const removed = get().entries.find((candidate) => candidate.id === id);
    const next = get().entries.filter((candidate) => candidate.id !== id);
    persist(next);
    set({ entries: next });
    if (removed) releaseStoredImages(entryImageKeys(removed));
  },
  clear: (environmentId) => {
    const next = environmentId
      ? get().entries.filter(
          (entry) => entry.environmentId && entry.environmentId !== environmentId,
        )
      : [];
    persist(next);
    const kept = new Set(next.map((entry) => entry.id));
    releaseStoredImages(
      get()
        .entries.filter((entry) => !kept.has(entry.id))
        .flatMap(entryImageKeys),
    );
    set({ entries: next });
  },
  finalizeEntryImages: (entryId, images) => {
    const entries = get().entries;
    const index = entries.findIndex((candidate) => candidate.id === entryId);
    const existing = index === -1 ? undefined : entries[index];
    if (!existing) return { attached: false, durable: true };
    const nextEntries = [...entries];
    nextEntries[index] = {
      ...existing,
      attachments: images.attachments,
      droppedImageNames: images.droppedImageNames,
      unreadableImageNames: images.unreadableImageNames,
      pendingImageCount: 0,
    };
    const { durable } = persist(nextEntries);
    set({ entries: nextEntries });
    storeImagesInBackground(nextEntries);
    return { attached: true, durable };
  },
}));

export function promptStashSnippet(entry: PromptStashEntry): string {
  const normalized = assistantCitationsToPlainText(entry.prompt).trim().replace(/\s+/g, " ");
  if (normalized.length > 0) {
    return normalized.length > 72 ? `${normalized.slice(0, 69)}…` : normalized;
  }
  const imageCount = entry.attachments.length + (entry.droppedImageNames?.length ?? 0);
  const fileCount = entry.files?.length ?? 0;
  const total = imageCount + fileCount;
  if (total === 0) return "(empty)";
  const label = imageCount > 0 && fileCount > 0 ? "attachment" : fileCount > 0 ? "file" : "image";
  return `(${total} ${label}${total === 1 ? "" : "s"})`;
}

/**
 * After a restart the saved list holds image names but no pixels. This reads them back from the
 * image store, marks any that are gone as unreadable, and removes stored images no draft owns.
 */
export async function hydrateStashImages(): Promise<void> {
  const backend = stashImageBackend();
  if (!backend) return;
  try {
    const entries = usePromptStashStore.getState().entries;
    const missing = entries.flatMap((entry) =>
      entry.attachments
        .filter((attachment) => !attachment.dataUrl)
        .map((attachment) => stashImageKey(entry.id, attachment.id)),
    );
    const found = missing.length > 0 ? await backend.getMany(missing) : new Map<string, string>();
    for (const key of found.keys()) storedImageKeys.add(key);
    usePromptStashStore.setState((state) => ({
      entries: state.entries.map((entry) => {
        const lost: string[] = [];
        const attachments = entry.attachments.flatMap((attachment) => {
          if (attachment.dataUrl) return [attachment];
          const dataUrl = found.get(stashImageKey(entry.id, attachment.id));
          if (dataUrl) return [{ ...attachment, dataUrl }];
          lost.push(attachment.name);
          return [];
        });
        if (attachments.length === entry.attachments.length && lost.length === 0) {
          return attachments.every((a, i) => a === entry.attachments[i])
            ? entry
            : { ...entry, attachments };
        }
        return {
          ...entry,
          attachments,
          unreadableImageNames: [...(entry.unreadableImageNames ?? []), ...lost],
        };
      }),
    }));
    const owned = new Set(usePromptStashStore.getState().entries.flatMap(entryImageKeys));
    const orphaned = (await backend.keys()).filter((key) => !owned.has(key));
    if (orphaned.length > 0) await backend.deleteMany(orphaned);
  } catch (error) {
    console.error("[PROMPT-STASH] Could not restore stashed images.", error);
  }
}

if (typeof window !== "undefined") void hydrateStashImages();

export function writePromptStashStorageForTest(raw: string): void {
  promptStashStorage.setItem(PROMPT_STASH_STORAGE_KEY, raw);
  usePromptStashStore.setState({ entries: readEntries() });
}
