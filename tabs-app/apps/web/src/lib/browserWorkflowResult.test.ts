import { EnvironmentId, PreviewTabId, ProjectId, ThreadId } from "@tabs/contracts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import { useRightPanelStore } from "~/stores/rightPanelStore";
import { useWorkspaceShellStore } from "~/workspaceShellStore";
import {
  createBrowserWorkflowResultPresenter,
  openSavedBrowserWorkflowResult,
  readBrowserWorkflowReceipt,
  revealSavedBrowserWorkflowResult,
} from "./browserWorkflowResult";

const { add, environmentApi, getWorkflowResult } = vi.hoisted(() => ({
  add: vi.fn<(options: { title: string; actionProps?: { onClick: () => void } }) => void>(),
  environmentApi: vi.fn(),
  getWorkflowResult: vi.fn(),
}));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add } }));
vi.mock("~/connection/environmentApiRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/connection/environmentApiRegistry")>()),
  environmentApi,
  isPrimaryEnvironment: (id: string) => id === environmentId,
}));

const environmentId = EnvironmentId.make("desktop");
const threadId = ThreadId.make("thread-qa");
const projectId = ProjectId.make("project");
const scope = `${environmentId}:${threadId}`;
const url = "https://fixture.test/draft/42";
const request = {
  phase: "inspect",
  profileId: "work",
  definition: {
    url,
    resourceId: "42",
    identitySelector: "#id",
    statusSelector: "#status",
    submitSelector: "#submit",
    breakpoint: { selector: "#replace", clearText: "Clear", pauseText: "Replacing" },
    states: {
      uploaded: "Uploaded",
      submitted: "Submitted",
      certified: "Certified",
      published: "Published",
    },
  },
};
const initialShell = useWorkspaceShellStore.getState();
beforeEach(() => {
  add.mockClear();
  getWorkflowResult.mockReset();
  environmentApi.mockReset().mockResolvedValue({ preview: { getWorkflowResult } });
  useCompanionSurfaceStore.setState({ workspaces: {} });
  useRightPanelStore.getState().closePanel();
});
afterEach(() => {
  vi.unstubAllGlobals();
  useWorkspaceShellStore.setState(initialShell);
});

test("opens a paused draft in the original Work tab when Personal shows the same URL", async () => {
  const surfaces = useCompanionSurfaceStore.getState();
  const work = surfaces.open(scope, "browser", { url, profileId: "work" });
  const personal = surfaces.open(scope, "browser", { url, profileId: "personal" });
  const tabId = `agents-surface-${work}`;
  const state = {
    projectId,
    sessionId: tabId,
    currentUrl: url,
    profileId: "work",
    instanceId: "work",
    assignedTaskId: threadId,
  };
  const getBrowserSessionState = vi.fn().mockResolvedValue(state);
  const navigate = vi.fn().mockResolvedValue(undefined);
  const present = createBrowserWorkflowResultPresenter(
    { getBrowserSessionState } as unknown as NonNullable<Window["desktopBridge"]>,
    navigate,
  );
  const result = {
    target: { tabId, profileId: "work", projectId: "project", hostKey: "desktop-work" },
    disposition: "observed",
    observation: {
      stage: "uploaded",
      statusText: "Uploaded",
      breakpoint: "matched",
      submitAvailable: true,
    },
  };
  present(environmentId, threadId, request, result);
  present(environmentId, threadId, request, result);
  expect(add).toHaveBeenCalledTimes(1);
  expect(useCompanionSurfaceStore.getState().workspaces[scope]?.activeId).toBe(personal);
  expect(navigate).not.toHaveBeenCalled();
  const open = add.mock.calls[0]?.[0].actionProps?.onClick;
  expect(open).toBeDefined();
  open?.();
  await vi.waitFor(() =>
    expect(useCompanionSurfaceStore.getState().workspaces[scope]?.activeId).toBe(work),
  );
  expect(navigate).toHaveBeenCalledWith(environmentId, threadId);
  expect(getBrowserSessionState).toHaveBeenCalledWith({ projectId: "project", sessionId: tabId });
  expect(useRightPanelStore.getState().activeTab).toBe("browser");

  surfaces.activate(scope, personal);
  getBrowserSessionState.mockResolvedValueOnce({ ...state, profileId: "personal" });
  open?.();
  await vi.waitFor(() =>
    expect(add.mock.calls.at(-1)?.[0].title).toBe("The workflow page has moved"),
  );
  expect(useCompanionSurfaceStore.getState().workspaces[scope]?.activeId).toBe(personal);
});

