import "../index.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { DesktopBridge, DesktopExtensionViewErrorEvent } from "@tabs/contracts";

import { ExtensionToolSurface } from "./ExtensionToolSurface";

test("keeps extension identity visible outside its content area on unsupported clients", async () => {
  const screen = await render(
    <div style={{ width: 600, height: 400 }}>
      <ExtensionToolSurface
        input={{
          projectId: "project-a",
          extensionId: "acme.dashboard",
          toolId: "overview",
          profileId: "work",
        }}
        label="Overview"
        source="exchange"
        registryOrigin="https://exchange.example"
      />
    </div>,
  );
  const identity = screen.getByRole("banner", { name: "Extension identity" });
  const content = screen.getByRole("region", { name: "Overview extension content" });
  await expect.element(identity).toBeVisible();
  await expect.element(content).toBeVisible();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Extensions are available in Tabs desktop.");
  const header = document.querySelector<HTMLElement>('header[aria-label="Extension identity"]');
  const region = document.querySelector<HTMLElement>(
    '[role="region"][aria-label="Overview extension content"]',
  );
  expect(header).not.toBeNull();
  expect(region).not.toBeNull();
  expect(region!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    header!.getBoundingClientRect().bottom,
  );
});

test("shows accessible crash error with safe retry and ignores stale events from another project/tool", async () => {
  const listeners = { error: null as ((event: DesktopExtensionViewErrorEvent) => void) | null };
  let activateCalls = 0;

  const mockBridge: Partial<DesktopBridge> = {
    activateExtensionTool: vi.fn(async () => {
      activateCalls++;
    }),
    setExtensionBounds: vi.fn(async () => undefined),
    hideExtensionTool: vi.fn(async () => undefined),
    onExtensionViewError: (listener) => {
      listeners.error = listener;
      return () => {
        listeners.error = null;
      };
    },
  };

  (window as unknown as { desktopBridge: typeof mockBridge }).desktopBridge = mockBridge;

  const screen = await render(
    <div style={{ width: 600, height: 400 }}>
      <ExtensionToolSurface
        input={{
          projectId: "project-a",
          extensionId: "acme.dashboard",
          toolId: "overview",
          profileId: "work",
        }}
        label="Overview"
        source="exchange"
        registryOrigin="https://exchange.example"
      />
    </div>,
  );

  expect(activateCalls).toBe(1);
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();

  // Stale event from another project must NOT affect this tool
  listeners.error?.({
    projectId: "project-b",
    extensionId: "acme.dashboard",
    toolId: "overview",
    profileId: "work",
    error: "The extension crashed (crashed).",
  });
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();

  // Stale event from another tool must NOT affect this tool
  listeners.error?.({
    projectId: "project-a",
    extensionId: "acme.dashboard",
    toolId: "other-tool",
    profileId: "work",
    error: "The extension crashed (crashed).",
  });
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();

  // Matching crash event for this exact view
  listeners.error?.({
    projectId: "project-a",
    extensionId: "acme.dashboard",
    toolId: "overview",
    profileId: "work",
    error: "The extension crashed (oom).",
  });

  const alert = screen.getByRole("alert");
  await expect.element(alert).toBeVisible();
  await expect.element(alert).toHaveTextContent("Could not open Overview.");
  await expect.element(alert).toHaveTextContent("The extension crashed (oom).");

  const retryButton = screen.getByRole("button", { name: "Retry opening Overview" });
  await expect.element(retryButton).toBeVisible();

  // Click retry: resets error and re-activates
  await retryButton.click();
  expect(activateCalls).toBe(2);
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();

  delete (window as unknown as { desktopBridge?: unknown }).desktopBridge;
});
