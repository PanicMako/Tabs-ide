import type { ProjectId, ThreadId } from "@tabs/contracts";
import type { Project, Thread } from "../types";
import type { ProjectWorkspaceSettings as ProjectWorkspaceSettingsType } from "@tabs/contracts/settings";
import { composerDraftActions } from "~/state/composerDrafts";
import {
  createDefaultProjectWorkspaceSettings,
  resolveActiveToolId,
  useWorkspaceShellStore,
} from "../workspaceShellStore";

/**
 * Sort threads by recency (updatedAt -> createdAt).
 */
export function sortProjectThreads(threads: ReadonlyArray<Thread>): Thread[] {
  return threads.toSorted((left, right) => {
    const rightTime = Date.parse(right.updatedAt ?? right.createdAt);
    const leftTime = Date.parse(left.updatedAt ?? left.createdAt);
    if (!Number.isNaN(rightTime) && !Number.isNaN(leftTime) && rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

/**
 * Resolve most recent non-archived thread for a project.
 */
export function resolveMostRecentThreadForProject(
  projectId: ProjectId,
  threads: ReadonlyArray<Thread>,
): Thread | null {
  const activeThreads = threads.filter(
    (thread) => thread.projectId === projectId && thread.archivedAt === null,
  );
  return sortProjectThreads(activeThreads)[0] ?? null;
}

/**
 * Resolve the remembered or most recent active thread for a project.
 */
export function resolveProjectAgentThread(
  projectId: ProjectId,
  threads: ReadonlyArray<Thread>,
  rememberedThreadId: ThreadId | null,
): Thread | null {
  const activeThreads = threads.filter((thread) => thread.archivedAt === null);
  const rememberedThread = rememberedThreadId
    ? activeThreads.find(
        (thread) => thread.id === rememberedThreadId && thread.projectId === projectId,
      )
    : null;
  return rememberedThread ?? resolveMostRecentThreadForProject(projectId, threads);
}

/**
 * Resolve the effective Agent thread ID for a project, taking into account
 * composer drafts and remembered threads.
 */
export function resolveProjectAgentThreadId(
  projectId: ProjectId,
  threads: ReadonlyArray<Thread>,
  rememberedThreadId: ThreadId | null,
): ThreadId | null {
  if (rememberedThreadId) {
    const draft = composerDraftActions.getDraftThread(rememberedThreadId);
    if (draft && draft.projectId === projectId) {
      return rememberedThreadId;
    }
  }
  const projectDraft = composerDraftActions.getDraftThreadByProjectId(projectId);
  if (projectDraft) {
    return projectDraft.threadId;
  }
  const resolved = resolveProjectAgentThread(projectId, threads, rememberedThreadId);
  return resolved?.id ?? null;
}

export interface ResolveProjectTargetSurfaceInput {
  projectId: ProjectId;
  targetToolId?: string | undefined;
  targetThreadId?: ThreadId | null | undefined;
  projects: ReadonlyArray<Project>;
  threads: ReadonlyArray<Thread>;
  projectSettings?: ProjectWorkspaceSettingsType | undefined;
  rememberedToolId?: string | undefined;
  rememberedThreadId?: ThreadId | null | undefined;
}

export interface ResolvedProjectTargetSurface {
  projectId: ProjectId;
  toolId: string;
  toolKind: string;
  threadId: ThreadId | null;
  destination:
    | {
        to: "/$environmentId/$threadId";
        params: { environmentId: string; threadId: ThreadId };
      }
    | {
        to: "/";
      };
}

/**
 * Deterministically resolves the destination tool and route for a project surface.
 * Fallback rules:
 * - If a remembered tool was removed or hidden, resolveActiveToolId deterministically selects
 *   the first visible tool (or "agents").
 * - If the resolved tool is "agents", restores remembered or recent thread and routes to /$env/$thread.
 * - If the resolved tool is not "agents" (code, git, browser, custom tool), routes to "/".
 */
export function resolveProjectTargetSurface(
  input: ResolveProjectTargetSurfaceInput,
): ResolvedProjectTargetSurface {
  const settings =
    input.projectSettings ??
    useWorkspaceShellStore.getState().projectSettingsByProjectId[input.projectId] ??
    createDefaultProjectWorkspaceSettings();

  const candidateToolId =
    input.targetToolId ??
    input.rememberedToolId ??
    useWorkspaceShellStore.getState().session.activeToolIdByProjectId[input.projectId];

  const effectiveToolId = resolveActiveToolId(settings, candidateToolId);

  const matchedTool = settings.tools?.find((tool) => tool.id === effectiveToolId);
  const toolKind = matchedTool?.kind ?? (effectiveToolId === "agents" ? "agents" : effectiveToolId);

  if (toolKind === "agents") {
    const targetProject = input.projects.find((p) => p.id === input.projectId);
    const candidateThreadId =
      input.targetThreadId !== undefined
        ? input.targetThreadId
        : input.rememberedThreadId !== undefined
          ? input.rememberedThreadId
          : (useWorkspaceShellStore.getState().session.rememberedThreadIdByProjectId[
              input.projectId
            ] ?? null);

    const threadId = resolveProjectAgentThreadId(input.projectId, input.threads, candidateThreadId);

    if (threadId && targetProject?.environmentId) {
      return {
        projectId: input.projectId,
        toolId: effectiveToolId,
        toolKind,
        threadId,
        destination: {
          to: "/$environmentId/$threadId",
          params: {
            environmentId: targetProject.environmentId,
            threadId,
          },
        },
      };
    }
  }

  return {
    projectId: input.projectId,
    toolId: effectiveToolId,
    toolKind,
    threadId: null,
    destination: {
      to: "/",
    },
  };
}

export interface ActivateProjectSurfaceOptions {
  projectId: ProjectId;
  targetToolId?: string | undefined;
  targetThreadId?: ThreadId | null | undefined;
  codeFocusedPath?: string | null | undefined;
  projects: ReadonlyArray<Project>;
  threads: ReadonlyArray<Thread>;
  navigate: (target: any) => Promise<unknown> | void;
  currentPathname?: string | undefined;
  stayOnSettings?: boolean | undefined;
}

/**
 * Module-level state tracking the latest requested project surface activation.
 * Used by route-sync effects to recognize that an in-flight navigation is deliberate
 * and belongs to a specific project surface, preventing stale route parameters from
 * clobbering destination state.
 */
let inFlightSurfaceActivation: {
  id: number;
  projectId: ProjectId;
  toolId: string;
  threadId: ThreadId | null;
  timestamp: number;
} | null = null;

let nextSurfaceActivationId = 0;

export function getInFlightSurfaceActivation() {
  return inFlightSurfaceActivation;
}

export function clearInFlightSurfaceActivation() {
  inFlightSurfaceActivation = null;
}

export function isPathTargetingThread(pathname: string, threadId: ThreadId): boolean {
  const lastSegment = pathname.split("/").filter(Boolean).at(-1);
  if (!lastSegment) return false;
  try {
    return decodeURIComponent(lastSegment) === threadId;
  } catch {
    return lastSegment === threadId;
  }
}

export function isPathAlignedWithSurfaceActivation(
  pathname: string,
  activation: NonNullable<ReturnType<typeof getInFlightSurfaceActivation>>,
): boolean {
  if (activation.toolId !== "agents") {
    return pathname === "/";
  }
  if (!activation.threadId) {
    return pathname === "/";
  }
  return isPathTargetingThread(pathname, activation.threadId);
}

/**
 * The single authoritative entry point for activating a project surface across
 * mouse tab clicks, keyboard shortcuts, project switchers, and deep link coordinators.
 */
export async function activateProjectSurface(
  options: ActivateProjectSurfaceOptions,
): Promise<ResolvedProjectTargetSurface> {
  const {
    projectId,
    targetToolId,
    targetThreadId,
    codeFocusedPath,
    projects,
    threads,
    navigate,
    currentPathname,
    stayOnSettings,
  } = options;

  const store = useWorkspaceShellStore.getState();
  const settings =
    store.projectSettingsByProjectId[projectId] ?? createDefaultProjectWorkspaceSettings();

  const surface = resolveProjectTargetSurface({
    projectId,
    targetToolId,
    targetThreadId,
    projects,
    threads,
    projectSettings: settings,
  });

  // Track activation to guard against concurrent route-sync races
  const activation = {
    id: ++nextSurfaceActivationId,
    projectId: surface.projectId,
    toolId: surface.toolId,
    threadId: surface.threadId,
    timestamp: Date.now(),
  };
  inFlightSurfaceActivation = activation;

  // Atomically commit active project, valid tool, and optional thread to store
  store.openProjectSurface(surface.projectId, surface.toolId, surface.threadId);

  if (codeFocusedPath !== undefined) {
    store.setCodeFocusedPath(surface.projectId, codeFocusedPath);
  }

  // If user is on /settings and explicitly chose to stay on settings, do not navigate away
  if (currentPathname === "/settings" && stayOnSettings) {
    if (inFlightSurfaceActivation?.id === activation.id) {
      inFlightSurfaceActivation = null;
    }
    return surface;
  }

  // Navigate to authoritative destination (either /$environmentId/$threadId or /)
  try {
    await navigate(surface.destination);
  } finally {
    if (inFlightSurfaceActivation?.id === activation.id) {
      inFlightSurfaceActivation = null;
    }
  }

  return surface;
}
