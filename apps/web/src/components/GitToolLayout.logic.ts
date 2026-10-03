export interface GitWorkspaceLayoutSection {
  id:
    | "overview"
    | "composer"
    | "changes"
    | "diff"
    | "branches"
    | "advanced-actions"
    | "history"
    | "stashes";
  title: string;
  description: string;
  column: "primary" | "secondary";
  parentId?: "history";
}

export type GitWorkspaceMode = "basic" | "advanced";

export type GitWorkspaceSwitchReason =
  | "manual"
  | "active_operation"
  | "conflicts"
  | "detached_head_blocked";

export interface GitWorkspaceViewState {
  mode: GitWorkspaceMode;
  autoSwitched: boolean;
  switchReason: GitWorkspaceSwitchReason | null;
  hasBlockingOperation: boolean;
}

export const GIT_WORKSPACE_WIDE_BREAKPOINT = "2xl";

export const GIT_WORKSPACE_LAYOUT_SECTIONS: ReadonlyArray<GitWorkspaceLayoutSection> = [
  {
    id: "overview",
    title: "Overview",
    description:
      "Keep branch state, sync status, and active operations visible before you move into the commit flow.",
    column: "primary",
  },
  {
    id: "composer",
    title: "Commit / PR Composer",
    description:
      "Work stage-first: review the staged set, write the commit message, then commit, push, or open the PR from here.",
    column: "primary",
  },
  {
    id: "changes",
    title: "Changes",
    description:
      "The day-to-day workflow lives here: review files, stage what matters, then inspect the patch below.",
    column: "primary",
  },
  {
    id: "diff",
    title: "Diff Viewer",
    description: "Inspect the selected file, commit, or conflict resolution patch.",
    column: "primary",
  },
  {
    id: "branches",
    title: "Branches",
    description:
      "Switch branches quickly, and only open the management tools when you actually need them.",
    column: "secondary",
  },
  {
    id: "advanced-actions",
    title: "Advanced Actions",
    description:
      "Less common operations stay close by, but they no longer compete with the default workflow.",
    column: "secondary",
  },
  {
    id: "history",
    title: "History",
    description: "Commits stay browsable here, with stashes tucked into a secondary panel below.",
    column: "secondary",
  },
  {
    id: "stashes",
    title: "Stashes",
    description: "Save work in progress or re-apply a saved stash without crowding the main view.",
    column: "secondary",
    parentId: "history",
  },
];

export function getGitWorkspaceLayoutSection(
  id: GitWorkspaceLayoutSection["id"],
): GitWorkspaceLayoutSection {
  const section = GIT_WORKSPACE_LAYOUT_SECTIONS.find((entry) => entry.id === id);
  if (!section) {
    throw new Error(`Unknown Git workspace layout section: ${id}`);
  }
  return section;
}
