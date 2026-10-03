import {
  PREVIEW_AUTOMATION_OPERATIONS,
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
import { useEffect } from "react";

import { readNativeApi } from "../nativeApi";
import { appAtomRegistry } from "../state/atomRegistry";
import { readModelStateAtom } from "../state/readModel";
import { workspaceShellActions } from "../state/workspaceShell";

const SUPPORTED_OPERATIONS = PREVIEW_AUTOMATION_OPERATIONS;

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
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxFrameRate: 30,
      },
    } as MediaTrackConstraints,
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
    error: {
      _tag: "PreviewAutomationExecutionError",
      message: cause instanceof Error ? cause.message : String(cause),
    },
  };
}

export function NativePreviewAutomationHost() {
  useEffect(() => {
    const api = readNativeApi();
    const bridge = window.desktopBridge;
    if (!api || !bridge) return;
    const clientId = `tabs-desktop-${crypto.randomUUID()}`;
    let disposed = false;
    let connectionId: string | null = null;
    const previewTargets = new Map<
      string,
      { threadId: PreviewAutomationRequest["threadId"]; tabId: string }
    >();
    const lastReportedState = new Map<string, string>();

    const unsubscribeState = bridge.onBrowserSessionState((state) => {
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

    const run = async (request: PreviewAutomationRequest): Promise<unknown> => {
      const thread = appAtomRegistry
        .get(readModelStateAtom)
        .threads.find((candidate) => candidate.id === request.threadId);
      if (!thread) throw new Error(`Thread ${request.threadId} is not available in this client.`);
      const sessionId = request.tabId ?? `agent-${request.threadId}`;
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
          taskId: request.threadId,
          temporaryAgentTab: true,
        });
        if (input.show !== false) {
          await bridge.activateBrowserSession({
            projectId: thread.projectId,
            sessionId,
          });
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
        return bridge.runBrowserAutomation({
          taskId: request.threadId,
          source: "agent",
          projectId: thread.projectId,
          sessionId,
          operation: "status",
        });
      }
      // Carry the same control epoch through operations that use renderer APIs.
      const control = (await bridge.runBrowserAutomation({
        projectId: thread.projectId,
        sessionId,
        source: "agent",
        taskId: request.threadId,
        operation: "assertControl",
      })) as { controlEpoch: number };
      const checkControl = () =>
        bridge.runBrowserAutomation({
          projectId: thread.projectId,
          sessionId,
          source: "agent",
          taskId: request.threadId,
          operation: "assertControl",
          input: control,
        });
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
      return bridge.runBrowserAutomation({
        taskId: request.threadId,
        source: "agent",
        projectId: thread.projectId,
        sessionId,
        operation: request.operation,
        input,
      });
    };

    let unsubscribe = () => {};
    void api.server
      .getConfig()
      .then((config) => {
        if (disposed) return;
        unsubscribe = api.preview.automation.connect(
          {
            clientId,
            environmentId: config.environment.environmentId,
            supportedOperations: SUPPORTED_OPERATIONS,
          },
          (event) => {
            if (event.type === "connected") {
              connectionId = event.connectionId;
              return;
            }
            const responseConnectionId = event.connectionId || connectionId;
            if (!responseConnectionId) return;
            void run(event.request)
              .then((result) =>
                api.preview.automation.respond({
                  clientId,
                  connectionId: responseConnectionId,
                  requestId: event.request.requestId,
                  ok: true,
                  result,
                }),
              )
              .catch((cause) =>
                api.preview.automation.respond(
                  errorResponse(clientId, responseConnectionId, event.request, cause),
                ),
              );
          },
        );
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
      unsubscribeState();
    };
  }, []);

  return null;
}
