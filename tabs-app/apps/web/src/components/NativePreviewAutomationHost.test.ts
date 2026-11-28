import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvironmentId, ProjectId, ThreadId, type BrowserQuickAction } from "@tabs/contracts";

import { appAtomRegistry } from "../state/atomRegistry";
import { readModelStateAtom } from "../state/readModel";
import type { Thread } from "../types";
import { useWorkspaceShellStore } from "../workspaceShellStore";
import {
  browserRecordingVideoConstraints,
  buildPreviewStatusReport,
  requestBrowserQuickAction,
  resolveAutomationViewport,
  startNativeBrowserRecording,
  stopNativeBrowserRecording,
} from "./NativePreviewAutomationHost";

const originalMediaRecorder = globalThis.MediaRecorder;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalMediaRecorder) globalThis.MediaRecorder = originalMediaRecorder;
});

it("resolves only an exact saved Quick Action in the requesting thread's project and environment", () => {
  const environmentId = EnvironmentId.make("local");
  const otherEnvironmentId = EnvironmentId.make("remote");
  const threadId = ThreadId.make("thread-1");
  const projectId = ProjectId.make("project-1");
  const otherProjectId = ProjectId.make("project-2");
  const action: BrowserQuickAction = {
    id: "38d627ea-e2f6-4783-b8ca-b2a83f515994",
    label: "Save report",
    origin: "https://example.test",
    steps: [{ action: "click", selector: "#save" }],
    outcome: { selector: "#saved", description: "Report saved" },
  };
  const otherAction = { ...action, id: "22ac10e4-6633-4c9a-9fb3-95d1dea01e0d" };
  const savedState = appAtomRegistry.get(readModelStateAtom);
  const shell = useWorkspaceShellStore.getState();
  appAtomRegistry.set(readModelStateAtom, {
    ...savedState,
    threads: [
      { id: threadId, environmentId: otherEnvironmentId, projectId: otherProjectId } as Thread,
      { id: threadId, environmentId, projectId } as Thread,
    ],
  });
  shell.upsertProjectSettings(projectId, { browserQuickActions: [action] });
  shell.upsertProjectSettings(otherProjectId, {
    browserQuickActions: [otherAction, { ...otherAction, label: "Archive report" }],
  });

  const input = { actionName: "  SAVE report " };
  try {
    expect(requestBrowserQuickAction(environmentId, { threadId, input })).toEqual({
      status: "approval_required",
      actionId: action.id,
    });
    expect(() =>
      requestBrowserQuickAction(EnvironmentId.make("unknown"), { threadId, input }),
    ).toThrow("is not available in this environment");
    expect(() =>
      requestBrowserQuickAction(environmentId, {
        threadId,
        input: { actionName: "Archive report" },
      }),
    ).toThrow("No saved Browser Quick Action matches");
    expect(() =>
      requestBrowserQuickAction(environmentId, { threadId, input: { actionName: "Save" } }),
    ).toThrow("No saved Browser Quick Action matches");
    expect(() =>
      requestBrowserQuickAction(environmentId, {
        threadId,
        input: { ...input, values: { month: "June" } },
      }),
    ).toThrow();
    shell.upsertProjectSettings(projectId, {
      browserQuickActions: [action, { ...otherAction, label: "SAVE REPORT" }],
    });
    expect(() => requestBrowserQuickAction(environmentId, { threadId, input })).toThrow(
      "More than one saved Browser Quick Action",
    );
  } finally {
    appAtomRegistry.set(readModelStateAtom, savedState);
    useWorkspaceShellStore.setState(shell);
  }
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

describe("browserRecordingVideoConstraints", () => {
  const mandatory = (constraints: MediaTrackConstraints) =>
    (constraints as { mandatory: Record<string, unknown> }).mandatory;

  it("captures the given tab at the chosen frame rate", () => {
    expect(mandatory(browserRecordingVideoConstraints("source-1", 60))).toEqual({
      chromeMediaSource: "desktop",
      chromeMediaSourceId: "source-1",
      maxFrameRate: 60,
    });
  });

  it("falls back to 30 frames per second for anything else", () => {
    expect(mandatory(browserRecordingVideoConstraints("s", 30)).maxFrameRate).toBe(30);
    expect(mandatory(browserRecordingVideoConstraints("s", undefined)).maxFrameRate).toBe(30);
  });
});
