import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { PanelAnimationDurationMs, ReducedMotionMode } from "@tabs/contracts/settings";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useClientSettings } from "./state/settings";

const PanelAnimationSuppressionContext = createContext(false);

export const PanelAnimationSuppressionProvider = PanelAnimationSuppressionContext.Provider;

/**
 * Suppresses panel motion for the first painted frame of an initial route or navigation.
 * State restored by a route must be visible immediately; later user actions can animate.
 */
export function usePanelNavigationSuppression(navigationKey: string): boolean {
  const [paintedNavigationKey, setPaintedNavigationKey] = useState<string | null>(null);
  const suppressed = paintedNavigationKey !== navigationKey;

  useEffect(() => {
    if (!suppressed) return;
    let releaseFrame = 0;
    const paintFrame = window.requestAnimationFrame(() => {
      releaseFrame = window.requestAnimationFrame(() => setPaintedNavigationKey(navigationKey));
    });
    return () => {
      window.cancelAnimationFrame(paintFrame);
      window.cancelAnimationFrame(releaseFrame);
    };
  }, [navigationKey, suppressed]);

  return suppressed;
}

export function observeResponsiveBreakpointFade(options: {
  target: HTMLElement;
  container: HTMLElement;
  active: boolean;
  durationMs: PanelAnimationDurationMs;
  breakpoint: { value: number; unit: "px" | "rem" };
}): () => void {
  const { target, container, active, durationMs, breakpoint } = options;
  if (!active || typeof ResizeObserver === "undefined") return () => {};

  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  const breakpointPx =
    breakpoint.unit === "px"
      ? breakpoint.value
      : breakpoint.value * (Number.isFinite(rootFontSize) ? rootFontSize : 16);
  let expanded = container.getBoundingClientRect().width >= breakpointPx;
  let animation: Animation | null = null;

  const observer = new ResizeObserver(([entry]) => {
    if (!entry) return;
    const nextExpanded = entry.contentRect.width >= breakpointPx;
    if (nextExpanded === expanded) return;
    expanded = nextExpanded;
    animation?.cancel();
    animation = target.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: Math.min(100, durationMs),
      easing: "ease-out",
    });
  });

  observer.observe(container);
  return () => {
    observer.disconnect();
    animation?.cancel();
  };
}

export function resolveEffectiveReducedMotion(
  preference: ReducedMotionMode | undefined,
  systemPrefersReducedMotion: boolean,
): boolean {
  if (preference === "always") return true;
  if (preference === "never") return false;
  return systemPrefersReducedMotion;
}

export function usePanelAnimationSettings(): {
  active: boolean;
  durationMs: PanelAnimationDurationMs;
  reducedMotion: boolean;
} {
  const clientSettings = useClientSettings();
  const durationMs = clientSettings.panelAnimationDurationMs ?? 150;
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const isReduced = resolveEffectiveReducedMotion(
    clientSettings.reducedMotion,
    prefersReducedMotion,
  );
  const suppressed = useContext(PanelAnimationSuppressionContext);

  useEffect(() => {
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.style.setProperty(
        "--panel-animation-duration",
        `${!isReduced && !suppressed ? durationMs : 0}ms`,
      );
      document.documentElement.dataset.reducedMotion = isReduced ? "reduce" : "no-preference";
    }
  }, [durationMs, isReduced, suppressed]);

  return {
    active: durationMs > 0 && !isReduced && !suppressed,
    durationMs,
    reducedMotion: isReduced,
  };
}

/** Keeps closing panel content mounted until its opt-in transition ends. */
export function usePanelPresence<T>(
  open: boolean,
  value: T | null,
  animated: boolean,
  scopeKey: string | null,
  durationMs: PanelAnimationDurationMs,
): { present: boolean; value: T | null } {
  const [present, setPresent] = useState(open);
  const retainedRef = useRef<{ scopeKey: string | null; value: T | null } | null>(
    open ? { scopeKey, value } : null,
  );

  useEffect(() => {
    if (open) retainedRef.current = { scopeKey, value };
  }, [open, scopeKey, value]);

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    if (!animated) {
      setPresent(false);
      return;
    }

    const timeout = window.setTimeout(() => setPresent(false), durationMs);
    return () => window.clearTimeout(timeout);
  }, [animated, durationMs, open]);

  const retainedValue =
    retainedRef.current?.scopeKey === scopeKey ? retainedRef.current.value : null;
  const visible = open || (animated && present && retainedRef.current?.scopeKey === scopeKey);
  return { present: visible, value: open ? value : visible ? retainedValue : null };
}
