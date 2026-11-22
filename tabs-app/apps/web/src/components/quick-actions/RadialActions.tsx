import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Braces,
  Bug,
  Cloud,
  Database,
  FlaskConical,
  GitBranch,
  HardDrive,
  Link,
  MoreHorizontal,
  Play,
  Plus,
  Rocket,
  Search,
  Settings2,
  Star,
  Terminal,
  CircleGauge,
  Clipboard,
  X,
  Zap,
  Inbox,
  Coffee,
  ToggleRight,
} from "lucide-react";
import { AssistantBubbleIcon } from "../AssistantBubbleIcon";
import { BrowserPlanetIcon } from "../BrowserPlanetIcon";
import { TabsMascot } from "../TabsMascot";
import {
  DEFAULT_SUB_ACTIONS,
  QUICK_ACTIONS,
  RING_SLOTS,
  KEEP_LAUNCHER_OPEN,
  actionRunId,
  type QuickSubAction,
  type QuickAction,
  type QuickActionId,
  type LauncherDesign,
} from "./actions";
import { CurvedMenu, type CurvedMenuBounds, type CurvedMenuRow } from "./CurvedMenu";
import "./radial-actions.css";

type RadialIconComponent = React.ComponentType<{
  size?: number | string;
  width?: number | string;
  height?: number | string;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

export const QUICK_ACTION_ICONS: Record<QuickAction["icon"], RadialIconComponent> = {
  tab: Plus,
  agent: AssistantBubbleIcon,
  branch: GitBranch,
  browser: BrowserPlanetIcon,
  terminal: Terminal,
  search: Search,
  popout: ArrowUpRight,
  code: Braces,
  storage: HardDrive,
  usage: CircleGauge,
  settings: Settings2,
  clipboard: Clipboard,
  inbox: Inbox,
  away: Coffee,
  toggles: ToggleRight,
  star: Star,
  link: Link,
  zap: Zap,
  book: BookOpen,
  rocket: Rocket,
  bug: Bug,
  database: Database,
  cloud: Cloud,
  play: Play,
  flask: FlaskConical,
};
/** One or two words: labels sit on a ring and must never wrap. */
const SHORT_LABELS: Record<QuickActionId, string> = {
  "new-tab": "New tab",
  "new-agent": "New chat",
  "isolated-agent": "Isolated",
  "scratch-browser": "Browser",
  "scratch-terminal": "Terminal",
  search: "Search",
  "session-search": "Sessions",
  "ask-teammate": "Ask",
  popout: "Pop out",
  code: "Code",
  git: "Git",
  worktrees: "Worktrees",
  usage: "Usage",
  customize: "Customize",
  clipboard: "Clipboard",
  "extension-tool": "Extension",
  "open-thread": "Open",
  "terminal-quick-command": "Command",
  inbox: "Inbox",
  away: "Away",
  toggles: "Toggles",
};
const SEARCH_ACTION = QUICK_ACTIONS.find((action) => action.id === "search")!;
function shortLabel(action: QuickAction): string {
  return "custom" in action ? action.label : SHORT_LABELS[action.id];
}
/** The site a shortcut opens, shown quietly beside its name. */
function destinationHint(query: string): string | null {
  if (!query) return null;
  try {
    return new URL(query.replace("{query}", "x")).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
function point(radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return { x: radius * Math.sin(radians), y: -radius * Math.cos(radians) };
}
/**
 * Selection angles keep counting past 360 degrees so the indicator always
 * takes the short way round instead of spinning back through every action.
 */
function useContinuousAngle(angle: number): number {
  const last = useRef(angle);
  const delta = ((((angle - last.current) % 360) + 540) % 360) - 180;
  last.current += delta;
  return last.current;
}
export function radialSector(inner: number, outer: number, start: number, end: number, corner = 7) {
  const p = (radius: number, angle: number) => {
    const v = point(radius, angle);
    return `${v.x.toFixed(2)} ${v.y.toFixed(2)}`;
  };
  const dO = (Math.asin(corner / (outer - corner)) * 180) / Math.PI,
    dI = (Math.asin(corner / (inner + corner)) * 180) / Math.PI;
  const eo = Math.sqrt((outer - corner) ** 2 - corner ** 2),
    ei = Math.sqrt((inner + corner) ** 2 - corner ** 2);
  return `M${p(outer, start + dO)}A${outer} ${outer} 0 0 1 ${p(outer, end - dO)}A${corner} ${corner} 0 0 1 ${p(eo, end)}L${p(ei, end)}A${corner} ${corner} 0 0 1 ${p(inner, end - dI)}A${inner} ${inner} 0 0 0 ${p(inner, start + dI)}A${corner} ${corner} 0 0 1 ${p(ei, start)}L${p(eo, start)}A${corner} ${corner} 0 0 1 ${p(outer, start + dO)}Z`;
}
export type FlyoutShape = "curved" | "card";

/** The plate's radius, and the gap a flyout keeps from it. */
const PLATE_RADIUS = 170;
const FLYOUT_GAP = 10;
export const SUB_PANEL_WIDTH = 178;

export interface SubPanelPlacement {
  /** Top-left corner, relative to the ring's center. */
  left: number;
  top: number;
  origin: string;
}

/**
 * Where a card sub-menu sits for the action at `angle` (0 is the top, clockwise): straight out
 * from that action, past the plate, with the edge or corner that faces the ring touching it.
 */
export function subPanelPlacement(input: {
  angle: number;
  width: number;
  height: number;
}): SubPanelPlacement {
  const radians = (input.angle * Math.PI) / 180;
  const dx = Math.sin(radians),
    dy = -Math.cos(radians);
  const reach = Math.max(Math.abs(dx), Math.abs(dy));
  // Square up the direction, so a diagonal action meets the panel's corner and a straight one
  // meets the middle of an edge.
  const sx = dx / reach,
    sy = dy / reach;
  const distance = PLATE_RADIUS + FLYOUT_GAP;
  const left = dx * distance - input.width / 2 + (input.width / 2) * sx;
  const top = dy * distance - input.height / 2 + (input.height / 2) * sy;
  return { left, top, origin: `${50 - 50 * sx}% ${50 - 50 * sy}%` };
}

export function RadialLauncher({
  design,
  actions,
  execute,
  disabled,
  onClose,
  preview = false,
  subActions = DEFAULT_SUB_ACTIONS,
  flyoutShape = "curved",
}: {
  design: LauncherDesign;
  actions: readonly QuickAction[];
  execute: (id: QuickActionId, query: string) => Promise<void | typeof KEEP_LAUNCHER_OPEN>;
  disabled: (id: QuickActionId) => string | undefined;
  onClose?: () => void;
  preview?: boolean;
  subActions?: readonly QuickSubAction[] | undefined;
  flyoutShape?: FlyoutShape | undefined;
}) {
  const root = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const [scale, setScale] = useState(1),
    [index, setIndex] = useState(0),
    [expanded, setExpanded] = useState(false),
    [subIndex, setSubIndex] = useState(-1),
    [query, setQuery] = useState(""),
    [searching, setSearching] = useState(false),
    [searchTemplate, setSearchTemplate] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const main = actions.slice(0, RING_SLOTS);
  const more = actions.filter((action) => !main.some((entry) => entry.id === action.id));
  const nodes: readonly (QuickAction | undefined)[] = [
    ...main,
    ...(more.length ? [undefined] : []),
  ];
  const currentIndex = Math.min(index, Math.max(0, nodes.length - 1));
  const active = nodes[currentIndex];
  const isMore = !active && more.length > 0;
  const children = isMore
    ? // Pills have room for the full name; only ring nodes use the short one.
      more.map((action) => ({ action, label: action.label, query: "", id: action.id }))
    : subActions
        .filter((entry) => entry.parentId === active?.id)
        .flatMap((entry) => {
          const action = actions.find((candidate) => candidate.id === entry.actionId);
          return action
            ? [
                {
                  action,
                  label: entry.label.trim() || shortLabel(action),
                  query: entry.query,
                  id: entry.id,
                },
              ]
            : [];
        })
        .slice(0, 8);
  const selectedSub = expanded && subIndex >= 0 ? children[subIndex]?.action : undefined;
  const matched =
    query.trim() && !searchTemplate
      ? actions.find((action) =>
          `${action.label} ${action.detail}`.toLowerCase().includes(query.toLowerCase()),
        )
      : undefined;
  const highlighted = query.trim() ? (matched ?? SEARCH_ACTION) : (selectedSub ?? active);
  const activeAngle = (currentIndex * 360) / Math.max(nodes.length, 1);
  const indicatorAngle = useContinuousAngle(activeAngle);
  const wedge = 360 / Math.max(nodes.length, 1);
  // Sub-actions open straight out from the action they belong to, just past the blue band.
  const subPanelRef = useRef<HTMLDivElement>(null);
  const [subPanelHeight, setSubPanelHeight] = useState(0);
  const estimatedHeight = 40 + children.length * 37;
  const flyout = subPanelPlacement({
    angle: activeAngle,
    width: SUB_PANEL_WIDTH,
    height: subPanelHeight || estimatedHeight,
  });
  // The visible window, in ring coordinates, so a curved menu can turn to stay on screen.
  const [menuBounds, setMenuBounds] = useState<CurvedMenuBounds | null>(null);
  useLayoutEffect(() => {
    if (!expanded) return;
    const measure = () => {
      const box = root.current?.getBoundingClientRect();
      if (!box || !scale) return;
      const cx = box.left + box.width / 2,
        cy = box.top + box.height / 2;
      const margin = 8;
      setMenuBounds({
        left: (margin - cx) / scale,
        top: (margin - cy) / scale,
        right: (window.innerWidth - margin - cx) / scale,
        bottom: (window.innerHeight - margin - cy) / scale,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [expanded, scale]);
  useLayoutEffect(() => {
    const panel = subPanelRef.current;
    if (!panel) return;
    const measure = () => setSubPanelHeight(panel.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [expanded, searching, children.length]);
  const eyes = point(16, activeAngle);
  const run = async (action: QuickAction | undefined, given = query) => {
    // A custom action always runs with its own saved input.
    const target = action && "custom" in action ? action.custom.query : given;
    const runId = action ? actionRunId(action) : undefined;
    if (runId === "search" && (!target.trim() || (target.includes("{query}") && !query.trim()))) {
      setSearchTemplate(target.includes("{query}") ? target : null);
      setSearching(true);
      requestAnimationFrame(() => input.current?.focus());
      return;
    }
    if (!action || !runId || busy || disabled(runId)) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await execute(
        runId,
        target.includes("{query}")
          ? target.replaceAll("{query}", encodeURIComponent(query))
          : target,
      );
      // A glance opens inside the launcher, so it stays open.
      if (outcome !== KEEP_LAUNCHER_OPEN) onClose?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      root.current?.focus();
    }
  };
  const submitSearch = (customTemplate = searchTemplate) => {
    if (!query.trim()) return;
    if (customTemplate) {
      void run(SEARCH_ACTION, customTemplate);
    } else {
      void run(matched ?? SEARCH_ACTION, query);
    }
  };
  const select = (next: number, focus = false) => {
    let value = (next + nodes.length) % nodes.length;
    if (focus) {
      const direction = next >= currentIndex ? 1 : -1;
      for (let attempts = 0; attempts < nodes.length; attempts++) {
        const candidate = nodes[value];
        if (!candidate || !disabled(actionRunId(candidate))) break;
        value = (value + direction + nodes.length) % nodes.length;
      }
    }
    setIndex(value);
    setSubIndex(-1);
    setExpanded(true);
    if (focus)
      root.current?.querySelector<HTMLButtonElement>(`[data-radial-index="${value}"]`)?.focus();
  };
  useEffect(() => {
    if (!preview) root.current?.focus();
  }, [preview]);
  useEffect(() => {
    if (!root.current) return;
    const update = () => setScale(Math.min(1, root.current!.getBoundingClientRect().width / 560));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const label = query.trim()
    ? matched
      ? `Run ${matched.label}`
      : "Search the web"
    : (selectedSub?.label ?? active?.label ?? "More actions");
  return (
    <div
      ref={root}
      tabIndex={-1}
      className={`qa-radial-surface qa-radial-${design}`}
      data-qa-preview={preview}
      aria-busy={busy}
      style={
        {
          "--qa-angle": `${indicatorAngle}deg`,
          "--qa-scale": scale,
        } as CSSProperties
      }
      onKeyDown={(event) => {
        if (
          !searching &&
          event.key.length === 1 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          event.key !== " "
        ) {
          event.preventDefault();
          setSearching(true);
          setQuery(event.key);
          requestAnimationFrame(() => input.current?.focus());
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (searching) {
            setSearching(false);
            setQuery("");
            setSearchTemplate(null);
            root.current?.focus();
            return;
          }
          onClose?.();
          return;
        }
        if (searching) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          if (event.target === input.current && query) return;
          event.preventDefault();
          select(currentIndex + (event.key === "ArrowRight" ? 1 : -1), true);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (children.length) {
            setExpanded(true);
            const direction = event.key === "ArrowDown" ? 1 : -1;
            let next =
              subIndex < 0
                ? direction > 0
                  ? 0
                  : children.length - 1
                : (subIndex + direction + children.length) % children.length;
            for (let attempts = 0; attempts < children.length; attempts++) {
              if (!disabled(actionRunId(children[next]!.action))) break;
              next = (next + direction + children.length) % children.length;
            }
            setSubIndex(next);
            requestAnimationFrame(() =>
              root.current?.querySelector<HTMLButtonElement>(`[data-sub-index="${next}"]`)?.focus(),
            );
          } else select(currentIndex + (event.key === "ArrowDown" ? 1 : -1), true);
        } else if (
          event.key === "Enter" &&
          (event.target === input.current || event.target === root.current)
        ) {
          event.preventDefault();
          if (query.trim()) {
            if (searchTemplate) void run(SEARCH_ACTION, searchTemplate);
            else void run(matched ?? SEARCH_ACTION);
          } else if (isMore) {
            setExpanded(true);
            setSubIndex(Math.max(subIndex, 0));
          } else void run(active);
        }
      }}
    >
      <div
        className="qa-radial-canvas"
        data-searching={searching}
        onPointerDown={(event) => {
          if (
            searching &&
            !(event.target as Element).closest(".qa-search-panel, .qa-radial-node")
          ) {
            setSearching(false);
            setQuery("");
            setSearchTemplate(null);
            root.current?.focus();
          }
        }}
        onPointerMove={(event) => {
          if (
            (event.target as Element).closest(".qa-sub-panel") ||
            (expanded && children.length > 0)
          )
            return;
          const rect = root.current!.getBoundingClientRect(),
            dx = (event.clientX - rect.left - rect.width / 2) / scale,
            dy = (event.clientY - rect.top - rect.height / 2) / scale;
          const radius = Math.hypot(dx, dy);
          if (radius < 64 || radius > 155 || (expanded && children.length > 0 && radius > 138))
            return;
          const next =
            Math.round(
              (((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360) / (360 / nodes.length),
            ) % nodes.length;
          if (next !== currentIndex) select(next);
        }}
      >
        {!searching && <div className="qa-radial-disc" aria-hidden="true" />}
        {!searching && (
          <svg className="qa-ring-art" viewBox="-280 -280 560 560" aria-hidden="true">
            {design === "sectors" ? (
              nodes.map((_, i) => (
                <path
                  key={i}
                  className="qa-sector"
                  data-current={i === currentIndex}
                  d={radialSector(
                    60,
                    134,
                    i * wedge - wedge / 2 + 1.5,
                    i * wedge + wedge / 2 - 1.5,
                  )}
                />
              ))
            ) : (
              <circle className="qa-ring-track" r={112} />
            )}
            {/* The selection glides around the ring to the active action. */}
            <g className="qa-indicator">
              {design === "sectors" ? (
                <path
                  className="qa-indicator-band"
                  d={radialSector(137, 145, -wedge / 2 + 2, wedge / 2 - 2, 3)}
                />
              ) : (
                <>
                  <path
                    className="qa-indicator-wedge"
                    d={radialSector(50, 160, -wedge / 2, wedge / 2, 6)}
                  />
                  <path
                    className="qa-indicator-band"
                    d={radialSector(156, 162, -wedge / 2 + 6, wedge / 2 - 6, 3)}
                  />
                </>
              )}
            </g>
          </svg>
        )}
        {!searching &&
          nodes.map((action, i) => {
            const p = point(design === "sectors" ? 97 : 112, (i * 360) / nodes.length),
              NodeIcon: RadialIconComponent =
                (action ? QUICK_ACTION_ICONS[action.icon] : undefined) ?? MoreHorizontal;
            const reason = action ? disabled(actionRunId(action)) : undefined;
            return (
              <button
                key={action?.id ?? "more"}
                type="button"
                className="qa-radial-node"
                data-radial-index={i}
                data-current={i === currentIndex}
                style={
                  {
                    left: 280 + p.x,
                    top: 280 + p.y,
                  } as CSSProperties
                }
                disabled={busy || Boolean(reason)}
                aria-label={
                  reason ? `${action!.label}: ${reason}` : (action?.label ?? "More actions")
                }
                aria-expanded={
                  !action || subActions.some((entry) => entry.parentId === action.id)
                    ? expanded && i === currentIndex
                    : undefined
                }
                title={reason ?? action?.detail ?? "Workspace and settings actions"}
                onFocus={() => {
                  setIndex(i);
                  setSubIndex(-1);
                  setExpanded(true);
                }}
                onPointerEnter={() => select(i)}
                onClick={() => {
                  if (action) void run(action);
                  else {
                    setExpanded(true);
                    setSubIndex(-1);
                  }
                }}
              >
                <NodeIcon aria-hidden="true" size={22} width={22} height={22} />
              </button>
            );
          })}
        {searching && (
          <div
            className="qa-search-panel"
            role="region"
            aria-label="Search or enter URL"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="qa-search-input-row">
              <Search className="qa-search-input-icon" width={15} height={15} aria-hidden="true" />
              <input
                ref={input}
                autoFocus
                type="text"
                aria-label="Find an action, search the web, or enter a URL"
                placeholder="Search or enter URL…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    submitSearch();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setSearching(false);
                    setQuery("");
                    setSearchTemplate(null);
                    root.current?.focus();
                  }
                }}
              />
              {query.trim() && (
                <button
                  type="button"
                  className="qa-search-panel-clear"
                  aria-label="Clear query"
                  onClick={() => {
                    setQuery("");
                    input.current?.focus();
                  }}
                >
                  <X size={12} width={12} height={12} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className="qa-search-go-btn"
                aria-label="Submit search - Search the web"
                disabled={busy || !query.trim()}
                onClick={() => submitSearch()}
              >
                <span>Go</span>
                <kbd className="qa-search-kbd">↵</kbd>
              </button>
            </div>
            <div className="qa-search-footer">
              <div className="qa-search-engines" role="radiogroup" aria-label="Search engine">
                <button
                  type="button"
                  className="qa-search-engine-chip"
                  data-active={!searchTemplate || searchTemplate.includes("google")}
                  onClick={() => {
                    setSearchTemplate("https://www.google.com/search?q={query}");
                    input.current?.focus();
                  }}
                >
                  Google
                </button>
                <button
                  type="button"
                  className="qa-search-engine-chip"
                  data-active={Boolean(searchTemplate?.includes("duckduckgo"))}
                  onClick={() => {
                    setSearchTemplate("https://duckduckgo.com/?q={query}");
                    input.current?.focus();
                  }}
                >
                  DuckDuckGo
                </button>
              </div>
              <button
                type="button"
                className="qa-search-panel-close"
                aria-label="Close search"
                title="Close search (Esc)"
                onClick={() => {
                  setSearching(false);
                  setQuery("");
                  setSearchTemplate(null);
                  root.current?.focus();
                }}
              >
                <kbd>esc</kbd>
                <span>to close</span>
              </button>
            </div>
          </div>
        )}
        {!searching && (
          <div className="qa-radial-hub">
            <TabsMascot mode="intro" eyeColor="var(--popover)" look={eyes} />
            <span className="sr-only">Type to search</span>
          </div>
        )}
        {expanded && !searching && children.length > 0 && flyoutShape === "curved" && (
          <CurvedMenu
            angle={activeAngle}
            center={280}
            title={active ? shortLabel(active) : "More"}
            label={`${active?.label ?? "More"} options`}
            current={subIndex}
            busy={busy}
            bounds={menuBounds}
            // More's long list wraps the ring's side; the others centre on their action.
            wrap={isMore}
            onHover={setSubIndex}
            onRun={(i) => {
              const entry = children[i];
              if (entry) void run(entry.action, entry.query);
            }}
            rows={children.map((entry) => {
              const reason = disabled(actionRunId(entry.action));
              return {
                id: entry.id,
                label: entry.label,
                hint: destinationHint(entry.query),
                icon: QUICK_ACTION_ICONS[entry.action.icon] as CurvedMenuRow["icon"],
                disabledReason: reason,
                title: `${entry.label} · ${reason ?? entry.action.detail}`,
              };
            })}
          />
        )}
        {expanded && !searching && children.length > 0 && flyoutShape === "card" && (
          <div
            ref={subPanelRef}
            className="qa-sub-panel"
            role="group"
            aria-label={`${active?.label ?? "More"} options`}
            style={
              {
                left: 280 + flyout.left,
                top: 280 + flyout.top,
                width: SUB_PANEL_WIDTH,
                transformOrigin: flyout.origin,
              } as CSSProperties
            }
            onPointerDown={(event) => event.stopPropagation()}
          >
            <p className="qa-sub-title">{active ? shortLabel(active) : "More"}</p>
            {children.map((entry, i) => {
              const { action } = entry;
              const reason = disabled(actionRunId(action));
              const RowIcon = QUICK_ACTION_ICONS[action.icon];
              const hint = destinationHint(entry.query);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className="qa-more-action"
                  data-sub-index={i}
                  data-current={i === subIndex}
                  disabled={busy || Boolean(reason)}
                  aria-label={reason ? `${entry.label}: ${reason}` : entry.label}
                  title={`${entry.label} · ${reason ?? action.detail}`}
                  onPointerEnter={() => setSubIndex(i)}
                  onFocus={() => setSubIndex(i)}
                  onClick={() => void run(action, entry.query)}
                >
                  <RowIcon aria-hidden="true" size={15} width={15} height={15} />
                  <span className="qa-sub-label">{entry.label}</span>
                  {hint && <span className="qa-sub-hint">{hint}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {label}.{" "}
        {highlighted
          ? (disabled(actionRunId(highlighted)) ?? highlighted.detail)
          : "Choose a secondary action."}{" "}
        Arrow keys select. Enter runs. Escape closes.
      </span>
      {error && (
        <p className="qa-radial-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
