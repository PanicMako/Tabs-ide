// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StartupShell } from "./StartupShell";
import {
  activateStartupSplash,
  getStartupSplashState,
  updateStartupSplash,
} from "./lib/startupSplashLifecycle";

vi.mock("./components/SplashScreen", () => ({
  SplashScreen: () => <span>Airport animation</span>,
  STARTUP_ANIMATION_EXIT_MS: 200,
}));
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
it("announces dismissal only when the existing airport exit completes", async () => {
  const load = vi.fn(async () => <div>Workspace</div>);
  await act(async () => root.render(<StartupShell loadApplication={load} />));
  expect(container.textContent).toContain("Airport animation");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  await act(async () => updateStartupSplash({ ready: true }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(199);
  });
  expect(getStartupSplashState().dismissed).toBe(false);
  expect(container.querySelector('[aria-label="Starting Tabs"]')).not.toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(getStartupSplashState().dismissed).toBe(true);
  expect(container.querySelector('[aria-label="Starting Tabs"]')).toBeNull();
  expect(container.textContent).toContain("Workspace");
});
it("cancels a pending exit notification when the shell unmounts", async () => {
  await act(async () => root.render(<StartupShell loadApplication={async () => null} />));
  await act(async () => updateStartupSplash({ ready: true }));
  await act(async () => root.render(null));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(getStartupSplashState().dismissed).toBe(false);
});
