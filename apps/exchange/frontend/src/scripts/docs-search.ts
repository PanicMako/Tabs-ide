import {
  parseDocumentationIndex,
  searchDocumentation,
  type DocSection,
} from "./documentationSearch";

const dialog = document.querySelector<HTMLDialogElement>("#docs-search-dialog")!;
const trigger = document.querySelector<HTMLButtonElement>("#docs-search-open")!;
const input = document.querySelector<HTMLInputElement>("#docs-search")!;
const results = document.querySelector<HTMLElement>("#docs-search-results")!;
const status = document.querySelector<HTMLElement>("#docs-search-status")!;
const region = document.querySelector<HTMLElement>("#docs-search-region")!;
const clear = document.querySelector<HTMLButtonElement>("#docs-search-clear")!;
let index: Promise<DocSection[]> | undefined;
let generation = 0;

function highlight(element: HTMLElement, text: string, query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  // Text nodes keep index content inert, including HTML-like search terms.
  const lower = text.toLowerCase();
  let start = 0;
  while (start < text.length) {
    let position = text.length;
    let length = 0;
    for (const term of terms) {
      const found = lower.indexOf(term, start);
      if (found >= 0 && (found < position || (found === position && term.length > length))) {
        position = found;
        length = term.length;
      }
    }
    element.append(document.createTextNode(text.slice(start, position)));
    if (!length) break;
    const mark = document.createElement("mark");
    mark.textContent = text.slice(position, position + length);
    element.append(mark);
    start = position + length;
  }
}
async function search() {
  const current = ++generation;
  const query = input.value.trim();
  const scope = dialog.querySelector<HTMLInputElement>(
    'input[name="docs-search-scope"]:checked',
  )!.value;
  clear.hidden = !input.value;
  results.replaceChildren();
  region.setAttribute("aria-busy", "false");
  if (!query && scope === "all") {
    status.textContent = "Search a topic or choose a collection to explore.";
    return;
  }
  region.setAttribute("aria-busy", "true");
  status.textContent = "Searching documentation…";
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
    if (current !== generation) return;
    const collections: Record<string, string[]> = {
      sdk: ["reference", "permissions", "logic"],
      publishing: ["publishing", "updates"],
      registry: ["registry", "registry-api", "self-hosting"],
    };
    const scoped = sections.filter((section) => {
      const slug = section.href.split("#")[0]!.split("/")[3] ?? "";
      if (scope === "all") return true;
      if (scope === "guides") return ["", "development", "troubleshooting"].includes(slug);
      return collections[scope]?.includes(slug) ?? false;
    });
    const matches = query ? searchDocumentation(scoped, query, scoped.length) : scoped;
    for (const match of matches.slice(0, 20)) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = match.href;
      const page = document.createElement("span");
      page.className = "docs-search-page";
      page.textContent = match.page;
      const title = document.createElement("strong");
      highlight(title, match.title, query);
      const snippet = document.createElement("span");
      snippet.className = "docs-search-snippet";
      const first = query.toLowerCase().split(/\s+/)[0] ?? "";
      const position = Math.max(0, match.text.toLowerCase().indexOf(first) - 45);
      highlight(
        snippet,
        `${position ? "…" : ""}${match.text.slice(position, position + 180)}${match.text.length > position + 180 ? "…" : ""}`,
        query,
      );
      link.append(page, title, snippet);
      item.append(link);
      results.append(item);
    }
    region.scrollTop = 0;
    status.textContent = matches.length
      ? `${matches.length} matching sections${matches.length > 20 ? " · Showing the first 20. Refine your search to narrow them down." : "."}`
      : "No matches in this collection. Try another filter or fewer words.";
  } catch (error) {
    index = undefined;
    if (current === generation)
      status.textContent =
        error instanceof Error ? error.message : "Search unavailable. Try again.";
  } finally {
    if (current === generation) region.setAttribute("aria-busy", "false");
  }
}
trigger.addEventListener("click", () => {
  dialog.showModal();
  input.focus();
  void search();
});
document.querySelector("#docs-search-close")!.addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => {
  generation++;
  region.setAttribute("aria-busy", "false");
  trigger.focus();
});
dialog.addEventListener("click", (event) => {
  const bounds = dialog.getBoundingClientRect();
  if (
    event.target === dialog &&
    (event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom)
  )
    dialog.close();
});
clear.addEventListener("click", () => {
  input.value = "";
  input.focus();
  void search();
});
input.addEventListener("input", () => void search());
dialog
  .querySelectorAll('input[name="docs-search-scope"]')
  .forEach((filter) => filter.addEventListener("change", () => void search()));
dialog.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    dialog.close();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const links = Array.from(results.querySelectorAll<HTMLAnchorElement>("a"));
  const active = document.activeElement;
  if (!links.length || (active !== input && !links.includes(active as HTMLAnchorElement))) return;
  event.preventDefault();
  const current = links.indexOf(active as HTMLAnchorElement);
  const next =
    current < 0
      ? event.key === "ArrowDown"
        ? 0
        : links.length - 1
      : current + (event.key === "ArrowDown" ? 1 : -1);
  if (next < 0) input.focus();
  else links[Math.min(next, links.length - 1)]!.focus();
});

// Same-page section links must reveal the article rather than leave it behind the dialog.
results.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("a")) dialog.close();
});
