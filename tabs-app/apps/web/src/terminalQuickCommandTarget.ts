import { useSyncExternalStore } from "react";

/** A terminal that quick commands can be typed into. */
export interface TerminalQuickCommandTarget {
  readonly threadId: string;
  readonly terminalId: string;
  readonly environmentId: string | null;
}

interface Entry extends TerminalQuickCommandTarget {
  readonly key: string;
}

/**
 * Mounted terminal drawers, most recently focused last. The last one is where
 * "run in the active terminal" goes, wherever the command was chosen from.
 */
let entries: readonly Entry[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function registerTerminalQuickCommandTarget(
  key: string,
  target: TerminalQuickCommandTarget,
): () => void {
  const next: Entry = { key, ...target };
  entries = [...entries.filter((entry) => entry.key !== key), next];
  emit();
  return () => {
    entries = entries.filter((entry) => entry.key !== key);
    emit();
  };
}

/** Called when the user focuses a terminal, so it becomes the active one. */
export function touchTerminalQuickCommandTarget(key: string): void {
  const index = entries.findIndex((entry) => entry.key === key);
  if (index === -1 || index === entries.length - 1) return;
  entries = [...entries.filter((entry) => entry.key !== key), entries[index]!];
  emit();
}

export function activeTerminalQuickCommandTarget(): TerminalQuickCommandTarget | null {
  return entries[entries.length - 1] ?? null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHasTerminalQuickCommandTarget(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => entries.length > 0,
    () => false,
  );
}
