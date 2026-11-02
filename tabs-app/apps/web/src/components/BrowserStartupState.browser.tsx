import "../index.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectId, type DesktopBridge, type DesktopBrowserHostState } from "@tabs/contracts";
import { AppAtomRegistryProvider } from "../state/atomRegistry";
import { initializeWorkspaceShellState } from "../state/workspaceShell";
import type { Project } from "../types";
import { DesktopCustomEmbedTool } from "./WorkspaceShell";
vi.mock("../nativeApi", async (original) => ({
  ...(await original<typeof import("../nativeApi")>()),
  readNativeApi: () => undefined,
}));
initializeWorkspaceShellState();
it("keeps a pending native browser in loading state until a genuine startup failure", async () => {
  const previous = window.desktopBridge;
  let resolveHost!: (state: DesktopBrowserHostState) => void;
  let rejectSession!: (error: Error) => void;
  const host = new Promise<DesktopBrowserHostState>((resolve) => {
    resolveHost = resolve;
  });
  const session = new Promise<never>((_, reject) => {
    rejectSession = reject;
  });
  window.desktopBridge = {
    getBrowserHostState: () => host,
    ensureBrowserSession: () => session,
    onBrowserSessionState: () => () => {},
    hideBrowserSession: async () => {},
  } as unknown as DesktopBridge;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const project = {
    id: ProjectId.makeUnsafe("startup-regression"),
    environmentId: "test",
    cwd: "/workspace",
    name: "Test",
  } as Project;
  let view: Awaited<ReturnType<typeof render>> | undefined;
  try {
    view = await render(
      <AppAtomRegistryProvider>
        <QueryClientProvider client={client}>
          <DesktopCustomEmbedTool
            project={project}
            title="Temporary browser"
            url="https://example.com"
            sessionId="startup-test"
          />
        </QueryClientProvider>
      </AppAtomRegistryProvider>,
    );
    await expect
      .element(page.getByText("Opening Temporary browser…", { exact: true }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain("Embedded browser unavailable");
    resolveHost({ available: true, reason: null });
    await expect
      .element(page.getByText("Preparing your browser session", { exact: true }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain("Embedded browser unavailable");
    rejectSession(new Error("Could not start this browser session"));
    await expect
      .element(page.getByText("Could not start this browser session", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText("Embedded browser unavailable", { exact: true }))
      .toBeVisible();
  } finally {
    await view?.unmount();
    client.clear();
    if (previous) window.desktopBridge = previous;
    else delete window.desktopBridge;
  }
});
