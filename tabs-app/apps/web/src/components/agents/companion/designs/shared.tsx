import { Maximize2Icon, Minimize2Icon, PlusIcon, XIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useStaggerIn } from "./motion";
import type { RightPanelTab } from "~/stores/rightPanelStore";
import { cn } from "~/lib/utils";
import { surfaces, type DisabledSurfaces, type SurfaceInstance } from "../SurfaceTabs";

export interface CompanionDesignProps {
  instances: ReadonlyArray<SurfaceInstance>;
  activeId: string | null;
  choosing: boolean;
  counts: Partial<Record<RightPanelTab, number>>;
  /** Surfaces that cannot open, with why; the launcher and switcher show them unavailable. */
  disabledSurfaces?: DisabledSurfaces | undefined;
  dragRegion: boolean;
  maximized: boolean;
  projectName?: string | undefined;
  onToggleMaximized: () => void;
  onClosePanel: () => void;
  /** Opens a surface; browsers always get a fresh tab. */
  onOpen: (kind: RightPanelTab) => void;
  /** Shows the surface of this kind that is already open, or opens one. */
  onFocusKind: (kind: RightPanelTab) => void;
  attachmentFor?: ((id: string) => File | null) | undefined;
  onSelectInstance: (id: string) => void;
  onCloseInstance: (id: string) => void;
  /** Renames a tab (device tabs). An empty title restores the default name. */
  onRenameInstance?: ((id: string, title: string) => void) | undefined;
  onChooserChange: (choosing: boolean) => void;
  /** The active surface. Null while the chooser is showing. */
  body: ReactNode;
}

export function activeInstance(props: Pick<CompanionDesignProps, "instances" | "activeId">) {
  return props.instances.find((item) => item.id === props.activeId) ?? null;
}

/** Maximise and close. Every design keeps these two in the same order. */
export function PanelControls({
  maximized,
  onToggleMaximized,
  onClosePanel,
  className,
  vertical = false,
}: Pick<CompanionDesignProps, "maximized" | "onToggleMaximized" | "onClosePanel"> & {
  className?: string;
  vertical?: boolean;
}) {
  return (
    <div className={cn("cd-controls", vertical && "cd-controls-vertical", className)}>
      <button
        type="button"
        className="cd-icon"
        onClick={onToggleMaximized}
        aria-label={maximized ? "Restore side panel" : "Expand side panel"}
        title={maximized ? "Restore side panel" : "Expand side panel"}
        aria-pressed={maximized}
      >
        {maximized ? (
          <Minimize2Icon aria-hidden="true" size={15} />
        ) : (
          <Maximize2Icon aria-hidden="true" size={15} />
        )}
      </button>
      <button
        type="button"
        className="cd-icon"
        onClick={onClosePanel}
        aria-label="Close side panel"
        title="Close side panel"
      >
        <XIcon aria-hidden="true" size={16} />
      </button>
    </div>
  );
}

/** The surface body. The chooser replaces it while `choosing` is true. */
export function SurfaceBody({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      id="companion-surface-body"
      role="region"
      aria-label={label}
      className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}
    >
      {children}
    </div>
  );
}

export { surfaces };

export interface SubTab {
  id: string;
  label: string;
  title?: string | undefined;
  /** Shows a small activity mark, e.g. a terminal with a running process. */
  busy?: boolean | undefined;
}

/**
 * The second row under the surface switcher: browser pages, terminal sessions. One component so
 * every multi-instance surface behaves the same way.
 */
export function SurfaceSubTabs({
  label,
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  newLabel,
  actions,
  onRename,
  attachmentFor,
}: {
  attachmentFor?: ((id: string) => File | null) | undefined;
  label: string;
  tabs: ReadonlyArray<SubTab>;
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  newLabel: string;
  actions?: ReactNode;
  /** When set, a double-click or right-click renames the tab in place. */
  onRename?: ((id: string, title: string) => void) | undefined;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const finishRename = (id: string, value: string) => {
    setRenaming(null);
    onRename?.(id, value.trim());
  };
  useStaggerIn(row, ".cd-subtab", String(tabs.length), { y: 0, stagger: 0.03 });
  return (
    <div className="cd-subtabs" ref={row}>
      <div
        role="tablist"
        aria-label={label}
        className="cd-subtabs-list"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
          const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
          const index = items.indexOf(document.activeElement as HTMLElement);
          if (index < 0) return;
          event.preventDefault();
          const next =
            items[(index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length];
          next?.focus();
          next?.click();
        }}
      >
        {tabs.map((tab) => {
          const selected = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className="cd-subtab"
              data-selected={selected}
              data-companion-surface-id={tab.id}
            >
              {renaming === tab.id ? (
                <input
                  autoFocus
                  aria-label={`Rename ${tab.label}`}
                  defaultValue={tab.label}
                  className="cd-subtab-rename"
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={(event) => finishRename(tab.id, event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      event.currentTarget.value = tab.label;
                      event.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  draggable={Boolean(attachmentFor)}
                  onDragStart={
                    attachmentFor
                      ? (event) => {
                          const file = attachmentFor(tab.id);
                          if (!file) {
                            event.preventDefault();
                            return;
                          }
                          event.dataTransfer.effectAllowed = "copy";
                          event.dataTransfer.items.add(file);
                        }
                      : undefined
                  }
                  title={tab.title ?? tab.label}
                  onClick={() => onSelect(tab.id)}
                  onDoubleClick={onRename ? () => setRenaming(tab.id) : undefined}
                  onContextMenu={
                    onRename
                      ? (event) => {
                          event.preventDefault();
                          setRenaming(tab.id);
                        }
                      : undefined
                  }
                >
                  {tab.busy && <span className="cd-subtab-busy" aria-label="Running" />}
                  <span className="cd-subtab-label">{tab.label}</span>
                </button>
              )}
              <button
                type="button"
                className="cd-subtab-close"
                aria-label={`Close ${tab.label}`}
                title={`Close ${tab.label}`}
                onClick={() => onClose(tab.id)}
              >
                <XIcon aria-hidden="true" size={11} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="cd-icon cd-subtabs-new"
        aria-label={newLabel}
        title={newLabel}
        onClick={onNew}
      >
        <PlusIcon aria-hidden="true" size={14} />
      </button>
      {actions && <div className="cd-subtabs-actions">{actions}</div>}
    </div>
  );
}
