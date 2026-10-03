import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadId } from "@tabs/contracts";

import {
  buildPreviewStatusReport,
  resolveAutomationViewport,
  startNativeBrowserRecording,
  stopNativeBrowserRecording,
} from "./NativePreviewAutomationHost";

const originalMediaRecorder = globalThis.MediaRecorder;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalMediaRecorder) globalThis.MediaRecorder = originalMediaRecorder;
});

describe("resolveAutomationViewport", () => {
  it("preserves fill mode", () => {
    expect(resolveAutomationViewport({ mode: "fill" })).toEqual({ _tag: "fill" });
  });

  it("preserves exact freeform dimensions", () => {
    expect(resolveAutomationViewport({ mode: "freeform", width: 1234, height: 777 })).toEqual({
      _tag: "freeform",
      width: 1234,
      height: 777,
    });
  });

  it("resolves the Chrome device catalog and applies landscape orientation", () => {
    expect(
      resolveAutomationViewport({
        mode: "preset",
        preset: "iphone-12-pro",
        orientation: "landscape",
      }),
    ).toEqual({
      _tag: "preset",
      presetId: "iphone-12-pro",
      width: 844,
      height: 390,
    });
  });

  it("does not rotate a landscape-native preset twice", () => {
    expect(
      resolveAutomationViewport({
        mode: "preset",
        preset: "nest-hub-max",
        orientation: "landscape",
      }),
    ).toEqual({
      _tag: "preset",
      presetId: "nest-hub-max",
      width: 1280,
      height: 800,
    });
  });
});

describe("buildPreviewStatusReport", () => {
  const threadId = ThreadId.make("thread-1");
  const state = {
    projectId: "project-1",
    sessionId: "tab-1",
    currentUrl: "https://example.com/dashboard",
    pageTitle: "Dashboard",
    loading: false,
    canGoBack: true,
    canGoForward: false,
    devToolsOpen: false,
    zoomFactor: 1,
    audioMuted: false,
    pictureInPicture: false,
    colorScheme: "system" as const,
    lastError: null,
    transientError: null,
  };

  it("reports human navigation and history state", () => {
    expect(buildPreviewStatusReport(state, { threadId, tabId: "tab-1" })).toEqual({
      threadId: "thread-1",
      tabId: "tab-1",
      canGoBack: true,
      canGoForward: false,
      navStatus: {
        _tag: "Success",
        url: "https://example.com/dashboard",
        title: "Dashboard",
      },
    });
  });

  it("reports native load failures instead of presenting stale success", () => {
    expect(
      buildPreviewStatusReport(
        { ...state, lastError: "ERR_NAME_NOT_RESOLVED" },
        { threadId, tabId: "tab-1" },
      ),
    ).toMatchObject({
      navStatus: {
        _tag: "LoadFailed",
        url: "https://example.com/dashboard",
        description: "ERR_NAME_NOT_RESOLVED",
      },
    });
  });
});

describe("native browser recording", () => {
  it("captures the native media source and persists the produced bytes", async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    class FakeMediaRecorder extends EventTarget {
      static isTypeSupported = () => true;
      state: RecordingState = "inactive";
      mimeType = "video/webm;codecs=vp9";
      start() {
        this.state = "recording";
      }
      stop() {
        this.dispatchEvent(
          Object.assign(new Event("dataavailable"), {
            data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }),
          }),
        );
        this.state = "inactive";
        this.dispatchEvent(new Event("stop"));
      }
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    const bridge = {
      getBrowserMediaSourceId: vi.fn().mockResolvedValue("web-contents:42"),
      saveBrowserRecording: vi.fn().mockImplementation(async (input) => ({
        id: "recording-1",
        tabId: input.sessionId,
        path: "/managed/recording.webm",
        mimeType: input.mimeType,
        sizeBytes: input.data.byteLength,
        createdAt: "2026-09-04T00:00:00.000Z",
      })),
    } as unknown as NonNullable<Window["desktopBridge"]>;

    const started = await startNativeBrowserRecording(bridge, "project-1", "tab-1");
    expect(started).toMatchObject({ tabId: "tab-1", recording: true });
    const artifact = await stopNativeBrowserRecording(bridge, "project-1", "tab-1");

    expect(bridge.getBrowserMediaSourceId).toHaveBeenCalledWith({
      projectId: "project-1",
      sessionId: "tab-1",
    });
    expect(bridge.saveBrowserRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        sessionId: "tab-1",
        mimeType: "video/webm;codecs=vp9",
        data: new Uint8Array([1, 2, 3]),
      }),
    );
    expect(artifact).toMatchObject({ id: "recording-1", sizeBytes: 3 });
    expect(stopTrack).toHaveBeenCalledOnce();
  });
});
