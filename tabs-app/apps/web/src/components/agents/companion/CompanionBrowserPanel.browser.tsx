import "../../../index.css";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  EnvironmentId,
  ProjectId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  RunId,
  ThreadId,
  type DesktopBrowserAutomationInput,
  type DesktopBrowserSessionState,
  type DeviceComparisonInput,
  type DeviceComparisonReport,
  type DeviceComparisonStatus,
} from "@tabs/contracts";
import { GlobalConfirmDialog } from "../../GlobalConfirmDialog";
import { useComposerDraftStore } from "~/composerDraftStore";
import { scopedComposerThreadId } from "~/state/composerDrafts";
import {
  setPrimaryEnvironmentIdForTesting,
  getPrimaryEnvironmentId,
} from "~/connection/environmentApiRegistry";
import { RightPanelTabs } from "../../RightPanelTabs";
import { MessagesTimeline } from "../../chat/MessagesTimeline";
import { DeviceComparisonDraftLink } from "../../device/DeviceComparisonDraftLink";
import { DeviceComparisonResultPanel } from "../../device/DeviceComparisonPanel";
import { openDeviceComparisonRequest, openDeviceComparisonResult } from "~/device/comparisonResult";
import { deriveTimelineEntries, deriveWorkLogEntries } from "~/session-logic";
import {
  BROWSER_SELECTION_REVIEW_EVENT,
  type BrowserSelectionReviewTarget,
} from "~/lib/browserSelectionDrag";
import { activitiesFromTurnItems } from "~/state/turnItemActivities";
import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import { useRightPanelStore } from "~/stores/rightPanelStore";
import { useWorkspaceShellStore } from "~/workspaceShellStore";
import { emptyBrowserState } from "./browserSession";
const comparison = vi.hoisted(() =>
  vi.fn<(input: DeviceComparisonInput) => Promise<DeviceComparisonStatus>>(),
);
vi.mock("~/connection/environmentApiRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/connection/environmentApiRegistry")>()),
  environmentApi: async () => ({ device: { comparison } }),
}));
vi.mock("~/hooks/useActiveProjectTarget", () => ({
  useActiveProjectTarget: () => ({
    projectId: "project",
    projectName: "Project",
    environmentId: testEnvironment,
    cwd: "/workspace",
  }),
}));
vi.mock("~/state/workspaceShell", () => ({
  useProjectWorkspaceSettings: () => null,
  useWorkspaceActiveProjectId: () => "project",
  workspaceShellActions: { rememberThread: () => undefined },
}));
vi.mock("./CompanionFilesPanel", () => ({ CompanionFilesPanel: () => null }));
vi.mock("./CompanionDiffPanel", () => ({ CompanionDiffPanel: () => null }));
vi.mock("./CompanionTerminalPanel", () => ({ CompanionTerminalPanel: () => null }));
vi.mock("./CompanionPRPanel", () => ({ CompanionPRPanel: () => null }));
vi.mock("~/components/NativePreviewAutomationHost", () => ({
  isNativeBrowserRecordingActive: () => false,
  startNativeBrowserRecording: vi.fn(),
  stopNativeBrowserRecording: vi.fn(),
}));
const testEnvironment = EnvironmentId.make("test-env");
const scope = "test-env:project";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNioAAAAASUVORK5CYII=";
const originalBridge = window.desktopBridge;
const originalWorkspace = useCompanionSurfaceStore.getState().workspaces;
const originalPanel = useRightPanelStore.getState();
let sessionId: string;
let bridge: ReturnType<typeof mockBridge>;
function mockBridge() {
  return {
    onBrowserSessionState: vi.fn((_listener: (state: DesktopBrowserSessionState) => void) =>
      vi.fn(),
    ),
    getBrowserHostState: vi.fn(async () => ({ available: true })),
    ensureBrowserSession: vi.fn(async () => {}),
    getBrowserSessionState: vi.fn(
      async (): Promise<DesktopBrowserSessionState> => ({
        ...emptyBrowserState("project", sessionId),
        currentUrl: "https://example.test/preserved",
        pageTitle: "Preserved page",
        canGoBack: true,
      }),
    ),
    runBrowserAutomation: vi.fn<(input: DesktopBrowserAutomationInput) => Promise<unknown>>(
      async () => ({ grantId: "selected-transfer" }),
    ),
    activateBrowserSession: vi.fn(async () => {}),
    hideBrowserSession: vi.fn(async () => {}),
    setBrowserBounds: vi.fn(async () => {}),
    setBrowserZoomFactor: vi.fn(async () => {}),
    setBrowserAudioMuted: vi.fn(async () => {}),
  };
}
beforeEach(() => {
  comparison.mockReset().mockResolvedValue({});
  useCompanionSurfaceStore.setState({ workspaces: {} });
  const id = useCompanionSurfaceStore
    .getState()
    .open(scope, "browser", { url: "https://example.test/preserved" });
  sessionId = `agents-surface-${id}`;
  useRightPanelStore.setState({ activeTab: "browser", choosingSurface: false, maximized: false });
  bridge = mockBridge();
  window.desktopBridge = bridge as unknown as NonNullable<Window["desktopBridge"]>;
});
afterEach(() => {
  if (originalBridge) window.desktopBridge = originalBridge;
  else delete window.desktopBridge;
  useCompanionSurfaceStore.setState({ workspaces: originalWorkspace });
  useRightPanelStore.setState(originalPanel);
});
function Harness({ visible = true }: { visible?: boolean }) {
  return (
    <div style={{ width: 560, height: 500 }}>
      <RightPanelTabs mode="sidebar" visible={visible} onClose={() => {}} />
    </div>
  );
}

