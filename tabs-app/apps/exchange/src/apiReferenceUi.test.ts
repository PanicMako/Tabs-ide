// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = `<input id="api-operation-search"><p id="api-operation-status"></p><ul><li data-api-link="catalog">Catalog</li><li data-api-link="publish">Publish</li></ul><section id="catalog" data-api-search="get /v1/extensions search extensions"></section><section id="publish" data-api-search="post /v1/upload publish archive"></section>`;
});
it("filters both navigation and endpoints with all query terms and reports empty results", async () => {
  await import("../frontend/src/scripts/api-reference");
  const input = document.querySelector<HTMLInputElement>("input")!;
  input.value = "GET extensions";
  input.dispatchEvent(new Event("input"));
  expect(document.getElementById("catalog")!.hidden).toBe(false);
  expect(document.getElementById("publish")!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>('[data-api-link="publish"]')!.hidden).toBe(true);
  expect(document.getElementById("api-operation-status")!.textContent).toBe("1 matching endpoint");
  input.value = "get upload";
  input.dispatchEvent(new Event("input"));
  expect(document.getElementById("api-operation-status")!.textContent).toContain(
    "No endpoints found",
  );
});
it("reveals a section reached by an anchor when a previous filter hid it", async () => {
  await import("../frontend/src/scripts/api-reference");
  const input = document.querySelector<HTMLInputElement>("input")!;
  input.value = "get";
  input.dispatchEvent(new Event("input"));
  const target = document.getElementById("publish")!;
  target.scrollIntoView = vi.fn();
  location.hash = "publish";
  window.dispatchEvent(new Event("hashchange"));
  expect(input.value).toBe("");
  expect(target.hidden).toBe(false);
  expect(target.scrollIntoView).toHaveBeenCalled();
});
