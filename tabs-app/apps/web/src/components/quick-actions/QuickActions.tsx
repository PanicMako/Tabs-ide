import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Bot,
  Braces,
  CircleGauge,
  Compass,
  GitBranch,
  Globe,
  HardDrive,
  Plus,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { useSettings } from "~/hooks/useSettings";
import { useKeybindings } from "~/state/settings";
import { resolveShortcutCommand, shortcutLabelForCommand } from "~/keybindings";
import {
  LAUNCHER_DESIGNS,
  clampLauncher,
  orderedActions,
  type QuickAction,
  type QuickActionId,
  type LauncherDesign,
} from "./actions";
import "./quick-actions.css";

const ICONS = {
  tab: Plus,
  agent: Bot,
  branch: GitBranch,
  browser: Globe,
  search: Search,
  popout: ArrowUpRight,
  code: Braces,
  storage: HardDrive,
  usage: CircleGauge,
  settings: Settings2,
};
export interface ActionContext {
  execute: (id: QuickActionId, query: string) => Promise<void>;
  disabled: (id: QuickActionId) => string | undefined;
}
const Context = createContext<ActionContext | null>(null);
export const useQuickActions = () => useContext(Context);

export function LauncherSurface({
  design,
  actions,
  execute,
  disabled,
  onClose,
  preview = false,
}: {
  design: LauncherDesign;
  actions: readonly QuickAction[];
  execute: ActionContext["execute"];
  disabled: ActionContext["disabled"];
  onClose?: () => void;
  preview?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const focusFrame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    },
    [],
  );
  const queryMatches = actions.filter((a) =>
    `${a.label} ${a.detail} ${a.group}`.toLowerCase().includes(query.toLowerCase()),
  );
  const filtered = query
    ? queryMatches.length
      ? queryMatches
      : actions.filter((a) => a.id === "search")
    : actions;
  const pageSize = design === "compass" ? 4 : design === "matrix" ? 9 : filtered.length || 1;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(
    (page % pageCount) * pageSize,
    ((page % pageCount) + 1) * pageSize,
  );
  const index = Math.min(selected, Math.max(0, visible.length - 1));
  const active = visible[index];
  const invoke = async (action: QuickAction) => {
    if (busy || disabled(action.id)) return;
    setBusy(true);
    setError(null);
    try {
      await execute(action.id, query);
      onClose?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const focusAction = (next: number) => {
    const value = (next + visible.length) % Math.max(visible.length, 1);
    setSelected(value);
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      container.current
        ?.querySelector<HTMLButtonElement>(`[data-action-index="${value}"]`)
        ?.focus();
    });
  };
  const button = (action: QuickAction, i: number) => {
    const Icon = ICONS[action.icon];
    const reason = disabled(action.id);
    return (
      <button
        key={action.id}
        type="button"
        data-action-index={i}
        data-current={i === index}
        className="qa-action"
        disabled={busy || Boolean(reason)}
        title={reason ?? action.detail}
        aria-label={reason ? `${action.label}: ${reason}` : undefined}
        onFocus={() => setSelected(i)}
        onClick={() => void invoke(action)}
      >
        <Icon aria-hidden="true" size={18} />
        <span>
          <strong>{action.label}</strong>
          {(design === "list" || design === "stack") && <small>{reason ?? action.detail}</small>}
        </span>
        {design === "matrix" && <kbd>{i + 1}</kbd>}
      </button>
    );
  };
  return (
    <div
      ref={container}
      className={`qa-surface qa-${design}`}
      data-qa-preview={preview}
      aria-busy={busy}
      onKeyDown={(event) => {
        const input = event.target instanceof HTMLInputElement;
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose?.();
          return;
        }
        if (event.key === "Enter" && input && active) {
          event.preventDefault();
          void invoke(active);
        }
        if (design === "matrix" && /^[1-9]$/.test(event.key) && !input) {
          const action = visible[Number(event.key) - 1];
          if (action) {
            event.preventDefault();
            void invoke(action);
          }
        }
        if (
          ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key) &&
          (!input || event.key === "ArrowDown" || event.key === "ArrowUp")
        ) {
          event.preventDefault();
          if (design === "compass")
            focusAction(["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].indexOf(event.key));
          else
            focusAction(
              input
                ? event.key === "ArrowUp"
                  ? visible.length - 1
                  : 0
                : index +
                    (event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1) *
                      (design === "matrix" && (event.key === "ArrowUp" || event.key === "ArrowDown")
                        ? 3
                        : 1),
            );
        }
        if (event.key === "PageDown" || event.key === "PageUp") {
          event.preventDefault();
          setPage((p) => (p + (event.key === "PageDown" ? 1 : pageCount - 1)) % pageCount);
          setSelected(0);
        }
      }}
    >
      <header>
        <span>
          Tabs{" "}
          <span className="qa-muted">/ {LAUNCHER_DESIGNS.find((d) => d.id === design)?.name}</span>
        </span>
        {onClose && (
          <button type="button" aria-label="Close quick actions" onClick={onClose}>
            <X size={16} />
          </button>
        )}
      </header>
      <label className="qa-search">
        <Search size={16} aria-hidden="true" />
        <input
          autoFocus={!preview}
          aria-label="Find an action, search the web, or enter a URL"
          placeholder="Action, search, or URL…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
            setPage(0);
          }}
        />
      </label>
      <div className="qa-actions" role="group" aria-label="Quick actions">
        {design === "stack" ? (
          <>
            <div className="qa-stack-count">
              {index + 1} / {visible.length}
            </div>
            {active && button(active, index)}
            <div className="qa-stack-controls">
              <button
                type="button"
                onClick={() => setSelected((index + visible.length - 1) % visible.length)}
              >
                ← Previous
              </button>
              <button type="button" onClick={() => setSelected((index + 1) % visible.length)}>
                Next →
              </button>
            </div>
          </>
        ) : (
          visible.map(button)
        )}
        {design === "compass" && (
          <div className="qa-compass-center" aria-hidden="true">
            <Compass size={25} />
          </div>
        )}
      </div>
      {pageCount > 1 && (
        <div className="qa-pages">
          <button
            type="button"
            onClick={() => {
              setPage((page + pageCount - 1) % pageCount);
              setSelected(0);
            }}
          >
            ←
          </button>
          <span>
            {(page % pageCount) + 1} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => {
              setPage((page + 1) % pageCount);
              setSelected(0);
            }}
          >
            More →
          </button>
        </div>
      )}
      <footer>
        {busy
          ? "Working…"
          : design === "matrix"
            ? "Tab into the pad · 1–9 to run · PgUp / PgDn"
            : design === "compass"
              ? "Arrows choose a direction · Enter to run"
              : "Arrows to explore · Enter to run · Esc to return"}
      </footer>
      {error && (
        <p className="qa-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function QuickActionsHost({
  children,
  execute,
  disabled,
}: ActionContext & { children: ReactNode }) {
  const settings = useSettings((s) => s.quickActions);
  const keybindings = useKeybindings();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 8, y: 8 });
  const dismiss = useCallback(() => {
    setAnchor(null);
    previousFocus.current?.focus();
  }, []);
  const open = useCallback((point?: { x: number; y: number }) => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAnchor(point ?? pointer.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 3 });
  }, []);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    const key = (event: KeyboardEvent) => {
      if (
        !event.isComposing &&
        resolveShortcutCommand(event, keybindings, {
          context: { terminalFocus: false, terminalOpen: false },
        }) === "quickActions.toggle"
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (anchor) dismiss();
        else open();
      }
    };
    const gesture = (event: MouseEvent) => {
      if (
        !settings.pointerGesture ||
        !event.altKey ||
        event.button !== 2 ||
        (event.target as Element).closest("input,textarea,[contenteditable],.monaco-editor,.xterm")
      )
        return;
      event.preventDefault();
      open({ x: event.clientX, y: event.clientY });
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("keydown", key, true);
    window.addEventListener("contextmenu", gesture);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("contextmenu", gesture);
    };
  }, [anchor, keybindings, settings.pointerGesture, dismiss, open]);
  useEffect(
    () =>
      window.desktopBridge?.onMenuAction((action) => {
        if (action !== "quick-actions") return;
        if (anchor) {
          dismiss();
          return;
        }
        const getCursor = window.desktopBridge?.getCursorPosition;
        if (getCursor)
          void getCursor()
            .then((point) => open(point))
            .catch(() => open());
        else open();
      }),
    [anchor, dismiss, open],
  );
  useLayoutEffect(() => {
    if (!anchor || !popup.current) return;
    const place = () => {
      const rect = popup.current!.getBoundingClientRect();
      setPosition(
        clampLauncher(anchor, rect, { width: window.innerWidth, height: window.innerHeight }),
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(popup.current);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor, settings.design]);
  return (
    <Context.Provider value={{ execute, disabled }}>
      {children}
      <button
        className="qa-invoke"
        type="button"
        title={`Quick actions (${shortcutLabelForCommand(keybindings, "quickActions.toggle") ?? "unbound"})`}
        aria-label="Open quick actions"
        onClick={(event) => {
          const r = event.currentTarget.getBoundingClientRect();
          open({ x: r.x, y: r.y - 300 });
        }}
      >
        <Compass size={18} aria-hidden="true" />
      </button>
      {anchor &&
        createPortal(
          <div
            className="qa-overlay"
            data-slot="quick-actions-overlay"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) dismiss();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                dismiss();
              }
              if (e.key === "Tab" && popup.current) {
                const controls = [
                  ...popup.current.querySelectorAll<HTMLElement>("button:not(:disabled),input"),
                ];
                const first = controls[0],
                  last = controls[controls.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <div
              ref={popup}
              className="qa-popup"
              role="dialog"
              aria-modal="true"
              aria-label="Quick actions"
              style={{ left: position.x, top: position.y }}
            >
              <LauncherSurface
                design={settings.design}
                actions={orderedActions(settings.actionOrder, settings.hiddenActions)}
                execute={execute}
                disabled={disabled}
                onClose={dismiss}
              />
            </div>
          </div>,
          document.body,
        )}
    </Context.Provider>
  );
}
