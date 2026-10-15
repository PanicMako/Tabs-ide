// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
it("keeps the marketing cursor out of fields and disabled controls, adapts to footer/dialog layers, and restores native input on keyboard or preference changes", async () => {
  vi.resetModules();
  const media = Object.assign(new EventTarget(), { matches: true });
  vi.stubGlobal("matchMedia", () => media);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  document.body.innerHTML = `<div class="tabs-cursor"><span class="cursor-pointer"></span><div class="cursor-toy"><i class="cursor-tab"></i><i class="cursor-tab"></i><i class="cursor-tab"><span data-cursor-symbol></span></i></div></div><a id="download" href="/bundle" download>Download</a><input id="field"><button id="disabled" disabled>Unavailable</button><footer><span id="footer-target">Footer</span></footer><dialog open><button id="dialog-action">Action</button></dialog>`;
  await import("../frontend/src/scripts/custom-cursor");
  const cursor = document.querySelector<HTMLElement>(".tabs-cursor")!;
  const move = (id: string) =>
    document.getElementById(id)!.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerType: "mouse",
        clientX: 100,
        clientY: 100,
      }),
    );
  move("download");
  expect(cursor.dataset.mode).toBe("download");
  expect(document.documentElement.classList.contains("tabs-cursor-active")).toBe(true);
  move("field");
  expect(document.documentElement.classList.contains("tabs-cursor-active")).toBe(false);
  move("disabled");
  expect(document.documentElement.classList.contains("tabs-cursor-active")).toBe(false);
  move("footer-target");
  expect(cursor.dataset.footer).toBe("true");
  move("dialog-action");
  expect(cursor.parentElement?.tagName).toBe("DIALOG");
  expect(cursor.dataset.mode).toBe("action");
  document.querySelector("dialog")!.dispatchEvent(new Event("close"));
  expect(document.documentElement.classList.contains("tabs-cursor-active")).toBe(false);
  move("download");
  expect(cursor.parentElement).toBe(document.body);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
  expect(document.documentElement.classList.contains("tabs-cursor-active")).toBe(false);
  media.matches = false;
  media.dispatchEvent(new Event("change"));
  move("download");
  expect(document.documentElement.classList.contains("tabs-cursor-active")).toBe(false);
  vi.unstubAllGlobals();
});