it("opens device review from chat without approving it, on the original source host", async () => {
  const threadId = ThreadId.make("comparison-approval-thread");
  const threadScope = `${testEnvironment}:${threadId}`;
  const runId = "f49d91d0-b366-4521-a267-a90fa439732c";
  const source = {
    hostId: "mac-host",
    deviceId: "same-id",
    platform: "ios" as const,
    name: "iPhone",
    appId: "com.apple.mobilesafari",
  };
  const target = {
    ...source,
    hostId: "pixel-host",
    platform: "android" as const,
    name: "Pixel",
    appId: "com.android.chrome",
  };
  const surfaces = useCompanionSurfaceStore.getState();
  const sourceTab = surfaces.open(threadScope, "device", source);
  const targetTab = surfaces.open(threadScope, "device", target);
  const run: DeviceComparisonReport = {
    runId,
    source,
    target,
    phase: "awaiting_approval",
    agentRecording: { manual: false },
    busy: false,
    playing: false,
    completedSteps: 0,
    canResume: false,
    uncertainTap: false,
    steps: [],
  };
  comparison.mockResolvedValue({ run });
  const createdAt = "2026-11-25T01:02:00.000Z";
  const items = [1, 2].map((ordinal) => ({
    id: `approval-${ordinal}`,
    ordinal,
    type: "dynamic_tool",
    status: "completed",
    toolName: "t3-code.device_record_comparison",
    updatedAt: createdAt,
    outputOmitted: true,
    output: { deviceComparisonRequest: { runId } },
  }));
  const entries = deriveTimelineEntries(
    [],
    [],
    deriveWorkLogEntries(activitiesFromTurnItems(items), undefined),
  );
  await render(
    <MessagesTimeline
      hasMessages
      isWorking={false}
      activeTurnInProgress={false}
      activeTurnStartedAt={null}
      scrollContainer={null}
      timelineEntries={entries}
      completionDividerBeforeEntryId={null}
      completionSummary={null}
      turnDiffSummaryByAssistantMessageId={new Map()}
      nowIso={createdAt}
      expandedWorkGroups={{}}
      onToggleWorkGroup={() => {}}
      onOpenTurnDiff={() => {}}
      onOpenDeviceComparisonRequest={(request) =>
        openDeviceComparisonRequest(testEnvironment, threadId, request, () => true)
      }
      revertTurnCountByUserMessageId={new Map()}
      onRevertUserMessage={() => {}}
      isRevertingCheckpoint={false}
      onImageExpand={() => {}}
      markdownCwd={undefined}
      resolvedTheme="light"
      timestampFormat="locale"
      workspaceRoot={undefined}
      latestTaskDescription={null}
    />,
  );
  const review = page.getByRole("button", { name: "Review device access" });
  expect(review.elements()).toHaveLength(1);
  expect(useCompanionSurfaceStore.getState().workspaces[threadScope]?.activeId).toBe(targetTab);
  await review.click();
  await expect
    .poll(() => useCompanionSurfaceStore.getState().workspaces[threadScope]?.activeId)
    .toBe(sourceTab);
  expect(useRightPanelStore.getState().activeTab).toBe("device");
  expect(comparison.mock.calls).toEqual([[{ action: "status", runId, threadId }]]);

  comparison.mockResolvedValue({ run: { ...run, phase: "recording" } });
  await expect(
    openDeviceComparisonRequest(testEnvironment, threadId, { runId }, () => true),
  ).rejects.toThrow("no longer awaiting approval");

  const appRequest = {
    approvalId: crypto.randomUUID(),
    hostId: target.hostId,
    deviceId: target.deviceId,
  };
  comparison.mockResolvedValue({
    pendingAppApproval: { id: appRequest.approvalId, appId: target.appId },
  });
  await openDeviceComparisonRequest(testEnvironment, threadId, appRequest, () => true);
  expect(useCompanionSurfaceStore.getState().workspaces[threadScope]?.activeId).toBe(targetTab);
  expect(comparison).toHaveBeenLastCalledWith({
    action: "status",
    threadId,
    device: { hostId: target.hostId, deviceId: target.deviceId },
  });
  comparison.mockResolvedValue({});
  await expect(
    openDeviceComparisonRequest(testEnvironment, threadId, appRequest, () => true),
  ).rejects.toThrow("no longer awaiting review");
});

