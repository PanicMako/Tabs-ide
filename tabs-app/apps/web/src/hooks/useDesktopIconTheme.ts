import { useEffect } from "react";
import { useSettings } from "./useSettings";

export function useDesktopIconThemeSync(): void {
  const desktopIconTheme = useSettings().desktopIconTheme;

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) {
      return;
    }

    void bridge.setIconTheme(desktopIconTheme).catch(() => undefined);
  }, [desktopIconTheme]);
}
