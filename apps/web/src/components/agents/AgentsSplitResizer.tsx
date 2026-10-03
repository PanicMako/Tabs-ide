import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import {
  clampSplitRatioForWidth,
  DEFAULT_SPLIT_RATIO,
  getResponsiveSplitRatioBounds,
} from "../../state/agentsLayout";

export interface AgentsSplitResizerProps {
  containerRef: React.RefObject<HTMLElement | null>;
  splitRatio: number;
  onSplitRatioChange: (ratio: number) => void;
  className?: string;
  disabled?: boolean;
}

export function AgentsSplitResizer({
  containerRef,
  splitRatio,
  onSplitRatioChange,
  className,
  disabled = false,
}: AgentsSplitResizerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  const applyPointerPosition = useCallback(
    (clientX: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      onSplitRatioChange(clampSplitRatioForWidth((clientX - rect.left) / rect.width, rect.width));
    },
    [containerRef, onSplitRatioChange],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      event.currentTarget.setPointerCapture(event.pointerId);

      isDraggingRef.current = true;
      setIsDragging(true);
    },
    [disabled],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      applyPointerPosition(event.clientX);
    },
    [applyPointerPosition],
  );

  const stopDragging = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (disabled) return;
    const width = containerRef.current?.getBoundingClientRect().width ?? 0;
    onSplitRatioChange(clampSplitRatioForWidth(DEFAULT_SPLIT_RATIO, width));
  }, [containerRef, disabled, onSplitRatioChange]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;

      const STEP = 0.05;
      const width = containerRef.current?.getBoundingClientRect().width ?? 0;
      const bounds = getResponsiveSplitRatioBounds(width);
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onSplitRatioChange(clampSplitRatioForWidth(splitRatio - STEP, width));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onSplitRatioChange(clampSplitRatioForWidth(splitRatio + STEP, width));
      } else if (event.key === "Home") {
        event.preventDefault();
        onSplitRatioChange(bounds.min);
      } else if (event.key === "End") {
        event.preventDefault();
        onSplitRatioChange(bounds.max);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSplitRatioChange(clampSplitRatioForWidth(DEFAULT_SPLIT_RATIO, width));
      }
    },
    [containerRef, disabled, onSplitRatioChange, splitRatio],
  );

  // Set document body styling while dragging to guarantee text is not selected
  useEffect(() => {
    if (!isDragging) return;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [isDragging]);

  const percentValue = Math.round(splitRatio * 100);
  const workspaceWidth = containerRef.current?.getBoundingClientRect().width ?? 0;
  const ratioBounds = getResponsiveSplitRatioBounds(workspaceWidth);

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={percentValue}
        aria-valuemin={Math.round(ratioBounds.min * 100)}
        aria-valuemax={Math.round(ratioBounds.max * 100)}
        aria-label="Split pane resize divider. Use Left and Right arrow keys to adjust ratio, Space or Enter to reset to 50 percent."
        tabIndex={disabled ? -1 : 0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "group relative z-30 flex w-2 flex-none cursor-col-resize items-center justify-center select-none transition-colors",
          "hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isDragging && "bg-accent text-foreground",
          className,
        )}
      >
        {/* Subtle center hairline */}
        <div
          className={cn(
            "h-full w-px bg-border/80 transition-colors duration-150",
            "group-hover:bg-primary/70 group-focus-visible:bg-primary",
            isDragging && "bg-primary w-0.5",
          )}
        />
        {/* Centered grip pill */}
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 h-8 w-1 rounded-full bg-muted-foreground/30 transition-all duration-150",
            "group-hover:bg-primary group-hover:scale-y-110",
            isDragging && "bg-primary scale-y-125 w-1.5",
          )}
        />
      </div>

      {/* Transparent full-screen overlay during drag to capture all pointers cleanly without iframe/scrolling traps */}
      {isDragging && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[9999] cursor-col-resize select-none"
          style={{ cursor: "col-resize" }}
        />
      )}
    </>
  );
}