test("restores only the original Work guest and accepts a newer receipt before activating it", async () => {
  const surfaces = useCompanionSurfaceStore.getState();
  const work = surfaces.open(scope, "browser", {
    url: "https://fixture.test/Work",
    profileId: "work",
  });
  const personal = surfaces.open(scope, "browser", { url, profileId: "personal" });
  const tabId = `agents-surface-${work}`;
  const target = {
    tabId: PreviewTabId.make(tabId),
    projectId: "project",
    hostKey: "desktop-work",
    profileId: "work",
  };
  const result = { target, definition: request.definition, stage: "uploaded" as const };
  const state = { projectId, sessionId: tabId, instanceId: "work-instance", profileId: "work" };
  const getBrowserSessionState = vi.fn().mockResolvedValue({ ...state, currentUrl: url });
  getBrowserSessionState.mockResolvedValueOnce({ projectId, sessionId: tabId, currentUrl: null });
  const ensureBrowserSession = vi.fn().mockResolvedValue(undefined);
  const runBrowserAutomation = vi
    .fn()
    .mockRejectedValueOnce(new Error("Draft identity changed"))
    .mockResolvedValue({ stage: "submitted" });
  const bridge = {
    getBrowserSessionState,
    ensureBrowserSession,
    runBrowserAutomation,
  } as unknown as NonNullable<Window["desktopBridge"]>;
  const open = () =>
    revealSavedBrowserWorkflowResult(
      bridge,
      environmentId,
      threadId,
      "project",
      result,
      () => true,
    );
  await expect(open()).rejects.toThrow("Draft identity changed");
  expect(useCompanionSurfaceStore.getState().workspaces[scope]?.activeId).toBe(personal);
  expect(ensureBrowserSession).toHaveBeenCalledExactlyOnceWith({
    projectId: "project",
    sessionId: tabId,
    profileId: "work",
    initialUrl: "",
  });
  await open();
  expect(ensureBrowserSession).toHaveBeenCalledTimes(1);
  expect(runBrowserAutomation).toHaveBeenLastCalledWith({
    projectId: "project",
    sessionId: tabId,
    source: "human",
    taskId: threadId,
    operation: "enterBrowserWorkflowResult",
    input: result,
  });
  expect(useCompanionSurfaceStore.getState().workspaces[scope]?.activeId).toBe(work);
  expect(
    useCompanionSurfaceStore.getState().workspaces[scope]?.tabs.find(({ id }) => id === work)?.url,
  ).toBe(url);
  surfaces.close(scope, work);
  await expect(open()).rejects.toThrow("original browser tab or profile");
  expect(runBrowserAutomation).toHaveBeenCalledTimes(2);
});

test("tells the user when the current breakpoint cannot be observed", () => {
  const present = createBrowserWorkflowResultPresenter(
    {} as NonNullable<Window["desktopBridge"]>,
    vi.fn(),
  );
  const result = {
    target: {
      tabId: "agents-surface-work",
      profileId: "work",
      projectId: "project",
      hostKey: "desktop-work",
    },
    disposition: "observed",
    observation: {
      stage: "uploaded",
      statusText: "Uploaded",
      breakpoint: "unobservable",
      submitAvailable: true,
    },
  };
  const sample = (breakpoint: string, statusOnly = false) =>
    present(
      environmentId,
      threadId,
      { ...request, statusOnly },
      { ...result, observation: { ...result.observation, breakpoint } },
    );
  sample("unobservable");
  sample("irrelevant", true);
  sample("unobservable");
  expect(add).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      title: "Browser breakpoint unavailable",
      description: "The condition needs one visible match with a known value. Submit is blocked.",
      actionProps: expect.objectContaining({ children: "Open draft" }),
    }),
  );
  sample("clear");
  sample("unobservable");
  expect(add).toHaveBeenCalledTimes(2);
});

const pending = { stage: "uploaded", pendingAction: "submit" } as const;
const manual = { stage: "uploaded", submitRequiresUser: true } as const;
const submitted = { stage: "submitted" } as const;
const toolbarTabId = PreviewTabId.make("custom-private-qa");
const toolbarToolId = "qa-work-browser";
const personalToolId = "qa-personal-browser";
const toolbarSaved = {
  target: { tabId: toolbarTabId, projectId, hostKey: "desktop-work", profileId: "work" },
  definition: request.definition,
  ...pending,
};
const toolbarState = {
  projectId,
  sessionId: toolbarTabId,
  profileId: "work",
  instanceId: "work-instance",
  assignedTaskId: threadId,
  currentUrl: url,
};
const toolbarReference = { workflowId: "b".repeat(64), ...pending };

