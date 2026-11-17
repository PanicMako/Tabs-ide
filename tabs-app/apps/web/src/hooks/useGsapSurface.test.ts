import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGsapSurface } from "./useGsapSurface";

const motion = vi.hoisted(() => ({
  active: true,
  seconds: (value: number) => value,
  enter: vi.fn(),
  exit: vi.fn(),
  clear: vi.fn(),
  holdCancel: vi.fn(),
}));
vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));
vi.mock("../panelAnimations", () => ({
  useSurfaceMotionSettings: () => motion,
}));
vi.mock("../lib/motion", () => ({
  getSurfacePreset: (preset: string) => ({ preset }),
  playSurfaceEnter: motion.enter,
  playSurfaceExit: (...args: unknown[]) => {
    motion.exit(...args);
    return { tween: {}, hold: { cancel: motion.holdCancel } };
  },
  clearSurfaceMotion: motion.clear,
}));

describe("surface motion lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());
  let notify: () => void;
  const disconnect = vi.fn();
  const attributes = new Set<string>();
  const parent = { id: "frame" } as unknown as HTMLElement;
  const node = {
    hasAttribute: (name: string) => attributes.has(name),
    parentElement: parent,
  } as unknown as HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    attributes.clear();
    motion.active = true;
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
  });

  it("enters on open, exits while ending, and re-enters from the interrupted exit", () => {
    const cleanup = useGsapSurface(undefined, "dialog")(node);
    expect(motion.enter).toHaveBeenCalledTimes(1);
    expect(motion.enter.mock.calls[0]?.[3]).toBe(false);
    notify();
    expect(motion.enter).toHaveBeenCalledTimes(1);

    attributes.add("data-ending-style");
    notify();
    expect(motion.exit).toHaveBeenCalledTimes(1);
    notify();
    expect(motion.exit).toHaveBeenCalledTimes(1);

    attributes.delete("data-ending-style");
    notify();
    expect(motion.holdCancel).toHaveBeenCalledOnce();
    expect(motion.enter).toHaveBeenCalledTimes(2);
    expect(motion.enter.mock.calls[1]?.[3]).toBe(true);

    cleanup?.();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(motion.clear).toHaveBeenCalled();
  });

  it("does not animate closed retained popups, instant popups or reduced-motion surfaces", () => {
    attributes.add("data-closed");
    useGsapSurface()(node)?.();
    expect(motion.enter).not.toHaveBeenCalled();

    attributes.clear();
    attributes.add("data-instant");
    useGsapSurface()(node)?.();
    expect(motion.enter).not.toHaveBeenCalled();

    attributes.clear();
    motion.active = false;
    useGsapSurface()(node)?.();
    attributes.add("data-ending-style");
    notify();
    expect(motion.enter).not.toHaveBeenCalled();
    expect(motion.exit).not.toHaveBeenCalled();
  });

  it("animates the painted frame when asked while watching the Base UI element", () => {
    useGsapSurface(undefined, "popover", { animateParent: true })(node)?.();
    expect(motion.enter.mock.calls[0]?.[0]).toBe(parent);
    expect(motion.enter.mock.calls[0]?.[4]).toBe(node);
  });

  it("preserves a caller ref and invokes its cleanup once", () => {
    const callerCleanup = vi.fn();
    const callerRef = vi.fn(() => callerCleanup);
    useGsapSurface(callerRef)(node)?.();
    expect(callerRef).toHaveBeenCalledExactlyOnceWith(node);
    expect(callerCleanup).toHaveBeenCalledOnce();
  });
});
