import { useEffect, useRef, useState } from "react";
import type { DesktopExtensionViewInput } from "@tabs/contracts";

export function ExtensionToolSurface(props: {
  readonly input: DesktopExtensionViewInput;
  readonly label: string;
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { input } = props;

  useEffect(() => {
    const bridge = window.desktopBridge;
    const host = hostRef.current;
    if (!bridge || !host) return;
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
          x: Math.round(rect.left * zoom),
          y: Math.round(rect.top * zoom),
          width: Math.round(rect.width * zoom),
          height: Math.round(rect.height * zoom),
          visible: rect.width > 0 && rect.height > 0,
        })
        .catch(() => undefined);
    };
    const scheduleBounds = () => {
      if (frame === 0) frame = window.requestAnimationFrame(publishBounds);
    };
    const observer = new ResizeObserver(scheduleBounds);
    observer.observe(host);
    window.addEventListener("resize", scheduleBounds);
    window.addEventListener("tabs-zoom-change", scheduleBounds);
    void bridge
      .activateExtensionTool(input)
      .then(() => {
        if (disposed) {
          void bridge.hideExtensionTool().catch(() => undefined);
          return;
        }
        activated = true;
        scheduleBounds();
      })
      .catch((cause) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("resize", scheduleBounds);
      window.removeEventListener("tabs-zoom-change", scheduleBounds);
      if (frame) window.cancelAnimationFrame(frame);
      void bridge.hideExtensionTool().catch(() => undefined);
    };
  }, [input.extensionId, input.toolId, input.projectId, input.profileId]);

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      <div ref={hostRef} className="h-full min-h-0 flex-1" aria-label={props.label} />
      {error ? (
        <div
          role="alert"
          className="absolute inset-0 flex items-center justify-center bg-background p-6 text-sm"
        >
          <div>
            <p>Could not open {props.label}.</p>
            <p className="mt-2 text-muted-foreground">{error}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
