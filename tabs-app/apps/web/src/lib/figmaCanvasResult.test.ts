import { EnvironmentId, PreviewTabId, ProjectId, ThreadId } from "@tabs/contracts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import { useRightPanelStore } from "~/stores/rightPanelStore";
import { useWorkspaceShellStore } from "~/workspaceShellStore";
import { openSavedFigmaCanvasResult, revealSavedFigmaCanvasResult } from "./figmaCanvasResult";

const { environmentApi, getFigmaCanvasResult, isPrimaryEnvironment } = vi.hoisted(() => ({
  environmentApi: vi.fn(),
  getFigmaCanvasResult: vi.fn(),
  isPrimaryEnvironment: vi.fn(),
}));
vi.mock("~/connection/environmentApiRegistry", () => ({ environmentApi, isPrimaryEnvironment }));

const environmentId = EnvironmentId.make("desktop");
const threadId = ThreadId.make("figma-thread");
const projectId = ProjectId.make("figma-project");
const scope = `${environmentId}:${threadId}`;
const operationId = "fa".repeat(32);
const frameUrl = "https://www.figma.com/design/main/branch/workBranch/Design?node-id=21-2";
const receiptFor = (tabId: string) => ({
  target: {
    projectId,
    tabId: PreviewTabId.make(tabId),
    hostKey: "work-browser-host",
    profileId: "work",
    attachmentId: "dd056428-88b4-4cb7-96c5-97503c89f805",
    mainFileKey: "main",
    fileKey: "workBranch",
    nodeId: "12:34",
  },
  frameNodeId: "21:2",
  textNodeId: "21:3",
  verifiedAt: "2026-11-26T00:00:00Z",
});

function mockBridge(tabId: string) {
  const state = { projectId, sessionId: tabId, profileId: "work", instanceId: "work-instance" };
  const getBrowserSessionState = vi.fn().mockResolvedValue(state);
  const ensureBrowserSession = vi.fn().mockResolvedValue(undefined);
  const runBrowserAutomation = vi.fn().mockResolvedValue({ url: frameUrl });
  const bridge = {
    getBrowserSessionState,
    ensureBrowserSession,
    runBrowserAutomation,
  } as unknown as NonNullable<Window["desktopBridge"]>;
  return { bridge, state, getBrowserSessionState, ensureBrowserSession, runBrowserAutomation };
}

beforeEach(() => {
  getFigmaCanvasResult.mockReset();
  environmentApi.mockReset().mockResolvedValue({ preview: { getFigmaCanvasResult } });
  isPrimaryEnvironment.mockReset().mockImplementation((id) => id === environmentId);
  useCompanionSurfaceStore.setState({ workspaces: {} });
  useRightPanelStore.getState().closePanel();
  useWorkspaceShellStore.getState().openProject(projectId);
  useWorkspaceShellStore.getState().setActiveTool(projectId, "agents");
});

afterEach(() => vi.unstubAllGlobals());

test("restores the exact Work companion tab and reveals an equivalent Figma URL", async () => {
  const surfaces = useCompanionSurfaceStore.getState();
  const work = surfaces.open(scope, "browser", { profileId: "work" });
  const personal = surfaces.open(scope, "browser", { profileId: "personal", url: frameUrl });
  const normalizedFrameUrl =
    "https://figma.com/file/main/branch/workBranch/Renamed?mode=design&node-id=21%3A2";
  const tabId = `agents-surface-${work}`;
  const receipt = receiptFor(tabId);
  const { bridge, getBrowserSessionState, ensureBrowserSession, runBrowserAutomation } =
    mockBridge(tabId);
  vi.stubGlobal("window", { desktopBridge: bridge });
  getFigmaCanvasResult.mockResolvedValue(receipt);
  getBrowserSessionState.mockResolvedValueOnce({ projectId, sessionId: tabId, currentUrl: null });
  runBrowserAutomation.mockImplementationOnce(async () => {
    expect(useCompanionSurfaceStore.getState().workspaces[scope]?.activeId).toBe(personal);
    return { url: normalizedFrameUrl };
  });

  await openSavedFigmaCanvasResult(environmentId, threadId, projectId, { operationId }, () => true);

  expect(environmentApi).toHaveBeenCalledExactlyOnceWith(environmentId);
  expect(getFigmaCanvasResult).toHaveBeenCalledExactlyOnceWith({ threadId, operationId });
  expect(ensureBrowserSession).toHaveBeenCalledExactlyOnceWith({
    projectId,
    sessionId: tabId,
    profileId: "work",
    initialUrl: "",
  });
  expect(runBrowserAutomation).toHaveBeenCalledExactlyOnceWith({
    projectId,
    sessionId: tabId,
    source: "human",
    taskId: threadId,
    operation: "enterFigmaCanvasResult",
    input: receipt,
  });
  const workspace = useCompanionSurfaceStore.getState().workspaces[scope];
  expect(workspace?.activeId).toBe(work);
  expect(workspace?.tabs.find(({ id }) => id === work)?.url).toBe(normalizedFrameUrl);
  expect(workspace?.tabs.find(({ id }) => id === personal)?.url).toBe(frameUrl);
  expect(useRightPanelStore.getState().activeTab).toBe("browser");
});