function configureToolbar(profileId = "work") {
  const workspace = useWorkspaceShellStore.getState();
  workspace.openProject(projectId);
  workspace.upsertProjectSettings(projectId, (settings) => ({
    ...settings,
    tools: [
      ...settings.tools,
      {
        id: toolbarToolId,
        kind: "custom_embed",
        label: "Work",
        visible: true,
        customEmbedId: "private-qa",
      },
      {
        id: personalToolId,
        kind: "custom_embed",
        label: "Personal",
        visible: true,
        customEmbedId: "personal-qa",
      },
    ],
    customEmbeds: [
      {
        id: "private-qa",
        label: "Work",
        url,
        resumeLastVisitedPage: true,
        partitionMode: "profile",
        partitionProfile: profileId,
      },
      {
        id: "personal-qa",
        label: "Personal",
        url,
        resumeLastVisitedPage: true,
        partitionMode: "profile",
        partitionProfile: "personal",
      },
    ],
  }));
  workspace.setActiveTool(projectId, personalToolId);
}

test("recovers a lost Submit reply after restoring the original Work toolbar guest", async () => {
  configureToolbar();
  const before = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId];
  const getBrowserSessionState = vi
    .fn()
    .mockResolvedValueOnce({ projectId, sessionId: toolbarTabId, currentUrl: null })
    .mockResolvedValueOnce({ ...toolbarState, currentUrl: null, assignedTaskId: null })
    .mockResolvedValue(toolbarState);
  const ensureBrowserSession = vi.fn();
  const runBrowserAutomation = vi.fn().mockResolvedValue({
    target: toolbarSaved.target,
    stage: "submitted",
    statusText: "Submitted",
  });
  const bridge = {
    getBrowserSessionState,
    ensureBrowserSession,
    runBrowserAutomation,
  } as unknown as NonNullable<Window["desktopBridge"]>;
  vi.stubGlobal("window", { desktopBridge: bridge });
  getWorkflowResult.mockResolvedValueOnce(toolbarSaved).mockImplementationOnce(async () => {
    expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectId]).toBe(
      personalToolId,
    );
    expect(ensureBrowserSession).toHaveBeenCalledExactlyOnceWith({
      projectId,
      sessionId: toolbarTabId,
      initialUrl: "",
      partition: "persist:tabs-browser:profile:work",
    });
    const receipt = await readBrowserWorkflowReceipt(bridge, environmentId, projectId, {
      threadId,
      tabId: toolbarTabId,
      tabIdExplicit: true,
      input: toolbarSaved,
    });
    expect(receipt).toMatchObject({ target: toolbarSaved.target, stage: "submitted" });
    return { target: toolbarSaved.target, definition: request.definition, ...submitted };
  });

  await openSavedBrowserWorkflowResult(
    environmentId,
    threadId,
    projectId,
    toolbarReference,
    () => true,
  );

  expect(environmentApi).toHaveBeenCalledExactlyOnceWith(environmentId);
  expect(getWorkflowResult).toHaveBeenCalledTimes(2);
  expect(getWorkflowResult).toHaveBeenLastCalledWith({
    threadId,
    workflowId: toolbarReference.workflowId,
    stage: "uploaded",
    reconcileSubmission: true,
  });
  expect(runBrowserAutomation).toHaveBeenCalledExactlyOnceWith({
    projectId,
    sessionId: toolbarTabId,
    source: "human",
    taskId: threadId,
    operation: "readWorkflowReceipt",
    input: toolbarSaved,
  });
  const after = useWorkspaceShellStore.getState();
  expect(after.session.activeToolIdByProjectId[projectId]).toBe(toolbarToolId);
  expect(after.browserUrlBySessionKey[`${projectId}:${toolbarTabId}`]).toBe(url);
  expect(after.projectSettingsByProjectId[projectId]).toBe(before);
  expect(add).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ title: "The page shows submitted" }),
  );
});

