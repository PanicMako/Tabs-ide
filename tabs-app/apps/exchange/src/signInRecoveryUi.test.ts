// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { frontendAsset } from "./frontend";

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML =
    '<p id="sign-in-message"></p><a id="sign-in-retry" href="/auth/github/start">Try GitHub again</a>';
});
it.each(["cancelled", "expired", "denied", "unavailable"])(
  "shows bounded %s guidance and preserves the safe return task",
  async (reason) => {
    window.history.replaceState(
      null,
      "",
      `/sign-in?reason=${reason}&returnTo=%2Faccount%2Fnamespaces`,
    );
    await import("../frontend/src/scripts/sign-in");
    expect(document.getElementById("sign-in-message")!.textContent!.length).toBeGreaterThan(30);
    expect(document.querySelector("a")!.getAttribute("href")).toBe(
      "/auth/github/start?returnTo=%2Faccount%2Fnamespaces",
    );
    expect(frontendAsset("/sign-in")).toBe("sign-in/index.html");
  },
);
it.each(["__proto__", "<script>secret</script>"])(
  "ignores unrecognized reason %s and an unsafe redirect",
  async (reason) => {
    window.history.replaceState(
      null,
      "",
      `/sign-in?${new URLSearchParams({ reason, returnTo: "https://evil.example" })}`,
    );
    await import("../frontend/src/scripts/sign-in");
    expect(document.getElementById("sign-in-message")!.textContent).toBe(
      "We couldn’t finish signing you in. Try again in a moment.",
    );
    expect(document.querySelector("a")!.getAttribute("href")).toBe(
      "/auth/github/start?returnTo=%2Fpublisher",
    );
    expect(document.querySelector("script")).toBeNull();
  },
);
