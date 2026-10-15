import { Window } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
let dom: Window;
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.resetModules();
  dom = new Window({ url: "http://localhost:8787/publisher" });
  for (const key of [
    "document",
    "window",
    "location",
    "history",
    "MutationObserver",
    "AbortController",
    "MouseEvent",
    "Event",
    "Element",
  ] as const)
    vi.stubGlobal(key, key === "window" ? dom : dom[key]);
});
it("moves focus out of a departing task on browser Back without stealing focus from navigation", async () => {
  const root = await fixture();
  document.querySelector<HTMLAnchorElement>('[data-workspace-target="access"]')!.click();
  document.getElementById("secret")!.focus();
  history.replaceState(null, "", "#identity");
  window.dispatchEvent(new Event("popstate"));
  expect(root.dataset.activePanel).toBe("identity");
  expect(document.activeElement?.textContent).toBe("Identity");
  const link = document.querySelector<HTMLAnchorElement>('[data-workspace-target="access"]')!;
  link.focus();
  history.replaceState(null, "", "#access");
  window.dispatchEvent(new Event("popstate"));
  expect(document.activeElement).toBe(link);
});
it("restores focus to an available task when a focused role panel loses access", async () => {
  const root = await fixture();
  document.getElementById("review")!.hidden = false;
  await vi.waitFor(() =>
    expect(
      document.querySelector<HTMLAnchorElement>('[data-workspace-target="review"]')!.hidden,
    ).toBe(false),
  );
  document.querySelector<HTMLAnchorElement>('[data-workspace-target="review"]')!.click();
  document.getElementById("review")!.hidden = true;
  await vi.waitFor(() => expect(root.dataset.activePanel).toBe("identity"));
  expect(document.activeElement?.textContent).toBe("Identity");
});
it("uses decoded heading fragments for clicks as well as direct navigation", async () => {
  const root = await fixture();
  const link = document.querySelector<HTMLAnchorElement>('[data-workspace-target="access"]')!;
  link.href = "#tokens%2Dtitle";
  link.click();
  expect(root.dataset.activePanel).toBe("access");
  expect(document.activeElement?.id).toBe("tokens-title");
});
afterEach(async () => {
  dispose?.();
  dispose = undefined;
  window.dispatchEvent(new Event("pagehide"));
  await dom.happyDOM.close();
  vi.unstubAllGlobals();
});
async function fixture() {
  const { setupWorkspacePanels } = await import("../frontend/src/scripts/workspace-panels");
  document.body.innerHTML = `<div id="root"><nav data-workspace-navigation><a href="#identity" data-workspace-target="identity">Identity</a><a href="#access" data-workspace-target="access">Access</a><details id="review-group"><summary>Review controls</summary><a href="#review" data-workspace-target="review">Review</a></details></nav><section id="access" data-workspace-panel><h2 id="tokens-title">Tokens</h2><input id="secret" /></section><section id="identity" data-workspace-panel><h2>Identity</h2></section><section id="review" data-workspace-panel hidden><h2>Review</h2></section></div>`;
  for (const element of document.querySelectorAll<HTMLElement>("section,h2,input"))
    element.scrollIntoView = vi.fn();
  const root = document.getElementById("root")!;
  dispose = setupWorkspacePanels(root);
  return root;
}
it("defaults to the first available task in navigation order and never reveals role-hidden controls", async () => {
  const root = await fixture();
  expect(root.dataset.activePanel).toBe("identity");
  expect(document.getElementById("review")!.hidden).toBe(true);
  expect(
    document.querySelector<HTMLAnchorElement>('[data-workspace-target="review"]')!.hidden,
  ).toBe(true);
  document.getElementById("review")!.hidden = false;
  await vi.waitFor(() =>
    expect(
      document.querySelector<HTMLAnchorElement>('[data-workspace-target="review"]')!.hidden,
    ).toBe(false),
  );
});
it("supports old nested heading deep links, focus, and browser history without discarding form values", async () => {
  const root = await fixture();
  (document.getElementById("secret") as HTMLInputElement).value = "local test input";
  history.replaceState(null, "", "#tokens-title");
  window.dispatchEvent(new Event("hashchange"));
  expect(root.dataset.activePanel).toBe("access");
  expect(document.activeElement?.id).toBe("tokens-title");
  document.querySelector<HTMLAnchorElement>('[data-workspace-target="identity"]')!.click();
  expect(location.hash).toBe("#identity");
  expect(document.activeElement?.textContent).toBe("Identity");
  expect(root.dataset.activePanel).toBe("identity");
  history.replaceState(null, "", "#tokens-title");
  window.dispatchEvent(new Event("popstate"));
  expect(root.dataset.activePanel).toBe("access");
  expect((document.getElementById("secret") as HTMLInputElement).value).toBe("local test input");
});
it("falls back safely if a selected role is hidden and ignores malformed fragments", async () => {
  history.replaceState(null, "", "#review");
  const root = await fixture();
  expect(root.dataset.activePanel).toBe("identity");
  history.replaceState(null, "", "#%invalid");
  expect(() => window.dispatchEvent(new Event("hashchange"))).not.toThrow();
  expect(root.dataset.activePanel).toBe("identity");
});

it("opens a secondary task group for an authorized deep link while preserving hidden-role boundaries", async () => {
  const root = await fixture();
  const group = document.getElementById("review-group") as HTMLDetailsElement;
  expect(group.open).toBe(false);
  history.replaceState(null, "", "#review");
  window.dispatchEvent(new Event("hashchange"));
  expect(root.dataset.activePanel).toBe("identity");
  expect(group.open).toBe(false);
  document.getElementById("review")!.hidden = false;
  await vi.waitFor(() => expect(root.dataset.activePanel).toBe("review"));
  expect(group.open).toBe(true);
  expect(
    document.querySelector('[data-workspace-target="review"]')!.getAttribute("aria-current"),
  ).toBe("location");
  document.getElementById("review")!.hidden = true;
  await vi.waitFor(() => expect(root.dataset.activePanel).toBe("identity"));
  expect(
    document.querySelector<HTMLAnchorElement>('[data-workspace-target="review"]')!.hidden,
  ).toBe(true);
});
