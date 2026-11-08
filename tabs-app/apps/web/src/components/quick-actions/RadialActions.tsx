import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  ArrowUpRight,
  Braces,
  GitBranch,
  HardDrive,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Terminal,
  CircleGauge,
  Clipboard,
  X,
} from "lucide-react";
import { AssistantBubbleIcon } from "../AssistantBubbleIcon";
import { BrowserPlanetIcon } from "../BrowserPlanetIcon";
import { interfaceStudyAccent } from "../../lib/interfaceStudy";
import {
  actionAccentIdentity,
  DEFAULT_SUB_ACTIONS,
  type QuickSubAction,
  type QuickAction,
  type QuickActionId,
  type LauncherDesign,
} from "./actions";
import "./radial-actions.css";

type RadialIconComponent = React.ComponentType<{
  size?: number | string;
  width?: number | string;
  height?: number | string;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

const ICONS: Record<QuickAction["icon"], RadialIconComponent> = {
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
};
const SHORT_LABELS: Record<QuickActionId, string> = {
  "new-tab": "New workspace",
  "new-agent": "Conversation",
  "isolated-agent": "Isolated agent",
  "scratch-browser": "Temp browser",
  "scratch-terminal": "Terminal",
  search: "Search",
  popout: "Pop out chat",
  code: "Code",
  git: "Source control",
  worktrees: "Worktrees",
  usage: "Usage & limits",
  customize: "Customize",
  clipboard: "Clipboard",
};
const accent = (action: QuickAction | undefined) =>
  interfaceStudyAccent(action ? actionAccentIdentity(action) : "settings")[
    "--study-tint" as keyof CSSProperties
  ];
function point(radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return { x: radius * Math.sin(radians), y: -radius * Math.cos(radians) };
}
function sectorLabelWidth(angle: number, step: number) {
  const radians = (angle * Math.PI) / 180;
  const radial = Math.abs(Math.sin(radians));
  const tangent = Math.abs(Math.cos(radians));
  const labelHeight = 28;
  const radialSpace = 54;
  const tangentSpace = 2 * 166 * Math.sin(((step / 2 - 4) * Math.PI) / 180);
  return Math.floor(
    Math.min(
      102,
      radial > 0.01 ? (radialSpace - labelHeight * tangent) / radial : Infinity,
      tangent > 0.01 ? (tangentSpace - labelHeight * radial) / tangent : Infinity,
    ),
  );
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
export function RadialLauncher({
  design,
  actions,
  execute,
  disabled,
  onClose,
  preview = false,
  subActions = DEFAULT_SUB_ACTIONS,
}: {
  design: LauncherDesign;
  actions: readonly QuickAction[];
  execute: (id: QuickActionId, query: string) => Promise<void>;
  disabled: (id: QuickActionId) => string | undefined;
  onClose?: () => void;
  preview?: boolean;
  subActions?: readonly QuickSubAction[] | undefined;
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
  const gradientId = useId().replace(/:/g, "");
  const count = design === "dial" ? 6 : 8;
  const main = actions.slice(0, count - 1);
  const more = actions.filter((action) => !main.some((entry) => entry.id === action.id));
  const nodes: readonly (QuickAction | undefined)[] = [
    ...main,
    ...(more.length ? [undefined] : []),
  ];
  const currentIndex = Math.min(index, Math.max(0, nodes.length - 1));
  const active = nodes[currentIndex];
  const isMore = !active && more.length > 0;
  const children = isMore
    ? more.map((action) => ({ action, label: SHORT_LABELS[action.id], query: "", id: action.id }))
    : subActions
        .filter((entry) => entry.parentId === active?.id)
        .flatMap((entry) => {
          const action = actions.find((candidate) => candidate.id === entry.actionId);
          return action
            ? [
                {
                  action,
                  label: entry.label.trim() || SHORT_LABELS[action.id],
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
  const highlighted = query.trim()
    ? (matched ?? actions.find((action) => action.id === "search"))
    : (selectedSub ?? active);
  const Icon: RadialIconComponent =
    (highlighted ? ICONS[highlighted.icon] : undefined) ?? MoreHorizontal;
  const childStep =
    design === "sectors"
      ? children.length > 3
        ? 32
        : 44
      : children.length <= 2
        ? 48
        : children.length === 3
          ? 38
          : design === "dial"
            ? 26
            : 30;
  const trimmedQuery = query.trim();
  const isUrl =
    Boolean(trimmedQuery) &&
    (/^https?:\/\//i.test(trimmedQuery) ||
      /^(localhost|[\w-]+(?:\.[\w-]+)+)(:\d+)?(?:\/.*)?$/.test(trimmedQuery));
  const childAngle = (i: number) => activeAngle + (i - (children.length - 1) / 2) * childStep;
  const activeAngle = (currentIndex * 360) / Math.max(nodes.length, 1);
  const run = async (action: QuickAction | undefined, target = query) => {
    if (
      action?.id === "search" &&
      (!target.trim() || (target.includes("{query}") && !query.trim()))
    ) {
      setSearchTemplate(target.includes("{query}") ? target : null);
      setSearching(true);
      requestAnimationFrame(() => input.current?.focus());
      return;
    }
    if (!action || busy || disabled(action.id)) return;
    setBusy(true);
    setError(null);
    try {
      await execute(
        action.id,
        target.includes("{query}")
          ? target.replaceAll("{query}", encodeURIComponent(query))
          : target,
      );
      onClose?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      root.current?.focus();
    }
  };
  const submitSearch = (customTemplate = searchTemplate) => {
    if (!query.trim()) return;
    const searchAction = actions.find((action) => action.id === "search");
    if (!searchAction) return;
    if (customTemplate) {
      void run(searchAction, customTemplate);
    } else {
      void run(matched ?? searchAction, query);
    }
  };
  const select = (next: number, focus = false) => {
    let value = (next + nodes.length) % nodes.length;
    if (focus) {
      const direction = next >= currentIndex ? 1 : -1;
      for (let attempts = 0; attempts < nodes.length; attempts++) {
        const candidate = nodes[value];
        if (!candidate || !disabled(candidate.id)) break;
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
          "--qa-action-color": accent(highlighted),
          "--qa-angle": `${activeAngle}deg`,
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
              if (!disabled(children[next]!.action.id)) break;
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
            if (searchTemplate)
              void run(
                actions.find((action) => action.id === "search"),
                searchTemplate,
              );
            else void run(matched ?? actions.find((action) => action.id === "search"));
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
            (event.target as Element).closest(".qa-more-action") ||
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
        <div className="qa-radial-disc" aria-hidden="true" />
        {design !== "sectors" && !searching && (
          <svg className="qa-halo-art" viewBox="-280 -280 560 560" aria-hidden="true">
            <defs>
              <radialGradient
                id={`${gradientId}-halo`}
                gradientUnits="userSpaceOnUse"
                cx="0"
                cy="0"
                r="182"
              >
                <stop offset=".12" stopColor="var(--qa-action-color)" stopOpacity=".95" />
                <stop offset=".45" stopColor="var(--qa-action-color)" stopOpacity=".5" />
                <stop offset="1" stopColor="var(--qa-action-color)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <path
              fill={`url(#${gradientId}-halo)`}
              d={radialSector(
                44,
                180,
                activeAngle - 180 / nodes.length - 3,
                activeAngle + 180 / nodes.length + 3,
                1,
              )}
            />
          </svg>
        )}
        {design === "sectors" && !searching && (
          <svg className="qa-sector-art" viewBox="-280 -280 560 560" aria-hidden="true">
            <defs>
              {nodes.map((action, i) => (
                <radialGradient
                  key={i}
                  id={`${gradientId}-${i}`}
                  gradientUnits="userSpaceOnUse"
                  cx="0"
                  cy="0"
                  r="180"
                >
                  <stop offset=".2" stopColor={String(accent(action))} stopOpacity=".65" />
                  <stop offset="1" stopColor={String(accent(action))} stopOpacity=".12" />
                </radialGradient>
              ))}
            </defs>
            {nodes.map((action, i) => (
              <path
                key={i}
                d={radialSector(
                  60,
                  128,
                  (i * 360) / nodes.length - 180 / nodes.length + 2,
                  (i * 360) / nodes.length + 180 / nodes.length - 2,
                )}
                data-current={i === currentIndex}
                style={{
                  fill: i === currentIndex ? `url(#${gradientId}-${i})` : undefined,
                  stroke: i === currentIndex ? String(accent(action)) : undefined,
                }}
              />
            ))}
            {expanded &&
              !searching &&
              children.map((entry, i) => (
                <path
                  key={`sub-${entry.id}`}
                  className="qa-sub-sector"
                  data-current={i === subIndex}
                  d={radialSector(
                    134,
                    198,
                    childAngle(i) - childStep / 2 + 1.4,
                    childAngle(i) + childStep / 2 - 1.4,
                    9,
                  )}
                />
              ))}
          </svg>
        )}
        {!searching &&
          nodes.map((action, i) => {
            const p = point(
                design === "sectors" ? 94 : design === "dial" ? 108 : 112,
                (i * 360) / nodes.length,
              ),
              NodeIcon: RadialIconComponent =
                (action ? ICONS[action.icon] : undefined) ?? MoreHorizontal;
            const reason = action ? disabled(action.id) : undefined;
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
                    "--qa-node-color": accent(action),
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
                {design === "dial" && <span>{action ? SHORT_LABELS[action.id] : "More"}</span>}
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
                className="qa-search-go-btn"
                aria-label="Submit search - Search the web"
                disabled={busy || !query.trim()}
                onClick={() => submitSearch()}
              >
                <span>Go</span>
                <kbd className="qa-search-kbd">↵</kbd>
              </button>
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
                <X size={13} width={13} height={13} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
        {!searching && (
          <div className="qa-radial-hub">
            <Icon size={24} width={24} height={24} aria-hidden="true" />
            <span className="qa-hub-label">
              {expanded && subIndex >= 0
                ? children[subIndex]?.label
                : highlighted
                  ? SHORT_LABELS[highlighted.id]
                  : "More"}
            </span>
            <span className="sr-only">Type to search</span>
          </div>
        )}
        {expanded &&
          !searching &&
          children.map((entry, i) => {
            const { action } = entry;
            const angle = childAngle(i);
            const p = point(design === "sectors" ? 166 : design === "dial" ? 204 : 206, angle);
            const reason = disabled(action.id);
            return (
              <button
                key={entry.id}
                type="button"
                className="qa-more-action"
                data-sub-index={i}
                data-current={i === subIndex}
                style={
                  {
                    left: 280 + p.x,
                    top: 280 + p.y,
                    "--qa-node-color": accent(action),
                    "--qa-sector-label-width":
                      design === "sectors" ? `${sectorLabelWidth(angle, childStep)}px` : undefined,
                  } as CSSProperties
                }
                disabled={busy || Boolean(reason)}
                aria-label={reason ? `${entry.label}: ${reason}` : entry.label}
                title={`${entry.label} · ${reason ?? action.detail}`}
                onPointerEnter={() => setSubIndex(i)}
                onFocus={() => setSubIndex(i)}
                onClick={() => void run(action, entry.query)}
              >
                {design === "sectors" ? <span>{entry.label}</span> : entry.label}
              </button>
            );
          })}
      </div>
      <span className="sr-only" aria-live="polite">
        {label}.{" "}
        {highlighted
          ? (disabled(highlighted.id) ?? highlighted.detail)
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
