import type { EventEmitter } from "node:events";

type GpuApp = Pick<EventEmitter, "on" | "removeListener"> & {
  getGPUFeatureStatus(): { gpu_compositing?: string };
};

/** Electron can retain pre-crash status until its next GPU information update. */
export function observeNativeCodeGpu(app: GpuApp, changed: (enabled: boolean) => void) {
  const read = () => {
    try {
      return app.getGPUFeatureStatus().gpu_compositing === "enabled";
    } catch {
      return false;
    }
  };
  let enabled = read();
  const update = (value: boolean) => {
    if (value !== enabled) {
      enabled = value;
      changed(value);
    }
  };
  const refresh = () => update(read());
  const exited = (_event: unknown, details: { type: string }) => {
    if (details.type === "GPU") update(false);
  };
  app.on("gpu-info-update", refresh);
  app.on("child-process-gone", exited);
  return {
    get enabled() {
      return enabled;
    },
    dispose() {
      app.removeListener("gpu-info-update", refresh);
      app.removeListener("child-process-gone", exited);
    },
  };
}
