import type { UserTheme } from "@tabs/contracts";
import { compileUserThemeCss } from "@tabs/shared/themeCss";

// The user's own restyle (palette overrides and agent-written CSS). It is compiled by the
// shared sanitizer, which refuses anything that loads files, and applied in the
// `user-theme` cascade layer so wallpaper reading plates and print styles still win.

let themeSheet: CSSStyleSheet | null = null;
let fallbackStyle: HTMLStyleElement | null = null;
let appliedCss = "";

export function applyUserTheme(theme: UserTheme | undefined): void {
  if (typeof document === "undefined") return;
  const next = theme ? compileUserThemeCss(theme) : "";
  if (next === appliedCss) return;
  appliedCss = next;
  if (typeof CSSStyleSheet !== "undefined" && "adoptedStyleSheets" in document) {
    if (!themeSheet) {
      // Adopted sheets order after the document's own, and they cannot hold @import.
      themeSheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, themeSheet];
    }
    themeSheet.replaceSync(next);
    return;
  }
  if (!fallbackStyle) {
    fallbackStyle = document.createElement("style");
    fallbackStyle.dataset.userTheme = "true";
    document.head.append(fallbackStyle);
  }
  fallbackStyle.textContent = next;
}
