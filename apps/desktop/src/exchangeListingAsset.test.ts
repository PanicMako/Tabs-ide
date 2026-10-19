import { describe, expect, it, vi } from "vitest";
import { fetchExchangeListingAsset } from "./exchangeListingAsset";
const origin = "https://exchange.example";
const listing = { registryOrigin: origin, namespace: "acme", name: "relay", version: "1.0.0" };
function reply(body: BodyInit, type: string, url: string, status = 200) {
  const response = new Response(body, { status, headers: { "content-type": type } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}
describe("informational listing assets", () => {
  it("reads bounded README text from the exact configured origin without following redirects", async () => {
    const fetcher = vi.fn(async (url) =>
      reply("# Hello", "text/plain; charset=utf-8", String(url)),
    );
    expect(await fetchExchangeListingAsset(origin, listing, "readme", undefined, fetcher)).toEqual({
      type: "text/plain",
      data: "# Hello",
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `${origin}/v1/extensions/acme/relay/versions/1.0.0/assets/readme`,
    );
  });
  it("rejects another registry, path injection, and invalid screenshot indices before fetching", async () => {
    const fetcher = vi.fn();
    for (const value of [
      { ...listing, registryOrigin: "https://other.example" },
      { ...listing, name: "../private" },
      { ...listing, version: "../../secret" },
      { ...listing, version: ".." },
    ])
      await expect(
        fetchExchangeListingAsset(origin, value, "icon", undefined, fetcher),
      ).rejects.toThrow(/Invalid/);
    await expect(
      fetchExchangeListingAsset(origin, listing, "screenshot", 6, fetcher),
    ).rejects.toThrow(/Invalid/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("allows raster images only, checks signatures, and never returns active SVG or HTML", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(
      (
        await fetchExchangeListingAsset(origin, listing, "icon", undefined, async (url) =>
          reply(png, "image/png", String(url)),
        )
      )?.data,
    ).toMatch(/^data:image\/png;base64,/);
    for (const type of ["image/svg+xml", "text/html", "image/png"])
      await expect(
        fetchExchangeListingAsset(origin, listing, "icon", undefined, async (url) =>
          reply("<script>bad()</script>", type, String(url)),
        ),
      ).rejects.toThrow();
  });
  it("rejects streamed oversized content and changed-origin responses; missing assets are optional", async () => {
    await expect(
      fetchExchangeListingAsset(origin, listing, "readme", undefined, async (url) =>
        reply("x".repeat(512 * 1024 + 1), "text/plain", String(url)),
      ),
    ).rejects.toThrow(/too large/);
    await expect(
      fetchExchangeListingAsset(origin, listing, "readme", undefined, async () =>
        reply("README", "text/plain", "https://other.example"),
      ),
    ).rejects.toThrow(/changed origin/);
    expect(
      await fetchExchangeListingAsset(origin, listing, "icon", undefined, async (url) =>
        reply("missing", "text/plain", String(url), 404),
      ),
    ).toBeNull();
  });
});
