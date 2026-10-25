import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  PlusIcon,
  SettingsIcon,
  XIcon,
  FlaskConicalIcon,
  SearchIcon,
} from "lucide-react";
import {
  GitCompanionIcon,
  WorkspaceBrowserIcon,
  WorkspaceTerminalIcon,
} from "./WorkspaceToolMarks";
import { CodeGlyphIcon } from "./CodeGlyphIcon";
import { DockUfoIcon } from "./DockUfoIcon";
import { BrowserPlanetIcon } from "./BrowserPlanetIcon";
import { AssistantBubbleIcon } from "./AssistantBubbleIcon";
import { TabsExtensionIcon } from "./Icons";
import type { Project, Thread } from "../types";
import type { ProjectId } from "@tabs/contracts";
import type { ProjectToolKind } from "@tabs/contracts/settings";
import { gitStatusQueryOptions } from "../lib/gitReactQuery";
import { isThreadWorking } from "./Sidebar.logic";
import { isElectron } from "../env";
import { cn, isMacPlatform, isWindowsPlatform } from "../lib/utils";
import { useWindowControlsInset } from "../hooks/useWindowControlsInset";
import { ProjectFavicon } from "./ProjectFavicon";
import { useWorkspaceAppearanceStore } from "../stores/workspaceAppearanceStore";

const isMacDesktop =
  isElectron && typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const isWindowsDesktop =
  isElectron && typeof navigator !== "undefined" && isWindowsPlatform(navigator.platform);
const isMac =
  isMacDesktop || (typeof navigator !== "undefined" && isMacPlatform(navigator.platform));

function resolveToolIcon(kind: ProjectToolKind) {
  switch (kind) {
    case "code":
      return <CodeGlyphIcon className="size-[18px]" />;
    case "agents":
      return <AssistantBubbleIcon className="size-4" />;
    case "server":
      return <DockUfoIcon className="size-[18px]" />;
    case "git":
      return <GitCompanionIcon className="size-4" />;
    case "browser":
      return <BrowserPlanetIcon className="size-4" />;
    case "custom_embed":
      return <WorkspaceBrowserIcon className="size-4" />;
    case "testing":
      return <FlaskConicalIcon className="size-4" />;
    case "custom_process":
      return <WorkspaceTerminalIcon className="size-4" />;
    case "extension":
      return <TabsExtensionIcon className="size-4" />;
  }
}

function StudyToolBottomFillets() {
  return (
    <>
      <svg
        className="study-tab-fillet pointer-events-none absolute bottom-0 -left-2.5 w-3 h-2.5 z-10"
        viewBox="0 0 12 10"
        fill="none"
        aria-hidden="true"
      >
        <path d="M 0 10 A 10 10 0 0 0 10 0 L 12 0 L 12 10 Z" fill="currentColor" />
      </svg>
      <svg
        className="study-tab-fillet pointer-events-none absolute bottom-0 -right-2.5 w-3 h-2.5 z-10"
        viewBox="0 0 12 10"
        fill="none"
        aria-hidden="true"
      >
        <path d="M 0 0 L 2 0 A 10 10 0 0 0 12 10 L 0 10 Z" fill="currentColor" />
      </svg>
    </>
  );
}

export interface InterfaceStudyTopBarProps {
  projects: ReadonlyArray<Project>;
  openProjects: ReadonlyArray<Project>;
  activeProject: Project | null;
  pendingTabIds: ReadonlyArray<string>;
  activePendingTabId: string | null;
  activeToolId: string;
  availableTools: ReadonlyArray<{
    id: string;
    kind: ProjectToolKind;
    label: string;
    icon?: React.ReactNode;
  }>;
  threads?: ReadonlyArray<Thread>;
  onActivateProject: (projectId: ProjectId) => void;
  onCloseProject: (projectId: ProjectId) => void;
  onNewTab: () => void;
  onActivatePendingTab: (pendingId: string) => void;
  onClosePendingTab: (pendingId: string) => void;
  onSelectTool: (toolId: string) => void;
  onOpenSettings: () => void;
}