it.each(["verified", "pending"] as const)(
  "opens the exact comparison outcomes and %s draft from the chat work log",
  async (draftStatus) => {
    const threadId = ThreadId.make("comparison-result-thread");
    const threadScope = `${testEnvironment}:${threadId}`;
    const reference = { runId: "f49d91d0-b366-4521-a267-a90fa439732c", step: 2 };
    const newer = { runId: "efd80977-eaaf-4974-9476-1c8622769579", step: 2 };
    const matched = { runId: "f742526f-382d-44af-8795-4b8485f28f31" };
    const createdAt = "2026-11-25T01:02:00.000Z";
    const draftUrl = "https://quality.test/work/checkout";
    const surfaces = useCompanionSurfaceStore.getState();
    const work = surfaces.open(threadScope, "browser", { profileId: "work" });
    const personal = surfaces.open(threadScope, "browser", { profileId: "personal" });
    const workTabId = `agents-surface-${work}`;
    const workState = {
      ...emptyBrowserState("project", workTabId),
      assignedTaskId: threadId,
      instanceId: "restored-work-tab",
      profileId: "work",
      currentUrl: draftUrl,
    };
    let draftAvailable = false;
    bridge.runBrowserAutomation.mockImplementation(async ({ operation }) => {
      if (operation === "findDeviceComparisonDraft")
        return draftAvailable
          ? {
              tabId: workTabId,
              profileId: "work",
              ...(draftStatus === "pending" && { pending: true }),
            }
          : null;
      if (operation === "enterDeviceComparisonDraft") return { url: draftUrl };
    });
    const run = {
      runId: reference.runId,
      phase: "completed" as const,
      source: {
        hostId: "mac-host",
        deviceId: "phone",
        name: "iPhone",
        appId: "com.apple.mobilesafari",
        platform: "ios" as const,
      },
      target: {
        hostId: "pixel-host",
        deviceId: "phone",
        name: "Pixel",
        appId: "com.android.chrome",
        platform: "android" as const,
      },
      savedAt: createdAt,
      busy: false,
      playing: false,
      completedSteps: 2,
      canResume: false,
      uncertainTap: false,
      steps: [{ label: "Checkout" }, { label: "Review" }],
      availableEvidence: { source: true, target: true },
      firstDifference: {
        step: 2,
        kind: "total" as const,
        reason: "The totals differ.",
        sourceTotal: "$20.00",
        targetTotal: "$22.00",
      },
    };
    const {
      firstDifference: _difference,
      availableEvidence: _evidence,
      ...comparisonSummary
    } = run;
    const completed = {
      ...comparisonSummary,
      ...matched,
      phase: "completed" as const,
      completedSteps: run.steps.length,
    };
    comparison.mockImplementation(async (input) => {
      if (input.action === "evidence" && input.runId === reference.runId)
        return { run, evidence: { sourcePng: png, targetPng: png } };
      if (input.action === "status" && input.runId === reference.runId) return { run };
      if (input.action === "status" && input.runId === matched.runId) return { run: completed };
      return { run: { ...run, ...newer } };
    });
    const items = [1, 2].map((ordinal) => ({
      id: `status-${ordinal}`,
      ordinal,
      type: "dynamic_tool",
      status: "completed",
      toolName: "t3-code.device_comparison_status",
      updatedAt: createdAt,
      outputOmitted: true,
      output: { deviceDifference: reference },
    }));
    items.push({
      ...items[0]!,
      id: "unprojected-result",
      ordinal: 3,
      outputOmitted: false,
      output: { deviceDifference: { ...newer, step: 3 } },
    });
    const entries = deriveTimelineEntries(
      [],
      [],
      deriveWorkLogEntries(
        activitiesFromTurnItems([
          ...items,
          {
            ...items[0]!,
            id: "corrected-result",
            ordinal: 4,
            output: { deviceDifference: reference, deviceCompletion: { runId: reference.runId } },
          },
          { ...items[0]!, id: "matched-result", ordinal: 5, output: { deviceCompletion: matched } },
        ]),
        undefined,
      ),
    );
    const previousEnvironment = getPrimaryEnvironmentId();
    setPrimaryEnvironmentIdForTesting(testEnvironment);
    const view = await render(
      <>
        <MessagesTimeline
          hasMessages
          isWorking={false}
          activeTurnInProgress={false}
          activeTurnStartedAt={null}
          scrollContainer={null}
          timelineEntries={entries}
          completionDividerBeforeEntryId={null}
          completionSummary={null}
          turnDiffSummaryByAssistantMessageId={new Map()}
          nowIso={createdAt}
          expandedWorkGroups={{}}
          onToggleWorkGroup={() => {}}
          onOpenTurnDiff={() => {}}
          onOpenDeviceComparison={(result) =>
            openDeviceComparisonResult(testEnvironment, threadId, result)
          }
          revertTurnCountByUserMessageId={new Map()}
          onRevertUserMessage={() => {}}
          isRevertingCheckpoint={false}
          onImageExpand={() => {}}
          markdownCwd={undefined}
          resolvedTheme="light"
          timestampFormat="locale"
          workspaceRoot={undefined}
          latestTaskDescription={null}
        />
        <RightPanelTabs
          mode="sidebar"
          environmentId={testEnvironment}
          threadId={threadId}
          onClose={() => {}}
        />
      </>,
    );
    try {
      const openResult = page.getByRole("button", { name: "Open first difference · Step 2" });
      expect(openResult.elements()).toHaveLength(1);
      expect(
        page.getByRole("button", { name: "Open first difference · Step 3" }).elements(),
      ).toHaveLength(0);
      (openResult.element() as HTMLButtonElement).focus();
      await userEvent.keyboard("{Enter}");
      const evidence = page.getByRole("region", { name: "First difference", exact: true });
      await expect.element(evidence.getByText("First difference · Step 2 · Review")).toBeVisible();
      await expect
        .element(evidence.getByRole("img", { name: "Pixel at the first difference" }))
        .toBeVisible();
      await expect.element(evidence.getByText("com.android.chrome")).toBeVisible();
      await expect
        .element(page.getByRole("button", { name: "Open live Pixel" }))
        .not.toBeInTheDocument();
      expect(comparison.mock.calls).toEqual([
        [{ action: "evidence", threadId, runId: reference.runId }],
      ]);
      const tabs = () =>
        useCompanionSurfaceStore
          .getState()
          .workspaces[threadScope]?.tabs.filter((tab) => tab.deviceComparisonResult);
      expect(tabs()).toMatchObject([{ deviceComparisonResult: reference }]);
      expect(tabs()?.[0]).not.toHaveProperty("deviceId");
      await openResult.click();
      expect(tabs()).toHaveLength(1);
      openDeviceComparisonResult(testEnvironment, threadId, { ...newer, step: 3 });
      await expect
        .element(page.getByRole("alert"))
        .toHaveTextContent("This first difference is no longer available");
      await expect
        .element(page.getByRole("img", { name: "Pixel at the first difference" }))
        .not.toBeInTheDocument();

      await openResult.click();
      await expect.element(evidence.getByText("First difference · Step 2 · Review")).toBeVisible();
      const openDraft = page.getByRole("button", {
        name: "Open draft",
      });
      await vi.waitFor(() =>
        expect(bridge.runBrowserAutomation).toHaveBeenCalledWith({
          projectId: "project",
          taskId: threadId,
          source: "human",
          operation: "findDeviceComparisonDraft",
          input: reference,
        }),
      );
      await expect.element(openDraft).not.toBeInTheDocument();
      draftAvailable = true;
      const notify = bridge.onBrowserSessionState.mock.lastCall?.[0];
      expect(notify).toBeDefined();
      notify?.(workState);
      await expect.element(openDraft).toBeVisible();
      bridge.getBrowserSessionState
        .mockResolvedValueOnce(emptyBrowserState("project", workTabId))
        .mockResolvedValue(workState);
      await openDraft.click();
      await vi.waitFor(() =>
        expect(bridge.runBrowserAutomation).toHaveBeenCalledWith({
          projectId: "project",
          taskId: threadId,
          sessionId: workTabId,
          source: "human",
          operation: "enterDeviceComparisonDraft",
          input: { ...reference, profileId: "work" },
        }),
      );
      expect(bridge.ensureBrowserSession).toHaveBeenCalledWith({
        projectId: "project",
        sessionId: workTabId,
        profileId: "work",
        initialUrl: "",
      });
      await expect
        .poll(() => useCompanionSurfaceStore.getState().workspaces[threadScope]?.activeId)
        .toBe(work);
      expect(
        useCompanionSurfaceStore
          .getState()
          .workspaces[threadScope]?.tabs.find((tab) => tab.id === work)?.url,
      ).toBe(draftUrl);
      expect(
        useCompanionSurfaceStore
          .getState()
          .workspaces[threadScope]?.tabs.find((tab) => tab.id === personal)?.url,
      ).toBeUndefined();
      const summaries = page.getByRole("button", { name: "Open comparison result" });
      expect(summaries.elements()).toHaveLength(2);
      await summaries.first().click();
      const summary = page.getByRole("region", { name: "Device comparison", exact: true });
      await expect.element(summary.getByText("2 of 2 steps completed.")).toBeVisible();
      await expect
        .element(summary.getByRole("listitem").filter({ hasText: "Pixel" }))
        .toBeVisible();
      expect(comparison.mock.calls.at(-1)).toEqual([
        { action: "status", threadId, runId: reference.runId },
      ]);
      await summary.getByRole("button", { name: "Open first difference · Step 2" }).click();
      await expect
        .element(evidence.getByRole("img", { name: "Pixel at the first difference" }))
        .toBeVisible();
      expect(comparison.mock.calls.at(-1)).toEqual([
        { action: "evidence", threadId, runId: reference.runId },
      ]);

      await summaries.last().click();
      await expect
        .element(page.getByText("No difference found in the recorded steps."))
        .toBeVisible();
      await expect.element(page.getByText("2 of 2 steps completed.")).toBeVisible();
      await expect.element(page.getByRole("listitem").filter({ hasText: "Pixel" })).toBeVisible();
      await expect.element(openDraft).not.toBeInTheDocument();
      expect(comparison.mock.calls.at(-1)).toEqual([
        { action: "status", threadId, runId: matched.runId },
      ]);
    } finally {
      await view.unmount();
      setPrimaryEnvironmentIdForTesting(previousEnvironment);
    }
  },
);

