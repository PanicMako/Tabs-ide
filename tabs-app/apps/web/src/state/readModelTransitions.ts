import * as DateTime from "effect/DateTime";
import {
  type EnvironmentId,
  type ProviderKind,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
  type OrchestrationSessionStatus,
  type OrchestrationV2ShellStreamItem,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ShellThreadStatus,
} from "@tabs/contracts";
import { resolveModelSlugForProvider } from "@tabs/shared/model";
import { type ChatMessage, type Project, type Thread, type QueuedRunItem } from "../types";

function toIsoDate(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (typeof val === "string") return val;
  if (val instanceof Date) return val.toISOString();
  if (DateTime.isDateTime(val)) return DateTime.formatIso(val);
  if (typeof (val as any).toISOString === "function") return (val as any).toISOString();
  return String(val);
}

// ── State ────────────────────────────────────────────────────────────

export interface EnvironmentSnapshotMeta {
  snapshotSequence: number;
  updatedAt: string;
  initialized: boolean;
}

export interface AppState {
  projects: Project[];
  threads: Thread[];
  threadsHydrated: boolean;
  environmentSnapshots?: Record<string, EnvironmentSnapshotMeta> | undefined;
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

function toLegacySessionStatusFromV2(
  status: OrchestrationV2ShellThreadStatus,
): "connecting" | "ready" | "running" | "error" | "closed" {
  switch (status) {
    case "preparing":
    case "starting":
    case "queued":
      return "connecting";
    case "running":
    case "waiting":
      return "running";
    case "failed":
      return "error";
    case "interrupted":
      return "ready";
    case "completed":
    case "cancelled":
    case "rolled_back":
    case "idle":
      return "closed";
  }
}

function toLegacyOrchestrationStatusFromV2(
  status: OrchestrationV2ShellThreadStatus,
): OrchestrationSessionStatus {
  switch (status) {
    case "preparing":
    case "starting":
    case "queued":
      return "starting";
    case "running":
    case "waiting":
      return "running";
    case "failed":
      return "error";
    case "interrupted":
      return "interrupted";
    case "completed":
    case "cancelled":
    case "rolled_back":
    case "idle":
      return "idle";
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
                  type: "image" as const,
                  previewUrl: toAttachmentPreviewUrl(attachmentPreviewRoutePath(attachment.id)),
                }
              : {
                  ...attachment,
                  type: "file" as const,
                },
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

function mapProjectsFromV2Shells(
  incoming: ReadonlyArray<OrchestrationProjectShell>,
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
      title: project.title,
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
      createdAt: toIsoDate(project.createdAt),
      updatedAt: toIsoDate(project.updatedAt),
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

function mapThreadFromV2Shell(
  shell: OrchestrationV2ThreadShell,
  existing?: Thread,
  environmentId?: EnvironmentId,
): Thread {
  const createdAtIso = toIsoDate(shell.createdAt);
  const updatedAtIso = toIsoDate(shell.updatedAt);
  return {
    id: shell.id,
    environmentId: environmentId ?? existing?.environmentId,
    codexThreadId: null,
    projectId: shell.projectId,
    title: shell.title,
    modelSelection: {
      ...shell.modelSelection,
      model: resolveModelSlugForProvider(
        shell.modelSelection.instanceId,
        shell.modelSelection.model,
      ),
    },
    runtimeMode: shell.runtimeMode,
    interactionMode: shell.interactionMode,
    session: {
      provider: toLegacyProvider(shell.providerInstanceId),
      status: toLegacySessionStatusFromV2(shell.status),
      orchestrationStatus: toLegacyOrchestrationStatusFromV2(shell.status),
      activeTurnId: undefined,
      createdAt: updatedAtIso,
      updatedAt: updatedAtIso,
      ...(shell.lastError ? { lastError: shell.lastError } : {}),
    },
    messages: existing?.messages ?? [],
    visibleItemCount: shell.visibleItemCount,
    proposedPlans: existing?.proposedPlans ?? [],
    error: shell.lastError ?? null,
    createdAt: createdAtIso,
    updatedAt: updatedAtIso,
    latestTurn: existing?.latestTurn ?? null,
    lastVisitedAt: existing?.lastVisitedAt ?? updatedAtIso,
    archivedAt: shell.archivedAt ? toIsoDate(shell.archivedAt) : null,
    settledOverride: shell.settledOverride ?? null,
    settledAt: shell.settledAt ? toIsoDate(shell.settledAt) : null,
    unsettledAt: shell.unsettledAt ? toIsoDate(shell.unsettledAt) : null,
    snoozedUntil: shell.snoozedUntil ? toIsoDate(shell.snoozedUntil) : null,
    snoozedAt: shell.snoozedAt ? toIsoDate(shell.snoozedAt) : null,
    pinnedAt: shell.pinnedAt ? toIsoDate(shell.pinnedAt) : null,
    pinOrderKey: shell.pinOrderKey ?? null,
    linkedPullRequest: shell.linkedPullRequest ?? null,
    pullRequests: shell.pullRequests ? shell.pullRequests.map((link) => ({ ...link })) : [],
    titleRegeneration: existing?.titleRegeneration ?? null,
    branch: shell.branch ?? null,
    worktreePath: shell.worktreePath ?? null,
    turnDiffSummaries: existing?.turnDiffSummaries ?? [],
    activities: existing?.activities ?? [],
    queuedRuns: existing?.queuedRuns ?? [],
    activeRunId: existing?.activeRunId ?? null,
    activeRunUserMessageId: existing?.activeRunUserMessageId ?? null,
  };
}

export function syncV2ShellSnapshot(
  state: AppState,
  snapshot: OrchestrationV2ShellSnapshot,
  environmentId?: EnvironmentId,
): AppState {
  const previousProjects = environmentId
    ? state.projects.filter((project) => project.environmentId === environmentId)
    : state.projects;
  const previousThreads = environmentId
    ? state.threads.filter((thread) => thread.environmentId === environmentId)
    : state.threads;

  const environmentProjects = mapProjectsFromV2Shells(
    snapshot.projects,
    previousProjects,
    environmentId,
  );

  const existingThreadById = new Map(previousThreads.map((thread) => [thread.id, thread] as const));
  const allShellThreads = [...snapshot.threads, ...(snapshot.archivedThreads ?? [])];
  const environmentThreads = allShellThreads.map((shell) =>
    mapThreadFromV2Shell(shell, existingThreadById.get(shell.id), environmentId),
  );

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

  const envKey = (environmentId ?? "primary") as string;
  const environmentSnapshots = {
    ...state.environmentSnapshots,
    [envKey]: {
      snapshotSequence: snapshot.snapshotSequence,
      updatedAt: new Date().toISOString(),
      initialized: true,
    },
  };

  return {
    ...state,
    projects,
    threads,
    threadsHydrated: true,
    environmentSnapshots,
  };
}

export function mergeV2ProjectEnrichment(
  state: AppState,
  snapshot: OrchestrationV2ShellSnapshot,
  environmentId?: EnvironmentId,
): AppState {
  const previousProjects = environmentId
    ? state.projects.filter((project) => project.environmentId === environmentId)
    : state.projects;

  const enrichedProjects = mapProjectsFromV2Shells(
    snapshot.projects,
    previousProjects,
    environmentId,
  );

  const enrichedById = new Map(enrichedProjects.map((p) => [p.id, p] as const));
  const projects = state.projects.map((p) => {
    if (environmentId !== undefined && p.environmentId !== environmentId) {
      return p;
    }
    const enriched = enrichedById.get(p.id);
    return enriched ?? p;
  });

  for (const enriched of enrichedProjects) {
    if (
      !projects.some(
        (p) =>
          p.id === enriched.id &&
          (environmentId === undefined || p.environmentId === environmentId),
      )
    ) {
      projects.push(enriched);
    }
  }

  const envKey = (environmentId ?? "primary") as string;
  const prevMeta = state.environmentSnapshots?.[envKey];
  const environmentSnapshots = {
    ...state.environmentSnapshots,
    [envKey]: {
      snapshotSequence: Math.max(snapshot.snapshotSequence, prevMeta?.snapshotSequence ?? 0),
      updatedAt: new Date().toISOString(),
      initialized: true,
    },
  };

  return {
    ...state,
    projects,
    environmentSnapshots,
  };
}

export function applyShellStreamItem(
  state: AppState,
  item: OrchestrationV2ShellStreamItem,
  environmentId?: EnvironmentId,
): AppState {
  const envKey = (environmentId ?? "primary") as string;
  const updateSequence = (
    sequence: number,
  ): Record<string, EnvironmentSnapshotMeta> | undefined => {
    const prev = state.environmentSnapshots?.[envKey];
    if (!prev) return state.environmentSnapshots;
    return {
      ...state.environmentSnapshots,
      [envKey]: {
        ...prev,
        snapshotSequence: sequence,
        updatedAt: new Date().toISOString(),
      },
    };
  };

  const getSnapshotUpdate = (sequence: number) => {
    const updated = updateSequence(sequence);
    return updated !== undefined ? { environmentSnapshots: updated } : {};
  };

  switch (item.kind) {
    case "synchronized":
      return state;
    case "snapshot":
      if (item.resolvedRepositoryIdentityRoots !== undefined) {
        return mergeV2ProjectEnrichment(state, item.snapshot, environmentId);
      }
      return syncV2ShellSnapshot(state, item.snapshot, environmentId);
    case "project.updated": {
      const existingIndex = state.projects.findIndex(
        (p) =>
          p.id === item.project.id &&
          (environmentId === undefined || p.environmentId === environmentId),
      );
      const mapped = mapProjectsFromV2Shells(
        [item.project],
        existingIndex >= 0 ? [state.projects[existingIndex]!] : [],
        environmentId,
      )[0]!;
      const projects =
        existingIndex >= 0
          ? state.projects.map((p, idx) => (idx === existingIndex ? mapped : p))
          : [...state.projects, mapped];
      return { ...state, projects, ...getSnapshotUpdate(item.sequence) };
    }
    case "project.removed": {
      const projects = state.projects.filter(
        (p) =>
          !(
            p.id === item.projectId &&
            (environmentId === undefined || p.environmentId === environmentId)
          ),
      );
      return {
        ...state,
        projects,
        ...getSnapshotUpdate(item.sequence),
      };
    }
    case "thread.updated": {
      const existing = state.threads.find(
        (t) =>
          t.id === item.thread.id &&
          (environmentId === undefined || t.environmentId === environmentId),
      );
      const mapped = mapThreadFromV2Shell(item.thread, existing, environmentId);
      const threads = existing
        ? state.threads.map((t) => (t.id === item.thread.id ? mapped : t))
        : [...state.threads, mapped];
      return { ...state, threads, ...getSnapshotUpdate(item.sequence) };
    }
    case "thread.removed": {
      const threads = state.threads.filter(
        (t) =>
          !(
            t.id === item.threadId &&
            (environmentId === undefined || t.environmentId === environmentId)
          ),
      );
      return {
        ...state,
        threads,
        ...getSnapshotUpdate(item.sequence),
      };
    }
  }
}

export function applyThreadProjection(
  state: AppState,
  projection: OrchestrationV2ThreadProjection,
  environmentId?: EnvironmentId,
): AppState {
  const existing = state.threads.find(
    (t) =>
      t.id === projection.thread.id &&
      (environmentId === undefined || t.environmentId === environmentId),
  );
  const updatedAtIso = toIsoDate(projection.updatedAt);
  const createdAtIso = toIsoDate(projection.thread.createdAt);

  const mappedMessages: ChatMessage[] = projection.messages.map((message) => {
    const attachments = message.attachments?.map((attachment) =>
      attachment.type === "image"
        ? {
            ...attachment,
            type: "image" as const,
            previewUrl: toAttachmentPreviewUrl(attachmentPreviewRoutePath(attachment.id)),
          }
        : {
            ...attachment,
            type: "file" as const,
          },
    );
    return {
      id: message.id,
      role: message.role,
      text: message.text,
      createdAt: toIsoDate(message.createdAt),
      streaming: message.streaming,
      ...(message.streaming
        ? {}
        : {
            completedAt: toIsoDate(message.updatedAt),
          }),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    };
  });

  const queuedRuns: QueuedRunItem[] = (projection.runs ?? [])
    .filter((r) => r.status === "queued")
    .sort((a, b) => {
      const posA = a.queuePosition ?? a.ordinal;
      const posB = b.queuePosition ?? b.ordinal;
      return posA - posB;
    })
    .map((r) => {
      const msg = projection.messages.find((m) => m.id === r.userMessageId);
      const attachments = msg?.attachments?.map((attachment) =>
        attachment.type === "image"
          ? {
              ...attachment,
              type: "image" as const,
              previewUrl: toAttachmentPreviewUrl(attachmentPreviewRoutePath(attachment.id)),
            }
          : {
              ...attachment,
              type: "file" as const,
            },
      );
      return {
        id: r.id,
        ordinal: r.ordinal,
        userMessageId: r.userMessageId,
        text: msg?.text ?? "",
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        scheduledFor: r.scheduledFor ? toIsoDate(r.scheduledFor) : null,
        queuePosition: r.queuePosition ?? null,
        queueHeld: r.queueHeld ?? false,
        createdAt: toIsoDate(r.requestedAt),
      };
    });

  const activeRun = (projection.runs ?? []).find(
    (r) =>
      r.status === "running" ||
      r.status === "starting" ||
      r.status === "preparing" ||
      r.status === "waiting",
  );
  const activeRunId = activeRun?.id ?? null;
  const activeRunUserMessageId = activeRun?.userMessageId ?? null;

  const updatedThread: Thread = {
    id: projection.thread.id,
    environmentId: environmentId ?? existing?.environmentId,
    codexThreadId: null,
    projectId: projection.thread.projectId,
    title: projection.thread.title,
    modelSelection: {
      ...projection.thread.modelSelection,
      model: resolveModelSlugForProvider(
        projection.thread.modelSelection.instanceId,
        projection.thread.modelSelection.model,
      ),
    },
    runtimeMode: projection.thread.runtimeMode,
    interactionMode: projection.thread.interactionMode,
    session: existing?.session ?? null,
    messages: mappedMessages,
    visibleItemCount: existing?.visibleItemCount,
    proposedPlans: projection.plans.map((p) => ({
      id: p.id as any,
      turnId: null,
      planMarkdown: p.kind === "proposed_plan" ? p.markdown : (p.explanation ?? ""),
      implementedAt: (p as any).implementedAt ? toIsoDate((p as any).implementedAt) : null,
      implementationThreadId: (p as any).implementationThreadId ?? null,
      createdAt: (p as any).createdAt ? toIsoDate((p as any).createdAt) : createdAtIso,
      updatedAt: (p as any).updatedAt ? toIsoDate((p as any).updatedAt) : updatedAtIso,
    })),
    error: existing?.error ?? null,
    createdAt: createdAtIso,
    updatedAt: updatedAtIso,
    latestTurn: existing?.latestTurn ?? null,
    lastVisitedAt: existing?.lastVisitedAt ?? updatedAtIso,
    archivedAt: projection.thread.archivedAt ? toIsoDate(projection.thread.archivedAt) : null,
    settledOverride: projection.thread.settledOverride ?? null,
    settledAt: projection.thread.settledAt ? toIsoDate(projection.thread.settledAt) : null,
    unsettledAt: projection.thread.unsettledAt ? toIsoDate(projection.thread.unsettledAt) : null,
    snoozedUntil: projection.thread.snoozedUntil ? toIsoDate(projection.thread.snoozedUntil) : null,
    snoozedAt: projection.thread.snoozedAt ? toIsoDate(projection.thread.snoozedAt) : null,
    pinnedAt: projection.thread.pinnedAt ? toIsoDate(projection.thread.pinnedAt) : null,
    pinOrderKey: projection.thread.pinOrderKey ?? null,
    linkedPullRequest: projection.thread.linkedPullRequest ?? null,
    pullRequests: projection.thread.pullRequests
      ? projection.thread.pullRequests.map((link) => ({ ...link }))
      : [],
    titleRegeneration: existing?.titleRegeneration ?? null,
    branch: projection.thread.branch ?? null,
    worktreePath: projection.thread.worktreePath ?? null,
    turnDiffSummaries: projection.checkpoints.map((cp) => ({
      turnId: (cp as any).turnId ?? TurnId.makeUnsafe(cp.id),
      completedAt: toIsoDate(cp.capturedAt),
      status: cp.status,
      assistantMessageId: (cp as any).assistantMessageId ?? undefined,
      checkpointTurnCount: (cp as any).checkpointTurnCount ?? cp.ordinalWithinScope,
      checkpointRef: cp.ref,
      files: cp.files.map((f) => ({ ...f })),
    })),
    activities: existing?.activities ?? [],
    queuedRuns,
    activeRunId,
    activeRunUserMessageId,
  };

  const threads = existing
    ? state.threads.map((t) => (t === existing ? updatedThread : t))
    : [...state.threads, updatedThread];
  return { ...state, threads };
}
