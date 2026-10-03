import { useState, useEffect } from "react";

/**
 * Subscribes to the desktop bridge's `onAppClosing` IPC signal.
 * Returns `true` once the Electron main process has initiated a quit.
 * On web (no desktop bridge), always returns `false`.
 */
export function useAppClosing(): { isClosing: boolean; cleanupDone: boolean } {
  const [isClosing, setIsClosing] = useState(false);
  const [cleanupDone, setCleanupDone] = useState(false);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.onAppClosing) return;
    const unsubClosing = bridge.onAppClosing(() => setIsClosing(true));
    const unsubCleanup = bridge.onAppCleanupDone
      ? bridge.onAppCleanupDone(() => setCleanupDone(true))
      : () => {};

    return () => {
      unsubClosing();
      unsubCleanup();
    };
  }, []);

  return { isClosing, cleanupDone };
}