export const InterfaceStudyTopBar = memo(function InterfaceStudyTopBar(
  props: InterfaceStudyTopBarProps,
) {
  const [isDeckOpen, setIsDeckOpen] = useState(false);
  const deckRef = useRef<HTMLDivElement>(null);
  const projBtnRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const windowControlsInset = useWindowControlsInset(
    isWindowsDesktop || isMacDesktop,
    isMacDesktop ? { left: 92, right: 0 } : { left: 0, right: 140 },
  );

  // Git status of the active project
  const gitStatusQuery = useQuery({
    ...gitStatusQueryOptions(props.activeProject?.cwd ?? null, props.activeProject?.environmentId),
    enabled: Boolean(props.activeProject?.cwd),
  });

  const branch = gitStatusQuery.data?.branch ?? "main";
  const changeCount =
    (gitStatusQuery.data?.workingTree?.files?.length ?? 0) +
    (gitStatusQuery.data?.untracked?.files?.length ?? 0) +
    (gitStatusQuery.data?.staged?.files?.length ?? 0);

  const activeSubtext = props.activePendingTabId
    ? "Draft workspace"
    : `${branch} · ${changeCount > 0 ? `${changeCount} change${changeCount > 1 ? "s" : ""}` : "clean"}`;

  // Running threads in active project
  const activeProjectThreads = useMemo(() => {
    if (!props.activeProject) return [];
    return (props.threads ?? []).filter((t) => t.projectId === props.activeProject!.id);
  }, [props.threads, props.activeProject]);

  const hasActiveAgents = activeProjectThreads.some(isThreadWorking);

  const showProjectTabIcons = useWorkspaceAppearanceStore((s) => s.showProjectTabIcons);

  const openProjectAvatars = useMemo(() => {
    return props.openProjects.slice(0, 3);
  }, [props.openProjects]);

  const activeToolIndex = useMemo(() => {
    const idx = props.availableTools.findIndex((t) => t.id === props.activeToolId);
    return idx >= 0 ? idx : 0;
  }, [props.availableTools, props.activeToolId]);

  // Smoothly scroll active tool tab into view when selected
  useEffect(() => {
    const activeTabEl = tabRefs.current[activeToolIndex];
    if (activeTabEl && navRef.current) {
      activeTabEl.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [props.activeToolId, activeToolIndex]);

  // Close project deck on outside click or Escape
  useEffect(() => {
    if (!isDeckOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (
        deckRef.current &&
        !deckRef.current.contains(e.target as Node) &&
        projBtnRef.current &&
        !projBtnRef.current.contains(e.target as Node)
      ) {
        setIsDeckOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsDeckOpen(false);
        projBtnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDeckOpen]);

  // Keyboard navigation for tools (ArrowLeft / ArrowRight, Alt+1..5)
  const handleNavKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? -1 : 1;
      const nextIndex =
        (activeToolIndex + delta + props.availableTools.length) % props.availableTools.length;
      const nextTool = props.availableTools[nextIndex];
      if (nextTool) {
        props.onSelectTool(nextTool.id);
        tabRefs.current[nextIndex]?.focus();
      }
    }
  };

  // Convert vertical mouse wheel into horizontal scroll for smooth tool navigation
  const handleNavWheel = useCallback((e: React.WheelEvent<HTMLElement>) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || !navRef.current) return;
    navRef.current.scrollBy({ left: e.deltaY, behavior: "auto" });
  }, []);

  const activeProjectTitle = props.activePendingTabId
    ? "New Tab"
    : (props.activeProject?.name ?? "No Project");

  // Build list of all open project items for the deck
  const deckItems = useMemo(() => {
    const items: Array<{
      id: string;
      kind: "project" | "pending";
      name: string;
      project?: Project;
      subtext: string;
      isWorking: boolean;
      projectId?: ProjectId;
      pendingId?: string;
    }> = [];

    for (const project of props.openProjects) {
      const pThreads = (props.threads ?? []).filter((t) => t.projectId === project.id);
      const isWorking = pThreads.some(isThreadWorking);
      const isCurrent = project.id === props.activeProject?.id && !props.activePendingTabId;
      items.push({
        id: project.id,
        kind: "project",
        name: project.name,
        project,
        subtext: isCurrent ? activeSubtext : project.cwd,
        isWorking,
        projectId: project.id,
      });
    }

    for (const pendingId of props.pendingTabIds) {
      items.push({
        id: pendingId,
        kind: "pending",
        name: "New Tab",
        subtext: "Draft workspace",
        isWorking: false,
        pendingId,
      });
    }

    return items;
  }, [
    props.openProjects,
    props.pendingTabIds,
    props.threads,
    props.activeProject,
    props.activePendingTabId,
    activeSubtext,
  ]);

  return (
    <header
      data-slot="workspace-study-topbar"
      className="study-topbar-header drag-region select-none"
      style={{
        paddingLeft: Math.max(16, windowControlsInset.left),
        paddingRight: Math.max(16, windowControlsInset.right),
      }}
    >
      {/* ── Left: Brand & Project Switcher ── */}
      <div className="flex items-center gap-3 min-w-0 self-center">
        {/* Brand logo */}
        <div className="no-drag flex items-baseline gap-1.5 font-display text-[16px] font-extrabold tracking-tight text-foreground/90 shrink-0 select-none">
          <span>Tabs</span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 px-1.5 py-0.5 rounded bg-foreground/5 border border-foreground/10">
            IDE
          </span>
        </div>

        {/* Overlapping project avatars (only when project icons are enabled) */}
        {showProjectTabIcons && openProjectAvatars.length > 0 && (
          <div className="no-drag flex items-center -space-x-1.5 select-none pl-0.5">
            {openProjectAvatars.map((proj) => {
              const isCurrent = proj.id === props.activeProject?.id && !props.activePendingTabId;
              return (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() => props.onActivateProject(proj.id)}
                  title={`Switch to ${proj.name}`}
                  className={cn(
                    "relative flex size-6 shrink-0 items-center justify-center rounded-full ring-2 ring-background overflow-hidden transition-transform duration-150 hover:scale-110 hover:z-20",
                    isCurrent && "z-10 ring-foreground/20",
                  )}
                >
                  <ProjectFavicon
                    project={{
                      workspaceRoot: proj.cwd,
                      title: proj.name,
                      faviconPath: proj.faviconPath,
                      projectIcon: proj.projectIcon,
                      environmentId: proj.environmentId,
                    }}
                    className="size-3.5"
                  />
                </button>
              );
            })}
          </div>
        )}

        {/* Project Switcher button */}
        <div className="relative no-drag">
          <button
            ref={projBtnRef}
            type="button"
            aria-expanded={isDeckOpen}
            aria-haspopup="menu"
            aria-label={`Current project: ${activeProjectTitle}. Click to switch project.`}
            onClick={() => setIsDeckOpen((prev) => !prev)}
            className="study-project-button group"
          >
            {/* Title & branch/change status */}
            <div className="flex flex-col text-left leading-tight min-w-0">
              <span className="font-sans font-semibold text-[12px] tracking-normal text-foreground truncate max-w-[140px] sm:max-w-[180px]">
                {activeProjectTitle}
              </span>
              <span className="text-[10px] font-normal text-muted-foreground truncate max-w-[140px] sm:max-w-[180px]">
                {activeSubtext}
              </span>
            </div>

            <ChevronDownIcon
              className={cn(
                "size-3.5 text-muted-foreground/80 shrink-0 transition-transform duration-200 ml-1",
                isDeckOpen && "rotate-180",
              )}
            />
          </button>

          {/* Project Deck dropdown */}
          {isDeckOpen && (
            <div
              ref={deckRef}
              data-slot="study-project-deck"
              role="menu"
              aria-label="Open projects"
              className="study-project-deck"
            >
              <div className="px-3 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Open projects
              </div>

              <div className="max-h-72 overflow-y-auto space-y-0.5 py-1 [scrollbar-width:thin]">
                {deckItems.map((item) => {
                  const isSelected =
                    item.kind === "pending"
                      ? item.pendingId === props.activePendingTabId
                      : item.projectId === props.activeProject?.id && !props.activePendingTabId;

                  return (
                    <div
                      key={item.id}
                      role="menuitem"
                      tabIndex={0}
                      onClick={() => {
                        if (item.kind === "pending" && item.pendingId) {
                          props.onActivatePendingTab(item.pendingId);
                        } else if (item.projectId) {
                          props.onActivateProject(item.projectId);
                        }
                        setIsDeckOpen(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (item.kind === "pending" && item.pendingId) {
                            props.onActivatePendingTab(item.pendingId);
                          } else if (item.projectId) {
                            props.onActivateProject(item.projectId);
                          }
                          setIsDeckOpen(false);
                        }
                      }}
                      className={cn(
                        "study-project-item group flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-colors select-none",
                        isSelected
                          ? "bg-foreground/5 text-foreground font-semibold"
                          : "hover:bg-foreground/5 text-foreground/80 hover:text-foreground",
                      )}
                    >
                      {showProjectTabIcons && (
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 border border-foreground/10 text-foreground/80 overflow-hidden select-none">
                          {item.project ? (
                            <ProjectFavicon
                              project={{
                                workspaceRoot: item.project.cwd,
                                title: item.project.name,
                                faviconPath: item.project.faviconPath,
                                projectIcon: item.project.projectIcon,
                                environmentId: item.project.environmentId,
                              }}
                              className="size-4.5"
                            />
                          ) : (
                            <PlusIcon className="size-4 text-muted-foreground" />
                          )}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold leading-tight truncate">
                          {item.name}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                          {item.isWorking && (
                            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          )}
                          <span className="truncate">{item.subtext}</span>
                        </div>
                      </div>

                      {deckItems.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Close ${item.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (item.kind === "pending" && item.pendingId) {
                              props.onClosePendingTab(item.pendingId);
                            } else if (item.projectId) {
                              props.onCloseProject(item.projectId);
                            }
                          }}
                          className="size-6 rounded-full flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-foreground/10 hover:text-foreground transition-all"
                        >
                          <XIcon className="size-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="pt-1.5 mt-1 border-t border-border/50">
                <button
                  type="button"
                  onClick={() => {
                    props.onNewTab();
                    setIsDeckOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-foreground hover:bg-foreground/5 transition-colors"
                >
                  <PlusIcon className="size-3.5" />
                  <span>New project</span>
                  <kbd className="ml-auto text-[10px] font-mono text-muted-foreground bg-foreground/5 px-1.5 py-0.5 rounded">
                    {isMac ? "⌘N" : "Alt+N"}
                  </kbd>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Center: Tools Navigation as Integrated Tabs ── */}
      <nav
        ref={navRef}
        role="tablist"
        aria-label="Project tools"
        onKeyDown={handleNavKeyDown}
        onWheel={handleNavWheel}
        className="study-tools-nav no-drag flex items-end justify-center gap-2 flex-1 min-w-0 h-full px-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {props.availableTools.map((tool, index) => {
          const active = tool.id === props.activeToolId;
          const isAgents = tool.kind === "agents";
          const isGit = tool.kind === "git";

          return (
            <button
              key={tool.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              data-tool-kind={tool.kind}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => props.onSelectTool(tool.id)}
              className={cn("study-tool-tab group", active && "active")}
            >
              {active && <StudyToolBottomFillets />}
              <span
                className={cn(
                  "study-tool-tab-icon shrink-0 transition-colors",
                  active
                    ? "text-foreground font-semibold"
                    : "text-muted-foreground group-hover:text-foreground",
                )}
              >
                {isAgents ? (
                  <AssistantBubbleIcon className="size-4" />
                ) : (
                  (tool.icon ?? resolveToolIcon(tool.kind))
                )}
              </span>
              <span>{tool.label}</span>

              {/* Agent live ping pulse */}
              {isAgents && hasActiveAgents && (
                <span
                  className="size-1.5 rounded-full bg-emerald-500 animate-pulse ml-0.5"
                  title="Agents working"
                  aria-label="Agents working"
                />
              )}

              {/* Git changes count pill */}
              {isGit && changeCount > 0 && (
                <span
                  className={cn(
                    "text-[10px] font-bold px-1.5 py-0.2 rounded-full ml-0.5 transition-colors",
                    active
                      ? "bg-foreground/10 text-foreground"
                      : "bg-foreground/5 text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  {changeCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Right: Quick Actions & Settings ── */}
      <div className="no-drag flex items-center gap-1.5 shrink-0 self-center">
        {/* Portal target for browser back/forward/refresh */}
        <div id="project-toolbar-extra-controls" className="flex items-center empty:hidden" />

        {/* Quick Search */}
        <button
          type="button"
          aria-label="Search files (⌘P)"
          title="Search files (⌘P)"
          onClick={() => {
            window.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "p",
                code: "KeyP",
                metaKey: true,
                bubbles: true,
              }),
            );
          }}
          className="size-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
        >
          <SearchIcon className="size-4" />
        </button>

        {/* Settings gear */}
        <button
          type="button"
          aria-label="Settings"
          title="Settings (⌘,)"
          onClick={props.onOpenSettings}
          className="size-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
        >
          <SettingsIcon className="size-4" />
        </button>
      </div>
    </header>
  );
});
