import {
  PlusIcon,
  FolderSearchIcon,
  GitBranchIcon,
  SettingsIcon,
  FolderGit2Icon,
  ArrowRightIcon,
  SparklesIcon,
} from "lucide-react";
import { useSettingsLabsStore } from "../stores/settingsLabsStore";
import { cn } from "../lib/utils";

export interface WorkspaceWelcomeProject {
  id: any;
  name: string;
  cwd: string;
}

export interface WorkspaceWelcomeScreenProps<T extends { id: any; name: string; cwd: string }> {
  recentProjects: ReadonlyArray<T>;
  onCreateProject: () => void;
  onOpenFile: () => void;
  onCloneGit: () => void;
  onOpenSettings: () => void;
  onSelectProject: (project: T) => void;
}

export function WorkspaceWelcomeScreen<T extends { id: any; name: string; cwd: string }>({
  recentProjects,
  onCreateProject,
  onOpenFile,
  onCloneGit,
  onOpenSettings,
  onSelectProject,
}: WorkspaceWelcomeScreenProps<T>) {
  const editorial = useSettingsLabsStore((state) => state.editorialSettings);

  if (!editorial) {
    // Classic Welcome Layout
    return (
      <div
        data-slot="workspace-welcome"
        className="flex h-full min-h-0 overflow-auto bg-background px-10 py-12"
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
          <div className="space-y-2">
            <h1 className="text-4xl font-medium tracking-tight text-foreground">Welcome</h1>
            <p className="text-base text-muted-foreground">
              Open a local project to start using the workspace shell.
            </p>
          </div>

          <div className="grid gap-12 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <div className="space-y-5">
              <div>
                <div className="text-xl font-medium text-foreground">Start</div>
              </div>
              <div className="space-y-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/40 cursor-pointer"
                  onClick={onCreateProject}
                >
                  <PlusIcon className="size-4 text-muted-foreground" />
                  <span>Add Project...</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/40 cursor-pointer"
                  onClick={onOpenFile}
                >
                  <FolderSearchIcon className="size-4 text-muted-foreground" />
                  <span>Open File...</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/40 cursor-pointer"
                  onClick={onCloneGit}
                >
                  <GitBranchIcon className="size-4 text-muted-foreground" />
                  <span>Clone from Git...</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/40 cursor-pointer"
                  onClick={onOpenSettings}
                >
                  <SettingsIcon className="size-4 text-muted-foreground" />
                  <span>Workspace Settings</span>
                </button>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <div className="text-xl font-medium text-foreground">Recent</div>
              </div>
              {recentProjects.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
                  No recent projects yet.
                </div>
              ) : (
                <div className="space-y-1">
                  {recentProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      className="flex w-full items-start justify-between gap-4 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent/40 cursor-pointer"
                      onClick={() => onSelectProject(project)}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {project.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{project.cwd}</div>
                      </div>
                      <div className="shrink-0 pt-0.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground/70">
                        Open
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Modern Marketing-Inspired Editorial Welcome Layout for Interface Study
  const quickActions = [
    {
      title: "Add Project",
      icon: PlusIcon,
      onClick: onCreateProject,
      badge: "Folder",
    },
    {
      title: "Open File",
      icon: FolderSearchIcon,
      onClick: onOpenFile,
      badge: "File",
    },
    {
      title: "Clone from Git",
      icon: GitBranchIcon,
      onClick: onCloneGit,
      badge: "Git",
    },
    {
      title: "Workspace Settings",
      icon: SettingsIcon,
      onClick: onOpenSettings,
      badge: "Settings",
    },
  ];

  return (
    <div
      data-slot="workspace-welcome"
      className="flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground selection:bg-accent"
    >
      <div className="flex h-full w-full flex-col lg:flex-row overflow-hidden">
        {/* Left / Main Stage: Hero, Horizontal Quick Actions, Shortcuts */}
        <div className="flex-1 min-w-0 flex flex-col justify-between gap-10 p-8 sm:p-12 lg:p-14 xl:p-16 overflow-y-auto">
          <div className="space-y-8 max-w-5xl my-auto">
            {/* Editorial Hero Header */}
            <div className="space-y-3.5">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground/80">
                <span className="text-primary font-bold">✳</span>
                <span>Tabs IDE · Workspace Studio</span>
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-light tracking-tight text-foreground leading-[1.1]">
                  Welcome to{" "}
                  <span
                    className="font-serif italic font-normal tracking-normal text-foreground/90"
                    style={{ fontFamily: "var(--font-display, var(--font-sans))" }}
                  >
                    Tabs
                  </span>
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground max-w-lg font-normal leading-relaxed">
                  An AI-first engineering workspace designed for deep focus, agent orchestration,
                  and seamless flow.
                </p>
              </div>
            </div>

            {/* Quick Actions in a Straight Line - Compact, Concise & Precise */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70">
                <span className="text-primary font-bold">✳</span>
                <span>Quick Actions</span>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {quickActions.map((action) => {
                  const ActionIcon = action.icon;
                  return (
                    <button
                      key={action.title}
                      type="button"
                      onClick={action.onClick}
                      className={cn(
                        "group relative flex items-center justify-between gap-2 rounded-xl border border-border/80 bg-card px-3 py-2.5 text-left transition-all duration-150 cursor-pointer shadow-2xs",
                        "hover:border-foreground/20 hover:bg-accent/50 hover:shadow-xs active:scale-[0.99]",
                        "focus-visible:outline-none focus-visible:ring-1.5 focus-visible:ring-ring",
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/70 text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-foreground">
                          <ActionIcon className="size-3.5" />
                        </div>
                        <span className="truncate text-xs font-medium text-foreground tracking-tight">
                          {action.title}
                        </span>
                      </div>
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground/60 bg-muted/40 transition-colors group-hover:text-foreground/80 group-hover:bg-muted/70">
                        {action.badge}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Command Shortcuts Helper Strip */}
            <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs text-muted-foreground">
              <span className="text-[11px] font-mono text-muted-foreground/60 mr-1">
                Shortcuts:
              </span>
              <button
                type="button"
                onClick={onOpenFile}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/60 hover:bg-accent/60 hover:border-foreground/20 px-2.5 py-1 font-mono text-[11px] shadow-2xs transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <kbd className="font-semibold text-foreground">⌘P</kbd> Open File
              </button>
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/60 hover:bg-accent/60 hover:border-foreground/20 px-2.5 py-1 font-mono text-[11px] shadow-2xs transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <kbd className="font-semibold text-foreground">⌘,</kbd> Settings
              </button>
              <button
                type="button"
                onClick={onCloneGit}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/60 hover:bg-accent/60 hover:border-foreground/20 px-2.5 py-1 font-mono text-[11px] shadow-2xs transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <kbd className="font-semibold text-foreground">⌘K</kbd> Quick Switcher
              </button>
            </div>
          </div>

          {/* Footer Note */}
          <div className="pt-6 border-t border-border/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] font-mono text-muted-foreground/60 shrink-0">
            <span>Tabs IDE · Experimental layout</span>
            <div className="flex items-center gap-4">
              <span>⌘K Quick Switcher</span>
              <span>⌘, Settings</span>
            </div>
          </div>
        </div>

        {/* Right Edge: Recent Workspaces Panel */}
        <div className="w-full lg:w-88 xl:w-96 shrink-0 border-t lg:border-t-0 lg:border-l border-border/60 bg-card/40 backdrop-blur-[2px] flex flex-col p-6 sm:p-8 min-h-0">
          <div className="flex items-center justify-between pb-4 border-b border-border/50 shrink-0">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground">
              <span className="text-primary font-bold">✳</span>
              <span className="font-semibold text-foreground tracking-tight">
                Recent Workspaces
              </span>
            </div>
            {recentProjects.length > 0 && (
              <span className="rounded-full bg-accent/80 border border-border/40 px-2 py-0.5 text-[10px] font-mono font-medium text-muted-foreground">
                {recentProjects.length} {recentProjects.length === 1 ? "project" : "projects"}
              </span>
            )}
          </div>

          {recentProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 rounded-2xl border border-dashed border-border/60 bg-card/40 p-8 text-center my-4">
              <SparklesIcon className="size-6 text-muted-foreground/30 mb-2.5" />
              <p className="text-sm font-medium text-foreground">No recent workspaces yet</p>
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs leading-normal">
                Open an existing folder or clone from Git to start building.
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-2 py-4 pr-1">
              {recentProjects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => onSelectProject(project)}
                  className={cn(
                    "group relative flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-3 transition-all duration-150 cursor-pointer shadow-2xs",
                    "hover:border-foreground/25 hover:shadow-xs hover:bg-accent/40",
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-muted-foreground group-hover:text-foreground transition-colors">
                      <FolderGit2Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground group-hover:text-foreground transition-colors">
                        {project.name}
                      </div>
                      <div
                        className="truncate font-mono text-[11px] text-muted-foreground/70"
                        title={project.cwd}
                      >
                        {project.cwd}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-all duration-150 group-hover:bg-foreground group-hover:text-background group-hover:border-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectProject(project);
                    }}
                  >
                    <span>Open</span>
                    <ArrowRightIcon className="size-3 transition-transform group-hover:translate-x-0.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="pt-4 border-t border-border/50 shrink-0 flex items-center justify-between text-[11px] font-mono text-muted-foreground/60">
            <span>Quick Launch</span>
            <span>Click to open</span>
          </div>
        </div>
      </div>
    </div>
  );
}
