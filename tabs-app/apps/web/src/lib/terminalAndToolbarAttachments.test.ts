import { EnvironmentId, ProjectId, ThreadId, type TerminalSummary } from "@tabs/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useComposerDraftStore } from "~/composerDraftStore";
import { appAtomRegistry } from "~/state/atomRegistry";
import { scopedComposerThreadId } from "~/state/composerDrafts";
import { readModelStateAtom } from "~/state/readModel";
import { clientSettingsAtom } from "~/state/settings";
import { getThreadTerminalState, terminalActions } from "~/state/terminal";
import { useRightPanelStore } from "~/stores/rightPanelStore";
import { closeWorkspaceTool } from "~/temporaryWorkspaceTools";
import { useWorkspaceShellStore } from "~/workspaceShellStore";
import {
  projectBrowserAttachmentTarget,
  projectToolAttachmentTarget,
} from "./projectToolAttachmentTargets";
import { emptyBrowserState } from "~/components/agents/companion/browserSession";
import {
  addSurfaceFileToDraft,
  openSurfaceAttachment,
  prepareDroppedSurfaceAttachment,
  projectToolSurfaceAttachmentFile,
  revealSurfaceReference,
  selectedNativeWindowAttachmentFile,
  validateSurfaceFileLocation,
} from "./threadSurfaceAttachment";

