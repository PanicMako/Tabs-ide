// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { STARTUP_EXIT_GRACE_MS } from "./components/StartupCurtain";
import {
  SOLARI_EXIT_BEAT_MS,
  SOLARI_INTRO_FALLBACK_MS,
  SOLARI_RISE_EXIT_MS,
} from "./lib/startupAnimationTiming";

/** From the moment the board is done: a short beat, then the workspace rises. */
const EXIT_TOTAL_MS = SOLARI_EXIT_BEAT_MS + SOLARI_RISE_EXIT_MS;
import { StartupShell } from "./StartupShell";
import {
  activateStartupSplash,
  getStartupSplashState,
  updateStartupSplash,
} from "./lib/startupSplashLifecycle";

// The board reports its last tile landing; tests press it to play that moment.
vi.mock("./components/SplashScreen", () => ({
  SplashScreen: ({ onIntroComplete }: { onIntroComplete?: () => void }) => (
    <button type="button" data-testid="settle-board" onClick={() => onIntroComplete?.()}>
      Airport animation
    </button>
  ),
}));
function settleBoard() {
  (document.querySelector('[data-testid="settle-board"]') as HTMLButtonElement | null)?.click();
}
vi.mock("./startupSplashSettings", () => ({ readFirstPaintSplashSettings: () => ({}) }));
vi.mock("./lib/startupReadiness", () => ({ markStartupStage: vi.fn() }));
let container: HTMLDivElement;
let root: Root;
let deactivate: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => clearTimeout(handle));
  // happy-dom has no Web Animations; model one that finishes after its duration.
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: (_keyframes: unknown, options: { duration: number }) => ({
      finished: new Promise((resolve) => setTimeout(resolve, options.duration)),
      cancel: () => undefined,
    }),
  });
  deactivate = activateStartupSplash();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  deactivate();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("waits for the board's last tile, then the ready workspace rises over it", async () => {
  const load = vi.fn(async () => <div>Workspace</div>);
  await act(async () => root.render(<StartupShell loadApplication={load} />));
  expect(container.textContent).toContain("Airport animation");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  await act(async () => updateStartupSplash({ ready: true }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  // Ready, but the board is still flipping: no fixed timer reveals it early.
  expect(getStartupSplashState().dismissed).toBe(false);
  expect(
    container.querySelector('[aria-label="Starting Tabs"]')?.hasAttribute("data-leaving"),
  ).toBe(false);
  await act(async () => settleBoard());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SOLARI_EXIT_BEAT_MS - 20);
  });
  // The finished board holds for a beat: nothing has started rising yet.
  expect(document.querySelector("[data-rising]")).toBeNull();
  expect(
    container.querySelector('[aria-label="Starting Tabs"]')?.hasAttribute("data-leaving"),
  ).toBe(true);
  // The rise waits for the workspace's first paint, then runs its full length.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(EXIT_TOTAL_MS / 2);
  });
  expect(getStartupSplashState().dismissed).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(EXIT_TOTAL_MS / 2 + 50);
  });
  expect(getStartupSplashState().dismissed).toBe(true);
  expect(container.querySelector('[aria-label="Starting Tabs"]')).toBeNull();
  expect(container.textContent).toContain("Workspace");
});
it("cancels a pending exit notification when the shell unmounts", async () => {
  await act(async () => root.render(<StartupShell loadApplication={async () => null} />));
  await act(async () => updateStartupSplash({ ready: true }));
  await act(async () => settleBoard());
  await act(async () => root.render(null));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(getStartupSplashState().dismissed).toBe(false);
});

it("keeps the loader visible past the animation when the backend is still loading", async () => {
  await act(async () =>
    root.render(<StartupShell loadApplication={async () => <div>Workspace</div>} />),
  );
  await act(async () => settleBoard());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(getStartupSplashState().dismissed).toBe(false);
  expect(
    container.querySelector('[aria-label="Starting Tabs"]')?.hasAttribute("data-leaving"),
  ).toBe(false);
  await act(async () => updateStartupSplash({ ready: true }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(EXIT_TOTAL_MS + 50);
  });
  expect(getStartupSplashState().dismissed).toBe(true);
});

it("skips the decorative hold and upward motion for reduced motion", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  await act(async () =>
    root.render(<StartupShell loadApplication={async () => <div>Workspace</div>} />),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  await act(async () => updateStartupSplash({ ready: true }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(getStartupSplashState().dismissed).toBe(true);
});

it("keeps the loader visible when readiness arrives before the application module", async () => {
  let finish!: (node: ReactNode) => void;
  const pending = new Promise<ReactNode>((resolve) => {
    finish = resolve;
  });
  await act(async () => root.render(<StartupShell loadApplication={() => pending} />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
    updateStartupSplash({ ready: true });
  });
  await act(async () => settleBoard());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(container.querySelector('[aria-label="Starting Tabs"]')).not.toBeNull();
  expect(getStartupSplashState().dismissed).toBe(false);
  await act(async () => {
    finish(<div>Workspace</div>);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(EXIT_TOTAL_MS + 50);
  });
  expect(container.textContent).toContain("Workspace");
  expect(container.querySelector('[aria-label="Starting Tabs"]')).toBeNull();
});

it("never strands the user if the board fails to report that it settled", async () => {
  await act(async () =>
    root.render(<StartupShell loadApplication={async () => <div>Workspace</div>} />),
  );
  await act(async () => updateStartupSplash({ ready: true }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SOLARI_INTRO_FALLBACK_MS + 1);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(EXIT_TOTAL_MS + 50);
  });
  expect(getStartupSplashState().dismissed).toBe(true);
});

it("removes the splash even when the window stops producing animation frames", async () => {
  await act(async () =>
    root.render(<StartupShell loadApplication={async () => <div>Workspace</div>} />),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  await act(async () => settleBoard());
  // The window is then covered or minimized: frames and animation completion
  // stop arriving just as the workspace becomes ready.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: () => ({ finished: new Promise(() => undefined), cancel: () => undefined }),
  });
  await act(async () => updateStartupSplash({ ready: true }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(EXIT_TOTAL_MS + STARTUP_EXIT_GRACE_MS + 50);
  });
  expect(getStartupSplashState().dismissed).toBe(true);
  expect(container.textContent).toContain("Workspace");
});

it("skips the exit animation entirely while the window is hidden", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  try {
    await act(async () =>
      root.render(<StartupShell loadApplication={async () => <div>Workspace</div>} />),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => updateStartupSplash({ ready: true }));
    await act(async () => settleBoard());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getStartupSplashState().dismissed).toBe(true);
  } finally {
    visibility.mockRestore();
  }
});
