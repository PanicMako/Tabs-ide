import { mkdir, writeFile } from "node:fs/promises";
import {
  GITHUB_API_URL,
  REPO,
  RELEASES_URL,
  platforms,
  pickAsset,
  validateRelease,
  selectDownloadRelease,
  releaseChannel,
} from "../src/lib/releases";
import { parseAndVerifyMacPreviewManifest } from "../../desktop/src/macPreviewUpdater";
import { resolveReleaseNotes } from "../src/lib/release-note-content";
const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
async function get(url: string) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  return res.json();
}
const all = await get(`${GITHUB_API_URL}?per_page=100`);
if (!Array.isArray(all)) throw new Error("Invalid release history");
const publicReleases = all.flatMap((release) => {
  try {
    return [validateRelease(release)];
  } catch {
    return [];
  }
});
const latest = selectDownloadRelease(publicReleases);
if (!latest) throw new Error("No complete stable or public-beta release is available");
for (const platform of platforms)
  if (!pickAsset(latest, platform.id)) throw new Error(`Latest release missing ${platform.label}`);
for (const name of [
  "latest.yml",
  "latest-linux.yml",
  ...(latest.prerelease ? ["beta.yml", "beta-linux.yml"] : []),
]) {
  const asset = latest.assets.find((a) => a.name === name);
  if (!asset) throw new Error(`Missing updater manifest: ${name}`);
  const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Cannot fetch ${name}: ${response.status}`);
  const manifest = await response.text();
  const version = manifest.match(/^version:\s*['"]?([^\s'"]+)/m)?.[1];
  if (version !== latest.tag_name.replace(/^v/, "")) throw new Error(`${name} version mismatch`);
  const paths = [...manifest.matchAll(/^\s*(?:-\s*)?(?:url|path):\s*['"]?([^\s'"]+)/gm)].map(
    (m) => m[1],
  );
  if (!paths.length || paths.some((path) => !latest.assets.some((a) => a.name === path)))
    throw new Error(`${name} references missing installers`);
}
const manifestAsset = latest.assets.find((a) => a.name === "tabs-mac-preview-update.json")!;
const signatureAsset = latest.assets.find((a) => a.name === "tabs-mac-preview-update.json.sig")!;
const [manifestResponse, signatureResponse] = await Promise.all([
  fetch(manifestAsset.browser_download_url, { signal: AbortSignal.timeout(15000) }),
  fetch(signatureAsset.browser_download_url, { signal: AbortSignal.timeout(15000) }),
]);
if (!manifestResponse.ok || !signatureResponse.ok)
  throw new Error("Cannot fetch signed macOS update metadata");
const manifest = parseAndVerifyMacPreviewManifest(
  Buffer.from(await manifestResponse.arrayBuffer()),
  await signatureResponse.text(),
  REPO,
);
if (manifest.version !== latest.tag_name.replace(/^v/, ""))
  throw new Error("macOS update version mismatch");
for (const arch of ["arm64", "x64"] as const) {
  if (
    manifest.assets[arch].name !== `Tabs-${manifest.version}-${arch}.zip` ||
    !latest.assets.some((a) => a.name === manifest.assets[arch].name)
  ) {
    throw new Error(`macOS ${arch} update references a missing or incorrect ZIP`);
  }
}
const history = publicReleases
  .filter((r) => r.tag_name !== latest.tag_name)
  .slice(0, 4)
  .map(validateRelease);
const sanitized = [latest, ...history].map((r) => ({
  tag_name: r.tag_name,
  prerelease: r.prerelease === true,
  channel: releaseChannel(r),
  name: r.name ?? r.tag_name,
  published_at: r.published_at,
  body: resolveReleaseNotes(r.tag_name, r.body),
  html_url: r.html_url,
  assets: r.assets.map((a) => ({ name: a.name, browser_download_url: a.browser_download_url })),
}));
const releaseData = JSON.stringify(sanitized, null, 2) + "\n";
const publicData = new URL("../public/releases.json", import.meta.url);
await mkdir(new URL("../public/", import.meta.url), { recursive: true });
await Promise.all([
  writeFile(new URL("../src/data/releases.json", import.meta.url), releaseData),
  writeFile(publicData, releaseData),
]);
console.log(
  `Synced ${latest.tag_name} from ${RELEASES_URL}; all four installers and Windows/Linux manifests verified.`,
);
