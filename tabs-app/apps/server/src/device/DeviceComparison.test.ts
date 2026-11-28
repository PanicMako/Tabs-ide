import { createHash } from "node:crypto";
import { mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthSessionId,
  DeviceComparisonError,
  ProviderInstanceId,
  ThreadId,
  type DeviceComparisonEvidenceApproval,
  type DeviceComparisonEvidenceDestination,
  type DeviceComparisonGesture,
  type DeviceComparisonRecording,
  type DeviceComparisonTotal,
  type DeviceServiceState,
} from "@tabs/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/unstable/http";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import { layerTest as settingsLayerTest } from "../serverSettings.ts";
import { makeDeviceComparison } from "./DeviceComparison.ts";
import { needsPrivateDeviceInput } from "./DeviceComparisonSemantics.ts";
import type { DispatchDeviceReturn } from "./AgentDeviceControl.ts";
import { makeDeviceComparisonStore, type DeviceComparisonStore } from "./DeviceComparisonStore.ts";
import { makeWithHosts } from "./DeviceService.ts";
import {
  isDeviceSystemSurface,
  makeDeviceSemanticDriver,
  type SemanticDriver,
  type SemanticSnapshot,
} from "./DeviceSemanticDriver.ts";

const threadId = ThreadId.make("checkout");
const otherThreadId = ThreadId.make("second-thread");
const iphone = { hostId: "mac-build", deviceId: "device-1" };
const pixel = { hostId: "linux-build", deviceId: "device-1" };
const iosApp = "com.tabs.fixture.ios";
const androidApp = "com.tabs.fixture.android";
const recordingCaller = {
  threadId,
  providerSessionId: "provider-session",
  providerInstanceId: ProviderInstanceId.make("codex"),
};
const panelSession = AuthSessionId.make("device-panel");
const evidenceDestination: DeviceComparisonEvidenceDestination = {
  tabId: "checkout-draft",
  profileId: "work",
  pageRef: "a".repeat(64),
  instanceId: "273e14e6-6e20-4478-923c-b39bee25d113",
};
const evidenceApproval: DeviceComparisonEvidenceApproval = {
  tabId: evidenceDestination.tabId,
  grantIds: ["79d907ee-d706-4ffa-8778-ce3dd1ebcf03", "c3d8565a-1702-45b3-a129-62619a41c64c"],
};
const approvalRequestId = "64dda4c9-ac1a-4c6c-8e66-d8a2b6d9192d";

const frame = (
  platform: "ios" | "android",
  buttons: string[],
  text: string[] = [],
): SemanticSnapshot => ({
  appBundleId: platform === "ios" ? iosApp : androidApp,
  refsGeneration: 42,
  nodes: [...buttons, ...text].map((label, index) => ({
    label,
    index,
    ref: `e${index + 1}`,
    enabled: true,
    parentIndex: 100,
    ...(index < buttons.length
      ? {
          type: platform === "ios" ? "Button" : "android.widget.Button",
          role: platform === "ios" ? "SwiftUI.AccessibilityNode" : "button",
        }
      : {
          type: platform === "ios" ? "StaticText" : "android.widget.TextView",
        }),
  })),
});

const androidPermissionDialog = (): SemanticSnapshot => {
  const bundleId = "com.android.permissioncontroller";
  return {
    ...frame("android", []),
    nodes: [
      { id: "grant_dialog", x: 3, y: 3, width: 12, height: 12 },
      { id: "permission_message", x: 4, y: 4, width: 10, height: 3 },
      { id: "permission_allow_button", x: 5, y: 8, width: 8, height: 3 },
      { id: "permission_deny_button", x: 5, y: 11, width: 8, height: 3 },
    ].map(({ id, ...rect }, index) => ({
      index,
      ref: `e${index + 1}`,
      bundleId,
      identifier: `${bundleId}:id/${id}`,
      visibleToUser: true,
      rect,
    })),
  };
};

const safariApp = "com.apple.mobilesafari";
const chromeApp = "com.android.chrome";
const withBrowserLocation = (
  snapshot: SemanticSnapshot,
  app: typeof safariApp | typeof chromeApp,
) => {
  const nativeNode = (index: number, identifier: string) => ({
    index,
    identifier,
    bundleId: app,
    ref: `e${index + 1}`,
    visibleToUser: true,
  });
  const locationNodes: SemanticSnapshot["nodes"] =
    app === safariApp
      ? [
          nativeNode(101, "CapsuleNavigationBar?isSelected=true"),
          {
            ...nativeNode(102, "TabBarItemTitle"),
            parentIndex: 101,
            type: "TextField",
            label: "Address",
            value: "\u200e127.0.0.1",
          },
        ]
      : [
          {
            ...nativeNode(101, "com.android.chrome:id/location_bar"),
            parentIndex: 100,
          },
          {
            ...nativeNode(102, "com.android.chrome:id/url_bar"),
            parentIndex: 101,
            type: "android.widget.EditText",
            editable: true,
            value: "10.0.2.2:12345/checkout/android?",
          },
          {
            ...nativeNode(103, "com.android.chrome:id/toolbar_buttons"),
            parentIndex: 100,
          },
          {
            ...nativeNode(104, "com.android.chrome:id/tab_switcher_button"),
            parentIndex: 103,
          },
        ];
  return {
    ...snapshot,
    appBundleId: app,
    nodes: [...snapshot.nodes, ...locationNodes],
  };
};

const screenshot = (host: string): Buffer =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(host)]);

const identify = (snapshot: SemanticSnapshot, ...identifiers: Array<string | undefined>) => ({
  ...snapshot,
  nodes: snapshot.nodes.map((node, index) => ({
    ...node,
    identifier: identifiers[index],
  })),
});

function fixture(
  ios: SemanticSnapshot[],
  android: SemanticSnapshot[],
  automatic = true,
  store?: DeviceComparisonStore,
) {
  const positions = new Map([
    [iphone.hostId, 0],
    [pixel.hostId, 0],
  ]);
  const screens = new Map([
    [iphone.hostId, ios],
    [pixel.hostId, android],
  ]);
  const press = vi.fn((host: string, _reference: string) => {
    if (automatic) positions.set(host, positions.get(host)! + 1);
  });
  const open = vi.fn<SemanticDriver["open"]>((_target, guard) => guard);
  const scroll = vi.fn((host: string, _direction: "up" | "down") => {
    if (automatic) positions.set(host, positions.get(host)! + 1);
  });
  const snapshot = vi.fn<SemanticDriver["snapshot"]>((target) =>
    Effect.sync(() => screens.get(target.hostId)![positions.get(target.hostId)!]!),
  );
  const driver: SemanticDriver = {
    open,
    snapshot,
    press: (target, reference, guard) =>
      guard.pipe(Effect.andThen(Effect.sync(() => press(target.hostId, reference)))),
    scroll: (target, direction, guard) =>
      guard.pipe(Effect.andThen(Effect.sync(() => scroll(target.hostId, direction)))),
  };
  const devices = [
    {
      ...iphone,
      id: iphone.deviceId,
      name: "iPhone Fixture",
      platform: "ios" as const,
    },
    {
      ...pixel,
      id: pixel.deviceId,
      name: "Pixel Fixture",
      platform: "android" as const,
    },
  ].map((device) => ({
    ...device,
    version: "fixture",
    booted: true,
    physical: false,
  }));
  let state: DeviceServiceState = {
    agentAccessEnabled: true,
    onboardingCompleted: true,
    hostStatus: "ready",
    hostStatuses: {},
    hosts: [],
    devices,
    hubBasePath: "/api/device-hub",
    revision: 0,
    sessions: devices.flatMap(({ id: deviceId, hostId, platform }) =>
      [threadId, otherThreadId].map((owner) => ({
        threadId: owner,
        hostId,
        deviceId,
        platform,
        openedAt: "now",
      })),
    ),
  };
  const capture = vi.fn<(host: string) => Buffer | undefined>(screenshot);
  const readScreenshot = vi.fn((hostId: string) => Effect.sync(() => capture(hostId)));
  const manual = vi.fn(
    (_gesture: DeviceComparisonGesture) =>
      Effect.void as Effect.Effect<void, DeviceComparisonError>,
  );
  let providerSessionId = recordingCaller.providerSessionId;
  const service = makeDeviceComparison({
    ...(store ? { store } : {}),
    state: Effect.sync(() => state),
    driver,
    providerActive: (caller) =>
      caller.threadId === threadId &&
      caller.providerInstanceId === recordingCaller.providerInstanceId &&
      caller.providerSessionId === providerSessionId,
    screenshot: ({ hostId }) => readScreenshot(hostId),
    manualInput: (_target, gesture, guard) =>
      guard.pipe(Effect.andThen(Effect.suspend(() => manual(gesture)))),
  });
  const invoke = (...args: Parameters<typeof service.invoke>) =>
    Effect.runPromise(service.invoke(...args));
  const record = (input: DeviceComparisonRecording, caller = recordingCaller) =>
    Effect.runPromise(service.record(input, caller));
  const propose = (destination?: DeviceComparisonEvidenceDestination) =>
    record({
      action: "propose",
      source: { ...iphone, appId: iosApp },
      target: { ...pixel, appId: androidApp },
      ...(destination && { evidenceDestination: destination }),
    });
  const approveRecording = (runId: string) =>
    invoke({ action: "approveAgentRecording", threadId, runId }, panelSession);
  const status = async () => await invoke({ action: "status", threadId, device: pixel });
  const settle = async () =>
    await vi.waitFor(async () => {
      const latest = await status();
      expect(latest.run?.busy).toBe(false);
      return latest;
    });
  const begin = async () => {
    const { run } = await invoke({
      action: "start",
      threadId,
      device: iphone,
      appId: iosApp,
    });
    await settle();
    return run!.runId;
  };
  const tap = async (runId: string, label: string, clearsBlocker?: boolean) => {
    const { controls } = await status();
    await invoke({
      action: "tap",
      threadId,
      runId,
      controlId: controls!.find((node) => node.label === label)!.id,
      ...(clearsBlocker === undefined ? {} : { clearsBlocker }),
    });
    return await settle();
  };
  let approvalId: string;
  const approve = async (runId: string) => {
    await invoke({ action: "finish", threadId, runId });
    const status = await invoke({
      action: "approve",
      threadId,
      runId,
      target: pixel,
      appId: androidApp,
    });
    approvalId = status.run!.approvalId!;
    return approvalId;
  };
  const replay = (runId: string, total?: DeviceComparisonTotal) =>
    invoke({
      action: "replay",
      threadId,
      runId,
      approvalId,
      ...(total ? { total } : {}),
    });
  const reopen = ({ hostId, deviceId }: typeof iphone) => {
    state = {
      ...state,
      sessions: state.sessions.map((session) =>
        session.threadId === threadId && session.hostId === hostId && session.deviceId === deviceId
          ? { ...session, openedAt: "reopened" }
          : session,
      ),
    };
  };
  return {
    invoke,
    record,
    propose,
    approveRecording,
    status,
    settle,
    begin,
    tap,
    approve,
    replay,
    service,
    open,
    snapshot,
    scroll,
    press,
    manual,
    capture,
    readScreenshot,
    driver,
    positions,
    getState: () => state,
    reopen,
    reopenDestination: () => {
      reopen(pixel);
      service.reconcile(state);
    },
    replaceProvider: () => {
      providerSessionId = "replacement-provider-session";
    },
    revoke: () => {
      state = { ...state, agentAccessEnabled: false };
      service.reconcile(state);
    },
  };
}

