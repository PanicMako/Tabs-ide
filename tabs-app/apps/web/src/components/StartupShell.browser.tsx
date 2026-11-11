import "../index.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { StartupShell } from "../StartupShell";
import { activateStartupSplash, updateStartupSplash } from "../lib/startupSplashLifecycle";
import type { ReactNode } from "react";

it("paints the airport loader before imports finish, then raises the workspace once every card lands", async () => {
  const release = activateStartupSplash();
  let resolve!: (app: ReactNode) => void;
  const pending = new Promise<ReactNode>((done) => {
    resolve = done;
  });
  const view = await render(<StartupShell loadApplication={() => pending} />);
  try {
    const splash = page.getByRole("status", { name: "Starting Tabs", exact: true });
    await expect.element(splash).toBeVisible();
    const tiles = document.querySelector(".grid-cols-4");
    expect(tiles).not.toBeNull();
    resolve(<button>Workspace loaded</button>);
    await expect.element(page.getByRole("button", { name: "Workspace loaded" })).toBeVisible();
    expect(document.querySelector(".grid-cols-4")).toBe(tiles);
    const curtain = document.querySelector<HTMLElement>('[aria-label="Starting Tabs"]')!;
    updateStartupSplash({ ready: true });
    // A fast backend must not cut off the airport tiles halfway through.
    expect(curtain.hasAttribute("data-leaving")).toBe(false);
    await expect.poll(() => curtain.hasAttribute("data-leaving"), { timeout: 5_000 }).toBe(true);
    // Every card has landed before anything moves: the board reads in full.
    expect(tiles?.textContent?.replace(/\u00a0/g, " ")).toBe("TABS IDE");
    // Then, after a short beat, the workspace rises from the bottom as a real
    // compositor animation; the board itself stays put underneath.
    await expect
      .poll(() => document.querySelector<HTMLElement>("[data-rising]"), { timeout: 2_000 })
      .not.toBeNull();
    const riser = document.querySelector<HTMLElement>("[data-rising]")!;
    expect(riser.getAnimations().length).toBeGreaterThan(0);
    expect(curtain.getAnimations().length).toBe(0);
    await expect.poll(() => curtain.isConnected, { timeout: 5_000 }).toBe(false);
  } finally {
    await view.unmount();
    release();
  }
});

it("brings the workspace up from the bottom after the mascot gag", async () => {
  window.localStorage.setItem(
    "tabs:client-settings:v1",
    JSON.stringify({ splashLoaderStyle: "mascot" }),
  );
  const release = activateStartupSplash();
  const view = await render(
    <StartupShell loadApplication={async () => <button>Workspace loaded</button>} />,
  );
  try {
    const curtain = document.querySelector<HTMLElement>('[aria-label="Starting Tabs"]')!;
    const workspace = page.getByRole("button", { name: "Workspace loaded" });
    await expect.element(workspace).toBeInTheDocument();
    const layer = workspace.element().parentElement!;
    expect(getComputedStyle(layer).display).toBe("contents");
    updateStartupSplash({ ready: true });
    await expect.poll(() => layer.dataset.rising, { timeout: 8_000 }).toBe("true");
    expect(getComputedStyle(layer).position).toBe("fixed");
    expect(layer.getAnimations().length).toBeGreaterThan(0);
    // The splash holds still and is covered; it is not the thing moving away.
    expect(curtain.getAnimations().length).toBe(0);
    await expect.poll(() => curtain.isConnected, { timeout: 5_000 }).toBe(false);
    expect(layer.dataset.rising).toBeUndefined();
    expect(getComputedStyle(layer).display).toBe("contents");
  } finally {
    await view.unmount();
    release();
    window.localStorage.removeItem("tabs:client-settings:v1");
  }
});

it("keeps a readable startup failure on the original loader", async () => {
  const release = activateStartupSplash();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const view = await render(
    <StartupShell loadApplication={() => Promise.reject(new Error("Import failed"))} />,
  );
  try {
    await expect.element(page.getByRole("alert")).toHaveTextContent("Tabs could not start");
    await expect
      .element(page.getByRole("status", { name: "Starting Tabs", exact: true }))
      .toBeVisible();
  } finally {
    await view.unmount();
    error.mockRestore();
    release();
  }
});