test("rejects a toolbar profile mismatch before restoring a guest or reading a receipt", async () => {
  configureToolbar("personal");
  const before = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId];
  const getBrowserSessionState = vi.fn();
  const ensureBrowserSession = vi.fn();
  const runBrowserAutomation = vi.fn();
  const bridge = {
    getBrowserSessionState,
    ensureBrowserSession,
    runBrowserAutomation,
  } as unknown as NonNullable<Window["desktopBridge"]>;
  vi.stubGlobal("window", { desktopBridge: bridge });
  getWorkflowResult.mockResolvedValue(toolbarSaved);

  await expect(
    openSavedBrowserWorkflowResult(
      environmentId,
      threadId,
      projectId,
      toolbarReference,
      () => true,
    ),
  ).rejects.toThrow("original browser tab or profile");
  expect(() =>
    readBrowserWorkflowReceipt(bridge, environmentId, projectId, {
      threadId,
      tabId: toolbarTabId,
      tabIdExplicit: true,
      input: toolbarSaved,
    }),
  ).toThrow("original browser tab or profile");
  expect(getWorkflowResult).toHaveBeenCalledTimes(1);
  expect(getBrowserSessionState).not.toHaveBeenCalled();
  expect(ensureBrowserSession).not.toHaveBeenCalled();
  expect(runBrowserAutomation).not.toHaveBeenCalled();
  expect(useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId]).toBe(before);
  expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectId]).toBe(
    personalToolId,
  );
});

test.each([{ currentUrl: "https://fixture.test/draft/43" }, { instanceId: "replacement" }])(
  "rejects a toolbar guest change after reading the receipt: %j",
  async (changed) => {
    configureToolbar();
    const getBrowserSessionState = vi
      .fn()
      .mockResolvedValueOnce(toolbarState)
      .mockResolvedValueOnce({ ...toolbarState, ...changed });
    vi.stubGlobal("window", { desktopBridge: { getBrowserSessionState } });
    getWorkflowResult
      .mockResolvedValueOnce(toolbarSaved)
      .mockResolvedValueOnce({ ...toolbarSaved, ...submitted });

    await expect(
      openSavedBrowserWorkflowResult(
        environmentId,
        threadId,
        projectId,
        toolbarReference,
        () => true,
      ),
    ).rejects.toThrow("original browser tab or profile");
    expect(getWorkflowResult).toHaveBeenCalledTimes(2);
    expect(add).not.toHaveBeenCalled();
    expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectId]).toBe(
      personalToolId,
    );
  },
);

test("opens the paused draft only when the original toolbar guest retains its identity and owner", async () => {
  configureToolbar();
  const getBrowserSessionState = vi.fn().mockResolvedValue(toolbarState);
  const navigate = vi.fn().mockResolvedValue(undefined);
  const present = createBrowserWorkflowResultPresenter(
    { getBrowserSessionState } as unknown as NonNullable<Window["desktopBridge"]>,
    navigate,
  );
  present(
    environmentId,
    threadId,
    { ...request, target: toolbarSaved.target },
    {
      target: toolbarSaved.target,
      disposition: "observed",
      observation: {
        stage: "uploaded",
        statusText: "Uploaded",
        breakpoint: "matched",
        submitAvailable: true,
      },
    },
  );
  expect(add).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ title: "Browser workflow paused" }),
  );
  const open = add.mock.calls[0]?.[0].actionProps?.onClick;
  expect(open).toBeDefined();
  open?.();
  const activeTool = () =>
    useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectId];
  await vi.waitFor(() => expect(activeTool()).toBe(toolbarToolId));
  expect(navigate).toHaveBeenCalledExactlyOnceWith(environmentId, threadId);
  expect(getBrowserSessionState).toHaveBeenCalledWith({ projectId, sessionId: toolbarTabId });

  useWorkspaceShellStore.getState().setActiveTool(projectId, personalToolId);
  add.mockClear();
  getBrowserSessionState.mockResolvedValueOnce({ ...toolbarState, assignedTaskId: null });
  open?.();
  await vi.waitFor(() =>
    expect(add).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: "The workflow page has moved" }),
    ),
  );
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(activeTool()).toBe(personalToolId);

  for (const changed of [
    { currentUrl: "https://fixture.test/draft/43" },
    { instanceId: "replacement" },
    { profileId: "personal" },
    { assignedTaskId: "another-thread" },
    { assignedTaskId: null },
  ]) {
    add.mockClear();
    getBrowserSessionState
      .mockResolvedValueOnce(toolbarState)
      .mockResolvedValueOnce({ ...toolbarState, ...changed });
    open?.();
    await vi.waitFor(() =>
      expect(add).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ title: "The workflow page has moved" }),
      ),
    );
    expect(activeTool()).toBe(personalToolId);
  }
});

const resolvedDraftUrl = `${url}?draft=first#review`;
const pausedDraft = {
  target: toolbarSaved.target,
  disposition: "observed",
  observation: {
    stage: "uploaded",
    statusText: "Uploaded",
    breakpoint: "matched",
    submitAvailable: true,
  },
  resolvedDraftUrl,
};

