import { useEffect, useSyncExternalStore } from "react";
import type { DesktopInstalledExtension } from "@tabs/contracts";

let installed: readonly DesktopInstalledExtension[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function publish(next: readonly DesktopInstalledExtension[]): void {
  installed = next;
  loaded = true;
  for (const listener of listeners) listener();
}

export async function refreshExtensions(): Promise<void> {
  const bridge = window.desktopBridge;
  if (!bridge) {
    publish([]);
    return;
  }
  publish(await bridge.listExtensions());
}

export function useInstalledExtensions(): readonly DesktopInstalledExtension[] {
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => installed,
    () => installed,
  );
  useEffect(() => {
    if (!loaded) void refreshExtensions().catch(() => undefined);
  }, []);
  return snapshot;
}
