import {
  type EnvironmentId,
  type ProjectId,
  resolveBrowserPartition,
  type ThreadId,
} from "@tabs/contracts";
import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import { useRightPanelStore } from "~/stores/rightPanelStore";
import { resolveProjectTools, useWorkspaceShellStore } from "~/workspaceShellStore";
import { projectBrowserSessionId } from "./projectToolAttachmentTargets";

type BrowserLocation =
  | { kind: "companion"; id: string }
  | { kind: "project-tool"; id: string; partition: string };

export function findBrowserLocation(
  scope: string,
  projectId: ProjectId,
  tabId: string,
  profileId: string,
  { allowInactiveProject = false }: { allowInactiveProject?: boolean } = {},
): BrowserLocation | undefined {
  if (tabId.startsWith("agents-surface-")) {
    const tab = useCompanionSurfaceStore
      .getState()
      .workspaces[scope]?.tabs.find(
        (surface) =>
          surface.kind === "browser" &&
          `agents-surface-${surface.id}` === tabId &&
          (surface.profileId ?? "default") === profileId,
      );
    return tab && { kind: "companion", id: tab.id };
  }

  const workspace = useWorkspaceShellStore.getState();
  if (
    workspace.session.activeProjectId !== projectId &&
    !(allowInactiveProject && workspace.session.openProjectIds.includes(projectId))
  )
    return;
  const settings = workspace.projectSettingsByProjectId[projectId];
  if (!settings) return;
  const [tool, ...duplicates] = resolveProjectTools(settings).filter(
    (candidate) => projectBrowserSessionId(candidate) === tabId,
  );
  if (!tool || duplicates.length > 0) return;
  const browserSettings =
    tool.kind === "browser"
      ? settings.browser
      : settings.customEmbeds.find((embed) => embed.id === tool.customEmbedId);
  if (!browserSettings) return;
  const configuredProfile =
    browserSettings.partitionMode === "profile"
      ? browserSettings.partitionProfile?.trim() || "default"
      : "default";
  if (configuredProfile !== profileId) return;
  const partition = resolveBrowserPartition({
    ...browserSettings,
    projectId,
    sessionId: tabId,
  });
  return { kind: "project-tool", id: tool.id, partition };
}

export async function revealSavedBrowserResult({
  bridge,
  environmentId,
  threadId,
  projectId,
  tabId,
  profileId,
  operation,
  input,
  validateUrl,
  restoreGuest = true,
  invalidResultMessage,
  isCurrent,
}: {
  bridge: NonNullable<Window["desktopBridge"]>;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  projectId: ProjectId;
  tabId: string;
  profileId: string;
  operation:
    | "enterFigmaCanvasResult"
    | "enterDeviceComparisonDraft"
    | "enterQuickActionFileResult"
    | "enterQuickActionPause";
  input: unknown;
  validateUrl: (url: string, originalUrl: string | null | undefined) => boolean;
  restoreGuest?: boolean;
  invalidResultMessage: string;
  isCurrent: () => boolean;
}) {
  const scope = `${environmentId}:${threadId}`;
  const unavailable = () =>
    new Error("The original browser tab or profile is unavailable in this thread.");
  if (!isCurrent()) return;
  const getLocation = () => findBrowserLocation(scope, projectId, tabId, profileId);
  const original = getLocation();
  if (!original) throw unavailable();
  const requireOriginalLocation = () => {
    const current = getLocation();
    if (
      !current ||
      current.kind !== original.kind ||
      current.id !== original.id ||
      (current.kind === "project-tool" &&
        original.kind === "project-tool" &&
        current.partition !== original.partition)
    )
      throw unavailable();
  };

  const target = { projectId, sessionId: tabId };
  let state = await bridge.getBrowserSessionState(target);
  if (!isCurrent()) return;
  requireOriginalLocation();
  if (restoreGuest && !state.instanceId && !state.currentUrl) {
    // Restore a blank guest in the saved tab's partition before native verification.
    await bridge.ensureBrowserSession({
      ...target,
      ...(original.kind === "companion" ? { profileId } : { partition: original.partition }),
      initialUrl: "",
    });
    if (!isCurrent()) return;
    state = await bridge.getBrowserSessionState(target);
    if (!isCurrent()) return;
    requireOriginalLocation();
  }
  if (
    state.projectId !== projectId ||
    state.sessionId !== tabId ||
    (!state.instanceId && !state.currentUrl) ||
    (state.profileId ?? "default") !== profileId
  )
    throw unavailable();

  const reopened = await bridge.runBrowserAutomation({
    ...target,
    source: "human",
    taskId: threadId,
    operation,
    input,
  });
  if (!isCurrent()) return;
  requireOriginalLocation();
  const url =
    reopened && typeof reopened === "object" && "url" in reopened ? reopened.url : undefined;
  if (typeof url !== "string" || !validateUrl(url, state.currentUrl))
    throw new Error(invalidResultMessage);

  if (original.kind === "companion") {
    const surfaces = useCompanionSurfaceStore.getState();
    surfaces.update(scope, original.id, { url });
    surfaces.activate(scope, original.id);
    useRightPanelStore.getState().openPanel("browser");
  } else {
    const workspace = useWorkspaceShellStore.getState();
    if (tabId === "browser") workspace.setBrowserCurrentUrl(projectId, url, tabId);
    else workspace.setBrowserSessionUrl(projectId, tabId, url);
    workspace.setActiveTool(projectId, original.id);
  }
}
