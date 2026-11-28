import {
  EnvironmentId,
  PreviewTabId,
  ProjectId,
  ThreadId,
  type BrowserQuickAction,
  type BrowserQuickActionResult,
  type BrowserQuickActionVerifiedRepair,
  type BrowserWorkflowBrowserRequest,
  type NativeApi,
  type DesktopBridge,
  type PreviewAutomationStreamEvent,
} from "@tabs/contracts";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { appAtomRegistry } from "../state/atomRegistry";
import { readModelStateAtom } from "../state/readModel";
import type { Thread } from "../types";
import {
  readPersistedProjectWorkspaceSettings,
  useWorkspaceShellStore,
} from "../workspaceShellStore";
import { NativePreviewAutomationHost } from "./NativePreviewAutomationHost";

const { navigate, readNativeApi } = vi.hoisted(() => ({
  navigate: vi.fn(),
  readNativeApi: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));
vi.mock("../nativeApi", async (original) => ({
  ...(await original<typeof import("../nativeApi")>()),
  readNativeApi,
}));

it("dispatches the exact environment's browser work and drops events from a retired connection", async () => {
  const environmentId = EnvironmentId.make("local-environment");
  const remoteEnvironment = EnvironmentId.make("remote-environment");
  const threadId = ThreadId.make("same-thread-id");
  const remoteOnlyThread = ThreadId.make("remote-thread");
  const work = ProjectId.make("work-project");
  const remote = ProjectId.make("remote-project");
  const tabId = PreviewTabId.make("agents-surface-work");
  const state = appAtomRegistry.get(readModelStateAtom);
  appAtomRegistry.set(readModelStateAtom, {
    ...state,
    threads: [
      { id: threadId, environmentId: remoteEnvironment, projectId: remote } as Thread,
      { id: threadId, environmentId, projectId: work } as Thread,
      { id: remoteOnlyThread, environmentId: remoteEnvironment, projectId: remote } as Thread,
    ],
  });

  const connect = vi.fn<NativeApi["preview"]["automation"]["connect"]>(() => () => undefined);
  const respond = vi.fn(async () => undefined);
  let finishScreenshotAuthorization!: (approved: boolean) => void;
  const pendingScreenshotAuthorization = new Promise<boolean>((resolve) => {
    finishScreenshotAuthorization = resolve;
  });
  const authorizeDeviceScreenshot = vi.fn<
    NativeApi["preview"]["automation"]["authorizeDeviceScreenshot"]
  >(async ({ requestId }) =>
    requestId === "checking-screenshot" ? pendingScreenshotAuthorization : true,
  );
  readNativeApi.mockReturnValue({
    server: { getConfig: async () => ({ environment: { environmentId } }) },
    preview: { automation: { connect, respond, authorizeDeviceScreenshot } },
  });
  let finishControlCheck!: (control: { controlEpoch: number }) => void;
  const pendingControl = new Promise<{ controlEpoch: number }>((resolve) => {
    finishControlCheck = resolve;
  });
  const runBrowserAutomation = vi.fn<DesktopBridge["runBrowserAutomation"]>(async (input) =>
    input.operation === "assertControl" ? pendingControl : { attached: true },
  );
  const applyScreenshot = vi.fn();
  const runDeviceScreenshotTransfer = vi.fn<
    NonNullable<DesktopBridge["runDeviceScreenshotTransfer"]>
  >(async (_input, authorize) => {
    const approved = await authorize();
    if (approved) applyScreenshot();
    return { attached: approved };
  });
  let finishOpen!: () => void;
  const pendingOpen = new Promise<void>((resolve) => {
    finishOpen = resolve;
  });
  const ensureBrowserSession = vi.fn(() => pendingOpen);
  const activateBrowserSession = vi.fn(async () => undefined);
  vi.stubGlobal("desktopBridge", {
    onBrowserSessionState: () => () => undefined,
    runBrowserAutomation,
    runDeviceScreenshotTransfer,
    ensureBrowserSession,
    activateBrowserSession,
  });

  const view = await render(<NativePreviewAutomationHost />);
  try {
    await expect.poll(() => connect.mock.calls.length).toBe(1);
    const [host, receive, options] = connect.mock.calls[0]!;
    expect(host.environmentId).toBe(environmentId);
    expect(host.deviceScreenshotAuthorization).toBe(true);
    const upload = (
      connectionId: string,
      requestId: string,
      owner = threadId,
    ): PreviewAutomationStreamEvent => ({
      type: "request",
      connectionId,
      request: {
        requestId,
        threadId: owner,
        operation: "deviceScreenshotUpload",
        timeoutMs: 15000,
        tabId,
        tabIdExplicit: true,
        input: { phase: "attach", selector: "#evidence", grantId: "work-grant" },
      },
    });

    receive(upload("connection-1", "before-connected"));
    receive({ type: "connected", connectionId: "connection-1" });
    receive(upload("connection-1", "wrong-environment", remoteOnlyThread));
    receive(upload("connection-1", "work-attachment"));
    await expect.poll(() => respond.mock.calls.length).toBe(2);
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "wrong-environment", ok: false }),
    );
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "work-attachment",
        connectionId: "connection-1",
        ok: true,
      }),
    );
    expect(runDeviceScreenshotTransfer).toHaveBeenCalledExactlyOnceWith(
      {
        source: "agent",
        taskId: threadId,
        projectId: work,
        sessionId: tabId,
        operation: "deviceScreenshotUpload",
        input: { phase: "attach", selector: "#evidence", grantId: "work-grant" },
      },
      expect.any(Function),
    );
    expect(authorizeDeviceScreenshot).toHaveBeenCalledExactlyOnceWith({
      clientId: host.clientId,
      connectionId: "connection-1",
      requestId: "work-attachment",
    });

    receive({
      type: "request",
      connectionId: "connection-1",
      request: {
        requestId: "opening-tab",
        threadId,
        operation: "open",
        timeoutMs: 15000,
        input: { url: "https://qa.example.test" },
      },
    });
    expect(ensureBrowserSession).toHaveBeenCalledOnce();
    receive({
      type: "request",
      connectionId: "connection-1",
      request: {
        requestId: "click-awaiting-control",
        threadId,
        operation: "click",
        timeoutMs: 15000,
        tabId,
        tabIdExplicit: true,
        input: { selector: "#save" },
      },
    });
    expect(runBrowserAutomation).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: work, sessionId: tabId, operation: "assertControl" }),
    );
    receive(upload("connection-1", "checking-screenshot"));
    await expect.poll(() => authorizeDeviceScreenshot.mock.calls.length).toBe(2);
    options?.onDisconnect?.();
    finishScreenshotAuthorization(true);
    finishOpen();
    finishControlCheck({ controlEpoch: 1 });
    receive(upload("connection-1", "between-connections"));
    receive({ type: "connected", connectionId: "connection-2" });
    receive(upload("connection-1", "retired-connection"));
    receive(upload("connection-2", "current-connection"));
    await expect.poll(() => respond.mock.calls.length).toBe(3);
    expect(respond).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestId: "current-connection",
        connectionId: "connection-2",
        ok: true,
      }),
    );
    expect(activateBrowserSession).not.toHaveBeenCalled();
    expect(runBrowserAutomation.mock.calls.map(([input]) => input.operation)).toEqual([
      "assertControl",
    ]);
    expect(runDeviceScreenshotTransfer).toHaveBeenCalledTimes(3);
    expect(applyScreenshot).toHaveBeenCalledTimes(2);
    expect(authorizeDeviceScreenshot).toHaveBeenLastCalledWith({
      clientId: host.clientId,
      connectionId: "connection-2",
      requestId: "current-connection",
    });

    const guardRequest: BrowserWorkflowBrowserRequest = {
      phase: "submit",
      profileId: "work",
      workflowId: "a".repeat(64),
      target: { projectId: work, tabId, profileId: "work", hostKey: "work-host" },
      definition: {
        url: "https://qa.example.test/draft/42",
        identitySelector: "#draft-id",
        resourceId: "42",
        statusSelector: "#status",
        submitSelector: "#submit",
        states: { uploaded: "Uploaded", submitted: "Submitted" },
        breakpoint: { selector: "#warning", pauseText: "Replace", clearText: "Clear" },
      },
    };
    const dispatchAttempt = (requestId: string) =>
      receive({
        type: "request",
        connectionId: "connection-2",
        request: {
          requestId,
          threadId,
          operation: "browserWorkflow",
          tabId,
          tabIdExplicit: true,
          timeoutMs: 15_000,
          input: guardRequest,
        },
      });
    runBrowserAutomation.mockClear();
    runBrowserAutomation.mockRejectedValueOnce(new Error("The user took control."));
    dispatchAttempt("taken-over");
    await expect.poll(() => respond.mock.calls.length).toBe(4);
    expect(respond).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestId: "taken-over",
        ok: true,
        result: expect.objectContaining({
          disposition: "unobservable",
          target: guardRequest.target,
        }),
      }),
    );
    expect(runBrowserAutomation.mock.calls.map(([input]) => input.operation)).toEqual([
      "assertControl",
    ]);

    // The first call is the control check; only the second rejection is ambiguous.
    runBrowserAutomation.mockReset();
    runBrowserAutomation.mockResolvedValueOnce({ controlEpoch: 1 });
    runBrowserAutomation.mockRejectedValueOnce(new Error("Lost receipt after forwarding input."));
    dispatchAttempt("lost-receipt");
    await expect.poll(() => respond.mock.calls.length).toBe(5);
    expect(respond).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestId: "lost-receipt",
        ok: false,
      }),
    );
    expect(runBrowserAutomation.mock.calls.map(([input]) => input.operation)).toEqual([
      "assertControl",
      "browserWorkflow",
    ]);
  } finally {
    await view.unmount();
    vi.unstubAllGlobals();
    readNativeApi.mockReset();
    appAtomRegistry.set(readModelStateAtom, state);
  }
});

