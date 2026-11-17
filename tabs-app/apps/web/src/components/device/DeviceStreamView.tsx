import {
  CameraIcon,
  HomeIcon,
  PowerIcon,
  RotateCwIcon,
  SquareIcon,
  ArrowLeftIcon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactElement } from "react";
import { Button } from "~/components/ui/button";
import { canStreamVideo, deviceRailButtons } from "~/device/deviceLogic";
import {
  captureDeviceScreenshot,
  createDeviceStream,
  sameOriginHubAccess,
  type DeviceButton,
} from "~/device/deviceStreamClient";
import { useDeviceStore } from "~/device/deviceStore";
import type { DevicePlatform } from "@tabs/contracts";

const STILL_INTERVAL_MS = 700;

/** The live screen inside a device frame, with the controls rail. */
export function DeviceStreamView({
  deviceId,
  platform,
  visible,
  onPowerOff,
  onToggleTools,
  onScreenshot,
}: {
  deviceId: string;
  platform: DevicePlatform;
  /** Only the visible tab streams. */
  visible: boolean;
  onPowerOff: () => void;
  onToggleTools: () => void;
  onScreenshot?: ((blob: Blob) => void) | undefined;
}) {
  const hubBasePath = useDeviceStore((s) => s.state?.hubBasePath);
  const access = useMemo(
    () => (hubBasePath ? sameOriginHubAccess(window.location, hubBasePath) : null),
    [hubBasePath],
  );
  const [connected, setConnected] = useState(false);
  const [still, setStill] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const streamRef = useRef<ReturnType<typeof createDeviceStream> | null>(null);
  const orientation = useRef("portrait");
  const video = canStreamVideo(window.location);
  // iOS streams MJPEG; Android (and plain-HTTP origins) use refreshed still frames.
  const useStills = platform === "android" || !video;

  useEffect(() => {
    if (!visible || !access) return;
    const stream = createDeviceStream({
      platform,
      deviceId,
      access,
      onInputConnected: setConnected,
    });
    streamRef.current = stream;
    return () => {
      stream.close();
      streamRef.current = null;
      setConnected(false);
    };
  }, [visible, access, platform, deviceId]);

  useEffect(() => {
    if (!visible || !useStills || !streamRef.current) return;
    let stopped = false;
    let url: string | null = null;
    const controller = new AbortController();
    const tick = async () => {
      const stream = streamRef.current;
      if (!stream || !access) return;
      try {
        const blob = await captureDeviceScreenshot(stream, access, controller.signal);
        if (stopped) return;
        const next = URL.createObjectURL(blob);
        if (url) URL.revokeObjectURL(url);
        url = next;
        setStill(next);
      } catch {}
    };
    void tick();
    const timer = setInterval(() => void tick(), STILL_INTERVAL_MS);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [visible, useStills, access, connected, deviceId]);

  const point = (event: PointerEvent) => {
    const rect = screen.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };
  const touch = (phase: "begin" | "move" | "end") => (event: PointerEvent) => {
    const p = point(event);
    if (!p) return;
    if (phase === "begin") {
      event.currentTarget.setPointerCapture(event.pointerId);
      screen.current?.focus();
    }
    if (phase === "move" && event.buttons === 0) return;
    streamRef.current?.sendTouch(phase, p.x, p.y);
  };

  const press = (button: DeviceButton) => streamRef.current?.pressButton(button);
  const capture = async () => {
    if (!access || !streamRef.current) return;
    try {
      onScreenshot?.(await captureDeviceScreenshot(streamRef.current, access));
      setNotice("Screenshot added to the composer.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Screenshot failed.");
    }
  };

  const labels: Record<string, { label: string; icon: ReactElement; run: () => void }> = {
    home: { label: "Home", icon: <HomeIcon size={15} />, run: () => press("home") },
    back: { label: "Back", icon: <ArrowLeftIcon size={15} />, run: () => press("back") },
    recents: { label: "Recents", icon: <SquareIcon size={15} />, run: () => press("recents") },
    rotate: {
      label: "Rotate",
      icon: <RotateCwIcon size={15} />,
      run: () => {
        streamRef.current?.rotate(orientation.current);
        orientation.current = nextOrientation(orientation.current);
      },
    },
    power: { label: "Power off", icon: <PowerIcon size={15} />, run: onPowerOff },
  };

  return (
    <div className="device-stage">
      <div className="device-frame" data-platform={platform}>
        <div
          ref={screen}
          className="device-screen"
          tabIndex={0}
          role="application"
          aria-label="Device screen"
          onPointerDown={touch("begin")}
          onPointerMove={touch("move")}
          onPointerUp={touch("end")}
          onPointerCancel={touch("end")}
          onKeyDown={(event) => {
            streamRef.current?.sendKey(event);
          }}
        >
          {visible && access && !useStills && streamRef.current?.videoUrl ? (
            <img
              className="device-image"
              alt="Live device screen"
              draggable={false}
              src={streamRef.current.videoUrl}
            />
          ) : still ? (
            <img className="device-image" alt="Device screen" draggable={false} src={still} />
          ) : (
            <p className="device-muted device-connecting">Connecting…</p>
          )}
        </div>
      </div>
      <div className="device-rail" role="toolbar" aria-label="Device controls">
        {deviceRailButtons(platform).map((id) => {
          const item = labels[id]!;
          return (
            <Button
              key={id}
              size="icon-sm"
              variant="ghost"
              aria-label={item.label}
              title={item.label}
              onClick={item.run}
            >
              {item.icon}
            </Button>
          );
        })}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Screenshot to composer"
          title="Screenshot to composer"
          disabled={!onScreenshot}
          onClick={() => void capture()}
        >
          <CameraIcon size={15} />
        </Button>
        <Button size="sm" variant="ghost" onClick={onToggleTools} aria-label="Tools">
          <WrenchIcon size={14} /> Tools
        </Button>
      </div>
      {!connected && visible && <p className="device-muted">Input is reconnecting…</p>}
      {!video && (
        <p className="device-muted">Live video needs HTTPS or localhost; showing still frames.</p>
      )}
      {notice && (
        <p role="status" className="device-muted">
          {notice}
        </p>
      )}
    </div>
  );
}

const nextOrientation = (current: string) =>
  ({
    portrait: "landscape_left",
    landscape_left: "portrait_upside_down",
    portrait_upside_down: "landscape_right",
    landscape_right: "portrait",
  })[current] ?? "portrait";
