import "../index.css";
import { act } from "react";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type DesktopBridge,
  type DesktopBrowserHostState,
  type DesktopBrowserSessionState,
} from "@tabs/contracts";
import { revealSavedBrowserResult } from "../lib/savedBrowserResult";
import { AppAtomRegistryProvider } from "../state/atomRegistry";
import { initializeWorkspaceShellState } from "../state/workspaceShell";
import type { Project } from "../types";
import { browserSessionStateKey, useWorkspaceShellStore } from "../workspaceShellStore";
import { DesktopCustomEmbedTool } from "./WorkspaceShell";
import { emptyBrowserState } from "./agents/companion/browserSession";
import { TooltipProvider } from "./ui/tooltip";
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

function setupSavedWorkBrowser(resumeLastVisitedPage: boolean) {
  const previousBridge = window.desktopBridge;
  const workspace = useWorkspaceShellStore.getState();
  const environmentId = EnvironmentId.makeUnsafe("saved-result-environment");
  const project = {
    id: ProjectId.makeUnsafe(`saved-result-project-${resumeLastVisitedPage}`),
    environmentId,
    cwd: "/workspace",
    name: "Saved result",
  } as Project;
  const target = { projectId: project.id, sessionId: "custom-work" };
  const partition = "persist:tabs-browser:profile:work";
  const olderUrl = "https://work.test/reports?view=all#previous";
  const savedUrl = "https://work.test/reports?view=all#saved";
  const sessionKey = browserSessionStateKey(project.id, target.sessionId);
  const storedUrl = () => useWorkspaceShellStore.getState().browserUrlBySessionKey[sessionKey];
  let nativeState: DesktopBrowserSessionState = {
    ...emptyBrowserState(project.id, target.sessionId),
    instanceId: "work-browser",
    profileId: "work",
    currentUrl: olderUrl,
  };
  let publish: (state: DesktopBrowserSessionState) => void = () => {};
  const ensureBrowserSession = vi.fn<DesktopBridge["ensureBrowserSession"]>(async () => {});
  const getBrowserSessionState = vi.fn<DesktopBridge["getBrowserSessionState"]>(
    async () => nativeState,
  );
  const runBrowserAutomation = vi.fn<DesktopBridge["runBrowserAutomation"]>(async (request) => {
    if (request.operation === "enterQuickActionFileResult") {
      nativeState = { ...nativeState, currentUrl: savedUrl };
      return { url: savedUrl };
    }
  });
  const navigateBrowserSession = vi.fn<DesktopBridge["navigateBrowserSession"]>(async ({ url }) => {
    nativeState = { ...nativeState, currentUrl: url };
    publish(nativeState);
  });
  const bridge = {
    getBrowserHostState: async () => ({ available: true, reason: null }),
    ensureBrowserSession,
    getBrowserSessionState,
    runBrowserAutomation,
    navigateBrowserSession,
    onBrowserSessionState: (callback: typeof publish) => {
      publish = callback;
      return () => {};
    },
    activateBrowserSession: async () => {},
    hideBrowserSession: async () => {},
    setBrowserBounds: async () => {},
  } as unknown as DesktopBridge;
  window.desktopBridge = bridge;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let view: Awaited<ReturnType<typeof render>> | undefined;
  workspace.setActiveProject(project.id);
  workspace.upsertProjectSettings(project.id, {
    tools: [
      {
        id: "work-tool",
        kind: "custom_embed",
        label: "Work",
        visible: true,
        customEmbedId: "work",
      },
    ],
    customEmbeds: [
      {
        id: "work",
        label: "Work",
        url: olderUrl,
        resumeLastVisitedPage,
        partitionMode: "profile",
        partitionProfile: "work",
      },
    ],
  });
  workspace.setBrowserChromeExpanded(project.id, true, target.sessionId);

  const mount = async () => {
    view = await render(
      <AppAtomRegistryProvider>
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <DesktopCustomEmbedTool
              project={project}
              title="Work"
              url={olderUrl}
              resumeLastVisitedPage={resumeLastVisitedPage}
              partitionMode="profile"
              partitionProfile="work"
              sessionId={target.sessionId}
            />
          </TooltipProvider>
        </QueryClientProvider>
      </AppAtomRegistryProvider>,
    );
  };
  const threadId = ThreadId.makeUnsafe("saved-result-thread");
  const input = { resultId: "work-report" };
  const reveal = async () => {
    await revealSavedBrowserResult({
      bridge,
      environmentId,
      threadId,
      projectId: target.projectId,
      tabId: target.sessionId,
      profileId: "work",
      operation: "enterQuickActionFileResult",
      input,
      validateUrl: (url) => url === savedUrl,
      invalidResultMessage: "Unexpected saved result URL",
      isCurrent: () => true,
    });
    expect(runBrowserAutomation).toHaveBeenCalledWith({
      ...target,
      taskId: threadId,
      source: "human",
      operation: "enterQuickActionFileResult",
      input,
    });
  };
  return {
    target,
    partition,
    olderUrl,
    savedUrl,
    storedUrl,
    ensureBrowserSession,
    getBrowserSessionState,
    navigateBrowserSession,
    mount,
    reveal,
    publishLiveState: () => publish(nativeState),
    async cleanup() {
      await view?.unmount();
      client.clear();
      useWorkspaceShellStore.setState(workspace);
      if (previousBridge) window.desktopBridge = previousBridge;
      else delete window.desktopBridge;
    },
  };
}