it.each([
  "verified repair",
  "settings write failure",
  "concurrent edit",
  "concurrent deletion",
  "edit from another renderer",
  "changed thread project",
  "wrong result tab",
  "repair for another saved action",
  "wrong previous ID",
  "wrong replacement ID",
  "missing file receipt",
  "failed run",
  "lost connection",
] as const)("handles a Quick Action resume with %s", async (scenario) => {
  const environmentId = EnvironmentId.make("repair-environment");
  const threadId = ThreadId.make("repair-thread");
  const projectId = ProjectId.make("repair-project");
  const tabId = PreviewTabId.make("agents-surface-report");
  const otherId = "22ac10e4-6633-4c9a-9fb3-95d1dea01e0d";
  const previous: BrowserQuickAction = {
    id: "38d627ea-e2f6-4783-b8ca-b2a83f515994",
    label: "Save report",
    origin: "https://example.test",
    steps: [{ action: "click", selector: "#old" }],
    outcome: {
      selector: "#download",
      description: "Download ready",
      filenamePattern: "report.csv",
    },
  };
  const replacement = {
    ...previous,
    steps: [{ action: "click", selector: "#new" }],
  } satisfies BrowserQuickAction;
  const edited = {
    ...previous,
    steps: [{ action: "click", selector: "#user-edit" }],
  } satisfies BrowserQuickAction;
  const otherAction = { ...previous, id: otherId, label: "Archive report" };
  const verifiedRepair: BrowserQuickActionVerifiedRepair =
    scenario === "repair for another saved action"
      ? { previous: otherAction, replacement: { ...otherAction, steps: replacement.steps } }
      : {
          previous: { ...previous, id: scenario === "wrong previous ID" ? otherId : previous.id },
          replacement: {
            ...replacement,
            id: scenario === "wrong replacement ID" ? otherId : replacement.id,
          },
        };
  const result: BrowserQuickActionResult = {
    status: scenario === "failed run" ? "fail" : "pass",
    completedSteps: 1,
    message: "Run finished.",
    ...(scenario !== "missing file receipt" && {
      fileReceipt: { filename: "report.csv", byteLength: 42, sha256: "a".repeat(64) },
    }),
    fileResult: {
      resultId: "7435b78c-087f-4969-9d69-a413ef50228e",
      tabId: scenario === "wrong result tab" ? PreviewTabId.make("agents-surface-other") : tabId,
      profileId: "default",
      filename: "report.csv",
    },
  };

  const initialModel = appAtomRegistry.get(readModelStateAtom);
  const initialShell = useWorkspaceShellStore.getState();
  const thread = { id: threadId, projectId, environmentId } as Thread;
  const model = {
    ...initialModel,
    projects: [
      {
        id: projectId,
        environmentId,
        name: "Report project",
        cwd: "/work/report",
        defaultModelSelection: null,
        expanded: true,
        scripts: [],
      },
    ],
    threads: [thread],
  };
  appAtomRegistry.set(readModelStateAtom, model);
  initialShell.upsertProjectSettings(projectId, { browserQuickActions: [previous, otherAction] });

  const connect = vi.fn<NativeApi["preview"]["automation"]["connect"]>(() => () => undefined);
  const respond = vi.fn<NativeApi["preview"]["automation"]["respond"]>(async () => undefined);
  readNativeApi.mockReturnValue({
    server: { getConfig: async () => ({ environment: { environmentId } }) },
    preview: { automation: { connect, respond } },
  });
  let finishRun!: (
    response: BrowserQuickActionResult & { verifiedRepair: BrowserQuickActionVerifiedRepair },
  ) => void;
  const pendingRun = new Promise((resolve) => {
    finishRun = resolve;
  });
  const runBrowserAutomation = vi.fn<DesktopBridge["runBrowserAutomation"]>(() => pendingRun);
  vi.stubGlobal("desktopBridge", {
    onBrowserSessionState: () => () => undefined,
    runBrowserAutomation,
  });

  const view = await render(<NativePreviewAutomationHost />);
  let restoreStorageWrite: (() => void) | undefined;
  try {
    await expect.poll(() => connect.mock.calls.length).toBe(1);
    const [, receive, options] = connect.mock.calls[0]!;
    receive({ type: "connected", connectionId: "repair-connection" });
    const input = { actionId: previous.id, approvalId: "4d3be193-54ad-44dc-b5d4-061891316808" };
    receive({
      type: "request",
      connectionId: "repair-connection",
      request: {
        requestId: "repair-run",
        threadId,
        operation: "runQuickAction",
        tabId,
        tabIdExplicit: true,
        timeoutMs: 45000,
        input,
      },
    });
    expect(runBrowserAutomation).toHaveBeenCalledExactlyOnceWith({
      source: "agent",
      taskId: threadId,
      projectId,
      sessionId: tabId,
      operation: "runQuickAction",
      input,
    });

    let expected = [previous, otherAction];
    let expectedPersisted = expected;
    if (scenario === "concurrent edit" || scenario === "concurrent deletion") {
      expected = scenario === "concurrent edit" ? [edited, otherAction] : [otherAction];
      expectedPersisted = expected;
      initialShell.upsertProjectSettings(projectId, { browserQuickActions: expected });
    } else if (scenario === "edit from another renderer") {
      const storageKey = useWorkspaceShellStore.persist.getOptions().name!;
      const stored = JSON.parse(localStorage.getItem(storageKey)!);
      expectedPersisted = [edited, otherAction];
      stored.state.projectSettingsByProjectId[projectId].browserQuickActions = expectedPersisted;
      localStorage.setItem(storageKey, JSON.stringify(stored));
    } else if (scenario === "changed thread project") {
      appAtomRegistry.set(readModelStateAtom, {
        ...model,
        threads: [{ ...thread, projectId: ProjectId.make("new-project") }],
      });
    } else if (scenario === "lost connection") {
      options?.onDisconnect?.();
      receive({ type: "connected", connectionId: "next-connection" });
    } else if (scenario === "verified repair") {
      expected = expectedPersisted = [replacement, otherAction];
    } else if (scenario === "settings write failure") {
      const storageKey = useWorkspaceShellStore.persist.getOptions().name;
      const setItem = Storage.prototype.setItem;
      const storageWrite = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(function (this: Storage, key, value) {
          if (key === storageKey) throw new DOMException("Quota exceeded", "QuotaExceededError");
          setItem.call(this, key, value);
        });
      restoreStorageWrite = () => storageWrite.mockRestore();
    }

    finishRun({ ...result, verifiedRepair });
    if (scenario === "lost connection") {
      receive({
        type: "request",
        connectionId: "next-connection",
        request: {
          requestId: "next-request",
          threadId,
          operation: "requestQuickAction",
          timeoutMs: 15000,
          input: { actionName: previous.label },
        },
      });
      await expect.poll(() => respond.mock.calls[0]?.[0].requestId).toBe("next-request");
      expect(respond).toHaveBeenCalledTimes(1);
    } else {
      await expect.poll(() => respond.mock.calls.length).toBe(1);
      expect(respond.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ requestId: "repair-run", ok: true, result }),
      );
    }
    expect(
      useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId]?.browserQuickActions,
    ).toEqual(expected);
    expect(readPersistedProjectWorkspaceSettings(projectId)?.browserQuickActions).toEqual(
      expectedPersisted,
    );
  } finally {
    restoreStorageWrite?.();
    await view.unmount();
    vi.unstubAllGlobals();
    readNativeApi.mockReset();
    appAtomRegistry.set(readModelStateAtom, initialModel);
    useWorkspaceShellStore.setState(initialShell);
  }
});
