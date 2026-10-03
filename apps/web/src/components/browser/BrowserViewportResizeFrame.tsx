import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "../../lib/utils";

export type BrowserViewportResizeDirection = "west" | "east" | "south" | "southwest" | "southeast";
export interface BrowserViewportSize {
  width: number;
  height: number;
}

export function resizeBrowserViewport(
  start: BrowserViewportSize,
  direction: BrowserViewportResizeDirection,
  deltaX: number,
  deltaY: number,
): BrowserViewportSize {
  const horizontal = direction.includes("east")
    ? deltaX * 2
    : direction.includes("west")
      ? -deltaX * 2
      : 0;
  const vertical = direction.includes("south") ? deltaY * 2 : 0;
  return {
    width: Math.min(3840, Math.max(240, Math.round(start.width + horizontal))),
    height: Math.min(3840, Math.max(180, Math.round(start.height + vertical))),
  };
}

interface ResizeHandleProps {
  direction: BrowserViewportResizeDirection;
  label: string;
  className: string;
  active: boolean;
  onPointerDown: (
    direction: BrowserViewportResizeDirection,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onKeyDown: (
    direction: BrowserViewportResizeDirection,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => void;
}

function ResizeHandle(props: ResizeHandleProps) {
  return (
    <button
      type="button"
      aria-label={`${props.label}. Use arrow keys to resize.`}
      className={cn(
        "group absolute z-30 touch-none border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        props.className,
      )}
      onPointerDown={(event) => props.onPointerDown(props.direction, event)}
      onKeyDown={(event) => props.onKeyDown(props.direction, event)}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 m-auto rounded-full bg-muted-foreground/35 transition-colors group-hover:bg-foreground/75 group-focus-visible:bg-foreground",
          props.direction === "west" || props.direction === "east"
            ? "h-7 w-0.5"
            : props.direction === "south"
              ? "h-0.5 w-7"
              : "size-2",
          props.active && "bg-foreground",
        )}
      />
    </button>
  );
}

export function BrowserViewportResizeFrame(props: {
  width: number | null;
  height: number | null;
  onCommit: (size: BrowserViewportSize) => void;
  children: ReactNode;
}) {
  const [draft, setDraft] = useState<BrowserViewportSize | null>(null);
  const [activeDirection, setActiveDirection] = useState<BrowserViewportResizeDirection | null>(
    null,
  );
  const latestRef = useRef<BrowserViewportSize | null>(null);
  const displayed =
    draft ?? (props.width && props.height ? { width: props.width, height: props.height } : null);

  useEffect(() => {
    setDraft(null);
    latestRef.current = null;
  }, [props.width, props.height]);

  const handlePointerDown = (
    direction: BrowserViewportResizeDirection,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (!displayed) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const start = displayed;
    const target = event.currentTarget;
    setActiveDirection(direction);
    latestRef.current = start;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      /* Window listeners are the fallback. */
    }
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const next = resizeBrowserViewport(
        start,
        direction,
        moveEvent.clientX - startX,
        moveEvent.clientY - startY,
      );
      latestRef.current = next;
      setDraft(next);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      setActiveDirection(null);
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        /* Capture may already be released. */
      }
    };
    const finish = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      const next = latestRef.current;
      cleanup();
      if (next && (next.width !== start.width || next.height !== start.height))
        props.onCommit(next);
      else setDraft(null);
    };
    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanup();
      setDraft(null);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  const handleKeyDown = (
    direction: BrowserViewportResizeDirection,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (!displayed) return;
    const step = event.shiftKey ? 25 : 5;
    const deltaX = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const deltaY = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    const controlsWidth = direction !== "south";
    const controlsHeight = direction.includes("south");
    if ((!controlsWidth || deltaX === 0) && (!controlsHeight || deltaY === 0)) return;
    event.preventDefault();
    event.stopPropagation();
    const next = resizeBrowserViewport(
      displayed,
      direction,
      controlsWidth ? deltaX : 0,
      controlsHeight ? deltaY : 0,
    );
    setDraft(next);
    props.onCommit(next);
  };

  // When no device preset with fixed dimensions is selected (the default "Project"
  // preset where width/height are null), render a full-bleed transparent wrapper so
  // the webview extends edge-to-edge without any padding, border, or shadow creating
  // a visible gap around the content (particularly noticeable with dark-themed sites).
  if (!displayed) {
    return <div className="relative h-full min-h-0 w-full overflow-hidden">{props.children}</div>;
  }

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-hidden p-2.5">
      <div
        className="relative shrink-0"
        style={{
          width: `min(${displayed.width}px, 100%)`,
          height: `min(${displayed.height}px, 100%)`,
        }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-xl border border-border/70 bg-background shadow-lg">
          {props.children}
        </div>
        <>
          <ResizeHandle
            direction="west"
            label="Resize browser viewport from left edge"
            className="-left-2.5 top-0 h-full w-2.5 cursor-ew-resize"
            active={activeDirection === "west"}
            onPointerDown={handlePointerDown}
            onKeyDown={handleKeyDown}
          />
          <ResizeHandle
            direction="east"
            label="Resize browser viewport from right edge"
            className="-right-2.5 top-0 h-full w-2.5 cursor-ew-resize"
            active={activeDirection === "east"}
            onPointerDown={handlePointerDown}
            onKeyDown={handleKeyDown}
          />
          <ResizeHandle
            direction="south"
            label="Resize browser viewport from bottom edge"
            className="-bottom-2.5 left-0 h-2.5 w-full cursor-ns-resize"
            active={activeDirection === "south"}
            onPointerDown={handlePointerDown}
            onKeyDown={handleKeyDown}
          />
          <ResizeHandle
            direction="southwest"
            label="Resize browser viewport from bottom-left corner"
            className="-bottom-2.5 -left-2.5 size-2.5 cursor-nesw-resize"
            active={activeDirection === "southwest"}
            onPointerDown={handlePointerDown}
            onKeyDown={handleKeyDown}
          />
          <ResizeHandle
            direction="southeast"
            label="Resize browser viewport from bottom-right corner"
            className="-bottom-2.5 -right-2.5 size-2.5 cursor-nwse-resize"
            active={activeDirection === "southeast"}
            onPointerDown={handlePointerDown}
            onKeyDown={handleKeyDown}
          />
        </>
      </div>
    </div>
  );
}
