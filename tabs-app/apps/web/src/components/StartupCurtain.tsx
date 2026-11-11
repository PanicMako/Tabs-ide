import { useEffect, useRef, type ReactNode, type RefObject } from "react";

/** A long, soft lift: quick to start moving, gentle as it clears the top edge. */
const LIFT_EASING = "cubic-bezier(0.65, 0, 0.35, 1)";
/** The workspace arrives fast and settles gently against the top edge. */
const RISE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Extra time past the planned exit before the splash is removed regardless. */
export const STARTUP_EXIT_GRACE_MS = 1_500;

/** The layer `riseRef` points at: layout-neutral until it carries content up. */
export const STARTUP_RISE_LAYER_CLASS =
  "contents data-[rising]:fixed data-[rising]:inset-0 data-[rising]:z-[10000] data-[rising]:block data-[rising]:bg-background data-[rising]:shadow-[0_-24px_48px_-12px_rgb(0_0_0/0.35)] data-[rising]:will-change-transform";

/**
 * Full-screen startup splash. It either lifts straight up off the workspace,
 * or stays put while the workspace rises over it from the bottom.
 *
 * The lift waits two frames after `leaving` turns true so the workspace's first
 * (heavy) render has painted before motion starts — otherwise that render eats
 * the opening frames and the lift stutters or appears to jump. It runs as a Web
 * Animation on `transform`, which the compositor drives, and reports back only
 * when it has actually finished.
 */
export function StartupCurtain({
  leaving,
  durationMs,
  beatMs = 0,
  exit = "lift",
  riseRef,
  onLeft,
  children,
  ariaHidden,
}: {
  leaving: boolean;
  durationMs: number;
  /**
   * Pause between marking the splash `data-leaving` and lifting it, so a
   * loader can play its own exit first (the mascot's launch).
   */
  beatMs?: number;
  exit?: "lift" | "rise";
  /** The workspace layer that slides up when `exit` is "rise". */
  riseRef?: RefObject<HTMLElement | null>;
  onLeft: () => void;
  children: ReactNode;
  ariaHidden?: boolean | undefined;
}) {
  const curtainRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const onLeftRef = useRef(onLeft);
  onLeftRef.current = onLeft;

  useEffect(() => {
    if (!leaving) return;
    const curtain = curtainRef.current;
    const content = contentRef.current;
    if (
      !curtain ||
      durationMs <= 0 ||
      typeof curtain.animate !== "function" ||
      // A hidden or fully covered window produces no animation frames, so an
      // exit animation would never start or finish. Nobody can see it anyway.
      document.visibilityState === "hidden"
    ) {
      onLeftRef.current();
      return;
    }
    let cancelled = false;
    let left = false;
    const leave = () => {
      if (cancelled || left) return;
      left = true;
      onLeftRef.current();
    };
    // Frames can also stop mid-exit (the window is covered or minimized). The
    // splash must never hold a ready workspace hostage, so this deadline does
    // not depend on animation frames at all.
    const deadline = setTimeout(leave, beatMs + durationMs + STARTUP_EXIT_GRACE_MS);
    let motion: Animation | undefined;
    let drift: Animation | undefined;
    let riser: HTMLElement | null = null;
    let second = 0;
    let beat: ReturnType<typeof setTimeout> | undefined;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        beat = setTimeout(startExit, beatMs);
      });
    });
    const target = curtain;
    function startExit() {
      if (cancelled) return;
      riser = exit === "rise" ? (riseRef?.current ?? null) : null;
      if (riser) {
        // Lifted above the curtain only for the move; restored on cleanup,
        // after the curtain has gone, so the splash never flashes back.
        riser.dataset.rising = "true";
        const options = { duration: durationMs, easing: RISE_EASING, fill: "forwards" } as const;
        motion = riser.animate(
          [{ transform: "translate3d(0, 100%, 0)" }, { transform: "translate3d(0, 0, 0)" }],
          options,
        );
        drift = content?.animate(
          [
            { transform: "translate3d(0, 0, 0) scale(1)" },
            { transform: "translate3d(0, -10vh, 0) scale(0.96)" },
          ],
          options,
        );
      } else {
        const options = { duration: durationMs, easing: LIFT_EASING, fill: "forwards" } as const;
        motion = target.animate(
          [{ transform: "translate3d(0, 0, 0)" }, { transform: "translate3d(0, -100%, 0)" }],
          options,
        );
        // The splash content trails the curtain slightly (parallax), so the
        // whole sheet reads as one smooth lift straight up.
        drift = content?.animate(
          [{ transform: "translate3d(0, 0, 0)" }, { transform: "translate3d(0, 14vh, 0)" }],
          options,
        );
      }
      motion.finished.then(leave, () => undefined);
    }
    return () => {
      cancelled = true;
      clearTimeout(deadline);
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      clearTimeout(beat);
      motion?.cancel();
      drift?.cancel();
      if (riser) delete riser.dataset.rising;
    };
  }, [leaving, durationMs, beatMs, exit, riseRef]);

  return (
    <div
      ref={curtainRef}
      role="status"
      aria-label="Starting Tabs"
      aria-hidden={ariaHidden || undefined}
      data-leaving={leaving || undefined}
      className="startup-curtain fixed inset-0 z-[9999] overflow-hidden bg-background"
      style={{
        willChange: "transform",
        pointerEvents: leaving ? "none" : "auto",
        // A soft edge where the curtain meets the workspace as it lifts.
        boxShadow: "0 24px 48px -12px rgb(0 0 0 / 0.35)",
      }}
    >
      <div ref={contentRef} className="h-full w-full" style={{ willChange: "transform, opacity" }}>
        {children}
      </div>
    </div>
  );
}
