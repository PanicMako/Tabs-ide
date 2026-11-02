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
    id: "customize",
    label: "Customize quick actions",
    detail: "Choose a design, reorder actions and set gestures",
    group: "Inspect",
    icon: "settings",
  },
] as const;
export type QuickActionId = (typeof QUICK_ACTIONS)[number]["id"];
export type QuickAction = (typeof QUICK_ACTIONS)[number];
export const LAUNCHER_DESIGNS = [
  {
    id: "compass",
    name: "Halo Fade",
    description: "Eight actions with a soft halo that follows the selected action's color.",
  },
  {
    id: "dial",
    name: "Glass Dial",
    description: "Six labelled nodes with a quiet center and More for secondary actions.",
  },
  {
    id: "sectors",
    name: "Pie Sectors",
    description: "Rounded wedges with action-colored highlights and an outer More menu.",
  },
] as const;
export type LauncherDesign = (typeof LAUNCHER_DESIGNS)[number]["id"];

export function orderedActions(order: readonly string[], hidden: readonly string[]): QuickAction[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...QUICK_ACTIONS]
    .filter((a) => !hidden.includes(a.id) || a.id === "customize")
    .sort(
      (a, b) =>
        (rank.get(a.id) ?? 100 + QUICK_ACTIONS.indexOf(a)) -
        (rank.get(b.id) ?? 100 + QUICK_ACTIONS.indexOf(b)),
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

export const normalizeLauncherDesign = (design: string): LauncherDesign =>
  design === "dial" || design === "sectors" ? design : "compass";
export function actionAccentIdentity(action: QuickAction): string {
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
