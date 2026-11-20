import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DeviceSummary, ThreadId } from "@tabs/contracts";
import { closeDevice, openDevice, shutdownDevice, useDeviceStore } from "~/device/deviceStore";
import { isDeviceSetupComplete } from "~/device/deviceLogic";
import { useDeviceApi } from "~/device/useDeviceApi";
import { useCompanionSurfaceStore, type CompanionSurface } from "~/stores/companionSurfaceStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { clampFloatPosition, defaultFloatPosition, floatSizeFor } from "~/device/deviceFloat";
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
  const floating = surface.floating === true;
  const toggleFloat = () => update(scope, surface.id, { floating: !floating });
  const body = (
    <>
      <DeviceStreamView
        deviceId={deviceId}
        platform={platform}
        visible={visible}
        onPowerOff={() => void powerOff()}
        toolsOpen={tools}
        onToggleTools={() => setTools((value) => !value)}
        onScreenshot={threadId ? attach : undefined}
        floating={floating}
        onToggleFloat={toggleFloat}
      />
      <DeviceToolsDrawer
        api={api}
        hostId={hostId}
        deviceId={deviceId}
        platform={platform}
        open={tools}
        onClose={() => setTools(false)}
      />
    </>
  );
  return (
    <div className="dv-panel">
      {floating ? (
        <>
          <div className="dv-empty">
            <strong>Floating over the chat</strong>
            <span className="dv-muted">
              This device is in its own window. Drag it by the title.
            </span>
            <button type="button" className="dv-link" onClick={toggleFloat}>
              Return to panel
            </button>
          </div>
          {createPortal(
            <DeviceFloatWindow
              title={surface.title ?? "Device"}
              x={surface.floatX}
              y={surface.floatY}
              onMove={(x, y) => update(scope, surface.id, { floatX: x, floatY: y })}
              onReturn={toggleFloat}
            >
              {body}
            </DeviceFloatWindow>,
            document.body,
          )}
        </>
      ) : (
        body
      )}
      {error && (
        <p role="alert" className="dv-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** A device in a window of its own over the chat. Drag the title to move it. */
export function DeviceFloatWindow({
  title,
  x,
  y,
  onMove,
  onReturn,
  children,
}: {
  title: string;
  x?: number | undefined;
  y?: number | undefined;
  onMove: (x: number, y: number) => void;
  onReturn: () => void;
  children: React.ReactNode;
}) {
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  const size = floatSizeFor(viewport());
  const start = defaultFloatPosition(size, viewport());
  const [position, setPosition] = useState(
    clampFloatPosition({ x: x ?? start.x, y: y ?? start.y }, size, viewport()),
  );
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  // A smaller window must not leave it stranded off screen.
  useEffect(() => {
    const onResize = () =>
      setPosition((current) => clampFloatPosition(current, floatSizeFor(viewport()), viewport()));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div
      className="dv-float"
      role="dialog"
      aria-label={`${title} floating over the chat`}
      style={{ left: position.x, top: position.y, width: size.width, height: size.height }}
    >
      <div
        className="dv-float-title"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          drag.current = { dx: event.clientX - position.x, dy: event.clientY - position.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          setPosition(
            clampFloatPosition(
              { x: event.clientX - drag.current.dx, y: event.clientY - drag.current.dy },
              size,
              viewport(),
            ),
          );
        }}
        onPointerUp={() => {
          if (!drag.current) return;
          drag.current = null;
          onMove(position.x, position.y);
        }}
      >
        <span className="dv-float-name">{title}</span>
        <button type="button" className="dv-link" onClick={onReturn}>
          Return to panel
        </button>
      </div>
      <div className="dv-float-body">{children}</div>
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
