import { DEFAULT_MODEL, ProjectId, ThreadId } from "@tabs/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeAppModelSelection } from "./modelSelection";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Project, type Thread } from "./types";

let createDefaultWorkspaceShellPersistedState: typeof import("./workspaceShellStore").createDefaultWorkspaceShellPersistedState;
let syncWorkspaceShellState: typeof import("./workspaceShellStore").syncWorkspaceShellState;
let useWorkspaceShellStore: typeof import("./workspaceShellStore").useWorkspaceShellStore;
type WorkspaceShellPersistedState = import("./workspaceShellStore").WorkspaceShellPersistedState;

function makeProject(id: string, cwd = `/tmp/${id}`): Project {
  return {
    id: ProjectId.makeUnsafe(id),
    name: id,
    cwd,
    defaultModelSelection: makeAppModelSelection("codex", DEFAULT_MODEL),
    expanded: true,
    scripts: [],
  };
}

function makeThread(id: string, projectId: Project["id"]): Thread {
  return {
    id: ThreadId.makeUnsafe(id),
    codexThreadId: null,
    projectId,
    title: id,
    modelSelection: makeAppModelSelection("codex", DEFAULT_MODEL),
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-27T00:00:00.000Z",
    updatedAt: "2026-03-27T00:00:00.000Z",
    latestTurn: null,
    lastVisitedAt: undefined,
    archivedAt: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
  };
}

function createLocalStorageStub() {
  const state = new Map<string, string>();
  return {
    clear: () => state.clear(),
    getItem: (key: string) => state.get(key) ?? null,
    key: (index: number) => Array.from(state.keys())[index] ?? null,
    removeItem: (key: string) => {
      state.delete(key);
    },
    setItem: (key: string, value: string) => {
      state.set(key, String(value));
    },
    get length() {
      return state.size;
    },
  };
}

