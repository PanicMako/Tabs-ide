import {
  ArrowLeftIcon,
  ArrowUpDownIcon,
  ChevronRightIcon,
  FolderIcon,
  GitPullRequestIcon,
  PlusIcon,
  RocketIcon,
  SettingsIcon,
  SquarePenIcon,
  TerminalIcon,
  TriangleAlertIcon,
  PinIcon,
  Clock3Icon,
  CircleCheckIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  DndContext,
  type DragCancelEvent,
  type CollisionDetection,
  PointerSensor,
  type DragStartEvent,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import {
  DEFAULT_MODEL,
  type DesktopUpdateState,
  type EnvironmentId,
  ProjectId,
  ThreadId,
  type GitStatusResult,
  type ResolvedKeybindingsConfig,
} from "@tabs/contracts";
import { makeAppModelSelection } from "../modelSelection";
import type { Project, Thread } from "../types";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "@effect/atom-react";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@tabs/client-runtime/environment";
import {
  resolveThreadCurrentPullRequest,
  type ThreadCurrentPullRequest,
} from "@tabs/shared/threadPullRequests";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  type SidebarProjectSortOrder,
  type SidebarThreadSortOrder,
} from "@tabs/contracts/settings";
import { isElectron } from "../env";
import { APP_STAGE_LABEL, APP_VERSION } from "../branding";
import {
  isLinuxPlatform,
  isMacPlatform,
  isWindowsPlatform,
  newCommandId,
  newProjectId,
} from "../lib/utils";

// Windows hides the native title bar and overlays the caption buttons at the
// top-right, so the sidebar header should not reserve the macOS traffic-light
// space on the left.
const isWindowsDesktop =
  isElectron && typeof navigator !== "undefined" && isWindowsPlatform(navigator.platform);
import {
  markThreadUnreadInAtoms,
  readModelStateAtom,
  reorderProjectsInAtoms,
  toggleProjectInAtoms,
} from "../state/readModel";
import { useKeybindings } from "../state/settings";
import { shortcutLabelForCommand } from "../keybindings";
import { derivePendingApprovals, derivePendingUserInputs } from "../session-logic";
import { gitRemoveWorktreeMutationOptions, gitStatusQueryOptions } from "../lib/gitReactQuery";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import { environmentApi } from "../connection/environmentApiRegistry";
import { composerDraftActions } from "../state/composerDrafts";
import { projectUiStateKey } from "../state/scopedStateStore";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { selectThreadTerminalState } from "../state/terminalTransitions";
import { terminalStateAtom, terminalActions } from "../state/terminal";
import { toastManager } from "./ui/toast";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateReleaseNotesPreview,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldHighlightDesktopUpdateError,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { Menu, MenuGroup, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenuAction,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  SidebarTrigger,
} from "./ui/sidebar";
import { threadSelectionActions, useThreadSelection } from "../state/threadSelection";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../worktreeCleanup";
import { isNonEmpty as isNonEmptyString } from "effect/String";
import {
  getFallbackThreadIdAfterDelete,
  getVisibleThreadsForProject,
  resolveProjectStatusIndicator,
  resolveSidebarNewThreadEnvMode,
  resolveThreadRowClassName,
  resolveThreadStatusPill,
  shouldClearThreadSelectionOnMouseDown,
  sortProjectsForSidebar,
  sortThreadsForSidebar,
} from "./Sidebar.logic";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { useConfirm } from "~/hooks/useConfirm";
import { isSnoozed, isSettled } from "../state/threadLifecycle";
import { resolveSnoozePresets } from "../state/snoozePresets";
import { sortPinnedThreads } from "../state/pinnedThreadOrder";
const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const THREAD_PREVIEW_LIMIT = 6;
const SIDEBAR_SORT_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};
const SIDEBAR_THREAD_SORT_LABELS: Record<SidebarThreadSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
};
const loadedProjectFaviconSrcs = new Set<string>();

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface TerminalStatusIndicator {
  label: "Terminal process running";
  colorClass: string;
  pulse: boolean;
}

interface PrStatusIndicator {
  label: "PR open" | "PR closed" | "PR merged" | `PR stack (${number})`;
  colorClass: string;
  tooltip: string;
  url: string;
}

type ThreadPr = GitStatusResult["pr"];

function terminalStatusFromRunningIds(
  runningTerminalIds: string[],
): TerminalStatusIndicator | null {
  if (runningTerminalIds.length === 0) {
    return null;
  }
  return {
    label: "Terminal process running",
    colorClass: "text-teal-600 dark:text-teal-300/90",
    pulse: true,
  };
}

