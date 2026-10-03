export const REPO = "PanicMako/Tabs-ide";
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const GITHUB_API_URL = `https://api.github.com/repos/${REPO}/releases`;
export const API_URL = "/releases.json";
const CACHE_KEY = "tabs-ide-releases-v2";
const CACHE_TTL_MS = 5 * 60 * 1000;
export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}
export interface Release {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
  published_at: string;
  name: string;
  body: string | null;
  draft?: boolean;
  prerelease?: boolean;
}
export type Platform = "mac-arm64" | "mac-x64" | "windows-x64" | "linux-x64";
export const platforms: { id: Platform; label: string; suffix: string }[] = [
  { id: "mac-arm64", label: "macOS · Apple Silicon", suffix: "-arm64.dmg" },
  { id: "mac-x64", label: "macOS · Intel", suffix: "-x64.dmg" },
  { id: "windows-x64", label: "Windows · x64", suffix: "-x64.exe" },
  { id: "linux-x64", label: "Linux · x64 AppImage", suffix: "-x86_64.AppImage" },
];
export type ReleaseChannel = "stable" | "beta";

export function releaseChannel(
  release: Pick<Release, "tag_name" | "prerelease">,
): ReleaseChannel | null {
  if (typeof release?.tag_name !== "string") return null;
  const version = "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)";
  if (new RegExp(`^v?${version}$`).test(release.tag_name))
    return release.prerelease === true ? "beta" : "stable";
  if (
    new RegExp(`^v?${version}-beta\\.(?:0|[1-9]\\d*)$`).test(release.tag_name) &&
    release.prerelease === true
  )
    return "beta";
  return null;
}

/** History may include older releases; only complete installers enter the download channel. */
export function selectDownloadRelease(releases: readonly Release[]): Release | undefined {
  return releases
    .filter((release) => {
      try {
        validateRelease(release);
        const version = release.tag_name.replace(/^v/, "");
        return (
          platforms.every((platform) => pickAsset(release, platform.id)) &&
          [
            "latest.yml",
            "latest-linux.yml",
            ...(release.prerelease ? ["beta.yml", "beta-linux.yml"] : []),
            "tabs-mac-preview-update.json",
            "tabs-mac-preview-update.json.sig",
            `Tabs-${version}-arm64.zip`,
            `Tabs-${version}-x64.zip`,
          ].every((name) => release.assets.some((asset) => asset.name === name))
        );
      } catch {
        return false;
      }
    })
    .toSorted(
      (a, b) =>
        Date.parse(b.published_at) - Date.parse(a.published_at) ||
        b.tag_name.localeCompare(a.tag_name),
    )[0];
}

export function validateRelease(data: unknown): Release {
  const r = data as Release & { draft?: boolean; prerelease?: boolean };
  if (
    !r ||
    r.draft ||
    (r.prerelease !== undefined && typeof r.prerelease !== "boolean") ||
    releaseChannel(r) === null ||
    typeof r.name !== "string" ||
    typeof r.published_at !== "string" ||
    Number.isNaN(Date.parse(r.published_at)) ||
    !(typeof r.body === "string" || r.body === null) ||
    r.html_url !== `${RELEASES_URL}/tag/${r.tag_name}` ||
    !Array.isArray(r.assets) ||
    !r.assets.every(
      (a) =>
        a !== null &&
        typeof a.name === "string" &&
        typeof a.browser_download_url === "string" &&
        a.browser_download_url.startsWith(`${RELEASES_URL}/download/${r.tag_name}/`),
    )
  ) {
    throw new Error("Invalid public release response");
  }
  return r;
}
export function pickAsset(release: Release, platform: Platform): string | null {
  const suffix = platforms.find((p) => p.id === platform)?.suffix;
  return (
    release.assets.find(
      (a) => suffix && a.name === `Tabs-${release.tag_name.replace(/^v/, "")}${suffix}`,
    )?.browser_download_url ?? null
  );
}
// Browsers cannot reliably distinguish Intel Macs from Apple Silicon Macs.
// Keep macOS on an explicit architecture chooser; never guess arm64.
export function detectPlatform(ua: string): Platform | null {
  if (/Android|iPhone|iPad|Mobile|aarch64|arm64|Windows.*ARM/i.test(ua)) return null;
  if (/Windows/i.test(ua)) return "windows-x64";
  if (/Linux.*x86_64|X11.*x86_64/i.test(ua)) return "linux-x64";
  return null;
}
export async function fetchLatestRelease(): Promise<Release> {
  const releases = await fetchAllReleases();
  const latest = selectDownloadRelease(releases);
  if (!latest) throw new Error("No complete public GitHub release is available");
  return latest;
}

interface ReleaseCache {
  data: Release[];
  timestamp: number;
}

export async function fetchAllReleases(perPage = 10): Promise<Release[]> {
  const requestedCount = Math.min(Math.max(Math.trunc(perPage), 1), 50);
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const entry = JSON.parse(cached) as ReleaseCache;
      if (
        Array.isArray(entry.data) &&
        typeof entry.timestamp === "number" &&
        Date.now() - entry.timestamp < CACHE_TTL_MS &&
        entry.data.length > 0
      ) {
        return entry.data.slice(0, requestedCount).map(validateRelease);
      }
    }
  } catch {
    sessionStorage.removeItem(CACHE_KEY);
  }

  const response = await fetch(API_URL, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Release lookup failed: ${response.status}`);

  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("Invalid release proxy response");
  const releases = payload.map(validateRelease);
  sessionStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ data: releases, timestamp: Date.now() } satisfies ReleaseCache),
  );
  return releases.slice(0, requestedCount);
}
