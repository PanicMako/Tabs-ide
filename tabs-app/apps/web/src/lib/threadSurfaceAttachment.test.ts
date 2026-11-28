import { beforeEach, expect, it, vi } from "vitest";
import { EnvironmentId, RunId, ThreadId } from "@tabs/contracts";
import { scopedComposerThreadId } from "~/state/composerDrafts";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import { useRightPanelStore } from "~/stores/rightPanelStore";
import { appAtomRegistry } from "~/state/atomRegistry";
import { clientSettingsAtom } from "~/state/settings";
import * as environments from "~/connection/environmentApiRegistry";
import * as confirms from "./customConfirm";
import {
  addSurfaceFileToDraft,
  approveDroppedBrowserTab,
  browserExcerptAttachmentFile,
  comparisonScreenshotAttachmentFile,
  prepareDroppedSurfaceAttachment,
  revealSurfaceReference,
  surfaceAttachmentFile,
  surfaceScope,
} from "./threadSurfaceAttachment";

const location = {
  environmentId: EnvironmentId.make("machine"),
  projectId: "project",
  threadId: ThreadId.make("qa"),
};
const scope = surfaceScope(location);
beforeEach(() => {
  useCompanionSurfaceStore.setState({ workspaces: {} });
  useComposerDraftStore.setState({ draftsByThreadId: {} });
  appAtomRegistry.update(clientSettingsAtom, (settings) => ({
    ...settings,
    browserProfiles: [
      { id: "Work", label: "Work", createdAt: 1 },
      { id: "Personal", label: "Personal", createdAt: 2 },
    ],
  }));
});

