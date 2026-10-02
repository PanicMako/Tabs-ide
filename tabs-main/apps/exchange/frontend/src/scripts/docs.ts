export {};
import {
  isDocumentationHref,
  parseDocumentationIndex,
  searchDocumentation,
  type DocSection,
} from "./documentationSearch";
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
const input = document.querySelector<HTMLInputElement>("#docs-search")!;
const results = document.querySelector<HTMLElement>("#docs-search-results")!;
const searchStatus = document.querySelector<HTMLElement>("#docs-search-status")!;
let index: Promise<DocSection[]> | undefined;
let generation = 0;
input.addEventListener("input", async () => {
  const current = ++generation;
  results.replaceChildren();
  const query = input.value.trim();
  if (!query) {
    searchStatus.textContent = "";
    return;
  }
  searchStatus.textContent = "Searching documentation…";
  try {
    index ??= fetch("/docs/extensions/search.json", {
      credentials: "same-origin",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    }).then(async (response) => {
      if (!response.ok) throw new Error("Documentation search could not load. Try again.");
      const text = await response.text();
      if (text.length > 1024 * 1024) throw new Error("Documentation search exceeded its limit.");
      return parseDocumentationIndex(text);
    });
    const sections = await index;
    if (generation !== current) return;
    const matches = searchDocumentation(sections, query);
    for (const match of matches) {
      if (!isDocumentationHref(match.href)) continue;
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = match.href;
      link.textContent = `${match.page} — ${match.title}`;
      const snippet = document.createElement("p");
      const position = Math.max(0, match.text.toLowerCase().indexOf(query.toLowerCase()) - 40);
      snippet.textContent = `${position ? "…" : ""}${match.text.slice(position, position + 180)}${match.text.length > position + 180 ? "…" : ""}`;
      item.append(link, snippet);
      results.append(item);
    }
    searchStatus.textContent = matches.length
      ? `${matches.length} section results (maximum 20).`
      : "No matching sections. Try fewer words.";
  } catch (error) {
    index = undefined;
    if (generation === current)
      searchStatus.textContent =
        error instanceof Error ? error.message : "Search unavailable. Try again.";
  }
});