function prStatusIndicator(pr: ThreadPr): PrStatusIndicator | null {
  if (!pr) return null;

  if (pr.state === "open") {
    return {
      label: "PR open",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      tooltip: `#${pr.number} PR open: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "closed") {
    return {
      label: "PR closed",
      colorClass: "text-zinc-500 dark:text-zinc-400/80",
      tooltip: `#${pr.number} PR closed: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "merged") {
    return {
      label: "PR merged",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      tooltip: `#${pr.number} PR merged: ${pr.title}`,
      url: pr.url,
    };
  }
  return null;
}

function threadPrStatusIndicator(
  currentPr: ThreadCurrentPullRequest | null,
  gitPr: ThreadPr | null,
): PrStatusIndicator | null {
  if (gitPr) {
    return prStatusIndicator(gitPr);
  }
  if (!currentPr) return null;
  const link = currentPr.kind === "stack" ? currentPr.top : currentPr.link;
  const state = link.snapshot?.state ?? "open";
  const title = link.snapshot?.title ?? "";
  const isStack = currentPr.kind === "stack" && currentPr.open.length > 1;
  const stackSuffix = isStack ? ` (${currentPr.open.length} in stack)` : "";
  if (state === "open") {
    return {
      label: isStack ? `PR stack (${currentPr.open.length})` : "PR open",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      tooltip: `#${link.number} PR open${stackSuffix}${title ? `: ${title}` : ""}`,
      url: link.url,
    };
  }
  if (state === "closed") {
    return {
      label: "PR closed",
      colorClass: "text-zinc-500 dark:text-zinc-400/80",
      tooltip: `#${link.number} PR closed${title ? `: ${title}` : ""}`,
      url: link.url,
    };
  }
  if (state === "merged") {
    return {
      label: "PR merged",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      tooltip: `#${link.number} PR merged${title ? `: ${title}` : ""}`,
      url: link.url,
    };
  }
  return null;
}

function TabsWordmark() {
  return (
    <span
      aria-label="Tabs"
      className="text-[0.72rem] font-semibold tracking-[0.28em] text-foreground"
    >
      Tabs
    </span>
  );
}

/**
 * Derives the server's HTTP origin (scheme + host + port) from the same
 * sources WsTransport uses, converting ws(s) to http(s).
 */
function getServerHttpOrigin(): string {
  const bridgeUrl = window.desktopBridge?.getWsUrl();
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsUrl =
    bridgeUrl && bridgeUrl.length > 0
      ? bridgeUrl
      : envUrl && envUrl.length > 0
        ? envUrl
        : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:${window.location.port}`;
  // Parse to extract just the origin, dropping path/query (e.g. ?token=…)
  const httpUrl = wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  try {
    return new URL(httpUrl).origin;
  } catch {
    return httpUrl;
  }
}

import { ProjectFavicon } from "./ProjectFavicon";
export { ProjectFavicon };

type SortableProjectHandleProps = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

function ProjectSortMenu({
  projectSortOrder,
  threadSortOrder,
  onProjectSortOrderChange,
  onThreadSortOrderChange,
}: {
  projectSortOrder: SidebarProjectSortOrder;
  threadSortOrder: SidebarThreadSortOrder;
  onProjectSortOrderChange: (sortOrder: SidebarProjectSortOrder) => void;
  onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground" />
          }
        >
          <ArrowUpDownIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="right">Sort projects</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="min-w-44">
        <MenuGroup>
          <div className="px-2 py-1 sm:text-xs font-medium text-muted-foreground">
            Sort projects
          </div>
          <MenuRadioGroup
            value={projectSortOrder}
            onValueChange={(value) => {
              onProjectSortOrderChange(value as SidebarProjectSortOrder);
            }}
          >
            {(Object.entries(SIDEBAR_SORT_LABELS) as Array<[SidebarProjectSortOrder, string]>).map(
              ([value, label]) => (
                <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                  {label}
                </MenuRadioItem>
              ),
            )}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 sm:text-xs font-medium text-muted-foreground">
            Sort threads
          </div>
          <MenuRadioGroup
            value={threadSortOrder}
            onValueChange={(value) => {
              onThreadSortOrderChange(value as SidebarThreadSortOrder);
            }}
          >
            {(
              Object.entries(SIDEBAR_THREAD_SORT_LABELS) as Array<[SidebarThreadSortOrder, string]>
            ).map(([value, label]) => (
              <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                {label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function SortableProjectItem({
  projectKey,
  disabled = false,
  children,
}: {
  projectKey: string;
  disabled?: boolean;
  children: (handleProps: SortableProjectHandleProps) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: projectKey, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={`group/menu-item relative rounded-md ${
        isDragging ? "z-20 opacity-80" : ""
      } ${isOver && !isDragging ? "ring-1 ring-primary/40" : ""}`}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </li>
  );
}

export default function Sidebar() {
  const projects = useAtomValue(readModelStateAtom, (state) => state.projects);
  const threads = useAtomValue(readModelStateAtom, (state) => state.threads);
  const markThreadUnread = markThreadUnreadInAtoms;
  const toggleProject = toggleProjectInAtoms;
  const reorderProjects = reorderProjectsInAtoms;
  const clearComposerDraftForThread = composerDraftActions.clearDraftThread;
  const getDraftThreadByProjectId = composerDraftActions.getDraftThreadByProjectId;
  const terminalStateByThreadId = useAtomValue(
    terminalStateAtom,
    (state) => state.terminalStateByThreadId,
  );
  const clearTerminalState = terminalActions.clear;
  const clearProjectDraftThreadId = composerDraftActions.clearProjectDraftThreadId;
  const clearProjectDraftThreadById = composerDraftActions.clearProjectDraftThreadById;
  const navigate = useNavigate();
  const isOnSettings = useLocation({ select: (loc) => loc.pathname === "/settings" });
  const appSettings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const { handleNewThread } = useHandleNewThread();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const routeEnvironmentId = useParams({
    strict: false,
    select: (params) => (params.environmentId ? (params.environmentId as EnvironmentId) : null),
  });
  const keybindings = useKeybindings() ?? EMPTY_KEYBINDINGS;
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const removeWorktreeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }));
  const [addingProject, setAddingProject] = useState(false);
  const [newCwd, setNewCwd] = useState("");
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const addProjectInputRef = useRef<HTMLInputElement | null>(null);
  const [renamingThreadId, setRenamingThreadId] = useState<ThreadId | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<ProjectId>
  >(() => new Set());
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const dragInProgressRef = useRef(false);
  const suppressProjectClickAfterDragRef = useRef(false);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const { selectedThreadKeys } = useThreadSelection();
  const toggleThreadSelection = threadSelectionActions.toggle;
  const rangeSelectTo = threadSelectionActions.rangeSelectTo;
  const clearSelection = threadSelectionActions.clear;
  const removeFromSelection = threadSelectionActions.remove;
  const setSelectionAnchor = threadSelectionActions.setAnchor;
  const isLinuxDesktop = isElectron && isLinuxPlatform(navigator.platform);
  const shouldBrowseForProjectImmediately = isElectron && !isLinuxDesktop;
  const shouldShowProjectPathEntry = addingProject && !shouldBrowseForProjectImmediately;
  const projectCwdById = useMemo(
    () =>
      new Map(
        projects.map((project) => [`${project.environmentId}:${project.id}`, project.cwd] as const),
      ),
    [projects],
  );
  const threadGitTargets = useMemo(
    () =>
      threads.map((thread) => ({
        environmentId: thread.environmentId,
        threadId: thread.id,
        branch: thread.branch,
        cwd:
          thread.worktreePath ??
          projectCwdById.get(`${thread.environmentId}:${thread.projectId}`) ??
          null,
      })),
    [projectCwdById, threads],
  );
  const threadGitStatusTargets = useMemo(() => {
    const unique = new Map<string, { environmentId: EnvironmentId | undefined; cwd: string }>();
    for (const target of threadGitTargets) {
      if (target.branch === null || target.cwd === null) continue;
      unique.set(`${target.environmentId}:${target.cwd}`, {
        environmentId: target.environmentId,
        cwd: target.cwd,
      });
    }
    return [...unique.values()];
  }, [threadGitTargets]);
  const threadGitStatusQueries = useQueries({
    queries: threadGitStatusTargets.map((target) => ({
      ...gitStatusQueryOptions(target.cwd, target.environmentId),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });
  const prByThreadId = useMemo(() => {
    const statusByCwd = new Map<string, GitStatusResult>();
    for (let index = 0; index < threadGitStatusTargets.length; index += 1) {
      const target = threadGitStatusTargets[index];
      if (!target) continue;
      const status = threadGitStatusQueries[index]?.data;
      if (status) {
        statusByCwd.set(`${target.environmentId}:${target.cwd}`, status);
      }
    }

    const map = new Map<string, ThreadPr>();
    for (const target of threadGitTargets) {
      const status = target.cwd
        ? statusByCwd.get(`${target.environmentId}:${target.cwd}`)
        : undefined;
      const branchMatches =
        target.branch !== null && status?.branch !== null && status?.branch === target.branch;
      map.set(
        `${target.environmentId}:${target.threadId}`,
        branchMatches ? (status?.pr ?? null) : null,
      );
    }
    return map;
  }, [threadGitStatusQueries, threadGitStatusTargets, threadGitTargets]);
  const linkedPrSyncRef = useRef(new Map<string, string>());
  useEffect(() => {
    for (const thread of threads) {
      const threadKey = `${thread.environmentId}:${thread.id}`;
      const pr = prByThreadId.get(threadKey) ?? null;
      let repository: string | null = null;
      if (pr) {
        try {
          repository = new URL(pr.url).pathname.replace(/^\//, "").split("/pull/")[0] ?? null;
        } catch {
          repository = null;
        }
      }
      const next =
        pr && repository
          ? { projectId: thread.projectId, repository, number: pr.number, url: pr.url }
          : null;
      const current = thread.linkedPullRequest ?? null;
      const signature = JSON.stringify(next);
      if (
        current?.projectId === next?.projectId &&
        current?.repository === next?.repository &&
        current?.number === next?.number &&
        current?.url === next?.url
      ) {
        linkedPrSyncRef.current.delete(threadKey);
        continue;
      }
      if (linkedPrSyncRef.current.get(threadKey) === signature) continue;
      linkedPrSyncRef.current.set(threadKey, signature);
      void environmentApi(thread.environmentId)
        .then((api) =>
          api.orchestration.dispatchCommand({
            type: "thread.meta.update",
            commandId: newCommandId(),
            threadId: thread.id,
            linkedPullRequest: next,
          }),
        )
        .catch(() => linkedPrSyncRef.current.delete(threadKey));
    }
  }, [prByThreadId, threads]);

  const openPrLink = useCallback((event: React.MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, []);

  const focusMostRecentThreadForProject = useCallback(
    (projectId: ProjectId, environmentId: EnvironmentId | undefined) => {
      const latestThread = sortThreadsForSidebar(
        threads.filter(
          (thread) => thread.projectId === projectId && thread.environmentId === environmentId,
        ),
        appSettings.sidebarThreadSortOrder,
      )[0];
      if (!latestThread?.environmentId) return;

      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: latestThread.environmentId, threadId: latestThread.id },
      });
    },
    [appSettings.sidebarThreadSortOrder, navigate, threads],
  );

  const addProjectFromPath = useCallback(
    async (rawCwd: string) => {
      const cwd = rawCwd.trim();
      if (!cwd || isAddingProject) return;
      const api = readNativeApi();
      if (!api) return;

      setIsAddingProject(true);
      const finishAddingProject = () => {
        setIsAddingProject(false);
        setNewCwd("");
        setAddProjectError(null);
        setAddingProject(false);
      };

      const existing = projects.find((project) => project.cwd === cwd);
      if (existing) {
        focusMostRecentThreadForProject(existing.id, existing.environmentId);
        finishAddingProject();
        return;
      }

      const projectId = newProjectId();
      const createdAt = new Date().toISOString();
      const title = cwd.split(/[/\\]/).findLast(isNonEmptyString) ?? cwd;
      try {
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title,
          workspaceRoot: cwd,
          defaultModelSelection: makeAppModelSelection("codex", DEFAULT_MODEL),
          createdAt,
        });
        await handleNewThread(projectId, {
          envMode: appSettings.defaultThreadEnvMode,
        }).catch(() => undefined);
      } catch (error) {
        const description =
          error instanceof Error ? error.message : "An error occurred while adding the project.";
        setIsAddingProject(false);
        if (shouldBrowseForProjectImmediately) {
          toastManager.add({
            type: "error",
            title: "Failed to add project",
            description,
          });
        } else {
          setAddProjectError(description);
        }
        return;
      }
      finishAddingProject();
    },
    [
      focusMostRecentThreadForProject,
      handleNewThread,
      isAddingProject,
      projects,
      shouldBrowseForProjectImmediately,
      appSettings.defaultThreadEnvMode,
    ],
  );

  const handleAddProject = () => {
    void addProjectFromPath(newCwd);
  };

  const canAddProject = newCwd.trim().length > 0 && !isAddingProject;

  const handlePickFolder = async () => {
    const api = readNativeApi();
    if (!api || isPickingFolder) return;
    setIsPickingFolder(true);
    let pickedPath: string | null = null;
    try {
      pickedPath = await api.dialogs.pickFolder();
    } catch {
      // Ignore picker failures and leave the current thread selection unchanged.
    }
    if (pickedPath) {
      await addProjectFromPath(pickedPath);
    } else if (!shouldBrowseForProjectImmediately) {
      addProjectInputRef.current?.focus();
    }
    setIsPickingFolder(false);
  };

  const handleStartAddProject = () => {
    setAddProjectError(null);
    if (shouldBrowseForProjectImmediately) {
      void handlePickFolder();
      return;
    }
    setAddingProject((prev) => !prev);
  };

  const cancelRename = useCallback(() => {
    setRenamingThreadId(null);
    renamingInputRef.current = null;
  }, []);

  const commitRename = useCallback(
    async (thread: Thread, newTitle: string, originalTitle: string) => {
      const threadId = thread.id;
      const finishRename = () => {
        setRenamingThreadId((current) => {
          if (current !== threadId) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      try {
        const api = await environmentApi(thread.environmentId);
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      finishRename();
    },
    [],
  );

  /**
   * Delete a single thread: stop session, close terminal, dispatch delete,
   * clean up drafts/state, and optionally remove orphaned worktree.
   * Callers handle thread-level confirmation; this still prompts for worktree removal.
   */
  const deleteThread = useCallback(
    async (
      threadId: ThreadId,
      opts: {
        deletedThreadIds?: ReadonlySet<ThreadId>;
        environmentId?: EnvironmentId | undefined;
      } = {},
    ): Promise<void> => {
      const thread = threads.find(
        (candidate) =>
          candidate.id === threadId &&
          (opts.environmentId === undefined || candidate.environmentId === opts.environmentId),
      );
      if (!thread) return;
      const api = await environmentApi(thread.environmentId);
      const threadProject = projects.find(
        (project) =>
          project.id === thread.projectId && project.environmentId === thread.environmentId,
      );
      // When bulk-deleting, exclude the other threads being deleted so
      // getOrphanedWorktreePathForThread correctly detects that no surviving
      // threads will reference this worktree.
      const deletedIds = opts.deletedThreadIds;
      const environmentThreads = threads.filter(
        (candidate) => candidate.environmentId === thread.environmentId,
      );
      const survivingThreads =
        deletedIds && deletedIds.size > 0
          ? environmentThreads.filter((t) => t.id === threadId || !deletedIds.has(t.id))
          : environmentThreads;
      const orphanedWorktreePath = getOrphanedWorktreePathForThread(survivingThreads, threadId);
      const displayWorktreePath = orphanedWorktreePath
        ? formatWorktreePathForDisplay(orphanedWorktreePath)
        : null;
      const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== undefined;
      const shouldDeleteWorktree =
        canDeleteWorktree &&
        (await confirm(
          [
            "This thread is the only one linked to this worktree:",
            displayWorktreePath ?? orphanedWorktreePath,
            "",
            "Delete the worktree too?",
          ].join("\n"),
        ));

      if (thread.session && thread.session.status !== "closed") {
        await api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }

      try {
        await api.terminal.close({ threadId, deleteHistory: true });
      } catch {
        // Terminal may already be closed
      }

      const allDeletedIds = deletedIds ?? new Set<ThreadId>();
      const shouldNavigateToFallback =
        routeThreadId === threadId && routeEnvironmentId === thread.environmentId;
      const fallbackThreadId = getFallbackThreadIdAfterDelete({
        threads: environmentThreads,
        deletedThreadId: threadId,
        deletedThreadIds: allDeletedIds,
        sortOrder: appSettings.sidebarThreadSortOrder,
      });
      await api.orchestration.dispatchCommand({
        type: "thread.delete",
        commandId: newCommandId(),
        threadId,
      });
      clearComposerDraftForThread(threadId);
      clearProjectDraftThreadById(thread.projectId, thread.id);
      clearTerminalState(threadId);
      if (shouldNavigateToFallback) {
        if (fallbackThreadId) {
          const fallbackThread = threads.find(
            (candidate) =>
              candidate.id === fallbackThreadId && candidate.environmentId === thread.environmentId,
          );
          if (!fallbackThread?.environmentId) {
            void navigate({ to: "/", replace: true });
            return;
          }
          void navigate({
            to: "/$environmentId/$threadId",
            params: {
              environmentId: fallbackThread.environmentId,
              threadId: fallbackThreadId,
            },
            replace: true,
          });
        } else {
          void navigate({ to: "/", replace: true });
        }
      }

      if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
        return;
      }

      try {
        await removeWorktreeMutation.mutateAsync({
          cwd: threadProject.cwd,
          path: orphanedWorktreePath,
          force: true,
          environmentId: threadProject.environmentId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
        console.error("Failed to remove orphaned worktree after thread deletion", {
          threadId,
          projectCwd: threadProject.cwd,
          worktreePath: orphanedWorktreePath,
          error,
        });
        toastManager.add({
          type: "error",
          title: "Thread deleted, but worktree removal failed",
          description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
        });
      }
    },
    [
      appSettings.sidebarThreadSortOrder,
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearTerminalState,
      navigate,
      projects,
      removeWorktreeMutation,
      routeThreadId,
      routeEnvironmentId,
      threads,
    ],
  );

  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{ threadId: ThreadId }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Thread ID copied",
        description: ctx.threadId,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy thread ID",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    },
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: ctx.path,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy path",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    },
  });
  const handleThreadContextMenu = useCallback(
    async (thread: Thread, position: { x: number; y: number }) => {
      const threadId = thread.id;
      const api = await environmentApi(thread.environmentId);
      const threadWorkspacePath =
        thread.worktreePath ??
        projectCwdById.get(`${thread.environmentId}:${thread.projectId}`) ??
        null;
      const snoozePresets = resolveSnoozePresets();
      const clicked = await api.contextMenu.show(
        [
          ...(thread.branch
            ? [{ id: "new-thread-on-branch", label: "New thread on this branch" }]
            : []),
          { id: "rename", label: "Rename thread" },
          {
            id: "regenerate-title",
            label: thread.titleRegeneration ? "Regenerating title…" : "Regenerate title",
            disabled: thread.titleRegeneration !== null && thread.titleRegeneration !== undefined,
          },
          { id: "mark-unread", label: "Mark unread" },
          {
            id: "pin",
            label: thread.pinnedAt ? "Unpin thread" : "Pin thread",
          },
          {
            id: "settle",
            label: thread.settledAt ? "Return to active" : "Settle thread",
          },
          {
            id: "snooze",
            label: isSnoozed(thread) ? "Wake now" : "Snooze",
            ...(isSnoozed(thread)
              ? {}
              : {
                  children: snoozePresets.map((preset) => ({
                    id: `snooze:${preset.id}`,
                    label: `${preset.label} (${preset.whenLabel})`,
                  })),
                }),
          },
          { id: "copy-path", label: "Copy Path" },
          ...(thread.branch ? [{ id: "copy-branch", label: "Copy Branch" }] : []),
          { id: "copy-thread-id", label: "Copy Thread ID" },
          { id: "archive", label: "Archive" },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );

      if (clicked === "new-thread-on-branch") {
        await handleNewThread(thread.projectId, {
          branch: thread.branch,
          worktreePath: thread.worktreePath,
          envMode: thread.worktreePath ? "worktree" : "local",
          environmentId: thread.environmentId,
        });
        return;
      }

      if (clicked === "rename") {
        setRenamingThreadId(threadId);
        setRenamingTitle(thread.title);
        renamingCommittedRef.current = false;
        return;
      }
      if (clicked === "regenerate-title") {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId,
          regenerateTitle: true,
        });
        return;
      }

      if (clicked === "mark-unread") {
        markThreadUnread(threadId);
        return;
      }
      if (clicked === "pin") {
        await api.orchestration.dispatchCommand({
          type: thread.pinnedAt ? "thread.unpin" : "thread.pin",
          commandId: newCommandId(),
          threadId,
        });
        return;
      }
      if (clicked === "settle") {
        if (thread.settledAt) {
          await api.orchestration.dispatchCommand({
            type: "thread.unsettle",
            commandId: newCommandId(),
            threadId,
            reason: "user",
          });
        } else {
          await api.orchestration.dispatchCommand({
            type: "thread.settle",
            commandId: newCommandId(),
            threadId,
          });
        }
        return;
      }
      if (clicked === "snooze" || clicked?.startsWith("snooze:")) {
        const preset = snoozePresets.find((entry) => `snooze:${entry.id}` === clicked);
        await api.orchestration.dispatchCommand(
          isSnoozed(thread)
            ? {
                type: "thread.unsnooze",
                commandId: newCommandId(),
                threadId,
                reason: "user",
              }
            : {
                type: "thread.snooze",
                commandId: newCommandId(),
                threadId,
                snoozedUntil:
                  preset?.snoozedUntil ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              },
        );
        return;
      }
      if (clicked === "copy-path") {
        if (!threadWorkspacePath) {
          toastManager.add({
            type: "error",
            title: "Path unavailable",
            description: "This thread does not have a workspace path to copy.",
          });
          return;
        }
        copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
        return;
      }
      if (clicked === "copy-thread-id") {
        copyThreadIdToClipboard(threadId, { threadId });
        return;
      }
      if (clicked === "copy-branch" && thread.branch) {
        await navigator.clipboard.writeText(thread.branch);
        toastManager.add({ type: "success", title: "Branch copied", description: thread.branch });
        return;
      }
      if (clicked === "archive") {
        const confirmed = await confirm(`Archive thread "${thread.title}"?`);
        if (!confirmed) return;
        await api.orchestration.dispatchCommand({
          type: "thread.archive",
          commandId: newCommandId(),
          threadId,
        });
        return;
      }
      if (clicked !== "delete") return;
      if (appSettings.confirmThreadDelete) {
        const confirmed = await confirm(
          [
            `Delete thread "${thread.title}"?`,
            "This permanently clears conversation history for this thread.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }
      await deleteThread(threadId, { environmentId: thread.environmentId });
    },
    [
      appSettings.confirmThreadDelete,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      deleteThread,
      handleNewThread,
      markThreadUnread,
      projectCwdById,
      threads,
    ],
  );

  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const selectedThreads = [...selectedThreadKeys].flatMap((key) => {
        const ref = parseScopedThreadKey(key);
        if (!ref) return [];
        const thread = threads.find(
          (candidate) =>
            candidate.id === ref.threadId && candidate.environmentId === ref.environmentId,
        );
        return thread ? [thread] : [];
      });
      if (selectedThreads.length === 0) return;
      const count = selectedThreads.length;

      const clicked = await api.contextMenu.show(
        [
          { id: "mark-unread", label: `Mark unread (${count})` },
          { id: "delete", label: `Delete (${count})`, destructive: true },
        ],
        position,
      );

      if (clicked === "mark-unread") {
        for (const thread of selectedThreads) {
          markThreadUnread(thread.id, thread.environmentId);
        }
        clearSelection();
        return;
      }

      if (clicked !== "delete") return;

      if (appSettings.confirmThreadDelete) {
        const confirmed = await confirm(
          [
            `Delete ${count} thread${count === 1 ? "" : "s"}?`,
            "This permanently clears conversation history for these threads.",
          ].join("\n"),
        );
        if (!confirmed) return;
      }

      for (const thread of selectedThreads) {
        const deletedIds = new Set(
          selectedThreads
            .filter((candidate) => candidate.environmentId === thread.environmentId)
            .map((candidate) => candidate.id),
        );
        await deleteThread(thread.id, {
          deletedThreadIds: deletedIds,
          environmentId: thread.environmentId,
        });
      }
      removeFromSelection([...selectedThreadKeys]);
    },
    [
      appSettings.confirmThreadDelete,
      clearSelection,
      deleteThread,
      markThreadUnread,
      removeFromSelection,
      selectedThreadKeys,
      threads,
    ],
  );

  const handleThreadClick = useCallback(
    (
      event: MouseEvent,
      threadId: ThreadId,
      environmentId: EnvironmentId | undefined,
      orderedProjectThreadKeys: readonly string[],
    ) => {
      if (!environmentId) return;
      const threadKey = scopedThreadKey(scopeThreadRef(environmentId, threadId));
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const isShiftClick = event.shiftKey;

      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadKey);
        return;
      }

      if (isShiftClick) {
        event.preventDefault();
        rangeSelectTo(threadKey, orderedProjectThreadKeys);
        return;
      }

      // Plain click — clear selection, set anchor for future shift-clicks, and navigate
      if (selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(threadKey);
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId },
      });
    },
    [
      clearSelection,
      navigate,
      rangeSelectTo,
      selectedThreadKeys.size,
      setSelectionAnchor,
      toggleThreadSelection,
    ],
  );

  const handleProjectContextMenu = useCallback(
    async (project: Project, position: { x: number; y: number }) => {
      const projectId = project.id;
      const api = await environmentApi(project.environmentId);
      const clicked = await api.contextMenu.show(
        [{ id: "delete", label: "Remove project", destructive: true }],
        position,
      );
      if (clicked !== "delete") return;

      const projectThreads = threads.filter(
        (thread) =>
          thread.projectId === projectId && thread.environmentId === project.environmentId,
      );
      if (projectThreads.length > 0) {
        toastManager.add({
          type: "warning",
          title: "Project is not empty",
          description: "Delete all threads in this project before removing it.",
        });
        return;
      }

      const confirmed = await confirm(`Remove project "${project.name}"?`);
      if (!confirmed) return;

      try {
        const projectDraftThread = getDraftThreadByProjectId(projectId);
        if (projectDraftThread) {
          clearComposerDraftForThread(projectDraftThread.threadId);
        }
        clearProjectDraftThreadId(projectId);
        await api.orchestration.dispatchCommand({
          type: "project.delete",
          commandId: newCommandId(),
          projectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing project.";
        console.error("Failed to remove project", { projectId, error });
        toastManager.add({
          type: "error",
          title: `Failed to remove "${project.name}"`,
          description: message,
        });
      }
    },
    [clearComposerDraftForThread, clearProjectDraftThreadId, getDraftThreadByProjectId, threads],
  );

  const projectDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const projectCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return closestCorners(args);
  }, []);

  const handleProjectDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (appSettings.sidebarProjectSortOrder !== "manual") {
        dragInProgressRef.current = false;
        return;
      }
      dragInProgressRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeProject = projects.find(
        (project) => projectUiStateKey(project.environmentId, project.id) === active.id,
      );
      const overProject = projects.find(
        (project) => projectUiStateKey(project.environmentId, project.id) === over.id,
      );
      if (!activeProject || !overProject) return;
      reorderProjects(
        activeProject.id,
        overProject.id,
        activeProject.environmentId,
        overProject.environmentId,
      );
    },
    [appSettings.sidebarProjectSortOrder, projects, reorderProjects],
  );

  const handleProjectDragStart = useCallback(
    (_event: DragStartEvent) => {
      if (appSettings.sidebarProjectSortOrder !== "manual") {
        return;
      }
      dragInProgressRef.current = true;
      suppressProjectClickAfterDragRef.current = true;
    },
    [appSettings.sidebarProjectSortOrder],
  );

  const handleProjectDragCancel = useCallback((_event: DragCancelEvent) => {
    dragInProgressRef.current = false;
  }, []);

  // Long sidebar lists must not install per-row geometry polling. CSS handles
  // the small hover/state transitions without keeping the renderer busy while idle.
  const attachProjectListAutoAnimateRef = useCallback((_node: HTMLElement | null) => {}, []);
  const attachThreadListAutoAnimateRef = useCallback((_node: HTMLElement | null) => {}, []);

  const handleProjectTitlePointerDownCapture = useCallback(() => {
    suppressProjectClickAfterDragRef.current = false;
  }, []);

  const sortedProjects = useMemo(
    () => sortProjectsForSidebar(projects, threads, appSettings.sidebarProjectSortOrder),
    [appSettings.sidebarProjectSortOrder, projects, threads],
  );
  const isManualProjectSorting = appSettings.sidebarProjectSortOrder === "manual";

  function renderProjectItem(
    project: (typeof sortedProjects)[number],
    dragHandleProps: SortableProjectHandleProps | null,
  ) {
    const projectThreads = sortThreadsForSidebar(
      threads.filter(
        (thread) =>
          thread.projectId === project.id && thread.environmentId === project.environmentId,
      ),
      appSettings.sidebarThreadSortOrder,
    ).toSorted((left, right) => {
      const rank = (thread: (typeof threads)[number]) => {
        const status = resolveThreadStatusPill({
          thread,
          hasPendingApprovals: derivePendingApprovals(thread.activities).length > 0,
          hasPendingUserInput: derivePendingUserInputs(thread.activities).length > 0,
        });
        if (status) return 0;
        const entry = thread;
        if (entry.pinnedAt) return 1;
        if (isSnoozed(entry)) return 3;
        if (isSettled(entry, thread.updatedAt ?? thread.createdAt)) return 4;
        return 2;
      };
      const rankDelta = rank(left) - rank(right);
      if (rankDelta !== 0) return rankDelta;
      if (left.pinnedAt && right.pinnedAt) {
        return sortPinnedThreads([left, right])[0]?.id === left.id ? -1 : 1;
      }
      return 0;
    });
    const projectStatus = resolveProjectStatusIndicator(
      projectThreads.map((thread) =>
        resolveThreadStatusPill({
          thread,
          hasPendingApprovals: derivePendingApprovals(thread.activities).length > 0,
          hasPendingUserInput: derivePendingUserInputs(thread.activities).length > 0,
        }),
      ),
    );
    const activeThreadId = routeThreadId ?? undefined;
    const isThreadListExpanded = expandedThreadListsByProject.has(project.id);
    const pinnedCollapsedThread =
      !project.expanded && activeThreadId
        ? (projectThreads.find(
            (thread) => thread.id === activeThreadId && thread.environmentId === routeEnvironmentId,
          ) ?? null)
        : null;
    const shouldShowThreadPanel = project.expanded || pinnedCollapsedThread !== null;
    const { hasHiddenThreads, visibleThreads } = getVisibleThreadsForProject({
      threads: projectThreads,
      activeThreadId,
      isThreadListExpanded,
      previewLimit: THREAD_PREVIEW_LIMIT,
    });
    const orderedProjectThreadKeys = projectThreads.flatMap((thread) =>
      thread.environmentId
        ? [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))]
        : [],
    );
    const renderedThreads = pinnedCollapsedThread ? [pinnedCollapsedThread] : visibleThreads;
    const renderThreadRow = (thread: (typeof projectThreads)[number]) => {
      const isActive = routeThreadId === thread.id && routeEnvironmentId === thread.environmentId;
      const threadKey = thread.environmentId
        ? scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
        : thread.id;
      const isSelected = selectedThreadKeys.has(threadKey);
      const isHighlighted = isActive || isSelected;
      const threadStatus = resolveThreadStatusPill({
        thread,
        hasPendingApprovals: derivePendingApprovals(thread.activities).length > 0,
        hasPendingUserInput: derivePendingUserInputs(thread.activities).length > 0,
      });
      const currentPr = resolveThreadCurrentPullRequest(thread.pullRequests ?? []);
      const prStatus = threadPrStatusIndicator(currentPr, prByThreadId.get(threadKey) ?? null);
      const terminalStatus = terminalStatusFromRunningIds(
        selectThreadTerminalState(terminalStateByThreadId, thread.id).runningTerminalIds,
      );
      const lifecycleEntry = thread;

      return (
        <SidebarMenuSubItem
          key={`${thread.environmentId}:${thread.id}`}
          className="w-full"
          data-thread-item
        >
          <SidebarMenuSubButton
            render={<div role="button" tabIndex={0} />}
            size="sm"
            isActive={isActive}
            className={resolveThreadRowClassName({
              isActive,
              isSelected,
            })}
            onClick={(event) => {
              handleThreadClick(event, thread.id, thread.environmentId, orderedProjectThreadKeys);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              if (selectedThreadKeys.size > 0) {
                clearSelection();
              }
              setSelectionAnchor(threadKey);
              if (thread.environmentId) {
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: { environmentId: thread.environmentId, threadId: thread.id },
                });
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              if (selectedThreadKeys.size > 0 && selectedThreadKeys.has(threadKey)) {
                void handleMultiSelectContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                });
              } else {
                if (selectedThreadKeys.size > 0) {
                  clearSelection();
                }
                void handleThreadContextMenu(thread, {
                  x: event.clientX,
                  y: event.clientY,
                });
              }
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
              {prStatus && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={prStatus.tooltip}
                        className={`inline-flex items-center justify-center ${prStatus.colorClass} cursor-pointer rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring`}
                        onClick={(event) => {
                          openPrLink(event, prStatus.url);
                        }}
                      >
                        <GitPullRequestIcon className="size-3" />
                      </button>
                    }
                  />
                  <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
                </Tooltip>
              )}
              {threadStatus && (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] ${threadStatus.colorClass}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${threadStatus.dotClass} ${
                      threadStatus.pulse ? "animate-pulse" : ""
                    }`}
                  />
                  <span className="hidden md:inline">{threadStatus.label}</span>
                </span>
              )}
              {!threadStatus && lifecycleEntry.pinnedAt && (
                <PinIcon aria-label="Pinned" className="size-3 text-foreground" />
              )}
              {!threadStatus && isSnoozed(lifecycleEntry) && (
                <Clock3Icon aria-label="Snoozed" className="size-3 text-blue-500" />
              )}
              {!threadStatus && isSettled(lifecycleEntry, thread.updatedAt ?? thread.createdAt) && (
                <CircleCheckIcon aria-label="Settled" className="size-3 text-muted-foreground/50" />
              )}
              {renamingThreadId === thread.id ? (
                <input
                  ref={(el) => {
                    if (el && renamingInputRef.current !== el) {
                      renamingInputRef.current = el;
                      el.focus();
                      el.select();
                    }
                  }}
                  className="min-w-0 flex-1 truncate text-xs bg-transparent outline-none border border-ring rounded px-0.5"
                  value={renamingTitle}
                  onChange={(e) => setRenamingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      renamingCommittedRef.current = true;
                      void commitRename(thread, renamingTitle, thread.title);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      renamingCommittedRef.current = true;
                      cancelRename();
                    }
                  }}
                  onBlur={() => {
                    if (!renamingCommittedRef.current) {
                      void commitRename(thread, renamingTitle, thread.title);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-xs">{thread.title}</span>
              )}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {terminalStatus && (
                <span
                  role="img"
                  aria-label={terminalStatus.label}
                  title={terminalStatus.label}
                  className={`inline-flex items-center justify-center ${terminalStatus.colorClass}`}
                >
                  <TerminalIcon
                    className={`size-3 ${terminalStatus.pulse ? "animate-pulse" : ""}`}
                  />
                </span>
              )}
              <span
                className={`text-[10px] ${
                  isHighlighted
                    ? "text-foreground/72 dark:text-foreground/82"
                    : "text-muted-foreground/40"
                }`}
              >
                {formatRelativeTime(thread.updatedAt ?? thread.createdAt)}
              </span>
            </div>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      );
    };

    return (
      <Collapsible className="group/collapsible" open={shouldShowThreadPanel}>
        <div className="group/project-header relative">
          <SidebarMenuButton
            ref={isManualProjectSorting ? dragHandleProps?.setActivatorNodeRef : undefined}
            size="sm"
            className={`gap-2 px-2 py-1.5 text-left hover:bg-accent group-hover/project-header:bg-accent group-hover/project-header:text-sidebar-accent-foreground ${
              isManualProjectSorting ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
            }`}
            {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.attributes : {})}
            {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.listeners : {})}
            onPointerDownCapture={handleProjectTitlePointerDownCapture}
            onClick={(event) => handleProjectTitleClick(event, project.id, project.environmentId)}
            onKeyDown={(event) =>
              handleProjectTitleKeyDown(event, project.id, project.environmentId)
            }
            onContextMenu={(event) => {
              event.preventDefault();
              void handleProjectContextMenu(project, {
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            {!project.expanded && projectStatus ? (
              <span
                aria-hidden="true"
                title={projectStatus.label}
                className={`-ml-0.5 relative inline-flex size-3.5 shrink-0 items-center justify-center ${projectStatus.colorClass}`}
              >
                <span className="absolute inset-0 flex items-center justify-center transition-opacity duration-150 group-hover/project-header:opacity-0">
                  <span
                    className={`size-[9px] rounded-full ${projectStatus.dotClass} ${
                      projectStatus.pulse ? "animate-pulse" : ""
                    }`}
                  />
                </span>
                <ChevronRightIcon className="absolute inset-0 m-auto size-3.5 text-muted-foreground/70 opacity-0 transition-opacity duration-150 group-hover/project-header:opacity-100" />
              </span>
            ) : (
              <ChevronRightIcon
                className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${
                  project.expanded ? "rotate-90" : ""
                }`}
              />
            )}
            <ProjectFavicon
              project={{
                workspaceRoot: project.cwd,
                title: project.name,
                faviconPath: project.faviconPath,
                projectIcon: project.projectIcon,
                environmentId: project.environmentId,
              }}
            />
            <span className="flex-1 truncate text-xs font-medium text-foreground/90">
              {project.name}
            </span>
          </SidebarMenuButton>
          <Tooltip>
            <TooltipTrigger
              render={
                <SidebarMenuAction
                  render={
                    <button
                      type="button"
                      aria-label={`Create new thread in ${project.name}`}
                      data-testid="new-thread-button"
                    />
                  }
                  showOnHover
                  className="top-1 right-1 size-5 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void handleNewThread(project.id, {
                      environmentId: project.environmentId,
                      envMode: resolveSidebarNewThreadEnvMode({
                        defaultEnvMode: appSettings.defaultThreadEnvMode,
                      }),
                    });
                  }}
                >
                  <SquarePenIcon className="size-3.5" />
                </SidebarMenuAction>
              }
            />
            <TooltipPopup side="top">
              {newThreadShortcutLabel ? `New thread (${newThreadShortcutLabel})` : "New thread"}
            </TooltipPopup>
          </Tooltip>
        </div>

        <CollapsibleContent>
          <SidebarMenuSub
            ref={attachThreadListAutoAnimateRef}
            className="mx-1 my-0 w-full translate-x-0 gap-0.5 px-1.5 py-0"
          >
            {renderedThreads.map((thread) => renderThreadRow(thread))}

            {project.expanded && hasHiddenThreads && !isThreadListExpanded && (
              <SidebarMenuSubItem className="w-full">
                <SidebarMenuSubButton
                  render={<button type="button" />}
                  data-thread-selection-safe
                  size="sm"
                  className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                  onClick={() => {
                    expandThreadListForProject(project.id);
                  }}
                >
                  <span>Show more</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
            {project.expanded && hasHiddenThreads && isThreadListExpanded && (
              <SidebarMenuSubItem className="w-full">
                <SidebarMenuSubButton
                  render={<button type="button" />}
                  data-thread-selection-safe
                  size="sm"
                  className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                  onClick={() => {
                    collapseThreadListForProject(project.id);
                  }}
                >
                  <span>Show less</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  const handleProjectTitleClick = useCallback(
    (
      event: React.MouseEvent<HTMLButtonElement>,
      projectId: ProjectId,
      environmentId?: EnvironmentId,
    ) => {
      if (dragInProgressRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (suppressProjectClickAfterDragRef.current) {
        // Consume the synthetic click emitted after a drag release.
        suppressProjectClickAfterDragRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (selectedThreadKeys.size > 0) {
        clearSelection();
      }
      toggleProject(projectId, environmentId);
    },
    [clearSelection, selectedThreadKeys.size, toggleProject],
  );

  const handleProjectTitleKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLButtonElement>,
      projectId: ProjectId,
      environmentId?: EnvironmentId,
    ) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (dragInProgressRef.current) {
        return;
      }
      toggleProject(projectId, environmentId);
    },
    [toggleProject],
  );

  useEffect(() => {
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (selectedThreadKeys.size === 0) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!shouldClearThreadSelectionOnMouseDown(target)) return;
      clearSelection();
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [clearSelection, selectedThreadKeys.size]);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setDesktopUpdateState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setDesktopUpdateState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const showDesktopUpdateButton = isElectron && shouldShowDesktopUpdateButton(desktopUpdateState);

  const desktopUpdateTooltip = desktopUpdateState
    ? getDesktopUpdateButtonTooltip(desktopUpdateState)
    : "Update available";
  const desktopUpdateReleaseNotesPreview = desktopUpdateState
    ? getDesktopUpdateReleaseNotesPreview(desktopUpdateState)
    : null;

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(desktopUpdateState);
  const arm64IntelBuildWarningDescription =
    desktopUpdateState && showArm64IntelBuildWarning
      ? getArm64IntelBuildWarningDescription(desktopUpdateState)
      : null;
  const desktopUpdateButtonInteractivityClasses = desktopUpdateButtonDisabled
    ? "cursor-not-allowed opacity-60"
    : "hover:bg-accent hover:text-foreground";
  const desktopUpdateButtonClasses =
    desktopUpdateState?.status === "downloaded"
      ? "text-emerald-600 dark:text-emerald-400"
      : desktopUpdateState?.status === "downloading"
        ? "text-sky-600 dark:text-sky-400"
        : shouldHighlightDesktopUpdateError(desktopUpdateState)
          ? "text-rose-600 dark:text-rose-500 animate-pulse"
          : "text-amber-600 dark:text-amber-500 animate-pulse";
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newLocal") ??
    shortcutLabelForCommand(keybindings, "chat.new");

  const handleDesktopUpdateButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (desktopUpdateButtonDisabled || desktopUpdateButtonAction === "none") return;

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not start update download",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
    }
  }, [desktopUpdateButtonAction, desktopUpdateButtonDisabled, desktopUpdateState]);

  const expandThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (current.has(projectId)) return current;
      const next = new Set(current);
      next.add(projectId);
      return next;
    });
  }, []);

  const collapseThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (!current.has(projectId)) return current;
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
  }, []);

  const wordmark = (
    <div className="flex items-center gap-2">
      <SidebarTrigger className="shrink-0 md:hidden" />
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="flex min-w-0 flex-1 items-center gap-1 ml-1 cursor-pointer">
              <TabsWordmark />
              <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
                Code
              </span>
              <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
                {APP_STAGE_LABEL}
              </span>
            </div>
          }
        />
        <TooltipPopup side="bottom" sideOffset={2}>
          Version {APP_VERSION}
        </TooltipPopup>
      </Tooltip>
    </div>
  );

  return (
    <>
      {isElectron ? (
        <>
          <SidebarHeader
            className={`drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 ${
              isWindowsDesktop ? "" : "pl-[90px]"
            }`}
          >
            {wordmark}
            {showDesktopUpdateButton && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={desktopUpdateTooltip}
                      aria-disabled={desktopUpdateButtonDisabled || undefined}
                      disabled={desktopUpdateButtonDisabled}
                      className={`inline-flex size-7 ml-auto mt-1.5 items-center justify-center rounded-md text-muted-foreground transition-colors ${desktopUpdateButtonInteractivityClasses} ${desktopUpdateButtonClasses}`}
                      onClick={handleDesktopUpdateButtonClick}
                    >
                      <RocketIcon className="size-3.5" />
                    </button>
                  }
                />
                <TooltipPopup
                  side="bottom"
                  align="end"
                  className="max-w-sm whitespace-pre-line text-left"
                >
                  <span className="font-medium">{desktopUpdateTooltip}</span>
                  {desktopUpdateReleaseNotesPreview ? (
                    <span className="mt-1 block text-muted-foreground">
                      {desktopUpdateReleaseNotesPreview}
                    </span>
                  ) : null}
                </TooltipPopup>
              </Tooltip>
            )}
          </SidebarHeader>
        </>
      ) : (
        <SidebarHeader className="gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3">
          {wordmark}
        </SidebarHeader>
      )}

      <SidebarContent className="gap-0">
        {showArm64IntelBuildWarning && arm64IntelBuildWarningDescription ? (
          <SidebarGroup className="px-2 pt-2 pb-0">
            <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8">
              <TriangleAlertIcon />
              <AlertTitle>Intel build on Apple Silicon</AlertTitle>
              <AlertDescription>{arm64IntelBuildWarningDescription}</AlertDescription>
              {desktopUpdateButtonAction !== "none" ? (
                <AlertAction>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={desktopUpdateButtonDisabled}
                    onClick={handleDesktopUpdateButtonClick}
                  >
                    {desktopUpdateButtonAction === "download"
                      ? "Download ARM build"
                      : "Install ARM build"}
                  </Button>
                </AlertAction>
              ) : null}
            </Alert>
          </SidebarGroup>
        ) : null}
        <SidebarGroup className="px-2 py-2">
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Projects
            </span>
            <div className="flex items-center gap-1">
              <ProjectSortMenu
                projectSortOrder={appSettings.sidebarProjectSortOrder}
                threadSortOrder={appSettings.sidebarThreadSortOrder}
                onProjectSortOrderChange={(sortOrder) => {
                  updateSettings({ sidebarProjectSortOrder: sortOrder });
                }}
                onThreadSortOrderChange={(sortOrder) => {
                  updateSettings({ sidebarThreadSortOrder: sortOrder });
                }}
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={shouldShowProjectPathEntry ? "Cancel add project" : "Add project"}
                      aria-pressed={shouldShowProjectPathEntry}
                      className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                      onClick={handleStartAddProject}
                    />
                  }
                >
                  <PlusIcon
                    className={`size-3.5 transition-transform duration-150 ${
                      shouldShowProjectPathEntry ? "rotate-45" : "rotate-0"
                    }`}
                  />
                </TooltipTrigger>
                <TooltipPopup side="right">
                  {shouldShowProjectPathEntry ? "Cancel add project" : "Add project"}
                </TooltipPopup>
              </Tooltip>
            </div>
          </div>

          {shouldShowProjectPathEntry && (
            <div className="mb-2 px-1">
              {isElectron && (
                <button
                  type="button"
                  className="mb-1.5 flex w-full items-center justify-center gap-2 rounded-md border border-border bg-secondary py-1.5 text-xs text-foreground/80 transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void handlePickFolder()}
                  disabled={isPickingFolder || isAddingProject}
                >
                  <FolderIcon className="size-3.5" />
                  {isPickingFolder ? "Picking folder..." : "Browse for folder"}
                </button>
              )}
              <div className="flex gap-1.5">
                <input
                  ref={addProjectInputRef}
                  className={`min-w-0 flex-1 rounded-md border bg-secondary px-2 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none ${
                    addProjectError
                      ? "border-red-500/70 focus:border-red-500"
                      : "border-border focus:border-ring"
                  }`}
                  placeholder="/path/to/project"
                  value={newCwd}
                  onChange={(event) => {
                    setNewCwd(event.target.value);
                    setAddProjectError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleAddProject();
                    if (event.key === "Escape") {
                      setAddingProject(false);
                      setAddProjectError(null);
                    }
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 disabled:opacity-60"
                  onClick={handleAddProject}
                  disabled={!canAddProject}
                >
                  {isAddingProject ? "Adding..." : "Add"}
                </button>
              </div>
              {addProjectError && (
                <p className="mt-1 px-0.5 text-[11px] leading-tight text-red-600 dark:text-red-400">
                  {addProjectError}
                </p>
              )}
              <div className="mt-1.5 px-0.5">
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                  onClick={() => {
                    setAddingProject(false);
                    setAddProjectError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {isManualProjectSorting ? (
            <DndContext
              sensors={projectDnDSensors}
              collisionDetection={projectCollisionDetection}
              modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
              onDragStart={handleProjectDragStart}
              onDragEnd={handleProjectDragEnd}
              onDragCancel={handleProjectDragCancel}
            >
              <SidebarMenu>
                <SortableContext
                  items={sortedProjects.map((project) =>
                    projectUiStateKey(project.environmentId, project.id),
                  )}
                  strategy={verticalListSortingStrategy}
                >
                  {sortedProjects.map((project) => (
                    <SortableProjectItem
                      key={`${project.environmentId}:${project.id}`}
                      projectKey={projectUiStateKey(project.environmentId, project.id)}
                    >
                      {(dragHandleProps) => renderProjectItem(project, dragHandleProps)}
                    </SortableProjectItem>
                  ))}
                </SortableContext>
              </SidebarMenu>
            </DndContext>
          ) : (
            <SidebarMenu ref={attachProjectListAutoAnimateRef}>
              {sortedProjects.map((project) => (
                <SidebarMenuItem
                  key={`${project.environmentId}:${project.id}`}
                  className="rounded-md"
                >
                  {renderProjectItem(project, null)}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          )}

          {projects.length === 0 && !shouldShowProjectPathEntry && (
            <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
              No projects yet
            </div>
          )}
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            {isOnSettings ? (
              <SidebarMenuButton
                size="sm"
                className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                onClick={() => window.history.back()}
              >
                <ArrowLeftIcon className="size-3.5" />
                <span className="text-xs">Back</span>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                size="sm"
                className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                onClick={() => void navigate({ to: "/settings" })}
              >
                <SettingsIcon className="size-3.5" />
                <span className="text-xs">Settings</span>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      {confirmDialog}
    </>
  );
}
