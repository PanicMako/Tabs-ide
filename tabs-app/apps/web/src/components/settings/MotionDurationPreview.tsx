import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";
import { MOTION_TIME_SCALE } from "~/lib/motion";
import { MOTION_PROFILE } from "~/lib/motionProfiles";
import { useSurfaceMotionSettings } from "~/panelAnimations";

const TRACK_PX = 56;
const DOT_PX = 8;

/** How long the dot takes to cross: exactly the chosen panel duration, in seconds. */
export function previewTravelSeconds(durationMs: number): number {
  return Math.max(0, durationMs) / 1000;
}

/** The pause at each end, in real seconds. */
const HOLD_SECONDS = 0.6;

/**
 * A small track beside the row's title whose dot slides end to end at the chosen panel speed,
 * so the setting shows what it does instead of only naming a number. Off parks the dot at the
 * end; reduced motion leaves it still.
 */
export function MotionDurationPreview({ durationMs }: { durationMs: number }) {
  const dotRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const { reducedMotion } = useSurfaceMotionSettings();
  const travel = previewTravelSeconds(durationMs);

  useLayoutEffect(() => {
    const dot = dotRef.current;
    const fill = fillRef.current;
    if (!dot || !fill) return;
    const end = TRACK_PX - DOT_PX;
    if (reducedMotion || travel === 0) {
      gsap.set(dot, { x: travel === 0 ? end : 0 });
      gsap.set(fill, { scaleX: travel === 0 ? 1 : 0 });
      return;
    }
    // GSAP's global clock runs fast (see MOTION_TIME_SCALE); panels slide on CSS time, so the
    // preview scales back up to show their real speed.
    const real = (seconds: number) => seconds * MOTION_TIME_SCALE;
    const timeline = gsap.timeline({ repeat: -1, repeatDelay: real(HOLD_SECONDS), yoyo: true });
    const tween = { duration: real(travel), ease: MOTION_PROFILE.ease };
    timeline
      .fromTo(dot, { x: 0 }, { x: end, ...tween }, 0)
      .fromTo(fill, { scaleX: 0 }, { scaleX: 1, ...tween }, 0);
    return () => {
      timeline.kill();
    };
  }, [reducedMotion, travel]);

  return (
    <span
      className="relative inline-flex h-2 items-center"
      style={{ width: TRACK_PX }}
      data-slot="motion-duration-preview"
      aria-hidden="true"
      title={travel === 0 ? "Panels snap open" : "This is how panels move"}
    >
      <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-border" />
      <span
        ref={fillRef}
        className="absolute top-1/2 h-[2px] origin-left -translate-y-1/2 rounded-full bg-foreground/45"
        style={{ left: DOT_PX / 2, right: DOT_PX / 2 }}
      />
      <span
        ref={dotRef}
        className="absolute top-0 left-0 rounded-full border border-border bg-foreground"
        style={{ width: DOT_PX, height: DOT_PX }}
      />
    </span>
  );
}
