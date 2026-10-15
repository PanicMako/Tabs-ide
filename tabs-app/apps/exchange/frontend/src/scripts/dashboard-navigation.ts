export {};
const navigation = document.getElementById("dashboard-sidebar");
const toggle = document.getElementById("dashboard-menu-toggle") as HTMLButtonElement | null;
const closeButton = document.getElementById("dashboard-menu-close");
if (navigation && toggle && closeButton) {
  const compact = window.matchMedia("(max-width: 1024px)");
  let open = false;
  const render = () => {
    toggle.hidden = !compact.matches;
    toggle.setAttribute("aria-expanded", String(open));
    navigation.hidden = compact.matches && !open;
    navigation.classList.toggle("dashboard-menu-open", compact.matches && open);
    if (compact.matches && open) {
      navigation.setAttribute("role", "dialog");
      navigation.setAttribute("aria-modal", "true");
    } else {
      navigation.removeAttribute("role");
      navigation.removeAttribute("aria-modal");
    }
    document.body.classList.toggle("dashboard-menu-open", compact.matches && open);
    for (const background of document.querySelectorAll<HTMLElement>(
      document.body.dataset.dashboard === "true"
        ? ".dashboard-content, body > header, body > footer"
        : "body > main, body > footer, .site-header > .brand, .site-header > .header-workspace-menu, #dashboard-menu-toggle",
    ))
      background.inert = compact.matches && open;
  };
  const dismiss = () => {
    open = false;
    render();
    toggle.focus();
  };
  render();
  toggle.addEventListener("click", () => {
    open = true;
    render();
    closeButton.focus();
  });
  closeButton.addEventListener("click", dismiss);
  navigation.addEventListener("click", (event) => {
    if (compact.matches && event.target instanceof Element && event.target.closest("a")) dismiss();
  });
  navigation.addEventListener("keydown", (event) => {
    if (!compact.matches || !open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(navigation.querySelectorAll<HTMLElement>("a[href],button")).filter(
      (element) => !element.hidden && element.getClientRects().length > 0,
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  compact.addEventListener("change", () => {
    open = false;
    render();
  });
  window.addEventListener("pagehide", () => {
    open = false;
    render();
  });
}