const projectId = ProjectId.make("attachment-project");
const location = {
  environmentId: EnvironmentId.make("attachment-environment"),
  threadId: ThreadId.make("attachment-thread"),
  projectId,
};
const project = {
  id: projectId,
  environmentId: location.environmentId,
  name: "QA project",
  cwd: "/workspace",
  defaultModelSelection: null,
  expanded: true,
  scripts: [],
};
const { onMetadata, createUrl, nativeComputer, confirm } = vi.hoisted(() => ({
  nativeComputer: vi.fn(),
  onMetadata: vi.fn(),
  createUrl: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("./customConfirm", () => ({ showCustomConfirm: confirm }));
vi.mock("~/connection/environmentApiRegistry", () => ({
  environmentApi: async () => ({
    terminal: { onMetadata },
    assets: { createUrl },
    server: { nativeComputer },
  }),
  isPrimaryEnvironment: (environmentId: string) => environmentId === "attachment-environment",
}));

beforeEach(() => {
  vi.stubGlobal("window", {});
  appAtomRegistry.update(readModelStateAtom, (state) => ({ ...state, projects: [project] }));
  useWorkspaceShellStore.setState(useWorkspaceShellStore.getInitialState());
  useComposerDraftStore.setState({ draftsByThreadId: {} });
  useWorkspaceShellStore.getState().setActiveProject(projectId);
});

afterEach(() => {
  terminalActions.clear(location.threadId);
  vi.unstubAllGlobals();
});

function addPrivateTool() {
  const id = "private-tool";
  useWorkspaceShellStore.getState().upsertProjectSettings(projectId, (settings) => ({
    ...settings,
    tools: [
      ...settings.tools,
      {
        id,
        label: "Private QA",
        kind: "custom_embed",
        visible: true,
        customEmbedId: id,
      },
    ],
    customEmbeds: [
      {
        id,
        label: "Private QA",
        url: "https://private.test/app?token=secret",
        partitionMode: "profile",
        partitionProfile: "Work",
        resumeLastVisitedPage: true,
      },
    ],
  }));
  return id;
}

it("hands off an unfamiliar project toolbar app and rejects it after the tool is recycled", async () => {
  const id = addPrivateTool();
  const attachment = projectToolAttachmentTarget(location, id, [], undefined)!;
  const file = projectToolSurfaceAttachmentFile(location, attachment);
  expect(file.name).toContain("Private QA");
  expect(await file.text()).not.toContain("token");
  addSurfaceFileToDraft(location, file);
  const draftKey = scopedComposerThreadId(location.environmentId, location.threadId);
  const [draftFile] = useComposerDraftStore.getState().draftsByThreadId[draftKey]!.files;
  expect(draftFile!.file).toBe(file);
  await validateSurfaceFileLocation(location, file);
  await expect(
    validateSurfaceFileLocation({ ...location, projectId: "other" }, file),
  ).rejects.toThrow("original");
  await expect(
    validateSurfaceFileLocation({ ...location, environmentId: EnvironmentId.make("other") }, file),
  ).rejects.toThrow("original");

  const current = useWorkspaceShellStore.getState();
  const reference = JSON.parse(await file.text());
  createUrl.mockResolvedValue({ relativeUrl: "https://assets.test/surface" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(file)),
  );
  await openSurfaceAttachment(location, draftFile!);
  expect(createUrl).toHaveBeenCalledWith({
    resource: expect.objectContaining({ attachmentId: draftFile!.id, fileName: file.name }),
  });
  expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectId]).toBe(id);
  appAtomRegistry.update(readModelStateAtom, (state) => ({
    ...state,
    projects: [{ ...project, environmentId: EnvironmentId.make("other") }],
  }));
  await expect(revealSurfaceReference(location, reference)).rejects.toThrow("identity");
  appAtomRegistry.update(readModelStateAtom, (state) => ({ ...state, projects: [project] }));
  current.upsertProjectSettings(projectId, (settings) => closeWorkspaceTool(settings, id));
  await expect(revealSurfaceReference(location, reference)).rejects.toThrow("closed");
  current.upsertProjectSettings(projectId, (settings) => ({
    ...settings,
    tools: settings.tools.map((tool) => (tool.id === id ? { ...tool, visible: true } : tool)),
  }));
  const reopened = projectToolAttachmentTarget(location, id, [], undefined)!;
  expect(reopened.target.instanceId).not.toBe(attachment.target.instanceId);
  await expect(revealSurfaceReference(location, reference)).rejects.toThrow("closed");
});

it("reveals the exact terminal and rejects a recycled PTY even when the ID and PID match", async () => {
  terminalActions.new(location.threadId, "first");
  terminalActions.new(location.threadId, "second");
  let terminals: TerminalSummary[] = [
    {
      threadId: location.threadId,
      terminalId: "first",
      instanceId: "original-pty",
      cwd: "/workspace",
      worktreePath: null,
      status: "running",
      pid: 1234,
      exitCode: null,
      exitSignal: null,
      hasRunningSubprocess: false,
      label: "Terminal",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];
  onMetadata.mockImplementation((callback) => {
    callback({ type: "snapshot", terminals });
    return () => {};
  });
  const reference = {
    version: 1,
    ...location,
    target: {
      kind: "terminal",
      threadId: location.threadId,
      terminalId: "first",
      instanceId: "original-pty",
    },
  };
  await revealSurfaceReference(location, reference);
  expect(getThreadTerminalState(location.threadId).activeTerminalId).toBe("first");
  expect(useRightPanelStore.getState().activeTab).toBe("terminal");
  terminalActions.setActive(location.threadId, "second");
  terminals = [{ ...terminals[0]!, instanceId: "new-pty" }];
  await expect(revealSurfaceReference(location, reference)).rejects.toThrow("restarted");
  terminals = [];
  await expect(revealSurfaceReference(location, reference)).rejects.toThrow("closed");
  expect(getThreadTerminalState(location.threadId).activeTerminalId).toBe("second");
});

it("rejects a replaced browser instance even when its toolbar entry, origin and profile still match", async () => {
  const id = addPrivateTool();
  const browser = {
    sessionId: `custom-${id}`,
    instanceId: "original-browser",
    profileId: "Work",
    currentUrl: "https://private.test/app",
  };
  vi.stubGlobal("window", {
    desktopBridge: { getBrowserSessionState: async () => browser },
  });
  const attachment = projectToolAttachmentTarget(
    location,
    id,
    [],
    new Map([
      [
        browser.sessionId,
        {
          kind: "browser",
          tabId: browser.sessionId,
          instanceId: browser.instanceId,
          profileId: browser.profileId,
          origin: "https://private.test",
        },
      ],
    ]),
  )!;
  const reference = JSON.parse(await projectToolSurfaceAttachmentFile(location, attachment).text());
  await revealSurfaceReference(location, reference);
  browser.instanceId = "new-browser";
  await expect(revealSurfaceReference(location, reference)).rejects.toThrow("identity");
});

it("returns a private toolbar attachment to its original page using its live instance and profile", async () => {
  const id = addPrivateTool();
  const sessionId = `custom-${id}`;
  const browser = {
    ...emptyBrowserState(projectId, sessionId),
    instanceId: "original-browser",
    profileId: "Work",
    currentUrl: "https://private.test/design?token=hidden",
    pageRef: "a".repeat(64),
  };
  const original = { ...browser };
  const runBrowserAutomation = vi.fn(async () => {
    Object.assign(browser, original);
  });
  vi.stubGlobal("window", {
    desktopBridge: { getBrowserSessionState: async () => browser, runBrowserAutomation },
  });
  const attachment = projectToolAttachmentTarget(
    location,
    id,
    [],
    new Map([[sessionId, projectBrowserAttachmentTarget(browser)]]),
  )!;
  const file = projectToolSurfaceAttachmentFile(location, attachment);
  expect(await file.text()).not.toContain("token");
  const reference = JSON.parse(await file.text());
  browser.currentUrl = "https://private.test/settings";
  browser.pageRef = "b".repeat(64);
  await revealSurfaceReference(location, reference);
  expect(runBrowserAutomation).toHaveBeenCalledExactlyOnceWith({
    projectId,
    sessionId,
    taskId: location.threadId,
    source: "human",
    operation: "enterAttachedPage",
    input: { pageRef: "a".repeat(64), profileId: "Work" },
  });
  expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectId]).toBe(id);
});

