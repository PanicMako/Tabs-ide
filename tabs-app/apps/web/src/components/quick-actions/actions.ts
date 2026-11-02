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
    id: "isolated-agent",
    label: "Isolated agent",
    detail: "Start a task in a new Git worktree",
    group: "Create",
    icon: "branch",
  },
  {
    id: "scratch-browser",
    label: "Scratch browser",
    detail: "Open a separate browser tool with isolated cookies",
    group: "Create",
    icon: "browser",
  },
  {
    id: "search",
    label: "Search the web",
    detail: "Type a query or URL above, then open it",
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
    id: "list",
    name: "Dispatch",
    description: "A searchable command list. Type, arrow, Enter. Familiar at any speed.",
  },
  {
    id: "compass",
    name: "Compass",
    description:
      "Four directions around your cursor. Arrow keys select a direction; pages reveal more.",
  },
  {
    id: "shelf",
    name: "Toolbelt",
    description: "A horizontal shelf. Scan icons and labels, move left or right, then act.",
  },
  {
    id: "matrix",
    name: "Keypad",
    description: "A spatial 3 by 3 pad. Press 1–9 for the visible action; page for more.",
  },
  {
    id: "stack",
    name: "Focus",
    description: "One action at a time. Step through with left and right, inspect, then commit.",
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
    y: Math.max(8, Math.min(point.y - 28, viewport.height - size.height - 8)),
  };
}
