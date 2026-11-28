import {
  type EnvironmentId,
  ProjectId,
  resolveBrowserPartition,
  ThreadId,
  type DesktopBrowserSessionState,
  type DesktopInstalledExtension,
  type ProjectToolDefinition,
} from "@tabs/contracts";
import { extensionProfileForProject } from "@tabs/shared/extensions";
import { useEffect, useRef, useState } from "react";
import { isPrimaryEnvironment } from "~/connection/environmentApiRegistry";
import { extensionToolbarToolId } from "~/extensionToolbarTools";
import { appAtomRegistry } from "~/state/atomRegistry";
import { projectsAtom } from "~/state/threads";
import {
  createDefaultProjectWorkspaceSettings,
  readPersistedProjectWorkspaceSettings,
  resolveProjectTools,
  useWorkspaceShellStore,
} from "~/workspaceShellStore";
import {
  terminalAttachmentIsCurrent,
  terminalAttachmentTarget,
  type TerminalAttachmentTarget,
} from "./terminalAttachmentTargets";
import type { SurfaceLocation } from "./threadSurfaceAttachment";
import { browserHandoffAvailable, browserHandoffStatus } from "./browserHandoff";
import { revealSavedBrowserAttachment } from "./savedBrowserAttachment";
import { projectToolBinding } from "./projectToolIdentity";

function ownsProject(projectId: string, environmentId: EnvironmentId | null) {
  const projects = appAtomRegistry.get(projectsAtom).filter((project) => project.id === projectId);
  return projects.length === 1 && (projects[0]?.environmentId ?? null) === environmentId;
}

type BrowserTarget = {
  kind: "browser";
  tabId: string;
  instanceId: string;
  profileId: string;
  origin: string | null;
  pageRef?: string;
};

type ProjectToolResource =
  | BrowserTarget
  | TerminalAttachmentTarget
  | { kind: "extension"; extensionId: string; toolId: string; version: string; profileId: string };

export interface ProjectToolAttachmentTarget {
  kind: "project-tool";
  toolId: string;
  toolKind: ProjectToolDefinition["kind"];
  instanceId: string;
  resource?: ProjectToolResource;
}

export function projectBrowserSessionId(tool: ProjectToolDefinition): string | null {
  if (tool.kind === "browser") return "browser";
  if (tool.kind === "custom_embed" && tool.customEmbedId) return `custom-${tool.customEmbedId}`;
  return null;
}

export function projectBrowserAttachmentTarget(
  state: DesktopBrowserSessionState | null | undefined,
): BrowserTarget | undefined {
  if (!state?.instanceId) return undefined;
  let origin = null;
  try {
    const url = new URL(state.currentUrl ?? "");
    if (url.protocol === "https:" || url.protocol === "http:") origin = url.origin;
  } catch {
    // Empty and local pages have an instance even when there is no network origin.
  }
  return {
    kind: "browser",
    tabId: state.sessionId,
    instanceId: state.instanceId,
    profileId: state.profileId ?? "default",
    origin,
    ...(state.pageRef ? { pageRef: state.pageRef } : {}),
  };
}

