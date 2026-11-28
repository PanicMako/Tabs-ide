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
});

describe.skip("Device comparison", () => {
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
