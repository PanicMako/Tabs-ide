import { useEffect, useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "@tabs/client-runtime/state";
import { appAtomRegistry } from "./atomRegistry";

export interface DraftSourceEntry {
  readonly sourceId: string;
  readonly isDirty: boolean;
  readonly label?: string | undefined;
}

export const settingsDraftRegistryAtom = Atom.make<Record<string, DraftSourceEntry>>({}).pipe(
  Atom.withLabel("tabs-settings-draft-registry"),
  Atom.keepAlive,
);

export function registerDraftSource(entry: DraftSourceEntry): void {
  appAtomRegistry.update(settingsDraftRegistryAtom, (prev) => {
    const existing = prev[entry.sourceId];
    if (existing && existing.isDirty === entry.isDirty && existing.label === entry.label) {
      return prev;
    }
    return {
      ...prev,
      [entry.sourceId]: entry,
    };
  });
}

export function unregisterDraftSource(sourceId: string): void {
  appAtomRegistry.update(settingsDraftRegistryAtom, (prev) => {
    if (!prev[sourceId]) return prev;
    const next = { ...prev };
    delete next[sourceId];
    return next;
  });
}

export function clearAllDraftSources(): void {
  appAtomRegistry.set(settingsDraftRegistryAtom, {});
}

export function useSettingsDraftSource(sourceId: string, isDirty: boolean, label?: string): void {
  useEffect(() => {
    registerDraftSource({ sourceId, isDirty, label });
    return () => {
      unregisterDraftSource(sourceId);
    };
  }, [sourceId, isDirty, label]);
}

export function useIsAnyDraftDirty(): boolean {
  const registry = useAtomValue(settingsDraftRegistryAtom);
  return useMemo(() => Object.values(registry).some((entry) => entry.isDirty), [registry]);
}

export function useDirtyDraftSources(): DraftSourceEntry[] {
  const registry = useAtomValue(settingsDraftRegistryAtom);
  return useMemo(() => Object.values(registry).filter((entry) => entry.isDirty), [registry]);
}