it("attaches an open Work toolbar draft with the exact comparison destination", async () => {
  const id = addPrivateTool();
  const sessionId = `custom-${id}`;
  const browser = {
    ...emptyBrowserState(projectId, sessionId),
    instanceId: "18716f00-784c-454b-be80-efca5573143c",
    profileId: "Work",
    currentUrl: "https://private.test/checklist?account=private",
    pageRef: "a".repeat(64),
    pageApprovalToken: "reviewed-toolbar-draft",
  };
  const runBrowserAutomation = vi.fn(async () => ({ attachmentId: null }));
  vi.stubGlobal("window", {
    desktopBridge: { getBrowserSessionState: async () => browser, runBrowserAutomation },
  });
  const target = projectToolAttachmentTarget(
    location,
    id,
    [],
    new Map([[sessionId, projectBrowserAttachmentTarget(browser)]]),
  )!;
  const file = projectToolSurfaceAttachmentFile(location, target);
  confirm.mockClear().mockResolvedValue(true);
  const attachment = await prepareDroppedSurfaceAttachment(location, file);
  expect(confirm).toHaveBeenCalledExactlyOnceWith(
    "Allow this conversation to read and act on all pages of https://private.test in the Work profile?",
  );
  expect(runBrowserAutomation.mock.calls).toEqual([
    [
      {
        projectId,
        sessionId,
        source: "human",
        taskId: location.threadId,
        operation: "authorizeBrowserPage",
        input: {
          url: browser.currentUrl,
          profileId: "Work",
          instanceId: browser.instanceId,
          pageApprovalToken: browser.pageApprovalToken,
        },
      },
    ],
    [
      {
        projectId,
        sessionId,
        source: "human",
        taskId: location.threadId,
        operation: "captureAttachedPage",
        input: { pageRef: browser.pageRef, profileId: "Work", instanceId: browser.instanceId },
      },
    ],
  ]);
  const text = await attachment!.text();
  expect(text).not.toContain("account=");
  const reference = JSON.parse(text);
  expect(reference.evidenceDestination).toEqual({
    tabId: sessionId,
    profileId: "Work",
    pageRef: browser.pageRef,
    instanceId: browser.instanceId,
  });
  expect(reference.target.instanceId).not.toEqual(reference.evidenceDestination.instanceId);

  browser.assignedTaskId = ThreadId.make("owning-thread");
  await expect(prepareDroppedSurfaceAttachment(location, file)).rejects.toThrow("owning thread");
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(runBrowserAutomation).toHaveBeenCalledTimes(2);
});

