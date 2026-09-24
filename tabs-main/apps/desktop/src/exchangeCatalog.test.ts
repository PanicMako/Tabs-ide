import { describe, expect, it, vi } from "vitest";
import {
  configuredExchangeOrigin,
  discoverExchangeExtensions,
  discoverExchangeVersions,
} from "./exchangeCatalog";

const origin = "https://exchange.tabs.example";
const manifest = {
  manifestVersion: 1,
  publisher: "acme",
  name: "dashboard",
  version: "1.0.0",
  displayName: "Dashboard",
  description: "Example tool",
  releaseNotes: "A safer dashboard",
  sourceUrl: "https://github.com/acme/dashboard",
  supportUrl: "https://acme.example/help",
  privacyUrl: "https://acme.example/privacy",
  engines: { tabs: ">=1.3.0 <2.0.0" },
  contributes: { tools: [{ id: "main", label: "Main", entry: "dist/index.html" }] },
};

function response(body: unknown, url = `${origin}/v1/extensions?q=&limit=30`): Response {
  const result = new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(result, "url", { value: url });
  return result;
}

describe("Exchange catalog client", () => {
  it("sorts compatible versions and rejects mismatched exact-identity responses", async () => {
    const versionUrl = `${origin}/v1/extensions/acme/dashboard`;
    const release = (version: string) => ({
      namespace: "acme",
      name: "dashboard",
      version,
      digest: "a".repeat(64),
      verified: true,
      manifest: { ...manifest, version },
    });
    const versions = await discoverExchangeVersions(
      origin,
      "1.3.17",
      "acme",
      "dashboard",
      async () => response({ versions: [release("1.1.0"), release("1.10.0")] }, versionUrl),
    );
    expect(versions.map((item) => item.version)).toEqual(["1.10.0", "1.1.0"]);
    await expect(
      discoverExchangeVersions(origin, "1.3.17", "acme", "dashboard", async () =>
        response({ versions: [{ ...release("1.1.0"), name: "other" }] }, versionUrl),
      ),
    ).rejects.toThrow(/invalid release/);
  });
  it("requires a clean HTTPS origin outside desktop development", () => {
    expect(configuredExchangeOrigin(origin, false)).toBe(origin);
    expect(configuredExchangeOrigin("http://localhost:8787", true)).toBe("http://localhost:8787");
    expect(configuredExchangeOrigin("http://localhost:8787", false)).toBeNull();
    expect(configuredExchangeOrigin("https://user:pass@exchange.tabs.example", false)).toBeNull();
    expect(configuredExchangeOrigin("https://exchange.tabs.example/path", false)).toBeNull();
  });

  it("returns only compatible, identity-matched approved listings", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      response({
        extensions: [
          {
            namespace: "acme",
            name: "dashboard",
            version: "1.0.0",
            digest: "a".repeat(64),
            verified: true,
            manifest,
          },
        ],
      }),
    );
    const results = await discoverExchangeExtensions(origin, "1.3.17", "", fetcher);
    expect(results).toMatchObject([
      {
        id: "acme.dashboard",
        verifiedPublisher: true,
        releaseNotes: "A safer dashboard",
        sourceUrl: "https://github.com/acme/dashboard",
        tabsCompatibility: ">=1.3.0 <2.0.0",
        capabilities: [],
      },
    ]);
    expect(fetcher.mock.calls).toHaveLength(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
  });

  it("rejects redirect destinations and spoofed identities", async () => {
    await expect(
      discoverExchangeExtensions(origin, "1.3.17", "", async () =>
        response({ extensions: [] }, "https://other.example/v1/extensions"),
      ),
    ).rejects.toThrow(/changed origin/);
    await expect(
      discoverExchangeExtensions(origin, "1.3.17", "", async () =>
        response({
          extensions: [
            {
              namespace: "other",
              name: "dashboard",
              version: "1.0.0",
              digest: "a".repeat(64),
              verified: false,
              manifest,
            },
          ],
        }),
      ),
    ).rejects.toThrow(/identity/);
  });

  it("rejects an oversized catalog even when headers omit the length", async () => {
    await expect(
      discoverExchangeExtensions(origin, "1.3.17", "", async () =>
        response({ extensions: [], padding: "x".repeat(1024 * 1024) }),
      ),
    ).rejects.toThrow(/too large/);
  });
});
