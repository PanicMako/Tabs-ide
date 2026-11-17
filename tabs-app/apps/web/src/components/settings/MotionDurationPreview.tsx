import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";
import { MOTION_PROFILE } from "~/lib/motionProfiles";
import { useSurfaceMotionSettings } from "~/panelAnimations";

const TRACK_PX = 96;
const DOT_PX = 6;

/** How long the dot takes to cross: exactly the chosen panel duration, in seconds. */
export function previewTravelSeconds(durationMs: number): number {
  return Math.max(0, durationMs) / 1000;
}

/**
 * A thin track with a dot that glides end to end at the chosen panel speed, so the setting
 * shows what it does instead of only naming a number. Off parks the dot; reduced motion
 * leaves it still.
 */
export function MotionDurationPreview({ durationMs }: { durationMs: number }) {
  const dotRef = useRef<HTMLSpanElement>(null);
  const { reducedMotion } = useSurfaceMotionSettings();
  const travel = previewTravelSeconds(durationMs);

  useLayoutEffect(() => {
    const dot = dotRef.current;
    if (!dot) return;
    const end = TRACK_PX - DOT_PX;
    if (reducedMotion || travel === 0) {
      gsap.set(dot, { x: travel === 0 ? end : 0 });
      return;
    }
    const timeline = gsap.timeline({ repeat: -1, repeatDelay: 0.5, yoyo: true });
    timeline.fromTo(dot, { x: 0 }, { x: end, duration: travel, ease: MOTION_PROFILE.ease });
    return () => {
      timeline.kill();
    };
  }, [reducedMotion, travel]);

  return (
    <span className="inline-flex items-center gap-2.5" aria-hidden="true">
      <span
        className="relative inline-flex h-1.5 items-center"
        style={{ width: TRACK_PX }}
        data-slot="motion-duration-preview"
      >
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
        <span
          ref={dotRef}
          className="absolute top-0 left-0 rounded-full bg-foreground/80"
          style={{ width: DOT_PX, height: DOT_PX }}
        />
      </span>
      <span>{travel === 0 ? "Panels snap open" : "This is how panels move"}</span>
    </span>
  );
}