it("reviews a released project browser for the receiving conversation and saves a fresh receipt", async () => {
  const id = addPrivateTool();
  const sessionId = `custom-${id}`;
  const destination = { ...location, threadId: ThreadId.make("receiving-thread") };
  const browser = {
    ...emptyBrowserState(projectId, sessionId),
    instanceId: "18716f00-784c-454b-be80-efca5573143c",
    profileId: "Work",
    currentUrl: "https://private.test/checklist?account=private",
    pageRef: "a".repeat(64),
    pageApprovalToken: "reviewed-toolbar-draft",
    assignedTaskId: location.threadId as ThreadId | null,
  };
  const attachmentId = "9953a60f-1f5c-49f1-a1dd-43f976e4bece";
  const runBrowserAutomation = vi.fn(async () => ({ attachmentId }));
  vi.stubGlobal("window", {
    desktopBridge: { getBrowserSessionState: async () => browser, runBrowserAutomation },
  });
  const target = projectToolAttachmentTarget(
    location,
    id,
    [],
    new Map([[sessionId, projectBrowserAttachmentTarget(browser)]]),
  )!;
  const file = projectToolSurfaceAttachmentFile(location, target);
  confirm.mockReset();
  await expect(prepareDroppedSurfaceAttachment(destination, file)).rejects.toThrow("owning thread");
  expect(confirm).not.toHaveBeenCalled();

  browser.assignedTaskId = null;
  confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await expect(prepareDroppedSurfaceAttachment(destination, file)).resolves.toBeNull();
  expect(runBrowserAutomation).not.toHaveBeenCalled();
  const prepared = (await prepareDroppedSurfaceAttachment(destination, file))!;
  await validateSurfaceFileLocation(destination, prepared);
  expect(confirm).toHaveBeenLastCalledWith(
    "Allow this conversation to read and act on all pages of https://private.test in the Work profile?",
  );
  expect(runBrowserAutomation.mock.calls).toEqual([
    [
      expect.objectContaining({
        projectId,
        sessionId,
        taskId: destination.threadId,
        operation: "authorizeBrowserPage",
        input: {
          url: browser.currentUrl,
          profileId: "Work",
          instanceId: browser.instanceId,
          pageApprovalToken: browser.pageApprovalToken,
        },
      }),
    ],
    [
      expect.objectContaining({
        projectId,
        sessionId,
        taskId: destination.threadId,
        operation: "captureAttachedPage",
        input: { pageRef: browser.pageRef, profileId: "Work", instanceId: browser.instanceId },
      }),
    ],
  ]);
  const text = await prepared.text();
  expect(text).not.toContain("account=");
  expect(JSON.parse(text)).toMatchObject({
    threadId: destination.threadId,
    target: target.target,
    attachmentId,
    evidenceDestination: {
      tabId: sessionId,
      profileId: "Work",
      pageRef: browser.pageRef,
      instanceId: browser.instanceId,
    },
  });

  await expect(prepareDroppedSurfaceAttachment(location, prepared)).rejects.toThrow("original");
  await expect(
    prepareDroppedSurfaceAttachment({ ...destination, projectId: "other" }, file),
  ).rejects.toThrow("original");
  browser.pageRef = "b".repeat(64);
  await expect(prepareDroppedSurfaceAttachment(destination, file)).rejects.toThrow(
    "page or account changed",
  );
  browser.pageRef = "a".repeat(64);

  confirm.mockImplementationOnce(async () => {
    useWorkspaceShellStore
      .getState()
      .upsertProjectSettings(projectId, (settings) => closeWorkspaceTool(settings, id));
    return true;
  });
  await expect(prepareDroppedSurfaceAttachment(destination, file)).rejects.toThrow("tool changed");
  expect(runBrowserAutomation).toHaveBeenCalledTimes(2);
});