test("the initial pause opens its original toolbar tab from another project", async () => {
  configureToolbar();
  const workspace = useWorkspaceShellStore.getState();
  const otherProject = ProjectId.make("other-project");
  const originalSettings = workspace.projectSettingsByProjectId[projectId];
  if (!originalSettings) throw new Error("Missing original toolbar settings");
  const state = { ...toolbarState, currentUrl: resolvedDraftUrl };
  const getBrowserSessionState = vi.fn().mockResolvedValue(state);
  const navigate = vi.fn().mockResolvedValue(undefined);
  const present = createBrowserWorkflowResultPresenter(
    { getBrowserSessionState } as unknown as NonNullable<Window["desktopBridge"]>,
    navigate,
  );
  present(environmentId, threadId, request, pausedDraft);
  workspace.openProject(otherProject);
  workspace.upsertProjectSettings(otherProject, () => originalSettings);
  workspace.setActiveTool(otherProject, personalToolId);

  const open = add.mock.calls[0]?.[0].actionProps?.onClick;
  expect(open).toBeDefined();
  open?.();
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith(environmentId, threadId));
  // The workspace applies the route after the router's navigation promise resolves.
  expect(getBrowserSessionState).toHaveBeenCalledTimes(1);
  workspace.openProjectSurface(projectId, "agents", threadId);

  await vi.waitFor(() =>
    expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectId]).toBe(
      toolbarToolId,
    ),
  );
  const after = useWorkspaceShellStore.getState();
  expect(getBrowserSessionState.mock.calls).toEqual([
    [{ projectId, sessionId: toolbarTabId }],
    [{ projectId, sessionId: toolbarTabId }],
  ]);
  expect(after.session.activeToolIdByProjectId[otherProject]).toBe(personalToolId);
  expect(after.browserUrlBySessionKey[`${projectId}:${toolbarTabId}`]).toBe(resolvedDraftUrl);
  expect(after.browserUrlBySessionKey[`${otherProject}:${toolbarTabId}`]).toBeUndefined();
  expect(add).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ title: "Browser workflow paused" }),
  );
});

test("binds the initial pause to the resolved draft and rejects a sibling at the same public path", async () => {
  configureToolbar();
  const state = { ...toolbarState, currentUrl: resolvedDraftUrl };
  const sibling = { ...state, currentUrl: `${url}?draft=second#review` };
  const getBrowserSessionState = vi.fn().mockResolvedValue(state);
  const navigate = vi.fn().mockResolvedValue(undefined);
  const present = createBrowserWorkflowResultPresenter(
    { getBrowserSessionState } as unknown as NonNullable<Window["desktopBridge"]>,
    navigate,
  );
  present(environmentId, threadId, request, pausedDraft);
  present(environmentId, threadId, request, pausedDraft);
  expect(add).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      title: "Browser workflow paused",
      description: request.definition.breakpoint.pauseText,
      actionProps: expect.objectContaining({ children: "Open draft" }),
    }),
  );

  const open = add.mock.calls[0]?.[0].actionProps?.onClick;
  expect(open).toBeDefined();
  const activeTool = () =>
    useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectId];
  open?.();
  await vi.waitFor(() => expect(activeTool()).toBe(toolbarToolId));
  expect(
    useWorkspaceShellStore.getState().browserUrlBySessionKey[`${projectId}:${toolbarTabId}`],
  ).toBe(resolvedDraftUrl);

  useWorkspaceShellStore.getState().setActiveTool(projectId, personalToolId);
  const moved = expect.objectContaining({ title: "The workflow page has moved" });
  getBrowserSessionState.mockResolvedValueOnce(sibling);
  open?.();
  await vi.waitFor(() => expect(add).toHaveBeenLastCalledWith(moved));
  expect(navigate).toHaveBeenCalledExactlyOnceWith(environmentId, threadId);
  expect(activeTool()).toBe(personalToolId);

  add.mockClear();
  getBrowserSessionState.mockResolvedValueOnce(state).mockResolvedValueOnce(sibling);
  open?.();
  await vi.waitFor(() => expect(add).toHaveBeenCalledExactlyOnceWith(moved));
  expect(activeTool()).toBe(personalToolId);

  present(environmentId, threadId, request, {
    ...pausedDraft,
    resolvedDraftUrl: sibling.currentUrl,
  });
  expect(add).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: "Browser workflow paused" }),
  );
  expect(add).toHaveBeenCalledTimes(2);
});

