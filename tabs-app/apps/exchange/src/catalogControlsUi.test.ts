import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
let dom: Window;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  dom = new Window({ url: "http://localhost:8787/extensions?category=team-specific" });
  for (const key of ["window", "document", "location", "history", "Event"] as const)
    vi.stubGlobal(key, key === "window" ? dom : dom[key]);
  const source = readFileSync(
    new URL("../frontend/src/pages/extensions/index.astro", import.meta.url),
    "utf8",
  );
  document.body.innerHTML = /<Exchange[^>]*>([\s\S]*?)<\/Exchange>/.exec(source)![1]!;
  fetcher = vi.fn(async () => Response.json({ extensions: [], hasMore: false, nextCursor: null }));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(async () => {
  window.dispatchEvent(new Event("pagehide"));
  await dom.happyDOM.close();
  vi.unstubAllGlobals();
});
it("keeps publisher-defined categories usable after replacing native suggestions with a custom select", async () => {
  await import("../frontend/src/scripts/catalog");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  const category = document.getElementById("catalog-category") as HTMLSelectElement;
  expect(category.value).toBe("team-specific");
  expect(fetcher.mock.calls[0]?.[0]).toContain("category=team-specific");
  const previousRequests = fetcher.mock.calls.length;
  category.value = "__custom";
  category.dispatchEvent(new Event("change"));
  const other = document.getElementById("catalog-custom-category") as HTMLInputElement;
  expect(other.hidden).toBe(false);
  expect(document.activeElement).toBe(other);
  expect(fetcher.mock.calls.length).toBe(previousRequests);
  other.value = "another-team";
  other.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(fetcher.mock.calls.at(-1)?.[0]).toContain("category=another-team"));
  expect(location.search).toContain("category=another-team");
  history.replaceState(null, "", "/extensions?category=productivity");
  window.dispatchEvent(new Event("popstate"));
  expect(category.value).toBe("productivity");
  expect(other.hidden).toBe(true);
});