export function useProjectBrowserAttachmentTargets(
  projectId: string | undefined,
  tools: readonly ProjectToolDefinition[],
) {
  const sessionIds = JSON.stringify(tools.flatMap((tool) => projectBrowserSessionId(tool) ?? []));
  const [activity, setActivity] = useState<{
    projectId: string;
    sessions: ReadonlyMap<string, string>;
  }>();
  const cache = useRef<
    { projectId: string; targets: Map<string, BrowserTarget | undefined> } | undefined
  >(undefined);
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !projectId) return;
    const targets = new Map<string, BrowserTarget | undefined>();
    cache.current = { projectId, targets };
    const requested = new Set<string>(JSON.parse(sessionIds));
    const update = (state: DesktopBrowserSessionState) => {
      targets.set(state.sessionId, projectBrowserAttachmentTarget(state));
      const label = browserHandoffAvailable(state, "browser-stop")
        ? browserHandoffStatus(state)
        : undefined;
      setActivity((current) => {
        const sessions = current?.projectId === projectId ? current.sessions : undefined;
        if (sessions?.get(state.sessionId) === label) return current;
        const next = new Map(sessions);
        if (label) next.set(state.sessionId, label);
        else next.delete(state.sessionId);
        return { projectId, sessions: next };
      });
    };
    let disposed = false;
    setActivity({ projectId, sessions: new Map() });
    const unsubscribe = bridge.onBrowserSessionState((state) => {
      if (state.projectId === projectId && requested.has(state.sessionId)) {
        update(state);
      }
    });
    for (const sessionId of requested) {
      void bridge
        .getBrowserSessionState({ projectId, sessionId })
        .then((state) => {
          if (!disposed && !targets.has(sessionId)) update(state);
        })
        .catch(() => undefined);
    }
    return () => {
      disposed = true;
      unsubscribe();
      cache.current = undefined;
    };
  }, [projectId, sessionIds]);
  return { cache, activity: activity?.projectId === projectId ? activity?.sessions : undefined };
}

function extensionTarget(
  location: SurfaceLocation,
  tool: ProjectToolDefinition,
  extensions: readonly DesktopInstalledExtension[],
): ProjectToolResource | undefined {
  if (tool.kind !== "extension" || !tool.extensionToolId) return undefined;
  const { extensionToolId } = tool;
  const extension = extensions.find(
    (item) =>
      item.id === tool.extensionId && extensionToolbarToolId(item, extensionToolId) === tool.id,
  );
  if (!extension) return undefined;
  return {
    kind: "extension",
    extensionId: extension.id,
    toolId: tool.extensionToolId,
    version: extension.digest ?? extension.manifest.version,
    profileId: extensionProfileForProject(extension.assignment, location.projectId),
  };
}

export function projectToolAttachmentTarget(
  location: SurfaceLocation,
  toolId: string,
  extensions: readonly DesktopInstalledExtension[],
  browserTargets: ReadonlyMap<string, BrowserTarget | undefined> | undefined,
): { target: ProjectToolAttachmentTarget; label: string } | null {
  const projectId = ProjectId.makeUnsafe(location.projectId);
  const store = useWorkspaceShellStore.getState();
  if (
    store.session.activeProjectId !== projectId ||
    !ownsProject(projectId, location.environmentId)
  )
    return null;
  const settings =
    store.projectSettingsByProjectId[projectId] ?? createDefaultProjectWorkspaceSettings();
  const tool = resolveProjectTools(settings, extensions, projectId).find(
    (entry) => entry.id === toolId,
  );
  if (!tool || tool.kind === "agents") return null;
  const sessionId = projectBrowserSessionId(tool);
  const browser = sessionId ? browserTargets?.get(sessionId) : undefined;
  if (
    sessionId &&
    window.desktopBridge &&
    (!isPrimaryEnvironment(location.environmentId ?? undefined) ||
      browser?.tabId !== sessionId ||
      !browser.origin)
  )
    return null;
  const resource =
    browser ??
    (tool.kind === "custom_process" && tool.terminalProcessId
      ? terminalAttachmentTarget(
          location.environmentId,
          ThreadId.makeUnsafe(`server:${projectId}:custom:${tool.terminalProcessId}`),
          tool.terminalProcessId,
        )
      : undefined) ??
    extensionTarget(location, tool, extensions);
  if (tool.kind === "custom_process" && !resource) return null;
  const instanceId = tool.attachmentInstanceId ?? crypto.randomUUID();
  if (!tool.attachmentInstanceId) trackProjectToolAttachment(projectId, tool, instanceId);
  return {
    label: tool.label,
    target: {
      kind: "project-tool",
      toolId,
      toolKind: tool.kind,
      instanceId,
      ...(resource ? { resource } : {}),
    },
  };
}

