import { StrictMode } from "react";
import "../index.css";
import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { DesktopBridge, DesktopExtensionViewErrorEvent } from "@tabs/contracts";

import { ExtensionToolSurface } from "./ExtensionToolSurface";

test("uses the full content area without a redundant identity bar", async () => {
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
  const content = screen.getByRole("region", { name: "Overview extension content" });
  await expect.element(content).toBeVisible();
  await expect.element(screen.getByRole("banner")).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Extensions are available in Tabs desktop.");
});

test("shows accessible crash error with safe keyboard retry and ignores stale events from earlier attempts", async () => {
  const listeners = { error: null as ((event: DesktopExtensionViewErrorEvent) => void) | null };
  let activateCalls = 0;
  let lastActivationInput: any = null;

  const mockBridge: Partial<DesktopBridge> = {
    activateExtensionTool: vi.fn(async (input) => {
      activateCalls++;
      lastActivationInput = input;
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
  const firstActivationId = lastActivationInput?.activationId;
  expect(typeof firstActivationId).toBe("string");
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();

  // Stale event from another project must NOT affect this tool
  listeners.error?.({
    projectId: "project-b",
    extensionId: "acme.dashboard",
    toolId: "overview",
    profileId: "work",
    activationId: firstActivationId,
    error: "The extension crashed (crashed).",
  });
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();

  // Stale event from another tool must NOT affect this tool
  listeners.error?.({
    projectId: "project-a",
    extensionId: "acme.dashboard",
    toolId: "other-tool",
    profileId: "work",
    activationId: firstActivationId,
    error: "The extension crashed (crashed).",
  });
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();

  // Stale event with non-matching activationId must NOT affect this tool
  listeners.error?.({
    projectId: "project-a",
    extensionId: "acme.dashboard",
    toolId: "overview",
    profileId: "work",
    activationId: "old-stale-attempt-id",
    error: "Stale crash from prior attempt.",
  });
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();

  // Matching crash event for this exact instance
  listeners.error?.({
    projectId: "project-a",
    extensionId: "acme.dashboard",
    toolId: "overview",
    profileId: "work",
    activationId: firstActivationId,
    error: "The extension crashed (oom).",
  });

  const alert = screen.getByRole("alert");
  await expect.element(alert).toBeVisible();
  await expect.element(alert).toHaveTextContent("Could not open Overview.");
  await expect.element(alert).toHaveTextContent("The extension crashed (oom).");

  const retryButton = screen.getByRole("button", { name: "Retry opening Overview" });
  await expect.element(retryButton).toBeVisible();

  // Assert retry control receives focus on failure in real Chromium
  expect(document.activeElement).toBe(retryButton.element());

  // Enter activates the focused Retry control.
  await userEvent.keyboard("{Enter}");
  expect(activateCalls).toBe(2);
  const secondActivationId = lastActivationInput?.activationId;
  expect(typeof secondActivationId).toBe("string");
  expect(secondActivationId).not.toBe(firstActivationId);
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();

  // Delayed old view crash with the SAME project/extension/tool/profile after retry:
  // Must NOT put the new active instance into an error state!
  listeners.error?.({
    projectId: "project-a",
    extensionId: "acme.dashboard",
    toolId: "overview",
    profileId: "work",
    activationId: firstActivationId,
    error: "Old view crash after retry.",
  });
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();

  // Space also activates Retry on a later crash.
  listeners.error?.({
    projectId: "project-a",
    extensionId: "acme.dashboard",
    toolId: "overview",
    profileId: "work",
    activationId: secondActivationId,
    error: "The extension crashed again.",
  });
  await expect.element(retryButton).toBeVisible();
  expect(document.activeElement).toBe(retryButton.element());
  await userEvent.keyboard("{Space}");
  expect(activateCalls).toBe(3);
  expect(lastActivationInput?.activationId).not.toBe(secondActivationId);
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();

  delete (window as unknown as { desktopBridge?: unknown }).desktopBridge;
});

test("Strict Mode cleanup cannot hide the current native extension after a delayed launch", async () => {
  const launches: Array<{ input: any; finish: () => void }> = [];
  let activeId: string | undefined;
  const mockBridge: Partial<DesktopBridge> = {
    activateExtensionTool: vi.fn(
      (input) =>
        new Promise<void>((resolve) => {
          launches.push({ input, finish: resolve });
          activeId = input.activationId;
        }),
    ),
    setExtensionBounds: vi.fn(async () => undefined),
    hideExtensionTool: vi.fn(async (input) => {
      if (typeof input === "object" && input?.activationId === activeId) activeId = undefined;
    }),
  };
  (window as unknown as { desktopBridge: typeof mockBridge }).desktopBridge = mockBridge;
  const screen = await render(
    <StrictMode>
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
      </div>
    </StrictMode>,
  );
  expect(launches).toHaveLength(2);
  expect(launches[0]!.input.activationId).not.toBe(launches[1]!.input.activationId);
  launches[1]!.finish();
  await vi.waitFor(() => expect(mockBridge.setExtensionBounds).toHaveBeenCalled());
  launches[0]!.finish();
  await vi.waitFor(() => expect(mockBridge.hideExtensionTool).toHaveBeenCalledTimes(2));
  expect(activeId).toBe(launches[1]!.input.activationId);
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  await screen.unmount();
  delete (window as unknown as { desktopBridge?: unknown }).desktopBridge;
});
