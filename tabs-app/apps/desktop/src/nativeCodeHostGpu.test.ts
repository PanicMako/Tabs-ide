import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { observeNativeCodeGpu } from "./nativeCodeHostGpu";

it("publishes late GPU availability, crashes and recovery and removes its listeners", () => {
  const app = Object.assign(new EventEmitter(), {
    getGPUFeatureStatus: vi.fn((): { gpu_compositing?: string } => ({})),
  });
  const changed = vi.fn();
  const gpu = observeNativeCodeGpu(app, changed);
  expect(gpu.enabled).toBe(false);
  app.getGPUFeatureStatus.mockReturnValue({ gpu_compositing: "enabled" });
  app.emit("gpu-info-update");
  app.emit("gpu-info-update");
  expect(changed.mock.calls).toEqual([[true]]);
  app.emit("child-process-gone", {}, { type: "Utility" });
  expect(gpu.enabled).toBe(true);
  app.emit("child-process-gone", {}, { type: "GPU" });
  expect(gpu.enabled).toBe(false);
  app.emit("gpu-info-update");
  expect(changed.mock.calls).toEqual([[true], [false], [true]]);
  gpu.dispose();
  expect(app.listenerCount("gpu-info-update")).toBe(0);
  expect(app.listenerCount("child-process-gone")).toBe(0);
});

it("treats unavailable GPU information as disabled until an update", () => {
  const app = Object.assign(new EventEmitter(), {
    getGPUFeatureStatus: vi.fn(() => {
      throw new Error("GPU starting");
    }),
  });
  const gpu = observeNativeCodeGpu(app, vi.fn());
  expect(gpu.enabled).toBe(false);
  gpu.dispose();
});
