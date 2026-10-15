// Keep the reading surface within reach on phones; the native disclosure remains operable.
const docsNavigation = document.querySelector<HTMLDetailsElement>(".docs-nav");
if (docsNavigation && matchMedia("(max-width: 760px)").matches) docsNavigation.open = false;

export {};
import "./docs-search";
const article = document.querySelector<HTMLElement>(".prose")!;
const status = document.createElement("p");
status.setAttribute("role", "status");
status.setAttribute("aria-live", "polite");
article.prepend(status);
for (const [index, block] of Array.from(article.querySelectorAll<HTMLElement>("pre")).entries()) {
  const code = block.querySelector("code");
  if (!code) continue;
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "button secondary docs-copy";
  copy.textContent = "Copy example";
  copy.setAttribute("aria-label", `Copy code example ${index + 1}`);
  block.before(copy);
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code.textContent ?? "");
      status.textContent = `Example ${index + 1} copied.`;
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(code);
      selection?.removeAllRanges();
      selection?.addRange(range);
      block.tabIndex = -1;
      block.focus();
      status.textContent =
        "Clipboard unavailable. The example is selected; copy it using your keyboard.";
    }
  });
}
for (const [index, heading] of Array.from(
  article.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"),
).entries()) {
  heading.id = `docs-section-${index}`;
  const link = document.createElement("a");
  link.href = `#${heading.id}`;
  link.textContent = " #";
  link.setAttribute("aria-label", `Link to ${heading.textContent}`);
  heading.append(link);
}
if (/^#docs-section-[0-9]+$/.test(location.hash)) {
  document.getElementById(location.hash.slice(1))?.scrollIntoView();
}
