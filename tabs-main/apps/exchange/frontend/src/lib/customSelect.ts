export function enhanceSelect(source: HTMLSelectElement) {
  if (source.multiple || source.size > 1) return () => {};
  const lifetime = new AbortController();
  const wrapper = document.createElement("div");
  wrapper.className = "custom-select";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "custom-select-trigger";
  trigger.id = `${source.id}-trigger`;
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  const menu = document.createElement("ul");
  menu.className = "custom-select-menu";
  menu.id = `${source.id}-options`;
  menu.setAttribute("role", "listbox");
  trigger.setAttribute("aria-controls", menu.id);
  const labels = [...(source.labels ?? [])];
  const labelText =
    labels
      .map((label) => {
        const clone = label.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("select").forEach((select) => select.remove());
        return clone.textContent?.trim() ?? "";
      })
      .join(" ") ||
    source.getAttribute("aria-label") ||
    "Select an option";
  menu.setAttribute("aria-label", labelText);
  const description = source.getAttribute("aria-describedby");
  const error = document.createElement("p");
  error.id = `${source.id}-validation`;
  error.hidden = true;
  error.setAttribute("role", "alert");
  trigger.setAttribute("aria-describedby", [description, error.id].filter(Boolean).join(" "));
  const previousHidden = source.hidden;
  source.before(wrapper);
  wrapper.append(trigger, menu, error);
  source.hidden = true;
  let active = source.selectedIndex;
  let prefix = "";
  let lastTyped = 0;
  function close() {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
  }
  function disabled(index: number) {
    const option = source.options[index];
    return (
      !option ||
      option.disabled ||
      (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled)
    );
  }
  function highlight(index: number) {
    active = index;
    for (const item of menu.children)
      item.toggleAttribute("data-active", item.id === `${menu.id}-${active}`);
    const item = menu.children[active] as HTMLElement | undefined;
    if (item && !menu.hidden) {
      trigger.setAttribute("aria-activedescendant", item.id);
      item.scrollIntoView({ block: "nearest" });
    }
  }
  function sync() {
    const selected = source.options[source.selectedIndex]?.textContent ?? "Select an option";
    trigger.textContent = selected;
    trigger.setAttribute("aria-label", `${labelText}: ${selected}`);
    trigger.disabled = source.matches(":disabled");
    trigger.setAttribute("aria-required", String(source.required));
    menu.replaceChildren();
    [...source.options].forEach((option, index) => {
      const item = document.createElement("li");
      item.id = `${menu.id}-${index}`;
      item.dataset.index = String(index);
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === source.selectedIndex));
      item.setAttribute("aria-disabled", String(disabled(index)));
      const group =
        option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : "";
      item.textContent = `${group ? `${group} · ` : ""}${option.textContent}`;
      menu.append(item);
    });
    if (trigger.disabled) close();
    highlight(source.selectedIndex);
  }
  function open() {
    if (trigger.disabled) return;
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    highlight(source.selectedIndex);
  }
  function choose(index: number) {
    if (disabled(index) || source.matches(":disabled")) return;
    source.selectedIndex = index;
    trigger.removeAttribute("aria-invalid");
    error.hidden = true;
    sync();
    close();
    source.dispatchEvent(new Event("input", { bubbles: true }));
    source.dispatchEvent(new Event("change", { bubbles: true }));
    trigger.focus();
  }
  const options = { signal: lifetime.signal };
  for (const label of labels)
    label.addEventListener(
      "click",
      (event) => {
        if (wrapper.contains(event.target as Node)) return;
        event.preventDefault();
        trigger.focus();
      },
      options,
    );
  trigger.addEventListener("click", () => (menu.hidden ? open() : close()), options);
  trigger.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Tab") {
        close();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (menu.hidden) open();
        else choose(active);
        return;
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (menu.hidden) open();
        const step = event.key === "ArrowUp" || event.key === "End" ? -1 : 1;
        let next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? source.options.length - 1
              : active + step;
        while (next >= 0 && next < source.options.length && disabled(next)) next += step;
        if (next >= 0 && next < source.options.length) highlight(next);
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const now = Date.now();
        prefix = (now - lastTyped > 700 ? "" : prefix) + event.key.toLowerCase();
        lastTyped = now;
        const index = [...source.options].findIndex(
          (option, index) => !disabled(index) && option.text.toLowerCase().startsWith(prefix),
        );
        if (index >= 0) {
          if (menu.hidden) open();
          highlight(index);
        }
      }
    },
    options,
  );
  menu.addEventListener(
    "click",
    (event) => {
      const item = (event.target as Element).closest<HTMLElement>("[data-index]");
      if (item) choose(Number(item.dataset.index));
    },
    options,
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!wrapper.contains(event.target as Node)) close();
    },
    options,
  );
  trigger.addEventListener("blur", close, options);
  menu.addEventListener("pointerdown", (event) => event.preventDefault(), options);
  source.addEventListener("change", sync, options);
  source.addEventListener("tabs-select-sync", sync, options);
  source.addEventListener(
    "invalid",
    (event) => {
      event.preventDefault();
      trigger.setAttribute("aria-invalid", "true");
      error.textContent = source.validationMessage || "Choose an option before continuing.";
      error.hidden = false;
      trigger.focus();
    },
    options,
  );
  source.form?.addEventListener("reset", () => queueMicrotask(sync), options);
  const observer = new MutationObserver(sync);
  observer.observe(source, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  for (const fieldset of source.closest("form")?.querySelectorAll("fieldset") ?? [])
    observer.observe(fieldset, { attributes: true, attributeFilter: ["disabled"] });
  close();
  sync();
  return () => {
    lifetime.abort();
    observer.disconnect();
    source.hidden = previousHidden;
    wrapper.remove();
  };
}
