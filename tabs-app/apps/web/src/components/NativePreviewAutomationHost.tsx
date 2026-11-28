import { isUserBrowserTab } from "@tabs/shared/preview";
import {
  BrowserQuickActionRequestInput,
  BrowserQuickActionResult,
  BrowserQuickActionVerifiedRepair,
  BrowserWorkflowBrowserRequest,
  PREVIEW_AUTOMATION_OPERATIONS,
  PreviewAutomationQuickActionLookupError,
  type BrowserQuickActionApprovalRequired,
  type BrowserWorkflowHostResult,
  type EnvironmentId,
  type DesktopBrowserSessionState,
  type PreviewAutomationResizeInput,
  type PreviewAutomationResizeResult,
  type PreviewAutomationRecordingArtifact,
  type PreviewAutomationRecordingStatus,
  type PreviewAutomationRequest,
  type PreviewAutomationResponse,
  type PreviewReportStatusInput,
  type PreviewViewportPresetId,
  type PreviewViewportSetting,
} from "@tabs/contracts";
import * as Schema from "effect/Schema";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { saveVerifiedBrowserQuickActionRepair } from "../lib/browserQuickActionRepair";
import {
  createBrowserWorkflowResultPresenter,
  readBrowserWorkflowReceipt,
} from "../lib/browserWorkflowResult";

import { readNativeApi } from "../nativeApi";
import { appAtomRegistry } from "../state/atomRegistry";
import { readModelStateAtom } from "../state/readModel";
import { clientSettingsAtom } from "../state/settings";
import { workspaceShellActions } from "../state/workspaceShell";
import { useWorkspaceShellStore } from "../workspaceShellStore";

const SUPPORTED_OPERATIONS = PREVIEW_AUTOMATION_OPERATIONS;
const decodeQuickActionRequest = Schema.decodeUnknownSync(BrowserQuickActionRequestInput);
const isQuickActionResult = Schema.is(BrowserQuickActionResult);
const decodeVerifiedRepair = Schema.decodeUnknownOption(BrowserQuickActionVerifiedRepair);

function automationThread(
  environmentId: EnvironmentId,
  threadId: PreviewAutomationRequest["threadId"],
) {
  const thread = appAtomRegistry
    .get(readModelStateAtom)
    .threads.find(
      (candidate) => candidate.id === threadId && candidate.environmentId === environmentId,
    );
  if (!thread) throw new Error(`Thread ${threadId} is not available in this environment.`);
  return thread;
}

export function requestBrowserQuickAction(
  environmentId: EnvironmentId,
  request: Pick<PreviewAutomationRequest, "threadId" | "tabId" | "tabIdExplicit" | "input">,
): BrowserQuickActionApprovalRequired {
  const thread = automationThread(environmentId, request.threadId);
  if (request.tabId !== undefined || request.tabIdExplicit) {
    throw new Error("A Quick Action approval request accepts only the action name.");
  }
  const { actionName } = decodeQuickActionRequest(request.input);
  const name = actionName.toLowerCase();
  const project = useWorkspaceShellStore.getState().projectSettingsByProjectId[thread.projectId];
  const matches =
    project?.browserQuickActions?.filter((action) => action.label.trim().toLowerCase() === name) ??
    [];
  const [match] = matches;
  if (!match) throw new PreviewAutomationQuickActionLookupError({ reason: "missing" });
  if (matches.length > 1) {
    throw new PreviewAutomationQuickActionLookupError({ reason: "ambiguous" });
  }
  return { status: "approval_required", actionId: match.id };
}

interface ActiveBrowserRecording {
  readonly recorder: MediaRecorder;
  readonly stream: MediaStream;
  readonly chunks: Blob[];
  readonly startedAt: string;
}

const activeRecordings = new Map<string, ActiveBrowserRecording>();

export function isNativeBrowserRecordingActive(projectId: string, sessionId: string): boolean {
  return activeRecordings.has(recordingKey(projectId, sessionId));
}

