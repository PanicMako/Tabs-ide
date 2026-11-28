import type {
  DeviceComparisonReport,
  DeviceComparisonViewRef,
  EnvironmentId,
  NativeApi,
  ThreadId,
} from "@tabs/contracts";
import { toastManager } from "~/components/ui/toast";
import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import { useRightPanelStore } from "~/stores/rightPanelStore";
import {
  findComparisonDeviceTab,
  findLiveComparisonTab,
  openDeviceComparisonResult,
} from "./comparisonResult";

const watches = new WeakMap<NativeApi["device"], Map<ThreadId, symbol>>();

/** An approved replay can reach its next outcome after the Device panel unmounts. */
export function watchDeviceReplay(
  api: NativeApi["device"],
  environmentId: EnvironmentId,
  threadId: ThreadId,
  started: DeviceComparisonReport,
  navigateToThread: () => Promise<unknown>,
  resumed = false,
) {
  if (!started.target) return;
  const target = started.target;
  const deviceName = target.name;
  let threads = watches.get(api);
  if (!threads) {
    threads = new Map();
    watches.set(api, threads);
  }
  const watching = threads;
  const token = Symbol();
  watching.set(threadId, token);
  const scope = `${environmentId}:${threadId}`;
  const findTab = () => findComparisonDeviceTab(scope, target);
  const matches = (run: DeviceComparisonReport | undefined): run is DeviceComparisonReport =>
    run?.runId === started.runId &&
    run.target?.deviceId === target.deviceId &&
    run.target.hostId === target.hostId &&
    run.target.platform === target.platform &&
    run.target.appId === target.appId;

  const readStatus = () => api.comparison({ action: "status", threadId, runId: started.runId });

  async function reveal(reference?: DeviceComparisonViewRef) {
    const status = await readStatus();
    if (reference) {
      if (
        !matches(status.run) ||
        (reference.step === undefined
          ? status.run.phase !== "completed" || status.run.busy
          : status.run.firstDifference?.step !== reference.step)
      )
        throw new Error("Reopen the original comparison in its thread.");
      await navigateToThread();
      openDeviceComparisonResult(environmentId, threadId, reference);
      return;
    }
    const tab = findLiveComparisonTab(scope, started, target, status);
    if (!tab || status.run?.phase !== "paused")
      throw new Error("The original comparison device is unavailable.");
    await navigateToThread();
    if (findTab()?.id !== tab.id) throw new Error("The original comparison device is unavailable.");
    useCompanionSurfaceStore.getState().activate(scope, tab.id);
    useRightPanelStore.getState().openPanel("device");
  }
  let retry = 0;
  async function poll() {
    if (watching.get(threadId) !== token) return;
    let delay = 0;
    try {
      const status = await readStatus();
      const { run } = status;
      if (watching.get(threadId) !== token) return;
      retry = 0;
      if (!matches(run) || run.phase === "stopped") return;
      const { phase, firstDifference } = run;
      if (phase !== "paused" && (phase !== "completed" || run.busy)) {
        if (phase === "running" || phase === "completed" || findTab())
          delay = phase === "ready" ? 2500 : 650;
        return;
      }
      const reference: DeviceComparisonViewRef | undefined =
        phase === "completed"
          ? { runId: run.runId }
          : firstDifference && !resumed
            ? { runId: run.runId, step: firstDifference.step }
            : undefined;
      const canOpen = reference || findLiveComparisonTab(scope, started, target, status);
      toastManager.add({
        type: phase === "completed" ? "success" : "warning",
        title:
          phase === "completed"
            ? "Device comparison complete"
            : reference
              ? `Device comparison · Step ${reference.step}`
              : "Device comparison paused",
        description:
          phase === "completed"
            ? `${run.completedSteps} ${run.completedSteps === 1 ? "step" : "steps"} completed on ${deviceName}.`
            : `${deviceName} · ${run.pauseReason ?? firstDifference?.reason ?? "Review the current step."}`,
        ...(canOpen && {
          actionProps: {
            children: reference
              ? reference.step === undefined
                ? "Open comparison result"
                : "Open first difference"
              : `Open live ${deviceName}`,
            onClick: () =>
              void reveal(reference).catch(() =>
                toastManager.add({
                  type: "warning",
                  title: "The original comparison is unavailable",
                }),
              ),
          },
        }),
      });
    } catch {
      if (++retry < 6) delay = Math.min(1000 * retry, 5000);
    } finally {
      if (watching.get(threadId) === token) {
        if (delay) setTimeout(() => void poll(), delay);
        else watching.delete(threadId);
      }
    }
  }
  void poll();
}
