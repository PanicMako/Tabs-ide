export const QUICK_ACTIONS = [
  {
    id: "new-tab",
    label: "New workspace tab",
    detail: "Open a project without leaving your place",
    group: "Create",
    icon: "tab",
  },
  {
    id: "new-agent",
    label: "New conversation",
    detail: "Start an agent in this project",
    group: "Create",
    icon: "agent",
  },
  {
    id: "scratch-browser",
    label: "Temporary browser",
    detail: "Open a separate browser tool with isolated cookies",
    group: "Create",
    icon: "browser",
  },
  {
    id: "scratch-terminal",
    label: "Temporary terminal",
    detail: "Open a shell here; close it or keep it in your workspace",
    group: "Create",
    icon: "terminal",
  },
  {
    id: "search",
    label: "Search the web",
    detail: "Search with your chosen search engine; type a query to begin",
    group: "Explore",
    icon: "search",
  },
  {
    id: "popout",
    label: "Pop out conversation",
    detail: "Keep this agent beside your workspace",
    group: "Workspace",
    icon: "popout",
  },
  {
    id: "clipboard",
    label: "Temporary clipboard",
    detail: "Collect text snippets, copy them, or save them on this device",
    group: "Create",
    icon: "clipboard",
  },
  {
    id: "code",
    label: "Return to code",
    detail: "Focus this project's editor",
    group: "Workspace",
    icon: "code",
  },
  {
    id: "git",
    label: "Source control",
    detail: "Review changes in this project",
    group: "Workspace",
    icon: "branch",
  },
  {
    id: "isolated-agent",
    label: "Isolated agent",
    detail: "Start a task in a new Git worktree",
    group: "Create",
    icon: "branch",
  },
  {
    id: "worktrees",
    label: "Worktrees & storage",
    detail: "Inspect isolated tasks and reclaim disk space",
    group: "Inspect",
    icon: "storage",
  },
  {
    id: "usage",
    label: "Usage & limits",
    detail: "Open the connected provider usage page",
    group: "Inspect",
    icon: "usage",
  },
  {
    id: "inbox",
    label: "Waiting for you",
    detail: "Questions and approvals from agents in every project",
    group: "Inspect",
    icon: "inbox",
  },
  {
    id: "away",
    label: "While you were away",
    detail: "What finished, failed or is still running in each project",
    group: "Inspect",
    icon: "away",
  },
  {
    id: "toggles",
    label: "Quick toggles",
    detail: "Appearance, notifications, plan mode and more, in one place",
    group: "Inspect",
    icon: "toggles",
  },
  {
    id: "customize",
    label: "Customize quick actions",
    detail: "Choose a design, reorder actions and set gestures",
    group: "Inspect",
    icon: "settings",
  },
] as const;
export type BuiltInQuickAction = (typeof QUICK_ACTIONS)[number];
/**
 * Not shown on their own: "extension-tool" is what an installed extension's
 * launcher entry runs (input: the toolbar tool id), and "open-thread" is what
 * a glance runs to jump to a conversation (input: "environmentId:threadId").
 */
export type QuickActionId = BuiltInQuickAction["id"] | "extension-tool" | "open-thread";

/**
 * Actions that open a panel inside the launcher instead of taking you
 * somewhere else, so a quick look never costs your place.
 */
export const GLANCE_ACTION_IDS = ["usage", "inbox", "away", "toggles"] as const;
export type GlanceId = (typeof GLANCE_ACTION_IDS)[number];
export function isGlanceAction(id: QuickActionId): id is GlanceId {
  return (GLANCE_ACTION_IDS as readonly string[]).includes(id);
}

/** What `execute` returns when the launcher should stay open (a glance opened). */
export const KEEP_LAUNCHER_OPEN = "keep-open" as const;

export const CUSTOM_ACTION_ICONS = [
  "star",
  "link",
  "zap",
  "book",
  "rocket",
  "bug",
  "database",
  "cloud",
  "play",
  "flask",
  "terminal",
  "browser",
  "code",
  "search",
] as const;
export type CustomActionIcon = (typeof CUSTOM_ACTION_ICONS)[number];

/** A user-made action as saved in settings. */
export interface CustomQuickAction {
  id: string;
  label: string;
  icon: string;
  actionId: string;
  query: string;
}
/** A user-made action ready for the launcher: it runs a built-in with its own input. */
export interface CustomLauncherAction {
  id: string;
  label: string;
  detail: string;
  group: "Custom";
  icon: CustomActionIcon;
  custom: { actionId: QuickActionId; query: string };
}
/** A launcher entry contributed by an installed extension; it opens one of its tools. */
export interface ExtensionLauncherAction {
  id: string;
  label: string;
  detail: string;
  group: "Extensions";
  icon: CustomActionIcon;
  custom: { actionId: "extension-tool"; query: string };
  extension: { id: string; displayName: string; toolLabel: string };
}
export type QuickAction = BuiltInQuickAction | CustomLauncherAction | ExtensionLauncherAction;

