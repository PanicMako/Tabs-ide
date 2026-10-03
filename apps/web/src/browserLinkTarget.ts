import type { BrowserLinkTarget, ProjectId } from "@tabs/contracts";
import { workspaceShellActions } from "./state/workspaceShell";

export function isWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function resolveBrowserLinkTarget(input: {
  url: string;
  preference: BrowserLinkTarget;
  projectId: ProjectId | null;
  metaKey: boolean;
  ctrlKey: boolean;
}): BrowserLinkTarget {
  if (input.metaKey || input.ctrlKey) return "system";
  if (input.preference !== "app" || !input.projectId || !isWebUrl(input.url)) return "system";
  return "app";
}

export function openLinkInIntegratedBrowser(projectId: ProjectId, url: string): void {
  workspaceShellActions.setBrowserCurrentUrl(projectId, url, "browser");
  workspaceShellActions.setActiveTool(projectId, "browser");
}
