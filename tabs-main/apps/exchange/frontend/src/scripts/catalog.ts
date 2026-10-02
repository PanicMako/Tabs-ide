import { request } from "./api";
import { extensionMarkPath, extensionMarkViewBox } from "../lib/extensionMark";
import {
  catalogParameters,
  readCatalogState,
  validateCatalogPage,
  type CatalogRelease,
} from "../lib/catalogState";

const form = document.querySelector<HTMLFormElement>("#catalog-search")!;
const query = document.querySelector<HTMLInputElement>("#catalog-query")!;
const category = document.querySelector<HTMLInputElement>("#catalog-category")!;
const sort = document.querySelector<HTMLSelectElement>("#catalog-sort")!;
const results = document.querySelector<HTMLUListElement>("#catalog-results")!;
const region = document.querySelector<HTMLElement>("#catalog-region")!;
const status = document.querySelector<HTMLElement>("#catalog-status")!;
const error = document.querySelector<HTMLElement>("#catalog-error")!;
const message = document.querySelector<HTMLElement>("#catalog-error-message")!;
const more = document.querySelector<HTMLButtonElement>("#catalog-more")!;
const signin = document.querySelector<HTMLAnchorElement>("#catalog-signin")!;
let cursor: string | null = null;
let controller: AbortController | undefined;
let generation = 0;
let debounce: ReturnType<typeof setTimeout> | undefined;
let typingSession = false;
const seen = new Set<string>();

function controls() {
  return {
    q: query.value,
    category: category.value.trim(),
    sort: sort.value as "" | "name" | "newest" | "relevance",
  };
}
function restore() {
  const state = readCatalogState(location.search);
  query.value = state.q;
  category.value = state.category;
  sort.value = state.sort;
  sort.dispatchEvent(new Event("tabs-select-sync"));
}
function text(tag: string, value: string) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}
function card(item: CatalogRelease): HTMLLIElement {
  const row = document.createElement("li");
  row.className = "card catalog-card";
  const identity = `${item.namespace}.${item.name}`;
  const icon = document.createElement("span");
  icon.className = "catalog-icon";
  const puzzle = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  puzzle.setAttribute("viewBox", extensionMarkViewBox);
  puzzle.setAttribute("width", "48");
  puzzle.setAttribute("height", "48");
  puzzle.setAttribute("fill", "currentColor");
  puzzle.setAttribute("focusable", "false");
  const outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
  outline.setAttribute("d", extensionMarkPath);
  outline.setAttribute("fill-rule", "evenodd");
  puzzle.append(outline);
  icon.append(puzzle);
  icon.setAttribute("aria-hidden", "true");
  if (typeof item.manifest.listing?.icon === "string") {
    const image = document.createElement("img");
    image.alt = "";
    image.width = 48;
    image.height = 48;
    image.loading = "lazy";
    image.src = `/v1/extensions/${item.namespace}/${item.name}/versions/${encodeURIComponent(item.version)}/assets/icon`;
    image.addEventListener("error", () => image.remove(), { once: true });
    icon.append(image);
  }
  const heading = document.createElement("h2");
  const link = document.createElement("a");
  link.textContent = item.manifest.displayName;
  link.href = `/extensions/${item.namespace}/${item.name}`;
  heading.append(link);
  row.append(
    icon,
    heading,
    text("p", item.manifest.description),
    text("p", identity),
    text(
      "p",
      `${item.version} · ${item.verified ? "Verified publisher" : "Publisher not verified"}`,
    ),
  );
  return row;
}
function invalidate() {
  generation++;
  controller?.abort();
  if (debounce) clearTimeout(debounce);
}
async function load(append = false) {
  invalidate();
  const current = generation;
  controller = new AbortController();
  const signal = controller.signal;
  if (!append) {
    cursor = null;
    seen.clear();
    results.replaceChildren();
  }
  error.hidden = true;
  more.disabled = true;
  region.setAttribute("aria-busy", "true");
  status.textContent = "Loading published extensions…";
  const params = catalogParameters(controls(), append ? (cursor ?? undefined) : undefined);
  params.set("limit", "30");
  try {
    const page = validateCatalogPage(
      await request<unknown>(`/v1/extensions?${params}`, "GET", undefined, signal),
    );
    if (current !== generation) return;
    const first = results.children.length;
    for (const item of page.extensions) {
      const id = `${item.namespace}.${item.name}`;
      if (!seen.has(id)) {
        seen.add(id);
        results.append(card(item));
      }
    }
    if (append && page.nextCursor === cursor)
      throw new Error("Pagination did not advance. Restart the search.");
    cursor = page.nextCursor;
    more.hidden = !page.hasMore;
    status.textContent = results.children.length
      ? `${results.children.length} extensions shown${page.hasMore ? "; more available" : ""}.`
      : "No published extensions match. Try different words or clear the category.";
    if (append) results.children[first]?.querySelector<HTMLAnchorElement>("a")?.focus();
  } catch (cause) {
    if (current !== generation || signal.aborted) return;
    message.textContent =
      cause instanceof Error ? cause.message : "Search failed. Retry or contact the operator.";
    error.hidden = false;
    more.hidden = true;
    status.textContent = "Search could not be completed.";
  } finally {
    if (current === generation) {
      region.setAttribute("aria-busy", "false");
      more.disabled = false;
    }
  }
}
function search(push: boolean) {
  const params = catalogParameters(controls());
  const path = `/extensions${params.size ? `?${params}` : ""}`;
  if (path !== `${location.pathname}${location.search}`)
    history[push ? "pushState" : "replaceState"](null, "", path);
  signin.href = `/auth/github/start?${new URLSearchParams({ returnTo: path })}`;
  void load();
}
form.addEventListener("submit", (event) => {
  event.preventDefault();
  typingSession = false;
  search(true);
});
query.addEventListener("input", () => {
  invalidate();
  more.hidden = true;
  debounce = setTimeout(() => {
    search(!typingSession);
    typingSession = true;
  }, 200);
});
query.addEventListener("blur", () => {
  typingSession = false;
});
category.addEventListener("change", () => {
  typingSession = false;
  search(true);
});
sort.addEventListener("change", () => {
  typingSession = false;
  search(true);
});
more.addEventListener("click", () => {
  if (cursor) void load(true);
});
document.querySelector("#catalog-retry")!.addEventListener("click", () => void load());
window.addEventListener("popstate", () => {
  typingSession = false;
  restore();
  void load();
});
window.addEventListener("pagehide", invalidate);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    restore();
    void load();
  }
});
restore();
search(false);
