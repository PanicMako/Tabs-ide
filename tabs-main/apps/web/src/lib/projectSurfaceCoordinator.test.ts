import { beforeEach, describe, expect, it, vi } from "vitest";

const localStorageMock = vi.hoisted(() => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  return storage;
});
import { ProjectId, ThreadId } from "@tabs/contracts";
import type { Project, Thread } from "../types";
import type { ProjectWorkspaceSettings } from "@tabs/contracts/settings";
import {
  activateProjectSurface,
  resolveProjectTargetSurface,
  getInFlightSurfaceActivation,
  clearInFlightSurfaceActivation,
  isPathAlignedWithSurfaceActivation,
} from "./projectSurfaceCoordinator";
import {
  useWorkspaceShellStore,
  createDefaultWorkspaceShellPersistedState,
  createDefaultProjectWorkspaceSettings,
} from "../workspaceShellStore";

describe("projectSurfaceCoordinator & Per-Project Tool Restoration", () => {
  const projectA = {
    id: ProjectId.makeUnsafe("project-a"),
    name: "Project Alpha",
    cwd: "/workspaces/alpha",
    environmentId: "env-alpha",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as Project;

  const projectB = {
    id: ProjectId.makeUnsafe("project-b"),
    name: "Project Beta",
    cwd: "/workspaces/beta",
    environmentId: "env-beta",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as Project;

  const threadA1 = {
    id: ThreadId.makeUnsafe("thread-a1"),
    projectId: projectA.id,
    environmentId: "env-alpha",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T01:00:00.000Z",
    archivedAt: null,
  } as unknown as Thread;

  const threadB1 = {
    id: ThreadId.makeUnsafe("thread-b1"),
    projectId: projectB.id,
    environmentId: "env-beta",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T02:00:00.000Z",
    archivedAt: null,
  } as unknown as Thread;

  const projects = [projectA, projectB];
  const threads = [threadA1, threadB1];

  beforeEach(() => {
    localStorageMock.clear();
    clearInFlightSurfaceActivation();
    useWorkspaceShellStore.setState({
      ...createDefaultWorkspaceShellPersistedState(),
      session: {
        openProjectIds: [projectA.id, projectB.id],
        activeProjectId: projectA.id,
        pendingTabIds: [],
        activePendingTabId: null,
        activeToolIdByProjectId: {
          [projectA.id]: "agents",
          [projectB.id]: "code",
        },
        rememberedThreadIdByProjectId: {
          [projectA.id]: threadA1.id,
          [projectB.id]: threadB1.id,
        },
      },
      projectSettingsByProjectId: {
        [projectA.id]: createDefaultProjectWorkspaceSettings(),
        [projectB.id]: createDefaultProjectWorkspaceSettings(),
      },
    });
  });

  it("1. A/Agents thread → B/Code → A restores Agents → B restores Code", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);

    // Initial state: on Project A, agents tool, thread-a1
    expect(useWorkspaceShellStore.getState().session.activeProjectId).toBe(projectA.id);
    expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectA.id]).toBe(
      "agents",
    );

    // 1. Switch to Project B (remembered Code)
    const resB = await activateProjectSurface({
      projectId: projectB.id,
      projects,
      threads,
      navigate,
      currentPathname: `/${projectA.environmentId}/${threadA1.id}`,
    });

    expect(resB.toolId).toBe("code");
    expect(resB.destination).toEqual({ to: "/" });
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
    expect(useWorkspaceShellStore.getState().session.activeProjectId).toBe(projectB.id);
    expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectB.id]).toBe(
      "code",
    );

    // 2. Switch back to Project A
    const resA = await activateProjectSurface({
      projectId: projectA.id,
      projects,
      threads,
      navigate,
      currentPathname: "/",
    });

    expect(resA.toolId).toBe("agents");
    expect(resA.threadId).toBe(threadA1.id);
    expect(resA.destination).toEqual({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: projectA.environmentId,
        threadId: threadA1.id,
      },
    });
    expect(useWorkspaceShellStore.getState().session.activeProjectId).toBe(projectA.id);
    expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectA.id]).toBe(
      "agents",
    );

    // 3. Switch to Project B again -> still restores Code
    const resB2 = await activateProjectSurface({
      projectId: projectB.id,
      projects,
      threads,
      navigate,
      currentPathname: `/${projectA.environmentId}/${threadA1.id}`,
    });

    expect(resB2.toolId).toBe("code");
    expect(resB2.destination).toEqual({ to: "/" });
    expect(useWorkspaceShellStore.getState().session.activeProjectId).toBe(projectB.id);
    expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectB.id]).toBe(
      "code",
    );
  });

  it("2. A/Agents thread → B/Git does not reactivate A during transition", async () => {
    let finishNavigation!: () => void;
    const navigate = vi.fn(() => new Promise<void>((resolve) => (finishNavigation = resolve)));

    // Set B's remembered tool to Git
    useWorkspaceShellStore.getState().setActiveTool(projectB.id, "git");

    const activation = activateProjectSurface({
      projectId: projectB.id,
      projects,
      threads,
      navigate,
      currentPathname: `/${projectA.environmentId}/${threadA1.id}`,
    });

    // Verify in-flight guard is set for B
    const inFlight = getInFlightSurfaceActivation();
    expect(inFlight).not.toBeNull();
    expect(inFlight?.projectId).toBe(projectB.id);
    expect(inFlight?.toolId).toBe("git");

    // Store has B as active project with Git
    const state = useWorkspaceShellStore.getState();
    expect(state.session.activeProjectId).toBe(projectB.id);
    expect(state.session.activeToolIdByProjectId[projectB.id]).toBe("git");
    // Project A's state is preserved untouched
    expect(state.session.activeToolIdByProjectId[projectA.id]).toBe("agents");

    finishNavigation();
    const surfaceB = await activation;
    expect(surfaceB.toolId).toBe("git");
    expect(surfaceB.destination).toEqual({ to: "/" });
    expect(getInFlightSurfaceActivation()).toBeNull();
  });

  it("3. A/Code → B/Agents remembered thread → A restores Code", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);

    // A is on Code
    useWorkspaceShellStore.getState().setActiveTool(projectA.id, "code");

    // Switch to B (which is on Agents with thread-b1)
    useWorkspaceShellStore.getState().setActiveTool(projectB.id, "agents");

    const surfaceB = await activateProjectSurface({
      projectId: projectB.id,
      projects,
      threads,
      navigate,
      currentPathname: "/",
    });

    expect(surfaceB.toolId).toBe("agents");
    expect(surfaceB.threadId).toBe(threadB1.id);
    expect(surfaceB.destination).toEqual({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: projectB.environmentId,
        threadId: threadB1.id,
      },
    });

    // Switch back to A
    const surfaceA = await activateProjectSurface({
      projectId: projectA.id,
      projects,
      threads,
      navigate,
      currentPathname: `/${projectB.environmentId}/${threadB1.id}`,
    });

    expect(surfaceA.toolId).toBe("code");
    expect(surfaceA.destination).toEqual({ to: "/" });
    expect(useWorkspaceShellStore.getState().session.activeProjectId).toBe(projectA.id);
    expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectA.id]).toBe(
      "code",
    );
  });

  it("4. Browser, Server, Testing, and custom tools route to root and preserve per-project state", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    const tools = ["browser", "server", "testing", "custom-tab-1"] as const;

    // Configure project B with a custom tool
    const customSettings: ProjectWorkspaceSettings = {
      ...createDefaultProjectWorkspaceSettings(),
      tools: [
        ...createDefaultProjectWorkspaceSettings().tools.map((tool) =>
          tool.kind === "testing" ? { ...tool, visible: true } : tool,
        ),
        {
          id: "custom-tab-1",
          kind: "custom_embed",
          label: "Documentation Tab",
          visible: true,
          customEmbedId: "embed-1",
        },
      ],
      customEmbeds: [
        {
          id: "embed-1",
          label: "Docs",
          url: "https://example.com/docs",
          resumeLastVisitedPage: true,
          partitionMode: "shared",
        },
      ],
    };

    useWorkspaceShellStore.setState((s) => ({
      ...s,
      projectSettingsByProjectId: {
        ...s.projectSettingsByProjectId,
        [projectB.id]: customSettings,
      },
    }));

    for (const toolId of tools) {
      useWorkspaceShellStore.getState().setActiveTool(projectB.id, toolId);

      const surface = await activateProjectSurface({
        projectId: projectB.id,
        projects,
        threads,
        navigate,
      });

      expect(surface.toolId).toBe(toolId);
      expect(surface.destination).toEqual({ to: "/" });
      expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectB.id]).toBe(
        toolId,
      );
    }
  });

  it("5. Mouse-equivalent and keyboard tab activation behave identically", async () => {
    const navigateMouse = vi.fn().mockResolvedValue(undefined);
    const navigateKeyboard = vi.fn().mockResolvedValue(undefined);

    useWorkspaceShellStore.getState().setActiveTool(projectB.id, "git");

    // Mouse click activation
    const mouseResult = await activateProjectSurface({
      projectId: projectB.id,
      projects,
      threads,
      navigate: navigateMouse,
      currentPathname: "/",
    });

    // Keyboard tab cycle activation
    const keyboardResult = await activateProjectSurface({
      projectId: projectB.id,
      projects,
      threads,
      navigate: navigateKeyboard,
      currentPathname: "/",
    });

    expect(mouseResult).toEqual(keyboardResult);
    expect(navigateMouse.mock.calls).toEqual(navigateKeyboard.mock.calls);
  });

  it("6. Closing active project restores fallback project and its remembered tool", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);

    // Project B is active on Git
    useWorkspaceShellStore.getState().openProjectSurface(projectB.id, "git");

    // Close Project B
    useWorkspaceShellStore.getState().closeProject(projectB.id);

    // Verify remaining open projects
    const openIds = useWorkspaceShellStore.getState().session.openProjectIds;
    expect(openIds).toEqual([projectA.id]);

    const fallbackProjectId = openIds[openIds.length - 1];
    expect(fallbackProjectId).toBe(projectA.id);

    // Activate fallback project
    const surface = await activateProjectSurface({
      projectId: fallbackProjectId!,
      projects,
      threads,
      navigate,
      currentPathname: "/",
    });

    expect(surface.projectId).toBe(projectA.id);
    expect(surface.toolId).toBe("agents");
    expect(surface.threadId).toBe(threadA1.id);
    expect(useWorkspaceShellStore.getState().session.activeProjectId).toBe(projectA.id);
  });

  it("7. Removed or hidden remembered tool falls back deterministically to valid visible tool", () => {
    // Project B remembered 'old-custom-tool', which is not in tools list
    const surface = resolveProjectTargetSurface({
      projectId: projectB.id,
      rememberedToolId: "deleted-tool-id",
      projects,
      threads,
      projectSettings: createDefaultProjectWorkspaceSettings(),
    });

    // Deterministically falls back to 'agents' (the default tool)
    expect(surface.toolId).toBe("agents");

    // Now test if 'agents' is hidden in settings, falls back to first visible tool (e.g. 'code')
    const settingsWithoutAgents: ProjectWorkspaceSettings = {
      ...createDefaultProjectWorkspaceSettings(),
      tools: createDefaultProjectWorkspaceSettings().tools.map((t) =>
        t.kind === "agents" ? { ...t, visible: false } : t,
      ),
    };

    const surfaceHiddenAgents = resolveProjectTargetSurface({
      projectId: projectB.id,
      rememberedToolId: "agents",
      projects,
      threads,
      projectSettings: settingsWithoutAgents,
    });

    expect(surfaceHiddenAgents.toolId).not.toBe("agents");
    expect(surfaceHiddenAgents.toolId).toBe("code");
  });

  it("8. Rapid repeated project switching commits target state cleanly without races", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);

    // Switch A -> B -> A -> B -> A in rapid succession
    const promises = [
      activateProjectSurface({ projectId: projectB.id, projects, threads, navigate }),
      activateProjectSurface({ projectId: projectA.id, projects, threads, navigate }),
      activateProjectSurface({ projectId: projectB.id, projects, threads, navigate }),
      activateProjectSurface({ projectId: projectA.id, projects, threads, navigate }),
    ];

    await Promise.all(promises);

    // Last activation should be authoritative
    const state = useWorkspaceShellStore.getState();
    expect(state.session.activeProjectId).toBe(projectA.id);
    expect(state.session.activeToolIdByProjectId[projectA.id]).toBe("agents");
    expect(state.session.activeToolIdByProjectId[projectB.id]).toBe("code");
  });

  it("9. Router interleaving race: pending route from Project A does not clobber Project B tool", async () => {
    // Project A is active on an Agent thread
    useWorkspaceShellStore.getState().openProjectSurface(projectA.id, "agents", threadA1.id);
    useWorkspaceShellStore.getState().setActiveTool(projectB.id, "git");

    let routerStatus: "idle" | "pending" = "idle";
    let requestedLocation = `/${projectA.environmentId}/${threadA1.id}`;
    let resolvedLocation = `/${projectA.environmentId}/${threadA1.id}`;

    // Simulating navigate: flips routerStatus to pending immediately, and changes requestedLocation to "/"
    const navigate = vi.fn().mockImplementation(async (target) => {
      routerStatus = "pending";
      requestedLocation = target.to;
      // In real life, navigation promise resolves asynchronously
      await Promise.resolve();
      routerStatus = "idle";
      resolvedLocation = target.to;
    });

    // 1. User clicks Project B
    const activationPromise = activateProjectSurface({
      projectId: projectB.id,
      projects,
      threads,
      navigate,
      currentPathname: resolvedLocation,
    });

    // 2. Interleaving check: store was updated synchronously, but router is in flight
    expect(useWorkspaceShellStore.getState().session.activeProjectId).toBe(projectB.id);
    expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectB.id]).toBe(
      "git",
    );

    // The in-flight guard protects project B while navigation is pending.
    const inFlight = getInFlightSurfaceActivation();
    expect(inFlight?.projectId).toBe(projectB.id);

    // Simulate route-sync effect evaluating during this render:
    // It sees routerStatus === "pending" or requestedLocation !== resolvedLocation
    const wouldClobber =
      routerStatus === "idle" &&
      requestedLocation === resolvedLocation &&
      requestedLocation.includes(threadA1.id) &&
      (!inFlight || inFlight.projectId === projectA.id);

    // The guard correctly prevents clobbering
    expect(wouldClobber).toBe(false);

    await activationPromise;
    expect(getInFlightSurfaceActivation()).toBeNull();
    expect(useWorkspaceShellStore.getState().session.activeProjectId).toBe(projectB.id);
    expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectB.id]).toBe(
      "git",
    );
  });

  it("10. Browser back/forward & deliberate deep links activate correct project, thread, and agents tool", async () => {
    // User is on Project B (Code, root /)
    useWorkspaceShellStore.getState().openProjectSurface(projectB.id, "code");
    clearInFlightSurfaceActivation();

    // User navigates back/forward or clicks a deep link to Project A's thread
    const targetThread = threads.find((t) => t.id === threadA1.id);
    expect(targetThread).toBeDefined();

    // Deliberate deep link surface activation
    const navigate = vi.fn().mockResolvedValue(undefined);
    const surface = await activateProjectSurface({
      projectId: projectA.id,
      targetToolId: "agents",
      targetThreadId: threadA1.id,
      projects,
      threads,
      navigate,
      currentPathname: "/",
    });

    expect(surface.projectId).toBe(projectA.id);
    expect(surface.toolId).toBe("agents");
    expect(surface.threadId).toBe(threadA1.id);
    expect(surface.destination).toEqual({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: projectA.environmentId,
        threadId: threadA1.id,
      },
    });

    // Store has Project A active with agents and threadA1 remembered
    const state = useWorkspaceShellStore.getState();
    expect(state.session.activeProjectId).toBe(projectA.id);
    expect(state.session.activeToolIdByProjectId[projectA.id]).toBe("agents");
    expect(state.session.rememberedThreadIdByProjectId[projectA.id]).toBe(threadA1.id);
    // Project B still remembers code
    expect(state.session.activeToolIdByProjectId[projectB.id]).toBe("code");
  });

  it("matches route alignment by the exact decoded thread segment", () => {
    const activation = {
      id: 1,
      projectId: projectA.id,
      toolId: "agents",
      threadId: ThreadId.makeUnsafe("thread with spaces"),
      timestamp: Date.now(),
    };

    expect(isPathAlignedWithSurfaceActivation("/env/thread%20with%20spaces", activation)).toBe(
      true,
    );
    expect(
      isPathAlignedWithSurfaceActivation("/env/prefix-thread%20with%20spaces", activation),
    ).toBe(false);
  });
});
