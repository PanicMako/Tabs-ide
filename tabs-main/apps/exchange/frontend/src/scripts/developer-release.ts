export {};

interface DeveloperRelease {
  release: string;
  status: string;
  apiVersion: string;
  node: string;
  desktop: { version: string; note: string };
  bundle: { url: string; sha256: string; bytes: number };
  checksumsUrl: string;
}

const releaseStatus = document.getElementById("release-status-message")!;
const download = document.getElementById("release-download") as HTMLAnchorElement;
const checksums = document.getElementById("release-checksums") as HTMLAnchorElement;
async function loadRelease() {
  try {
    const response = await fetch("/developers/releases/manifest.json", {
      redirect: "error",
      credentials: "same-origin",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Release bundle unavailable");
    const release = (await response.json()) as DeveloperRelease;
    const assetPattern = /^\/developers\/releases\/[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{16}\//;
    if (
      release.status !== "experimental-staging" ||
      !assetPattern.test(release.bundle.url) ||
      !assetPattern.test(release.checksumsUrl) ||
      !/^[a-f0-9]{64}$/.test(release.bundle.sha256)
    )
      throw new Error("Invalid release metadata");
    releaseStatus.textContent = `API ${release.apiVersion}, Node ${release.node}. Requires Tabs ${release.desktop.version} development/testing build. ${release.desktop.note}`;
    download.href = release.bundle.url;
    download.hidden = false;
    checksums.href = release.checksumsUrl;
    checksums.hidden = false;
    document.getElementById("release-digest")!.textContent =
      `Bundle SHA-256: ${release.bundle.sha256}`;
  } catch {
    releaseStatus.textContent =
      "The developer release bundle is unavailable on this instance. Ask its operator to build the Exchange frontend; do not assume packages are published to npm.";
  }
}
void loadRelease();
