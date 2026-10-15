export {};
const menus = Array.from(document.querySelectorAll<HTMLDetailsElement>("[data-header-workspace]"));
const controller = new AbortController();
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Escape") return;
    for (const menu of menus) {
      if (!menu.open) continue;
      menu.open = false;
      menu.querySelector<HTMLElement>("summary")?.focus();
      event.preventDefault();
    }
  },
  { signal: controller.signal },
);
document.addEventListener(
  "click",
  (event) => {
    if (!(event.target instanceof Node)) return;
    for (const menu of menus) if (menu.open && !menu.contains(event.target)) menu.open = false;
  },
  { signal: controller.signal },
);
window.addEventListener("pagehide", () => {
  for (const menu of menus) menu.open = false;
});