test("presents read-only stage changes without an action request and opens the verified draft", async () => {
  configureToolbar();
  const { url, identitySelector, resourceId, statusSelector } = request.definition;
  const definition = {
    url,
    identitySelector,
    resourceId,
    statusSelector,
    readOnly: true as const,
    states: { ready_to_upload: "Ready to upload", uploaded: "Uploaded" },
  };
  const target = toolbarSaved.target;
  const getBrowserSessionState = vi.fn().mockResolvedValue(toolbarState);
  const navigate = vi.fn().mockResolvedValue(undefined);
  const present = createBrowserWorkflowResultPresenter(
    { getBrowserSessionState } as unknown as NonNullable<Window["desktopBridge"]>,
    navigate,
  );
  const observed = {
    target,
    disposition: "observed",
    submissionApproved: false,
    observation: {
      stage: "uploaded",
      statusText: "Uploaded",
      breakpoint: "irrelevant",
      submitAvailable: false,
    },
  };
  present(environmentId, threadId, { ...request, definition }, observed);
  expect(add).not.toHaveBeenCalled();

  const watch = {
    ...request,
    phase: "monitor",
    definition,
    target,
    workflowId: toolbarReference.workflowId,
    statusOnly: true,
    lastVerifiedStage: "ready_to_upload",
  };
  present(environmentId, threadId, watch, {
    ...observed,
    observation: { ...observed.observation, statusText: "Unknown status" },
  });
  expect(add).not.toHaveBeenCalled();
  present(environmentId, threadId, watch, observed);
  present(environmentId, threadId, watch, observed);
  expect(add).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ title: "The page shows uploaded" }),
  );
  add.mock.calls[0]?.[0].actionProps?.onClick?.();
  await vi.waitFor(() =>
    expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectId]).toBe(
      toolbarToolId,
    ),
  );
  expect(navigate).toHaveBeenCalledExactlyOnceWith(environmentId, threadId);
});

test.each([
  [
    "another origin",
    request,
    { ...pausedDraft, resolvedDraftUrl: "https://other.test/draft/42?draft=first" },
  ],
  [
    "another path",
    request,
    { ...pausedDraft, resolvedDraftUrl: "https://fixture.test/draft/43?draft=first" },
  ],
  [
    "a different explicit query",
    { ...request, definition: { ...request.definition, url: `${url}?draft=explicit` } },
    pausedDraft,
  ],
  [
    "a different explicit fragment",
    { ...request, definition: { ...request.definition, url: `${url}#explicit` } },
    pausedDraft,
  ],
  ["a targeted inspect", { ...request, target: pausedDraft.target }, pausedDraft],
  ["a saved workflow", { ...request, workflowId: toolbarReference.workflowId }, pausedDraft],
  ["a later phase", { ...request, phase: "enter" }, pausedDraft],
  ["a malformed URL", request, { ...pausedDraft, resolvedDraftUrl: "/draft/42?draft=first" }],
  ["a response without an observation", request, { ...pausedDraft, observation: undefined }],
  ["an unsuccessful response", request, { ...pausedDraft, disposition: "unobservable" }],
] as const)("declines a resolved URL supplied for %s", (_, input, result) => {
  configureToolbar();
  const getBrowserSessionState = vi
    .fn()
    .mockResolvedValue({ ...toolbarState, currentUrl: input.definition.url });
  const navigate = vi.fn().mockResolvedValue(undefined);
  const present = createBrowserWorkflowResultPresenter(
    { getBrowserSessionState } as unknown as NonNullable<Window["desktopBridge"]>,
    navigate,
  );
  present(environmentId, threadId, input, result);
  expect(add).not.toHaveBeenCalled();
  expect(getBrowserSessionState).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});

test.each([
  [pending, pending, "Submission outcome still unverified"],
  [pending, submitted, "The page shows submitted"],
  [manual, manual, "Submit in the original draft"],
  [manual, submitted, "The page shows submitted"],
  [manual, pending, "Submission outcome still unverified"],
] as const)("reconciles saved submission state from %j to %j", async (before, after, title) => {
  const work = useCompanionSurfaceStore
    .getState()
    .open(scope, "browser", { url, profileId: "work" });
  const tabId = PreviewTabId.make(`agents-surface-${work}`);
  const saved = {
    target: { tabId, projectId: "project", hostKey: "desktop-work", profileId: "work" },
    definition: request.definition,
  };
  getWorkflowResult
    .mockResolvedValueOnce({ ...saved, ...before })
    .mockResolvedValueOnce({ ...saved, ...after });
  const workflowId = "a".repeat(64);
  const runBrowserAutomation = vi.fn();
  const previousWindow = globalThis.window;
  vi.stubGlobal("window", {
    ...previousWindow,
    desktopBridge: {
      getBrowserSessionState: vi.fn().mockResolvedValue({
        projectId,
        sessionId: tabId,
        currentUrl: url,
        instanceId: "work",
        profileId: "work",
      }),
      runBrowserAutomation,
    },
  });
  try {
    await openSavedBrowserWorkflowResult(
      environmentId,
      threadId,
      "project",
      { workflowId, stage: "uploaded" },
      () => true,
    );
    expect(getWorkflowResult).toHaveBeenCalledTimes(2);
    expect(getWorkflowResult).toHaveBeenNthCalledWith(1, {
      threadId,
      workflowId,
      stage: "uploaded",
    });
    expect(getWorkflowResult).toHaveBeenLastCalledWith({
      threadId,
      workflowId,
      stage: "uploaded",
      reconcileSubmission: true,
    });
    expect(runBrowserAutomation).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title }));
    if ("submitRequiresUser" in after) {
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining("The original draft still shows Uploaded."),
        }),
      );
    }
  } finally {
    vi.unstubAllGlobals();
  }
});

