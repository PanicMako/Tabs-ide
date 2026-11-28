import {
  type DeviceComparisonReport,
  type DeviceComparisonStatus,
  type DeviceComparisonTarget,
  type NativeApi,
  ThreadId,
} from "@tabs/contracts";
import { expect, it, vi } from "vitest";

import { runDeviceHandoff } from "./deviceHandoff";

const threadId = ThreadId.make("current-thread");
const otherThread = ThreadId.make("other-thread");
const source = {
  hostId: "local",
  deviceId: "phone",
  name: "Source",
  platform: "ios",
  appId: "com.example.app",
} as const;
const target = { ...source, hostId: "remote", name: "Target", platform: "android" } as const;
const run = {
  runId: "00000000-0000-4000-8000-000000000001",
  phase: "running",
  source,
  target,
  busy: true,
  playing: true,
  completedSteps: 0,
  steps: [{ label: "Open settings" }],
  canResume: false,
  uncertainTap: false,
} satisfies DeviceComparisonReport;
const readingDifference = {
  ...run,
  phase: "paused",
  firstDifference: { step: 1, kind: "control", reason: "Settings is unavailable." },
} satisfies DeviceComparisonReport;
const controlId = "00000000-0000-4000-8000-000000000002";
const stillSelected = () => true;

function mockApi(status: DeviceComparisonStatus) {
  return {
    comparison: vi.fn<NativeApi["device"]["comparison"]>().mockResolvedValueOnce(status),
  };
}

it.each([
  ["device-my-turn", "takeoverAgentControl"],
  ["device-stop", "stopAgentControl"],
] as const)("binds %s to the control ID on the selected device", async (action, rpcAction) => {
  const api = mockApi({ agentControl: { id: controlId, phase: "agent", threadId: otherThread } });
  const result = { agentControl: { id: controlId, phase: "stopping", threadId } } as const;
  api.comparison.mockResolvedValueOnce(result);
  const device = { hostId: target.hostId, deviceId: target.deviceId };

  await expect(runDeviceHandoff(api, threadId, device, action, stillSelected)).resolves.toBe(
    result,
  );
  expect(api.comparison.mock.calls).toEqual([
    [{ action: "status", threadId, device }],
    [{ action: rpcAction, threadId, device, controlId }],
  ]);
});

it.each([
  { state: "running", current: run },
  {
    state: "paused and reading first-difference evidence",
    current: readingDifference,
  },
  {
    state: "paused and settled",
    current: { ...run, phase: "paused", busy: false, playing: false, uncertainTap: true },
  },
] satisfies { state: string; current: DeviceComparisonReport }[])(
  "takes a $state replay on its exact target with live input",
  async ({ current }) => {
    const api = mockApi({ ownerThreadId: threadId, run: current });
    const result = { run: { ...run, phase: "paused" } } as const;
    api.comparison.mockResolvedValueOnce(result);

    await expect(
      runDeviceHandoff(api, threadId, target, "device-my-turn", stillSelected),
    ).resolves.toBe(result);
    expect(api.comparison).toHaveBeenNthCalledWith(2, {
      action: "takeover",
      threadId,
      runId: run.runId,
      liveInput: true,
      device: { hostId: target.hostId, deviceId: target.deviceId },
    });
  },
);

it("binds a recording takeover to the exact source host and device", async () => {
  const current = {
    ...run,
    phase: "recording",
    agentRecording: { manual: false },
  } satisfies DeviceComparisonReport;
  const api = mockApi({ ownerThreadId: threadId, run: current });
  api.comparison.mockResolvedValueOnce({ run: { ...current, agentRecording: { manual: true } } });
  const device = { hostId: source.hostId, deviceId: source.deviceId };

  await runDeviceHandoff(api, threadId, source, "device-my-turn", stillSelected);
  expect(api.comparison).toHaveBeenNthCalledWith(2, {
    action: "takeover",
    threadId,
    runId: run.runId,
    liveInput: true,
    device,
  });

  const wrongDevice = mockApi({ ownerThreadId: threadId, run: current });
  await expect(
    runDeviceHandoff(wrongDevice, threadId, target, "device-my-turn", stillSelected),
  ).rejects.toThrow("Select the device");
  expect(wrongDevice.comparison).toHaveBeenCalledTimes(1);
});

