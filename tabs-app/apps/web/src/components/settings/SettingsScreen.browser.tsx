import "../../index.css";

import {
  ORCHESTRATION_WS_METHODS,
  type MessageId,
  type OrchestrationReadModel,
  type ProjectId,
  type ServerConfig,
  type ThreadId,
  type WsWelcomePayload,
  WS_METHODS,
  DEFAULT_SERVER_SETTINGS,
} from "@tabs/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@tabs/contracts/settings";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { ws, http, HttpResponse } from "msw";
import { setupWorker } from "msw/browser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { SETTINGS_NAV } from "./SettingsNavigation";
import { applyTestColorScheme, resetTestColorScheme } from "../../test/colorScheme";

import { useComposerDraftStore } from "../../composerDraftStore";
import { makeAppModelSelection } from "../../modelSelection";
import { initializeComposerDraftsState } from "../../state/composerDrafts";
import { initializeWorkspaceShellState } from "../../state/workspaceShell";
import { useRightPanelStore } from "../../stores/rightPanelStore";
import { useWorkspaceShellStore } from "../../workspaceShellStore";
import { attachBrowserRpcFixture, browserTestProviders } from "../../test/browserRpcFixture";
import { getRouter } from "../../router";
import { appAtomRegistry, AppAtomRegistryProvider } from "../../state/atomRegistry";
import { readModelStateAtom } from "../../state/readModel";

const THREAD_ID = "thread-settings-nav-test" as ThreadId;
const PROJECT_ID = "project-1" as ProjectId;
const NOW_ISO = "2026-03-04T12:00:00.000Z";

interface TestFixture {
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  welcome: WsWelcomePayload;
}

let fixture: TestFixture;
let fixtureRpc: ReturnType<typeof attachBrowserRpcFixture> | null = null;

const wsLink = ws.link(/ws(s)?:\/\/.*/);

function createBaseServerConfig(): any {
  return {
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.tabs-keybindings.json",
    keybindings: [],
    issues: [],
    providers: browserTestProviders(NOW_ISO),
    availableEditors: [],
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      ...DEFAULT_CLIENT_SETTINGS,
      enableAssistantStreaming: false,
      defaultThreadEnvMode: "local",
      textGenerationModelSelection: makeAppModelSelection("codex", "gpt-5.4-mini"),
    },
  };
}

function createMinimalSnapshot(): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    projects: [
      {
        id: PROJECT_ID,
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModelSelection: makeAppModelSelection("codex", "gpt-5"),
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: THREAD_ID,
        projectId: PROJECT_ID,
        title: "Test thread",
        modelSelection: makeAppModelSelection("codex", "gpt-5"),
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: "main",
        worktreePath: null,
        pullRequests: [],
        latestTurn: null,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        messages: [
          {
            id: "msg-1" as MessageId,
            role: "user",
            text: "hello",
            turnId: null,
            streaming: false,
            createdAt: NOW_ISO,
            updatedAt: NOW_ISO,
          },
        ],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: {
          threadId: THREAD_ID,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW_ISO,
        },
      },
    ],
    updatedAt: NOW_ISO,
  };
}

function buildFixture(): TestFixture {
  return {
    snapshot: createMinimalSnapshot(),
    serverConfig: createBaseServerConfig(),
    welcome: {
      cwd: "/repo/project",
      projectName: "Project",
      bootstrapProjectId: PROJECT_ID,
      bootstrapThreadId: THREAD_ID,
    },
  };
}

function resolveWsRpc(tag: string): unknown {
  if (tag === ORCHESTRATION_WS_METHODS.getSnapshot) {
    return fixture.snapshot;
  }
  if (tag === WS_METHODS.serverGetConfig) {
    return fixture.serverConfig;
  }
  if (tag === WS_METHODS.gitListBranches) {
    return {
      isRepo: true,
      hasOriginRemote: true,
      branches: [{ name: "main", current: true, isDefault: true, worktreePath: null }],
    };
  }
  if (tag === WS_METHODS.gitStatus) {
    return {
      branch: "main",
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };
  }
  if (tag === WS_METHODS.projectsSearchEntries) {
    return { entries: [], truncated: false };
  }
  return {};
}

const worker = setupWorker(
  wsLink.addEventListener("connection", ({ client }) => {
    fixtureRpc = attachBrowserRpcFixture(
      client,
      () => fixture,
      (body) => resolveWsRpc(body._tag),
    );
  }),
  http.get("*/attachments/:attachmentId", () => new HttpResponse(null, { status: 204 })),
  http.get("*/api/project-favicon", () => new HttpResponse(null, { status: 204 })),
);

async function mountSettings() {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;display:grid;overflow:hidden";
  document.body.append(host);
  const router = getRouter(createMemoryHistory({ initialEntries: ["/settings"] }));
  const screen = await render(
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
    </AppAtomRegistryProvider>,
    { container: host },
  );
  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("Settings screen in context", () => {
  beforeAll(async () => {
    initializeComposerDraftsState();
    initializeWorkspaceShellState();
    fixture = buildFixture();
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: { url: "/mockServiceWorker.js" },
    });
  });
  afterAll(async () => {
    await worker.stop();
  });
  beforeEach(() => {
    localStorage.clear();
    useRightPanelStore.setState({ isOpen: false, maximized: false, choosingSurface: true });
    useWorkspaceShellStore.setState(useWorkspaceShellStore.getInitialState());
    document.body.innerHTML = "";
    appAtomRegistry.set(readModelStateAtom, { projects: [], threads: [], threadsHydrated: false });
  });
  afterEach(() => {
    document.body.innerHTML = "";
    resetTestColorScheme();
  });

  for (const [width, height] of [
    [1440, 900],
    [1512, 982],
  ] as const) {
    for (const scheme of ["light", "dark"] as const) {
      it(`shows the whole nav with no scrollbar at ${width}x${height} (${scheme})`, async () => {
        await page.viewport(width, height);
        applyTestColorScheme(scheme);
        const mounted = await mountSettings();
        try {
          const nav = await vi.waitFor(
            () => {
              const el = document.querySelector<HTMLElement>('nav[data-slot="settings-nav"]');
              expect(el).toBeTruthy();
              return el!;
            },
            { timeout: 10_000 },
          );
          // The startup splash covers the app until the read model hydrates.
          await vi.waitFor(
            () => {
              expect(document.body.textContent?.toLowerCase()).not.toContain("boarding");
              expect(document.querySelector("[data-rising]")).toBeNull();
            },
            { timeout: 20_000, interval: 100 },
          );
          await new Promise((resolve) => setTimeout(resolve, 400));
          expect(nav.querySelectorAll("[data-settings-nav-item]").length).toBe(SETTINGS_NAV.length);
          expect(nav.scrollHeight).toBeLessThanOrEqual(nav.clientHeight);
          const last = nav.querySelector<HTMLElement>('[data-settings-nav-item="about"]')!;
          expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(
            nav.getBoundingClientRect().bottom,
          );
          await page.screenshot({
            path: `__screenshots__/settings-screen-${width}x${height}-${scheme}.png`,
          });
        } finally {
          await mounted.cleanup();
        }
      });
    }
  }
});
