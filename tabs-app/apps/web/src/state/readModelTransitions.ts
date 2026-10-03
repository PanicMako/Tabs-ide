import {
  type EnvironmentId,
  type ProviderKind,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationSessionStatus,
} from "@tabs/contracts";
import { resolveModelSlugForProvider } from "@tabs/shared/model";
import { type ChatMessage, type Project, type Thread } from "../types";

// ── State ────────────────────────────────────────────────────────────

export interface AppState {
  projects: Project[];
  threads: Thread[];
  threadsHydrated: boolean;
}

const PERSISTED_STATE_KEY = "tabs:renderer-state:v9";
const LEGACY_PERSISTED_STATE_KEYS = [
  "tabs:renderer-state:v8",
  "tabs:renderer-state:v7",
  "tabs:renderer-state:v6",
  "tabs:renderer-state:v5",
  "tabs:renderer-state:v4",
  "tabs:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

const initialState: AppState = {
  projects: [],
  threads: [],
  threadsHydrated: false,
};
const persistedExpandedProjectKeys = new Set<string>();
const persistedProjectOrderKeys: string[] = [];

function persistedProjectKey(environmentId: EnvironmentId | undefined, cwd: string): string {
  return JSON.stringify([environmentId ?? "legacy", cwd]);
}

// ── Persist helpers ──────────────────────────────────────────────────

export function readPersistedAppState(): AppState {
  if (typeof window === "undefined") return initialState;
  try {
    const raw =
      window.localStorage.getItem(PERSISTED_STATE_KEY) ??
      window.localStorage.getItem("tabs:renderer-state:v8");
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as {
      expandedProjectCwds?: string[];
      projectOrderCwds?: string[];
      expandedProjectKeys?: string[];
      projectOrderKeys?: string[];
    };
    persistedExpandedProjectKeys.clear();
    persistedProjectOrderKeys.length = 0;
    for (const key of parsed.expandedProjectKeys ?? parsed.expandedProjectCwds ?? []) {
      if (typeof key === "string" && key.length > 0) {
        persistedExpandedProjectKeys.add(key);
      }
    }
    for (const key of parsed.projectOrderKeys ?? parsed.projectOrderCwds ?? []) {
      if (typeof key === "string" && key.length > 0 && !persistedProjectOrderKeys.includes(key)) {
        persistedProjectOrderKeys.push(key);
      }
    }
    return { ...initialState };
  } catch {
    return initialState;
  }
}

let legacyKeysCleanedUp = false;

export function persistAppState(state: AppState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        expandedProjectKeys: state.projects
          .filter((project) => project.expanded)
          .map((project) => persistedProjectKey(project.environmentId, project.cwd)),
        projectOrderKeys: state.projects.map((project) =>
          persistedProjectKey(project.environmentId, project.cwd),
        ),
      }),
    );
    if (!legacyKeysCleanedUp) {
      legacyKeysCleanedUp = true;
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
    }
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────

function updateThread(
  threads: Thread[],
  threadId: ThreadId,
  updater: (t: Thread) => Thread,
  environmentId?: EnvironmentId,
): Thread[] {
  let changed = false;
  const next = threads.map((t) => {
    if (t.id !== threadId || (environmentId !== undefined && t.environmentId !== environmentId)) {
      return t;
    }
    const updated = updater(t);
    if (updated !== t) changed = true;
    return updated;
  });
  return changed ? next : threads;
}

