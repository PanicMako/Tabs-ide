// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const root = "/developers/releases/1.7.0-1234567890abcdef/";
const release = {
  release: "test",
  status: "experimental-staging",
  apiVersion: "1.7.0",
  node: ">=22.12.0",
  desktop: { version: "1.3.17", note: "Testing build" },
  bundle: { url: `${root}tabs-developer-bundle.tar.gz`, sha256: "a".repeat(64), bytes: 10 },
  checksumsUrl: `${root}SHA256SUMS`,
};
beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML =
    '<p id="release-status-message"></p><a id="release-download" hidden></a><a id="release-checksums" hidden></a><p id="release-digest"></p><button id="release-retry" hidden></button><details id="release-integrity" hidden></details>';
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(release))),
  );
});
afterEach(() => vi.unstubAllGlobals());
it("shows the real versioned download and checksum only after valid metadata loads", async () => {
  await import("../frontend/src/scripts/developer-release");
  await vi.waitFor(() => expect(document.getElementById("release-download")!.hidden).toBe(false));
  expect(document.getElementById("release-download")!.getAttribute("href")).toBe(
    release.bundle.url,
  );
  expect(document.getElementById("release-digest")!.textContent).toContain(release.bundle.sha256);
  expect(document.getElementById("release-integrity")!.hidden).toBe(false);
});
it("keeps invalid or unavailable downloads hidden and allows an explicit retry", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        ...release,
        bundle: { ...release.bundle, url: "https://untrusted.example/bundle" },
      }),
    ),
  );
  await import("../frontend/src/scripts/developer-release");
  await vi.waitFor(() => expect(document.getElementById("release-retry")!.hidden).toBe(false));
  expect(document.getElementById("release-download")!.hidden).toBe(true);
  expect(document.getElementById("release-integrity")!.hidden).toBe(true);
  document.querySelector<HTMLButtonElement>("#release-retry")!.click();
  await vi.waitFor(() => expect(document.getElementById("release-download")!.hidden).toBe(false));
  expect(fetch).toHaveBeenCalledTimes(2);
});