test("rejects a different environment, thread, project or live browser profile", async () => {
  const surfaces = useCompanionSurfaceStore.getState();
  const work = surfaces.open(scope, "browser", { profileId: "work" });
  const tabId = `agents-surface-${work}`;
  const receipt = receiptFor(tabId);
  const { bridge, state, getBrowserSessionState, ensureBrowserSession, runBrowserAutomation } =
    mockBridge(tabId);
  vi.stubGlobal("window", { desktopBridge: bridge });
  await expect(
    openSavedFigmaCanvasResult(
      EnvironmentId.make("remote"),
      threadId,
      projectId,
      { operationId },
      () => true,
    ),
  ).rejects.toThrow("on its original machine");
  expect(environmentApi).not.toHaveBeenCalled();
  await expect(
    revealSavedFigmaCanvasResult(
      bridge,
      environmentId,
      ThreadId.make("other-thread"),
      projectId,
      receipt,
      () => true,
    ),
  ).rejects.toThrow("original browser tab or profile");
  await expect(
    revealSavedFigmaCanvasResult(
      bridge,
      environmentId,
      threadId,
      ProjectId.make("other-project"),
      receipt,
      () => true,
    ),
  ).rejects.toThrow("original browser tab or profile");
  expect(getBrowserSessionState).not.toHaveBeenCalled();
  getBrowserSessionState.mockResolvedValue({
    ...state,
    profileId: "personal",
    currentUrl: frameUrl,
  });
  await expect(
    revealSavedFigmaCanvasResult(bridge, environmentId, threadId, projectId, receipt, () => true),
  ).rejects.toThrow("original browser tab or profile");
  expect(ensureBrowserSession).not.toHaveBeenCalled();
  expect(runBrowserAutomation).not.toHaveBeenCalled();
});

test.each([
  { changed: "tab", changes: { sessionId: "agents-surface-other" } },
  { changed: "profile", changes: { profileId: "personal" } },
])("rejects a switched native $changed after restoring a blank guest", async ({ changes }) => {
  const surfaces = useCompanionSurfaceStore.getState();
  const work = surfaces.open(scope, "browser", { profileId: "work" });
  const personal = surfaces.open(scope, "browser", { profileId: "personal" });
  const tabId = `agents-surface-${work}`;
  const { bridge, state, getBrowserSessionState, ensureBrowserSession, runBrowserAutomation } =
    mockBridge(tabId);
  getBrowserSessionState
    .mockResolvedValueOnce({ projectId, sessionId: tabId, currentUrl: null })
    .mockResolvedValueOnce({ ...state, ...changes });

  await expect(
    revealSavedFigmaCanvasResult(
      bridge,
      environmentId,
      threadId,
      projectId,
      receiptFor(tabId),
      () => true,
    ),
  ).rejects.toThrow("original browser tab or profile");
  expect(ensureBrowserSession).toHaveBeenCalledExactlyOnceWith({
    projectId,
    sessionId: tabId,
    profileId: "work",
    initialUrl: "",
  });
  expect(getBrowserSessionState).toHaveBeenCalledTimes(2);
  expect(runBrowserAutomation).not.toHaveBeenCalled();
  expect(useCompanionSurfaceStore.getState().workspaces[scope]?.activeId).toBe(personal);
});