function mapProjectsFromReadModel(
  incoming: OrchestrationReadModel["projects"],
  previous: Project[],
  environmentId?: EnvironmentId,
): Project[] {
  const previousById = new Map(previous.map((project) => [project.id, project] as const));
  const previousByCwd = new Map(previous.map((project) => [project.cwd, project] as const));
  const previousOrderById = new Map(previous.map((project, index) => [project.id, index] as const));
  const previousOrderByCwd = new Map(
    previous.map((project, index) => [project.cwd, index] as const),
  );
  const persistedOrderByKey = new Map(
    persistedProjectOrderKeys.map((key, index) => [key, index] as const),
  );
  const usePersistedOrder = previous.length === 0;

  const mappedProjects = incoming.map((project) => {
    const existing = previousById.get(project.id) ?? previousByCwd.get(project.workspaceRoot);
    return {
      id: project.id,
      environmentId: environmentId ?? existing?.environmentId,
      name: project.title,
      cwd: project.workspaceRoot,
      defaultModelSelection:
        existing?.defaultModelSelection ??
        (project.defaultModelSelection
          ? {
              ...project.defaultModelSelection,
              model: resolveModelSlugForProvider(
                project.defaultModelSelection.instanceId,
                project.defaultModelSelection.model,
              ),
            }
          : null),
      defaultThreadEnvMode: project.defaultThreadEnvMode ?? existing?.defaultThreadEnvMode ?? null,
      faviconPath: project.faviconPath ?? existing?.faviconPath ?? null,
      projectIcon: project.projectIcon ?? existing?.projectIcon ?? null,
      expanded:
        existing?.expanded ??
        (persistedExpandedProjectKeys.size > 0
          ? persistedExpandedProjectKeys.has(
              persistedProjectKey(environmentId, project.workspaceRoot),
            ) || persistedExpandedProjectKeys.has(project.workspaceRoot)
          : true),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      scripts: project.scripts.map((script) => ({ ...script })),
    } satisfies Project;
  });

  return mappedProjects
    .map((project, incomingIndex) => {
      const previousIndex =
        previousOrderById.get(project.id) ?? previousOrderByCwd.get(project.cwd);
      const persistedIndex = usePersistedOrder
        ? (persistedOrderByKey.get(persistedProjectKey(environmentId, project.cwd)) ??
          persistedOrderByKey.get(project.cwd))
        : undefined;
      const orderIndex =
        previousIndex ??
        persistedIndex ??
        (usePersistedOrder ? persistedProjectOrderKeys.length : previous.length) + incomingIndex;
      return { project, incomingIndex, orderIndex };
    })
    .toSorted((a, b) => {
      const byOrder = a.orderIndex - b.orderIndex;
      if (byOrder !== 0) return byOrder;
      return a.incomingIndex - b.incomingIndex;
    })
    .map((entry) => entry.project);
}

function toLegacySessionStatus(
  status: OrchestrationSessionStatus,
): "connecting" | "ready" | "running" | "error" | "closed" {
  switch (status) {
    case "starting":
      return "connecting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "ready":
    case "interrupted":
      return "ready";
    case "idle":
    case "stopped":
      return "closed";
  }
}

function toLegacyProvider(providerName: string | null): ProviderKind {
  // Preserve the actual driver slug (codex, claudeAgent, cursor, grok, opencode,
  // …). Typed as the closed `ProviderKind` for legacy callers, but the runtime
  // value carries the real provider so the composer routes/locks correctly.
  return (providerName ?? "codex") as ProviderKind;
}

function resolveWsHttpOrigin(): string {
  if (typeof window === "undefined") return "";
  let locationWsUrl: string | null = null;
  try {
    const params = new URLSearchParams(window.location.search);
    locationWsUrl = params.get("tabsWsUrl");
  } catch {
    locationWsUrl = null;
  }
  const bridgeWsUrl = window.desktopBridge?.getWsUrl?.();
  const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsCandidate =
    typeof locationWsUrl === "string" && locationWsUrl.length > 0
      ? locationWsUrl
      : typeof bridgeWsUrl === "string" && bridgeWsUrl.length > 0
        ? bridgeWsUrl
        : typeof envWsUrl === "string" && envWsUrl.length > 0
          ? envWsUrl
          : null;
  if (!wsCandidate) return window.location.origin;
  try {
    const wsUrl = new URL(wsCandidate);
    const protocol =
      wsUrl.protocol === "wss:" ? "https:" : wsUrl.protocol === "ws:" ? "http:" : wsUrl.protocol;
    return `${protocol}//${wsUrl.host}`;
  } catch {
    return window.location.origin;
  }
}

function toAttachmentPreviewUrl(rawUrl: string): string {
  if (rawUrl.startsWith("/")) {
    return `${resolveWsHttpOrigin()}${rawUrl}`;
  }
  return rawUrl;
}

function attachmentPreviewRoutePath(attachmentId: string): string {
  return `/attachments/${encodeURIComponent(attachmentId)}`;
}

// ── Pure state transition functions ────────────────────────────────────

