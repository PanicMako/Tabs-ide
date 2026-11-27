import releases from "./releases.json";
import {
  pickDownload,
  downloadSuffix,
  pickOptionalAsset,
  type DownloadId,
  type OptionalPackage,
  selectDownloadRelease,
  RELEASES_URL,
  type Release,
} from "../lib/releases";

/** One source of truth for every downloads concept: builds, file names, install steps. */
const ICON = "https://cdn.jsdelivr.net/gh/devicons/devicon@2.16.0/icons";
const latest = (selectDownloadRelease(releases as Release[]) ?? releases[0]) as Release;

export const version = latest.tag_name;
export const releaseDate = new Date(latest.published_at).toLocaleDateString("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
export const releaseUrl = latest.html_url;
export { RELEASES_URL };

export const fileName = (id: DownloadId) => `Tabs-${version.replace(/^v/, "")}${downloadSuffix(id)}`;
export const assetUrl = (id: DownloadId) => pickDownload(latest, id) ?? latest.html_url;

/** Microsoft Store listing (product "Tabs IDE"). The Store installs and updates its own copy. */
export const MICROSOFT_STORE_ID = "9P8P9XTGZQM9";
export const microsoftStoreUrl = `https://apps.microsoft.com/detail/${MICROSOFT_STORE_ID}`;
/** Opens the Store app's product page directly; only meaningful on Windows. */
export const microsoftStoreAppUrl = `ms-windows-store://pdp/?productid=${MICROSOFT_STORE_ID}`;

/**
 * Debian/Ubuntu package link; null for a release that predates the .deb. When
 * present it is a regular download card; updates are manual.
 */
export const debDownload = pickOptionalAsset(latest, "linux-x64-deb");
const DEB_READY_SUB = ".deb package";

export type FamilyId = "mac" | "win" | "linux";
export interface Build {
  id: DownloadId;
  label: string;
  sub: string;
  file: string;
  href: string;
}
/** A secondary way to get the build: a store listing or an extra package. */
export interface AltLink {
  label: string;
  sub: string;
  href: string;
  cta: string;
  /** Set for optional release packages so the live release check can update the link. */
  pkg?: OptionalPackage;
  /** Shown instead of `sub` once the live release carries the package. */
  readySub?: string;
  /** Native app link used instead of `href` when the visitor is on Windows. */
  windowsHref?: string;
}
export interface Family {
  id: FamilyId;
  name: string;
  icon: string;
  line: string;
  reqs: string[];
  shot: string;
  chrome: FamilyId;
  builds: Build[];
  /** Store listings and extra packages shown under the direct downloads. */
  alts?: AltLink[];
  steps: string[];
}

const build = (id: DownloadId, label: string, sub: string): Build => ({
  id,
  label,
  sub,
  file: fileName(id),
  href: assetUrl(id),
});

export const families: Family[] = [
  {
    id: "mac",
    name: "macOS",
    icon: `${ICON}/apple/apple-original.svg`,
    line: "Native builds for both kinds of Mac.",
    reqs: ["Apple Silicon or Intel", ".dmg"],
    shot: "/product/agents-new-light.webp",
    chrome: "mac",
    builds: [
      build("mac-arm64", "Apple Silicon", "M1 and newer"),
      build("mac-x64", "Intel", "Intel-based Macs"),
    ],
    steps: [
      "Open the .dmg and drag Tabs into Applications.",
      "The beta isn't notarized yet. If macOS blocks it, open System Settings → Privacy & Security and choose Open Anyway.",
      'Not sure which Mac you have? Apple menu → About This Mac. "Chip: Apple M…" means Apple Silicon.',
    ],
  },
  {
    id: "win",
    name: "Windows",
    icon: `${ICON}/windows11/windows11-original.svg`,
    line: "The installer, or the Microsoft Store.",
    reqs: ["x64", ".exe installer", "Microsoft Store"],
    shot: "/product/code-light.png",
    chrome: "win",
    builds: [build("windows-x64", "Windows x64", "Installer")],
    alts: [
      { label: "Microsoft Store", sub: "Installed and updated by the Store", href: microsoftStoreUrl, windowsHref: microsoftStoreAppUrl, cta: "Get it from the Store ↗" },
    ],
    steps: [
      "Run the .exe installer, or install Tabs IDE from the Microsoft Store.",
      "If SmartScreen warns about the installer, choose More info → Run anyway if you trust the download. The Store copy skips this.",
      "Installer copies check for updates and ask before restarting. Store copies update through the Store.",
    ],
  },
  {
    id: "linux",
    name: "Linux",
    icon: `${ICON}/linux/linux-original.svg`,
    line: "A single AppImage, or a .deb for Debian and Ubuntu.",
    reqs: ["x64", ".AppImage", ".deb"],
    shot: "/product/git-dark.png",
    chrome: "linux",
    builds: [
      build("linux-x64", "Linux x64", "AppImage"),
      ...(debDownload ? [build("linux-x64-deb", "Debian / Ubuntu", DEB_READY_SUB)] : []),
    ],
    // Only for a release that predates the .deb: the live release check turns
    // this row into a direct download once a newer release carries it.
    alts: debDownload
      ? undefined
      : [
          {
            label: "Debian / Ubuntu",
            sub: "The .deb arrives with the next release",
            readySub: DEB_READY_SUB,
            href: RELEASES_URL,
            cta: "See releases ↗",
            pkg: "linux-x64-deb",
          },
        ],
    steps: [
      "Save the .AppImage to a folder you can write to, or install the .deb with sudo apt install ./Tabs-*-amd64.deb.",
      "For the AppImage, allow it to run as a program, or run chmod +x Tabs-*.AppImage.",
      "The AppImage checks for updates on its own. Update a .deb install by installing the newer .deb.",
    ],
  },
];

export const firstMinutes = [
  {
    n: "01",
    title: "Open a folder",
    body: "Pick a project you already work on, create one, or paste a Git URL to clone it into a new tab.",
  },
  {
    n: "02",
    title: "Connect an agent",
    body: "Open Settings → Providers and follow the setup for Claude, Codex, Cursor or another supported agent.",
  },
  {
    n: "03",
    title: "Ask something small",
    body: 'Open Agents and ask "What\'s in this project, and where should I start?" Follow along in Code.',
  },
];

export const trust = [
  {
    k: "Updates",
    v: "Windows and Linux installs check for updates in the app. The macOS preview channel verifies each signed update before installing it.",
  },
  { k: "Open source", v: "Read the code, file issues and follow releases on GitHub." },
  {
    k: "Your agents",
    v: "Tabs uses your provider's own sign-in or key. No Tabs subscription, no usage markup.",
  },
];

export const thanks = {
  head: "Thanks for downloading Tabs.",
  body: "Your file should start in a moment. If it doesn’t,",
  link: "open the latest release on GitHub",
};
