import { memo, useCallback, useEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";

/**
 * AssistantMessageBorder
 * Left-border accent with single-pass hover sweep beam + scroll-driven light bar
 * that grows as the user scrolls through the response.
 */
export const AssistantMessageBorder = memo(function AssistantMessageBorder({
  scrollContainer,
  children,
}: {
  scrollContainer: HTMLDivElement | null;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sweepRef = useRef<HTMLDivElement>(null);
  const lightBarRef = useRef<HTMLDivElement>(null);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const isScrolledActiveRef = useRef(false);

  // Single-pass hover sweep using GSAP — suppressed if scroll light bar is active
  const handleMouseEnter = useCallback(() => {
    if (isScrolledActiveRef.current) return;
    if (!sweepRef.current) return;
    if (tweenRef.current) tweenRef.current.kill();

    // GSAP silky-smooth sweep from top to bottom
    tweenRef.current = gsap.fromTo(
      sweepRef.current,
      { y: "-100%", opacity: 0 },
      {
        y: "280%",
        opacity: 1,
        duration: 1.5,
        ease: "power2.inOut",
        onComplete: () => {
          if (sweepRef.current) {
            gsap.to(sweepRef.current, { opacity: 0, duration: 0.35 });
          }
        },
      },
    );
  }, []);

  // GSAP scroll progress listener — silky smooth tweening with light-to-dark gradient
  useEffect(() => {
    const el = containerRef.current;
    const bar = lightBarRef.current;
    if (!el || !bar) return;
    const target = scrollContainer ?? (typeof window !== "undefined" ? window : null);
    if (!target) return;

    const updateProgress = () => {
      if (!containerRef.current || !lightBarRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const viewportHeight = scrollContainer ? scrollContainer.clientHeight : window.innerHeight;
      const containerTop = scrollContainer ? scrollContainer.getBoundingClientRect().top : 0;
      const elementTop = rect.top - containerTop;
      const elementHeight = rect.height;

      if (elementHeight <= 0) return;

      const scrolled = viewportHeight * 0.45 - elementTop;
      const rawProgress = scrolled / elementHeight;
      const isActivelyScrolled = rawProgress > 0.05 && rawProgress < 0.95;
      isScrolledActiveRef.current = isActivelyScrolled;
      if (containerRef.current) {
        containerRef.current.dataset.railActive = String(isActivelyScrolled);
      }

      // Kill any running hover sweep if active scroll takes over
      if (isActivelyScrolled && tweenRef.current) {
        tweenRef.current.kill();
        if (sweepRef.current) {
          gsap.set(sweepRef.current, { opacity: 0 });
        }
      }

      const progress = Math.max(0, Math.min(1, rawProgress));

      // GSAP smooth tween to target height & opacity with zero jitter
      gsap.to(lightBarRef.current, {
        height: `${Math.max(6, Math.min(100, progress * 100))}%`,
        opacity: isActivelyScrolled ? 1 : 0,
        duration: 0.3,
        ease: "power1.out",
        overwrite: "auto",
      });
    };

    updateProgress();
    target.addEventListener("scroll", updateProgress, { passive: true });
    const resizeObserver = new ResizeObserver(updateProgress);
    resizeObserver.observe(el);
    if (scrollContainer) resizeObserver.observe(scrollContainer);

    return () => {
      target.removeEventListener("scroll", updateProgress);
      resizeObserver.disconnect();
      if (tweenRef.current) tweenRef.current.kill();
      if (lightBarRef.current) gsap.killTweensOf(lightBarRef.current);
    };
  }, [scrollContainer]);

  return (
    <div
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      className="group relative min-w-0 pl-4"
      data-assistant-rail
      data-testid="assistant-rail"
    >
      {/* Static base line — single 1px left track */}
      <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-px bg-border/40 transition-colors duration-200 group-hover:bg-border/60" />

      {/* 1. GSAP Single-pass hover sweep beam — perfectly aligned at left-0 */}
      <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-px overflow-hidden">
        <div
          ref={sweepRef}
          data-assistant-rail-sweep
          className="h-44 w-full opacity-0 bg-gradient-to-b from-foreground/10 via-foreground/90 to-foreground/30 shadow-[0_0_8px_rgba(255,255,255,0.3)]"
        />
      </div>

      {/* 2. GSAP Scroll Light Bar — perfectly aligned at left-0 */}
      <div
        ref={lightBarRef}
        data-assistant-rail-beam
        className="pointer-events-none absolute left-0 top-0 w-px opacity-0 bg-gradient-to-b from-foreground/95 via-foreground/60 to-foreground/20"
      />

      {children}
    </div>
  );
});