export function buildPreviewStatusReport(
  state: DesktopBrowserSessionState,
  target: { threadId: PreviewReportStatusInput["threadId"]; tabId: string },
): PreviewReportStatusInput | null {
  if (!state.currentUrl) return null;
  // A signed-in companion tab reports through scoped status requests only. Unsolicited
  // navigation events can carry callback parameters or the next account's title.
  if (isUserBrowserTab(state.sessionId)) return null;
  const title = state.pageTitle ?? "";
  return {
    threadId: target.threadId,
    tabId: target.tabId,
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    navStatus: state.lastError
      ? {
          _tag: "LoadFailed",
          url: state.currentUrl,
          title,
          code: -1,
          description: state.lastError,
        }
      : {
          _tag: state.loading ? "Loading" : "Success",
          url: state.currentUrl,
          title,
        },
  };
}

function recordingKey(projectId: string, sessionId: string): string {
  return `${projectId}::${sessionId}`;
}

function preferredRecordingMimeType(): string | undefined {
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
  );
}

/** How the screen capture is asked for: from this browser tab's source, at the chosen frame rate. */
export function browserRecordingVideoConstraints(
  sourceId: string,
  frameRate: number | undefined,
): MediaTrackConstraints {
  return {
    mandatory: {
      chromeMediaSource: "desktop",
      chromeMediaSourceId: sourceId,
      maxFrameRate: frameRate === 60 ? 60 : 30,
    },
  } as MediaTrackConstraints;
}

export async function startNativeBrowserRecording(
  bridge: NonNullable<Window["desktopBridge"]>,
  projectId: string,
  sessionId: string,
  checkControl: () => Promise<unknown> = async () => undefined,
): Promise<PreviewAutomationRecordingStatus> {
  const key = recordingKey(projectId, sessionId);
  const existing = activeRecordings.get(key);
  if (existing) return { tabId: sessionId, recording: true, startedAt: existing.startedAt };
  const sourceId = await bridge.getBrowserMediaSourceId({
    projectId,
    sessionId,
  });
  await checkControl();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: browserRecordingVideoConstraints(
      sourceId,
      appAtomRegistry.get(clientSettingsAtom).browserRecordingFrameRate,
    ),
  });
  try {
    await checkControl();
    const mimeType = preferredRecordingMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    const startedAt = new Date().toISOString();
    recorder.start(1_000);
    activeRecordings.set(key, { recorder, stream, chunks, startedAt });
    return { tabId: sessionId, recording: true, startedAt };
  } catch (cause) {
    for (const track of stream.getTracks()) track.stop();
    throw cause;
  }
}

export async function stopNativeBrowserRecording(
  bridge: NonNullable<Window["desktopBridge"]>,
  projectId: string,
  sessionId: string,
): Promise<PreviewAutomationRecordingArtifact> {
  const key = recordingKey(projectId, sessionId);
  const active = activeRecordings.get(key);
  if (!active) throw new Error(`No browser recording is active for tab ${sessionId}.`);
  try {
    if (active.recorder.state !== "inactive") {
      await new Promise<void>((resolve, reject) => {
        active.recorder.addEventListener("stop", () => resolve(), {
          once: true,
        });
        active.recorder.addEventListener(
          "error",
          (event) =>
            reject(
              (event as Event & { error?: DOMException }).error ??
                new Error("The browser recording failed."),
            ),
          { once: true },
        );
        active.recorder.stop();
      });
    }
    const mimeType = active.recorder.mimeType || active.chunks[0]?.type || "video/webm";
    const data = new Uint8Array(await new Blob(active.chunks, { type: mimeType }).arrayBuffer());
    if (data.byteLength === 0) throw new Error("The browser recording did not produce video data.");
    return await bridge.saveBrowserRecording({
      projectId,
      sessionId,
      mimeType,
      data,
    });
  } finally {
    activeRecordings.delete(key);
    for (const track of active.stream.getTracks()) track.stop();
  }
}

