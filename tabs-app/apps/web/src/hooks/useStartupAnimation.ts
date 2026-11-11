import { useEffect, useState, useSyncExternalStore } from "react";
import {
  SOLARI_INTRO_FALLBACK_MS,
  startupAnimationHoldMs,
  startupExitMs,
  startupIntroIsSignalled,
} from "../lib/startupAnimationTiming";
import { useMinimumDuration } from "./useMinimumDuration";

const motionQuery = "(prefers-reduced-motion: reduce)";
function reducedMotion(): boolean {
  return window.matchMedia?.(motionQuery).matches ?? false;
}
function subscribeMotion(listener: () => void): () => void {
  const query = window.matchMedia?.(motionQuery);
  query?.addEventListener("change", listener);
  return () => query?.removeEventListener("change", listener);
}

export function useReducedStartupMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, reducedMotion, () => false);
}

/**
 * Whether the loader's intro has finished: the moment it reports so for
 * signalled loaders (the board's last tile), or its fixed hold for the mascot.
 */
export function useStartupIntroDone(loader: string, introSignalled: boolean): boolean {
  const signalled = startupIntroIsSignalled(loader);
  const held = useMinimumDuration(true, startupAnimationHoldMs(loader));
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    if (!signalled || introSignalled) return;
    const timer = setTimeout(() => setFallback(true), SOLARI_INTRO_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [signalled, introSignalled]);
  return signalled ? introSignalled || fallback : held;
}

/** Load the app concurrently, but let the loader finish its intro before revealing it. */
export function useStartupAnimation(ready: boolean, loader: string, introSignalled = false) {
  const reduced = useReducedStartupMotion();
  const introDone = useStartupIntroDone(loader, introSignalled);
  return {
    ready: reduced ? ready : ready && introDone,
    exitMs: reduced ? 0 : startupExitMs(loader),
  };
}
