import {
  DeviceComparisonError,
  EnvironmentAuthorizationError,
  type DeviceComparisonInput,
  type DeviceComparisonReport,
  type DeviceAccessRequestRef,
  type DeviceComparisonViewRef,
  type DeviceComparisonStatus,
  type EnvironmentId,
  type ThreadId,
} from "@tabs/contracts";
import { environmentApi } from "~/connection/environmentApiRegistry";
import type { DeviceApi } from "~/device/useDeviceApi";
import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import { useRightPanelStore } from "~/stores/rightPanelStore";

export async function restoreDeviceComparison(
  device: Pick<DeviceApi, "comparison">,
  input: Extract<DeviceComparisonInput, { action: "restoreReplay" }>,
) {
  try {
    return await device.comparison(input);
  } catch (cause) {
    if (cause instanceof DeviceComparisonError || cause instanceof EnvironmentAuthorizationError)
      throw cause;
    return device.comparison(input);
  }
}

export function findComparisonDeviceTab(
  scope: string,
  device: DeviceComparisonReport["source"],
  surfaces: Pick<
    ReturnType<typeof useCompanionSurfaceStore.getState>,
    "workspaces"
  > = useCompanionSurfaceStore.getState(),
) {
  return surfaces.workspaces[scope]?.tabs.find(
    (tab) =>
      tab.kind === "device" &&
      !tab.deviceComparisonResult &&
      tab.deviceId === device.deviceId &&
      (tab.hostId ?? "local") === device.hostId &&
      tab.platform === device.platform,
  );
}

export function findLiveComparisonTab(
  scope: string,
  reference: DeviceComparisonViewRef,
  target: NonNullable<DeviceComparisonReport["target"]>,
  status: DeviceComparisonStatus,
) {
  const run = status.run;
  if (
    !status.liveTargetAvailable ||
    run?.runId !== reference.runId ||
    (reference.step !== undefined && run.firstDifference?.step !== reference.step) ||
    run.target?.hostId !== target.hostId ||
    run.target.deviceId !== target.deviceId ||
    run.target.platform !== target.platform ||
    run.target.appId !== target.appId
  )
    return undefined;
  return findComparisonDeviceTab(scope, target);
}

export async function openDeviceComparisonRequest(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  request: DeviceAccessRequestRef,
  isCurrent: () => boolean,
) {
  const { device } = await environmentApi(environmentId);
  if (!device) throw new Error("The connected environment has no device controls.");
  const scope = `${environmentId}:${threadId}`;
  if ("approvalId" in request) {
    const { approvalId, hostId, deviceId } = request;
    const { pendingAppApproval } = await device.comparison({
      action: "status",
      threadId,
      device: { hostId, deviceId },
    });
    if (!isCurrent()) return;
    if (pendingAppApproval?.id !== approvalId)
      throw new Error("This app request is no longer awaiting review.");
    const surfaces = useCompanionSurfaceStore.getState();
    const tab = surfaces.workspaces[scope]?.tabs.find(
      (entry) =>
        entry.kind === "device" &&
        !entry.deviceComparisonResult &&
        entry.deviceId === deviceId &&
        (entry.hostId ?? "local") === hostId,
    );
    if (!tab) throw new Error("The original device tab is closed.");
    surfaces.activate(scope, tab.id);
    useRightPanelStore.getState().openPanel("device");
    return;
  }
  const { run } = await device.comparison({ action: "status", threadId, runId: request.runId });
  if (!isCurrent()) return;
  if (
    run?.runId !== request.runId ||
    run.phase !== "awaiting_approval" ||
    !run.agentRecording ||
    !run.target
  )
    throw new Error("This comparison is no longer awaiting approval.");
  const surfaces = useCompanionSurfaceStore.getState();
  const source = findComparisonDeviceTab(scope, run.source);
  if (!source) throw new Error("The original source device tab is closed.");
  surfaces.activate(scope, source.id);
  useRightPanelStore.getState().openPanel("device");
}

export async function openLiveComparisonTarget(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  reference: DeviceComparisonViewRef,
  target: NonNullable<DeviceComparisonReport["target"]>,
  isCurrent: () => boolean,
) {
  const { device } = await environmentApi(environmentId);
  if (!isCurrent()) return;
  if (!device) throw new Error("The connected environment has no device controls.");
  const status = await device.comparison({ action: "status", threadId, runId: reference.runId });
  if (!isCurrent()) return;
  const scope = `${environmentId}:${threadId}`;
  const tab = findLiveComparisonTab(scope, reference, target, status);
  if (!tab) throw new Error("The original live device is no longer available in this comparison.");
  useCompanionSurfaceStore.getState().activate(scope, tab.id);
  useRightPanelStore.getState().openPanel("device");
}

export function openDeviceComparisonResult(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  result: DeviceComparisonViewRef,
) {
  const scope = `${environmentId}:${threadId}`;
  const surfaces = useCompanionSurfaceStore.getState();
  const existing = surfaces.workspaces[scope]?.tabs.find(
    (tab) =>
      tab.kind === "device" &&
      tab.deviceComparisonResult?.runId === result.runId &&
      tab.deviceComparisonResult.step === result.step,
  );
  if (existing) surfaces.activate(scope, existing.id);
  else
    surfaces.open(scope, "device", {
      title: `${result.step === undefined ? "Comparison result" : "First difference"} · Run ${result.runId.slice(0, 8)}`,
      deviceComparisonResult: result,
    });
  useRightPanelStore.getState().openPanel("device");
}
