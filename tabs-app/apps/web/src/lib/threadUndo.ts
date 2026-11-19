export const THREAD_UNDO_WINDOW_MS = 5000;

export interface ThreadUndoEntry {
  readonly label: string;
  readonly undo: () => Promise<void>;
}

let pending: { entry: ThreadUndoEntry; expiresAt: number } | null = null;

/** Remembers the latest sidebar action that can be undone. A newer action replaces it. */
export function registerThreadUndo(entry: ThreadUndoEntry, now: number = Date.now()): void {
  pending = { entry, expiresAt: now + THREAD_UNDO_WINDOW_MS };
}

/** The action to undo, once: null when there is none or its five seconds are up. */
export function takeThreadUndo(now: number = Date.now()): ThreadUndoEntry | null {
  const current = pending;
  pending = null;
  return current && current.expiresAt > now ? current.entry : null;
}

export function clearThreadUndo(): void {
  pending = null;
}

export function hasThreadUndo(now: number = Date.now()): boolean {
  return pending !== null && pending.expiresAt > now;
}

const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift", "OS", "AltGraph"]);

/**
 * Any real key press after the action hands undo back to the text field you are typing in, so
 * only a modifier on its own keeps the undo available.
 */
export function keyEndsThreadUndo(key: string): boolean {
  return !MODIFIER_KEYS.has(key);
}
