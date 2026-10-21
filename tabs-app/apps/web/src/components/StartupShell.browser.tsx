import "../index.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { StartupShell } from "../StartupShell";
import { activateStartupSplash, updateStartupSplash } from "../lib/startupSplashLifecycle";
import type { ReactNode } from "react";

it("paints the original airport loader before imports finish and preserves it through the handoff", async () => {
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
    expect(getComputedStyle(curtain).transitionDuration).toBe("0.5s");
    updateStartupSplash({ ready: true });
    // A fast backend must not cut off the airport tiles halfway through.
    expect(curtain.classList.contains("-translate-y-full")).toBe(false);
    await expect
      .poll(() => curtain.classList.contains("-translate-y-full"), { timeout: 5_000 })
      .toBe(true);
    expect(tiles?.textContent?.replace(/\u00a0/g, " ")).toBe("TABS IDE");
    await expect.poll(() => curtain.isConnected, { timeout: 5_000 }).toBe(false);
  } finally {
    await view.unmount();
    release();
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
