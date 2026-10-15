import "../styles/header-navigation.css";

const navigation = document.querySelector<HTMLElement>(".hs-header-navigation");
const toggle = document.querySelector<HTMLButtonElement>(".hs-menu-toggle");
const close = navigation?.querySelector<HTMLButtonElement>(".hs-menu-close");

if (navigation && toggle && close) {
  const compact = matchMedia("(max-width: 1024px)");
  const background = new Map<HTMLElement, boolean>();
  let open = false;

  function restoreBackground() {
    for (const [element, inert] of background) element.inert = inert;
    background.clear();
  }

  function render() {
    restoreBackground();
    const modal = compact.matches && open;
    toggle!.hidden = !compact.matches;
    toggle!.setAttribute("aria-expanded", String(modal));
    navigation!.hidden = compact.matches && !open;
    navigation!.classList.toggle("hs-menu-open", modal);
    document.body.classList.toggle("hs-menu-open", modal);
    if (modal) {
      navigation!.setAttribute("role", "dialog");
      navigation!.setAttribute("aria-modal", "true");
      let branch: HTMLElement = navigation!;
      while (branch.parentElement) {
        const parent = branch.parentElement;
        for (const sibling of parent.children) {
          if (
            !(sibling instanceof HTMLElement) ||
            sibling === branch ||
            ["SCRIPT", "STYLE", "LINK"].includes(sibling.tagName)
          )
            continue;
          background.set(sibling, sibling.inert);
          sibling.inert = true;
        }
        if (parent === document.body) break;
        branch = parent;
      }
    } else {
      navigation!.removeAttribute("role");
      navigation!.removeAttribute("aria-modal");
    }
  }

  function dismiss(returnFocus = true) {
    open = false;
    render();
    if (returnFocus && compact.matches) toggle!.focus();
  }

  render();
  document.documentElement.classList.add("tabs-navigation-ready");
  toggle.addEventListener("click", () => {
    open = true;
    render();
    close.focus();
  });
  close.addEventListener("click", () => dismiss());
  navigation.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    // Keep the Exchange source visible until its departure animation has covered it.
    if (link && !link.hasAttribute("data-exchange-departure")) dismiss(false);
  });
  navigation.addEventListener("keydown", (event) => {
    if (!compact.matches || !open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    } else if (event.key === "Tab") {
      const controls = [
        ...navigation.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)"),
      ].filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  compact.addEventListener("change", () => {
    const focusWasInside = navigation.contains(document.activeElement);
    dismiss(false);
    if (compact.matches && focusWasInside) toggle.focus();
    else if (
      !compact.matches &&
      (document.activeElement === toggle || document.activeElement === close)
    )
      navigation.querySelector<HTMLElement>("a[href]")?.focus();
  });
  window.addEventListener("pagehide", () => dismiss(false));
  window.addEventListener("pageshow", () => dismiss(false));
}
