import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGsapSurface } from "./useGsapSurface";

const motion = vi.hoisted(() => ({
  active: true,
  durationMs: 200,
  fromTo: vi.fn(),
  revert: vi.fn(),
}));
vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));
vi.mock("../panelAnimations", () => ({
  usePanelAnimationSettings: () => motion,
}));
vi.mock("gsap", () => ({
  default: {
    fromTo: motion.fromTo,
    context: (callback: () => void) => {
      callback();
      return { revert: motion.revert };
    },
  },
}));

describe("surface motion lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());
  let notify: () => void;
  const disconnect = vi.fn();
  const attributes = new Set<string>();
  const node = { hasAttribute: (name: string) => attributes.has(name) } as HTMLElement;

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

  it("restarts a retained popup only when it opens, and disposes its observer", () => {
    const cleanup = useGsapSurface()(node);
    expect(motion.fromTo).toHaveBeenCalledTimes(1);
    notify();
    expect(motion.fromTo).toHaveBeenCalledTimes(1);
    attributes.add("data-ending-style");
    notify();
    expect(motion.revert).toHaveBeenCalledTimes(1);
    attributes.delete("data-ending-style");
    notify();
    expect(motion.fromTo).toHaveBeenCalledTimes(2);
    cleanup?.();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(motion.revert).toHaveBeenCalledTimes(2);
  });

  it("does not animate closed retained popups or reduced-motion surfaces", () => {
    attributes.add("data-closed");
    const cleanup = useGsapSurface()(node);
    expect(motion.fromTo).not.toHaveBeenCalled();
    cleanup?.();
    attributes.clear();
    motion.active = false;
    useGsapSurface()(node)?.();
    expect(motion.fromTo).not.toHaveBeenCalled();
  });

  it("preserves a caller ref and invokes its cleanup once", () => {
    const callerCleanup = vi.fn();
    const callerRef = vi.fn(() => callerCleanup);
    useGsapSurface(callerRef)(node)?.();
    expect(callerRef).toHaveBeenCalledExactlyOnceWith(node);
    expect(callerCleanup).toHaveBeenCalledOnce();
  });
});
