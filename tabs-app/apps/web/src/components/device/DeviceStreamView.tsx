import {
  CameraIcon,
  HomeIcon,
  PowerIcon,
  RotateCwIcon,
  SquareIcon,
  ArrowLeftIcon,
  WrenchIcon,
  PictureInPicture2Icon,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
} from "react";
import { canStreamVideo, deviceRailButtons } from "~/device/deviceLogic";
import { readDeviceMjpeg } from "~/device/deviceMjpeg";
import {
  deviceKeyGesture,
  captureDeviceScreenshot,
  createDeviceStream,
  sameOriginHubAccess,
  type DeviceButton,
} from "~/device/deviceStreamClient";
import "./device.css";
import type { DeviceApi } from "~/device/useDeviceApi";
import { useDeviceState } from "~/device/deviceStore";
import type {
  DeviceComparisonGesture,
  DeviceComparisonInput,
  DevicePlatform,
} from "@tabs/contracts";

const STILL_INTERVAL_MS = 700;
const VIDEO_RETRY_MS = 1_000;
const VIDEO_AUTH_ERROR = "The environment could not authorize device video.";
const TAP_DURATION_MS = 500;
const TAP_DISTANCE = 0.02;

export type DeviceSourceInput = {
  observationId: string;
  send: (
    point: Pick<Extract<DeviceComparisonInput, { action: "sourceTap" }>, "x" | "y" | "viewport">,
  ) => void;
};