describe("Agent-led device comparison", () => {
  it("keeps private fields protected while accepting a browser's idle location display", () => {
    const settings = { allowBrowserLocationDisplay: true };
    const safari = withBrowserLocation(frame("ios", ["Continue"]), safariApp);
    const chrome = withBrowserLocation(frame("android", ["Continue"]), chromeApp);
    for (const browsing of [safari, chrome]) {
      expect(needsPrivateDeviceInput(browsing, settings)).toBe(false);
      expect(needsPrivateDeviceInput(browsing)).toBe(true);
      expect(
        needsPrivateDeviceInput(
          {
            ...browsing,
            nodes: browsing.nodes.map((node) =>
              node.index === 102 ? { ...node, value: "example.test?session=private" } : node,
            ),
          },
          settings,
        ),
      ).toBe(true);
    }
    expect(
      needsPrivateDeviceInput(
        {
          ...safari,
          nodes: safari.nodes.map((node) =>
            node.index === 102 ? { ...node, identifier: "URL", value: "" } : node,
          ),
        },
        settings,
      ),
    ).toBe(true);
    expect(
      needsPrivateDeviceInput(
        {
          ...chrome,
          nodes: chrome.nodes.map((node) =>
            node.index === 102 ? { ...node, focused: true, value: "" } : node,
          ),
        },
        settings,
      ),
    ).toBe(true);
    expect(
      needsPrivateDeviceInput(
        { ...chrome, nodes: chrome.nodes.filter((node) => node.index !== 104) },
        settings,
      ),
    ).toBe(true);
    expect(needsPrivateDeviceInput({ ...chrome, appBundleId: androidApp }, settings)).toBe(true);
    expect(
      needsPrivateDeviceInput(
        {
          ...chrome,
          nodes: [...chrome.nodes, { index: 105, ref: "e106", editable: true, value: "Private" }],
        },
        settings,
      ),
    ).toBe(true);
  });

  it.each(["only browser wrappers", "source siblings", "destination siblings"] as const)(
    "verifies a mobile browser checkout outcome with %s",
    async (result) => {
      const reviewLabel = "Review order";
      const review = frame("ios", [], [reviewLabel]);
      const wrappedReview: SemanticSnapshot = {
        ...review,
        nodes: [
          { index: 0, ref: "e1", label: reviewLabel, type: "WebView" },
          {
            index: 1,
            parentIndex: 0,
            ref: "e2",
            label: reviewLabel,
            type: "Other",
          },
          {
            index: 2,
            parentIndex: 1,
            ref: "e3",
            label: reviewLabel,
            type: "Other",
            value: "1",
          },
          {
            index: 3,
            parentIndex: 2,
            ref: "e4",
            label: reviewLabel,
            type: "StaticText",
          },
          ...(result === "source siblings"
            ? [
                {
                  index: 4,
                  parentIndex: 1,
                  ref: "e5",
                  label: reviewLabel,
                  type: "Other",
                },
                {
                  index: 5,
                  parentIndex: 4,
                  ref: "e6",
                  label: reviewLabel,
                  type: "StaticText",
                },
              ]
            : []),
        ],
      };
      const androidReview: SemanticSnapshot = {
        ...frame("android", []),
        nodes: [
          {
            index: 0,
            ref: "e1",
            label: reviewLabel,
            type: "android.webkit.WebView",
          },
          {
            index: 1,
            parentIndex: 0,
            ref: "e2",
            label: reviewLabel,
            type: "android.widget.TextView",
          },
          ...(result === "destination siblings"
            ? [
                {
                  index: 2,
                  parentIndex: 0,
                  ref: "e3",
                  label: reviewLabel,
                  type: "android.widget.TextView",
                },
              ]
            : []),
        ],
      };
      const f = fixture(
        [frame("ios", ["Continue"]), wrappedReview].map((screen) =>
          withBrowserLocation(screen, safariApp),
        ),
        [frame("android", ["Continue"]), androidReview].map((screen) =>
          withBrowserLocation(screen, chromeApp),
        ),
      );
      const { run } = await f.record({
        action: "propose",
        source: { ...iphone, appId: safariApp },
        target: { ...pixel, appId: chromeApp },
      });
      const runId = run!.runId;
      const approval = await f.approveRecording(runId);
      const before = await f.record({ action: "inspect", runId });
      await f.record({
        action: "tap",
        runId,
        controlId: before.controls![0]!.id,
      });
      const after = await f.record({ action: "inspect", runId });
      expect(after.controls?.map(({ label }) => label)).toEqual(
        result === "source siblings" ? [reviewLabel, reviewLabel] : [reviewLabel],
      );
      const selected = {
        action: "expect",
        runId,
        controlId: after.controls![0]!.id,
      } as const;
      if (result === "source siblings") {
        await expect(f.record(selected)).rejects.toThrow("unique label");
        expect(f.press.mock.calls.map(([hostId]) => hostId)).toEqual([iphone.hostId]);
        return;
      }
      await f.record(selected);
      await f.record({ action: "finish", runId });
      await f.invoke(
        {
          action: "replay",
          threadId,
          runId,
          approvalId: approval.run!.approvalId!,
        },
        undefined,
        recordingCaller,
      );
      expect((await f.settle()).run?.phase).toBe(
        result === "destination siblings" ? "paused" : "completed",
      );
      expect(f.press.mock.calls.map(([hostId]) => hostId)).toEqual([iphone.hostId, pixel.hostId]);
    },
  );

  it("binds distinct evidence grants for the proposed tab to an idempotent panel approval", async () => {
    const f = fixture([frame("ios", ["Continue"])], [frame("android", ["Continue"])]);
    const { run } = await f.propose(evidenceDestination);
    expect(run?.agentRecording?.evidenceDestination).toEqual(evidenceDestination);
    const request = {
      action: "approveAgentRecording",
      threadId,
      runId: run!.runId,
      approvalRequestId,
      evidence: evidenceApproval,
    } as const;
    await expect(f.invoke(request)).rejects.toThrow("authenticated Device panel");
    await expect(f.invoke(request, panelSession, recordingCaller)).rejects.toThrow(
      "authenticated Device panel",
    );
    for (const evidence of [
      { ...evidenceApproval, tabId: "other-tab" },
      {
        ...evidenceApproval,
        grantIds: [evidenceApproval.grantIds[0], evidenceApproval.grantIds[0]],
      },
    ] satisfies DeviceComparisonEvidenceApproval[]) {
      await expect(f.invoke({ ...request, evidence }, panelSession)).rejects.toThrow(
        "two distinct screenshot grants for the proposed tab",
      );
    }
    expect(f.open).not.toHaveBeenCalled();

    const [approved, retry] = await Promise.all([
      f.invoke(request, panelSession),
      f.invoke(request, panelSession),
    ]);
    expect(approved.run?.approvalId).toBe(approvalRequestId);
    expect(approved.approvedEvidence).toBeUndefined();
    expect(retry.run?.approvalId).toBe(approvalRequestId);
    expect(retry.approvedEvidence).toBeUndefined();
    await expect(
      f.invoke(
        {
          ...request,
          evidence: {
            ...evidenceApproval,
            grantIds: [evidenceApproval.grantIds[1], evidenceApproval.grantIds[0]],
          },
        },
        panelSession,
      ),
    ).rejects.toThrow("no longer awaiting approval");
    await f.settle();
    expect(f.open).toHaveBeenCalledTimes(1);
    expect(f.press).not.toHaveBeenCalled();
  });

  it("preserves device-only approval with a proposed destination and rejects a late grant", async () => {
    const f = fixture([frame("ios", ["Continue"])], [frame("android", ["Continue"])]);
    const { run } = await f.propose(evidenceDestination);
    const runId = run!.runId;
    const approval = {
      action: "approveAgentRecording",
      threadId,
      runId,
      approvalRequestId,
    } as const;
    expect((await f.invoke(approval, panelSession)).run?.approvalId).toBe(approvalRequestId);
    expect((await f.invoke(approval, panelSession)).run?.approvalId).toBe(approvalRequestId);
    await expect(
      f.invoke({ ...approval, evidence: evidenceApproval }, panelSession),
    ).rejects.toThrow("no longer awaiting approval");
    await f.settle();
    expect(f.open).toHaveBeenCalledTimes(1);
  });

  it.each([
    "stop",
    "provider",
    "device access",
    "device attachment",
    "missing target frame",
  ] as const)("withholds transfer access on %s", async (condition) => {
    const f = fixture(
      [frame("ios", ["Continue"]), frame("ios", [], ["Order review"])],
      [frame("android", ["Cancel"])],
    );
    if (condition === "missing target frame") {
      f.capture.mockImplementation((host) =>
        host === pixel.hostId ? Buffer.alloc(0) : screenshot(host),
      );
    }
    const { run } = await f.propose(evidenceDestination);
    const runId = run!.runId;
    const status = { action: "status", threadId, runId } as const;
    const evidence = { action: "evidence", threadId, runId } as const;
    const approval = {
      action: "approveAgentRecording",
      threadId,
      runId,
      approvalRequestId,
      evidence: evidenceApproval,
    } as const;
    const forCaller = (input: typeof status | typeof evidence) =>
      f.invoke(input, undefined, recordingCaller);
    expect((await forCaller(status)).approvedEvidence).toBeUndefined();
    await expect(forCaller(evidence)).rejects.toThrow("first-difference evidence is unavailable");

    await f.invoke(approval, panelSession);
    expect((await forCaller(status)).approvedEvidence).toBeUndefined();
    const source = await f.record({ action: "inspect", runId });
    await f.record({
      action: "tap",
      runId,
      controlId: source.controls![0]!.id,
    });
    const outcome = await f.record({ action: "inspect", runId });
    await f.record({
      action: "expect",
      runId,
      controlId: outcome.controls![0]!.id,
    });
    await f.record({ action: "finish", runId });
    expect((await forCaller(status)).approvedEvidence).toBeUndefined();
    await f.invoke(
      { action: "replay", threadId, runId, approvalId: approvalRequestId },
      undefined,
      recordingCaller,
    );
    expect((await f.settle()).run?.firstDifference?.step).toBe(1);
    expect((await f.invoke(status, panelSession)).approvedEvidence).toBeUndefined();
    expect((await f.invoke(evidence, panelSession)).approvedEvidence).toBeUndefined();
    if (condition === "missing target frame") {
      expect((await forCaller(status)).approvedEvidence).toBeUndefined();
      await expect(forCaller(evidence)).rejects.toThrow("first-difference evidence is unavailable");
      return;
    }

    expect((await forCaller(status)).approvedEvidence).toEqual(evidenceApproval);
    expect(
      (await f.invoke({ action: "status", threadId }, undefined, recordingCaller)).approvedEvidence,
    ).toEqual(evidenceApproval);
    expect((await forCaller(evidence)).evidence).toEqual({
      sourcePng: screenshot(iphone.hostId).toString("base64"),
      targetPng: screenshot(pixel.hostId).toString("base64"),
    });
    const otherProvider = {
      ...recordingCaller,
      providerSessionId: "replacement-provider-session",
    };
    await expect(f.invoke(status, undefined, otherProvider)).rejects.toThrow(
      "different agent session",
    );
    await expect(f.invoke(evidence, undefined, otherProvider)).rejects.toThrow(
      "different agent session",
    );

    if (condition === "provider") {
      f.replaceProvider();
      await expect(forCaller(status)).rejects.toThrow("agent session");
      await expect(forCaller(evidence)).rejects.toThrow("agent session");
      await expect(f.invoke(approval, panelSession)).rejects.toThrow();
      return;
    }
    if (condition === "stop") {
      await f.invoke({ action: "stop", threadId, runId }, panelSession);
      await expect(f.invoke(approval, panelSession)).rejects.toThrow("no longer awaiting approval");
      const replacement = await f.propose(evidenceDestination);
      expect(replacement.run?.runId).not.toBe(runId);
    } else if (condition === "device access") f.revoke();
    else f.reopen(iphone);
    expect((await forCaller(status)).approvedEvidence).toBeUndefined();
    await expect(forCaller(evidence)).rejects.toThrow();
  });

  it("waits for panel approval and routes matching device IDs by their exact hosts", async () => {
    const f = fixture(
      [frame("ios", ["Continue"]), frame("ios", [], ["Order review"])],
      [frame("android", ["Continue"]), frame("android", [], ["Order review"])],
    );
    const proposed = await f.propose();
    const runId = proposed.run!.runId;
    expect(proposed.run).toMatchObject({
      phase: "awaiting_approval",
      source: { ...iphone, platform: "ios", appId: iosApp },
      target: { ...pixel, platform: "android", appId: androidApp },
    });
    expect(proposed.run?.approvalId).toBeUndefined();
    expect((await f.record({ action: "inspect", runId })).controls).toBeUndefined();
    await expect(f.record({ action: "tap", runId, controlId: runId })).rejects.toThrow(
      "approve the recording",
    );
    const approval = {
      action: "approveAgentRecording",
      threadId,
      runId,
    } as const;
    await expect(f.invoke(approval)).rejects.toThrow("authenticated Device panel");
    await expect(f.invoke(approval, panelSession, recordingCaller)).rejects.toThrow(
      "authenticated Device panel",
    );
    expect(f.open).not.toHaveBeenCalled();
    expect(f.snapshot).not.toHaveBeenCalled();
    expect(f.capture).not.toHaveBeenCalled();
    expect(f.press).not.toHaveBeenCalled();
    expect(f.service.inputAllowed(iphone.hostId, iphone.deviceId)).toBe(true);
    expect(f.service.inputAllowed(pixel.hostId, pixel.deviceId)).toBe(true);

    const { run } = await f.approveRecording(runId);
    expect(run?.approvalId).toBeTypeOf("string");
    expect(f.service.inputAllowed(iphone.hostId, iphone.deviceId)).toBe(false);
    expect(f.service.inputAllowed(pixel.hostId, pixel.deviceId)).toBe(true);
    const { controls } = await f.record({ action: "inspect", runId });
    expect(f.open).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining(iphone),
      expect.anything(),
    );
    expect(f.snapshot.mock.calls.map(([target]) => target.hostId)).toEqual([iphone.hostId]);
    const continueId = controls!.find(({ label }) => label === "Continue")!.id;
    await f.record({ action: "tap", runId, controlId: continueId });
    const outcome = await f.record({ action: "inspect", runId });
    const reviewId = outcome.controls!.find(({ label }) => label === "Order review")!.id;
    await f.record({ action: "expect", runId, controlId: reviewId });
    expect((await f.record({ action: "finish", runId })).run?.phase).toBe("ready");
    await f.invoke(
      { action: "replay", threadId, runId, approvalId: run!.approvalId! },
      undefined,
      recordingCaller,
    );
    expect(await f.settle()).toMatchObject({
      run: { phase: "completed", completedSteps: 1 },
      liveTargetAvailable: true,
    });
    expect(f.press.mock.calls.map(([hostId]) => hostId)).toEqual([iphone.hostId, pixel.hostId]);
  });

  it.each(["same handoff", "device reopened", "provider replaced"] as const)(
    "reconciles a lost correction continuation acknowledgement with %s",
    async (scenario) => {
      const f = fixture(
        [frame("ios", ["Continue"]), frame("ios", [], ["Order review"])],
        [frame("android", ["Back"]), frame("android", [], ["Order review"])],
      );
      const runId = (await f.propose()).run!.runId;
      const { run } = await f.approveRecording(runId);
      const source = await f.record({ action: "inspect", runId });
      await f.record({
        action: "tap",
        runId,
        controlId: source.controls![0]!.id,
      });
      const outcome = await f.record({ action: "inspect", runId });
      await f.record({
        action: "expect",
        runId,
        controlId: outcome.controls![0]!.id,
      });
      await f.record({ action: "finish", runId });
      await f.invoke(
        { action: "replay", threadId, runId, approvalId: run!.approvalId! },
        undefined,
        recordingCaller,
      );
      expect((await f.settle()).run?.phase).toBe("paused");
      const takeover = {
        action: "takeover",
        threadId,
        runId,
        liveInput: true,
      } as const;
      await f.invoke(takeover, panelSession);
      const status = { action: "status", threadId, device: pixel } as const;
      const { manualControlId } = await f.invoke(status, panelSession);
      const controlId = manualControlId!;
      f.manual.mockImplementationOnce(() =>
        Effect.sync(() => {
          f.positions.set(pixel.hostId, 1);
        }),
      );
      await f.invoke(
        {
          action: "manualInput",
          threadId,
          runId,
          controlId,
          gesture: { type: "tap", x: 0.5, y: 0.5 },
        },
        panelSession,
      );
      const resume = {
        action: "resume",
        threadId,
        runId,
        controlId,
        stepCompleted: true,
      } as const;
      const accepted = new Set<string>();
      const dispatch = vi.fn<DispatchDeviceReturn>((receipt, current) =>
        Effect.sync(() => {
          expect(current()).toBe(true);
          expect(receipt).toMatchObject({
            id: controlId,
            threadId,
            comparisonRunId: runId,
            target: pixel,
            appId: androidApp,
          });
          accepted.add(receipt.id);
        }),
      );
      const accept = dispatch.getMockImplementation()!;
      dispatch.mockImplementationOnce((...args) =>
        accept(...args).pipe(Effect.andThen(new DeviceComparisonError({ reason: "Reply lost." }))),
      );
      await expect(f.invoke(resume, panelSession, undefined, dispatch)).rejects.toThrow(
        "Reply lost",
      );
      expect((await f.settle()).run).toMatchObject({
        phase: "completed",
        completedSteps: 1,
      });
      expect((await f.invoke(status, panelSession)).pendingReplayReturn).toEqual({
        controlId,
        stepCompleted: true,
      });
      const stranger = AuthSessionId.make("other-panel");
      expect((await f.invoke(status, stranger)).pendingReplayReturn).toBeUndefined();
      expect(
        (await f.invoke({ ...status, device: iphone }, panelSession)).pendingReplayReturn,
      ).toBeUndefined();
      await expect(f.invoke(resume, stranger, undefined, dispatch)).rejects.toThrow("session");
      await expect(
        f.invoke({ ...resume, threadId: otherThreadId }, panelSession, undefined, dispatch),
      ).rejects.toThrow("no longer available");
      await expect(
        f.invoke({ ...resume, stepCompleted: false }, panelSession, undefined, dispatch),
      ).rejects.toThrow("session");
      if (scenario === "device reopened") f.reopenDestination();
      if (scenario === "provider replaced") f.replaceProvider();
      if (scenario === "same handoff") {
        await Promise.all([
          f.invoke(resume, panelSession, undefined, dispatch),
          f.invoke(resume, panelSession, undefined, dispatch),
        ]);
        expect(dispatch).toHaveBeenCalledTimes(2);
      } else {
        await expect(f.invoke(resume, panelSession, undefined, dispatch)).rejects.toThrow(
          "not paused",
        );
        expect(dispatch).toHaveBeenCalledTimes(1);
      }
      expect(accepted.size).toBe(1);
      expect((await f.invoke(status, panelSession)).pendingReplayReturn).toBeUndefined();
      expect(f.manual).toHaveBeenCalledTimes(1);
      expect(f.press.mock.calls.map(([hostId]) => hostId)).toEqual([iphone.hostId]);
    },
  );

  it.each(["source", "destination", "provider"] as const)(
    "refuses a queued tap when the approved %s changes before dispatch",
    async (changed) => {
      const f = fixture([frame("ios", ["Continue"])], [frame("android", ["Continue"])], false);
      const { run } = await f.propose();
      const runId = run!.runId;
      await f.approveRecording(runId);
      const { controls } = await f.record({ action: "inspect", runId });
      const started = Promise.withResolvers<void>();
      const dispatch = Promise.withResolvers<void>();
      const press = f.driver.press;
      Object.assign(f.driver, {
        press: (...args: Parameters<SemanticDriver["press"]>) =>
          Effect.promise(() => {
            started.resolve();
            return dispatch.promise;
          }).pipe(Effect.andThen(press(...args))),
      });
      await f.record({ action: "tap", runId, controlId: controls![0]!.id });
      try {
        await started.promise;
        if (changed === "provider") f.replaceProvider();
        else f.reopen(changed === "source" ? iphone : pixel);
      } finally {
        dispatch.resolve();
      }
      const settled = await f.settle();
      expect(settled.run).toMatchObject({ steps: [], uncertainTap: false });
      expect(f.press).not.toHaveBeenCalled();
    },
  );

  it.each(["Place order", "Place demo order"])(
    "refuses %s without sending driver input",
    async (label) => {
      const f = fixture([frame("ios", [label])], [frame("android", [label])]);
      const { run } = await f.propose();
      const runId = run!.runId;
      await f.approveRecording(runId);
      const { controls } = await f.record({ action: "inspect", runId });
      expect(controls).toMatchObject([{ label, canTap: false }]);
      await expect(f.record({ action: "tap", runId, controlId: controls![0]!.id })).rejects.toThrow(
        "Choose My turn",
      );
      expect(f.press).not.toHaveBeenCalled();
      expect(f.capture).not.toHaveBeenCalled();
      expect((await f.settle()).run?.steps).toEqual([]);
    },
  );

  it.each(["before", "after"] as const)(
    "hands the source back when takeover happens %s a tap commits",
    async (timing) => {
      const f = fixture(
        [frame("ios", ["Continue"]), frame("ios", [], ["Order review"])],
        [frame("android", ["Continue"])],
      );
      const { run } = await f.propose();
      const runId = run!.runId;
      await f.approveRecording(runId);
      const { controls } = await f.record({ action: "inspect", runId });
      const tap = {
        action: "tap",
        runId,
        controlId: controls![0]!.id,
      } as const;
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const hold = Effect.promise(() => {
        started.resolve();
        return release.promise;
      });
      const press = f.driver.press;
      Object.assign(f.driver, {
        press: (...args: Parameters<SemanticDriver["press"]>) =>
          timing === "before"
            ? hold.pipe(Effect.andThen(press(...args)))
            : press(...args).pipe(Effect.andThen(hold)),
      });
      await f.record(tap);
      const sourceStatus = () =>
        f.invoke({ action: "status", threadId, device: iphone }, panelSession);
      try {
        await started.promise;
        await expect(
          f.invoke(
            {
              action: "takeover",
              threadId,
              runId,
              liveInput: true,
              device: pixel,
            },
            panelSession,
          ),
        ).rejects.toThrow("source device");
        const handoff = await f.invoke(
          {
            action: "takeover",
            threadId,
            runId,
            liveInput: true,
            device: iphone,
          },
          panelSession,
        );
        expect(handoff.run).toMatchObject({
          busy: true,
          canResume: false,
          agentRecording: { manual: true },
        });
        expect(handoff.manualControlId).toBeUndefined();
        expect((await f.record({ action: "inspect", runId })).controls).toBeUndefined();
        await expect(f.record(tap)).rejects.toThrow("return source control");
      } finally {
        release.resolve();
      }
      await f.settle();
      const handoff = await sourceStatus();
      const committed = timing === "after";
      expect(handoff.run).toMatchObject({
        phase: "recording",
        canResume: true,
        uncertainTap: false,
        steps: committed ? [{ label: "Continue" }] : [],
      });
      expect(handoff.manualControlId).toBeTypeOf("string");
      expect((await f.record({ action: "inspect", runId })).controls).toBeUndefined();
      await f.invoke(
        {
          action: "resume",
          threadId,
          runId,
          controlId: handoff.manualControlId!,
        },
        panelSession,
      );
      const inspected = await f.record({ action: "inspect", runId });
      expect(inspected.controls).toMatchObject([
        { label: committed ? "Order review" : "Continue" },
      ]);
      expect(f.press.mock.calls.map(([hostId]) => hostId)).toEqual(
        committed ? [iphone.hostId] : [],
      );
      if (committed) {
        await f.record({
          action: "expect",
          runId,
          controlId: inspected.controls![0]!.id,
        });
        expect((await f.record({ action: "finish", runId })).run?.steps).toEqual([
          { label: "Continue", expected: "Order review" },
        ]);
      }
    },
  );

  it("returns source control while the extra post-tap read is pending", async () => {
    const initial = frame("ios", ["Continue"]);
    const review = frame("ios", [], ["Order review"]);
    const f = fixture([initial, review], [frame("android", ["Continue"])]);
    const { run } = await f.propose();
    const runId = run!.runId;
    await f.approveRecording(runId);
    const { controls } = await f.record({ action: "inspect", runId });
    const started = Deferred.makeUnsafe<void>();
    const late = Deferred.makeUnsafe<SemanticSnapshot>();
    f.press.mockImplementationOnce((host) => {
      f.positions.set(host, 1);
      f.snapshot
        .mockReturnValueOnce(Effect.succeed(initial))
        .mockReturnValueOnce(Effect.succeed(initial))
        .mockReturnValueOnce(
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(late))),
        );
    });

    await f.record({ action: "tap", runId, controlId: controls![0]!.id });
    try {
      await Effect.runPromise(Deferred.await(started));
      await f.invoke(
        {
          action: "takeover",
          threadId,
          runId,
          liveInput: true,
          device: iphone,
        },
        panelSession,
      );
      await f.settle();
      const handoff = await f.invoke({ action: "status", threadId, device: iphone }, panelSession);
      expect(handoff.manualControlId).toBeTypeOf("string");
      expect(handoff.run).toMatchObject({
        phase: "recording",
        busy: false,
        steps: [{ label: "Continue" }],
      });
      expect(handoff.controls).toBeUndefined();
      expect(f.press).toHaveBeenCalledExactlyOnceWith(iphone.hostId, "@e1~s42");
    } finally {
      await Effect.runPromise(Deferred.succeed(late, review));
    }
  });
});