it("moves only the released companion tab and captures fresh evidence in the receiving thread", async () => {
  const source = { ...location, environmentId: null };
  const destination = { ...source, threadId: ThreadId.make("receiving") };
  const sourceScope = surfaceScope(source);
  const destinationScope = surfaceScope(destination);
  const store = useCompanionSurfaceStore.getState();
  const url = "https://app.test/draft/42?account=private";
  const pageRef = "a".repeat(64);
  const instanceId = "f145c5db-a4e6-42be-af23-524dde0aa7bf";
  const work = store.open(sourceScope, "browser", {
    url,
    profileId: "Work",
    pageRef,
    browserInstanceId: instanceId,
  });
  const personal = store.open(sourceScope, "browser", { url, profileId: "Personal" });
  store.activate(sourceScope, work);
  const editor = store.open(destinationScope, "terminal");
  const sessionId = `agents-surface-${work}`;
  const browser = {
    projectId: source.projectId,
    sessionId,
    profileId: "Work",
    currentUrl: url,
    pageRef,
    instanceId,
    pageApprovalToken: "session:epoch:page",
    assignedTaskId: source.threadId as ThreadId | null,
    loading: false,
  };
  const attachmentId = "fba565f2-c688-43ff-a0ef-fafa8b1e3207";
  const runBrowserAutomation = vi.fn().mockResolvedValue({ approved: true, attachmentId });
  vi.stubGlobal("window", {
    desktopBridge: { getBrowserSessionState: vi.fn(async () => browser), runBrowserAutomation },
  });
  const confirm = vi.spyOn(confirms, "showCustomConfirm");
  const currentWorkspaces = () => useCompanionSurfaceStore.getState().workspaces;
  const file = surfaceAttachmentFile(source, currentWorkspaces()[sourceScope]!.tabs[0]!)!;
  try {
    await expect(prepareDroppedSurfaceAttachment(destination, file)).rejects.toThrow(
      "owning thread",
    );
    expect(confirm).not.toHaveBeenCalled();
    browser.assignedTaskId = null;
    confirm.mockResolvedValueOnce(false);
    await expect(prepareDroppedSurfaceAttachment(destination, file)).resolves.toBeNull();
    confirm.mockImplementationOnce(async () => {
      store.update(sourceScope, work, { pageRef: "b".repeat(64) });
      return true;
    });
    await expect(prepareDroppedSurfaceAttachment(destination, file)).rejects.toThrow(
      "page changed",
    );
    store.update(sourceScope, work, { pageRef });
    expect(runBrowserAutomation).not.toHaveBeenCalled();
    expect(currentWorkspaces()[sourceScope]!.activeId).toBe(work);
    confirm.mockResolvedValueOnce(true);
    const moved = await prepareDroppedSurfaceAttachment(destination, file);
    expect(confirm).toHaveBeenLastCalledWith(
      "Move the open tab for https://app.test/draft/42 in the Work profile to this conversation and allow this thread to use the page?",
    );
    expect(runBrowserAutomation.mock.calls).toEqual([
      [
        expect.objectContaining({
          taskId: destination.threadId,
          sessionId,
          operation: "authorizeBrowserPage",
          input: {
            url,
            profileId: "Work",
            instanceId,
            pageApprovalToken: browser.pageApprovalToken,
            adoptOpenTab: true,
          },
        }),
      ],
      [
        expect.objectContaining({
          taskId: destination.threadId,
          sessionId,
          operation: "captureAttachedPage",
          input: { pageRef, instanceId, profileId: "Work" },
        }),
      ],
    ]);
    const result = await moved!.text();
    expect(result).not.toContain("account=");
    expect(JSON.parse(result)).toMatchObject({
      threadId: destination.threadId,
      surfaceId: work,
      attachmentId,
      evidenceDestination: { tabId: sessionId, profileId: "Work", pageRef, instanceId },
    });
    expect(currentWorkspaces()[sourceScope]).toMatchObject({
      tabs: [{ id: personal, profileId: "Personal" }],
      activeId: personal,
    });
    expect(currentWorkspaces()[destinationScope]).toMatchObject({
      tabs: [{ id: editor }, { id: work, profileId: "Work", browserInstanceId: instanceId }],
      activeId: editor,
    });
    await expect(prepareDroppedSurfaceAttachment(destination, file)).rejects.toThrow("changed");
  } finally {
    confirm.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("keeps a comparison pair in one attachment and requires both grants for re-entry", async () => {
  const original = { ...location, environmentId: null };
  const workspace = surfaceScope(original);
  const store = useCompanionSurfaceStore.getState();
  const pageRef = "a".repeat(64);
  const work = store.open(workspace, "browser", {
    url: "https://app.test/drafts/42",
    profileId: "Work",
    pageRef,
    browserInstanceId: "verified-instance",
  });
  const other = store.open(workspace, "browser", {
    url: "https://app.test/drafts/42",
    profileId: "Personal",
  });
  const tab = useCompanionSurfaceStore.getState().workspaces[workspace]!.tabs[0]!;
  const runId = RunId.make("0a17a20b-fea4-4b65-9c83-880711304c03");
  const source = {
    hostId: "mac",
    deviceId: "iphone",
    grantId: "261d09a4-8580-4812-a05b-abf377498ffa",
    frame: { runId, step: 2, side: "source" as const },
  };
  const target = {
    hostId: "android-host",
    deviceId: "pixel",
    grantId: "e452a9fb-173a-47f3-b765-c73f38f3416c",
    frame: { runId, step: 2, side: "target" as const },
  };
  expect(
    comparisonScreenshotAttachmentFile(original, tab, {
      source,
      target: { ...target, frame: { ...target.frame, step: 3 } },
    }),
  ).toBeNull();
  const file = comparisonScreenshotAttachmentFile(original, tab, { source, target });
  expect(file?.name).toBe("First difference (step 2) · Work.tabs.json");
  const reference = JSON.parse(await file!.text());
  expect(reference.comparisonScreenshotTransfer).toMatchObject({
    source,
    target,
    tabId: `agents-surface-${work}`,
  });
  expect(reference).not.toHaveProperty("screenshotTransfer");
  const getBrowserSessionState = vi
    .fn()
    .mockResolvedValue({ instanceId: "verified-instance", currentUrl: tab.url });
  const runBrowserAutomation = vi
    .fn()
    .mockRejectedValueOnce(new Error("Both screenshot receipts are required."))
    .mockResolvedValueOnce({ url: tab.url });
  const panel = useRightPanelStore.getState();
  vi.stubGlobal("window", { desktopBridge: { getBrowserSessionState, runBrowserAutomation } });
  try {
    await expect(revealSurfaceReference(original, reference)).rejects.toThrow(
      "Both screenshot receipts",
    );
    expect(useCompanionSurfaceStore.getState().workspaces[workspace]?.activeId).toBe(other);
    await revealSurfaceReference(original, reference);
    expect(runBrowserAutomation).toHaveBeenLastCalledWith({
      projectId: original.projectId,
      taskId: original.threadId,
      sessionId: `agents-surface-${work}`,
      source: "human",
      operation: "enterSavedScreenshotDraft",
      input: { pageRef, profileId: "Work", grantId: source.grantId, pairedGrantId: target.grantId },
    });
    expect(useCompanionSurfaceStore.getState().workspaces[workspace]?.activeId).toBe(work);
  } finally {
    vi.unstubAllGlobals();
    useRightPanelStore.setState(panel);
  }
});

it("captures an opaque Work document and restores only its logical tab after a restart", async () => {
  const original = { ...location, environmentId: null };
  const workspace = surfaceScope(original);
  const store = useCompanionSurfaceStore.getState();
  const url = "https://figma.test/design/file-42?node-id=1-9";
  const pageRef = "a".repeat(64);
  const instanceId = "e98d5035-7289-43f1-88b1-c3caf9b64fda";
  const work = store.open(workspace, "browser", {
    title: "Design",
    url,
    profileId: "Work",
    pageRef,
    browserInstanceId: instanceId,
  });
  const personal = store.open(workspace, "browser", {
    title: "Design",
    url,
    profileId: "Personal",
  });
  const sessionId = `agents-surface-${work}`;
  const attachmentId = "4953a60f-1f5c-49f1-a1dd-43f976e4bece";
  const getBrowserSessionState = vi.fn().mockResolvedValue({
    currentUrl: url,
    profileId: "Work",
    pageRef,
    instanceId,
    browserPageAuthorized: true,
    assignedTaskId: original.threadId,
  });
  const runBrowserAutomation = vi
    .fn()
    .mockResolvedValueOnce({ attachmentId })
    .mockResolvedValue({ url });
  const ensureBrowserSession = vi.fn().mockResolvedValue(undefined);
  const panel = useRightPanelStore.getState();
  vi.stubGlobal("window", {
    desktopBridge: { getBrowserSessionState, runBrowserAutomation, ensureBrowserSession },
  });
  try {
    const tab = useCompanionSurfaceStore.getState().workspaces[workspace]!.tabs[0]!;
    const file = await prepareDroppedSurfaceAttachment(
      original,
      surfaceAttachmentFile(original, tab)!,
    );
    const text = await file!.text();
    expect(text).not.toContain("file-42");
    expect(text).not.toContain("node-id");
    const reference = JSON.parse(text);
    expect(reference).toMatchObject({
      attachmentId,
      target: { tabId: sessionId, profileId: "Work" },
      evidenceDestination: { tabId: sessionId, profileId: "Work", pageRef, instanceId },
    });
    expect(runBrowserAutomation).toHaveBeenCalledExactlyOnceWith({
      projectId: original.projectId,
      sessionId,
      source: "human",
      taskId: original.threadId,
      operation: "captureAttachedPage",
      input: { pageRef, instanceId, profileId: "Work" },
    });
    store.update(workspace, work, { url: "https://figma.test/design/a-different-file" });
    getBrowserSessionState.mockResolvedValue({ currentUrl: null });
    await revealSurfaceReference(original, reference);
    expect(ensureBrowserSession).toHaveBeenCalledExactlyOnceWith({
      projectId: original.projectId,
      sessionId,
      profileId: "Work",
      initialUrl: "",
    });
    expect(runBrowserAutomation).toHaveBeenLastCalledWith({
      projectId: original.projectId,
      sessionId,
      source: "human",
      taskId: original.threadId,
      operation: "enterSavedAttachedPage",
      input: { attachmentId, profileId: "Work" },
    });
    expect(useCompanionSurfaceStore.getState().workspaces[workspace]?.activeId).toBe(work);
    expect(
      useCompanionSurfaceStore.getState().workspaces[workspace]?.tabs.find(({ id }) => id === work)
        ?.url,
    ).toBe(url);
    store.activate(workspace, personal);
    store.update(workspace, work, { profileId: "Personal" });
    expect(() => revealSurfaceReference(original, reference)).toThrow("identity");
    expect(useCompanionSurfaceStore.getState().workspaces[workspace]?.activeId).toBe(personal);
    expect(runBrowserAutomation).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
    useRightPanelStore.setState(panel);
  }
});

it("drops an excerpt without a grant and reveals only the original browser page", async () => {
  const original = { ...location, environmentId: null };
  const workspace = surfaceScope(original);
  const store = useCompanionSurfaceStore.getState();
  const pageRef = "a".repeat(64);
  const browserInstanceId = "original-instance";
  const url = "https://app.test/details?opaque=private";
  const surfaceId = store.open(workspace, "browser", { url, profileId: "Work" });
  const sessionId = `agents-surface-${surfaceId}`;
  const bystander = store.open(workspace, "browser", { url, profileId: "Personal" });
  const tab = useCompanionSurfaceStore.getState().workspaces[workspace]!.tabs[0]!;
  const file = browserExcerptAttachmentFile(
    original,
    { ...tab, pageRef, browserInstanceId },
    "  Total\n$20.00  ",
  )!;
  const contents = await file.text();
  const reference = JSON.parse(contents);
  expect(contents).not.toContain("opaque=private");
  expect(reference).toMatchObject({
    target: {
      kind: "browser-excerpt",
      tabId: sessionId,
      profileId: "Work",
      origin: "https://app.test",
    },
    surfaceId,
    pageRef,
    browserInstanceId,
    text: "  Total\n$20.00  ",
  });
  expect(reference).not.toHaveProperty("screenshotTransfer");
  expect(reference).not.toHaveProperty("evidenceDestination");
  const current = {
    projectId: original.projectId,
    sessionId,
    instanceId: browserInstanceId,
    profileId: "Work",
  };
  const getBrowserSessionState = vi.fn(async () => current);
  const runBrowserAutomation = vi.fn(async () => ({ result: "attached_page" }));
  const panel = useRightPanelStore.getState();
  vi.stubGlobal("window", { desktopBridge: { getBrowserSessionState, runBrowserAutomation } });
  try {
    await expect(approveDroppedBrowserTab(original, file)).resolves.toBe(true);
    expect(getBrowserSessionState).not.toHaveBeenCalled();
    expect(runBrowserAutomation).not.toHaveBeenCalled();
    await expect(
      approveDroppedBrowserTab({ ...original, threadId: ThreadId.make("other") }, file),
    ).rejects.toThrow("original");

    store.update(workspace, surfaceId, { url: "https://another.test/interim" });
    getBrowserSessionState.mockResolvedValueOnce({ ...current, instanceId: "replacement" });
    await expect(revealSurfaceReference(original, reference)).rejects.toThrow("replaced");
    expect(runBrowserAutomation).not.toHaveBeenCalled();
    expect(useCompanionSurfaceStore.getState().workspaces[workspace]?.activeId).toBe(bystander);

    await revealSurfaceReference(original, reference);
    expect(runBrowserAutomation).toHaveBeenCalledExactlyOnceWith({
      projectId: original.projectId,
      sessionId,
      source: "human",
      taskId: original.threadId,
      operation: "enterAttachedPage",
      input: { pageRef, profileId: "Work", grantId: undefined },
    });
    expect(useCompanionSurfaceStore.getState().workspaces[workspace]?.activeId).toBe(surfaceId);
  } finally {
    vi.unstubAllGlobals();
    useRightPanelStore.setState(panel);
  }
});

it("reopens a verified screenshot draft after restart without activating an invalid receipt", async () => {
  const original = { ...location, environmentId: null };
  const workspace = surfaceScope(original);
  const store = useCompanionSurfaceStore.getState();
  const pageRef = "a".repeat(64);
  const grantId = "4953a60f-1f5c-49f1-a1dd-43f976e4bece";
  const work = store.open(workspace, "browser", {
    url: "https://app.test/create",
    profileId: "Work",
    pageRef,
    browserInstanceId: "original-instance",
  });
  const personal = store.open(workspace, "browser", {
    url: "https://app.test/create",
    profileId: "Personal",
  });
  const tab = useCompanionSurfaceStore.getState().workspaces[workspace]!.tabs[0]!;
  const file = surfaceAttachmentFile(original, tab, {
    grantId,
    hostId: "fixture-host",
    deviceId: "disposable-device",
  })!;
  const reference = JSON.parse(await file.text());
  const draftUrl = "https://app.test/drafts/saved";
  const sessionId = `agents-surface-${work}`;
  const getBrowserSessionState = vi.fn().mockResolvedValue({ currentUrl: null });
  const ensureBrowserSession = vi.fn().mockResolvedValue(undefined);
  const runBrowserAutomation = vi
    .fn()
    .mockRejectedValueOnce(new Error("The saved draft no longer shows its screenshot receipt."))
    .mockResolvedValueOnce({ url: draftUrl });
  const panel = useRightPanelStore.getState();
  const activeId = () => useCompanionSurfaceStore.getState().workspaces[workspace]?.activeId;
  vi.stubGlobal("window", {
    desktopBridge: { getBrowserSessionState, ensureBrowserSession, runBrowserAutomation },
  });
  try {
    await expect(revealSurfaceReference(original, reference)).rejects.toThrow("screenshot receipt");
    expect(activeId()).toBe(personal);
    getBrowserSessionState.mockResolvedValue({
      currentUrl: "about:blank",
      instanceId: "restored-instance",
      profileId: "Work",
    });
    await revealSurfaceReference(original, reference);
    expect(ensureBrowserSession).toHaveBeenCalledExactlyOnceWith({
      projectId: original.projectId,
      sessionId,
      profileId: "Work",
      initialUrl: "",
    });
    expect(runBrowserAutomation).toHaveBeenCalledTimes(2);
    expect(runBrowserAutomation).toHaveBeenLastCalledWith({
      projectId: original.projectId,
      sessionId,
      taskId: original.threadId,
      source: "human",
      operation: "enterSavedScreenshotDraft",
      input: { grantId, pageRef, profileId: "Work" },
    });
    expect(activeId()).toBe(work);
    expect(
      useCompanionSurfaceStore.getState().workspaces[workspace]?.tabs.find(({ id }) => id === work)
        ?.url,
    ).toBe(draftUrl);
    store.activate(workspace, personal);
    runBrowserAutomation.mockResolvedValueOnce(null);
    await expect(revealSurfaceReference(original, reference)).rejects.toThrow("replaced");
    expect(activeId()).toBe(personal);
    expect(runBrowserAutomation).toHaveBeenCalledTimes(3);

    getBrowserSessionState.mockResolvedValue({
      currentUrl: tab.url,
      instanceId: "original-instance",
      profileId: "Work",
    });
    runBrowserAutomation
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ result: "attached_page" });
    await revealSurfaceReference(original, reference);
    expect(runBrowserAutomation).toHaveBeenLastCalledWith({
      projectId: original.projectId,
      sessionId,
      taskId: original.threadId,
      source: "human",
      operation: "enterAttachedPage",
      input: { grantId, pageRef, profileId: "Work" },
    });

    appAtomRegistry.update(clientSettingsAtom, (settings) => ({
      ...settings,
      browserProfiles: settings.browserProfiles.filter(({ id }) => id !== "Work"),
    }));
    getBrowserSessionState.mockClear();
    ensureBrowserSession.mockClear();
    await expect(revealSurfaceReference(original, reference)).rejects.toThrow(
      "original browser profile is no longer available",
    );
    expect(getBrowserSessionState).not.toHaveBeenCalled();
    expect(ensureBrowserSession).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    useRightPanelStore.setState(panel);
  }
});

it("round-trips the exact tab and account through the environment-scoped composer", async () => {
  const store = useCompanionSurfaceStore.getState();
  const work = store.open(scope, "browser", {
    title: "Draft",
    profileId: "Work",
    url: "https://app.test/draft?token=private",
  });
  const personal = store.open(scope, "browser", {
    title: "Draft",
    profileId: "Personal",
    url: "https://app.test/",
  });
  const tab = useCompanionSurfaceStore.getState().workspaces[scope]!.tabs[0]!;
  const file = surfaceAttachmentFile(location, tab)!;
  expect(await file.text()).not.toContain("private");
  addSurfaceFileToDraft(location, file);
  expect(
    useComposerDraftStore.getState().draftsByThreadId[
      scopedComposerThreadId(location.environmentId, location.threadId)
    ]?.files[0]?.name,
  ).toContain("Work");
  const ref = JSON.parse(await file.text());
  expect(useCompanionSurfaceStore.getState().workspaces[scope]?.activeId).toBe(personal);
  revealSurfaceReference(location, ref);
  expect(useCompanionSurfaceStore.getState().workspaces[scope]?.activeId).toBe(work);
  store.update(scope, work, { profileId: "Personal" });
  expect(() => revealSurfaceReference(location, ref)).toThrow("identity");
  expect(() => revealSurfaceReference({ ...location, projectId: "another" }, ref)).toThrow(
    "original",
  );
});

it("retains both ids for devices with identical names and rejects a closed instance", async () => {
  const store = useCompanionSurfaceStore.getState();
  for (const hostId of ["local", "lab"])
    store.open(scope, "device", {
      title: "Pixel",
      deviceId: "emulator-5554",
      platform: "android",
      hostId,
    });
  const [local, lab] = useCompanionSurfaceStore.getState().workspaces[scope]!.tabs;
  const ref = JSON.parse(await surfaceAttachmentFile(location, lab!)!.text());
  expect(ref.target).toMatchObject({ hostId: "lab", deviceId: "emulator-5554" });
  store.activate(scope, local!.id);
  revealSurfaceReference(location, ref);
  expect(useCompanionSurfaceStore.getState().workspaces[scope]?.activeId).toBe(lab!.id);
  store.close(scope, lab!.id);
  expect(() => revealSurfaceReference(location, ref)).toThrow("closed");
});

it("borrows only the exact device view from the source conversation", async () => {
  const other = { ...location, threadId: ThreadId.make("checkout") };
  const store = useCompanionSurfaceStore.getState();
  const originalId = store.open(scope, "device", {
    hostId: "lab",
    deviceId: "emulator-5554",
    platform: "android",
    title: "Pixel",
  });
  const destination = surfaceScope(other);
  const sibling = store.open(destination, "device", {
    hostId: "other-lab",
    deviceId: "emulator-5554",
    platform: "android",
    title: "Pixel",
  });
  const original = useCompanionSurfaceStore
    .getState()
    .workspaces[scope]!.tabs.find(({ id }) => id === originalId)!;
  const file = surfaceAttachmentFile(location, original)!;
  const open = vi.fn(async () => ({
    threadId: other.threadId,
    hostId: "lab",
    deviceId: "emulator-5554",
    platform: "android",
    openedAt: "now",
  }));
  const registry = vi.spyOn(environments, "environmentApi").mockResolvedValue({
    device: { open },
  } as unknown as Awaited<ReturnType<typeof environments.environmentApi>>);
  try {
    await expect(
      prepareDroppedSurfaceAttachment({ ...other, projectId: "another" }, file),
    ).rejects.toThrow("original project");
    expect(open).not.toHaveBeenCalled();
    open.mockResolvedValueOnce({
      threadId: other.threadId,
      hostId: "other-lab",
      deviceId: "emulator-5554",
      platform: "android",
      openedAt: "now",
    });
    await expect(prepareDroppedSurfaceAttachment(other, file)).rejects.toThrow("view changed");
    expect(useCompanionSurfaceStore.getState().workspaces[destination]?.tabs).toHaveLength(1);

    const attached = (await prepareDroppedSurfaceAttachment(other, file))!;
    expect(open).toHaveBeenLastCalledWith({
      threadId: other.threadId,
      fromThreadId: location.threadId,
      hostId: "lab",
      deviceId: "emulator-5554",
      platform: "android",
      boot: false,
    });
    const result = JSON.parse(await attached.text());
    expect(result).toMatchObject({
      threadId: other.threadId,
      target: { kind: "device", hostId: "lab", deviceId: "emulator-5554", platform: "android" },
    });
    expect(result.surfaceId).not.toBe(originalId);
    addSurfaceFileToDraft(other, attached);
    expect(
      useComposerDraftStore.getState().draftsByThreadId[
        scopedComposerThreadId(other.environmentId, other.threadId)
      ]?.files[0]?.file,
    ).toBe(attached);
    expect(useCompanionSurfaceStore.getState().workspaces[destination]?.activeId).toBe(sibling);
    const reused = (await prepareDroppedSurfaceAttachment(other, file))!;
    expect(JSON.parse(await reused.text()).surfaceId).toBe(result.surfaceId);
    expect(useCompanionSurfaceStore.getState().workspaces[destination]?.tabs).toHaveLength(2);
    revealSurfaceReference(other, result);
    expect(useCompanionSurfaceStore.getState().workspaces[destination]?.activeId).toBe(
      result.surfaceId,
    );
    expect(useCompanionSurfaceStore.getState().workspaces[scope]?.activeId).toBe(originalId);
  } finally {
    registry.mockRestore();
  }
});
