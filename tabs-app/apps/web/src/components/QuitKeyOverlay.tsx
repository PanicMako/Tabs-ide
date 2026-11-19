import gsap from "gsap";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCompanionMotion } from "./agents/companion/designs/motion";
import { quitKeyOverlayView, type QuitKeyProgress } from "./quitKeyOverlay.logic";

const IDLE: QuitKeyProgress = { progress: null, armed: false };

/** Feedback for hold-to-quit and press-twice-to-quit, shown over the app while the key is down. */
export function QuitKeyOverlay() {
  const [state, setState] = useState<QuitKeyProgress>(IDLE);
  const rootRef = useRef<HTMLDivElement>(null);
  const { active, seconds, profile } = useCompanionMotion();

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.onQuitKeyProgress) return;
    return bridge.onQuitKeyProgress(setState);
  }, []);

  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
  const view = quitKeyOverlayView(state, isMac);

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    if (!active) {
      node.style.opacity = view.visible ? "1" : "0";
      return;
    }
    const tween = gsap.to(node, {
      opacity: view.visible ? 1 : 0,
      y: view.visible ? 0 : 6,
      duration: seconds(view.visible ? 0.14 : 0.1),
      ease: profile.ease,
      overwrite: true,
    });
    return () => {
      tween.kill();
    };
  }, [active, profile, seconds, view.visible]);

  return (
    <div
      ref={rootRef}
      role="status"
      aria-live="polite"
      aria-hidden={!view.visible}
      data-testid="quit-key-overlay"
      style={{ opacity: 0 }}
      className="pointer-events-none fixed inset-x-0 bottom-8 z-[60] flex justify-center"
    >
      <div className="w-72 border border-border bg-popover/80 px-4 py-3 text-sm text-popover-foreground backdrop-blur-md [border-radius:var(--radius-surface)]">
        <div>{view.visible ? view.label : ""}</div>
        {view.visible && view.fill !== null && (
          <div className="mt-2 h-1 w-full overflow-hidden bg-foreground/10 [border-radius:var(--radius-control)]">
            <div className="h-full bg-foreground/70" style={{ width: `${view.fill * 100}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