test.each([
  { tabId: "browser", toolId: "browser" },
  { tabId: "custom-figma", toolId: "browser-figma" },
])(
  "reveals the $tabId project tool in its configured browser partition",
  async ({ tabId, toolId }) => {
    const workspace = useWorkspaceShellStore.getState();
    const setProfile = (profileId: string) => {
      const partition = { partitionMode: "profile" as const, partitionProfile: profileId };
      workspace.upsertProjectSettings(projectId, (settings) => ({
        ...settings,
        tools: [
          ...settings.tools.filter(({ id }) => id !== "browser-figma"),
          {
            id: "browser-figma",
            kind: "custom_embed",
            label: "Figma",
            visible: true,
            customEmbedId: "figma",
          },
        ],
        browser: { ...settings.browser, ...partition },
        customEmbeds: [
          {
            id: "figma",
            label: "Figma",
            url: "https://www.figma.com",
            resumeLastVisitedPage: false,
            ...partition,
          },
        ],
      }));
    };
    setProfile("work");
    const receipt = receiptFor(tabId);
    const { bridge, getBrowserSessionState, ensureBrowserSession, runBrowserAutomation } =
      mockBridge(tabId);
    getBrowserSessionState.mockResolvedValueOnce({ projectId, sessionId: tabId, currentUrl: null });
    await revealSavedFigmaCanvasResult(
      bridge,
      environmentId,
      threadId,
      projectId,
      receipt,
      () => true,
    );
    expect(ensureBrowserSession).toHaveBeenCalledExactlyOnceWith({
      projectId,
      sessionId: tabId,
      partition: "persist:tabs-browser:profile:work",
      initialUrl: "",
    });
    expect(runBrowserAutomation).toHaveBeenCalledExactlyOnceWith({
      projectId,
      sessionId: tabId,
      source: "human",
      taskId: threadId,
      operation: "enterFigmaCanvasResult",
      input: receipt,
    });
    const revealed = useWorkspaceShellStore.getState();
    expect(revealed.session.activeToolIdByProjectId[projectId]).toBe(toolId);
    expect(revealed.browserUrlBySessionKey[`${projectId}:${tabId}`]).toBe(frameUrl);

    setProfile("personal");
    await expect(
      revealSavedFigmaCanvasResult(bridge, environmentId, threadId, projectId, receipt, () => true),
    ).rejects.toThrow("original browser tab or profile");
    expect(runBrowserAutomation).toHaveBeenCalledTimes(1);
  },
);

test("keeps the current tab when native re-entry returns a different Figma node", async () => {
  const surfaces = useCompanionSurfaceStore.getState();
  const work = surfaces.open(scope, "browser", { profileId: "work" });
  const personal = surfaces.open(scope, "browser", { profileId: "personal" });
  const tabId = `agents-surface-${work}`;
  const { bridge, runBrowserAutomation } = mockBridge(tabId);
  runBrowserAutomation.mockResolvedValue({ url: frameUrl.replace("21-2", "21-3") });

  await expect(
    revealSavedFigmaCanvasResult(
      bridge,
      environmentId,
      threadId,
      projectId,
      receiptFor(tabId),
      () => true,
    ),
  ).rejects.toThrow("did not confirm the saved Figma frame");
  expect(useCompanionSurfaceStore.getState().workspaces[scope]?.activeId).toBe(personal);
});

test("rejects a companion profile change while native re-entry is pending", async () => {
  const surfaces = useCompanionSurfaceStore.getState();
  const originalUrl = "https://www.figma.com/design/main/branch/workBranch/Design?node-id=12-34";
  const work = surfaces.open(scope, "browser", { profileId: "work", url: originalUrl });
  const personal = surfaces.open(scope, "browser", { profileId: "personal" });
  const tabId = `agents-surface-${work}`;
  const { bridge, runBrowserAutomation } = mockBridge(tabId);
  runBrowserAutomation.mockImplementationOnce(async () => {
    surfaces.update(scope, work, { profileId: "personal" });
    return { url: frameUrl };
  });

  await expect(
    revealSavedFigmaCanvasResult(
      bridge,
      environmentId,
      threadId,
      projectId,
      receiptFor(tabId),
      () => true,
    ),
  ).rejects.toThrow("original browser tab or profile");
  const workspace = useCompanionSurfaceStore.getState().workspaces[scope];
  expect(workspace?.activeId).toBe(personal);
  expect(workspace?.tabs.find(({ id }) => id === work)?.url).toBe(originalUrl);
});

test("leaves the browser alone after the user leaves the thread during the receipt read", async () => {
  const { bridge, getBrowserSessionState } = mockBridge("browser");
  vi.stubGlobal("window", { desktopBridge: bridge });
  let current = true;
  getFigmaCanvasResult.mockImplementation(async () => {
    current = false;
    return receiptFor("browser");
  });

  await openSavedFigmaCanvasResult(
    environmentId,
    threadId,
    projectId,
    { operationId },
    () => current,
  );

  expect(getBrowserSessionState).not.toHaveBeenCalled();
});