it("opens a verified evidence draft directly from the snapshot in chat", async () => {
  const threadId = ThreadId.make("snapshot-result-thread");
  const scope = `${testEnvironment}:${threadId}`;
  const reference = { runId: "f49d91d0-b366-4521-a267-a90fa439732c", step: 2 };
  const createdAt = "2026-11-25T01:02:00.000Z";
  const url = "https://quality.test/work/verified-checkout";
  const surfaces = useCompanionSurfaceStore.getState();
  const work = surfaces.open(scope, "browser", { profileId: "work" });
  const personal = surfaces.open(scope, "browser", { profileId: "personal" });
  const sessionId = `agents-surface-${work}`;
  bridge.getBrowserSessionState.mockResolvedValue({
    ...emptyBrowserState("project", sessionId),
    instanceId: "original-work",
    profileId: "work",
    currentUrl: url,
  });
  bridge.runBrowserAutomation.mockImplementation(async ({ operation }) =>
    operation === "findDeviceComparisonDraft" ? { tabId: sessionId, profileId: "work" } : { url },
  );
  const items = [1, 2].map((ordinal) => ({
    id: `snapshot-${ordinal}`,
    ordinal,
    type: "dynamic_tool",
    status: "completed",
    toolName: "t3-code.preview_snapshot",
    updatedAt: createdAt,
    outputOmitted: true,
    output: { verifiedEvidenceDraft: reference },
  }));
  const entries = deriveTimelineEntries(
    [],
    [],
    deriveWorkLogEntries(activitiesFromTurnItems(items), undefined),
  );
  const previousEnvironment = getPrimaryEnvironmentId();
  setPrimaryEnvironmentIdForTesting(testEnvironment);
  const view = await render(
    <MessagesTimeline
      hasMessages
      isWorking={false}
      activeTurnInProgress={false}
      activeTurnStartedAt={null}
      scrollContainer={null}
      timelineEntries={entries}
      completionDividerBeforeEntryId={null}
      completionSummary={null}
      turnDiffSummaryByAssistantMessageId={new Map()}
      nowIso={createdAt}
      expandedWorkGroups={{}}
      onToggleWorkGroup={() => {}}
      onOpenTurnDiff={() => {}}
      onOpenDeviceComparison={() => {}}
      revertTurnCountByUserMessageId={new Map()}
      onRevertUserMessage={() => {}}
      isRevertingCheckpoint={false}
      onImageExpand={() => {}}
      markdownCwd={undefined}
      resolvedTheme="light"
      timestampFormat="locale"
      workspaceRoot={undefined}
      latestTaskDescription={null}
      projectId="project"
      threadId={threadId}
      environmentId={testEnvironment}
    />,
  );
  try {
    const open = page.getByRole("button", { name: "Open draft" });
    await expect.element(open).toBeVisible();
    expect(open.elements()).toHaveLength(1);
    await open.click();
    await expect
      .poll(() => useCompanionSurfaceStore.getState().workspaces[scope]?.activeId)
      .toBe(work);
    expect(bridge.runBrowserAutomation).toHaveBeenCalledWith({
      source: "human",
      operation: "enterDeviceComparisonDraft",
      projectId: "project",
      taskId: threadId,
      sessionId,
      input: { ...reference, profileId: "work" },
    });
    expect(
      useCompanionSurfaceStore.getState().workspaces[scope]?.tabs.find((tab) => tab.id === personal)
        ?.url,
    ).toBeUndefined();
  } finally {
    await view.unmount();
    setPrimaryEnvironmentIdForTesting(previousEnvironment);
  }
});