const uploadReference = {
  workflowId: toolbarReference.workflowId,
  stage: "ready_to_upload",
  pendingAction: "upload",
} as const;
const uploadDraft = {
  target: toolbarSaved.target,
  definition: {
    ...request.definition,
    uploadInputSelector: "#package",
    states: { ...request.definition.states, ready_to_upload: "Ready to upload" },
  },
};
const uploadLookup = {
  threadId,
  workflowId: uploadReference.workflowId,
  stage: uploadReference.stage,
};
const pendingUpload = {
  ...uploadDraft,
  stage: "ready_to_upload",
  pendingAction: "upload",
} as const;
const verifiedUpload = { ...uploadDraft, stage: "uploaded" } as const;

test.each([
  {
    receipt: pendingUpload,
    reference: uploadReference,
    toast: {
      type: "warning",
      title: "Upload outcome still unverified",
      description:
        "The original draft still shows Ready to upload. If the transfer has ended, reload the draft and check again.",
    },
  },
  {
    receipt: verifiedUpload,
    reference: { workflowId: uploadReference.workflowId, stage: "uploaded" },
    toast: { type: "info", title: "The page shows uploaded", description: "42 · work" },
  },
] as const)(
  "checks a pending upload whose receipt reports $receipt.stage",
  async ({ receipt, reference, toast }) => {
    configureToolbar();
    const runBrowserAutomation = vi.fn();
    vi.stubGlobal("window", {
      desktopBridge: {
        getBrowserSessionState: vi.fn().mockResolvedValue(toolbarState),
        runBrowserAutomation,
      },
    });
    getWorkflowResult.mockResolvedValueOnce(pendingUpload).mockResolvedValueOnce(receipt);

    await expect(
      openSavedBrowserWorkflowResult(
        environmentId,
        threadId,
        projectId,
        uploadReference,
        () => true,
      ),
    ).resolves.toStrictEqual(reference);

    expect(getWorkflowResult.mock.calls).toEqual([
      [uploadLookup],
      [{ ...uploadLookup, reconcileSubmission: true }],
    ]);
    expect(runBrowserAutomation).not.toHaveBeenCalled();
    expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectId]).toBe(
      toolbarToolId,
    );
    expect(add).toHaveBeenCalledExactlyOnceWith(toast);
  },
);

test("opens a stale upload link without reconciling a later pending Submit", async () => {
  configureToolbar();
  const runBrowserAutomation = vi.fn().mockResolvedValue({ stage: "uploaded" });
  vi.stubGlobal("window", {
    desktopBridge: {
      getBrowserSessionState: vi.fn().mockResolvedValue(toolbarState),
      runBrowserAutomation,
    },
  });
  getWorkflowResult.mockResolvedValueOnce({ ...uploadDraft, ...pending });

  await expect(
    openSavedBrowserWorkflowResult(environmentId, threadId, projectId, uploadReference, () => true),
  ).resolves.toStrictEqual({ workflowId: uploadReference.workflowId, ...pending });

  expect(getWorkflowResult).toHaveBeenCalledExactlyOnceWith(uploadLookup);
  expect(runBrowserAutomation).toHaveBeenCalledExactlyOnceWith({
    projectId,
    sessionId: toolbarTabId,
    source: "human",
    taskId: threadId,
    operation: "enterBrowserWorkflowResult",
    input: verifiedUpload,
  });
  expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectId]).toBe(
    toolbarToolId,
  );
  expect(add).toHaveBeenCalledExactlyOnceWith({
    type: "info",
    title: "The page shows uploaded",
    description: "42 · work",
  });
});