function trackProjectToolAttachment(projectId: ProjectId, tool: ProjectToolDefinition, id: string) {
  useWorkspaceShellStore.getState().upsertProjectSettings(projectId, (current) => {
    const saved = current.tools.find((entry) => entry.id === tool.id);
    const tracked = { ...(saved ?? tool), attachmentInstanceId: id };
    return {
      ...current,
      tools: saved
        ? current.tools.map((entry) => (entry.id === tool.id ? tracked : entry))
        : [...current.tools, tracked],
    };
  });
}

function readCurrentProjectSettings(location: SurfaceLocation) {
  const projectId = ProjectId.makeUnsafe(location.projectId);
  const store = useWorkspaceShellStore.getState();
  if (
    store.session.activeProjectId !== projectId ||
    !ownsProject(projectId, location.environmentId)
  )
    return null;
  return store.projectSettingsByProjectId[projectId] ?? null;
}

function readCurrentProjectTool(
  location: SurfaceLocation,
  target: Record<string, unknown>,
  extensions: readonly DesktopInstalledExtension[],
) {
  const projectId = ProjectId.makeUnsafe(location.projectId);
  const settings = readCurrentProjectSettings(location);
  if (!settings) return null;
  return (
    resolveProjectTools(settings, extensions, projectId).find(
      (tool) =>
        tool.id === target.toolId &&
        tool.kind === target.toolKind &&
        tool.attachmentInstanceId &&
        tool.attachmentInstanceId === target.instanceId,
    ) ?? null
  );
}

export function readCurrentProjectBrowserTool(
  location: SurfaceLocation,
  target: Record<string, unknown>,
  sessionId: string,
) {
  const tool = readCurrentProjectTool(location, target, []);
  return tool && projectBrowserSessionId(tool) === sessionId ? tool : null;
}

export function adoptProjectBrowserToolAttachment(
  location: SurfaceLocation,
  target: Record<string, unknown>,
  sessionId: string,
) {
  if (!isPrimaryEnvironment(location.environmentId ?? undefined)) return null;
  const projectId = ProjectId.makeUnsafe(location.projectId);
  const settings = readCurrentProjectSettings(location);
  if (!settings) return null;
  const tool = resolveProjectTools(settings, [], projectId).find(
    (entry) => entry.id === target.toolId && entry.kind === target.toolKind,
  );
  if (!tool || projectBrowserSessionId(tool) !== sessionId) return null;
  const shared = readPersistedProjectWorkspaceSettings(projectId);
  const saved = shared?.tools.find((entry) => entry.id === tool.id);
  if (
    !shared ||
    !saved?.attachmentInstanceId ||
    saved.attachmentInstanceId !== target.instanceId ||
    (tool.attachmentInstanceId && tool.attachmentInstanceId !== saved.attachmentInstanceId) ||
    projectToolBinding(settings, tool) !== projectToolBinding(shared, saved)
  )
    return null;
  if (!tool.attachmentInstanceId)
    trackProjectToolAttachment(projectId, tool, saved.attachmentInstanceId);
  return { ...tool, attachmentInstanceId: saved.attachmentInstanceId };
}