describe("Device comparison", () => {
  it.each([
    {
      interruption: "between verified steps",
      dispatched: false,
      difference: undefined,
    },
    {
      interruption: "after a dispatch with no reply",
      dispatched: true,
      difference: undefined,
    },
    {
      interruption: "before a missing control",
      dispatched: false,
      difference: "before",
    },
    {
      interruption: "before a missing control with takeover during source lookup",
      dispatched: false,
      difference: "before",
      takeoverDuringLookup: true,
    },
    {
      interruption: "after a dispatch whose expected result is missing",
      dispatched: true,
      difference: "after",
    },
    {
      interruption: "after a dispatch whose expected result and source PNG are missing",
      dispatched: true,
      difference: "after",
      missingSourcePng: true,
    },
  ])("restores replay before any first difference $interruption", async (scenario) => {
    const directory = await mkdtemp(join(tmpdir(), "tabs-active-replay-"));
    const release = Promise.withResolvers<void>();
    let interrupted = false;
    const waitForRestart = Effect.promise(() => {
      interrupted = true;
      return release.promise;
    });
    const ios = [
      frame("ios", ["Continue"]),
      frame("ios", ["Delivery"], ["Delivery options"]),
      frame("ios", ["Review"], ["Shipping details"]),
      frame("ios", [], ["Order review"]),
    ];
    const android = [
      frame("android", ["Continue"]),
      frame(
        "android",
        ["Back", scenario.difference === "before" ? "Help" : "Delivery"],
        ["Delivery options"],
      ),
      frame(
        "android",
        ["Back", "Help", "Review"],
        scenario.difference === "after" ? [] : ["Shipping details"],
      ),
      frame("android", [], ["Order review"]),
    ];
    const framePng = (host: string, position: number) => {
      const png = new PNG({ width: 1, height: 1 });
      png.data.set([host === iphone.hostId ? 64 : 128, position, 0, 255]);
      return PNG.sync.write(png);
    };
    const store = makeDeviceComparisonStore(directory);
    const saveSourceFrames = vi.spyOn(store, "saveReplaySourceFrames");
    const original = fixture(ios, android, true, {
      ...store,
      saveReplay: (owner, report, checkpoint, isCurrent) =>
        store
          .saveReplay(owner, report, checkpoint, isCurrent)
          .pipe(
            Effect.tap((saved) =>
              saved && !scenario.dispatched && checkpoint.index === 1 && checkpoint.applied === "no"
                ? waitForRestart
                : Effect.void,
            ),
          ),
    });
    original.capture.mockImplementation((host) => {
      const position = original.positions.get(host)!;
      if (scenario.missingSourcePng && host === iphone.hostId && position === 2) return undefined;
      return framePng(host, position);
    });
    const deliveryRef = "@e2~s42";
    const reviewRef = "@e3~s42";
    const press = original.driver.press;
    Object.assign(original.driver, {
      press: (...args: Parameters<SemanticDriver["press"]>) =>
        scenario.dispatched && args[0].hostId === pixel.hostId && args[1] === deliveryRef
          ? press(...args).pipe(Effect.tap(() => waitForRestart))
          : press(...args),
    });
    try {
      const runId = await original.begin();
      const reference = { threadId, runId };
      for (const [label, expected] of [
        ["Continue", "Delivery options"],
        ["Delivery", "Shipping details"],
        ["Review", "Order review"],
      ] as const) {
        const { controls } = await original.tap(runId, label);
        await original.invoke({
          ...reference,
          action: "expect",
          controlId: controls!.find((control) => control.label === expected)!.id,
        });
      }
      const approvalId = await original.approve(runId);
      expect(saveSourceFrames).not.toHaveBeenCalled();
      original.capture.mockClear();
      await original.replay(runId);
      await vi.waitFor(() => expect(interrupted).toBe(true));
      expect(saveSourceFrames).toHaveBeenCalledOnce();
      expect(original.capture).not.toHaveBeenCalled();
      expect(original.press.mock.calls.filter(([hostId]) => hostId === pixel.hostId)).toEqual([
        [pixel.hostId, "@e1~s42"],
        ...(scenario.dispatched ? [[pixel.hostId, deliveryRef]] : []),
      ]);

      const freshStore = makeDeviceComparisonStore(directory);
      const readSourceFrame = freshStore.loadReplaySourceFrame;
      const loadSourceFrame = vi.spyOn(freshStore, "loadReplaySourceFrame");
      const saveRestoredSourceFrames = vi.spyOn(freshStore, "saveReplaySourceFrames");
      const saved = await Effect.runPromise(freshStore.loadReplay(threadId));
      expect(saved).toMatchObject({
        report: { runId, completedSteps: 1 },
        checkpoint: {
          index: 1,
          applied: scenario.dispatched ? "unknown" : "no",
        },
      });
      expect(saved?.report?.firstDifference).toBeUndefined();
      const restarted = fixture(ios, android, true, freshStore);
      restarted.positions.set(pixel.hostId, original.positions.get(pixel.hostId)!);
      restarted.capture.mockImplementation((host) =>
        framePng(host, restarted.positions.get(host)!),
      );
      const status = { action: "status", threadId, device: pixel } as const;
      const restore = {
        ...reference,
        action: "restoreReplay",
        device: pixel,
        appId: androidApp,
      } as const;
      const resume = { ...reference, action: "resume" } as const;
      const otherSession = AuthSessionId.make("foreign-panel");
      const available = await restarted.invoke(status, panelSession);
      expect(available).toMatchObject({
        canRestoreReplay: true,
        run: {
          runId,
          source: { ...iphone, appId: iosApp },
          target: { ...pixel, appId: androidApp },
          completedSteps: 1,
        },
      });
      expect(available.run?.firstDifference).toBeUndefined();
      expect((await restarted.invoke({ ...status, runId }, panelSession)).canRestoreReplay).toBe(
        true,
      );
      expect((await restarted.invoke(status)).canRestoreReplay).toBeUndefined();
      await expect(restarted.invoke(restore)).rejects.toThrow();
      await expect(
        restarted.invoke({ ...restore, runId: approvalId }, panelSession),
      ).rejects.toThrow();
      await expect(
        restarted.invoke({ ...restore, threadId: otherThreadId }, panelSession),
      ).rejects.toThrow();
      await expect(
        restarted.invoke({ ...restore, device: iphone }, panelSession),
      ).rejects.toThrow();
      await expect(restarted.invoke({ ...restore, appId: iosApp }, panelSession)).rejects.toThrow();
      expect(restarted.snapshot).not.toHaveBeenCalled();

      const restored = await restarted.invoke(restore, panelSession);
      expect(restored.run).toMatchObject({
        runId,
        phase: "paused",
        completedSteps: 1,
        uncertainTap: scenario.dispatched,
      });
      expect(restored.run?.firstDifference).toBeUndefined();
      await expect(restarted.invoke(resume, otherSession)).rejects.toThrow("that restored");
      expect(restarted.open).not.toHaveBeenCalled();
      expect(restarted.press).not.toHaveBeenCalled();
      expect(restarted.scroll).not.toHaveBeenCalled();
      if (scenario.dispatched) {
        await expect(restarted.invoke(resume, panelSession)).rejects.toThrow("confirm whether");
        expect(restarted.press).not.toHaveBeenCalled();
        await restarted.invoke({ ...reference, action: "resolve", applied: true }, panelSession);
      }
      expect(loadSourceFrame).not.toHaveBeenCalled();

      if (scenario.takeoverDuringLookup) {
        const releaseLookup = Promise.withResolvers<void>();
        loadSourceFrame.mockImplementation((...args) =>
          Effect.promise(() => releaseLookup.promise).pipe(
            Effect.andThen(readSourceFrame(...args)),
          ),
        );
        try {
          await restarted.invoke(resume, panelSession);
          await vi.waitFor(() => expect(loadSourceFrame).toHaveBeenCalledOnce());
          await restarted.invoke(
            { ...reference, action: "takeover", liveInput: true },
            panelSession,
          );
        } finally {
          releaseLookup.resolve();
        }
        expect((await restarted.settle()).run).toMatchObject({
          phase: "paused",
          firstDifference: { step: 2, kind: "control" },
          availableEvidence: { source: true, target: false },
        });
        const { evidence } = await restarted.invoke(
          { ...reference, action: "evidence" },
          panelSession,
        );
        expect(evidence).toEqual({
          sourcePng: framePng(iphone.hostId, 1).toString("base64"),
        });
        expect((await Effect.runPromise(freshStore.load(threadId, runId, true)))?.evidence).toEqual(
          evidence,
        );
        expect(restarted.capture).not.toHaveBeenCalled();
        expect(restarted.press).not.toHaveBeenCalled();
        return;
      }
      await restarted.invoke(resume, panelSession);
      const settled = await restarted.settle();
      expect(restarted.open).not.toHaveBeenCalled();
      expect(restarted.scroll).not.toHaveBeenCalled();
      expect(saveRestoredSourceFrames).not.toHaveBeenCalled();
      if (scenario.difference) {
        const position = scenario.difference === "before" ? 1 : 2;
        expect(settled.run).toMatchObject({
          phase: "paused",
          completedSteps: 1,
          firstDifference: {
            step: 2,
            kind: position === 1 ? "control" : "outcome",
          },
          availableEvidence: {
            source: !scenario.missingSourcePng,
            target: true,
          },
        });
        const { evidence } = await restarted.invoke(
          { ...reference, action: "evidence" },
          panelSession,
        );
        expect(evidence).toEqual({
          ...(scenario.missingSourcePng
            ? {}
            : {
                sourcePng: framePng(iphone.hostId, position).toString("base64"),
              }),
          targetPng: framePng(pixel.hostId, position).toString("base64"),
        });
        expect(loadSourceFrame.mock.calls).toEqual([[threadId, runId, 1, scenario.difference]]);
        expect(restarted.capture.mock.calls).toEqual([[pixel.hostId]]);
        expect(
          restarted.snapshot.mock.calls.every(([device]) => device.hostId === pixel.hostId),
        ).toBe(true);
        expect(restarted.press).not.toHaveBeenCalled();
        return;
      }
      expect(loadSourceFrame).not.toHaveBeenCalled();
      expect(settled.run).toMatchObject({
        phase: "completed",
        completedSteps: 3,
      });
      expect(settled.run?.firstDifference).toBeUndefined();
      expect(restarted.press.mock.calls).toEqual([
        ...(scenario.dispatched ? [] : [[pixel.hostId, deliveryRef]]),
        [pixel.hostId, reviewRef],
      ]);

      const completedStore = makeDeviceComparisonStore(directory);
      expect(await Effect.runPromise(completedStore.loadReplay(threadId, runId))).toBeUndefined();
      const completed = fixture(ios, android, true, completedStore);
      const latest = await completed.invoke(status, panelSession);
      expect(latest.run).toMatchObject({
        runId,
        phase: "completed",
        completedSteps: 3,
      });
      expect(latest.canRestoreReplay).toBeUndefined();
      await expect(completed.invoke(restore, panelSession)).rejects.toThrow();
    } finally {
      original.reopenDestination();
      release.resolve();
      try {
        if (interrupted) await original.settle();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it.each(["retained screen", "screen changed after restore", "lost correction reply"] as const)(
    "restores a saved checkout checkpoint with %s without repeating a completed tap",
    async (scenario) => {
      const directory = await mkdtemp(join(tmpdir(), "tabs-paused-replay-"));
      try {
        const ios = [
          frame("ios", ["Continue"], ["Total: $20.00"]),
          frame("ios", ["Review"], ["Total: $20.00"]),
          frame("ios", [], ["Order review", "Total: $20.00"]),
        ];
        const android = [
          frame("android", ["Continue"], ["Total: $20.00"]),
          frame("android", ["Review"], ["Total: $22.00"]),
          frame("android", [], ["Order review", "Total: $20.00"]),
        ];
        const open = () => fixture(ios, android, true, makeDeviceComparisonStore(directory));
        const original = open();
        const runId = await original.begin();
        await original.tap(runId, "Continue");
        const { controls } = await original.tap(runId, "Review");
        await original.invoke({
          action: "expect",
          threadId,
          runId,
          controlId: controls!.find(({ label }) => label === "Order review")!.id,
        });
        await original.approve(runId);
        await original.replay(runId, {
          sourceLabel: "Total",
          targetLabel: "Total",
          currency: "USD",
        });
        const paused = await original.settle();
        expect(paused.run).toMatchObject({
          phase: "paused",
          firstDifference: {
            step: 1,
            sourceTotal: "USD 20.00",
            targetTotal: "USD 22.00",
          },
        });
        const reference = { threadId, runId };
        const frozen = await original.invoke({
          ...reference,
          action: "evidence",
        });
        expect(
          original.press.mock.calls.filter(([hostId]) => hostId === pixel.hostId),
        ).toHaveLength(1);
        const restore = {
          ...reference,
          action: "restoreReplay",
          device: pixel,
          appId: androidApp,
        } as const;
        const restart = () => {
          const f = open();
          f.positions.set(pixel.hostId, 1);
          return f;
        };
        let restarted = restart();
        expect(
          (await restarted.invoke({ ...reference, action: "status" }, panelSession))
            .canRestoreReplay,
        ).toBe(true);
        expect(
          await restarted.invoke({ ...reference, action: "evidence" }, panelSession),
        ).toMatchObject({ canRestoreReplay: true, evidence: frozen.evidence });
        expect(
          (await restarted.invoke({ ...reference, action: "evidence" })).canRestoreReplay,
        ).toBeUndefined();
        expect(
          (await restarted.invoke({ ...reference, action: "status" }, undefined, recordingCaller))
            .canRestoreReplay,
        ).toBeUndefined();
        await expect(restarted.invoke(restore)).rejects.toThrow("Device panel");
        await expect(
          restarted.invoke({ ...restore, device: iphone }, panelSession),
        ).rejects.toThrow("original destination");
        await expect(
          restarted.invoke({ ...restore, threadId: otherThreadId }, panelSession),
        ).rejects.toThrow("original destination");
        expect(restarted.snapshot).not.toHaveBeenCalled();
        let restored;
        if (scenario === "retained screen") {
          const reading = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const snapshot = restarted.snapshot.getMockImplementation()!;
          restarted.snapshot.mockImplementationOnce((...args) =>
            Effect.promise(() => {
              reading.resolve();
              return release.promise;
            }).pipe(Effect.andThen(snapshot(...args))),
          );
          const controller = new AbortController();
          const first = Effect.runPromise(restarted.service.invoke(restore, panelSession), {
            signal: controller.signal,
          });
          const disconnected = expect(first).rejects.toThrow();
          let retries: Promise<Awaited<typeof first>[]> | undefined;
          try {
            await reading.promise;
            controller.abort();
            await disconnected;
            retries = Promise.all([
              restarted.invoke(restore, panelSession),
              restarted.invoke(restore, panelSession),
            ]);
            await expect(
              restarted.invoke(restore, AuthSessionId.make("foreign-session")),
            ).rejects.toThrow("that restored");
            await expect(
              restarted.invoke({ ...restore, appId: iosApp }, panelSession),
            ).rejects.toThrow("original destination");
            expect(restarted.snapshot).toHaveBeenCalledTimes(1);
          } finally {
            release.resolve();
          }
          const [one, two] = (await retries)!;
          expect(one).toEqual(two);
          expect(await restarted.invoke(restore, panelSession)).toEqual(one);
          expect(restarted.snapshot).toHaveBeenCalledTimes(1);
          restored = one;
        } else {
          restored = await restarted.invoke(restore, panelSession);
        }
        expect(restored?.run).toMatchObject({
          phase: "paused",
          completedSteps: 0,
          uncertainTap: false,
        });
        const resume = { ...reference, action: "resume" } as const;
        await expect(
          restarted.invoke(resume, AuthSessionId.make("foreign-session")),
        ).rejects.toThrow("that restored");
        expect(restarted.open).not.toHaveBeenCalled();
        expect(restarted.press).not.toHaveBeenCalled();
        const correctTotal = () => {
          android[1] = frame("android", ["Review"], ["Total: $20.00"]);
        };
        if (scenario === "screen changed after restore") {
          correctTotal();
          await restarted.invoke(resume, panelSession);
          expect((await restarted.settle()).run).toMatchObject({
            phase: "paused",
            uncertainTap: true,
          });
        } else {
          await restarted.invoke(
            {
              ...reference,
              action: "takeover",
              liveInput: true,
              device: pixel,
            },
            panelSession,
          );
          const { manualControlId } = await restarted.invoke(
            { action: "status", threadId, device: pixel },
            panelSession,
          );
          restarted.manual.mockImplementationOnce(() =>
            Effect.sync(correctTotal).pipe(
              Effect.andThen(
                scenario === "lost correction reply"
                  ? Effect.fail(
                      new DeviceComparisonError({
                        reason: "Correction reply lost.",
                      }),
                    )
                  : Effect.void,
              ),
            ),
          );
          const corrected = restarted.invoke(
            {
              ...reference,
              action: "manualInput",
              controlId: manualControlId!,
              gesture: { type: "tap", x: 0.5, y: 0.5 },
            },
            panelSession,
          );
          if (scenario === "lost correction reply") {
            await expect(corrected).rejects.toThrow("Correction reply lost");
            restarted = restart();
            expect((await restarted.invoke(restore, panelSession)).run?.uncertainTap).toBe(true);
          } else {
            await corrected;
            await restarted.invoke({ ...resume, controlId: manualControlId! }, panelSession);
          }
        }
        if (scenario !== "retained screen") {
          await expect(restarted.invoke(resume, panelSession)).rejects.toThrow("confirm whether");
          expect(restarted.press).not.toHaveBeenCalled();
          await restarted.invoke({ ...reference, action: "resolve", applied: false }, panelSession);
          await restarted.invoke(resume, panelSession);
        }
        expect((await restarted.settle()).run).toMatchObject({
          phase: "completed",
          completedSteps: 2,
          firstDifference: frozen.run?.firstDifference,
        });
        expect(restarted.open).not.toHaveBeenCalled();
        expect(restarted.press.mock.calls).toEqual([[pixel.hostId, "@e1~s42"]]);
        const completed = restart();
        const loaded = await completed.invoke({
          ...reference,
          action: "evidence",
        });
        expect(loaded.run?.phase).toBe("completed");
        expect(loaded.evidence).toEqual(frozen.evidence);
        expect(
          (await completed.invoke({ ...reference, action: "status" }, panelSession))
            .canRestoreReplay,
        ).toBeUndefined();
        await expect(completed.invoke(restore, panelSession)).rejects.toThrow(
          "original destination",
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("pauses without sending the next input when recording uncertainty fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tabs-replay-save-failure-"));
    try {
      const store = makeDeviceComparisonStore(directory);
      const f = fixture(
        [frame("ios", ["Continue"]), frame("ios", ["Review"]), frame("ios", [])],
        [frame("android", ["Continue"]), frame("android", ["Review"])],
        true,
        {
          ...store,
          saveReplay: (owner, report, checkpoint, isCurrent) =>
            checkpoint.index === 1 && checkpoint.applied === "unknown"
              ? Effect.fail(
                  new DeviceComparisonError({
                    reason: "Could not save replay progress.",
                  }),
                )
              : store.saveReplay(owner, report, checkpoint, isCurrent),
        },
      );
      const runId = await f.begin();
      await f.tap(runId, "Continue");
      await f.tap(runId, "Review");
      await f.approve(runId);
      await f.replay(runId);
      const { run } = await f.settle();
      expect(run).toMatchObject({
        phase: "paused",
        completedSteps: 1,
        pauseReason: "Could not save replay progress.",
      });
      expect(run?.firstDifference).toBeUndefined();
      expect(f.press.mock.calls.filter(([host]) => host === pixel.hostId)).toEqual([
        [pixel.hostId, "@e1~s42"],
      ]);
      const saved = await Effect.runPromise(store.loadReplay(threadId, runId));
      expect(saved?.checkpoint).toMatchObject({ index: 1, applied: "no" });
      await f.invoke({ action: "stop", threadId, runId }, panelSession);
      const restarted = makeDeviceComparisonStore(directory);
      expect(await Effect.runPromise(restarted.loadReplay(threadId, runId))).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["explicit stop", "a newer run"] as const)(
    "retires the active checkpoint after %s and preserves the old frozen evidence",
    async (retirement) => {
      const directory = await mkdtemp(join(tmpdir(), "tabs-replay-retirement-"));
      try {
        const store = makeDeviceComparisonStore(directory);
        const ios = [frame("ios", ["Continue"]), frame("ios", [], ["Order review"])];
        const android = [frame("android", ["Back"])];
        const f = fixture(ios, android, true, store);
        const runId = await f.begin();
        await f.tap(runId, "Continue");
        await f.approve(runId);
        await f.replay(runId);
        await f.settle();
        const reference = { threadId, runId };
        const evidenceRequest = { ...reference, action: "evidence" } as const;
        const frozen = await f.invoke(evidenceRequest, panelSession);
        expect(frozen.evidence).toMatchObject({
          sourcePng: expect.any(String),
          targetPng: expect.any(String),
        });
        expect(await Effect.runPromise(store.loadReplay(threadId, runId))).toBeDefined();

        if (retirement === "explicit stop") {
          await f.invoke({ ...reference, action: "stop" }, panelSession);
        } else {
          f.reopenDestination();
          expect(
            await f.invoke({ action: "status", threadId, device: pixel }, panelSession),
          ).toMatchObject({
            canRestoreReplay: true,
            run: { runId, phase: "stopped" },
          });
          const newerRunId = await f.begin();
          await f.invoke({ threadId, runId: newerRunId, action: "stop" }, panelSession);
          expect((await f.status()).run?.runId).toBe(newerRunId);
        }

        const reopenedStore = makeDeviceComparisonStore(directory);
        const restarted = fixture(ios, android, true, reopenedStore);
        expect(await Effect.runPromise(reopenedStore.loadReplay(threadId, runId))).toBeUndefined();
        const report = await restarted.invoke(evidenceRequest, panelSession);
        expect(report.run).toMatchObject({
          runId,
          phase: "stopped",
          firstDifference: frozen.run?.firstDifference,
        });
        expect(report.evidence).toEqual(frozen.evidence);
        expect(report.canRestoreReplay).toBeUndefined();
        await expect(
          restarted.invoke(
            {
              ...reference,
              action: "restoreReplay",
              device: pixel,
              appId: androidApp,
            },
            panelSession,
          ),
        ).rejects.toThrow("checkpoint is no longer available");
        expect(restarted.snapshot).not.toHaveBeenCalled();
        expect(restarted.press).not.toHaveBeenCalled();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("shows the completed replay when its result was committed before the latest pointer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tabs-replay-completed-result-"));
    try {
      const store = makeDeviceComparisonStore(directory);
      const ios = [frame("ios", ["Continue"]), frame("ios", [], ["Order review"])];
      const android = [frame("android", ["Back"])];
      const original = fixture(ios, android, true, store);
      const runId = await original.begin();
      await original.tap(runId, "Continue");
      await original.approve(runId);
      await original.replay(runId);
      expect((await original.settle()).run?.phase).toBe("paused");
      const active = await Effect.runPromise(store.loadReplay(threadId, runId));
      expect(active?.report).toBeDefined();
      const report = active!.report!;
      await Effect.runPromise(
        store.save(threadId, { ...report, phase: "completed", completedSteps: 1 }, {}, () => true),
      );
      const threadKey = createHash("sha256").update(threadId).digest("hex");
      await rm(join(directory, "device-comparisons", `${threadKey}.latest`));

      const restarted = fixture(ios, android, true, makeDeviceComparisonStore(directory));
      const status = await restarted.invoke(
        { action: "status", threadId, device: pixel },
        panelSession,
      );
      expect(status.run).toMatchObject({
        runId,
        phase: "completed",
        completedSteps: 1,
      });
      expect(status.canRestoreReplay).toBeUndefined();
      expect(restarted.press).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps a newer comparison when a saved restore races checkpoint loading", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tabs-replay-restore-race-"));
    try {
      const store = makeDeviceComparisonStore(directory);
      const ios = [frame("ios", ["Continue"]), frame("ios", [], ["Order review"])];
      const android = [frame("android", ["Back"])];
      const original = fixture(ios, android, true, store);
      const runId = await original.begin();
      await original.tap(runId, "Continue");
      await original.approve(runId);
      await original.replay(runId);
      expect((await original.settle()).run?.phase).toBe("paused");

      const reading = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const restarted = fixture(ios, android, true, {
        ...store,
        loadReplay: (...args) =>
          Effect.promise(() => {
            reading.resolve();
            return release.promise;
          }).pipe(Effect.andThen(store.loadReplay(...args))),
      });
      const reference = { threadId, runId };
      const pending = restarted.invoke(
        {
          ...reference,
          action: "restoreReplay",
          device: pixel,
          appId: androidApp,
        },
        panelSession,
      );
      const rejected = expect(pending).rejects.toThrow("newer comparison");
      try {
        await reading.promise;
        const newer = await restarted.begin();
        // The newer run is replaceable through the ordinary start path.
        await restarted.invoke({ action: "stop", threadId, runId: newer });
        release.resolve();
        await rejected;
        expect((await restarted.status()).run?.runId).toBe(newer);
        expect(
          await restarted.invoke({ ...reference, action: "evidence" }, panelSession),
        ).toMatchObject({
          run: { runId, phase: "stopped" },
          evidence: expect.any(Object),
        });
        expect(
          (await restarted.invoke({ ...reference, action: "status" }, panelSession))
            .canRestoreReplay,
        ).toBeUndefined();
        expect(restarted.snapshot.mock.calls.map(([device]) => device.hostId)).toEqual([
          iphone.hostId,
        ]);
        expect(restarted.press).not.toHaveBeenCalled();
      } finally {
        release.resolve();
        await pending.catch(() => undefined);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { diverged: false, interruption: "a late Stop request" },
    {
      diverged: true,
      interruption: "replacement of the destination attachment",
    },
  ])(
    "reopens a completed replay through a fresh Device service after $interruption",
    async ({ diverged }) => {
      const directory = await mkdtemp(join(tmpdir(), "tabs-comparison-completed-"));
      const saving = Promise.withResolvers<void>();
      const finishSave = Promise.withResolvers<void>();
      try {
        const store = makeDeviceComparisonStore(directory);
        const android = [
          frame("android", [diverged ? "Back" : "Continue"]),
          frame("android", [], ["Order review"]),
        ];
        const f = fixture(
          [frame("ios", ["Continue"]), frame("ios", [], ["Order review"])],
          android,
          true,
          {
            ...store,
            save: (owner, report, evidence, isCurrent) =>
              report.phase === "completed"
                ? Effect.promise(() => {
                    saving.resolve();
                    return finishSave.promise;
                  }).pipe(Effect.andThen(store.save(owner, report, evidence, isCurrent)))
                : store.save(owner, report, evidence, isCurrent),
          },
        );
        const startReplay = async () => {
          const runId = await f.begin();
          const { controls } = await f.tap(runId, "Continue");
          await f.invoke({
            action: "expect",
            threadId,
            runId,
            controlId: controls!.find(({ label }) => label === "Order review")!.id,
          });
          await f.approve(runId);
          await f.replay(runId);
          return runId;
        };
        const runId = await startReplay();
        const request = { action: "status", threadId, runId } as const;
        const evidenceRequest = { ...request, action: "evidence" } as const;
        let checkpoint: Awaited<ReturnType<typeof f.invoke>> | undefined;
        if (diverged) {
          await f.settle();
          checkpoint = await f.invoke(evidenceRequest);
          expect(checkpoint.run).toMatchObject({
            phase: "paused",
            firstDifference: { step: 1 },
            availableEvidence: { source: true, target: true },
          });
          android[0] = frame("android", ["Continue"]);
          await f.invoke({ ...request, action: "resume" });
        }
        await saving.promise;
        const duringSave = await f.invoke(request, panelSession);
        if (diverged) f.reopenDestination();
        else await f.invoke({ ...request, action: "stop" }, panelSession);
        finishSave.resolve();
        await f.settle();
        expect(duringSave).toMatchObject({
          run: { runId, phase: "completed", busy: true },
          liveTargetAvailable: true,
        });
        const afterSave = await f.invoke(request, panelSession);
        expect(afterSave.liveTargetAvailable).toBe(diverged ? undefined : true);
        const stopped = await f.invoke({ ...request, action: "stop" }, panelSession);
        expect(stopped.run).toMatchObject({
          runId,
          phase: "completed",
          busy: false,
        });

        // A second run on the same pair becomes latest without replacing the saved link.
        f.positions.set(iphone.hostId, 0);
        f.positions.set(pixel.hostId, 0);
        const newerRunId = await startReplay();
        await f.settle();
        const recovered = await Effect.runPromise(
          makeWithHosts(
            new Map(),
            undefined,
            undefined,
            undefined,
            makeDeviceComparisonStore(directory),
          ).pipe(
            Effect.provide(
              settingsLayerTest({
                enableDeviceSupport: true,
                enableAgentDeviceAccess: true,
              }),
            ),
            Effect.provideService(
              HttpClient.HttpClient,
              HttpClient.make(() => Effect.die("unexpected device request")),
            ),
          ),
        );
        const invoke = (input: Parameters<typeof recovered.comparison>[0]) =>
          Effect.runPromise(recovered.comparison(input, panelSession));
        const latest = await invoke({
          action: "status",
          threadId,
          device: pixel,
        });
        expect(latest.run).toMatchObject({
          runId: newerRunId,
          phase: "completed",
        });
        expect(latest.run?.firstDifference).toBeUndefined();
        const result = await invoke(request);
        expect(result).toMatchObject({
          run: {
            runId,
            phase: "completed",
            source: { ...iphone, platform: "ios", appId: iosApp },
            target: { ...pixel, platform: "android", appId: androidApp },
            completedSteps: 1,
            canResume: false,
            savedAt: expect.any(String),
            steps: [{ label: "Continue", expected: "Order review" }],
          },
        });
        expect(result.run?.approvalId).toBeUndefined();
        expect(result.liveTargetAvailable).toBeUndefined();
        expect(result.run?.firstDifference).toEqual(checkpoint?.run?.firstDifference);
        if (diverged) {
          expect(await invoke(evidenceRequest)).toEqual({
            ...result,
            evidence: checkpoint?.evidence,
          });
        } else {
          await expect(invoke(evidenceRequest)).rejects.toThrow("no longer available");
        }
        await expect(invoke({ ...evidenceRequest, runId: newerRunId })).rejects.toThrow(
          "no longer available",
        );
        expect(await invoke({ ...request, runId: approvalRequestId })).toEqual({});
        expect(await invoke({ ...request, threadId: otherThreadId })).toEqual({});
        await expect(invoke({ ...evidenceRequest, threadId: otherThreadId })).rejects.toThrow(
          "no longer available",
        );
        await expect(invoke({ ...request, action: "resume" })).rejects.toThrow(
          "no longer available",
        );
      } finally {
        finishSave.resolve();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("restores only the original thread's first difference and never replays a saved action", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tabs-comparison-restart-"));
    try {
      const f = fixture(
        [frame("ios", ["Continue"]), frame("ios", [], ["Order review"])],
        [frame("android", ["Allow app permission"])],
        true,
        makeDeviceComparisonStore(directory),
      );
      const runId = await f.begin();
      await f.tap(runId, "Continue");
      const approvalId = await f.approve(runId);
      await f.replay(runId);
      expect((await f.settle()).run?.phase).toBe("paused");
      const original = await f.invoke({ action: "evidence", threadId, runId });
      await f.invoke({ action: "stop", threadId, runId });
      f.positions.set(iphone.hostId, 0);
      f.capture.mockImplementation((host) => screenshot(`${host}-later`));
      const newerRunId = await f.begin();
      await f.tap(newerRunId, "Continue");
      await f.approve(newerRunId);
      await f.replay(newerRunId);
      expect((await f.settle()).run?.phase).toBe("paused");
      const emptyState = { ...f.getState(), devices: [], sessions: [] };
      const driver = {
        open: vi.fn(() => Effect.die("unexpected open")),
        snapshot: vi.fn(() => Effect.die("unexpected snapshot")),
        press: vi.fn(() => Effect.die("unexpected tap")),
        scroll: vi.fn(() => Effect.die("unexpected scroll")),
      };
      const captureAfterRestart = vi.fn(() => Effect.die("unexpected capture"));
      const recovered = makeDeviceComparison({
        state: Effect.succeed(emptyState),
        driver,
        screenshot: captureAfterRestart,
        store: makeDeviceComparisonStore(directory),
      });
      const invoke = (input: Parameters<typeof recovered.invoke>[0]) =>
        Effect.runPromise(recovered.invoke(input));
      const latest = await invoke({
        action: "status",
        threadId,
        device: pixel,
      });
      expect(latest.run?.runId).toBe(newerRunId);
      expect(latest.ownerThreadId).toBeUndefined();
      const { run, evidence } = await invoke({
        action: "evidence",
        threadId,
        runId,
      });
      expect(await invoke({ action: "status", threadId, runId })).toEqual({
        run,
      });
      expect(run).toMatchObject({
        runId,
        phase: "stopped",
        savedAt: expect.any(String),
        canResume: false,
        source: { ...iphone, appId: iosApp },
        target: { ...pixel, appId: androidApp },
        firstDifference: original.run?.firstDifference,
      });
      expect(run?.approvalId).toBeUndefined();
      expect(evidence).toEqual(original.evidence);
      const records = join(directory, "device-comparisons");
      const suffix = `.${runId}.jsonl`;
      const olderFile = (await readdir(records)).find((name) => name.endsWith(suffix));
      expect(olderFile).toBeDefined();
      // A checkpoint saved by the previous format stays linkable after a new run.
      await rename(
        join(records, olderFile!),
        join(records, `${olderFile!.slice(0, -suffix.length)}.jsonl`),
      );
      expect((await invoke({ action: "evidence", threadId, runId })).evidence).toEqual(
        original.evidence,
      );
      expect(await invoke({ action: "status", threadId: otherThreadId })).toEqual({});
      expect(await invoke({ action: "status", threadId: otherThreadId, runId })).toEqual({});
      await expect(invoke({ action: "evidence", threadId: otherThreadId, runId })).rejects.toThrow(
        "no longer available",
      );
      await expect(invoke({ action: "resume", threadId, runId })).rejects.toThrow(
        "no longer available",
      );
      await expect(invoke({ action: "replay", threadId, runId, approvalId })).rejects.toThrow(
        "no longer available",
      );
      recovered.revoke();
      expect(await invoke({ action: "status", threadId })).toEqual({});
      expect(await invoke({ action: "status", threadId, runId })).toEqual({});
      await expect(invoke({ action: "evidence", threadId, runId })).rejects.toThrow(
        "Device access is off",
      );
      expect(driver.open).not.toHaveBeenCalled();
      expect(driver.press).not.toHaveBeenCalled();
      expect(driver.snapshot).not.toHaveBeenCalled();
      expect(captureAfterRestart).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("allows only the owning session's live correction and drains input before resume", async () => {
    const owner = AuthSessionId.make("owner");
    const stranger = AuthSessionId.make("stranger");
    const f = fixture(
      [frame("ios", ["Continue"]), frame("ios", [], ["Order review"])],
      [frame("android", ["Allow app permission"]), frame("android", [], ["Order review"])],
    );
    const runId = await f.begin();
    const step = await f.tap(runId, "Continue");
    await f.invoke({
      action: "expect",
      threadId,
      runId,
      controlId: step.controls!.find(({ label }) => label === "Order review")!.id,
    });
    await f.approve(runId);
    await f.replay(runId);
    await f.settle();
    await f.invoke({ action: "takeover", threadId, runId, liveInput: true }, owner);
    const status = (device: typeof pixel, sessionId: AuthSessionId) =>
      f.invoke({ action: "status", threadId, device }, sessionId);
    const { manualControlId } = await status(pixel, owner);
    expect(manualControlId).toBeTypeOf("string");
    expect((await status(pixel, stranger)).manualControlId).toBeUndefined();
    expect((await status(iphone, owner)).manualControlId).toBeUndefined();
    expect(f.service.inputAllowed(pixel.hostId, pixel.deviceId)).toBe(false);
    const manualInput = {
      action: "manualInput",
      threadId,
      runId,
      controlId: manualControlId!,
      gesture: { type: "tap", x: 0.5, y: 0.5 },
    } as const;
    await expect(f.invoke(manualInput, stranger)).rejects.toThrow("Take control");
    let acknowledgeInput: () => void = () => {};
    const acknowledged = new Promise<void>((resolve) => {
      acknowledgeInput = resolve;
    });
    f.manual.mockImplementationOnce(() =>
      Effect.promise(async () => {
        await acknowledged;
        f.positions.set(pixel.hostId, 1);
      }),
    );
    const userTap = f.invoke(manualInput, owner);
    await vi.waitFor(() => expect(f.manual).toHaveBeenCalledExactlyOnceWith(manualInput.gesture));
    const resume = {
      action: "resume",
      runId,
      threadId,
      controlId: manualControlId!,
      stepCompleted: true,
    } as const;
    await expect(f.invoke(resume, owner)).rejects.toThrow("current device operation");
    acknowledgeInput();
    await userTap;
    await expect(f.invoke(resume, stranger)).rejects.toThrow("Tabs session");
    await expect(f.invoke({ ...resume, controlId: crypto.randomUUID() }, owner)).rejects.toThrow(
      "handoff changed",
    );
    await f.invoke(resume, owner);
    expect((await f.settle()).run?.phase).toBe("completed");
    expect(f.press.mock.calls).toEqual([[iphone.hostId, "@e1~s42"]]);
    await expect(f.invoke(manualInput, owner)).rejects.toThrow("Take control");
  });

  it("requires destination approval again after reopening the same host and device", async () => {
    const f = fixture(
      [frame("ios", ["Continue"]), frame("ios", [], ["Order review"])],
      [frame("android", ["Continue"]), frame("android", [], ["Order review"])],
    );
    const runId = await f.begin();
    await f.tap(runId, "Continue");
    await f.approve(runId);
    f.reopenDestination();
    f.open.mockClear();
    await expect(f.replay(runId)).rejects.toThrow("destination session changed");
    expect(f.open).not.toHaveBeenCalled();
    expect(f.press.mock.calls).toEqual([[iphone.hostId, "@e1~s42"]]);

    const approved = await f.invoke({
      action: "approve",
      threadId,
      runId,
      target: pixel,
      appId: androidApp,
    });
    await f.invoke({
      action: "replay",
      threadId,
      runId,
      approvalId: approved.run!.approvalId!,
    });
    expect((await f.settle()).run?.phase).toBe("completed");
    expect(f.press.mock.calls.at(-1)?.[0]).toBe(pixel.hostId);
  });

  it.each(["screen changes", "protected field appears", "status bar clock ticks"] as const)(
    "checks destination evidence when the %s during capture",
    async (scenario) => {
      const isPrivate = scenario === "protected field appears";
      const clockTicked = scenario === "status bar clock ticks";
      const android = [
        frame("android", ["Allow app permission"]),
        frame("android", [clockTicked ? "Allow app permission" : isPrivate ? "Password" : "Retry"]),
      ];
      if (clockTicked) {
        for (const [index, screen] of android.entries()) {
          const time = `10:${18 + index}`;
          android[index] = {
            ...screen,
            nodes: [
              ...screen.nodes,
              {
                index: 4,
                ref: "e5",
                bundleId: "com.android.systemui",
                identifier: "com.android.systemui:id/clock",
                type: "android.widget.TextView",
                label: time,
                value: time,
              },
            ],
          };
        }
      }
      const f = fixture([frame("ios", ["Continue"]), frame("ios", [], ["Order review"])], android);
      const runId = await f.begin();
      await f.tap(runId, "Continue");
      await f.approve(runId);
      f.capture.mockImplementationOnce((host) => {
        expect(host).toBe(pixel.hostId);
        f.positions.set(host, 1);
        return screenshot(host);
      });
      await f.replay(runId);
      const paused = await f.settle();
      expect(paused.run?.firstDifference).toMatchObject({
        step: 1,
        kind: "control",
        reason: expect.stringContaining("Continue"),
      });
      const evidence = await f.invoke({ action: "evidence", threadId, runId });
      expect(evidence.evidence).toEqual({
        sourcePng: screenshot(iphone.hostId).toString("base64"),
        ...(clockTicked && {
          targetPng: screenshot(pixel.hostId).toString("base64"),
        }),
      });
      if (isPrivate) expect(paused.controls).toBeUndefined();
      else
        expect(paused.controls?.map(({ label }) => label)).toEqual(
          clockTicked ? ["Allow app permission", "10:19"] : ["Retry"],
        );
      expect(f.press.mock.calls).toEqual([[iphone.hostId, "@e1~s42"]]);
    },
  );

  it("hands off a protected destination before tapping or capturing it", async () => {
    const protectedScreen = frame("android", ["Continue"]);
    const f = fixture(
      [frame("ios", ["Continue"]), frame("ios", [], ["Order review"])],
      [
        {
          ...protectedScreen,
          nodes: [
            ...protectedScreen.nodes,
            {
              index: 4,
              ref: "e4",
              label: "Password",
              type: "EditText",
              password: true,
            },
          ],
        },
      ],
    );
    const runId = await f.begin();
    await f.tap(runId, "Continue");
    await f.approve(runId);
    await f.replay(runId);
    const paused = await f.settle();
    expect(paused.run?.pauseReason).toContain("protected");
    expect(f.press.mock.calls.every(([host]) => host === iphone.hostId)).toBe(true);
    const evidence = await f.invoke({ action: "evidence", threadId, runId });
    expect(evidence.evidence?.targetPng).toBeUndefined();
  });

  it("freezes the first diverging screens and resumes from a user correction without repeating the tap", async () => {
    const f = fixture(
      [frame("ios", ["Continue"]), frame("ios", ["Review"]), frame("ios", [], ["Order review"])],
      [
        frame("android", ["Grant app permission"]),
        frame("android", ["Review"]),
        frame("android", [], ["Order review"]),
      ],
    );
    const runId = await f.begin();
    await f.tap(runId, "Continue");
    const result = await f.tap(runId, "Review");
    await f.invoke({
      action: "expect",
      threadId,
      runId,
      controlId: result.controls!.find((node) => node.label === "Order review")!.id,
    });
    const oldApproval = await f.approve(runId);
    const updated = await f.invoke({
      action: "approve",
      threadId,
      runId,
      target: pixel,
      appId: androidApp,
    });
    await expect(
      f.invoke({
        action: "replay",
        threadId,
        runId,
        approvalId: oldApproval,
      }),
    ).rejects.toThrow("approved destination changed");
    await f.invoke({
      action: "replay",
      threadId,
      runId,
      approvalId: updated.run!.approvalId!,
    });
    const paused = await f.settle();
    expect(paused.run).toMatchObject({
      phase: "paused",
      completedSteps: 0,
      firstDifference: { kind: "control", step: 1 },
    });
    expect(paused.ownerThreadId).toBe(threadId);
    expect(f.service.inputAllowed(iphone.hostId, iphone.deviceId)).toBe(true);
    expect(f.service.inputAllowed(pixel.hostId, pixel.deviceId)).toBe(false);
    expect(f.service.inputAllowed(pixel.hostId)).toBe(false);
    expect(f.press.mock.calls).toEqual([
      [iphone.hostId, "@e1~s42"],
      [iphone.hostId, "@e1~s42"],
    ]);
    const evidence = await f.invoke({ action: "evidence", threadId, runId });
    expect(evidence.evidence).toEqual({
      sourcePng: screenshot(iphone.hostId).toString("base64"),
      targetPng: screenshot(pixel.hostId).toString("base64"),
    });
    expect(evidence.liveTargetAvailable).toBe(true);
    await expect(f.invoke({ action: "evidence", threadId: otherThreadId, runId })).rejects.toThrow(
      "no longer available",
    );
    await expect(
      f.invoke({
        action: "start",
        threadId: otherThreadId,
        device: pixel,
        appId: androidApp,
      }),
    ).rejects.toThrow("owned");
    await f.tap(runId, "Grant app permission");
    await f.invoke({ action: "resume", threadId, runId });
    const completed = await f.settle();
    expect(completed).toMatchObject({
      liveTargetAvailable: true,
      run: {
        phase: "completed",
        completedSteps: 2,
        firstDifference: { kind: "control", step: 1 },
      },
    });
    expect(completed.ownerThreadId).toBeUndefined();
    expect(f.press.mock.calls.slice(2)).toEqual([
      [pixel.hostId, "@e1~s42"],
      [pixel.hostId, "@e1~s42"],
    ]);
    const statusRef = { action: "status", threadId, runId } as const;
    expect((await f.invoke(statusRef)).liveTargetAvailable).toBe(true);
    f.reopen(pixel);
    const reopened = await f.invoke(statusRef);
    expect(reopened.run?.runId).toBe(runId);
    expect(reopened.liveTargetAvailable).toBeUndefined();
    expect((await f.invoke({ action: "evidence", threadId, runId })).evidence).toEqual(
      evidence.evidence,
    );
  });

  it("treats a permission correction as a prerequisite and still runs the demonstrated control", async () => {
    const f = fixture(
      [frame("ios", ["Continue"]), frame("ios", [], ["Checkout complete"])],
      [
        frame("android", ["Allow once"]),
        frame("android", ["Continue"]),
        frame("android", [], ["Checkout complete"]),
      ],
    );
    const runId = await f.begin();
    await f.tap(runId, "Continue");
    await f.approve(runId);
    await f.replay(runId);
    expect((await f.settle()).run?.phase).toBe("paused");
    await f.tap(runId, "Allow once", true);
    await f.invoke({ action: "resume", threadId, runId });
    expect((await f.settle()).run).toMatchObject({
      phase: "completed",
      completedSteps: 1,
    });
    expect(f.press.mock.calls.map(([host]) => host)).toEqual([
      iphone.hostId,
      pixel.hostId,
      pixel.hostId,
    ]);
  });

  it("replays a renamed and reordered Android button with the same accessibility identifier", async () => {
    const f = fixture(
      [identify(frame("ios", ["Continue", "Cancel"]), "checkout-continue"), frame("ios", [])],
      [
        identify(
          frame("android", ["Cancel", "Go to delivery"]),
          undefined,
          `${androidApp}:id/checkout_continue`,
        ),
        frame("android", []),
      ],
    );
    const runId = await f.begin();
    await f.tap(runId, "Continue");
    await f.approve(runId);
    await f.replay(runId);
    const status = await f.settle();
    expect(status.run).toMatchObject({ phase: "completed", completedSteps: 1 });
    expect(status.run?.firstDifference).toBeUndefined();
    expect(f.press.mock.calls).toEqual([
      [iphone.hostId, "@e1~s42"],
      [pixel.hostId, "@e2~s42"],
    ]);
  });

  it.each([
    {
      conflict: "a different button has the recorded label",
      screenshot: identify(
        frame("android", ["Go to delivery", "Continue"]),
        `${androidApp}:id/checkout_continue`,
      ),
    },
    {
      conflict: "an unlabeled node repeats the shared identifier",
      screenshot: identify(
        frame("android", ["Go to delivery", ""]),
        "checkout_continue",
        "checkout_continue",
      ),
    },
    {
      conflict: "the identifier is in a foreign Android namespace",
      screenshot: identify(
        frame("android", ["Go to delivery"]),
        "com.other.checkout:id/checkout_continue",
      ),
    },
    {
      conflict: "the renamed control would place an order",
      screenshot: identify(frame("android", ["Place order"]), "checkout_continue"),
    },
    {
      conflict: "the identifier belongs to a non-actionable text node",
      screenshot: identify(
        frame("android", ["Continue"], ["Go to delivery"]),
        undefined,
        "checkout_continue",
      ),
    },
  ])("pauses before replay when $conflict", async ({ screenshot }) => {
    const f = fixture(
      [identify(frame("ios", ["Continue"]), "checkout-continue"), frame("ios", [])],
      [screenshot],
    );
    const runId = await f.begin();
    await f.tap(runId, "Continue");
    await f.approve(runId);
    await f.replay(runId);
    expect((await f.settle()).run).toMatchObject({
      phase: "paused",
      completedSteps: 0,
      firstDifference: { kind: "control", step: 1 },
    });
    expect(f.press.mock.calls).toEqual([[iphone.hostId, "@e1~s42"]]);
  });

  it.each([
    { title: "an empty tree", chrome: [] },
    { title: "only the app header", chrome: ["Guest checkout"] },
  ])("rechecks a launch that shows $title before dispatching input", async ({ chrome }) => {
    const total = ["Total: $20.00"];
    const f = fixture(
      [frame("ios", ["Continue"], total), frame("ios", [], total)],
      [frame("android", ["Continue"], total), frame("android", [], total)],
    );
    const runId = await f.begin();
    await f.tap(runId, "Continue");
    await f.approve(runId);
    f.snapshot.mockImplementationOnce(() => Effect.succeed(frame("android", [], chrome)));

    await f.replay(runId, {
      sourceLabel: "Total",
      targetLabel: "Total",
      currency: "USD",
    });
    expect((await f.settle()).run).toMatchObject({
      phase: "completed",
      completedSteps: 1,
    });
    expect(f.press.mock.calls).toEqual([
      [iphone.hostId, "@e1~s42"],
      [pixel.hostId, "@e1~s42"],
    ]);
  });
});

describe.skip("Total check reporting and replay retry", () => {
  const record = async (f: ReturnType<typeof fixture>, extra: string[] = []) => {
    const proposed = await f.propose();
    const runId = proposed.run!.runId;
    expect(proposed.run?.agentRecording?.totalCheck).toBe("none");
    expect(proposed.run?.totalCheck).toBe("none");
    const { run } = await f.approveRecording(runId);
    const { controls } = await f.record({ action: "inspect", runId });
    await f.record({
      action: "tap",
      runId,
      controlId: controls!.find(({ label }) => label === "Continue")!.id,
    });
    const outcome = await f.record({ action: "inspect", runId });
    await f.record({
      action: "expect",
      runId,
      controlId: outcome.controls!.find(({ label }) => label === "Order review")!.id,
    });
    return { runId, approvalId: run!.approvalId!, extra };
  };
});