export function syncServerReadModel(
  state: AppState,
  readModel: OrchestrationReadModel,
  environmentId?: EnvironmentId,
): AppState {
  const previousProjects = environmentId
    ? state.projects.filter((project) => project.environmentId === environmentId)
    : state.projects;
  const previousThreads = environmentId
    ? state.threads.filter((thread) => thread.environmentId === environmentId)
    : state.threads;
  const environmentProjects = mapProjectsFromReadModel(
    readModel.projects.filter((project) => project.deletedAt === null),
    previousProjects,
    environmentId,
  );
  const existingThreadById = new Map(previousThreads.map((thread) => [thread.id, thread] as const));
  const environmentThreads = readModel.threads
    .filter((thread) => thread.deletedAt === null)
    .map((thread) => {
      const existing = existingThreadById.get(thread.id);
      return {
        id: thread.id,
        environmentId: environmentId ?? existing?.environmentId,
        codexThreadId: null,
        projectId: thread.projectId,
        title: thread.title,
        modelSelection: {
          ...thread.modelSelection,
          model: resolveModelSlugForProvider(
            thread.modelSelection.instanceId,
            thread.modelSelection.model,
          ),
        },
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        session: thread.session
          ? {
              provider: toLegacyProvider(thread.session.providerName),
              status: toLegacySessionStatus(thread.session.status),
              orchestrationStatus: thread.session.status,
              activeTurnId: thread.session.activeTurnId ?? undefined,
              createdAt: thread.session.updatedAt,
              updatedAt: thread.session.updatedAt,
              ...(thread.session.lastError ? { lastError: thread.session.lastError } : {}),
            }
          : null,
        messages: thread.messages.map((message) => {
          const attachments = message.attachments?.map((attachment) =>
            attachment.type === "image"
              ? {
                  ...attachment,
                  previewUrl: toAttachmentPreviewUrl(attachmentPreviewRoutePath(attachment.id)),
                }
              : attachment,
          );
          const normalizedMessage: ChatMessage = {
            id: message.id,
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
            streaming: message.streaming,
            ...(message.streaming ? {} : { completedAt: message.updatedAt }),
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
          };
          return normalizedMessage;
        }),
        proposedPlans: thread.proposedPlans.map((proposedPlan) => ({
          id: proposedPlan.id,
          turnId: proposedPlan.turnId,
          planMarkdown: proposedPlan.planMarkdown,
          implementedAt: proposedPlan.implementedAt,
          implementationThreadId: proposedPlan.implementationThreadId,
          createdAt: proposedPlan.createdAt,
          updatedAt: proposedPlan.updatedAt,
        })),
        error: thread.session?.lastError ?? null,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        latestTurn: thread.latestTurn,
        lastVisitedAt: existing?.lastVisitedAt ?? thread.updatedAt,
        archivedAt: thread.archivedAt,
        settledOverride: thread.settledOverride,
        settledAt: thread.settledAt,
        unsettledAt: thread.unsettledAt ?? null,
        snoozedUntil: thread.snoozedUntil ?? null,
        snoozedAt: thread.snoozedAt ?? null,
        pinnedAt: thread.pinnedAt ?? null,
        pinOrderKey: thread.pinOrderKey ?? null,
        linkedPullRequest: thread.linkedPullRequest ?? null,
        pullRequests: thread.pullRequests ? thread.pullRequests.map((link) => ({ ...link })) : [],
        titleRegeneration: thread.titleRegeneration ?? null,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        turnDiffSummaries: thread.checkpoints.map((checkpoint) => ({
          turnId: checkpoint.turnId,
          completedAt: checkpoint.completedAt,
          status: checkpoint.status,
          assistantMessageId: checkpoint.assistantMessageId ?? undefined,
          checkpointTurnCount: checkpoint.checkpointTurnCount,
          checkpointRef: checkpoint.checkpointRef,
          files: checkpoint.files.map((file) => ({ ...file })),
        })),
        activities: thread.activities.map((activity) => ({ ...activity })),
      };
    });
  const projects = environmentId
    ? [
        ...state.projects.filter((project) => project.environmentId !== environmentId),
        ...environmentProjects,
      ]
    : environmentProjects;
  const threads = environmentId
    ? [
        ...state.threads.filter((thread) => thread.environmentId !== environmentId),
        ...environmentThreads,
      ]
    : environmentThreads;
  return {
    ...state,
    projects,
    threads,
    threadsHydrated: true,
  };
}

