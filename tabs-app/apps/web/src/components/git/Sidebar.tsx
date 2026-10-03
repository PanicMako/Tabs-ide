import {
  ChevronLeft,
  ChevronRight,
  FileDiff,
  FolderGit2,
  GitBranch as GitBranchIcon,
  GitCommit,
  GitCompare,
  GitPullRequest,
  Github,
  History as HistoryIcon,
  Package,
  ScanLine,
  Settings,
  Tag,
  Users,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef } from "react";

export type NavPanel =
  | "overview"
  | "changes"
  | "diff"
  | "divergence"
  | "branches"
  | "history"
  | "prs"
  | "tags"
  | "stashes"
  | "accounts"
  | "settings"
  | "review";

export interface NavItem {
  id: NavPanel;
  label: string;
  desc: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: "changes" | "prs";
}

export const NAV: NavItem[] = [
  {
    id: "overview",
    label: "Overview",
    icon: FolderGit2,
    desc: "Repo health, quick actions, and sync status",
  },
  {
    id: "changes",
    label: "Changes",
    icon: GitCommit,
    badge: "changes",
    desc: "Stage, commit, and review working tree changes",
  },
  {
    id: "review",
    label: "Code Review",
    icon: ScanLine,
    desc: "AI-powered multi-pass code review & betterment",
  },
  {
    id: "diff",
    label: "Diff",
    icon: FileDiff,
    desc: "Browse diffs for working tree files or past commits",
  },
  {
    id: "divergence",
    label: "Divergence",
    icon: GitCompare,
    desc: "Full watched branch divergence list and branch comparison",
  },
  {
    id: "branches",
    label: "Branches",
    icon: GitBranchIcon,
    desc: "Switch, create, or rename branches",
  },
  {
    id: "history",
    label: "History",
    icon: HistoryIcon,
    desc: "Commit timeline for the current branch",
  },
  {
    id: "prs",
    label: "Pull requests",
    icon: GitPullRequest,
    badge: "prs",
    desc: "Open, review, and create pull requests",
  },
  { id: "tags", label: "Tags & releases", icon: Tag, desc: "Tag commits and draft releases" },
  {
    id: "stashes",
    label: "Stashes",
    icon: Package,
    desc: "Set changes aside and reapply them later",
  },
  {
    id: "accounts",
    label: "Accounts",
    icon: Users,
    desc: "Manage which GitHub account this project uses",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    desc: "Git identity, remotes, and repo-level config",
  },
];

