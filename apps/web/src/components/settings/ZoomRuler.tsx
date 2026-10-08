import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { MinusIcon, PlusIcon } from "lucide-react";
import { ZOOM_SNAP_POINTS, snapZoomFactor } from "../../state/zoom";
import "./ZoomRuler.css";

const clamp = (next: number) => Math.max(0, Math.min(ZOOM_SNAP_POINTS.length - 1, next));

export function ZoomRuler({
  value,
  onValueChange,
}: {
  value: number;
  onValueChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const currentIndex = ZOOM_SNAP_POINTS.indexOf(
    snapZoomFactor(value) as (typeof ZOOM_SNAP_POINTS)[number],
  );
  const index = draft ?? currentIndex;
  const drag = useRef<{
    id: number;
    x: number;
    center: number;
    step: number;
    index: number;
    next: number;
  } | null>(null);
  const select = (next: number) => onValueChange(ZOOM_SNAP_POINTS[clamp(next)]!);
  const cancelDrag = () => {
    drag.current = null;
    setDraft(null);
  };
  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    const next =
      Math.abs(event.clientX - gesture.x) < 3
        ? clamp(gesture.index + Math.round((event.clientX - gesture.center) / gesture.step))
        : gesture.next;
    cancelDrag();
    event.currentTarget.releasePointerCapture(event.pointerId);
    // Apply application zoom once on release so resizing cannot move the drag target.
    select(next);
  };
  return (
    <div className="zoom-ruler-control" style={{ "--zoom-index": index } as CSSProperties}>
      <div className="zoom-ruler-heading">
        <span>Scale</span>
        <button
          type="button"
          className="zoom-ruler-value"
          aria-label="Reset zoom to 100%"
          title="Reset to 100%"
          onClick={() => select(ZOOM_SNAP_POINTS.indexOf(1))}
        >
          {Math.round(ZOOM_SNAP_POINTS[index]! * 100)}%
        </button>
      </div>
      <div className="zoom-ruler-row">
        <button
          type="button"
          className="zoom-ruler-step"
          aria-label="Zoom out"
          disabled={index === 0}
          onClick={() => select(index - 1)}
        >
          <MinusIcon size={15} aria-hidden="true" />
        </button>
        <div className="zoom-ruler-window">
          <div className="zoom-ruler-needle" aria-hidden="true" />
          <div className="zoom-ruler-tape">
            <div className="zoom-ruler-minor" aria-hidden="true" />
            {ZOOM_SNAP_POINTS.map((point, position) => (
              <button
                type="button"
                key={point}
                tabIndex={-1}
                aria-label={`Zoom to ${Math.round(point * 100)}%`}
                aria-pressed={index === position}
                className="zoom-ruler-mark"
                style={{ left: `calc(${position} * var(--zoom-step))` }}
                onClick={() => select(position)}
              >
                <span>{Math.round(point * 100)}%</span>
              </button>
            ))}
          </div>
          <div
            role="slider"
            tabIndex={0}
            aria-label="Interface zoom"
            aria-valuemin={75}
            aria-valuemax={150}
            aria-valuenow={Math.round(ZOOM_SNAP_POINTS[index]! * 100)}
            aria-valuetext={`${Math.round(ZOOM_SNAP_POINTS[index]! * 100)} percent`}
            aria-orientation="horizontal"
            className="zoom-ruler-drag"
            data-dragging={draft !== null ? "" : undefined}
            onKeyDown={(event) => {
              const delta = ["ArrowRight", "ArrowUp", "+", "="].includes(event.key)
                ? 1
                : ["ArrowLeft", "ArrowDown", "-"].includes(event.key)
                  ? -1
                  : 0;
              if (!delta && event.key !== "Home" && event.key !== "End") return;
              event.preventDefault();
              event.stopPropagation();
              select(
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? ZOOM_SNAP_POINTS.length - 1
                    : index + delta,
              );
            }}
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
              const rect = event.currentTarget.getBoundingClientRect();
              const step =
                (parseFloat(
                  getComputedStyle(event.currentTarget.parentElement!).getPropertyValue(
                    "--zoom-step",
                  ),
                ) *
                  rect.width) /
                event.currentTarget.offsetWidth;
              drag.current = {
                id: event.pointerId,
                x: event.clientX,
                center: rect.left + rect.width / 2,
                step,
                index: currentIndex,
                next: currentIndex,
              };
              setDraft(currentIndex);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const gesture = drag.current;
              if (!gesture || gesture.id !== event.pointerId) return;
              gesture.next = clamp(
                gesture.index - Math.round((event.clientX - gesture.x) / gesture.step),
              );
              setDraft(gesture.next);
            }}
            onPointerUp={finishDrag}
            onPointerCancel={cancelDrag}
            onLostPointerCapture={cancelDrag}
          />
        </div>
        <button
          type="button"
          className="zoom-ruler-step"
          aria-label="Zoom in"
          disabled={index === ZOOM_SNAP_POINTS.length - 1}
          onClick={() => select(index + 1)}
        >
          <PlusIcon size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
