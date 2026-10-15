// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const sections = [
  {
    page: "Manifest & SDK reference",
    title: "Storage <script>",
    href: "/docs/extensions/reference#docs-section-2",
    text: "Read and write storage safely.",
  },
  {
    page: "Publish an extension",
    title: "Storage package",
    href: "/docs/extensions/publishing#docs-section-1",
    text: "Upload storage packages.",
  },
];
beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = `<button id="docs-search-open">Search</button><dialog id="docs-search-dialog"><button id="docs-search-close">Close</button><input id="docs-search"><button id="docs-search-clear" hidden>Clear</button><input type="radio" name="docs-search-scope" value="all" checked><input type="radio" name="docs-search-scope" value="sdk"><p id="docs-search-status"></p><div id="docs-search-region"><ul id="docs-search-results"></ul></div></dialog>`;
  const dialog = document.querySelector("dialog")!;
  dialog.showModal = () => dialog.setAttribute("open", "");
  dialog.close = () => {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(sections))),
  );
});
afterEach(() => vi.unstubAllGlobals());
async function setup() {
  await import("../frontend/src/scripts/docs-search");
  document.querySelector<HTMLButtonElement>("#docs-search-open")!.click();
  return document.querySelector<HTMLInputElement>("#docs-search")!;
}
async function query(input: HTMLInputElement) {
  input.value = "storage";
  input.dispatchEvent(new Event("input"));
  await vi.waitFor(() =>
    expect(document.querySelectorAll("#docs-search-results a")).toHaveLength(2),
  );
}
it("filters before limiting results, highlights safe text, and supports keyboard focus and close restoration", async () => {
  const input = await setup();
  expect(document.activeElement).toBe(input);
  await query(input);
  expect(document.querySelector("#docs-search-results script")).toBeNull();
  expect(document.querySelector("mark")?.textContent).toBe("Storage");
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect(document.activeElement?.tagName).toBe("A");
  const filter = document.querySelector<HTMLInputElement>('input[value="sdk"]')!;
  filter.checked = true;
  filter.dispatchEvent(new Event("change"));
  await vi.waitFor(() =>
    expect(document.querySelectorAll("#docs-search-results a")).toHaveLength(1),
  );
  expect(document.querySelector("#docs-search-results a")?.getAttribute("href")).toContain(
    "reference#",
  );
  document.querySelector<HTMLButtonElement>("#docs-search-clear")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector("#docs-search-status")?.textContent).toContain("1 matching"),
  );
  expect(input.value).toBe("");
  document.querySelector<HTMLButtonElement>("#docs-search-close")!.click();
  expect(document.activeElement?.id).toBe("docs-search-open");
});
it("recovers after a failed index request without showing proxy content", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response("private diagnostic", { status: 503 }));
  const input = await setup();
  input.value = "storage";
  input.dispatchEvent(new Event("input"));
  await vi.waitFor(() =>
    expect(document.querySelector("#docs-search-status")?.textContent).toContain("Try again"),
  );
  expect(document.body.textContent).not.toContain("private diagnostic");
  await query(input);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("discards stale searches when the query is cleared during loading", async () => {
  let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const input = await setup();
  input.value = "storage";
  input.dispatchEvent(new Event("input"));
  input.value = "";
  input.dispatchEvent(new Event("input"));
  resolve(new Response(JSON.stringify(sections)));
  await new Promise((done) => setTimeout(done, 20));
  expect(document.querySelectorAll("#docs-search-results a")).toHaveLength(0);
  expect(document.querySelector("#docs-search-region")?.getAttribute("aria-busy")).toBe("false");
});

it("closes the panel for section links without preventing their navigation", async () => {
  const input = await setup();
  await query(input);
  const link = document.querySelector<HTMLAnchorElement>("#docs-search-results a")!;
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  expect(link.dispatchEvent(click)).toBe(true);
  expect(document.querySelector("dialog")!.hasAttribute("open")).toBe(false);
  expect(link.getAttribute("href")).toContain("#docs-section-");
});
it("closes on the first Escape even with a populated native search field", async () => {
  const input = await setup();
  await query(input);
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  input.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  expect(document.querySelector<HTMLDialogElement>("dialog")!.open).toBe(false);
  expect(document.activeElement?.id).toBe("docs-search-open");
  expect(input.value).toBe("storage");
});
