/**
 * Switches the document the way the app does (see hooks/useTheme.ts): a `dark` class plus a
 * `data-theme` id. The light and dark token sets key off `data-theme`, so toggling only the
 * class does not change colours.
 */
export function applyTestColorScheme(scheme: "light" | "dark") {
  try {
    // The real app reads its theme from here at mount (hooks/useTheme.ts).
    // Browser tests share origin storage, so drop leftovers from other files first.
    localStorage.removeItem("tabs:client-settings:v1");
    localStorage.removeItem("tabs:custom-theme");
    localStorage.setItem("tabs:theme", scheme);
  } catch {
    // Storage is optional in tests.
  }
  const root = document.documentElement;
  // useTheme writes every token inline on <html>; inline values beat the stylesheet's
  // [data-theme] blocks, so a previous test's theme would otherwise stick. Clear them all.
  root.removeAttribute("style");
  document.body.removeAttribute("style");
  root.classList.remove("no-transitions");
  root.classList.toggle("dark", scheme === "dark");
  root.setAttribute("data-theme", scheme === "dark" ? "tabs-dark" : "tabs-light");
}

export function resetTestColorScheme() {
  applyTestColorScheme("dark");
  try {
    localStorage.removeItem("tabs:theme");
  } catch {
    // Storage is optional in tests.
  }
}
