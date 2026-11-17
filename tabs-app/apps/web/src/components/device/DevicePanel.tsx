import { useState } from "react";
import type { DeviceSummary, ThreadId } from "@tabs/contracts";
import { closeDevice, openDevice, shutdownDevice, useDeviceStore } from "~/device/deviceStore";
import { isDeviceSetupComplete } from "~/device/deviceLogic";
import { useDeviceApi } from "~/device/useDeviceApi";
import { useCompanionSurfaceStore, type CompanionSurface } from "~/stores/companionSurfaceStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import "./device.css";
import { DevicePicker } from "./DevicePicker";
import { DeviceSetup } from "./DeviceSetup";
import { DeviceStreamView } from "./DeviceStreamView";
import { DeviceToolsDrawer } from "./DeviceToolsDrawer";

/** The Device right-panel surface: setup, then picker, then the live screen. */
export function CompanionDevicePanel({
  surface,
  scope,
  threadId,
  environmentId,
  visible = true,
}: {
  surface: CompanionSurface;
  scope: string;
  threadId?: ThreadId | null | undefined;
  environmentId?: string | null | undefined;
  visible?: boolean;
}) {
  const api = useDeviceApi(environmentId);
  const state = useDeviceStore((s) => s.state);
  const error = useDeviceStore((s) => s.error);
  const [tools, setTools] = useState(false);
  const update = useCompanionSurfaceStore((s) => s.update);

  if (!api || !state)
    return (
      <div className="dv-panel">
        <p className="dv-page dv-muted">Loading devices…</p>
      </div>
    );
  if (!isDeviceSetupComplete(state))
    return (
      <div className="dv-panel">
        <DeviceSetup api={api} />
      </div>
    );

  if (!surface.deviceId || !surface.platform) {
    const choose = async (device: DeviceSummary) => {
      if (!threadId) return;
      const session = await openDevice(api, {
        threadId,
        hostId: device.hostId,
        deviceId: device.id,
        platform: device.platform,
      });
      if (session)
        update(scope, surface.id, {
          hostId: device.hostId,
          deviceId: device.id,
          platform: device.platform,
          title: device.name,
        });
    };
    return (
      <div className="dv-panel">
        <DevicePicker api={api} onChoose={(device) => void choose(device)} />
        {!threadId && <p className="dv-muted">Open a thread to attach a device.</p>}
      </div>
    );
  }

  const { deviceId, platform } = surface;
  const hostId = surface.hostId ?? "local";
  const powerOff = async () => {
    await shutdownDevice(api, { hostId, deviceId, platform });
    update(scope, surface.id, { deviceId: undefined as never, platform: undefined as never });
  };
  const attach = (blob: Blob) => {
    if (!threadId) return;
    const file = new File([blob], "device-screenshot.png", { type: "image/png" });
    useComposerDraftStore.getState().addImage(threadId, {
      type: "image",
      id: crypto.randomUUID(),
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      previewUrl: URL.createObjectURL(file),
      file,
    });
  };
  return (
    <div className="dv-panel">
      <DeviceStreamView
        deviceId={deviceId}
        platform={platform}
        visible={visible}
        onPowerOff={() => void powerOff()}
        toolsOpen={tools}
        onToggleTools={() => setTools((value) => !value)}
        onScreenshot={threadId ? attach : undefined}
      />
      <DeviceToolsDrawer
        api={api}
        hostId={hostId}
        deviceId={deviceId}
        platform={platform}
        open={tools}
        onClose={() => setTools(false)}
      />
      {error && (
        <p role="alert" className="dv-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Called when a device tab closes: stop watching, leave the device running. */
export async function closeDeviceTab(
  environmentId: string | null | undefined,
  surface: CompanionSurface,
  threadId: ThreadId | null | undefined,
): Promise<void> {
  if (!surface.deviceId || !threadId) return;
  const { environmentApi } = await import("~/connection/environmentApiRegistry");
  const native = await environmentApi(environmentId ?? null);
  if (native.device)
    await closeDevice(native.device, {
      hostId: surface.hostId ?? "local",
      threadId,
      deviceId: surface.deviceId,
    });
}
