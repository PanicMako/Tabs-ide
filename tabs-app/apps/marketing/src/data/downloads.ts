import releases from "./releases.json";
import { platforms, pickAsset, selectDownloadRelease, RELEASES_URL, type Platform, type Release } from "../lib/releases";

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

export const fileName = (id: Platform) =>
  `Tabs-${version.replace(/^v/, "")}${platforms.find((p) => p.id === id)!.suffix}`;
export const assetUrl = (id: Platform) => pickAsset(latest, id) ?? latest.html_url;

export type FamilyId = "mac" | "win" | "linux";
export interface Build {
  id: Platform;
  label: string;
  sub: string;
  file: string;
  href: string;
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
  steps: string[];
}

const build = (id: Platform, label: string, sub: string): Build => ({
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
      "Not sure which Mac you have? Apple menu → About This Mac. \"Chip: Apple M…\" means Apple Silicon.",
    ],
  },
  {
    id: "win",
    name: "Windows",
    icon: `${ICON}/windows11/windows11-original.svg`,
    line: "One installer, with updates built in.",
    reqs: ["x64", ".exe installer"],
    shot: "/product/code-light.png",
    chrome: "win",
    builds: [build("windows-x64", "Windows x64", "Installer")],
    steps: [
      "Run the .exe installer.",
      "If SmartScreen shows a warning, choose More info → Run anyway if you trust the download.",
      "Installed copies check for updates and ask before restarting.",
    ],
  },
  {
    id: "linux",
    name: "Linux",
    icon: `${ICON}/linux/linux-original.svg`,
    line: "A single AppImage. Nothing to install.",
    reqs: ["x64", ".AppImage"],
    shot: "/product/git-dark.png",
    chrome: "linux",
    builds: [build("linux-x64", "Linux x64", "AppImage")],
    steps: [
      "Save the .AppImage to a folder you can write to.",
      "Allow it to run as a program, or run chmod +x Tabs-*.AppImage.",
      "Start it. The AppImage checks for updates on its own.",
    ],
  },
];

export const firstMinutes = [
  { n: "01", title: "Open a folder", body: "Pick a project you already work on, create one, or paste a Git URL to clone it into a new tab." },
  { n: "02", title: "Connect an agent", body: "Open Settings → Providers and follow the setup for Claude, Codex, Cursor or another supported agent." },
  { n: "03", title: "Ask something small", body: "Open Agents and ask \"What's in this project, and where should I start?\" Follow along in Code." },
];

export const trust = [
  { k: "Updates", v: "Windows and Linux installs check for updates in the app. The macOS preview channel verifies each signed update before installing it." },
  { k: "Open source", v: "Read the code, file issues and follow releases on GitHub." },
  { k: "Your agents", v: "Tabs uses your provider's own sign-in or key. No Tabs subscription, no usage markup." },
];

export const thanks = {
  head: "Thanks for downloading Tabs.",
  body: "Your file should start in a moment. If it doesn’t,",
  link: "open the latest release on GitHub",
};