/** The live screen inside a device frame, with the controls rail. */
export function DeviceStreamView({
  api,
  hostId,
  deviceId,
  platform,
  visible,
  inputDisabled = false,
  manualInput,
  sourceInput,
  onPowerOff,
  onToggleTools,
  onScreenshot,
  toolsOpen = false,
  floating = false,
  onToggleFloat,
}: {
  api?: DeviceApi;
  hostId: string;
  deviceId: string;
  platform: DevicePlatform;
  /** Only the visible tab streams. */
  visible: boolean;
  inputDisabled?: boolean;
  manualInput?: { id: string; send: (gesture: DeviceComparisonGesture) => void } | undefined;
  /** Null blocks the source screen until a fresh observation is available. */
  sourceInput?: DeviceSourceInput | null | undefined;
  onPowerOff: () => void;
  onToggleTools: () => void;
  onScreenshot?: ((blob: Blob) => void) | undefined;
  toolsOpen?: boolean;
  /** True while this screen is in the window over the chat. */
  floating?: boolean;
  onToggleFloat?: (() => void) | undefined;
}) {
  const hubBasePath = useDeviceState(api, (s) => s.state?.hubBasePath);
  const origin = api?.mediaOrigin?.() ?? window.location.origin;
  const access = useMemo(
    () =>
      hubBasePath
        ? {
            ...sameOriginHubAccess({ origin }, hubBasePath, hostId),
            authorize: api?.authorizeMediaUrl,
          }
        : null,
    [hubBasePath, hostId, origin, api],
  );
  const [connected, setConnected] = useState(false);
  const [videoSource, setVideoSource] = useState<{
    frame: Blob;
    deviceId: string;
    access: typeof access;
    signal: AbortSignal;
    onError: () => void;
  } | null>(null);
  const [still, setStill] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const videoImage = useRef<HTMLImageElement>(null);
  const pointerStart = useRef<{
    id: number;
    controlId: string;
    x: number;
    y: number;
    viewport: { width: number; height: number };
    at: number;
    lastMove?: { x: number; y: number; distance: number };
  } | null>(null);
  const streamPointers = useRef(
    new Map<number, { position: { x: number; y: number }; signal: AbortSignal | undefined }>(),
  );
  const streamRef = useRef<ReturnType<typeof createDeviceStream> | null>(null);
  const orientation = useRef("portrait");
  const video = canStreamVideo(window.location);
  // iOS streams MJPEG; Android (and plain-HTTP origins) use refreshed still frames.
  const useStills = platform === "android" || !video;
  const liveVideo =
    videoSource?.deviceId === deviceId && videoSource.access === access ? videoSource : null;
  const sourceMode = sourceInput !== undefined;
  const controlId = sourceMode ? sourceInput?.observationId : manualInput?.id;

  useLayoutEffect(() => {
    pointerStart.current = null;
    streamPointers.current.clear();
  }, [visible, inputDisabled, sourceMode, controlId, deviceId, hostId]);

  useLayoutEffect(() => {
    if (!visible || useStills || !liveVideo || !videoImage.current) return;
    const url = URL.createObjectURL(liveVideo.frame);
    videoImage.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [visible, useStills, liveVideo]);

  useEffect(() => {
    if (!visible || !access) return;
    const stream = createDeviceStream({
      platform,
      deviceId,
      access,
      onInputConnected: setConnected,
    });
    streamRef.current = stream;
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let videoAttempt: AbortController | undefined;
    let videoPaint = 0;
    if (!useStills && stream.videoUrl) {
      const videoUrl = stream.videoUrl;
      const authorize = access.authorize;
      const retryVideo = () => {
        if (!active || retryTimer !== undefined) return;
        videoAttempt?.abort();
        cancelAnimationFrame(videoPaint);
        pointerStart.current = null;
        setVideoSource(null);
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          void loadVideo();
        }, VIDEO_RETRY_MS);
      };
      const loadVideo = async () => {
        if (!active) return;
        videoAttempt = new AbortController();
        const { signal } = videoAttempt;
        let url: string;
        try {
          url = authorize ? await authorize(videoUrl) : videoUrl;
        } catch {
          if (signal.aborted) return;
          setNotice(VIDEO_AUTH_ERROR);
          retryVideo();
          return;
        }
        if (signal.aborted) return;
        setNotice((current) => (current === VIDEO_AUTH_ERROR ? null : current));
        const onError = () => {
          if (!signal.aborted) retryVideo();
        };
        try {
          for await (const frame of readDeviceMjpeg(url, {
            credentials: access.credentials ? "include" : "omit",
            signal,
          })) {
            if (signal.aborted) return;
            cancelAnimationFrame(videoPaint);
            videoPaint = requestAnimationFrame(() => {
              if (!signal.aborted) setVideoSource({ frame, access, deviceId, signal, onError });
            });
          }
        } catch {
          // An interrupted or invalid response uses the same retry as a clean stream end.
        }
        onError();
      };
      void loadVideo();
    }
    return () => {
      active = false;
      clearTimeout(retryTimer);
      videoAttempt?.abort();
      cancelAnimationFrame(videoPaint);
      setVideoSource(null);
      stream.close();
      streamRef.current = null;
      setConnected(false);
    };
  }, [visible, access, platform, deviceId, useStills]);

  useEffect(() => {
    if (!visible || !useStills || !streamRef.current) return;
    let stopped = false;
    let url: string | null = null;
    const controller = new AbortController();
    let pending = false;
    const tick = async () => {
      if (pending) return;
      const stream = streamRef.current;
      if (!stream || !access) return;
      pending = true;
      try {
        const blob = await captureDeviceScreenshot(stream, access, controller.signal);
        if (stopped) return;
        const next = URL.createObjectURL(blob);
        if (url) URL.revokeObjectURL(url);
        url = next;
        setStill(next);
      } catch (error) {
        if (!stopped)
          setNotice(error instanceof Error ? error.message : "Device stream unavailable.");
      } finally {
        pending = false;
      }
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
  const imagePoint = (event: PointerEvent, clamp: boolean) => {
    if (!useStills && (!liveVideo || liveVideo.signal.aborted)) return null;
    const image = screen.current?.querySelector("img");
    if (!image?.naturalWidth || !image.naturalHeight) return null;
    const rect = image.getBoundingClientRect();
    const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    if (!(scale > 0)) return null;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const x = (event.clientX - rect.left - (rect.width - width) / 2) / width;
    const y = (event.clientY - rect.top - (rect.height - height) / 2) / height;
    if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
      viewport: { width: image.naturalWidth, height: image.naturalHeight },
    };
  };
  const touch = (phase: "begin" | "move" | "end") => (event: PointerEvent) => {
    if (inputDisabled || !visible) return;
    if (sourceMode || manualInput) {
      if (!controlId) return;
      if (phase === "begin" && event.isPrimary && event.button === 0) {
        const position = imagePoint(event, false);
        if (!position) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        screen.current?.focus();
        pointerStart.current = {
          ...position,
          id: event.pointerId,
          controlId,
          at: performance.now(),
        };
      } else if (
        pointerStart.current?.id === event.pointerId &&
        (phase === "end" || (phase === "move" && sourceMode))
      ) {
        const start = pointerStart.current;
        if (phase === "end") pointerStart.current = null;
        if (event.type === "pointercancel" || start.controlId !== controlId) return;
        const end = imagePoint(event, !sourceMode);
        if (
          !end ||
          end.viewport.width !== start.viewport.width ||
          end.viewport.height !== start.viewport.height
        ) {
          pointerStart.current = null;
          return;
        }
        const previous = start.lastMove ?? start;
        const distance =
          (start.lastMove?.distance ?? 0) + Math.hypot(previous.x - end.x, previous.y - end.y);
        if (phase === "move") {
          if (distance >= TAP_DISTANCE || event.buttons !== 1) pointerStart.current = null;
          else start.lastMove = { x: end.x, y: end.y, distance };
          return;
        }
        const duration = Math.round(performance.now() - start.at);
        const tap = duration < TAP_DURATION_MS && distance < TAP_DISTANCE;
        if (sourceMode) {
          if (tap && event.isPrimary && event.button === 0) sourceInput?.send(end);
        } else if (tap) {
          manualInput?.send({ type: "tap", ...end });
        } else {
          manualInput?.send({
            type: "swipe",
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y,
            durationMs: Math.min(1500, Math.max(50, duration)),
            viewport: end.viewport,
          });
        }
      }
      return;
    }
    const previous = streamPointers.current.get(event.pointerId);
    if (phase !== "begin" && !previous) return;
    if (phase === "move" && event.buttons === 0) return;
    const frameAvailable =
      useStills || (liveVideo && !liveVideo.signal.aborted && videoImage.current?.naturalWidth);
    const current = frameAvailable && !previous?.signal?.aborted ? point(event) : null;
    // Release a held touch on pointer-up even if its frame has since disconnected.
    const position = current ?? (phase === "end" ? previous?.position : undefined);
    if (!position) return;
    if (phase === "begin") {
      event.currentTarget.setPointerCapture(event.pointerId);
      screen.current?.focus();
    }
    if (phase === "end") streamPointers.current.delete(event.pointerId);
    else
      streamPointers.current.set(event.pointerId, {
        position,
        signal: previous?.signal ?? liveVideo?.signal,
      });
    streamRef.current?.sendTouch(phase, position.x, position.y);
  };

  const press = (button: DeviceButton) => {
    if (!manualInput) streamRef.current?.pressButton(button);
    else if (button !== "power") manualInput.send({ type: button });
  };
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
    home: {
      label: "Home",
      icon: <HomeIcon size={15} />,
      run: () => press("home"),
    },
    back: {
      label: "Back",
      icon: <ArrowLeftIcon size={15} />,
      run: () => press("back"),
    },
    recents: {
      label: "Recents",
      icon: <SquareIcon size={15} />,
      run: () => press("recents"),
    },
    rotate: {
      label: "Rotate",
      icon: <RotateCwIcon size={15} />,
      run: () => {
        streamRef.current?.rotate(orientation.current);
        orientation.current = nextOrientation(orientation.current);
      },
    },
    power: {
      label: "Power off",
      icon: <PowerIcon size={15} />,
      run: onPowerOff,
    },
  };
  const navButtons = deviceRailButtons(platform).filter((id) => id !== "power");

  return (
    <div className="dv-stage">
      <div className="dv-device">
        <div className="dv-frame">
          <div
            ref={screen}
            className="dv-screen"
            tabIndex={0}
            role="application"
            aria-label="Device screen"
            aria-disabled={inputDisabled}
            onPointerDown={touch("begin")}
            onPointerMove={touch("move")}
            onPointerUp={touch("end")}
            onPointerCancel={touch("end")}
            onLostPointerCapture={(event) => {
              if (pointerStart.current?.id === event.pointerId) pointerStart.current = null;
              streamPointers.current.delete(event.pointerId);
            }}
            onKeyDown={(event) => {
              if (inputDisabled || sourceMode || event.nativeEvent.isComposing) return;
              if (!manualInput) streamRef.current?.sendKey(event);
              else if (
                !event.altKey &&
                !event.ctrlKey &&
                !event.metaKey &&
                !(event.key === "Tab" && event.shiftKey)
              ) {
                const gesture = deviceKeyGesture(platform, event);
                if (gesture) {
                  event.preventDefault();
                  manualInput.send(gesture);
                }
              }
            }}
          >
            {visible && !useStills && liveVideo ? (
              <img
                ref={videoImage}
                className="dv-image"
                alt="Live device screen"
                draggable={false}
                onError={liveVideo.onError}
              />
            ) : still ? (
              <img className="dv-image" alt="Device screen" draggable={false} src={still} />
            ) : (
              <p className="dv-connecting">Connecting to the screen…</p>
            )}
          </div>
        </div>
        <div className="dv-status" aria-live="polite">
          {!connected && visible && !manualInput && !sourceMode && (
            <span className="dv-muted">Reconnecting touch controls…</span>
          )}
          {!video && (
            <span className="dv-muted">
              Live video needs HTTPS or localhost, so this shows still frames.
            </span>
          )}
          {notice && <span className="dv-muted">{notice}</span>}
        </div>
      </div>
      <div className="dv-rail" role="group" aria-label="Device controls">
        {navButtons.map((id) => {
          const item = labels[id]!;
          return (
            <button
              key={id}
              type="button"
              className="dv-control"
              aria-label={item.label}
              title={item.label}
              disabled={
                inputDisabled || sourceMode || (manualInput !== undefined && id === "rotate")
              }
              onClick={item.run}
            >
              {item.icon}
            </button>
          );
        })}
        <span className="dv-rail-rule" aria-hidden="true" />
        <button
          type="button"
          className="dv-control"
          aria-label="Screenshot to composer"
          title="Screenshot to composer"
          disabled={!onScreenshot || manualInput !== undefined}
          onClick={() => void capture()}
        >
          <CameraIcon size={15} />
        </button>
        {onToggleFloat && (
          <button
            type="button"
            className="dv-control"
            aria-label={floating ? "Return to panel" : "Float over chat"}
            title={floating ? "Return to panel" : "Float over chat"}
            aria-pressed={floating}
            onClick={onToggleFloat}
          >
            <PictureInPicture2Icon size={15} />
          </button>
        )}
        <button
          type="button"
          className="dv-control"
          aria-label="Tools"
          title="Tools"
          aria-pressed={toolsOpen}
          disabled={inputDisabled || sourceMode || manualInput !== undefined}
          onClick={onToggleTools}
        >
          <WrenchIcon size={15} />
        </button>
        <span className="dv-rail-rule" aria-hidden="true" />
        <button
          type="button"
          className="dv-control"
          data-destructive
          aria-label={labels.power!.label}
          title={labels.power!.label}
          disabled={inputDisabled || sourceMode || manualInput !== undefined}
          onClick={labels.power!.run}
        >
          {labels.power!.icon}
        </button>
      </div>
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
