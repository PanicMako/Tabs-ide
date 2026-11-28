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