it("preserves a saved result in the mounted Work browser before its native event arrives", async () => {
  const browser = setupSavedWorkBrowser(true);
  const {
    target,
    partition,
    olderUrl,
    savedUrl,
    storedUrl,
    ensureBrowserSession,
    getBrowserSessionState,
    navigateBrowserSession,
  } = browser;
  try {
    await browser.mount();
    const address = page.getByRole("textbox", { name: "Work URL" });
    await expect.element(address).toHaveValue(olderUrl);
    // Wait for the previous native URL to become the debounced writeback value.
    await expect.poll(storedUrl).toBe(olderUrl);
    expect(ensureBrowserSession).toHaveBeenCalledExactlyOnceWith({
      ...target,
      initialUrl: olderUrl,
      partition,
      waitForLoad: false,
    });
    expect(getBrowserSessionState).toHaveBeenCalledExactlyOnceWith(target);
    expect(navigateBrowserSession).not.toHaveBeenCalled();
    getBrowserSessionState.mockClear();

    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    try {
      await act(browser.reveal);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(storedUrl()).toBe(savedUrl);
    expect(ensureBrowserSession).toHaveBeenCalledTimes(1);
    expect(navigateBrowserSession).not.toHaveBeenCalled();
    // The reveal checks the original session, then the renderer checks the live destination.
    expect(getBrowserSessionState.mock.calls).toEqual([[target], [target]]);
    const reads = await Promise.all(getBrowserSessionState.mock.results.map(({ value }) => value));
    expect(reads.map(({ currentUrl }) => currentUrl)).toEqual([olderUrl, savedUrl]);

    browser.publishLiveState();
    await expect.element(address).toHaveValue(savedUrl);
    expect(getBrowserSessionState).toHaveBeenCalledTimes(2);
    expect(ensureBrowserSession).toHaveBeenCalledTimes(1);
    expect(navigateBrowserSession).not.toHaveBeenCalled();

    const manualUrl = "https://work.test/reports?view=all#manual";
    await address.fill(manualUrl);
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => navigateBrowserSession.mock.calls)
      .toEqual([[{ ...target, url: manualUrl }]]);
    await expect.element(address).toHaveValue(manualUrl);
    expect(storedUrl()).toBe(manualUrl);
    expect(ensureBrowserSession).toHaveBeenCalledTimes(1);
  } finally {
    await browser.cleanup();
  }
});

it("adopts the verified Work result on mount after an empty startup snapshot with resume off", async () => {
  const browser = setupSavedWorkBrowser(false);
  const { target, partition, savedUrl, getBrowserSessionState, ensureBrowserSession } = browser;
  try {
    await browser.reveal();
    expect(browser.storedUrl()).toBe(savedUrl);
    // The first startup read is stale. The guest becomes visible only through the fresh read.
    getBrowserSessionState
      .mockClear()
      .mockResolvedValueOnce(emptyBrowserState(target.projectId, target.sessionId));
    await browser.mount();

    await expect.element(page.getByRole("textbox", { name: "Work URL" })).toHaveValue(savedUrl);
    expect(browser.storedUrl()).toBe(savedUrl);
    expect(getBrowserSessionState.mock.calls).toEqual([[target], [target]]);
    expect(ensureBrowserSession).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ ...target, partition }),
    );
    expect(browser.navigateBrowserSession).not.toHaveBeenCalled();
  } finally {
    await browser.cleanup();
  }
});