const PREVIEW_PRESET_SIZES = {
  "iphone-se": [375, 667],
  "iphone-xr": [414, 896],
  "iphone-12-pro": [390, 844],
  "iphone-14-pro-max": [430, 932],
  "pixel-7": [412, 915],
  "samsung-galaxy-s8-plus": [360, 740],
  "samsung-galaxy-s20-ultra": [412, 915],
  "ipad-mini": [768, 1024],
  "ipad-air": [820, 1180],
  "ipad-pro": [1024, 1366],
  "surface-pro-7": [912, 1368],
  "surface-duo": [540, 720],
  "galaxy-z-fold-5": [344, 882],
  "asus-zenbook-fold": [853, 1280],
  "samsung-galaxy-a51-71": [412, 914],
  "nest-hub": [1024, 600],
  "nest-hub-max": [1280, 800],
} as const satisfies Record<PreviewViewportPresetId, readonly [number, number]>;

export function resolveAutomationViewport(
  input: PreviewAutomationResizeInput,
): PreviewViewportSetting {
  if (input.mode === "fill") return { _tag: "fill" };
  if (input.mode === "freeform") {
    if (input.width === undefined || input.height === undefined) {
      throw new Error("Freeform browser resize requires width and height.");
    }
    return { _tag: "freeform", width: input.width, height: input.height };
  }
  if (input.preset === undefined) throw new Error("Preset browser resize requires a preset.");
  const [nativeWidth, nativeHeight] = PREVIEW_PRESET_SIZES[input.preset];
  const nativePortrait = nativeHeight >= nativeWidth;
  const swap =
    (input.orientation === "landscape" && nativePortrait) ||
    (input.orientation === "portrait" && !nativePortrait);
  return {
    _tag: "preset",
    presetId: input.preset,
    width: swap ? nativeHeight : nativeWidth,
    height: swap ? nativeWidth : nativeHeight,
  };
}

