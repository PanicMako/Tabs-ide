import { useCallback, useSyncExternalStore } from "react";
import {
  readWindowControlsInsets,
  type WindowControlsInsets,
  subscribeWindowControlsGeometry,
  type WindowControlsOverlay,
} from "../lib/windowControlsOverlay";

export function useWindowControlsInset(
  enabled: boolean,
  fallback: WindowControlsInsets,
): WindowControlsInsets {
  const overlay =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlay })
          .windowControlsOverlay;
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!enabled || typeof window === "undefined") return () => {};
      return subscribeWindowControlsGeometry(overlay, window, onChange);
    },
    [enabled, overlay],
  );
  const getSnapshot = useCallback(() => {
    if (!enabled || typeof window === "undefined") return "0:0";
    const insets = readWindowControlsInsets(window.innerWidth, overlay, fallback);
    return `${insets.left}:${insets.right}`;
  }, [enabled, overlay, fallback.left, fallback.right]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => "0:0");
  const [left = 0, right = 0] = snapshot.split(":").map(Number);
  return { left, right };
}