export function markThreadVisited(
  state: AppState,
  threadId: ThreadId,
  visitedAt?: string,
  environmentId?: EnvironmentId,
): AppState {
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  const threads = updateThread(
    state.threads,
    threadId,
    (thread) => {
      const previousVisitedAtMs = thread.lastVisitedAt ? Date.parse(thread.lastVisitedAt) : NaN;
      if (
        Number.isFinite(previousVisitedAtMs) &&
        Number.isFinite(visitedAtMs) &&
        previousVisitedAtMs >= visitedAtMs
      ) {
        return thread;
      }
      return { ...thread, lastVisitedAt: at };
    },
    environmentId,
  );
  return threads === state.threads ? state : { ...state, threads };
}

export function markThreadUnread(
  state: AppState,
  threadId: ThreadId,
  environmentId?: EnvironmentId,
): AppState {
  const threads = updateThread(
    state.threads,
    threadId,
    (thread) => {
      if (!thread.latestTurn?.completedAt) return thread;
      const latestTurnCompletedAtMs = Date.parse(thread.latestTurn.completedAt);
      if (Number.isNaN(latestTurnCompletedAtMs)) return thread;
      const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
      if (thread.lastVisitedAt === unreadVisitedAt) return thread;
      return { ...thread, lastVisitedAt: unreadVisitedAt };
    },
    environmentId,
  );
  return threads === state.threads ? state : { ...state, threads };
}

export function toggleProject(
  state: AppState,
  projectId: Project["id"],
  environmentId?: EnvironmentId,
): AppState {
  return {
    ...state,
    projects: state.projects.map((p) =>
      p.id === projectId && (environmentId === undefined || p.environmentId === environmentId)
        ? { ...p, expanded: !p.expanded }
        : p,
    ),
  };
}

export function setProjectExpanded(
  state: AppState,
  projectId: Project["id"],
  expanded: boolean,
  environmentId?: EnvironmentId,
): AppState {
  let changed = false;
  const projects = state.projects.map((p) => {
    if (
      p.id !== projectId ||
      (environmentId !== undefined && p.environmentId !== environmentId) ||
      p.expanded === expanded
    )
      return p;
    changed = true;
    return { ...p, expanded };
  });
  return changed ? { ...state, projects } : state;
}

export function reorderProjects(
  state: AppState,
  draggedProjectId: Project["id"],
  targetProjectId: Project["id"],
  draggedEnvironmentId?: EnvironmentId,
  targetEnvironmentId?: EnvironmentId,
): AppState {
  if (
    draggedProjectId === targetProjectId &&
    (draggedEnvironmentId === undefined || draggedEnvironmentId === targetEnvironmentId)
  )
    return state;
  const draggedIndex = state.projects.findIndex(
    (project) =>
      project.id === draggedProjectId &&
      (draggedEnvironmentId === undefined || project.environmentId === draggedEnvironmentId),
  );
  const targetIndex = state.projects.findIndex(
    (project) =>
      project.id === targetProjectId &&
      (targetEnvironmentId === undefined || project.environmentId === targetEnvironmentId),
  );
  if (draggedIndex < 0 || targetIndex < 0) return state;
  const projects = [...state.projects];
  const [draggedProject] = projects.splice(draggedIndex, 1);
  if (!draggedProject) return state;
  projects.splice(targetIndex, 0, draggedProject);
  return { ...state, projects };
}

export function setError(
  state: AppState,
  threadId: ThreadId,
  error: string | null,
  environmentId?: EnvironmentId,
): AppState {
  const threads = updateThread(
    state.threads,
    threadId,
    (t) => {
      if (t.error === error) return t;
      return { ...t, error };
    },
    environmentId,
  );
  return threads === state.threads ? state : { ...state, threads };
}

export function setThreadBranch(
  state: AppState,
  threadId: ThreadId,
  branch: string | null,
  worktreePath: string | null,
  environmentId?: EnvironmentId,
): AppState {
  const threads = updateThread(
    state.threads,
    threadId,
    (t) => {
      if (t.branch === branch && t.worktreePath === worktreePath) return t;
      const cwdChanged = t.worktreePath !== worktreePath;
      return {
        ...t,
        branch,
        worktreePath,
        ...(cwdChanged ? { session: null } : {}),
      };
    },
    environmentId,
  );
  return threads === state.threads ? state : { ...state, threads };
}
