import { inlineArrow } from "../lib/inlineArrow";
function decorate(root: ParentNode) {
  for (const element of root.querySelectorAll<HTMLElement>("a,button")) {
    if (
      element.id === "account-link" ||
      element.classList.contains("account-nav-link") ||
      element.classList.contains("catalog-card-link")
    )
      continue;
    for (const node of Array.from(element.childNodes)) {
      const direct = node.nodeType === Node.TEXT_NODE;
      const decorative =
        node instanceof HTMLElement &&
        node.getAttribute("aria-hidden") === "true" &&
        node.tagName === "SPAN";
      if (!direct && !decorative) continue;
      const text = node.textContent ?? "";
      const match = direct ? /\s*([↗→])\s*$/.exec(text) : /^\s*([↗→])\s*$/.exec(text);
      if (!match) continue;
      const svg = inlineArrow(match[1] as "↗" | "→");
      if (direct) {
        node.textContent = text.slice(0, match.index);
        node.after(svg);
      } else node.replaceWith(svg);
    }
  }
}
decorate(document);
const observer = new MutationObserver((records) => {
  for (const record of records)
    for (const node of record.addedNodes) {
      if (node instanceof HTMLElement) decorate(node.parentElement ?? node);
    }
});
const observe = () => observer.observe(document.body, { childList: true, subtree: true });
observe();
window.addEventListener("pagehide", () => observer.disconnect());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    decorate(document);
    observe();
  }
});
