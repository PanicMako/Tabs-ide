import { request } from "./api";
import { catalogCard } from "../lib/catalogCard";
import { catalogParameters, readCatalogState, validateCatalogPage } from "../lib/catalogState";

const form = document.querySelector<HTMLFormElement>("#catalog-search")!;
const query = document.querySelector<HTMLInputElement>("#catalog-query")!;
const category = document.querySelector<HTMLSelectElement>("#catalog-category")!;
const customCategory = document.querySelector<HTMLInputElement>("#catalog-custom-category");
const sort = document.querySelector<HTMLSelectElement>("#catalog-sort")!;
const results = document.querySelector<HTMLUListElement>("#catalog-results")!;
const region = document.querySelector<HTMLElement>("#catalog-region")!;
const status = document.querySelector<HTMLElement>("#catalog-status")!;
const error = document.querySelector<HTMLElement>("#catalog-error")!;
const empty = document.querySelector<HTMLElement>("#catalog-empty")!;
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
    category:
      category.value === "__custom" ? (customCategory?.value.trim() ?? "") : category.value.trim(),
    sort: sort.value as "" | "name" | "newest" | "relevance",
  };
}
function restore() {
  const state = readCatalogState(location.search);
  query.value = state.q;
  if (
    state.category &&
    !Array.from(category.options).some((option) => option.value === state.category)
  ) {
    const custom = document.createElement("option");
    custom.value = state.category;
    custom.textContent = state.category;
    category.append(custom);
  }
  category.value = state.category;
  if (customCategory) customCategory.hidden = true;
  category.dispatchEvent(new Event("tabs-select-sync"));
  sort.value = state.sort;
  sort.dispatchEvent(new Event("tabs-select-sync"));
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
  empty.hidden = true;
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
        results.append(catalogCard(item));
      }
    }
    if (append && page.nextCursor === cursor)
      throw new Error("Pagination did not advance. Restart the search.");
    cursor = page.nextCursor;
    more.hidden = !page.hasMore;
    empty.hidden = results.children.length > 0;
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
  if (customCategory) {
    customCategory.hidden = category.value !== "__custom";
    if (!customCategory.hidden) {
      customCategory.focus();
      return;
    }
  }
  typingSession = false;
  search(true);
});
customCategory?.addEventListener("change", () => search(true));
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
