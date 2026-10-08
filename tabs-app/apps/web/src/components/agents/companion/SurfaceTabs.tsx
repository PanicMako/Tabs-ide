import {
  BookmarkIcon,
  FileDiffIcon,
  FolderTreeIcon,
  GitPullRequestIcon,
  GlobeIcon,
  ListOrderedIcon,
  PlusIcon,
  Maximize2Icon,
  Minimize2Icon,
  TerminalSquareIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { RightPanelTab } from "~/stores/rightPanelStore";
import { cn } from "~/lib/utils";

export const surfaces = [
  {
    id: "browser",
    key: "b",
    hoverFont: "Bricolage Grotesque",
    hoverWeight: 800,
    hoverStyle: "normal",
    tint: "#6aa8ff",
    label: "Browser",
    description: "Explore and preview your work",
    Icon: GlobeIcon,
    color: "text-sky-600 dark:text-sky-400",
  },
  {
    id: "terminal",
    key: "t",
    hoverFont: "Geist Mono",
    hoverWeight: 500,
    hoverStyle: "normal",
    tint: "#7be0a4",
    label: "Terminal",
    description: "Run commands alongside your agent",
    Icon: TerminalSquareIcon,
    color: "text-emerald-600 dark:text-emerald-400",
  },
  {
    id: "files",
    key: "f",
    hoverFont: "Instrument Serif",
    hoverWeight: 400,
    hoverStyle: "italic",
    tint: "#ffc46b",
    label: "Files",
    description: "Navigate the project",
    Icon: FolderTreeIcon,
    color: "text-amber-600 dark:text-amber-400",
  },
  {
    id: "diff",
    key: "d",
    hoverFont: "Syne",
    hoverWeight: 800,
    hoverStyle: "normal",
    tint: "#ff8fa3",
    label: "Diff",
    description: "See what changed",
    Icon: FileDiffIcon,
    color: "text-violet-600 dark:text-violet-400",
  },
  {
    id: "pr",
    key: "p",
    hoverFont: "DM Serif Display",
    hoverWeight: 400,
    hoverStyle: "italic",
    tint: "#b69cff",
    label: "Pull request",
    description: "Follow your pull requests",
    Icon: GitPullRequestIcon,
    color: "text-fuchsia-600 dark:text-fuchsia-400",
  },
  {
    id: "stash",
    key: "s",
    hoverFont: "Instrument Serif",
    hoverWeight: 400,
    hoverStyle: "italic",
    tint: "#ff9f6b",
    label: "Stash",
    description: "Keep prompts for later",
    Icon: BookmarkIcon,
    color: "text-orange-600 dark:text-orange-400",
  },
  {
    id: "queue",
    key: "q",
    hoverFont: "Fraunces",
    hoverWeight: 600,
    hoverStyle: "normal",
    tint: "#5fe0e0",
    label: "Queue",
    description: "Manage upcoming messages",
    Icon: ListOrderedIcon,
    color: "text-cyan-600 dark:text-cyan-400",
  },
] as const;

export function SurfaceChooser({ onSelect }: { onSelect: (tab: RightPanelTab) => void }) {
  return (
    <div
      className="surface-chooser flex min-h-0 flex-1 overflow-y-auto px-7 py-8"
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const surface = surfaces.find((item) => item.key === event.key.toLowerCase());
        if (surface) {
          event.preventDefault();
          onSelect(surface.id);
        }
      }}
    >
      <div className="m-auto w-full max-w-[560px] py-6">
        <h2 className="mb-3 text-sm font-normal text-muted-foreground">Open a surface</h2>
        <div className="surface-launcher-list">
          {surfaces.map(
            ({ id, label, description, tint, key, hoverFont, hoverWeight, hoverStyle }) => (
              <div
                key={id}
                className="surface-launcher-row flex items-center gap-3"
                style={
                  {
                    "--surface-tint": tint,
                    "--surface-hover-font": `"${hoverFont}"`,
                    "--surface-hover-weight": hoverWeight,
                    "--surface-hover-style": hoverStyle,
                  } as CSSProperties
                }
              >
                <button
                  type="button"
                  onClick={() => onSelect(id)}
                  aria-label={`${label} ${description}`}
                  className="surface-launcher flex w-fit min-w-0 items-center rounded-full px-5 text-left focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="surface-script">{label}</span>
                </button>
                <kbd
                  aria-hidden="true"
                  className="surface-launcher-key rounded-md bg-white/5 px-2 py-0.5 font-mono text-xs text-[#85858f]"
                >
                  {key.toUpperCase()}
                </kbd>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

export function SurfaceTabs({
  activeTab,
  onSelect,
  onClosePanel,
  onChooserChange,
  counts,
  dragRegion,
  choosing,
  maximized = false,
  onToggleMaximized,
  instances,
  activeInstanceId,
  onSelectInstance,
  onCloseInstance,
}: {
  instances?: ReadonlyArray<{ id: string; kind: RightPanelTab; title?: string | undefined }>;
  activeInstanceId?: string | null | undefined;
  onSelectInstance?: ((id: string) => void) | undefined;
  onCloseInstance?: ((id: string) => void) | undefined;
  activeTab: RightPanelTab;
  onSelect: (tab: RightPanelTab) => void;
  onClosePanel: () => void;
  onChooserChange: (choosing: boolean) => void;
  counts: Partial<Record<RightPanelTab, number>>;
  dragRegion: boolean;
  choosing: boolean;
  maximized?: boolean;
  onToggleMaximized?: () => void;
}) {
  const [openTabs, setOpenTabs] = useState<RightPanelTab[]>(choosing ? [] : [activeTab]);
  const tablist = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (choosing) return;
    setOpenTabs((tabs) => (tabs.includes(activeTab) ? tabs : [...tabs, activeTab]));
    const frame = requestAnimationFrame(() => {
      const selected = tablist.current?.querySelector<HTMLButtonElement>(
        '[role="tab"][aria-selected="true"]',
      );
      const list = tablist.current;
      if (selected && list) {
        const tabBounds = selected.parentElement!.getBoundingClientRect();
        const listBounds = list.getBoundingClientRect();
        if (tabBounds.left < listBounds.left) list.scrollLeft -= listBounds.left - tabBounds.left;
        if (tabBounds.right > listBounds.right)
          list.scrollLeft += tabBounds.right - listBounds.right;
      }
      if (document.activeElement === document.body) selected?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, choosing, activeInstanceId]);
  const renderedTabs = instances ?? openTabs.map((kind) => ({ id: kind, kind, title: undefined }));
  const isSelected = (id: string, kind: RightPanelTab) =>
    !choosing && (instances ? id === activeInstanceId : kind === activeTab);
  const select = (tab: RightPanelTab) => {
    onChooserChange(false);
    onSelect(tab);
  };
  return (
    <div
      className={cn(
        "surface-tabs-header flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-muted/10 px-3",
        dragRegion && "drag-region",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <div
          ref={tablist}
          role="tablist"
          aria-label="Open surfaces"
          className="flex min-w-0 gap-1 overflow-x-auto py-2 surface-tab-scroll [-webkit-app-region:no-drag]"
          onKeyDown={(event) => {
            const tabs = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
            ];
            const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
            if (index < 0) return;
            if (event.key === "Delete") {
              event.preventDefault();
              event.currentTarget
                .querySelectorAll<HTMLButtonElement>("[data-close-surface]")
                [index]?.click();
              return;
            }
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
            tabs[next]?.focus({ preventScroll: true });
            tabs[next]?.click();
          }}
        >
          {renderedTabs.map(({ id, kind, title }) => {
            const surface = surfaces.find((item) => item.id === kind)!;
            const number =
              renderedTabs
                .filter((item) => item.kind === kind)
                .findIndex((item) => item.id === id) + 1;
            const label =
              kind === "browser" && number > 1
                ? `Browser ${number}`
                : kind === "pr"
                  ? "PRs"
                  : surface.label;
            return (
              <div
                style={{ "--surface-tint": surface.tint } as CSSProperties}
                key={id}
                className={cn(
                  "surface-tab flex shrink-0 items-center rounded-full border",
                  isSelected(id, kind)
                    ? "surface-tab-active border-transparent text-foreground"
                    : "border-transparent text-muted-foreground",
                )}
              >
                <button
                  type="button"
                  role="tab"
                  title={title || surface.label}
                  aria-label={kind === "pr" ? surface.label : undefined}
                  aria-selected={isSelected(id, kind)}
                  tabIndex={isSelected(id, kind) ? 0 : -1}
                  aria-controls="companion-surface-body"
                  id={`surface-tab-${id}`}
                  onClick={() => (instances ? onSelectInstance?.(id) : select(kind))}
                  className="flex h-8 items-center gap-1 rounded-l-full pl-2 pr-1.5 surface-tab-label focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {renderedTabs.length <= 3 && (
                    <surface.Icon aria-hidden="true" className={cn("size-3.5", surface.color)} />
                  )}
                  {label}
                  {!!counts[kind] && (
                    <span className="rounded-md bg-muted px-1.5 font-mono text-[10px] tabular-nums">
                      {counts[kind]}
                    </span>
                  )}
                </button>
                <button
                  data-close-surface
                  type="button"
                  aria-label={`Close ${kind === "pr" ? surface.label : label} surface`}
                  title={`Close ${surface.label}`}
                  className="surface-control mr-0.5 flex size-7 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => {
                    if (instances) {
                      onCloseInstance?.(id);
                      return;
                    }
                    const remaining = openTabs.filter((tab) => tab !== kind);
                    setOpenTabs(remaining);
                    if (isSelected(id, kind)) {
                      const next =
                        remaining[Math.min(openTabs.indexOf(kind), remaining.length - 1)];
                      if (next) select(next);
                      else {
                        onChooserChange(true);
                      }
                    }
                    requestAnimationFrame(() => {
                      const next = tablist.current?.querySelector<HTMLButtonElement>(
                        '[role="tab"][aria-selected="true"]',
                      );
                      (next ?? addButton.current)?.focus({ preventScroll: true });
                    });
                  }}
                >
                  <XIcon aria-hidden="true" className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
        <button
          ref={addButton}
          type="button"
          id="surface-add-button"
          aria-label="Open a surface"
          title="Open a surface"
          aria-pressed={choosing && renderedTabs.length > 0}
          onClick={() => {
            onChooserChange(!choosing || renderedTabs.length === 0);
          }}
          className="surface-control flex size-9 shrink-0 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring [-webkit-app-region:no-drag]"
        >
          <PlusIcon aria-hidden="true" className="size-5" />
        </button>
      </div>
      {onToggleMaximized && (
        <button
          type="button"
          onClick={onToggleMaximized}
          aria-label={maximized ? "Restore side panel" : "Expand side panel"}
          title={maximized ? "Restore side panel" : "Expand side panel"}
          aria-pressed={maximized}
          className="surface-control flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring [-webkit-app-region:no-drag]"
        >
          {maximized ? (
            <Minimize2Icon aria-hidden="true" className="size-4" />
          ) : (
            <Maximize2Icon aria-hidden="true" className="size-4" />
          )}
        </button>
      )}
      <button
        type="button"
        aria-label="Close side panel"
        title="Close side panel"
        onClick={onClosePanel}
        className="surface-control flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring [-webkit-app-region:no-drag]"
      >
        <XIcon aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}
