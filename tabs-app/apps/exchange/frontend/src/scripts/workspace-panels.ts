/** Local navigation only. Existing hidden attributes remain the access-control UI boundary. */
export function setupWorkspacePanels(root: HTMLElement) {
  const navigation = root.querySelector<HTMLElement>("[data-workspace-navigation]");
  if (!navigation) return () => {};
  const links = Array.from(
    navigation.querySelectorAll<HTMLAnchorElement>("[data-workspace-target]"),
  );
  const panels = Array.from(root.querySelectorAll<HTMLElement>("[data-workspace-panel]"));
  const controller = new AbortController();
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let animation: Animation | undefined;
  const available = (panel: HTMLElement) => !panel.hidden;
  function hashTarget(hash = location.hash) {
    let id: string;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return undefined;
    }
    return document.getElementById(id);
  }
  function fromHash() {
    const target = hashTarget();
    return target ? panels.find((panel) => panel === target || panel.contains(target)) : undefined;
  }
  function activate(panel: HTMLElement | undefined, focus = false) {
    const chosen =
      panel && available(panel)
        ? panel
        : links
            .map((link) =>
              panels.find((candidate) => candidate.id === link.dataset.workspaceTarget),
            )
            .find((candidate) => candidate && available(candidate));
    const changed = root.dataset.activePanel !== chosen?.id;
    const focusedPanel = panels.find((candidate) => candidate.contains(document.activeElement));
    const restorePanelFocus = changed && focusedPanel && focusedPanel !== chosen;
    root.dataset.activePanel = chosen?.id ?? "";
    for (const candidate of panels) candidate.dataset.panelActive = String(candidate === chosen);
    for (const link of links) {
      const candidate = panels.find((panel) => panel.id === link.dataset.workspaceTarget);
      const hidden = !candidate || !available(candidate);
      if (link.hidden !== hidden) link.hidden = hidden;
      if (candidate === chosen) {
        link.setAttribute("aria-current", "location");
        const group = link.closest("details");
        if (group && changed) group.open = true;
      } else link.removeAttribute("aria-current");
    }
    if ((focus || restorePanelFocus) && chosen) {
      const target = hashTarget();
      const heading = chosen.querySelector<HTMLElement>("h2");
      const destination = target && target !== chosen && chosen.contains(target) ? target : heading;
      if (destination) {
        destination.tabIndex = -1;
        destination.focus({ preventScroll: true });
        destination.scrollIntoView({ block: "start" });
      }
    }
    if (changed && focus && chosen && !preference.matches && typeof chosen.animate === "function") {
      animation?.cancel();
      animation = chosen.animate(
        [
          { opacity: 0.7, transform: "translateY(8px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 250, easing: "ease-out" },
      );
      // Navigation, reduced-motion changes and pagehide deliberately cancel this reveal.
      void animation.finished.catch(() => {});
    }
  }
  root.addEventListener(
    "click",
    (event) => {
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href^='#']")
          : null;
      if (
        !link ||
        (event instanceof MouseEvent &&
          (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey))
      )
        return;
      const target = hashTarget(link.hash);
      const panel = target && panels.find((panel) => panel === target || panel.contains(target));
      if (!panel || !available(panel)) return;
      event.preventDefault();
      if (location.hash !== link.hash) history.pushState(null, "", link.hash);
      activate(panel, true);
    },
    { signal: controller.signal },
  );
  const sync = () => activate(fromHash());
  window.addEventListener("hashchange", () => activate(fromHash(), true), {
    signal: controller.signal,
  });
  window.addEventListener("popstate", sync, { signal: controller.signal });
  const observer = new MutationObserver(sync);
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
  preference.addEventListener("change", () => animation?.cancel(), { signal: controller.signal });
  activate(fromHash());
  return () => {
    observer.disconnect();
    controller.abort();
    animation?.cancel();
  };
}
let disposers: Array<() => void> = [];
function mount() {
  disposers = Array.from(
    document.querySelectorAll<HTMLElement>("[data-workspace-panels]"),
    setupWorkspacePanels,
  );
}
mount();
window.addEventListener("pagehide", () => {
  disposers.forEach((dispose) => dispose());
  disposers = [];
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) mount();
});
