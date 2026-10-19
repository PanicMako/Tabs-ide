// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
it("restores the system pointer on native-cursor surfaces instead of hiding it behind a review overlay", async () => {
  document.body.innerHTML =
    '<div class="tabs-cursor"><div class="cursor-toy"></div><div class="cursor-tab"></div><div class="cursor-tab"></div><div class="cursor-tab"></div><span data-cursor-symbol></span></div><button id="outside">Outside</button><div data-native-cursor><button id="inside">Review code</button></div>';
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn() }));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const documentEvents = vi.spyOn(document, "addEventListener");
  const rootEvents = vi.spyOn(document.documentElement, "addEventListener");
  const windowEvents = vi.spyOn(window, "addEventListener");
  try {
    await import("../frontend/src/scripts/custom-cursor");
    document
      .getElementById("outside")!
      .dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
    expect(document.documentElement.classList.contains("tabs-cursor-active")).toBe(true);
    document
      .getElementById("inside")!
      .dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
    expect(document.documentElement.classList.contains("tabs-cursor-active")).toBe(false);
  } finally {
    for (const [type, listener, options] of documentEvents.mock.calls)
      document.removeEventListener(type, listener, options);
    for (const [type, listener, options] of rootEvents.mock.calls)
      document.documentElement.removeEventListener(type, listener, options);
    for (const [type, listener, options] of windowEvents.mock.calls)
      window.removeEventListener(type, listener, options);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.classList.remove("tabs-cursor-active");
  }
});
