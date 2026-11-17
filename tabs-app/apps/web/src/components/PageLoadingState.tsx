import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";
import { MercuryChromeLoader } from "./MercuryChromeLoader";
import { cn } from "~/lib/utils";
import { MOTION_EASE } from "~/lib/motion";
import { useSurfaceMotionSettings } from "~/panelAnimations";

interface PageLoadingStateProps {
  label: string;
  detail?: string;
  className?: string;
  compact?: boolean;
  /**
   * Stay invisible this long before fading in. Fast loads then never flash a loader between
   * two screens; slow ones still get one.
   */
  revealDelayMs?: number;
}

export function PageLoadingState({
  label,
  detail,
  className,
  compact = false,
  revealDelayMs = 0,
}: PageLoadingStateProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { active, seconds } = useSurfaceMotionSettings();
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const delay = revealDelayMs / 1000;
    if (!active && delay === 0) return;
    const tween = gsap.fromTo(
      node.firstElementChild,
      { opacity: 0, y: active ? 6 : 0 },
      {
        opacity: 1,
        y: 0,
        delay,
        duration: active ? seconds(0.32) : 0,
        ease: MOTION_EASE.settle,
        clearProps: "opacity,transform",
      },
    );
    return () => {
      tween.kill();
    };
  }, [active, revealDelayMs, seconds]);
  return (
    <div
      ref={ref}
      className={cn(
        "flex min-h-0 w-full flex-1 items-center justify-center bg-background px-6 text-center",
        compact ? "py-10" : "h-full py-16",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="flex max-w-sm flex-col items-center">
        <div className="relative grid size-24 place-items-center">
          <div className="absolute inset-3 rounded-full bg-primary/8 blur-2xl" aria-hidden="true" />
          <MercuryChromeLoader
            size={compact ? 52 : 68}
            color="var(--primary)"
            className="relative"
          />
        </div>
        <div className="mt-4 text-sm font-medium text-foreground/85">{label}</div>
        {detail ? (
          <div className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}
