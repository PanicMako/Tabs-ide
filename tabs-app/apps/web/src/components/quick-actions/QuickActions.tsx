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
import { useSettings } from "~/hooks/useSettings";
import { useKeybindings } from "~/state/settings";
import { resolveShortcutCommand } from "~/keybindings";
import {
  normalizeLauncherDesign,
  clampLauncher,
  orderedActions,
  type QuickSubAction,
  type QuickAction,
  type QuickActionId,
  type LauncherDesign,
} from "./actions";
import { RadialLauncher } from "./RadialActions";
import "./quick-actions.css";

export interface ActionContext {
  execute: (id: QuickActionId, query: string) => Promise<void>;
  disabled: (id: QuickActionId) => string | undefined;
}
const Context = createContext<ActionContext | null>(null);
export const useQuickActions = () => useContext(Context);

export function LauncherSurface(props: {
  design: LauncherDesign;
  actions: readonly QuickAction[];
  execute: ActionContext["execute"];
  disabled: ActionContext["disabled"];
  onClose?: () => void;
  preview?: boolean;
  subActions?: readonly QuickSubAction[] | undefined;
}) {
  return <RadialLauncher {...props} />;
}

export function QuickActionsHost({
  children,
  execute,
  disabled,
}: ActionContext & { children: ReactNode }) {
  const settings = useSettings((s) => s.quickActions);
  const keybindings = useKeybindings();
  const enabled = useRef(settings.enabled);
  enabled.current = settings.enabled;
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 8, y: 8 });
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const dismiss = useCallback(() => {
    setClosing(true);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(
      () => {
        setAnchor(null);
        setClosing(false);
        previousFocus.current?.focus();
      },
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 140,
    );
  }, []);
  const open = useCallback((point?: { x: number; y: number }) => {
    if (!enabled.current) return;
    clearTimeout(closeTimer.current);
    setClosing(false);
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAnchor(point ?? pointer.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 3 });
  }, []);
  useEffect(() => {
    void window.desktopBridge?.setQuickActionsEnabled?.(settings.enabled).catch(() => undefined);
  }, [settings.enabled]);
  useEffect(() => {
    if (!settings.enabled && anchor) dismiss();
  }, [settings.enabled, anchor, dismiss]);
  useEffect(() => {
    if (!settings.enabled) return;
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
  }, [anchor, keybindings, settings.enabled, settings.pointerGesture, dismiss, open]);
  useEffect(
    () =>
      window.desktopBridge?.onMenuAction((action) => {
        if (action !== "quick-actions" || !enabled.current) return;
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
      {settings.enabled &&
        anchor &&
        createPortal(
          <div
            className="qa-overlay"
            data-closing={closing}
            data-slot="quick-actions-overlay"
            onPointerDown={(e) => {
              if (!(e.target as Element).closest("button,input")) dismiss();
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
                design={normalizeLauncherDesign(settings.design)}
                actions={orderedActions(settings.actionOrder, settings.hiddenActions)}
                subActions={settings.subActions}
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