function RailTooltip({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative group flex items-center justify-center">
      {children}
      <div className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-100 z-50">
        <div
          className="flex flex-col gap-0.5 px-3 py-2 rounded-lg border border-border shadow-2xl"
          style={{ backgroundColor: "var(--bg-surface)", width: "190px" }}
        >
          <span className="text-xs font-medium text-foreground">{title}</span>
          {desc && (
            <span className="text-[10px] text-muted-foreground/70" style={{ lineHeight: 1.4 }}>
              {desc}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  repoName,
  panel,
  setPanel,
  collapsed,
  setCollapsed,
  changeCount,
  prCount = 0,
  reviewBadgeCount,
  hasConflict,
  idPrefix,
}: {
  repoName: string;
  panel: NavPanel;
  setPanel: (p: NavPanel) => void;
  collapsed: boolean;
  setCollapsed: (c: boolean) => void;
  changeCount: number;
  prCount?: number;
  reviewBadgeCount?: number | null;
  hasConflict?: boolean;
  idPrefix: string;
}) {
  const wrapStyle = { backgroundColor: "var(--bg-base)" };
  const navRef = useRef<HTMLDivElement>(null);
  const handleNavKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown" || event.key === "ArrowRight")
      nextIndex = (index + 1) % NAV.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft")
      nextIndex = (index - 1 + NAV.length) % NAV.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = NAV.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextItem = NAV[nextIndex];
    if (!nextItem) return;
    setPanel(nextItem.id);
    navRef.current?.querySelector<HTMLButtonElement>(`[data-panel="${nextItem.id}"]`)?.focus();
  };

  const tabProps = (item: NavItem, index: number) => ({
    id: `${idPrefix}-tab-${item.id}`,
    role: "tab" as const,
    "aria-selected": panel === item.id,
    "aria-controls": `${idPrefix}-panel-${item.id}`,
    tabIndex: panel === item.id ? 0 : -1,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => handleNavKeyDown(event, index),
  });

  if (collapsed) {
    return (
      <div
        className="w-16 flex flex-col items-center border-r border-border/50 shrink-0 h-full py-4 gap-2"
        style={wrapStyle}
      >
        <RailTooltip title={repoName} desc="Expand the sidebar for full labels and details">
          <button
            type="button"
            aria-label="Expand source control sidebar"
            onClick={() => setCollapsed(false)}
            className="group relative w-8 h-8 rounded-lg bg-muted/50 hover:bg-muted flex items-center justify-center shrink-0 transition-colors cursor-pointer"
          >
            <Github
              aria-hidden="true"
              size={15}
              className="text-foreground/90 group-hover:opacity-0 transition-opacity"
            />
            <ChevronRight
              aria-hidden="true"
              size={14}
              className="absolute text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </button>
        </RailTooltip>
        <div className="w-6 h-px bg-border shrink-0 my-1" />
        <div
          ref={navRef}
          role="tablist"
          aria-label="Source control views"
          aria-orientation="vertical"
          className="flex-1 flex flex-col items-center gap-2 w-full px-2 pt-1"
        >
          {NAV.map((n, index) => {
            const Icon = n.icon;
            const isActive = panel === n.id;
            const count =
              n.badge === "changes"
                ? changeCount
                : n.badge === "prs"
                  ? prCount
                  : n.id === "review"
                    ? reviewBadgeCount
                    : null;
            return (
              <RailTooltip key={n.id} title={n.label} desc={n.desc}>
                <button
                  type="button"
                  {...tabProps(n, index)}
                  aria-label={`${n.label}. ${n.desc}`}
                  data-panel={n.id}
                  onClick={() => setPanel(n.id)}
                  className={`relative w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                    isActive ? "bg-accent" : "bg-muted/50 hover:bg-muted"
                  }`}
                >
                  {isActive && (
                    <span
                      className="absolute -left-2 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full"
                      style={{ backgroundColor: "var(--fg)" }}
                    />
                  )}
                  <Icon aria-hidden="true" size={15} className="text-foreground/90" />
                  {count ? (
                    <span
                      className="absolute -bottom-1 -right-1 h-4 px-1 rounded-full border border-border text-[9px] font-mono flex items-center justify-center"
                      style={{
                        minWidth: "16px",
                        color:
                          n.id === "changes" && hasConflict ? "var(--sem-red)" : "var(--fg-60)",
                        backgroundColor: "var(--bg-base)",
                      }}
                    >
                      {count}
                    </span>
                  ) : null}
                </button>
              </RailTooltip>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="w-64 flex flex-col border-r border-border/50 shrink-0 h-full" style={wrapStyle}>
      <div className="p-4 pb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs font-mono tracking-widest text-muted-foreground/70 uppercase">
            Source control
          </span>
          <div className="text-base font-semibold text-foreground tracking-tight mt-0.5 truncate">
            {repoName}
          </div>
        </div>
        <button
          type="button"
          aria-label="Collapse source control sidebar"
          onClick={() => setCollapsed(true)}
          className="w-7 h-7 rounded-lg bg-muted/50 hover:bg-muted border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-all shrink-0 cursor-pointer"
          title="Collapse sidebar"
        >
          <ChevronLeft aria-hidden="true" size={14} />
        </button>
      </div>

      <div
        ref={navRef}
        role="tablist"
        aria-label="Source control views"
        aria-orientation="vertical"
        className="flex-1 overflow-y-auto pb-4 custom-scrollbar px-2"
      >
        {NAV.map((n, index) => {
          const Icon = n.icon;
          const isActive = panel === n.id;
          const count =
            n.badge === "changes"
              ? changeCount
              : n.badge === "prs"
                ? prCount
                : n.id === "review"
                  ? reviewBadgeCount
                  : null;
          return (
            <button
              key={n.id}
              type="button"
              {...tabProps(n, index)}
              data-panel={n.id}
              onClick={() => setPanel(n.id)}
              className={`group relative w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                isActive ? "bg-muted" : "hover:bg-muted/50"
              }`}
            >
              {isActive && (
                <span
                  className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full"
                  style={{ backgroundColor: "var(--fg)" }}
                />
              )}
              <Icon
                aria-hidden="true"
                size={14}
                className={
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground/70 group-hover:text-foreground/90"
                }
              />
              <span
                className={`text-xs flex-1 truncate ${isActive ? "text-foreground font-medium" : "text-muted-foreground group-hover:text-foreground"}`}
              >
                {n.label}
              </span>
              {count ? (
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-muted/50 border border-border/50"
                  style={{
                    color: n.id === "changes" && hasConflict ? "var(--sem-red)" : "var(--fg-40)",
                  }}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