async function waitForViewport(
  bridge: NonNullable<Window["desktopBridge"]>,
  projectId: string,
  sessionId: string,
  setting: PreviewViewportSetting,
  timeoutMs: number,
  taskId: string,
  controlEpoch: number,
): Promise<{ width: number; height: number }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    await bridge.runBrowserAutomation({
      projectId,
      sessionId,
      taskId,
      source: "agent",
      operation: "assertControl",
      input: { controlEpoch },
    });
    const status = (await bridge.runBrowserAutomation({
      projectId,
      sessionId,
      taskId,
      source: "agent",
      operation: "status",
    })) as { viewport?: { width: number; height: number } };
    if (
      status.viewport &&
      (setting._tag === "fill" ||
        (status.viewport.width === setting.width && status.viewport.height === setting.height))
    ) {
      return status.viewport;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Browser viewport did not settle within ${timeoutMs}ms.`);
}

function errorResponse(
  clientId: string,
  connectionId: string,
  request: PreviewAutomationRequest,
  cause: unknown,
): PreviewAutomationResponse {
  return {
    clientId,
    connectionId,
    requestId: request.requestId,
    ok: false,
    error:
      cause instanceof PreviewAutomationQuickActionLookupError
        ? { _tag: cause._tag, message: cause.message, detail: cause.reason }
        : {
            _tag: "PreviewAutomationExecutionError",
            message: cause instanceof Error ? cause.message : String(cause),
          },
  };
}

export function NativePreviewAutomationHost() {
  const navigate = useNavigate();
  useEffect(() => {
    const api = readNativeApi();
    const bridge = window.desktopBridge;
    if (!api || !bridge) return;
    const clientId = `tabs-desktop-${crypto.randomUUID()}`;
    let disposed = false;
    let connectionId: string | null = null;
    let environmentId: EnvironmentId;
    const presentWorkflowResult = createBrowserWorkflowResultPresenter(
      bridge,
      (environmentId, threadId) =>
        navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId },
        }),
    );
    const previewTargets = new Map<
      string,
      { threadId: PreviewAutomationRequest["threadId"]; tabId: string }
    >();
    const lastReportedState = new Map<string, string>();
    let hostReport: ReturnType<typeof setTimeout> | undefined;
    let hostReportRevision = 0;
    let lastHostReport = "";
    const resetConnection = () => {
      connectionId = null;
      hostReportRevision++;
      clearTimeout(hostReport);
    };
    const scheduleHostReport = () => {
      const list = bridge.listBrowserWorkflowTabs;
      if (!connectionId || !list || !api.preview.automation.focusHost) return;
      const revision = ++hostReportRevision;
      clearTimeout(hostReport);
      hostReport = setTimeout(() => {
        void list()
          .then(async (liveTabs) => {
            if (disposed || revision !== hostReportRevision || !connectionId) return;
            const focused = document.hasFocus();
            const signature = JSON.stringify([connectionId, focused, liveTabs]);
            if (signature === lastHostReport) return;
            await api.preview.automation.focusHost({
              clientId,
              connectionId,
              environmentId,
              focused,
              liveTabs,
            });
            if (revision === hostReportRevision) lastHostReport = signature;
          })
          .catch(() => undefined);
      }, 100);
    };
    window.addEventListener("focus", scheduleHostReport);
    window.addEventListener("blur", scheduleHostReport);

    const unsubscribeState = bridge.onBrowserSessionState((state) => {
      if (isUserBrowserTab(state.sessionId)) scheduleHostReport();
      const key = recordingKey(state.projectId, state.sessionId);
      const target = previewTargets.get(key);
      if (!target) return;
      const report = buildPreviewStatusReport(state, target);
      if (!report) return;
      const signature = JSON.stringify([
        state.currentUrl,
        state.pageTitle,
        state.loading,
        state.canGoBack,
        state.canGoForward,
        state.lastError,
      ]);
      if (lastReportedState.get(key) === signature) return;
      lastReportedState.set(key, signature);
      void api.preview.reportStatus(report).catch(() => {
        lastReportedState.delete(key);
      });
    });

    const run = async (
      request: PreviewAutomationRequest,
      responseConnectionId: string,
    ): Promise<unknown> => {
      const assertConnection = () => {
        if (disposed || connectionId !== responseConnectionId)
          throw new Error("The browser automation connection changed.");
      };
      if (request.operation === "requestQuickAction") {
        return requestBrowserQuickAction(environmentId, request);
      }
      const thread = automationThread(environmentId, request.threadId);
      if (request.operation === "readWorkflowReceipt") {
        assertConnection();
        return readBrowserWorkflowReceipt(bridge, environmentId, thread.projectId, request);
      }
      if (request.operation === "runQuickAction") {
        const { threadId, tabId, input } = request;
        const { projectId } = thread;
        if (!request.tabIdExplicit || !tabId)
          throw new Error("Provide the exact tab ID from the user's Quick Actions approval.");
        const actionId =
          typeof input === "object" && input !== null && "actionId" in input
            ? input.actionId
            : undefined;
        const response = await bridge.runBrowserAutomation({
          source: "agent",
          taskId: threadId,
          projectId,
          sessionId: tabId,
          operation: "runQuickAction",
          input,
        });
        if (typeof response !== "object" || response === null || !("verifiedRepair" in response))
          return response;

        const { verifiedRepair, ...result } = response;
        if (
          disposed ||
          connectionId !== responseConnectionId ||
          !isQuickActionResult(result) ||
          result.status !== "pass" ||
          !result.fileReceipt ||
          result.fileResult?.tabId !== tabId ||
          result.fileResult.filename !== result.fileReceipt.filename
        )
          return result;

        const repair = decodeVerifiedRepair(verifiedRepair);
        if (
          repair._tag === "None" ||
          repair.value.previous.id !== actionId ||
          repair.value.replacement.id !== actionId
        )
          return result;

        const { projects, threads } = appAtomRegistry.get(readModelStateAtom);
        const [project, ...duplicates] = projects.filter((candidate) => candidate.id === projectId);
        if (
          project?.environmentId === environmentId &&
          duplicates.length === 0 &&
          threads.some(
            (candidate) =>
              candidate.id === threadId &&
              candidate.environmentId === environmentId &&
              candidate.projectId === projectId,
          )
        ) {
          saveVerifiedBrowserQuickActionRepair(projectId, repair.value);
        }
        return result;
      }
      const sessionId = request.tabId ?? `agent-${request.threadId}`;
      if (!isUserBrowserTab(sessionId))
        previewTargets.set(recordingKey(thread.projectId, sessionId), {
          threadId: request.threadId,
          tabId: sessionId,
        });
      const input =
        typeof request.input === "object" && request.input !== null
          ? (request.input as Record<string, unknown>)
          : {};

      if (request.operation === "open") {
        const url = typeof input.url === "string" ? input.url : "";
        await bridge.ensureBrowserSession({
          projectId: thread.projectId,
          sessionId,
          initialUrl: url,
          requireExisting: request.tabIdExplicit === true,
          taskId: request.threadId,
          temporaryAgentTab: true,
        });
        assertConnection();
        if (input.show !== false && !isUserBrowserTab(sessionId)) {
          await bridge.activateBrowserSession({
            projectId: thread.projectId,
            sessionId,
          });
          assertConnection();
        }
        return bridge.runBrowserAutomation({
          taskId: request.threadId,
          source: "agent",
          projectId: thread.projectId,
          sessionId,
          operation: "status",
        });
      }
      if (request.operation === "navigate") {
        const url = typeof input.url === "string" ? input.url : null;
        if (!url) throw new Error("Native preview navigation requires a resolved URL.");
        await bridge.runBrowserAutomation({
          source: "agent",
          taskId: request.threadId,
          operation: "navigate",
          input: { url },
          projectId: thread.projectId,
          sessionId,
        });
        assertConnection();
        return bridge.runBrowserAutomation({
          taskId: request.threadId,
          source: "agent",
          projectId: thread.projectId,
          sessionId,
          operation: "status",
        });
      }
      if (request.operation === "deviceScreenshotUpload") {
        assertConnection();
        const transfer = {
          source: "agent",
          taskId: request.threadId,
          projectId: thread.projectId,
          sessionId,
          operation: request.operation,
          input,
        } as const;
        if (
          typeof input === "object" &&
          input !== null &&
          "phase" in input &&
          input.phase === "inspect"
        )
          return bridge.runBrowserAutomation(transfer);
        if (!bridge.runDeviceScreenshotTransfer)
          throw new Error("Update the desktop to transfer device screenshots.");
        const authorization = {
          clientId,
          connectionId: responseConnectionId,
          requestId: request.requestId,
        };
        return bridge.runDeviceScreenshotTransfer(transfer, async () => {
          assertConnection();
          const approved = await api.preview.automation.authorizeDeviceScreenshot(authorization);
          assertConnection();
          return approved;
        });
      }
      if (
        isUserBrowserTab(sessionId) &&
        (request.operation === "recordingStart" || request.operation === "recordingStop")
      )
        throw new Error("Use Browser tools to record this signed-in tab yourself.");
      // Carry the same control epoch through operations that use renderer APIs.
      let control: { controlEpoch: number };
      try {
        control = (await bridge.runBrowserAutomation({
          projectId: thread.projectId,
          sessionId,
          source: "agent",
          taskId: request.threadId,
          operation: "assertControl",
        })) as { controlEpoch: number };
      } catch (cause) {
        if (
          request.operation !== "browserWorkflow" ||
          !Schema.is(BrowserWorkflowBrowserRequest)(input)
        )
          throw cause;
        const { phase, target } = input;
        if (
          (phase !== "upload" && phase !== "submit") ||
          !request.tabIdExplicit ||
          target?.tabId !== sessionId ||
          target.projectId !== thread.projectId
        )
          throw cause;
        // The write was never sent to Electron. The journal can release this reservation.
        return {
          disposition: "unobservable",
          target,
          reason: "The original browser tab was unavailable for agent input before dispatch.",
        } satisfies BrowserWorkflowHostResult;
      }
      assertConnection();
      const checkControl = () => {
        assertConnection();
        return bridge.runBrowserAutomation({
          projectId: thread.projectId,
          sessionId,
          source: "agent",
          taskId: request.threadId,
          operation: "assertControl",
          input: control,
        });
      };
      if (request.operation === "recordingStart") {
        return startNativeBrowserRecording(bridge, thread.projectId, sessionId, checkControl);
      }
      if (request.operation === "recordingStop") {
        return stopNativeBrowserRecording(bridge, thread.projectId, sessionId);
      }
      if (request.operation === "resize") {
        const resizeInput = request.input as PreviewAutomationResizeInput;
        const setting = resolveAutomationViewport(resizeInput);
        workspaceShellActions.setBrowserViewport(
          thread.projectId,
          setting._tag === "fill"
            ? {
                devicePreset: "project-default",
                customWidth: null,
                customHeight: null,
                landscape: false,
              }
            : {
                devicePreset: "custom",
                customWidth: setting.width,
                customHeight: setting.height,
                landscape: false,
              },
          sessionId,
        );
        const viewport = await waitForViewport(
          bridge,
          thread.projectId,
          sessionId,
          setting,
          resizeInput.timeoutMs ?? 15_000,
          request.threadId,
          control.controlEpoch,
        );
        return {
          tabId: sessionId,
          setting,
          viewport,
        } satisfies PreviewAutomationResizeResult;
      }
      const response = await bridge.runBrowserAutomation({
        taskId: request.threadId,
        source: "agent",
        projectId: thread.projectId,
        sessionId,
        operation: request.operation,
        input,
      });
      if (request.operation === "browserWorkflow") {
        void Promise.resolve()
          .then(() => {
            assertConnection();
            return presentWorkflowResult(environmentId, request.threadId, input, response);
          })
          .catch(() => undefined);
      }
      return response;
    };

    let unsubscribe = () => {};
    void api.server
      .getConfig()
      .then((config) => {
        if (disposed) return;
        environmentId = config.environment.environmentId;
        unsubscribe = api.preview.automation.connect(
          {
            clientId,
            environmentId: config.environment.environmentId,
            supportedOperations: SUPPORTED_OPERATIONS,
            ...(bridge.runDeviceScreenshotTransfer && { deviceScreenshotAuthorization: true }),
          },
          (event) => {
            if (disposed) return;
            if (event.type === "connected") {
              connectionId = event.connectionId;
              scheduleHostReport();
              return;
            }
            const responseConnectionId = event.connectionId;
            if (responseConnectionId !== connectionId) return;
            void run(event.request, responseConnectionId)
              .then(
                (result) => {
                  if (disposed || responseConnectionId !== connectionId) return;
                  return api.preview.automation.respond({
                    clientId,
                    connectionId: responseConnectionId,
                    requestId: event.request.requestId,
                    ok: true,
                    result,
                  });
                },
                (cause) => {
                  if (disposed || responseConnectionId !== connectionId) return;
                  return api.preview.automation.respond(
                    errorResponse(clientId, responseConnectionId, event.request, cause),
                  );
                },
              )
              .catch(() => undefined);
          },
          { onDisconnect: resetConnection },
        );
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      resetConnection();
      window.removeEventListener("focus", scheduleHostReport);
      window.removeEventListener("blur", scheduleHostReport);
      unsubscribe();
      unsubscribeState();
    };
  }, [navigate]);

  return null;
}
