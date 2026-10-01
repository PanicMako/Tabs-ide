export const REPO = "PanicMako/Tabs-ide";
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const GITHUB_API_URL = `https://api.github.com/repos/${REPO}/releases`;
export const API_URL = "/releases.json";
const CACHE_KEY = "tabs-ide-releases-v1";
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
export function validateRelease(data: unknown): Release {
  const r = data as Release & { draft?: boolean; prerelease?: boolean };
  if (
    !r ||
    r.draft ||
    r.prerelease ||
    !/^v?\d+\.\d+\.\d+$/.test(r.tag_name) ||
    typeof r.name !== "string" ||
    typeof r.published_at !== "string" ||
    Number.isNaN(Date.parse(r.published_at)) ||
    !(typeof r.body === "string" || r.body === null) ||
    r.html_url !== `${RELEASES_URL}/tag/${r.tag_name}` ||
    !Array.isArray(r.assets) ||
    !r.assets.every(
      (a) =>
        typeof a.name === "string" &&
        typeof a.browser_download_url === "string" &&
        a.browser_download_url.startsWith(`${RELEASES_URL}/download/${r.tag_name}/`),
    )
  ) {
    throw new Error("Invalid stable release response");
  }
  return r;
}
export function pickAsset(release: Release, platform: Platform): string | null {
  const suffix = platforms.find((p) => p.id === platform)?.suffix;
  return (
    release.assets.find((a) => suffix && a.name.endsWith(suffix))?.browser_download_url ?? null
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
  const latest = releases[0];
  if (!latest) throw new Error("No stable GitHub release is available");
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
