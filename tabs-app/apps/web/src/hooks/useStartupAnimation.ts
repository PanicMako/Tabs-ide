import { useSyncExternalStore } from "react";
import { STARTUP_ANIMATION_EXIT_MS, startupAnimationHoldMs } from "../lib/startupAnimationTiming";
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

/** Load the app concurrently, but finish the selected animation before revealing it. */
export function useStartupAnimation(ready: boolean, loader: string) {
  const reduced = useReducedStartupMotion();
  const animationReady = useMinimumDuration(ready, startupAnimationHoldMs(loader));
  return {
    ready: reduced ? ready : animationReady,
    exitMs: reduced ? 0 : STARTUP_ANIMATION_EXIT_MS,
  };
}