test("announces a verified stage only for a workflow with a saved target", () => {
  const present = createBrowserWorkflowResultPresenter(
    {} as NonNullable<Window["desktopBridge"]>,
    vi.fn(),
  );
  const target = {
    tabId: "agents-surface-work",
    profileId: "work",
    projectId: "project",
    hostKey: "desktop-work",
  };
  const result = {
    target,
    disposition: "observed",
    observation: {
      stage: "submitted",
      statusText: "Submitted",
      breakpoint: "irrelevant",
      submitAvailable: false,
    },
  };
  present(environmentId, threadId, request, result);
  expect(add).not.toHaveBeenCalled();
  present(environmentId, threadId, { ...request, target, statusOnly: true }, result);
  expect(add).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ title: "The page shows submitted" }),
  );
});

test("skips approval and status toasts for pre-dispatch observations", () => {
  const present = createBrowserWorkflowResultPresenter(
    {} as NonNullable<Window["desktopBridge"]>,
    vi.fn(),
  );
  const target = toolbarSaved.target;
  const upload = {
    ...request,
    phase: "upload",
    target,
    definition: {
      ...request.definition,
      uploadSelector: "#upload",
      states: { ...request.definition.states, ready_to_upload: "Ready to upload" },
    },
  };
  present(environmentId, threadId, upload, {
    target,
    disposition: "dispatched",
    submissionApproved: false,
    observation: {
      stage: "ready_to_upload",
      statusText: "Ready to upload",
      breakpoint: "clear",
      submitAvailable: false,
      uploadAvailable: true,
    },
  });
  const submit = { ...upload, phase: "submit" };
  const result = {
    target,
    disposition: "dispatched",
    submissionApproved: false,
    observation: {
      stage: "uploaded",
      statusText: "Uploaded",
      breakpoint: "clear",
      submitAvailable: true,
    },
  };
  present(environmentId, threadId, submit, result);
  expect(add).not.toHaveBeenCalled();

  present(
    environmentId,
    threadId,
    { ...submit, phase: "inspect", statusOnly: true },
    {
      ...result,
      disposition: "observed",
    },
  );
  expect(add).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ title: "The page shows uploaded" }),
  );
});

test.each([
  [{ submitAvailable: true }, "Submission needs your approval", "Approve one submission"],
  [
    { submitAvailable: false, submitRequiresUser: true },
    "Submit in the original draft",
    "The site did not provide a submission key.",
  ],
] as const)("offers to open the original draft for %j", (submission, title, detail) => {
  const present = createBrowserWorkflowResultPresenter(
    {} as NonNullable<Window["desktopBridge"]>,
    vi.fn(),
  );
  const result = {
    target: {
      tabId: "agents-surface-work",
      profileId: "work",
      projectId: "project",
      hostKey: "desktop-work",
    },
    disposition: "observed",
    submissionApproved: false,
    observation: {
      stage: "uploaded",
      statusText: "Uploaded",
      breakpoint: "clear",
      ...submission,
    },
  };
  if (!("submitRequiresUser" in submission)) {
    present(environmentId, threadId, request, result);
    expect(add).not.toHaveBeenCalled();
  }
  present(environmentId, threadId, { ...request, target: result.target, statusOnly: true }, result);
  expect(add).not.toHaveBeenCalled();
  present(environmentId, threadId, { ...request, target: result.target }, result);
  present(environmentId, threadId, { ...request, target: result.target }, result);
  expect(add).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      title,
      description: expect.stringContaining(detail),
      actionProps: expect.objectContaining({ children: "Open draft" }),
    }),
  );
});

test("announces only a newer stage during a background watch", () => {
  const present = createBrowserWorkflowResultPresenter(
    {} as NonNullable<Window["desktopBridge"]>,
    vi.fn(),
  );
  const target = {
    tabId: "agents-surface-work",
    profileId: "work",
    projectId: "project",
    hostKey: "desktop-work",
  };
  const monitor = {
    ...request,
    target,
    phase: "monitor",
    statusOnly: true,
    lastVerifiedStage: "certified",
  };
  const result = {
    target,
    disposition: "observed",
    observation: {
      stage: "certified",
      statusText: "Certified",
      breakpoint: "irrelevant",
      submitAvailable: false,
    },
  };
  present(environmentId, threadId, monitor, result);
  expect(add).not.toHaveBeenCalled();
  const updated = {
    ...result,
    observation: { ...result.observation, stage: "published", statusText: "Published" },
  };
  present(environmentId, threadId, monitor, updated);
  present(environmentId, threadId, monitor, updated);
  expect(add).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      title: "The page shows published",
      actionProps: expect.objectContaining({ children: "Open draft" }),
    }),
  );
});