it("restores the exact Work toolbar draft and refreshes its verified status", async () => {
  const projectId = ProjectId.make("project");
  const threadId = ThreadId.make("toolbar-draft-thread");
  const toolId = "qa-toolbar";
  const tabId = "custom-qa-checkout";
  const reference = { runId: RunId.make("f49d91d0-b366-4521-a267-a90fa439732c"), step: 2 };
  const url = "https://quality.test/work/verified-checkout";
  const oldWorkspace = useWorkspaceShellStore.getState();
  oldWorkspace.openProject(projectId);
  oldWorkspace.setActiveTool(projectId, "agents");
  oldWorkspace.upsertProjectSettings(projectId, (settings) => ({
    ...settings,
    tools: [
      ...settings.tools,
      {
        id: toolId,
        kind: "custom_embed",
        customEmbedId: "qa-checkout",
        label: "QA",
        visible: true,
      },
    ],
    customEmbeds: [
      {
        id: "qa-checkout",
        label: "QA",
        url: "https://quality.test",
        partitionMode: "profile",
        partitionProfile: "work",
        resumeLastVisitedPage: true,
      },
    ],
  }));
  bridge.getBrowserSessionState
    .mockResolvedValueOnce(emptyBrowserState(projectId, tabId))
    .mockResolvedValue({
      ...emptyBrowserState(projectId, tabId),
      instanceId: "restored-work-guest",
      profileId: "work",
    });
  let verified = false;
  bridge.runBrowserAutomation.mockImplementation(async ({ operation, input }) => {
    if (operation === "findDeviceComparisonDraft") {
      if ((input as { runId: string }).runId !== reference.runId) return null;
      return { tabId, profileId: "work", ...(verified ? {} : { pending: true }) };
    }
    if (operation === "enterDeviceComparisonDraft") {
      verified = true;
      return { url };
    }
    throw new Error("Unexpected browser operation");
  });
  const previousEnvironment = getPrimaryEnvironmentId();
  setPrimaryEnvironmentIdForTesting(testEnvironment);
  const link = (runId = reference.runId) => (
    <DeviceComparisonDraftLink
      environmentId={testEnvironment}
      projectId={projectId}
      threadId={threadId}
      reference={{ ...reference, runId }}
      workLog
    />
  );
  const view = await render(link());
  try {
    await page.getByRole("button", { name: "Open draft" }).click();
    await expect.element(page.getByRole("button", { name: "Open draft" })).toBeVisible();
    expect(bridge.ensureBrowserSession).toHaveBeenCalledExactlyOnceWith({
      projectId,
      sessionId: tabId,
      partition: "persist:tabs-browser:profile:work",
      initialUrl: "",
    });
    expect(bridge.runBrowserAutomation).toHaveBeenCalledWith({
      projectId,
      taskId: threadId,
      sessionId: tabId,
      source: "human",
      operation: "enterDeviceComparisonDraft",
      input: { ...reference, profileId: "work" },
    });
    const revealed = useWorkspaceShellStore.getState();
    expect(revealed.session.activeToolIdByProjectId[projectId]).toBe(toolId);
    expect(revealed.browserUrlBySessionKey[`${projectId}:${tabId}`]).toBe(url);

    const nextRun = RunId.make("334499e5-ed97-4326-bce6-1d9dc0e4bd64");
    await view.rerender(link(nextRun));
    await expect.element(page.getByRole("button", { name: "Open draft" })).not.toBeInTheDocument();
    expect(bridge.runBrowserAutomation).toHaveBeenLastCalledWith({
      projectId,
      taskId: threadId,
      source: "human",
      operation: "findDeviceComparisonDraft",
      input: { ...reference, runId: nextRun },
    });
  } finally {
    await view.unmount();
    useWorkspaceShellStore.setState(oldWorkspace);
    setPrimaryEnvironmentIdForTesting(previousEnvironment);
  }
});

it("opens the original live destination after rechecking the run and exact host", async () => {
  const threadId = ThreadId.make("live-comparison-target");
  const threadScope = `${testEnvironment}:${threadId}`;
  const reference = { runId: "f49d91d0-b366-4521-a267-a90fa439732c", step: 2 };
  const source = {
    hostId: "source",
    deviceId: "same-id",
    platform: "ios",
    name: "iPhone",
    appId: "com.apple.mobilesafari",
  } as const;
  const target = {
    hostId: "target",
    deviceId: "same-id",
    platform: "android",
    name: "Pixel",
    appId: "com.android.chrome",
  } as const;
  const store = useCompanionSurfaceStore.getState();
  const other = store.open(threadScope, "device", { ...target, hostId: "another-pixel-host" });
  const destination = store.open(threadScope, "device", target);
  const result = store.open(threadScope, "device", { deviceComparisonResult: reference });
  const run: DeviceComparisonReport = {
    runId: reference.runId,
    source,
    target,
    phase: "paused",
    busy: false,
    playing: false,
    completedSteps: 1,
    canResume: true,
    uncertainTap: false,
    steps: [],
    firstDifference: { step: 2, kind: "total", reason: "The totals differ." },
  };
  let available = false;
  comparison.mockImplementation(async (input) =>
    input.action === "evidence"
      ? { run, liveTargetAvailable: true, evidence: { sourcePng: png, targetPng: png } }
      : { run, ...(available ? { liveTargetAvailable: true as const } : {}) },
  );
  await render(
    <DeviceComparisonResultPanel
      environmentId={testEnvironment}
      threadId={threadId}
      reference={reference}
      visible
    />,
  );
  const open = page.getByRole("button", { name: "Open live Pixel" });
  await open.click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("The original live device is no longer available");
  await expect
    .element(page.getByRole("img", { name: "Pixel at the first difference" }))
    .toBeVisible();
  expect(useCompanionSurfaceStore.getState().workspaces[threadScope]?.activeId).toBe(result);
  available = true;
  await open.click();
  await expect
    .poll(() => useCompanionSurfaceStore.getState().workspaces[threadScope]?.activeId)
    .toBe(destination);
  expect(destination).not.toBe(other);
  expect(
    comparison.mock.calls.every(
      ([input]) => input.action === "status" || input.action === "evidence",
    ),
  ).toBe(true);
});

