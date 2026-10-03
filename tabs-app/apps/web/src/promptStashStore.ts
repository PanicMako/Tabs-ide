import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import { assistantCitationsToPlainText } from "@tabs/shared/assistantCitations";
import type { PersistedComposerImageAttachment } from "./composerDraftStore";
import { createMemoryStorage } from "./lib/storage";
import { create } from "zustand";

export const PROMPT_STASH_STORAGE_KEY = "tabs:prompt-stash:v1";
export const MAX_PROMPT_STASH_ENTRIES = 20;
export const MAX_STASH_ENTRY_ATTACHMENT_CHARS = 2_700_000;

export interface StashedFileReference {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
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

function persist(entries: ReadonlyArray<PromptStashEntry>): {
  written: boolean;
  durable: boolean;
} {
  try {
    promptStashStorage.setItem(PROMPT_STASH_STORAGE_KEY, JSON.stringify(entries));
    return { written: true, durable: storageIsDurable };
  } catch (error) {
    console.error("[PROMPT-STASH] Could not persist stash.", error);
    return { written: false, durable: false };
  }
}

export function partitionStashAttachments(
  attachments: ReadonlyArray<PersistedComposerImageAttachment>,
): {
  kept: PersistedComposerImageAttachment[];
  droppedNames: string[];
} {
  const kept: PersistedComposerImageAttachment[] = [];
  const droppedNames: string[] = [];
  let usedChars = 0;
  for (const attachment of attachments) {
    if (usedChars + attachment.dataUrl.length > MAX_STASH_ENTRY_ATTACHMENT_CHARS) {
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
    return { entry, durable };
  },
  take: (id) => {
    return get().takeEntry(id).entry;
  },
  remove: (id) => {
    const next = get().entries.filter((candidate) => candidate.id !== id);
    persist(next);
    set({ entries: next });
  },
  clear: (environmentId) => {
    const next = environmentId
      ? get().entries.filter(
          (entry) => entry.environmentId && entry.environmentId !== environmentId,
        )
      : [];
    persist(next);
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

export function writePromptStashStorageForTest(raw: string): void {
  promptStashStorage.setItem(PROMPT_STASH_STORAGE_KEY, raw);
  usePromptStashStore.setState({ entries: readEntries() });
}
