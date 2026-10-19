import { describe, expect, it, vi } from "vitest";
import desktopPackage from "../package.json" with { type: "json" };
import { discoverExchangePage } from "./exchangeCatalog";
import { extensionHostVersion } from "./extensionHostVersion";

describe("Tabs extension host version", () => {
  it("keeps Tabs 2 extensions visible when launched by Electron 44 in development", async () => {
    const getVersion = vi.fn(() => "44.1.0");
    const version = extensionHostVersion({ isPackaged: false, getVersion });
    expect(version).toBe(desktopPackage.version);
    expect(getVersion).not.toHaveBeenCalled();
    const origin = "https://exchange.example";
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const response = new Response(
        JSON.stringify({
          extensions: [
            {
              namespace: "panicmako",
              name: "relay",
              version: "0.1.0",
              digest: "a".repeat(64),
              verified: false,
              manifest: {
                manifestVersion: 1,
                publisher: "panicmako",
                name: "relay",
                version: "0.1.0",
                displayName: "Relay",
                description: "Project notes",
                engines: { tabs: ">=2.0.0 <3.0.0", api: "^1.6.0" },
                capabilities: [],
                contributes: {
                  tools: [{ id: "notebook", label: "Relay", entry: "dist/index.html" }],
                },
              },
            },
          ],
          nextCursor: null,
        }),
        { headers: { "content-type": "application/json" } },
      );
      Object.defineProperty(response, "url", { value: String(input) });
      return response;
    });
    const page = await discoverExchangePage(origin, version, "", null, fetcher);
    expect(page.listings.map((listing) => listing.id)).toEqual(["panicmako.relay"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses the actual installed release version in packaged builds", () => {
    expect(extensionHostVersion({ isPackaged: true, getVersion: () => "2.1.0" })).toBe("2.1.0");
  });
});