it.each([false, true])(
  "restores the exact checkpoint from its first-difference tab (lost reply: %s)",
  async (lostReply) => {
    const threadId = ThreadId.make("saved-comparison-target");
    const threadScope = `${testEnvironment}:${threadId}`;
    const reference = { runId: "c800193c-5dc7-40fc-8090-0753f54fabe0", step: 1 };
    const source = {
      hostId: "source",
      deviceId: "same-id",
      platform: "ios",
      name: "iPhone",
      appId: "com.apple.mobilesafari",
    } as const;
    const target = {
      hostId: "target",
      deviceId: "same-id",
      platform: "android",
      name: "Pixel",
      appId: "com.android.chrome",
    } as const;
    const store = useCompanionSurfaceStore.getState();
    store.open(threadScope, "device", { ...source, hostId: "another-iphone-host" });
    const destination = store.open(threadScope, "device", target);
    const savedTab = store.open(threadScope, "device", { deviceComparisonResult: reference });
    const run: DeviceComparisonReport = {
      runId: reference.runId,
      source,
      target,
      phase: "stopped",
      savedAt: "2026-11-25T01:00:00.000Z",
      busy: false,
      playing: false,
      completedSteps: 0,
      canResume: false,
      uncertainTap: false,
      steps: [{ label: "Continue" }],
      firstDifference: { step: 1, kind: "total", reason: "The totals differ." },
    };
    let restored = false;
    comparison.mockImplementation(async (input) => {
      if (input.action === "restoreReplay" && !restored) {
        restored = true;
        if (lostReply) throw new Error("Connection reset after restoring the replay.");
      }
      if (restored) {
        const { savedAt: _savedAt, ...live } = run;
        return { run: { ...live, phase: "paused", canResume: true }, liveTargetAvailable: true };
      }
      return { run, canRestoreReplay: true, evidence: { sourcePng: png, targetPng: png } };
    });
    await render(
      <>
        <GlobalConfirmDialog />
        <DeviceComparisonResultPanel
          environmentId={testEnvironment}
          threadId={threadId}
          reference={reference}
          visible
        />
      </>,
    );
    const restore = page.getByRole("button", { name: "Restore paused replay" });
    await expect.element(restore).toBeDisabled();
    store.open(threadScope, "device", source);
    store.activate(threadScope, savedTab);
    await restore.click();
    const confirm = page.getByRole("dialog", { name: "Confirm" });
    await expect.element(confirm.getByText(/com.android.chrome on Pixel\?/)).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    expect(comparison.mock.calls.map(([input]) => input.action)).toEqual(["evidence"]);
    await expect
      .element(page.getByRole("img", { name: "Pixel at the first difference" }))
      .toBeVisible();
    await restore.click();
    await confirm.getByRole("button", { name: "Confirm" }).click();
    await expect
      .poll(() => useCompanionSurfaceStore.getState().workspaces[threadScope]?.activeId)
      .toBe(destination);
    const exactRestore = {
      action: "restoreReplay",
      threadId,
      runId: reference.runId,
      appId: target.appId,
      device: { hostId: target.hostId, deviceId: target.deviceId },
    };
    expect(comparison.mock.calls.map(([input]) => input)).toEqual([
      { action: "evidence", threadId, runId: reference.runId },
      exactRestore,
      ...(lostReply ? [exactRestore] : []),
      { action: "status", threadId, runId: reference.runId },
    ]);
  },
);

