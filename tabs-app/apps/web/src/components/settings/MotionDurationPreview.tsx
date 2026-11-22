import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";
import { MOTION_TIME_SCALE } from "~/lib/motion";
import { MOTION_PROFILE } from "~/lib/motionProfiles";
import { useSurfaceMotionSettings } from "~/panelAnimations";

const PREVIEW_W = 64;
const PREVIEW_H = 22;

/** How long the dot takes to cross: exactly the chosen panel duration, in seconds. */
export function previewTravelSeconds(durationMs: number): number {
  return Math.max(0, durationMs) / 1000;
}

/** The pause at each end, in real seconds. */
const HOLD_SECONDS = 0.6;

/**
 * A tiny window beside the row's title whose panel slides open at the chosen panel speed, so the
 * setting shows what it does instead of only naming a number. Off parks the panel open; reduced
 * motion leaves it closed.
 */
export function MotionDurationPreview({ durationMs }: { durationMs: number }) {
  const panelRef = useRef<HTMLSpanElement>(null);
  const { reducedMotion } = useSurfaceMotionSettings();
  const travel = previewTravelSeconds(durationMs);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (reducedMotion || travel === 0) {
      // Off parks the panel open; reduced motion leaves it closed.
      gsap.set(panel, { xPercent: travel === 0 ? 0 : -100 });
      return;
    }
    // GSAP's global clock runs fast (see MOTION_TIME_SCALE); panels slide on CSS time, so the
    // preview scales back up to show their real speed.
    const real = (seconds: number) => seconds * MOTION_TIME_SCALE;
    const timeline = gsap.timeline({ repeat: -1, repeatDelay: real(HOLD_SECONDS), yoyo: true });
    timeline.fromTo(
      panel,
      { xPercent: -100 },
      { xPercent: 0, duration: real(travel), ease: MOTION_PROFILE.ease },
    );
    return () => {
      timeline.kill();
    };
  }, [reducedMotion, travel]);

  return (
    <span
      className="relative inline-block overflow-hidden rounded-[var(--radius-control)] border border-border bg-muted/50"
      style={{ width: PREVIEW_W, height: PREVIEW_H }}
      data-slot="motion-duration-preview"
      aria-hidden="true"
      title={travel === 0 ? "Panels snap open" : "This is how panels move"}
    >
      <span
        ref={panelRef}
        className="absolute inset-y-0 left-0 w-1/2 border-r border-border bg-foreground/15"
      />
    </span>
  );
}