it.each([
  [source, { ...run, phase: "recording", playing: false }],
  [target, run],
  [target, { ...run, phase: "paused" }],
] as const)(
  "stops an active comparison on its owned device while work is queued",
  async (device, current) => {
    const api = mockApi({ ownerThreadId: threadId, run: current });
    const result = { run: { ...run, phase: "stopped" } } as const;
    api.comparison.mockResolvedValueOnce(result);

    await expect(
      runDeviceHandoff(api, threadId, device, "device-stop", stillSelected),
    ).resolves.toBe(result);
    expect(api.comparison).toHaveBeenNthCalledWith(2, {
      action: "stop",
      threadId,
      runId: run.runId,
    });
  },
);

it.each([
  { device: source, status: { ownerThreadId: threadId, run: readingDifference } },
  {
    device: { ...target, deviceId: "different-phone" },
    status: { ownerThreadId: threadId, run: readingDifference },
  },
  { device: target, status: { ownerThreadId: otherThread, run: readingDifference } },
  {
    device: target,
    status: { ownerThreadId: threadId, run: { ...readingDifference, savedAt: "2026-11-27" } },
  },
  {
    device: target,
    status: {
      ownerThreadId: threadId,
      manualControlId: controlId,
      run: { ...run, phase: "paused", busy: false, playing: false },
    },
  },
  { device: target, status: { agentControl: { id: controlId, phase: "manual", threadId } } },
] satisfies { device: DeviceComparisonTarget; status: DeviceComparisonStatus }[])(
  "rejects takeover when control, ownership or the replay target does not match",
  async ({ device, status }) => {
    const api = mockApi(status);

    await expect(
      runDeviceHandoff(api, threadId, device, "device-my-turn", stillSelected),
    ).rejects.toThrow();
    expect(api.comparison).toHaveBeenCalledTimes(1);
  },
);

it.each([
  { ownerThreadId: otherThread, run },
  { run },
  { ownerThreadId: threadId, run: { ...run, phase: "ready" } },
  { ownerThreadId: threadId, run: { ...run, phase: "completed" } },
  { ownerThreadId: threadId, run: { ...run, phase: "stopped" } },
  { ownerThreadId: threadId, run: { ...run, target: { ...target, hostId: "other-host" } } },
] satisfies DeviceComparisonStatus[])(
  "rejects stop without an active comparison on the selected device",
  async (status) => {
    const api = mockApi(status);

    await expect(
      runDeviceHandoff(api, threadId, target, "device-stop", stillSelected),
    ).rejects.toThrow();
    expect(api.comparison).toHaveBeenCalledTimes(1);
  },
);

it.each(["device-my-turn", "device-stop"] as const)(
  "checks selection after the status request resolves and before sending %s",
  async (action) => {
    const api = mockApi({ ownerThreadId: threadId, run: readingDifference });
    let selected = true;
    const handoff = runDeviceHandoff(api, threadId, target, action, () => selected);
    selected = false;

    await expect(handoff).rejects.toThrow("The selected device changed");
    expect(api.comparison).toHaveBeenCalledTimes(1);
  },
);

it("surfaces a server rejection if control changes after the status request", async () => {
  const api = mockApi({ agentControl: { id: controlId, phase: "agent", threadId } });
  api.comparison.mockRejectedValueOnce(
    new Error("Device control changed. Refresh the Device panel."),
  );

  await expect(
    runDeviceHandoff(api, threadId, target, "device-stop", stillSelected),
  ).rejects.toThrow("Device control changed");
  expect(api.comparison).toHaveBeenCalledTimes(2);
});