export function isExtensionLauncherAction(action: QuickAction): action is ExtensionLauncherAction {
  return "extension" in action;
}

/** The built-in that actually runs when this action is chosen. */
export function actionRunId(action: QuickAction): QuickActionId {
  return "custom" in action ? action.custom.actionId : action.id;
}

export type CustomActionKind = "web" | "search" | "command" | "builtin";
export interface CustomActionDraft {
  id: string;
  label: string;
  icon: CustomActionIcon;
  kind: CustomActionKind;
  value: string;
  builtin: QuickActionId;
}

function isBuiltInId(id: string): id is QuickActionId {
  return QUICK_ACTIONS.some((action) => action.id === id);
}

export function newCustomActionDraft(id: string): CustomActionDraft {
  return { id, label: "", icon: "star", kind: "web", value: "", builtin: "new-agent" };
}

export function customActionDraft(saved: CustomQuickAction): CustomActionDraft {
  const icon = CUSTOM_ACTION_ICONS.find((entry) => entry === saved.icon) ?? "star";
  const base = { id: saved.id, label: saved.label, icon, value: saved.query };
  if (saved.query && saved.actionId === "scratch-browser")
    return { ...base, kind: "web", builtin: "new-agent" };
  if (saved.query && saved.actionId === "search")
    return { ...base, kind: "search", builtin: "new-agent" };
  if (saved.query && saved.actionId === "scratch-terminal")
    return { ...base, kind: "command", builtin: "new-agent" };
  return {
    ...base,
    kind: "builtin",
    value: "",
    builtin: isBuiltInId(saved.actionId) ? saved.actionId : "new-agent",
  };
}

/** Why a draft cannot be saved yet, or null when it can. */
export function customActionProblem(draft: CustomActionDraft): string | null {
  if (!draft.label.trim()) return "Give it a name.";
  const value = draft.value.trim();
  if (draft.kind === "web" && !value) return "Enter a web address.";
  if (draft.kind === "command" && !value) return "Enter a command to run.";
  if (draft.kind === "search" && !value.includes("{query}"))
    return "Put {query} where the search text belongs.";
  return null;
}

export function customActionFromDraft(draft: CustomActionDraft): CustomQuickAction {
  const actionId =
    draft.kind === "web"
      ? "scratch-browser"
      : draft.kind === "search"
        ? "search"
        : draft.kind === "command"
          ? "scratch-terminal"
          : draft.builtin;
  return {
    id: draft.id,
    label: draft.label.trim(),
    icon: draft.icon,
    actionId,
    query: draft.kind === "builtin" ? "" : draft.value.trim(),
  };
}

function toLauncherAction(saved: CustomQuickAction): CustomLauncherAction | null {
  if (!isBuiltInId(saved.actionId)) return null;
  const { icon } = customActionDraft(saved);
  const builtIn = QUICK_ACTIONS.find((action) => action.id === saved.actionId)!;
  return {
    id: saved.id,
    label: saved.label,
    detail: saved.query || builtIn.label,
    group: "Custom",
    icon,
    custom: { actionId: saved.actionId, query: saved.query },
  };
}
export const LAUNCHER_DESIGNS = [
  {
    id: "compass",
    name: "Orbit",
    tagline: "Icons on a ring",
    description: "Eight icons on a ring; a light glides to your choice and the center explains it.",
  },
  {
    id: "sectors",
    name: "Pie",
    tagline: "Wedges you flick into",
    description: "Wedges you can flick into with the pointer; sub-actions fan out beyond the edge.",
  },
] as const;
export type LauncherDesign = (typeof LAUNCHER_DESIGNS)[number]["id"];