describe("workspaceShellStore", () => {
  beforeEach(async () => {
    vi.stubGlobal("localStorage", createLocalStorageStub());
    ({
      createDefaultWorkspaceShellPersistedState,
      syncWorkspaceShellState,
      useWorkspaceShellStore,
    } = await import("./workspaceShellStore"));
    useWorkspaceShellStore.setState(createDefaultWorkspaceShellPersistedState());
  });

  it("keeps custom-tab controls, viewport, and navigation under the same persistence key", async () => {
    const { browserSessionStateKey } = await import("./workspaceShellStore");
    const projectId = ProjectId.makeUnsafe("toolbar-project");
    const store = useWorkspaceShellStore.getState();
    store.setBrowserChromeExpanded(projectId, true, "chatgpt");
    store.setBrowserViewport(projectId, { devicePreset: "wide" }, "chatgpt");
    store.setBrowserSessionUrl(projectId, "chatgpt", "https://chatgpt.com/");
    const key = browserSessionStateKey(projectId, "chatgpt");
    expect(useWorkspaceShellStore.getState().browserStateBySessionKey[key]).toMatchObject({
      chromeExpanded: true,
      devicePreset: "wide",
    });
    expect(useWorkspaceShellStore.getState().browserUrlBySessionKey[key]).toBe(
      "https://chatgpt.com/",
    );
    expect(
      useWorkspaceShellStore.getState().browserStateBySessionKey[
        browserSessionStateKey(projectId, "canva")
      ],
    ).toBeUndefined();
    store.setBrowserChromeExpanded(projectId, false, "chatgpt");
    expect(useWorkspaceShellStore.getState().browserStateBySessionKey[key]?.chromeExpanded).toBe(
      false,
    );
    expect(useWorkspaceShellStore.getState().browserStateByProjectId[projectId]).toBeUndefined();
  });

  it("isolates the active tool and browser state per project", () => {
    const projectAlpha = ProjectId.makeUnsafe("project-alpha");
    const projectBeta = ProjectId.makeUnsafe("project-beta");
    const store = useWorkspaceShellStore.getState();

    store.openProject(projectAlpha);
    store.openProject(projectBeta);
    store.setActiveTool(projectAlpha, "git");
    store.setActiveTool(projectBeta, "browser");
    store.setBrowserCurrentUrl(projectAlpha, "http://localhost:3001");
    store.setBrowserCurrentUrl(projectBeta, "http://localhost:5173");

    const state = useWorkspaceShellStore.getState();
    expect(state.session.activeToolIdByProjectId[projectAlpha]).toBe("git");
    expect(state.session.activeToolIdByProjectId[projectBeta]).toBe("browser");
    expect(state.browserStateByProjectId[projectAlpha]?.currentUrl).toBe("http://localhost:3001");
    expect(state.browserStateByProjectId[projectBeta]?.currentUrl).toBe("http://localhost:5173");
  });

  it("falls back to the default tool when a persisted active tool becomes hidden", () => {
    const projectId = ProjectId.makeUnsafe("project-shell");
    const store = useWorkspaceShellStore.getState();

    store.openProject(projectId);
    store.setActiveTool(projectId, "git");
    store.upsertProjectSettings(projectId, (current) => ({
      ...current,
      tools: current.tools.map((tool) => (tool.id === "git" ? { ...tool, visible: false } : tool)),
    }));

    const state = useWorkspaceShellStore.getState();
    // Defaults to the Agents tab (DEFAULT_PROJECT_TOOL_KIND) — not the heavy
    // Code-OSS editor, which would cold-boot on every fresh load.
    expect(state.session.activeToolIdByProjectId[projectId]).toBe("agents");
  });

  it("hides Testing in a brand-new project without changing other defaults", async () => {
    const { createDefaultProjectWorkspaceSettings, resolveProjectTools } =
      await import("./workspaceShellStore");
    const defaults = createDefaultProjectWorkspaceSettings();
    expect(defaults.tools.find((tool) => tool.kind === "testing")?.visible).toBe(false);
    expect(defaults.tools.filter((tool) => tool.visible).map((tool) => tool.id)).toEqual([
      "code",
      "agents",
      "server",
      "git",
      "browser",
    ]);
    const project = makeProject("fresh-beta-project");
    const synced = syncWorkspaceShellState(
      createDefaultWorkspaceShellPersistedState(),
      [project],
      [],
    );
    expect(
      synced.projectSettingsByProjectId[project.id]?.tools.find((tool) => tool.kind === "testing")
        ?.visible,
    ).toBe(false);
    expect(
      resolveProjectTools({
        ...defaults,
        tools: defaults.tools.map((tool) => ({ ...tool, visible: false })),
      }).some((tool) => tool.kind === "testing"),
    ).toBe(false);
  });

  it.each([true, false])(
    "preserves explicitly persisted Testing=%s across synchronization",
    async (visible) => {
      const { createDefaultProjectWorkspaceSettings } = await import("./workspaceShellStore");
      const project = makeProject("testing-preference");
      const settings = createDefaultProjectWorkspaceSettings();
      const tools = settings.tools.map((tool) =>
        tool.kind === "testing" ? { ...tool, visible } : tool,
      );
      const input = {
        ...createDefaultWorkspaceShellPersistedState(),
        projectSettingsByProjectId: { [project.id]: { ...settings, tools } },
      };
      const next = syncWorkspaceShellState(input, [project], []);
      const restarted = syncWorkspaceShellState(next, [project], []);
      expect(restarted.projectSettingsByProjectId[project.id]?.tools).toEqual(tools);
    },
  );

  it("merges newly registered built-in tools into persisted project tool lists", () => {
    const project = makeProject("project-before-testing-tool");
    const baseState = createDefaultWorkspaceShellPersistedState();
    const next = syncWorkspaceShellState(
      {
        ...baseState,
        projectSettingsByProjectId: {
          [project.id]: {
            tools: [
              { id: "code", kind: "code", label: "Code", visible: true },
              { id: "agents", kind: "agents", label: "Agents", visible: true },
              { id: "server", kind: "server", label: "Server", visible: true },
              { id: "git", kind: "git", label: "Git", visible: true },
              { id: "browser", kind: "browser", label: "Browser", visible: true },
              {
                id: "browser-figma",
                kind: "custom_embed",
                label: "Figma",
                visible: true,
                customEmbedId: "figma",
              },
            ],
            browser: {
              defaultUrl: "",
              openExternalByDefault: false,
              resumeLastVisitedPage: true,
              partitionMode: "shared",
            },
            terminalProcesses: [],
            serverPresets: [],
            customEmbeds: [
              {
                id: "figma",
                label: "Figma",
                url: "https://figma.com",
                resumeLastVisitedPage: false,
                partitionMode: "shared",
              },
            ],
          },
        },
      },
      [project],
      [],
    );

    expect(next.projectSettingsByProjectId[project.id]?.tools.map((tool) => tool.id)).toEqual([
      "code",
      "agents",
      "server",
      "git",
      "browser",
      "testing",
      "browser-figma",
    ]);
    expect(next.projectSettingsByProjectId[project.id]?.tools[5]).toMatchObject({
      kind: "testing",
      label: "Testing",
      visible: false,
    });
  });

  it("syncs persisted shell state against available projects and valid threads", () => {
    const alpha = makeProject("project-alpha");
    const beta = makeProject("project-beta");
    const alphaThread = makeThread("thread-alpha", alpha.id);
    const gammaProjectId = ProjectId.makeUnsafe("project-gamma");

    const baseState = createDefaultWorkspaceShellPersistedState();
    const input: WorkspaceShellPersistedState = {
      ...baseState,
      session: {
        ...baseState.session,
        openProjectIds: [alpha.id, gammaProjectId],
        activeProjectId: gammaProjectId,
        activeToolIdByProjectId: {
          [alpha.id]: "git",
          [beta.id]: "browser",
          [gammaProjectId]: "server",
        },
        rememberedThreadIdByProjectId: {
          [alpha.id]: alphaThread.id,
          [beta.id]: ThreadId.makeUnsafe("thread-missing"),
        },
      },
      projectSettingsByProjectId: {
        [alpha.id]: {
          tools: [
            {
              id: "agents",
              kind: "agents" as const,
              label: "Agents",
              visible: true,
            },
            {
              id: "git",
              kind: "git" as const,
              label: "Git",
              visible: true,
            },
          ],
          browser: {
            defaultUrl: "http://localhost:3000",
            openExternalByDefault: false,
            resumeLastVisitedPage: true,
            partitionMode: "shared",
          },
          terminalProcesses: [],
          serverPresets: [],
          customEmbeds: [],
        },
      },
    };

    const next = syncWorkspaceShellState(input, [alpha, beta], [alphaThread]);

    expect(next.session.openProjectIds).toEqual([alpha.id]);
    expect(next.session.activeProjectId).toBe(alpha.id);
    expect(next.session.activeToolIdByProjectId[alpha.id]).toBe("git");
    expect(next.session.activeToolIdByProjectId[beta.id]).toBe("browser");
    expect(next.session.rememberedThreadIdByProjectId).toEqual({
      [alpha.id]: alphaThread.id,
    });
    expect(next.projectSettingsByProjectId[beta.id]).toBeDefined();
    expect(next.browserStateByProjectId[beta.id]).toBeDefined();
  });

  it("drops custom terminal tools that no longer have a backing process", () => {
    const project = makeProject("project-terminal");
    const baseState = createDefaultWorkspaceShellPersistedState();

    const next = syncWorkspaceShellState(
      {
        ...baseState,
        session: {
          ...baseState.session,
          openProjectIds: [project.id],
          activeProjectId: project.id,
          activeToolIdByProjectId: {
            [project.id]: "terminal-frontend",
          },
        },
        projectSettingsByProjectId: {
          [project.id]: {
            tools: [
              {
                id: "code",
                kind: "code",
                label: "Code",
                visible: true,
              },
              {
                id: "terminal-frontend",
                kind: "custom_process",
                label: "Frontend",
                visible: true,
                terminalProcessId: "frontend",
              },
            ],
            browser: {
              defaultUrl: "",
              openExternalByDefault: false,
              resumeLastVisitedPage: true,
              partitionMode: "shared",
            },
            terminalProcesses: [],
            serverPresets: [],
            customEmbeds: [],
          },
        },
      },
      [project],
      [],
    );

    expect(next.session.activeToolIdByProjectId[project.id]).toBe("code");
  });

  it("clears open tabs when synced against an empty project list (why callers must gate on hydration)", () => {
    // syncWorkspaceShellState rebuilds from scratch and keeps only tabs whose
    // project is present in `projects`. If a caller runs it before the server
    // read model has loaded (projects still []), it wipes the restored
    // workspace. WorkspaceShell therefore gates the sync effect on
    // `threadsHydrated`; this test pins the clobbering behavior so that gate is
    // never removed without understanding the consequence.
    const project = makeProject("project-prehydration");
    const baseState = createDefaultWorkspaceShellPersistedState();

    const input: WorkspaceShellPersistedState = {
      ...baseState,
      session: {
        ...baseState.session,
        openProjectIds: [project.id],
        activeProjectId: project.id,
      },
    };

    const next = syncWorkspaceShellState(input, [], []);

    expect(next.session.openProjectIds).toEqual([]);
    expect(next.session.activeProjectId).toBeNull();
  });

  it("restores custom terminal and browser tabs (plus per-tab URLs) when the project id is stable", () => {
    const project = makeProject("project-restore");
    const baseState = createDefaultWorkspaceShellPersistedState();
    const browserSessionKey = `${project.id}:browser-figma`;

    const input: WorkspaceShellPersistedState = {
      ...baseState,
      session: {
        ...baseState.session,
        openProjectIds: [project.id],
        activeProjectId: project.id,
        activeToolIdByProjectId: {
          [project.id]: "terminal-frontend",
        },
      },
      browserUrlBySessionKey: {
        [browserSessionKey]: "https://figma.com/file/abc",
      },
      projectSettingsByProjectId: {
        [project.id]: {
          tools: [
            { id: "agents", kind: "agents", label: "Agents", visible: true },
            {
              id: "terminal-frontend",
              kind: "custom_process",
              label: "Frontend",
              visible: true,
              terminalProcessId: "frontend",
            },
            {
              id: "browser-figma",
              kind: "custom_embed",
              label: "Figma",
              visible: true,
              customEmbedId: "figma",
            },
          ],
          browser: {
            defaultUrl: "",
            openExternalByDefault: false,
            resumeLastVisitedPage: true,
            partitionMode: "shared",
          },
          terminalProcesses: [
            {
              id: "frontend",
              label: "Frontend",
              commands: ["npm run dev"],
              cwd: "",
              env: {},
              autoStart: false,
            },
          ],
          serverPresets: [],
          customEmbeds: [
            {
              id: "figma",
              label: "Figma",
              url: "https://figma.com",
              resumeLastVisitedPage: false,
              partitionMode: "shared",
            },
          ],
        },
      },
    };

    const next = syncWorkspaceShellState(input, [project], []);

    const restoredTools = next.projectSettingsByProjectId[project.id]?.tools ?? [];
    // Both custom tabs survive the project sync, so they reappear on reopen.
    expect(restoredTools.some((tool) => tool.id === "terminal-frontend")).toBe(true);
    expect(restoredTools.some((tool) => tool.id === "browser-figma")).toBe(true);
    // The active tool (the custom terminal) and the project itself are restored.
    expect(next.session.openProjectIds).toEqual([project.id]);
    expect(next.session.activeToolIdByProjectId[project.id]).toBe("terminal-frontend");
    // The per-tab browser URL is preserved so the tab reopens where it was.
    expect(next.browserUrlBySessionKey[browserSessionKey]).toBe("https://figma.com/file/abc");
  });

  it("isolates viewport device presets and custom dimensions per browser tab/session in the same project", () => {
    const project = makeProject("project-viewports");
    const store = useWorkspaceShellStore.getState();
    store.openProject(project.id);

    // Set default browser tab to iPhone 14 Pro
    store.setBrowserViewport(
      project.id,
      {
        devicePreset: "mobile-s",
        landscape: false,
      },
      "browser",
    );

    // Set custom embed Figma to Large Desktop
    store.setBrowserViewport(
      project.id,
      {
        devicePreset: "wide",
        landscape: false,
      },
      "custom-figma",
    );

    // Set custom embed ChatGPT to Laptop 13 in Landscape
    store.setBrowserViewport(
      project.id,
      {
        devicePreset: "desktop",
        landscape: true,
      },
      "custom-chatgpt",
    );

    // Set a custom dimension tab
    store.setBrowserViewport(
      project.id,
      {
        devicePreset: "custom",
        customWidth: 500,
        customHeight: 600,
        landscape: false,
      },
      "custom-preview",
    );

    const state = useWorkspaceShellStore.getState();

    // Verify each session key in the store has its own independent viewport state
    expect(state.browserStateBySessionKey[`${project.id}:browser`]?.devicePreset).toBe("mobile-s");
    expect(state.browserStateBySessionKey[`${project.id}:browser`]?.landscape).toBe(false);

    expect(state.browserStateBySessionKey[`${project.id}:custom-figma`]?.devicePreset).toBe("wide");
    expect(state.browserStateBySessionKey[`${project.id}:custom-figma`]?.landscape).toBe(false);

    expect(state.browserStateBySessionKey[`${project.id}:custom-chatgpt`]?.devicePreset).toBe(
      "desktop",
    );
    expect(state.browserStateBySessionKey[`${project.id}:custom-chatgpt`]?.landscape).toBe(true);

    expect(state.browserStateBySessionKey[`${project.id}:custom-preview`]?.devicePreset).toBe(
      "custom",
    );
    expect(state.browserStateBySessionKey[`${project.id}:custom-preview`]?.customWidth).toBe(500);
    expect(state.browserStateBySessionKey[`${project.id}:custom-preview`]?.customHeight).toBe(600);

    // Modifying one session's viewport must not change the others
    store.setBrowserViewport(
      project.id,
      {
        devicePreset: "tablet",
        landscape: true,
      },
      "custom-figma",
    );

    const nextState = useWorkspaceShellStore.getState();
    expect(nextState.browserStateBySessionKey[`${project.id}:browser`]?.devicePreset).toBe(
      "mobile-s",
    );
    expect(nextState.browserStateBySessionKey[`${project.id}:custom-figma`]?.devicePreset).toBe(
      "tablet",
    );
    expect(nextState.browserStateBySessionKey[`${project.id}:custom-figma`]?.landscape).toBe(true);
    expect(nextState.browserStateBySessionKey[`${project.id}:custom-chatgpt`]?.devicePreset).toBe(
      "desktop",
    );
  });

  it("preserves per-session browser viewport state across syncWorkspaceShellState", () => {
    const project = makeProject("project-sync-viewports");
    const baseState = createDefaultWorkspaceShellPersistedState();
    const browserKey = `${project.id}:browser`;
    const figmaKey = `${project.id}:custom-figma`;

    const input: WorkspaceShellPersistedState = {
      ...baseState,
      session: {
        ...baseState.session,
        openProjectIds: [project.id],
        activeProjectId: project.id,
      },
      browserStateBySessionKey: {
        [browserKey]: {
          currentUrl: "http://localhost:3000",
          devicePreset: "mobile-s",
          customWidth: null,
          customHeight: null,
          landscape: false,
        },
        [figmaKey]: {
          currentUrl: "https://figma.com",
          devicePreset: "desktop",
          customWidth: null,
          customHeight: null,
          landscape: true,
        },
      },
      projectSettingsByProjectId: {
        [project.id]: {
          tools: [],
          browser: {
            defaultUrl: "",
            openExternalByDefault: false,
            resumeLastVisitedPage: true,
            partitionMode: "shared",
          },
          terminalProcesses: [],
          serverPresets: [],
          customEmbeds: [
            {
              id: "figma",
              label: "Figma",
              url: "https://figma.com",
              resumeLastVisitedPage: false,
              partitionMode: "shared",
            },
          ],
        },
      },
    };

    const next = syncWorkspaceShellState(input, [project], []);
    expect(next.browserStateBySessionKey[browserKey]?.devicePreset).toBe("mobile-s");
    expect(next.browserStateBySessionKey[figmaKey]?.devicePreset).toBe("desktop");
    expect(next.browserStateBySessionKey[figmaKey]?.landscape).toBe(true);
  });
});
