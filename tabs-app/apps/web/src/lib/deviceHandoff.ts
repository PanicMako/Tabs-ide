import type {
  DeviceComparisonInput,
  DeviceComparisonStatus,
  DeviceComparisonTarget,
  NativeApi,
  ThreadId,
} from "@tabs/contracts";

function isSameDevice(device: DeviceComparisonTarget, other: DeviceComparisonTarget | undefined) {
  return device.hostId === other?.hostId && device.deviceId === other.deviceId;
}

export async function runDeviceHandoff(
  api: Pick<NonNullable<NativeApi["device"]>, "comparison">,
  threadId: ThreadId,
  device: DeviceComparisonTarget,
  action: "device-my-turn" | "device-stop",
  stillSelected: () => boolean,
): Promise<DeviceComparisonStatus> {
  const selected = { hostId: device.hostId, deviceId: device.deviceId };
  const { agentControl, ownerThreadId, manualControlId, run } = await api.comparison({
    action: "status",
    threadId,
    device: selected,
  });

  let request: DeviceComparisonInput;
  if (agentControl) {
    if (agentControl.phase !== "agent") {
      throw new Error("The agent no longer controls this device.");
    }
    request = {
      action: action === "device-my-turn" ? "takeoverAgentControl" : "stopAgentControl",
      threadId,
      device: selected,
      controlId: agentControl.id,
    };
  } else {
    if (!run || run.savedAt !== undefined || ownerThreadId !== threadId) {
      throw new Error("There is no active agent or comparison control on this device.");
    }
    const isTarget = isSameDevice(selected, run.target);
    if (action === "device-my-turn") {
      const recordingSource =
        run.phase === "recording" &&
        run.agentRecording?.manual === false &&
        isSameDevice(selected, run.source);
      const replayTarget =
        isTarget &&
        (run.phase === "running" || (run.phase === "paused" && manualControlId === undefined));
      if (!recordingSource && !replayTarget)
        throw new Error("Select the device the comparison is controlling.");
      request = {
        action: "takeover",
        threadId,
        runId: run.runId,
        liveInput: true,
        device: selected,
      };
    } else {
      if (
        (!isTarget && !isSameDevice(selected, run.source)) ||
        (run.phase !== "recording" && run.phase !== "running" && run.phase !== "paused")
      ) {
        throw new Error("There is no active comparison to stop on this device.");
      }
      request = { action: "stop", threadId, runId: run.runId };
    }
  }

  if (!stillSelected()) throw new Error("The selected device changed. Select it again.");
  return api.comparison(request);
}
