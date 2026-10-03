import {
  type KeybindingCommand,
  type FilesystemBrowseEntry,
  type SidebarThreadSortOrder,
} from "@tabs/contracts";
import {
  threadPullRequestSearchTerms,
  resolveThreadCurrentPullRequest,
} from "@tabs/shared/threadPullRequests";
import { type ReactNode } from "react";
import { type Project, type Thread } from "../types";

export const RECENT_THREAD_LIMIT = 12;
export const ITEM_ICON_CLASS = "size-4 text-muted-foreground/80";
export const ADDON_ICON_CLASS = "size-4";

export interface CommandPaletteItem {
  readonly kind: "action" | "submenu";
  readonly value: string;
  readonly searchTerms: ReadonlyArray<string>;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly timestamp?: string;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  /** Optional content rendered inline before the title text. */
  readonly titleLeadingContent?: ReactNode;
  /** Optional content rendered inline after the title text (before the timestamp). */
  readonly titleTrailingContent?: ReactNode;
  readonly shortcutCommand?: KeybindingCommand;
}

export interface CommandPaletteActionItem extends CommandPaletteItem {
  readonly kind: "action";
  readonly keepOpen?: boolean;
  readonly run: () => Promise<void>;
}

export interface CommandPaletteSubmenuItem extends CommandPaletteItem {
  readonly kind: "submenu";
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

export interface CommandPaletteGroup {
  readonly value: string;
  readonly label: string;
  readonly items: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
}

export interface CommandPaletteView {
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

export type CommandPaletteMode = "root" | "root-browse" | "submenu" | "submenu-browse";

export type SearchOverlayMode = "command" | "files" | "content";

export type CommandPaletteOpenIntent =
  | { readonly kind: "add-project" }
  | {
      readonly kind: "search";
      readonly query: string;
    };

export interface CommandPaletteUiState {
  readonly open: boolean;
  readonly mode: SearchOverlayMode;
  readonly openIntent: CommandPaletteOpenIntent | null;
}

export type CommandPaletteUiAction =
  | { readonly _tag: "SetOpen"; readonly open: boolean }
  | { readonly _tag: "ToggleMode"; readonly mode: SearchOverlayMode }
  | { readonly _tag: "OpenAddProject" }
  | { readonly _tag: "ClearOpenIntent" };

export function reduceCommandPaletteUiState(
  state: CommandPaletteUiState,
  action: CommandPaletteUiAction,
): CommandPaletteUiState {
  switch (action._tag) {
    case "SetOpen":
      return action.open
        ? { open: true, mode: "command", openIntent: state.openIntent }
        : { ...state, open: false, openIntent: null };
    case "ToggleMode":
      return state.open && state.mode === action.mode
        ? { ...state, open: false, openIntent: null }
        : { open: true, mode: action.mode, openIntent: null };
    case "OpenAddProject":
      return { open: true, mode: "command", openIntent: { kind: "add-project" } };
    case "ClearOpenIntent":
      return { ...state, openIntent: null };
  }
}

export function resolveCommandPaletteWorkspaceContext(input: {
  projects: ReadonlyArray<Project>;
  threads: ReadonlyArray<Thread>;
  threadId: string | null;
  environmentId: string | null;
}): { project: Project | null; thread: Thread | null } {
  const thread =
    input.threads.find(
      (candidate) =>
        candidate.id === input.threadId &&
        (input.environmentId === null || candidate.environmentId === input.environmentId),
    ) ?? null;
  const project =
    input.projects.find(
      (candidate) =>
        candidate.id === thread?.projectId &&
        (input.environmentId === null || candidate.environmentId === input.environmentId),
    ) ?? null;
  return { project, thread };
}

export function filterBrowseEntries(input: {
  browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  browseFilterQuery: string;
  highlightedItemValue: string | null;
}): {
  filteredEntries: FilesystemBrowseEntry[];
  highlightedEntry: FilesystemBrowseEntry | null;
  exactEntry: FilesystemBrowseEntry | null;
} {
  const lowerFilter = input.browseFilterQuery.toLowerCase();
  const showHidden = input.browseFilterQuery.startsWith(".");

  const filteredEntries = input.browseEntries.filter(
    (entry) =>
      entry.name.toLowerCase().startsWith(lowerFilter) &&
      (showHidden || !entry.name.startsWith(".")),
  );

  let highlightedEntry: FilesystemBrowseEntry | null = null;
  if (input.highlightedItemValue?.startsWith("browse:")) {
    const highlightedPath = input.highlightedItemValue.slice("browse:".length);
    highlightedEntry = filteredEntries.find((entry) => entry.fullPath === highlightedPath) ?? null;
  }

  const exactEntry =
    input.browseFilterQuery.length > 0
      ? (filteredEntries.find((entry) => entry.name === input.browseFilterQuery) ?? null)
      : null;

  return { filteredEntries, highlightedEntry, exactEntry };
}

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export type CommandPaletteProject = Project & { readonly displayName?: string };

export function resolveEnvironmentLabel(
  environmentId: string | undefined,
  locationByEnvironmentId?: ReadonlyMap<string, { readonly label: string }>,
): string {
  if (!environmentId) return "Local";
  const match = locationByEnvironmentId?.get(environmentId);
  if (match?.label) return match.label;
  if (environmentId === "local" || environmentId === "default") return "Local";
  return environmentId;
}

export function buildCommandPaletteProjectMetadata(input: {
  readonly projects: ReadonlyArray<
    Pick<Project, "name" | "cwd"> & { readonly environmentId?: string | undefined }
  >;
  readonly locationByEnvironmentId?: ReadonlyMap<string, { readonly label: string }>;
}): { searchTerms: string[]; environmentLabels: string[] } {
  const searchTerms: string[] = [];
  const environmentLabels = new Set<string>();

  for (const project of input.projects) {
    const label = resolveEnvironmentLabel(project.environmentId, input.locationByEnvironmentId);
    searchTerms.push(project.name, project.cwd, label);
    environmentLabels.add(label);
  }

  return { searchTerms, environmentLabels: [...environmentLabels] };
}

export function buildProjectActionItems(input: {
  projects: ReadonlyArray<CommandPaletteProject>;
  valuePrefix: string;
  icon: (project: CommandPaletteProject) => ReactNode;
  runProject: (project: CommandPaletteProject) => Promise<void>;
  locationByEnvironmentId?: ReadonlyMap<string, { readonly label: string }>;
  searchTerms?: (project: CommandPaletteProject) => ReadonlyArray<string>;
  renderDescription?: (project: CommandPaletteProject) => string | undefined;
  renderTrailingContent?: (project: CommandPaletteProject) => ReactNode;
  shortcutCommand?: KeybindingCommand;
}): CommandPaletteActionItem[] {
  const hasMultipleEnvironments =
    new Set(input.projects.map((p) => p.environmentId ?? "local")).size > 1;
  const projectCountsByName = new Map<string, number>();
  for (const p of input.projects) {
    projectCountsByName.set(p.name, (projectCountsByName.get(p.name) ?? 0) + 1);
  }

  return input.projects.map((project) => {
    const displayName = project.displayName ?? project.name;
    const envId = project.environmentId ?? "local";
    const envLabel = resolveEnvironmentLabel(project.environmentId, input.locationByEnvironmentId);
    const isAmbiguous =
      hasMultipleEnvironments ||
      (projectCountsByName.get(project.name) ?? 0) > 1 ||
      (envId !== "local" && envId !== "default");
    const extraSearchTerms = input.searchTerms?.(project) ?? [];

    const defaultDescription = isAmbiguous ? `${project.cwd} · ${envLabel}` : project.cwd;

    return {
      kind: "action",
      value: `${input.valuePrefix}:${envId}:${project.id}`,
      searchTerms: [displayName, project.name, project.cwd, envLabel, ...extraSearchTerms],
      title: displayName,
      description: input.renderDescription?.(project) ?? defaultDescription,
      icon: input.icon(project),
      ...(input.renderTrailingContent
        ? { titleTrailingContent: input.renderTrailingContent(project) }
        : {}),
      ...(input.shortcutCommand !== undefined ? { shortcutCommand: input.shortcutCommand } : {}),
      run: async () => {
        await input.runProject(project);
      },
    };
  });
}

export interface ThreadSortInput {
  readonly createdAt: string;
  readonly updatedAt?: string | undefined;
  readonly latestUserMessageAt?: string | null;
  readonly messages?: ReadonlyArray<{
    readonly createdAt?: string | undefined;
  }>;
}

export function toSortableTimestamp(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function getFirstSortableTimestamp(...values: Array<string | null | undefined>): number | null {
  for (const value of values) {
    const timestamp = toSortableTimestamp(value ?? undefined);
    if (timestamp !== null) {
      return timestamp;
    }
  }
  return null;
}

function getLatestUserMessageTimestamp(thread: Thread): number {
  let latestUserMessageTimestamp: number | null = null;

  for (const message of thread.messages ?? []) {
    if (message.role !== "user") continue;
    const messageTimestamp = toSortableTimestamp(message.createdAt);
    if (messageTimestamp === null) continue;
    latestUserMessageTimestamp =
      latestUserMessageTimestamp === null
        ? messageTimestamp
        : Math.max(latestUserMessageTimestamp, messageTimestamp);
  }

  if (latestUserMessageTimestamp !== null) {
    return latestUserMessageTimestamp;
  }

  return getFirstSortableTimestamp(thread.updatedAt, thread.createdAt) ?? Number.NEGATIVE_INFINITY;
}

export function getThreadSortTimestamp(thread: Thread, sortOrder: SidebarThreadSortOrder): number {
  if (sortOrder === "created_at") {
    return (
      getFirstSortableTimestamp(thread.createdAt, thread.updatedAt) ?? Number.NEGATIVE_INFINITY
    );
  }
  return getLatestUserMessageTimestamp(thread);
}

export function sortThreads(
  threads: readonly Thread[],
  sortOrder: SidebarThreadSortOrder,
): Thread[] {
  return [...threads].sort((left, right) => {
    const rightTimestamp = getThreadSortTimestamp(right, sortOrder);
    const leftTimestamp = getThreadSortTimestamp(left, sortOrder);
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return right.id.localeCompare(left.id);
  });
}

export function buildThreadActionItems(input: {
  threads: ReadonlyArray<Thread>;
  activeThreadId?: Thread["id"];
  projectTitleById: ReadonlyMap<string, string>;
  sortOrder: SidebarThreadSortOrder;
  icon: ReactNode;
  locationByEnvironmentId?: ReadonlyMap<string, { readonly label: string }>;
  /** Optional content rendered inline before the title text per-thread. */
  renderLeadingContent?: (thread: Thread) => ReactNode;
  /** Optional content rendered inline after the title text per-thread. */
  renderTrailingContent?: (thread: Thread) => ReactNode;
  renderDescription?: (
    thread: Thread,
    meta: { projectTitle: string | undefined; environmentLabel: string },
  ) => string | undefined;
  runThread: (thread: Thread) => Promise<void>;
  limit?: number;
}): CommandPaletteActionItem[] {
  const sortedThreads = sortThreads(
    input.threads.filter((thread) => thread.archivedAt === null),
    input.sortOrder,
  );
  const visibleThreads =
    input.limit === undefined ? sortedThreads : sortedThreads.slice(0, input.limit);

  const hasMultipleEnvironments =
    new Set(input.threads.map((t) => t.environmentId ?? "local")).size > 1;
  const threadCountsByTitle = new Map<string, number>();
  for (const t of input.threads) {
    threadCountsByTitle.set(t.title, (threadCountsByTitle.get(t.title) ?? 0) + 1);
  }

  return visibleThreads.map((thread) => {
    const projectTitle = input.projectTitleById.get(thread.projectId);
    const envId = thread.environmentId ?? "local";
    const envLabel = resolveEnvironmentLabel(thread.environmentId, input.locationByEnvironmentId);
    const isAmbiguous =
      hasMultipleEnvironments ||
      (threadCountsByTitle.get(thread.title) ?? 0) > 1 ||
      (envId !== "local" && envId !== "default");

    const descriptionParts: string[] = [];

    if (projectTitle) {
      descriptionParts.push(projectTitle);
    }
    if (thread.branch) {
      descriptionParts.push(`#${thread.branch}`);
    }
    const currentPr = resolveThreadCurrentPullRequest(thread.pullRequests ?? []);
    if (currentPr) {
      const top = currentPr.kind === "stack" ? currentPr.top : currentPr.link;
      const isStack = currentPr.kind === "stack" && currentPr.open.length > 1;
      const prText = isStack
        ? `#${top.number} (${currentPr.open.length} in stack)`
        : `#${top.number}`;
      descriptionParts.push(prText);
    } else if (thread.linkedPullRequest) {
      descriptionParts.push(`#${thread.linkedPullRequest.number}`);
    }
    if (isAmbiguous) {
      descriptionParts.push(envLabel);
    }
    if (thread.id === input.activeThreadId) {
      descriptionParts.push("Current thread");
    }

    const leadingContent = input.renderLeadingContent?.(thread);
    const trailingContent = input.renderTrailingContent?.(thread);

    const formatRelativeTimeLabel = (iso: string | undefined): string => {
      if (!iso) return "";
      const parsed = Date.parse(iso);
      if (!Number.isFinite(parsed)) return "";
      const delta = Date.now() - parsed;
      const seconds = Math.floor(delta / 1000);
      if (seconds < 60) return "just now";
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    };

    const latestMessage = thread.messages?.at(-1);
    const defaultDescription = descriptionParts.join(" · ");
    const customDescription = input.renderDescription?.(thread, {
      projectTitle,
      environmentLabel: envLabel,
    });

    return Object.assign(
      {
        kind: "action" as const,
        value: `thread:${envId}:${thread.id}`,
        searchTerms: [
          thread.title,
          ...threadPullRequestSearchTerms(thread),
          projectTitle ?? "",
          thread.branch ?? "",
          envLabel,
        ],
        title: thread.title,
        description: customDescription ?? defaultDescription,
        timestamp: formatRelativeTimeLabel(
          latestMessage?.createdAt ?? thread.updatedAt ?? thread.createdAt,
        ),
        icon: input.icon,
      },
      leadingContent ? { titleLeadingContent: leadingContent } : {},
      trailingContent ? { titleTrailingContent: trailingContent } : {},
      {
        run: async () => {
          await input.runThread(thread);
        },
      },
    );
  });
}

function rankSearchFieldMatch(field: string, normalizedQuery: string): number {
  const normalizedField = normalizeSearchText(field);
  if (normalizedField.length === 0 || !normalizedField.includes(normalizedQuery)) {
    return Number.NEGATIVE_INFINITY;
  }
  if (normalizedField === normalizedQuery) {
    return 3;
  }
  if (normalizedField.startsWith(normalizedQuery)) {
    return 2;
  }
  return 1;
}

function rankCommandPaletteItemMatch(
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem,
  normalizedQuery: string,
): number {
  const terms = item.searchTerms.filter((term) => term.length > 0);
  if (terms.length === 0) {
    return 0;
  }

  for (const [index, field] of terms.entries()) {
    const fieldRank = rankSearchFieldMatch(field, normalizedQuery);
    if (fieldRank !== Number.NEGATIVE_INFINITY) {
      return 1_000 - index * 100 + fieldRank;
    }
  }

  return 0;
}

export function filterCommandPaletteGroups(input: {
  activeGroups: ReadonlyArray<CommandPaletteGroup>;
  query: string;
  isInSubmenu: boolean;
  projectSearchItems: ReadonlyArray<CommandPaletteActionItem>;
  threadSearchItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const isActionsFilter = input.query.startsWith(">");
  const searchQuery = isActionsFilter ? input.query.slice(1) : input.query;
  const normalizedQuery = normalizeSearchText(searchQuery);

  if (normalizedQuery.length === 0) {
    if (isActionsFilter) {
      return input.activeGroups.filter((group) => group.value === "actions");
    }
    return [...input.activeGroups];
  }

  let baseGroups = [...input.activeGroups];
  if (isActionsFilter) {
    baseGroups = baseGroups.filter((group) => group.value === "actions");
  } else if (!input.isInSubmenu) {
    baseGroups = baseGroups.filter((group) => group.value !== "recent-threads");
  }

  const searchableGroups = [...baseGroups];
  if (!input.isInSubmenu && !isActionsFilter) {
    if (input.projectSearchItems.length > 0) {
      searchableGroups.push({
        value: "projects-search",
        label: "Projects",
        items: input.projectSearchItems,
      });
    }
    if (input.threadSearchItems.length > 0) {
      searchableGroups.push({
        value: "threads-search",
        label: "Threads",
        items: input.threadSearchItems,
      });
    }
  }

  return searchableGroups.flatMap((group) => {
    const items = group.items
      .flatMap((item, index) => {
        const haystack = normalizeSearchText(item.searchTerms.join(" "));
        if (!haystack.includes(normalizedQuery)) {
          return [];
        }

        return [
          {
            item,
            index,
            rank: rankCommandPaletteItemMatch(item, normalizedQuery),
          },
        ];
      })
      .toSorted((left, right) => right.rank - left.rank || left.index - right.index)
      .map((entry) => entry.item);

    if (items.length === 0) {
      return [];
    }

    return [{ value: group.value, label: group.label, items }];
  });
}

export function buildBrowseGroups(input: {
  browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  browseQuery: string;
  canBrowseUp: boolean;
  upIcon: ReactNode;
  directoryIcon: ReactNode;
  browseUp: () => void;
  browseTo: (name: string) => void;
}): CommandPaletteGroup[] {
  const items: CommandPaletteActionItem[] = [];

  if (input.canBrowseUp) {
    items.push({
      kind: "action",
      value: "browse:up",
      searchTerms: [input.browseQuery, ".."],
      title: "..",
      icon: input.upIcon,
      keepOpen: true,
      run: async () => {
        input.browseUp();
      },
    });
  }

  for (const entry of input.browseEntries) {
    items.push({
      kind: "action",
      value: `browse:${entry.fullPath}`,
      searchTerms: [input.browseQuery, entry.fullPath, entry.name],
      title: entry.name,
      icon: input.directoryIcon,
      keepOpen: true,
      run: async () => {
        input.browseTo(entry.name);
      },
    });
  }

  return [{ value: "directories", label: "Directories", items }];
}

export function getCommandPaletteMode(input: {
  currentView: CommandPaletteView | null;
  isBrowsing: boolean;
}): CommandPaletteMode {
  if (input.currentView) {
    return input.isBrowsing ? "submenu-browse" : "submenu";
  }
  return input.isBrowsing ? "root-browse" : "root";
}

export function buildRootGroups(input: {
  actionItems: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
  recentThreadItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const groups: CommandPaletteGroup[] = [];
  if (input.actionItems.length > 0) {
    groups.push({ value: "actions", label: "Actions", items: input.actionItems });
  }
  if (input.recentThreadItems.length > 0) {
    groups.push({
      value: "recent-threads",
      label: "Recent Threads",
      items: input.recentThreadItems,
    });
  }
  return groups;
}

export function getCommandPaletteInputPlaceholder(mode: CommandPaletteMode): string {
  switch (mode) {
    case "root":
      return "Search commands, projects, and threads...";
    case "root-browse":
      return "Enter project path (e.g. ~/projects/my-app)";
    case "submenu":
      return "Search...";
    case "submenu-browse":
      return "Enter path (e.g. ~/projects/my-app)";
  }
}