it("uses the shared toolbar identity on the first drop into an already-open window", async () => {
  const id = addPrivateTool();
  const sessionId = `custom-${id}`;
  const destination = { ...location, threadId: ThreadId.make("already-open-thread") };
  const beforeFirstDrag = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId]!;
  const { storage, name } = useWorkspaceShellStore.persist.getOptions();
  expect(storage && name).toBeTruthy();
  const browser = {
    ...emptyBrowserState(projectId, sessionId),
    instanceId: "18716f00-784c-454b-be80-efca5573143c",
    profileId: "Work",
    currentUrl: "https://private.test/checklist",
    pageRef: "a".repeat(64),
    pageApprovalToken: "first-drag-review",
  };
  const runBrowserAutomation = vi.fn(async () => ({ attachmentId: null }));
  vi.stubGlobal("window", {
    desktopBridge: { getBrowserSessionState: async () => browser, runBrowserAutomation },
  });
  const target = projectToolAttachmentTarget(
    location,
    id,
    [],
    new Map([[sessionId, projectBrowserAttachmentTarget(browser)]]),
  )!;
  const sourceStorage = (await storage!.getItem(name!))!;
  const sourceSettings = useWorkspaceShellStore.getState().projectSettingsByProjectId;
  const file = projectToolSurfaceAttachmentFile(location, target);

  // The receiving renderer loaded its own session before the source wrote the identity.
  useWorkspaceShellStore.setState({
    projectSettingsByProjectId: { [projectId]: beforeFirstDrag },
  });
  useWorkspaceShellStore.getState().rememberThread(projectId, destination.threadId);
  await storage!.setItem(name!, sourceStorage);
  const localTool = () =>
    useWorkspaceShellStore
      .getState()
      .projectSettingsByProjectId[projectId]?.tools.find((tool) => tool.id === id);
  expect(localTool()?.attachmentInstanceId).toBeUndefined();

  confirm.mockReset().mockResolvedValueOnce(true);
  const prepared = (await prepareDroppedSurfaceAttachment(destination, file))!;
  expect(JSON.parse(await prepared.text())).toMatchObject({
    threadId: destination.threadId,
    target: target.target,
  });
  expect(localTool()?.attachmentInstanceId).toBe(target.target.instanceId);
  expect(useWorkspaceShellStore.getState().session.rememberedThreadIdByProjectId[projectId]).toBe(
    destination.threadId,
  );
  expect(runBrowserAutomation).toHaveBeenCalledTimes(2);

  confirm.mockImplementationOnce(async () => {
    // Reconfigure the source window during review without changing the receiver's store.
    await storage!.setItem(name!, {
      ...sourceStorage,
      state: {
        projectSettingsByProjectId: {
          ...sourceSettings,
          [projectId]: {
            ...sourceSettings[projectId]!,
            customEmbeds: beforeFirstDrag.customEmbeds.map((embed) => ({
              ...embed,
              partitionProfile: "Personal",
            })),
          },
        },
      },
    });
    return true;
  });
  await expect(prepareDroppedSurfaceAttachment(destination, file)).rejects.toThrow("tool changed");
  expect(runBrowserAutomation).toHaveBeenCalledTimes(2);
  expect(localTool()?.attachmentInstanceId).toBe(target.target.instanceId);
});

