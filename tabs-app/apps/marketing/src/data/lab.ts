import { agentProviders } from "./agentProviders";

/** Copy shared by every lab concept, grounded in what ships in Tabs today. */
export const tools = [
  {
    id: "code",
    name: "Code",
    kicker: "Code OSS editor",
    line: "A real Code OSS editor with native file access and VS Code extensions.",
    shot: "code",
  },
  {
    id: "agents",
    name: "Agents",
    kicker: "Project conversations",
    line: "Talk to Claude, Codex, Cursor and more about the project that's open.",
    shot: "agents",
  },
  {
    id: "dock",
    name: "Dock",
    kicker: "Presets and services",
    line: "Your dev servers and CLIs, side by side. Save install, start and preview as a preset and run it from one button.",
    shot: "launchpad",
  },
  {
    id: "git",
    name: "Git",
    kicker: "Visual Git",
    line: "Review diffs, branches, commits and pull requests without leaving the tab.",
    shot: "git",
  },
  {
    id: "browser",
    name: "Browser",
    kicker: "Built-in browser",
    line: "Preview localhost or pin Figma, docs and issue boards to the toolbar.",
    shot: "browser",
  },
] as const;

/** Same provider colors the app uses in Settings → Usage (apps/web/src/components/settings/usage/UsageTab.tsx). */
const providerColor: Record<string, string> = {
  codex: "#10a37f", claude: "#d97706", cursor: "#6366f1", copilot: "#3b82f6", grok: "#8b5cf6",
  opencode: "#06b6d4", "factory-droid": "#64748b", kilo: "#ec4899", antigravity: "#f43f5e", openrouter: "#14b8a6",
};
export const agents = agentProviders.map((a) => ({ ...a, logo: `/providers/${a.id}.svg`, color: providerColor[a.id] ?? "#0e2af3" }));

export const projects = [
  { id: "studio", name: "studio-site", label: "The studio site", hue: "#0E2AF3", file: "homepage.tsx" },
  { id: "product", name: "next-product", label: "The next product", hue: "#FF5B2E", file: "billing.ts" },
  { id: "weekend", name: "weekend-idea", label: "The weekend idea", hue: "#18B47B", file: "main.rs" },
] as const;

export const platforms = ["macOS", "Windows", "Linux"] as const;

export const links = {
  download: "/downloads",
  changelog: "/changelog",
  github: "https://github.com/PanicMako/Tabs-ide",
  exchange: "https://exchange.buildwithtabs.com",
  community: "/community",
};