/** Reveal only the toolbar entry whose configuration and live resource match the file. */
export async function revealProjectToolAttachment(
  location: SurfaceLocation,
  target: Record<string, unknown>,
  canReveal: () => boolean,
  attachmentId?: string,
) {
  const projectId = ProjectId.makeUnsafe(location.projectId);
  const extensions =
    target.toolKind === "extension" ? ((await window.desktopBridge?.listExtensions()) ?? []) : [];
  const readCurrentTool = () => readCurrentProjectTool(location, target, extensions);
  const stale = () => new Error("The attached project tool is closed or its identity has changed.");
  const tool = readCurrentTool();
  if (!tool) throw stale();
  if (target.resource !== undefined) {
    if (target.resource === null || typeof target.resource !== "object") throw stale();
    const resource = target.resource as Record<string, unknown>;
    if (resource.kind === "terminal") {
      if (
        tool.kind !== "custom_process" ||
        !tool.terminalProcessId ||
        resource.threadId !== `server:${projectId}:custom:${tool.terminalProcessId}` ||
        resource.terminalId !== tool.terminalProcessId ||
        typeof resource.instanceId !== "string" ||
        !(await terminalAttachmentIsCurrent(
          location.environmentId,
          resource as unknown as TerminalAttachmentTarget,
        ))
      )
        throw stale();
    } else {
      const sessionId = projectBrowserSessionId(tool);
      if (sessionId && attachmentId) {
        if (
          resource.kind !== "browser" ||
          resource.tabId !== sessionId ||
          typeof resource.profileId !== "string"
        )
          throw stale();
        const settings = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId];
        const browserSettings =
          tool.kind === "browser"
            ? settings?.browser
            : settings?.customEmbeds.find((entry) => entry.id === tool.customEmbedId);
        if (!browserSettings) throw stale();
        const partition = resolveBrowserPartition({
          projectId,
          sessionId,
          partitionMode: browserSettings.partitionMode,
          partitionProfile: browserSettings.partitionProfile,
        });
        const stillCurrent = () => canReveal() && readCurrentTool() !== null;
        const url = await revealSavedBrowserAttachment(
          location,
          sessionId,
          resource.profileId,
          attachmentId,
          stillCurrent,
          partition,
        );
        if (!url || !stillCurrent()) return;
        const store = useWorkspaceShellStore.getState();
        if (tool.kind === "browser") store.setBrowserCurrentUrl(projectId, url, sessionId);
        else store.setBrowserSessionUrl(projectId, sessionId, url);
      } else if (sessionId) {
        const bridge = window.desktopBridge;
        if (!bridge || !isPrimaryEnvironment(location.environmentId ?? undefined)) throw stale();
        const live = projectBrowserAttachmentTarget(
          await bridge.getBrowserSessionState({ projectId, sessionId }),
        );
        if (
          !live ||
          resource.kind !== live.kind ||
          resource.tabId !== live.tabId ||
          resource.instanceId !== live.instanceId ||
          resource.profileId !== live.profileId
        )
          throw stale();
        if (resource.pageRef === undefined) {
          if (resource.origin !== live.origin) throw stale();
        } else {
          if (typeof resource.pageRef !== "string") throw stale();
          if (!canReveal()) return;
          if (!readCurrentTool()) throw stale();
          await bridge.runBrowserAutomation({
            projectId,
            sessionId,
            taskId: location.threadId,
            source: "human",
            operation: "enterAttachedPage",
            input: { pageRef: resource.pageRef, profileId: live.profileId },
          });
          const restored = await bridge.getBrowserSessionState({ projectId, sessionId });
          if (restored.instanceId !== live.instanceId || restored.pageRef !== resource.pageRef)
            throw stale();
          if (!canReveal()) return;
          if (restored.currentUrl && readCurrentTool()) {
            const store = useWorkspaceShellStore.getState();
            if (tool.kind === "browser")
              store.setBrowserCurrentUrl(projectId, restored.currentUrl, sessionId);
            else store.setBrowserSessionUrl(projectId, sessionId, restored.currentUrl);
          }
        }
      } else {
        const live = extensionTarget(location, tool, extensions);
        if (!live || Object.entries(live).some(([key, value]) => resource[key] !== value))
          throw stale();
      }
    }
  } else if (tool.kind === "extension" || tool.kind === "custom_process") {
    throw stale();
  }
  if (!canReveal()) return;
  if (!readCurrentTool()) throw stale();
  useWorkspaceShellStore.getState().setActiveTool(projectId, tool.id);
}
