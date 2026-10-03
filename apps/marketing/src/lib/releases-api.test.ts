import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../api/releases";

const githubRelease = {
  tag_name: "v1.3.1",
  name: "Tabs v1.3.1",
  html_url: "https://github.com/PanicMako/Tabs-ide/releases/tag/v1.3.1",
  published_at: "2026-09-05T16:47:42Z",
  body: "Release notes",
  draft: false,
  prerelease: false,
  assets: [
    {
      name: "Tabs-1.3.1-x64.exe",
      browser_download_url:
        "https://github.com/PanicMako/Tabs-ide/releases/download/v1.3.1/Tabs-1.3.1-x64.exe",
    },
    { name: "external.exe", browser_download_url: "https://example.com/external.exe" },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("release proxy", () => {
  it("accepts Vercel's relative URL and returns sanitized stable releases", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([githubRelease]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET({ method: "GET", url: "/api/releases?per_page=500" } as Request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("per_page=50");
    const payload = await response.json();
    expect(payload).toHaveLength(1);
    expect(payload[0].assets).toHaveLength(1);
    expect(payload[0]).not.toHaveProperty("draft");
  });
});
