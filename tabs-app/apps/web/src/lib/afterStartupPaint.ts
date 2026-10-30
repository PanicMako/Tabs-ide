import {
  getStartupSplashState,
  hasEarlyStartupSplash,
  subscribeStartupSplash,
} from "./startupSplashLifecycle";

/** Schedule optional work after the startup overlay exits and a paint, with cleanup. */
export function afterStartupPaint(task: () => void): () => void {
  let cancelled = false;
  let queued = false;
  let frame: number | undefined;
  let idle: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe = () => {};
  const run = () => {
    if (!cancelled) task();
  };
  const schedule = () => {
    if (queued || (hasEarlyStartupSplash() && !getStartupSplashState().dismissed)) return;
    queued = true;
    unsubscribe();
    frame = requestAnimationFrame(() => {
      if (cancelled) return;
      if (typeof window.requestIdleCallback === "function") {
        idle = window.requestIdleCallback(run, { timeout: 1_000 });
      } else {
        timer = setTimeout(run, 0);
      }
    });
  };
  unsubscribe = subscribeStartupSplash(schedule);
  schedule();
  return () => {
    cancelled = true;
    unsubscribe();
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (idle !== undefined) window.cancelIdleCallback(idle);
    clearTimeout(timer);
  };
}
