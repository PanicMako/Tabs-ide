// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { afterStartupPaint } from "./afterStartupPaint";
import { activateStartupSplash, updateStartupSplash } from "./startupSplashLifecycle";

let deactivate: () => void;
let frame: FrameRequestCallback;
let idle: IdleRequestCallback;
let cancel: () => void;
beforeEach(() => {
  deactivate = activateStartupSplash();
  cancel = () => {};
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "requestIdleCallback",
    vi.fn((callback: IdleRequestCallback) => {
      idle = callback;
      return 2;
    }),
  );
  vi.stubGlobal("cancelIdleCallback", vi.fn());
});
afterEach(() => {
  cancel();
  deactivate();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("does not start optional work while hydration is pending or failed", () => {
  const work = vi.fn();
  cancel = afterStartupPaint(work);
  updateStartupSplash({ error: "Backend unavailable", delayed: true });
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  updateStartupSplash({ ready: true, error: null });
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  updateStartupSplash({ dismissed: true });
  expect(work).not.toHaveBeenCalled();
  frame(0);
  expect(work).not.toHaveBeenCalled();
  idle({ didTimeout: false, timeRemaining: () => 10 });
  expect(work).toHaveBeenCalledOnce();
  updateStartupSplash({ delayed: false });
  expect(requestAnimationFrame).toHaveBeenCalledOnce();
});
it("cancels a pending readiness subscription", () => {
  cancel = afterStartupPaint(vi.fn());
  cancel();
  updateStartupSplash({ ready: true });
  expect(requestAnimationFrame).not.toHaveBeenCalled();
});
it("cancels queued work when its owner unmounts", () => {
  const work = vi.fn();
  updateStartupSplash({ ready: true, dismissed: true });
  cancel = afterStartupPaint(work);
  frame(0);
  cancel();
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  expect(cancelIdleCallback).toHaveBeenCalledWith(2);
  idle({ didTimeout: true, timeRemaining: () => 0 });
  expect(work).not.toHaveBeenCalled();
});
it("runs without an early splash and falls back when idle callbacks are unavailable", () => {
  deactivate();
  vi.stubGlobal("requestIdleCallback", undefined);
  vi.useFakeTimers();
  const work = vi.fn();
  cancel = afterStartupPaint(work);
  frame(0);
  expect(work).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(work).toHaveBeenCalledOnce();
});
