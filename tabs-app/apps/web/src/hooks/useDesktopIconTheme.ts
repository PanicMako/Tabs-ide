import { useEffect, useSyncExternalStore } from "react";
import { resolveTabsLogoVariant } from "@tabs/shared/tabsBrand";
import { useSettings } from "./useSettings";

const subscribeAppearance = (notify: () => void) => {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const readAppearance = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
const serverAppearance = () => false;

export function useResolvedBrandVariant() {
  const preference = useSettings().desktopIconTheme;
  const dark = useSyncExternalStore(subscribeAppearance, readAppearance, serverAppearance);
  return resolveTabsLogoVariant(preference, dark);
}

export function useDesktopIconThemeSync(): void {
  const desktopIconTheme = useSettings().desktopIconTheme;
  const variant = useResolvedBrandVariant();
  useEffect(() => {
    void window.desktopBridge?.setIconTheme(desktopIconTheme).catch(() => undefined);
  }, [desktopIconTheme]);
  useEffect(() => {
    const icons = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
    if (icons.length === 0) {
      const icon = document.createElement("link");
      icon.rel = "icon";
      document.head.append(icon);
    }
    for (const icon of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')) {
      icon.type = "image/svg+xml";
      icon.href = `/brand/${variant}-icon.svg`;
    }
  }, [variant]);
}