export function orderedActions(
  order: readonly string[],
  hidden: readonly string[],
  custom: readonly CustomQuickAction[] = [],
  extensions: readonly ExtensionLauncherAction[] = [],
): QuickAction[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  const all: QuickAction[] = [
    ...QUICK_ACTIONS,
    ...custom.flatMap((entry) => toLauncherAction(entry) ?? []),
    ...extensions,
  ];
  return all
    .filter((a) => !hidden.includes(a.id) || a.id === "customize")
    .sort(
      (a, b) => (rank.get(a.id) ?? 100 + all.indexOf(a)) - (rank.get(b.id) ?? 100 + all.indexOf(b)),
    );
}
export function searchTarget(query: string): string {
  const value = query.trim();
  if (/^https?:\/\//i.test(value)) return new URL(value).href;
  if (/^(localhost|[\w-]+(?:\.[\w-]+)+)(:\d+)?(?:\/.*)?$/.test(value))
    return new URL(`https://${value}`).href;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}
export function clampLauncher(
  point: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  return {
    x: Math.max(8, Math.min(point.x - size.width / 2, viewport.width - size.width - 8)),
    y: Math.max(8, Math.min(point.y - size.height / 2, viewport.height - size.height - 8)),
  };
}

/** A stored "dial" (retired) and anything unknown show Orbit. */
export const normalizeLauncherDesign = (design: string): LauncherDesign =>
  design === "sectors" ? "sectors" : "compass";

/** Ring positions for actions; the eighth is More when anything overflows. */
export const RING_SLOTS = 7;
export type ActionZone = "ring" | "more" | "hidden";

export function actionZones(
  order: readonly string[],
  hidden: readonly string[],
  custom: readonly CustomQuickAction[] = [],
  extensions: readonly ExtensionLauncherAction[] = [],
) {
  const visible = orderedActions(order, hidden, custom, extensions);
  return {
    ring: visible.slice(0, RING_SLOTS),
    more: visible.slice(RING_SLOTS),
    hidden: orderedActions(order, [], custom, extensions).filter(
      (action) => hidden.includes(action.id) && action.id !== "customize",
    ),
  };
}

/**
 * Puts one action at a position in a zone. The ring is simply the first
 * RING_SLOTS visible actions, so a full ring pushes its last action into More
 * and a ring with a gap is refilled from the top of More.
 */
export function placeAction(
  order: readonly string[],
  hidden: readonly string[],
  id: string,
  zone: ActionZone,
  index: number,
  custom: readonly CustomQuickAction[] = [],
  extensions: readonly ExtensionLauncherAction[] = [],
): { actionOrder: string[]; hiddenActions: string[] } {
  const zones = actionZones(order, hidden, custom, extensions);
  const ids = (list: readonly QuickAction[]): string[] =>
    list.map((action) => action.id).filter((entry) => entry !== id);
  const ring = ids(zones.ring),
    more = ids(zones.more),
    gone = ids(zones.hidden);
  const target = zone === "hidden" && id === "customize" ? "ring" : zone;
  if (target === "ring") ring.splice(Math.min(index, ring.length), 0, id);
  else if (target === "hidden") gone.splice(Math.min(index, gone.length), 0, id);
  else {
    // Whatever refills the ring must not be the action just sent to More.
    const refill = Math.max(0, RING_SLOTS - ring.length);
    more.splice(Math.max(refill, Math.min(index, more.length)), 0, id);
  }
  return { actionOrder: [...ring, ...more, ...gone], hiddenActions: gone };
}
export function actionAccentIdentity(action: BuiltInQuickAction): string {
  return {
    tab: "workspace",
    agent: "agents",
    branch: "git",
    browser: "browser",
    terminal: "server",
    search: "search",
    popout: "agents",
    code: "code",
    storage: "workspace",
    usage: "usage",
    settings: "settings",
    clipboard: "clipboard",
    inbox: "agents",
    away: "agents",
    toggles: "settings",
  }[action.icon];
}

export interface QuickSubAction {
  id: string;
  parentId: string;
  actionId: string;
  label: string;
  query: string;
}
export const DEFAULT_SUB_ACTIONS: readonly QuickSubAction[] = [
  {
    id: "search-google",
    parentId: "search",
    actionId: "search",
    label: "Google",
    query: "https://www.google.com/search?q={query}",
  },
  {
    id: "search-duckduckgo",
    parentId: "search",
    actionId: "search",
    label: "DuckDuckGo",
    query: "https://duckduckgo.com/?q={query}",
  },
  {
    id: "browser-blank",
    parentId: "scratch-browser",
    actionId: "scratch-browser",
    label: "Blank browser",
    query: "",
  },
  {
    id: "browser-google",
    parentId: "scratch-browser",
    actionId: "scratch-browser",
    label: "Google",
    query: "https://www.google.com",
  },
  {
    id: "browser-github",
    parentId: "scratch-browser",
    actionId: "scratch-browser",
    label: "GitHub",
    query: "https://github.com",
  },
  {
    id: "temporary-browser",
    parentId: "new-tab",
    actionId: "scratch-browser",
    label: "Temporary browser",
    query: "",
  },
  {
    id: "temporary-terminal",
    parentId: "new-tab",
    actionId: "scratch-terminal",
    label: "Temporary terminal",
    query: "",
  },
  {
    id: "agent-local",
    parentId: "new-agent",
    actionId: "new-agent",
    label: "Local conversation",
    query: "",
  },
  {
    id: "agent-isolated",
    parentId: "new-agent",
    actionId: "isolated-agent",
    label: "Isolated agent",
    query: "",
  },
];