it.each([
  {
    tool: "custom",
    mode: "isolated",
    profile: "default",
    partition: `persist:tabs-browser:${projectId}:custom-private-tool`,
  },
  {
    tool: "custom",
    mode: "profile",
    profile: "Work",
    partition: "persist:tabs-browser:profile:Work",
  },
  {
    tool: "browser",
    mode: "profile",
    profile: "default",
    partition: "persist:tabs-browser:profile:default",
  },
  {
    tool: "browser",
    mode: "shared",
    profile: "default",
    partition: `persist:tabs-browser:${projectId}`,
  },
] as const)(
  "restores a bookmarked $tool toolbar page with $mode storage",
  async ({ tool, mode, profile, partition }) => {
    if (profile !== "default")
      appAtomRegistry.update(clientSettingsAtom, (settings) => ({
        ...settings,
        browserProfiles: [{ id: profile, label: profile, createdAt: 1 }],
      }));
    const id = tool === "custom" ? addPrivateTool() : "browser";
    const sessionId = tool === "custom" ? `custom-${id}` : id;
    useWorkspaceShellStore.getState().upsertProjectSettings(projectId, (settings) => ({
      ...settings,
      ...(tool === "browser"
        ? { browser: { ...settings.browser, partitionMode: mode, partitionProfile: profile } }
        : {
            customEmbeds: settings.customEmbeds.map((embed) =>
              embed.id === id
                ? { ...embed, partitionMode: mode, partitionProfile: profile }
                : embed,
            ),
          }),
    }));
    const url = "https://private.test/design/file-42";
    const state = {
      ...emptyBrowserState(projectId, sessionId),
      instanceId: "original-browser",
      profileId: profile,
      currentUrl: url,
      pageRef: "a".repeat(64),
    };
    const attachment = projectToolAttachmentTarget(
      location,
      id,
      [],
      new Map([[sessionId, projectBrowserAttachmentTarget(state)]]),
    )!;
    const file = projectToolSurfaceAttachmentFile(location, attachment);
    const attachmentId = "4953a60f-1f5c-49f1-a1dd-43f976e4bece";
    const reference = { ...JSON.parse(await file.text()), attachmentId };
    const ensureBrowserSession = vi.fn(async (_input: { partition?: string }) => {});
    const runBrowserAutomation = vi.fn(async () => {
      if (ensureBrowserSession.mock.calls[0]?.[0].partition !== partition)
        throw new Error("The saved browser partition did not match.");
      return { url };
    });
    vi.stubGlobal("window", {
      desktopBridge: {
        getBrowserSessionState: async () => emptyBrowserState(projectId, sessionId),
        ensureBrowserSession,
        runBrowserAutomation,
      },
    });
    await revealSurfaceReference(location, reference);
    expect(ensureBrowserSession).toHaveBeenCalledExactlyOnceWith({
      projectId,
      sessionId,
      partition,
      initialUrl: "",
    });
    expect(runBrowserAutomation).toHaveBeenCalledExactlyOnceWith({
      projectId,
      sessionId,
      taskId: location.threadId,
      source: "human",
      operation: "enterSavedAttachedPage",
      input: { attachmentId, profileId: profile },
    });
    expect(useWorkspaceShellStore.getState().session.activeToolIdByProjectId[projectId]).toBe(id);
    useWorkspaceShellStore.getState().upsertProjectSettings(projectId, (settings) => ({
      ...settings,
      ...(tool === "browser"
        ? {
            browser: {
              ...settings.browser,
              partitionMode: "profile" as const,
              partitionProfile: "Personal",
            },
          }
        : {
            customEmbeds: settings.customEmbeds.map((embed) =>
              embed.id === id
                ? { ...embed, partitionMode: "profile" as const, partitionProfile: "Personal" }
                : embed,
            ),
          }),
    }));
    await expect(revealSurfaceReference(location, reference)).rejects.toThrow("identity");
    expect(ensureBrowserSession).toHaveBeenCalledOnce();
    expect(runBrowserAutomation).toHaveBeenCalledOnce();
  },
);

it("uses the live native grant for the keyboard attachment and reveals it only in the original thread", async () => {
  const selector = "window:current";
  nativeComputer.mockResolvedValue({
    grant: { selector, window: { app: "QA", title: "Report", pid: 42 } },
  });
  await expect(selectedNativeWindowAttachmentFile(location, "window:expired")).rejects.toThrow(
    "expired",
  );
  const file = await selectedNativeWindowAttachmentFile(location, selector);
  const ref = JSON.parse(await file.text());
  expect(ref.target).toMatchObject({ kind: "native-window", selector });
  nativeComputer.mockClear();
  await revealSurfaceReference(location, ref);
  expect(nativeComputer).toHaveBeenCalledWith({
    op: "reveal",
    threadId: location.threadId,
    selector,
  });
  expect(() =>
    revealSurfaceReference({ ...location, threadId: ThreadId.make("another") }, ref),
  ).toThrow("original");
  expect(nativeComputer).toHaveBeenCalledTimes(1);
});
