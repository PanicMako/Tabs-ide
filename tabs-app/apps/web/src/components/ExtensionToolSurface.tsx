import { useEffect, useRef, useState } from "react";
import type { DesktopExtensionViewInput, DesktopInstalledExtension } from "@tabs/contracts";
import { useNativeSurfaceOverlaySuspension } from "../nativeSurfaceOverlay";

export function ExtensionToolSurface(props: {
  readonly input: DesktopExtensionViewInput;
  readonly label: string;
  readonly source: DesktopInstalledExtension["source"];
  readonly registryOrigin?: string;
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const { input } = props;
  const overlaySuspended = useRef(false);
  const publishBoundsRef = useRef<(() => void) | null>(null);

  useNativeSurfaceOverlaySuspension({
    enabled: typeof window !== "undefined" && Boolean(window.desktopBridge),
    surfaceReady: true,
    onSuspend: () => {
      overlaySuspended.current = true;
      publishBoundsRef.current?.();
    },
    onResume: () => {
      overlaySuspended.current = false;
      publishBoundsRef.current?.();
    },
  });

  useEffect(() => {
    if (error && retryButtonRef.current) {
      retryButtonRef.current.focus();
    }
  }, [error]);

  useEffect(() => {
    // Each effect owns its native view, including React Strict Mode replays.
    const activationId = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const bridge = window.desktopBridge;
    const host = hostRef.current;
    if (!bridge || !host) {
      setError("Extensions are available in Tabs desktop.");
      return;
    }
    let disposed = false;
    let activated = false;
    let frame = 0;
    const publishBounds = () => {
      frame = 0;
      if (!activated || disposed) return;
      const zoom = Number.parseFloat(document.documentElement.style.zoom) || 1;
      const rect = host.getBoundingClientRect();
      void bridge
        .setExtensionBounds({
          ...input,
          activationId,
          x: Math.round(rect.left * zoom),
          y: Math.round(rect.top * zoom),
          width: Math.round(rect.width * zoom),
          height: Math.round(rect.height * zoom),
          visible: !overlaySuspended.current && rect.width > 0 && rect.height > 0,
        })
        .catch(() => undefined);
    };
    publishBoundsRef.current = publishBounds;
    const scheduleBounds = () => {
      if (frame === 0) frame = window.requestAnimationFrame(publishBounds);
    };
    const observer = new ResizeObserver(scheduleBounds);
    observer.observe(host);
    window.addEventListener("resize", scheduleBounds);
    window.addEventListener("tabs-zoom-change", scheduleBounds);

    const unsubscribeError = bridge.onExtensionViewError?.((event) => {
      if (
        !disposed &&
        event.activationId === activationId &&
        event.projectId === input.projectId &&
        event.extensionId === input.extensionId &&
        event.toolId === input.toolId &&
        event.profileId === input.profileId
      ) {
        setError(event.error);
      }
    });

    void bridge
      .activateExtensionTool({ ...input, activationId })
      .then(() => {
        if (disposed) {
          void bridge.hideExtensionTool({ activationId }).catch(() => undefined);
          return;
        }
        activated = true;
        scheduleBounds();
      })
      .catch((cause) => {
        if (!disposed) {
          const msg = cause instanceof Error ? cause.message : String(cause);
          if (msg.includes("superseded")) return;
          setError(msg);
        }
      });
    return () => {
      disposed = true;
      if (publishBoundsRef.current === publishBounds) publishBoundsRef.current = null;
      unsubscribeError?.();
      observer.disconnect();
      window.removeEventListener("resize", scheduleBounds);
      window.removeEventListener("tabs-zoom-change", scheduleBounds);
      if (frame) window.cancelAnimationFrame(frame);
      void bridge.hideExtensionTool({ activationId }).catch(() => undefined);
    };
  }, [input.extensionId, input.toolId, input.projectId, input.profileId, retryCount]);

  const handleRetry = () => {
    setError(null);
    setRetryCount((count) => count + 1);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      <div
        ref={hostRef}
        role="region"
        className="min-h-0 flex-1"
        aria-label={`${props.label} extension content`}
      />
      {error ? (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center bg-background p-6 text-center text-sm"
        >
          <div className="max-w-md">
            <h2 className="text-base font-semibold text-foreground">
              Could not open {props.label}.
            </h2>
            <p className="mt-2 text-muted-foreground">{error}</p>
            <div className="mt-4">
              <button
                ref={retryButtonRef}
                type="button"
                onClick={handleRetry}
                aria-label={`Retry opening ${props.label}`}
                className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
