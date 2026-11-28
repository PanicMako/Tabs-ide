import { DeviceComparisonReport, EnvironmentId, ThreadId } from "@tabs/contracts";
import * as Schema from "effect/Schema";
import { expect, it, vi } from "vitest";
import { toastManager } from "~/components/ui/toast";
import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import { createFakeDeviceApi } from "./fakeDeviceApi";
import { watchDeviceReplay } from "./comparisonNotice";

const env = EnvironmentId.make("qa");
const threadId = ThreadId.make("checkout");
const scope = env + ":" + threadId;
const run = Schema.decodeUnknownSync(DeviceComparisonReport)({
  runId: "52724452-d32a-42f1-9771-75656595c621",
  phase: "paused",
  busy: false,
  playing: false,
  completedSteps: 1,
  steps: [],
  canResume: true,
  uncertainTap: false,
  source: {
    hostId: "source",
    deviceId: "phone",
    name: "iPhone",
    appId: "com.apple.mobilesafari",
    platform: "ios",
  },
  target: {
    hostId: "target",
    deviceId: "phone",
    name: "Pixel",
    appId: "com.android.chrome",
    platform: "android",
  },
  firstDifference: { step: 2, reason: "The totals differ.", kind: "total" },
});

it.each([
  {
    phase: "completed",
    hasDifference: true,
    title: "Device comparison complete",
    closeDestination: false,
  },
  {
    phase: "completed",
    hasDifference: false,
    title: "Device comparison complete",
    closeDestination: true,
  },
  {
    phase: "paused",
    hasDifference: true,
    title: "Device comparison paused",
    closeDestination: false,
  },
] as const)(
  "notifies at $phase after replay and opens the verified destination",
  async ({ phase, hasDifference, title, closeDestination }) => {
    const store = useCompanionSurfaceStore.getState();
    const initial = store.workspaces;
    const completed = {
      ...run,
      phase,
      completedSteps: 3,
      firstDifference: hasDifference ? run.firstDifference : undefined,
      ...(phase === "paused" ? { pauseReason: "Order review has changed." } : {}),
    };
    const active = { ...completed, phase: "running" as const, busy: true, playing: true };
    const api = createFakeDeviceApi().api;
    const newerRun = { ...active, runId: "9b6fd518-787a-4b36-a10e-cbd9f57a4552" };
    const comparison = vi
      .spyOn(api, "comparison")
      .mockImplementation(async (input) =>
        "runId" in input && input.runId === run.runId
          ? { run: completed, ...(!closeDestination && { liveTargetAvailable: true as const }) }
          : { run: newerRun },
      );
    comparison.mockResolvedValueOnce({ run: active });
    if (phase === "completed")
      comparison.mockResolvedValueOnce({ run: { ...completed, busy: true } });
    const toast = vi.spyOn(toastManager, "add").mockReturnValue("qa-notice");
    const navigate = vi.fn(async () => {});
    vi.useFakeTimers();
    try {
      const destination = store.open(scope, "device", {
        hostId: "target",
        deviceId: "phone",
        platform: "android",
      });
      const other = store.open(scope, "device", {
        hostId: "other-pixel",
        deviceId: "phone",
        platform: "android",
      });
      watchDeviceReplay(api, env, threadId, active, navigate, hasDifference);
      await vi.advanceTimersByTimeAsync(0);
      expect(toast).not.toHaveBeenCalled();
      if (closeDestination) {
        store.close(scope, destination);
        comparison.mockRejectedValueOnce(new Error("Temporarily disconnected"));
        await vi.advanceTimersByTimeAsync(650);
        expect(toast).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(350);
      }
      if (phase === "completed") {
        await vi.advanceTimersByTimeAsync(650);
        expect(toast).not.toHaveBeenCalled();
      }
      await vi.advanceTimersByTimeAsync(650);
      await vi.advanceTimersByTimeAsync(1_300);
      expect(toast).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          title,
          description:
            phase === "paused"
              ? "Pixel · Order review has changed."
              : "3 steps completed on Pixel.",
          actionProps: expect.objectContaining({
            children: phase === "completed" ? "Open comparison result" : "Open live Pixel",
          }),
        }),
      );
      expect(useCompanionSurfaceStore.getState().workspaces[scope]?.activeId).toBe(other);
      const open = toast.mock.calls[0]![0].actionProps?.onClick as () => void;
      open();
      await vi.advanceTimersByTimeAsync(0);
      expect(navigate).toHaveBeenCalledOnce();
      const workspace = useCompanionSurfaceStore.getState().workspaces[scope];
      expect(comparison.mock.calls.map(([input]) => input)).toEqual(
        Array.from({ length: comparison.mock.calls.length }, () => ({
          action: "status",
          threadId,
          runId: run.runId,
        })),
      );
      if (phase === "completed") {
        expect(
          workspace?.tabs.find((tab) => tab.id === workspace.activeId)?.deviceComparisonResult,
        ).toEqual({ runId: run.runId });
      } else expect(workspace?.activeId).toBe(destination);
    } finally {
      vi.useRealTimers();
      useCompanionSurfaceStore.setState({ workspaces: initial });
      vi.restoreAllMocks();
    }
  },
);

it("notifies without moving focus and opens the exact recorded step after the live device closes", async () => {
  const store = useCompanionSurfaceStore.getState();
  const initial = store.workspaces;
  const api = createFakeDeviceApi().api;
  const comparison = vi.spyOn(api, "comparison").mockResolvedValue({ run });
  const toast = vi.spyOn(toastManager, "add").mockReturnValue("qa-notice");
  const navigate = vi.fn(async () => {});
  try {
    const destination = store.open(scope, "device", {
      deviceId: "phone",
      hostId: "target",
      platform: "android",
    });
    const other = store.open(scope, "device", {
      deviceId: "phone",
      hostId: "source",
      platform: "ios",
    });
    watchDeviceReplay(api, env, threadId, run, navigate);
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(useCompanionSurfaceStore.getState().workspaces[scope]?.activeId).toBe(other);
    const open = toast.mock.calls[0]![0].actionProps?.onClick as (() => void) | undefined;
    expect(open).toBeTypeOf("function");
    store.close(scope, destination);
    comparison.mockResolvedValueOnce({ run: { ...run, phase: "stopped", savedAt: "now" } });
    open?.();
    await vi.waitFor(() => {
      const workspace = useCompanionSurfaceStore.getState().workspaces[scope];
      expect(
        workspace?.tabs.find((tab) => tab.id === workspace.activeId)?.deviceComparisonResult,
      ).toEqual({ runId: run.runId, step: 2 });
    });
    expect(navigate).toHaveBeenCalledOnce();
    expect(comparison).toHaveBeenLastCalledWith({ action: "status", threadId, runId: run.runId });
    comparison.mockResolvedValueOnce({
      run: { ...run, firstDifference: { ...run.firstDifference!, step: 3 } },
    });
    open?.();
    await vi.waitFor(() => expect(toast.mock.calls.at(-1)?.[0].title).toContain("unavailable"));
    expect(navigate).toHaveBeenCalledOnce();
  } finally {
    useCompanionSurfaceStore.setState({ workspaces: initial });
    vi.restoreAllMocks();
  }
});
