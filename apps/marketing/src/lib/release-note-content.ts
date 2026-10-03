import { changelogData } from "../data/changelogData";

const manualReleaseNotes: Record<string, string> = {
  "v1.3.5": `## Antigravity protocol, collaborative browser engine, PR stacks, and streaming performance

Tabs v1.3.5 introduces full Antigravity protocol integration, an advanced browser engine with isolated profiles and session import, GitHub pull request stack management, and significant performance optimizations for streaming markdown and syntax highlighting.

### What changed

- **Antigravity protocol integration**: Added native Antigravity protocol support with interactive approval options, optimized server logging, and resilient provider streams.
- **Collaborative browser engine**: Implemented real-browser session and cookie import, profile-scoped permissions, passkey capability reporting, CDP operation serialization, human takeover preemption, side-by-side comparison replay, and refined custom tab controls.
- **Pull request stacks & reviews**: Manage and navigate GitHub PR stacks directly from Tabs, link agent threads to PRs, inspect status checks and metadata, view inline review annotations, and edit PRs with provider awareness.
- **Streaming & timeline performance**: Dramatically improved streaming responsiveness with incremental markdown parsing, resumable incremental syntax highlighting, DOM stabilization for streaming code lines, and bounded live timeline rendering.
- **Settings & workspace resilience**: Split heavyweight settings sections into lazy loading panels, made configuration persistence failures recoverable, added keybinding configuration, and preserved per-project active tools across navigation.
- **Composer & chat enhancements**: Added a full prompt stashing workflow, structured workspace file references with review context, assistant citations, and response quoting.

### Upgrade notes

- Seamless update for all macOS (Apple Silicon & Intel), Windows x64, and Linux x64 installations.`,
  "v1.3.4": `## Toast notifications over native views, clean activity rail, and heartbeat optimization

Tabs v1.3.4 ensures toasts and notifications remain visible over embedded editor and browser surfaces, cleans up auxiliary items in the Code activity rail, and eliminates background heartbeat latency warnings.

### What changed

- **Notification visibility over native views**: Embedded Code-OSS, browser preview, and testing web contents views now temporarily suspend when toasts and notification dialogs are active, ensuring alerts are never occluded underneath native surfaces.
- **Clean Code activity rail**: Filtered out auxiliary bar items from the primary activity bar to keep custom extensions and assistants organized without cluttering main rail navigation.
- **Background heartbeat optimization**: Excluded routine client activity and host power state lease heartbeats from slow RPC latency tracking, avoiding spurious slow request alerts.
- **Concurrency control for activity reporting**: Prevented concurrent overlapping activity lease requests during bursts of user interactions.
- **Website & release CI improvements**: Enhanced production website deployment workflows with rootDirectory-aware Vercel artifact packaging and automated deployment verification.

### Upgrade notes

- Seamless update for all macOS (Apple Silicon & Intel), Windows x64, and Linux x64 installations.`,
  "v1.3.3": `## Workspace skills, native preview controls, and composer attachments

Tabs v1.3.3 delivers workspace-specific skill discovery and dispatch, direct browser preview controls, file attachments, and progressive desktop startup stability.

### What changed

- **Workspace skills & slash commands**: Discover and dispatch directory-aware skills for Claude, Cursor, Codex, OpenCode, Antigravity, and Grok with ranked fuzzy search and source badges.
- **Collaborative browser preview**: Added direct viewport resize handles, picture-in-picture, dark/light appearance emulation, per-session audio controls, persistent navigation history, and active session clearing.
- **Composer & attachments**: Added support for general file attachments, persistent prompt stashing, mention preservation when pasting prompts, and dismissible provider warnings.
- **Workbench & desktop stability**: Progressive Code-OSS workbench startup, secondary sidebar and auxiliary bar extension support, workbench preservation across remounts, and cross-environment state storage isolation.
- **Notifications & performance**: Passive toast deduplication window, suppression of replayed keybindings alerts, and deferred native editor services.

### Upgrade notes

- Seamless update for all macOS (Apple Silicon & Intel), Windows x64, and Linux x64 installations.`,
  "v1.3.2": `## A steadier embedded editor

This release focuses on making the shipped desktop workspace more dependable.

### What changed

- Stabilized the embedded Code OSS host and its startup path in the desktop app.
- Fixed a TypeScript declaration issue in the web application's atom registry so release validation can complete reliably.

### Release scope

This is a stability release. It does not add a new end-user workflow.`,
};

function isComparisonOnly(body: string | null): boolean {
  return Boolean(
    body &&
    /^\s*\*\*Full Changelog\*\*:\s*https:\/\/github\.com\/PanicMako\/Tabs-ide\/compare\/v?\d+\.\d+\.\d+\.\.\.v?\d+\.\d+\.\d+\s*$/i.test(
      body,
    ),
  );
}

function legacyReleaseNotes(tag: string): string | null {
  const release = changelogData.find((item) => item.tag === tag);
  if (!release) return null;

  const categories = release.categories
    .map(
      (category) =>
        `### ${category.title}\n\n${category.items.map((item) => `- ${item}`).join("\n")}`,
    )
    .join("\n\n");
  return `## ${release.title}\n\n${release.summary}\n\n### Highlights\n\n${release.highlights.map((item) => `- ${item}`).join("\n")}${categories ? `\n\n${categories}` : ""}`;
}

/**
 * GitHub's generated "Full Changelog" link is useful context but not release notes.
 * Prefer the author-written release body; retain curated notes for existing releases
 * published before the manual-notes workflow was introduced.
 */
export function resolveReleaseNotes(tag: string, body: string | null): string {
  if (isComparisonOnly(body))
    return (
      manualReleaseNotes[tag] ??
      legacyReleaseNotes(tag) ??
      "Release notes were not recorded for this version."
    );
  return (
    body?.trim() || manualReleaseNotes[tag] || "Release notes were not recorded for this version."
  );
}
