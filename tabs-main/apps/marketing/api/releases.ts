const GITHUB_RELEASES_URL = "https://api.github.com/repos/PanicMako/Tabs-ide/releases";
const RELEASES_URL = "https://github.com/PanicMako/Tabs-ide/releases";

interface GitHubAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  body?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
}

// Keep the Vercel function self-contained. Vercel compiles files in `api/` as
// independent functions, so importing application source can leave an
// unresolved runtime module in the generated Node function.
function resolveReleaseNotes(body: string | null): string {
  if (
    body &&
    /^\s*\*\*Full Changelog\*\*:\s*https:\/\/github\.com\/PanicMako\/Tabs-ide\/compare\/v?\d+\.\d+\.\d+\.\.\.v?\d+\.\d+\.\d+\s*$/i.test(
      body,
    )
  ) {
    return "This maintenance release is documented in the linked GitHub comparison.";
  }
  return body?.trim() || "Release notes were not recorded for this version.";
}

function sanitizeRelease(value: unknown) {
  const release = value as GitHubRelease;
  if (
    !release ||
    release.draft === true ||
    typeof release.tag_name !== "string" ||
    !(
      release.prerelease === true
        ? /^v?\d+\.\d+\.\d+(?:-beta\.(?:0|[1-9]\d*))?$/
        : /^v?\d+\.\d+\.\d+$/
    ).test(release.tag_name) ||
    release.html_url !== `${RELEASES_URL}/tag/${release.tag_name}` ||
    typeof release.name !== "string" ||
    typeof release.published_at !== "string" ||
    !(typeof release.body === "string" || release.body === null) ||
    !Array.isArray(release.assets)
  ) {
    return null;
  }

  const assetPrefix = `${RELEASES_URL}/download/${release.tag_name}/`;
  const assets = release.assets.flatMap((value: GitHubAsset) =>
    typeof value?.name === "string" &&
    typeof value.browser_download_url === "string" &&
    value.browser_download_url.startsWith(assetPrefix)
      ? [{ name: value.name, browser_download_url: value.browser_download_url }]
      : [],
  );

  return {
    tag_name: release.tag_name,
    prerelease: release.prerelease === true,
    name: release.name,
    html_url: release.html_url,
    published_at: release.published_at,
    body: resolveReleaseNotes(release.body),
    assets,
  };
}

export async function GET(request: Request): Promise<Response> {
  // Vercel's Node runtime supplies a relative request URL; the base is only used for parsing.
  const requested = Number(
    new URL(request.url, "https://tabs.local").searchParams.get("per_page") ?? "10",
  );
  const perPage = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), 50)
    : 10;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Tabs-Marketing-Site",
  };
  const token = process.env.GITHUB_PAT?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await fetch(`${GITHUB_RELEASES_URL}?per_page=${perPage}`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return Response.json(
        { error: "Release service unavailable" },
        { status: 502, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const payload = await response.json();
    const releases = Array.isArray(payload) ? payload.map(sanitizeRelease).filter(Boolean) : [];
    if (releases.length === 0) throw new Error("GitHub returned no valid public releases");

    return Response.json(releases, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        "CDN-Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return Response.json(
      { error: "Release service unavailable" },
      { status: 502, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
