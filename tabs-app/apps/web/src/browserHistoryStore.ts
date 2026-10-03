import { create } from "zustand";

export const BROWSER_HISTORY_STORAGE_KEY = "tabs:browser-history:v1";
export const MAX_BROWSER_HISTORY_ENTRIES = 100;

export interface BrowserHistoryEntry {
  readonly url: string;
  readonly title: string;
  readonly visitedAt: string;
}

interface BrowserHistoryState {
  readonly entries: ReadonlyArray<BrowserHistoryEntry>;
  record: (entry: BrowserHistoryEntry) => void;
  clear: () => void;
}

function readEntries(): BrowserHistoryEntry[] {
  try {
    const raw = localStorage.getItem(BROWSER_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is BrowserHistoryEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as BrowserHistoryEntry).url === "string" &&
        typeof (entry as BrowserHistoryEntry).title === "string" &&
        typeof (entry as BrowserHistoryEntry).visitedAt === "string",
    );
  } catch {
    return [];
  }
}

function persist(entries: ReadonlyArray<BrowserHistoryEntry>): void {
  try {
    localStorage.setItem(BROWSER_HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // History remains available for this session when storage is unavailable.
  }
}

export const useBrowserHistoryStore = create<BrowserHistoryState>()((set, get) => ({
  entries: readEntries(),
  record: (entry) => {
    if (!/^https?:/i.test(entry.url)) return;
    const previous = get().entries[0];
    if (previous?.url === entry.url && previous.title === entry.title) return;
    const next = [entry, ...get().entries.filter((candidate) => candidate.url !== entry.url)].slice(
      0,
      MAX_BROWSER_HISTORY_ENTRIES,
    );
    persist(next);
    set({ entries: next });
  },
  clear: () => {
    persist([]);
    set({ entries: [] });
  },
}));