it("uses one compact navigation row and keeps preview tools accessible", async () => {
  const view = await render(<Harness />);
  try {
    await expect.element(page.getByLabelText("Browser URL")).toHaveValue("example.test/preserved");
    expect(document.querySelectorAll(".companion-toolbar")).toHaveLength(1);
    expect(document.querySelector(".companion-heading")).toBeNull();
    expect(
      document.querySelector(".companion-browser-toolbar")!.getBoundingClientRect().height,
    ).toBeLessThanOrEqual(48);
    await page.getByRole("button", { name: "Browser tools" }).click();
    const menu = page.getByRole("menu").element();
    const contents = menu.querySelector(".overflow-y-auto")!;
    expect(contents.scrollWidth).toBeLessThanOrEqual(contents.clientWidth);
    await page.getByRole("menuitemradio", { name: "Mobile" }).click();
    expect(useCompanionSurfaceStore.getState().workspaces[scope]?.tabs[0]?.viewportWidth).toBe(390);
    await page.getByRole("menuitem", { name: "Zoom in" }).click();
    expect(bridge.setBrowserZoomFactor).toHaveBeenCalledWith({
      projectId: "project",
      sessionId,
      zoomFactor: 1.1,
    });
  } finally {
    await view.unmount();
  }
});
it("detaches the native page on panel close and restores its existing session on reopen", async () => {
  const view = await render(<Harness />);
  try {
    await vi.waitFor(() => expect(bridge.activateBrowserSession).toHaveBeenCalledOnce());
    await page.getByRole("button", { name: "Browser tools" }).click();
    await vi.waitFor(() => expect(bridge.hideBrowserSession).toHaveBeenCalled());
    await view.rerender(<Harness visible={false} />);
    await vi.waitFor(() =>
      expect(bridge.setBrowserBounds).toHaveBeenLastCalledWith(
        expect.objectContaining({ projectId: "project", sessionId, visible: false }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(bridge.activateBrowserSession).toHaveBeenCalledOnce();
    expect(document.querySelector(".companion-browser-host")).toBeNull();
    await view.rerender(<Harness />);
    await expect.element(page.getByLabelText("Browser URL")).toHaveValue("example.test/preserved");
    await vi.waitFor(() => expect(bridge.activateBrowserSession).toHaveBeenCalledTimes(2));
    expect(bridge.activateBrowserSession).toHaveBeenLastCalledWith({
      projectId: "project",
      sessionId,
    });
  } finally {
    await view.unmount();
  }
});
it("does not resurrect a page when startup finishes after its panel closes", async () => {
  let finish!: () => void;
  bridge.ensureBrowserSession.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = await render(<Harness />);
  try {
    await vi.waitFor(() => expect(finish).toBeDefined());
    await view.rerender(<Harness visible={false} />);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(bridge.activateBrowserSession).not.toHaveBeenCalled();
    expect(bridge.setBrowserBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId, visible: false }),
    );
  } finally {
    await view.unmount();
  }
});

it("opens a new tab on the start page and only loads once an address is chosen", async () => {
  useCompanionSurfaceStore.setState({ workspaces: {} });
  useCompanionSurfaceStore.getState().open(scope, "browser");
  const view = await render(<Harness />);
  try {
    const field = page.getByRole("textbox", { name: "Search or enter address" });
    await expect.element(field).toBeVisible();
    expect(bridge.ensureBrowserSession).not.toHaveBeenCalled();
    await userEvent.type(field, "5173{Enter}");
    await vi.waitFor(() =>
      expect(bridge.ensureBrowserSession).toHaveBeenCalledWith(
        expect.objectContaining({ initialUrl: "http://localhost:5173/" }),
      ),
    );
  } finally {
    await view.unmount();
  }
});

async function renderSelectionBrowser(threadId: ThreadId) {
  const surfaceId = useCompanionSurfaceStore
    .getState()
    .open(`${testEnvironment}:${threadId}`, "browser", {
      url: "https://example.test/excerpt",
      profileId: "work",
    });
  sessionId = `agents-surface-${surfaceId}`;
  const state = {
    ...emptyBrowserState("project", sessionId),
    currentUrl: "https://example.test/excerpt",
    profileId: "work",
    instanceId: "original-browser",
    pageRef: "a".repeat(64),
  };
  const text = "  Selected heading\n$20.00  ";
  bridge.getBrowserSessionState.mockResolvedValue(state);
  bridge.runBrowserAutomation.mockResolvedValue({ text });
  const previousEnvironment = getPrimaryEnvironmentId();
  setPrimaryEnvironmentIdForTesting(testEnvironment);
  const view = await render(
    <RightPanelTabs
      mode="sidebar"
      environmentId={testEnvironment}
      threadId={threadId}
      onClose={() => {}}
    />,
  );
  const scoped = scopedComposerThreadId(testEnvironment, threadId);
  return {
    state,
    surfaceId,
    text,
    files: () => useComposerDraftStore.getState().draftsByThreadId[scoped]?.files ?? [],
    async close() {
      setPrimaryEnvironmentIdForTesting(previousEnvironment);
      await view.unmount();
    },
  };
}

async function openSelectionReview() {
  await page.getByRole("button", { name: "Browser tools" }).click();
  await page.getByRole("menuitem", { name: "Review browser selection" }).click();
  const review = page.getByRole("dialog", { name: "Review browser selection" });
  await expect.element(review.getByLabelText("Selected browser text")).toBeVisible();
  return review;
}

it("reviews an exact browser selection from the keyboard and adds only the approved excerpt", async () => {
  const threadId = ThreadId.make("browser-excerpt");
  const { text, state, surfaceId, files, close } = await renderSelectionBrowser(threadId);
  try {
    const tools = page.getByRole("button", { name: "Browser tools" });
    await expect.element(tools).toBeEnabled();
    (tools.element() as HTMLButtonElement).focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(page.getByRole("menu")).toBeVisible();
    await userEvent.keyboard("review");
    await expect
      .element(page.getByRole("menuitem", { name: "Review browser selection" }))
      .toHaveFocus();
    await userEvent.keyboard("{Enter}");
    const review = page.getByRole("dialog", { name: "Review browser selection" });
    await expect.element(review.getByLabelText("Selected browser text")).toBeVisible();
    expect(review.getByLabelText("Selected browser text").element().textContent).toBe(text);
    expect(files()).toHaveLength(0);
    await userEvent.keyboard("{Escape}");
    await expect.element(review).not.toBeInTheDocument();
    expect(files()).toHaveLength(0);

    const location = { environmentId: testEnvironment, projectId: "project", threadId };
    const requestReview = (target: BrowserSelectionReviewTarget) =>
      window.dispatchEvent(
        new CustomEvent<BrowserSelectionReviewTarget>(BROWSER_SELECTION_REVIEW_EVENT, {
          cancelable: true,
          detail: target,
        }),
      );
    expect(requestReview({ location, sessionId: "other-browser" })).toBe(true);
    expect(
      requestReview({
        sessionId,
        location: { ...location, threadId: ThreadId.make("other-thread") },
      }),
    ).toBe(true);
    expect(bridge.runBrowserAutomation).toHaveBeenCalledOnce();
    expect(requestReview({ location, sessionId })).toBe(false);
    await review.getByRole("button", { name: "Add to draft" }).click();
    await vi.waitFor(() => expect(files()).toHaveLength(1));
    expect(JSON.parse(await files()[0]!.file.text())).toMatchObject({
      environmentId: testEnvironment,
      projectId: "project",
      threadId,
      surfaceId,
      browserInstanceId: state.instanceId,
      pageRef: state.pageRef,
      target: { kind: "browser-excerpt", tabId: sessionId, profileId: "work" },
      text,
    });
    const request = {
      projectId: "project",
      sessionId,
      taskId: threadId,
      source: "human",
      operation: "readBrowserSelection",
      input: { pageRef: state.pageRef, instanceId: state.instanceId, profileId: "work" },
    };
    expect(bridge.runBrowserAutomation.mock.calls).toEqual([
      [request],
      [request],
      [{ ...request, operation: "captureAttachedPage" }],
    ]);
  } finally {
    await close();
  }
});

it.each([{ pageRef: "b".repeat(64) }, { instanceId: "replacement" }, { profileId: "personal" }])(
  "rejects an excerpt if desktop browser identity changes to %j",
  async (change) => {
    const threadId = ThreadId.make(`stale-browser-excerpt-${Object.keys(change)[0]}`);
    const { state, files, close } = await renderSelectionBrowser(threadId);
    try {
      const review = await openSelectionReview();
      bridge.getBrowserSessionState.mockResolvedValue({ ...state, ...change });
      await review.getByRole("button", { name: "Add to draft" }).click();
      await expect
        .element(review.getByRole("alert"))
        .toHaveTextContent("The browser tab, page or profile changed");
      expect(files()).toHaveLength(0);
      expect(bridge.runBrowserAutomation).toHaveBeenCalledOnce();
    } finally {
      await close();
    }
  },
);

it("cancels approval while the browser identity check is pending", async () => {
  const { state, files, close } = await renderSelectionBrowser(
    ThreadId.make("cancel-browser-excerpt"),
  );
  try {
    const review = await openSelectionReview();
    let resolveState!: (state: DesktopBrowserSessionState) => void;
    const pendingState = new Promise<DesktopBrowserSessionState>((resolve) => {
      resolveState = resolve;
    });
    bridge.getBrowserSessionState.mockReturnValueOnce(pendingState);
    await review.getByRole("button", { name: "Add to draft" }).click();
    await expect.element(review.getByRole("button", { name: "Checking page…" })).toBeDisabled();
    await review.getByRole("button", { name: "Cancel" }).click();
    resolveState(state);
    await pendingState;
    await expect.element(review).not.toBeInTheDocument();
    expect(files()).toHaveLength(0);
  } finally {
    await close();
  }
});

const pairAction = "Attach both first-difference screenshots";
const pairGrantIds = [
  "692cb917-ea45-49cb-b0b5-cebec45d66ca",
  "62976210-4a24-48ef-a66a-79e5a732afc8",
];

function savedComparison(runId: string, step: number) {
  return {
    runId,
    phase: "stopped",
    savedAt: "2026-11-25T00:00:00.000Z",
    source: {
      name: "Checkout iPhone",
      hostId: "ios-lab",
      deviceId: "ios-42",
      platform: "ios",
      appId: "com.apple.mobilesafari",
    },
    target: {
      name: "Checkout Pixel",
      hostId: "android-lab",
      deviceId: "android-24",
      platform: "android",
      appId: "com.android.chrome",
    },
    firstDifference: { step, kind: "total", reason: "The totals differ." },
    busy: false,
    playing: false,
    completedSteps: step - 1,
    steps: Array.from({ length: step }, () => ({ label: "Continue" })),
    canResume: false,
    uncertainTap: false,
  } satisfies DeviceComparisonReport;
}

async function renderScreenshotPairBrowser(threadId: ThreadId) {
  const threadScope = `${testEnvironment}:${threadId}`;
  const store = useCompanionSurfaceStore.getState();
  const url = "https://example.test/evidence/draft?draft=24";
  const surfaceId = store.open(threadScope, "browser", { url, profileId: "work" });
  useRightPanelStore.getState().openPanel("browser");
  sessionId = `agents-surface-${surfaceId}`;
  const pageRef = "a".repeat(64);
  const instanceId = "live-browser";
  const pageApprovalToken = "reviewed-screenshot-pair";
  bridge.getBrowserSessionState.mockResolvedValue({
    ...emptyBrowserState("project", sessionId),
    currentUrl: url,
    pageRef,
    instanceId,
    pageApprovalToken,
    pageTitle: "Upload evidence",
    profileId: "work",
  } as DesktopBrowserSessionState);
  bridge.runBrowserAutomation.mockResolvedValue({ grantIds: pairGrantIds });
  const previousEnvironment = getPrimaryEnvironmentId();
  setPrimaryEnvironmentIdForTesting(testEnvironment);
  const view = await render(
    <>
      <RightPanelTabs
        mode="sidebar"
        environmentId={testEnvironment}
        threadId={threadId}
        onClose={() => {}}
      />
      <GlobalConfirmDialog />
    </>,
  );
  const scoped = scopedComposerThreadId(testEnvironment, threadId);
  return {
    url,
    surfaceId,
    instanceId,
    pageApprovalToken,
    pageRef,
    scoped,
    tools: page.getByRole("button", { name: "Browser tools" }),
    files: () => useComposerDraftStore.getState().draftsByThreadId[scoped]?.files ?? [],
    async close() {
      setPrimaryEnvironmentIdForTesting(previousEnvironment);
      await view.unmount();
      useComposerDraftStore.getState().clearDraftThread(scoped);
    },
  };
}
