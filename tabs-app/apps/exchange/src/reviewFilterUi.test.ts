import { Window } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { filterReviewPackages } from "../frontend/src/lib/reviewFilter";
let dom: Window;
beforeEach(() => {
  dom = new Window();
  vi.stubGlobal("document", dom.document);
  document.body.innerHTML =
    '<ul id="packages"><li data-review-identity="maker.tool@1.0.0 abc123" data-review-status="review"></li><li data-review-identity="maker.tool@2.0.0 def456" data-review-status="approved"></li></ul>';
});
afterEach(async () => {
  await dom.happyDOM.close();
  vi.unstubAllGlobals();
});
it("combines version/digest search and pending/approved scope over the loaded set", () => {
  const list = document.getElementById("packages")!;
  expect(filterReviewPackages(list, "MAKER ABC", "pending")).toContain("1 of 2");
  expect(list.children[0]!.hasAttribute("hidden")).toBe(false);
  expect(list.children[1]!.hasAttribute("hidden")).toBe(true);
  expect(filterReviewPackages(list, "", "approved")).toContain("1 of 2");
  expect(list.children[1]!.hasAttribute("hidden")).toBe(false);
});
it("distinguishes no matching results from an empty queue and never inserts search HTML", () => {
  const list = document.getElementById("packages")!;
  expect(filterReviewPackages(list, "<img src=x onerror=alert(1)>", "all")).toContain("0 of 2");
  expect(list.querySelector("img")).toBeNull();
  expect(list.querySelector("[data-filter-empty]")!.textContent).toContain("Nothing matches");
  filterReviewPackages(list, "", "all");
  expect(list.querySelector("[data-filter-empty]")).toBeNull();
  list.replaceChildren();
  expect(filterReviewPackages(list, "", "all")).toContain("0 of 0");
  expect(list.children.length).toBe(0);
});