it("keeps takeover, return, and Stop keyboard accessible with collapsed private browser chrome", async () => {
  const previous = window.desktopBridge;
  const project = {
    id: ProjectId.makeUnsafe("handoff-project"),
    cwd: "/workspace",
    name: "QA",
  } as Project;
  const target = { projectId: project.id, sessionId: "custom-private-qa" };
  let state: DesktopBrowserSessionState = {
    ...emptyBrowserState(target.projectId, target.sessionId),
    instanceId: "original-browser",
    currentUrl: "https://private.test/restored",
    profileId: "work",
    assignedTaskId: "owner-thread",
    browserPageAuthorized: true,
  };
  let publish: (next: DesktopBrowserSessionState) => void = () => {};
  const takeBrowserControl = vi.fn(async () => {
    state = { ...state, controller: "human" };
    publish(state);
  });
  const resumeBrowserAgent = vi.fn(async () => {
    state = { ...state, controller: "none" };
    publish(state);
  });
  const runBrowserAutomation = vi.fn<DesktopBridge["runBrowserAutomation"]>(async (request) => {
    if (request.operation === "revokeBrowserPage") {
      state = {
        ...state,
        controller: "human",
        assignedTaskId: null,
        browserPageAuthorized: false,
      };
      publish(state);
    }
  });
  const getBrowserSessionState = vi.fn(async () => state);
  const navigateBrowserSession = vi.fn(async () => {});
  const ensureBrowserSession = vi.fn(async () => {});
  window.desktopBridge = {
    getBrowserHostState: async () => ({ available: true, reason: null }),
    ensureBrowserSession,
    getBrowserSessionState,
    navigateBrowserSession,
    onBrowserSessionState: (callback: typeof publish) => {
      publish = callback;
      return () => {};
    },
    activateBrowserSession: async () => {},
    hideBrowserSession: async () => {},
    setBrowserBounds: async () => {},
    takeBrowserControl,
    resumeBrowserAgent,
    runBrowserAutomation,
  } as unknown as DesktopBridge;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let view: Awaited<ReturnType<typeof render>> | undefined;
  try {
    view = await render(
      <AppAtomRegistryProvider>
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <div id="project-toolbar-extra-controls" />
            <DesktopCustomEmbedTool
              project={project}
              title="Private QA"
              url="https://private.test/"
              partitionMode="profile"
              partitionProfile="work"
              sessionId={target.sessionId}
            />
          </TooltipProvider>
        </QueryClientProvider>
      </AppAtomRegistryProvider>,
    );
    await expect
      .element(page.getByRole("button", { name: "Show Private QA controls" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Private QA URL" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Thread owner-th · Has page access");
    state = { ...state, controller: "agent", activeAgentAction: "waitFor" };
    publish(state);
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Thread owner-th · Waiting for the page");
    expect(ensureBrowserSession).toHaveBeenCalledExactlyOnceWith({
      ...target,
      initialUrl: "https://private.test/",
      partition: "persist:tabs-browser:profile:work",
      waitForLoad: false,
    });
    expect(navigateBrowserSession).not.toHaveBeenCalled();

    await userEvent.tab();
    await expect.element(page.getByRole("button", { name: "Reload Private QA" })).toHaveFocus();
    await userEvent.tab();
    await userEvent.tab();
    await expect
      .element(page.getByRole("button", { name: "Open Private QA externally" }))
      .toHaveFocus();
    await userEvent.tab();
    const myTurn = page.getByRole("button", { name: "My turn" });
    await expect.element(myTurn).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(takeBrowserControl).toHaveBeenCalledExactlyOnceWith({ ...target, demonstrate: true });
    await expect.element(page.getByRole("status")).toHaveTextContent("Thread owner-th · Your turn");
    await expect
      .element(page.getByRole("textbox", { name: "Meaning of the demonstrated step" }))
      .toHaveFocus();
    await userEvent.keyboard("Export selected rows");
    await userEvent.tab();
    await expect.element(page.getByRole("button", { name: "Return to agent" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(resumeBrowserAgent).toHaveBeenCalledExactlyOnceWith({
      ...target,
      taskId: "owner-thread",
      meaning: "Export selected rows",
    });
    await expect.element(myTurn).toHaveFocus();
    await userEvent.tab();
    const stop = page.getByRole("button", { name: "Stop agent on this browser tab" });
    await expect.element(stop).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(stop).not.toBeInTheDocument();
    expect(
      runBrowserAutomation.mock.calls
        .map(([request]) => request)
        .filter((request) => request.operation === "revokeBrowserPage"),
    ).toEqual([
      {
        ...target,
        taskId: "owner-thread",
        source: "human",
        operation: "revokeBrowserPage",
      },
    ]);
  } finally {
    await view?.unmount();
    client.clear();
    if (previous) window.desktopBridge = previous;
    else delete window.desktopBridge;
  }
});
