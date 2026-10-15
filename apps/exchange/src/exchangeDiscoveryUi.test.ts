import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { catalogCard } from "../frontend/src/lib/catalogCard";

let dom: Window;
beforeEach(() => {
  vi.resetModules();
  dom = new Window();
  vi.stubGlobal("document", dom.document);
  vi.stubGlobal("Event", dom.Event);
  vi.stubGlobal("KeyboardEvent", dom.KeyboardEvent);
});
afterEach(async () => {
  await dom.happyDOM.close();
  vi.unstubAllGlobals();
});
const release = {
  namespace: "acme",
  name: "review",
  version: "1.0.0",
  verified: false,
  manifest: { displayName: "Review", description: "Inspect a change." },
};

it("renders registry text safely and keeps publisher verification distinct from release review", () => {
  const card = catalogCard({
    ...release,
    manifest: {
      displayName: '<img src=x onerror="alert(1)">',
      description: "<script>bad()</script>",
    },
  });
  expect(card.querySelector("h2")!.textContent).toContain("<img");
  expect(card.querySelector("script, img")).toBeNull();
  expect(card.querySelector("a")!.getAttribute("href")).toBe("/extensions/acme/review");
  expect(card.textContent).toContain("Publisher not verified");
  expect(card.textContent).toContain("v1.0.0");
});

it("falls back to the extension mark when a packaged icon fails to load", () => {
  const card = catalogCard({
    ...release,
    manifest: { ...release.manifest, listing: { icon: "icon.svg" } },
  });
  const icon = card.querySelector("img")!;
  expect(icon.getAttribute("src")).toBe("/v1/extensions/acme/review/versions/1.0.0/assets/icon");
  icon.dispatchEvent(new Event("error"));
  expect(card.querySelector("img")).toBeNull();
  expect(card.querySelector("svg")).not.toBeNull();
});

function homepage() {
  document.body.innerHTML = `
    <p id="home-catalog-status"></p>
    <section id="home-catalog-region" aria-busy="true"><ul id="home-catalog-results"></ul></section>
    <div id="home-catalog-empty" hidden></div>
    <div id="home-catalog-error" hidden><p id="home-catalog-error-message"></p></div>
    <button id="home-catalog-retry"></button>`;
}
async function finished() {
  await vi.waitFor(() =>
    expect(document.getElementById("home-catalog-region")!.getAttribute("aria-busy")).toBe("false"),
  );
}
describe("homepage live discovery", () => {
  it("requests recently published releases and never supplies fallback inventory", async () => {
    homepage();
    const fetcher = vi.fn(async (_path: string) =>
      Response.json({ extensions: [release], hasMore: false, nextCursor: null }),
    );
    vi.stubGlobal("fetch", fetcher);
    await import("../frontend/src/scripts/home-catalog");
    await finished();
    expect(fetcher.mock.calls[0]?.[0]).toBe("/v1/extensions?sort=newest&limit=6");
    expect(document.querySelectorAll("#home-catalog-results li")).toHaveLength(1);
    expect(document.getElementById("home-catalog-empty")!.hidden).toBe(true);
    expect(document.getElementById("home-catalog-error")!.hidden).toBe(true);
  });
  it("distinguishes an empty registry from an unavailable API and supports explicit retry", async () => {
    homepage();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ extensions: [], hasMore: false, nextCursor: null }));
    vi.stubGlobal("fetch", fetcher);
    await import("../frontend/src/scripts/home-catalog");
    await finished();
    expect(document.getElementById("home-catalog-error")!.hidden).toBe(false);
    expect(document.getElementById("home-catalog-empty")!.hidden).toBe(true);
    expect(document.querySelectorAll("#home-catalog-results li")).toHaveLength(0);
    document.getElementById("home-catalog-retry")!.click();
    await finished();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(document.getElementById("home-catalog-error")!.hidden).toBe(true);
    expect(document.getElementById("home-catalog-empty")!.hidden).toBe(false);
  });
  it("rejects malformed listing responses without presenting them as published extensions", async () => {
    homepage();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          extensions: [{ ...release, namespace: "../bad" }],
          hasMore: false,
          nextCursor: null,
        }),
      ),
    );
    await import("../frontend/src/scripts/home-catalog");
    await finished();
    expect(document.getElementById("home-catalog-error")!.hidden).toBe(false);
    expect(document.querySelectorAll("#home-catalog-results li")).toHaveLength(0);
  });
});

it("shows real packaged screenshots and categories without trusting publisher asset URLs", () => {
  const card = catalogCard({
    ...release,
    manifest: {
      ...release.manifest,
      listing: {
        screenshots: [{ path: "https://untrusted.example/track", alt: "Workspace preview" }],
        categories: ["development", "<script>bad()</script>"],
      },
    },
  });
  const preview = card.querySelector<HTMLImageElement>(".catalog-preview")!;
  expect(preview.getAttribute("src")).toBe(
    "/v1/extensions/acme/review/versions/1.0.0/assets/screenshot/0",
  );
  expect(preview.alt).toBe("Workspace preview");
  expect(card.querySelector(".catalog-category-tags")!.textContent).toBe("development");
  preview.dispatchEvent(new Event("error"));
  expect(card.querySelector(".catalog-preview")).toBeNull();
  expect(card.querySelector("h2")!.textContent).toBe("Review");
});
