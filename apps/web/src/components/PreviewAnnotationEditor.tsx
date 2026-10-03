import {
  type PreviewAnnotationPayload,
  type PreviewAnnotationPoint,
  type PreviewAnnotationStrokeTarget,
} from "@tabs/contracts";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { EraserIcon, MousePointer2Icon, PencilIcon, SquareDashedIcon } from "lucide-react";

import { randomUUID } from "~/lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  normalizePreviewAnnotationRect,
  previewAnnotationBoundsForPoints,
  previewAnnotationPreviousStyleValue,
} from "./PreviewAnnotationEditor.logic";

type EditorTool = "region" | "ink";

export function PreviewAnnotationEditor(props: {
  annotation: PreviewAnnotationPayload | null;
  onCancel: () => void;
  onAttach: (annotation: PreviewAnnotationPayload) => void;
}) {
  const annotation = props.annotation;
  const [comment, setComment] = useState(annotation?.comment ?? "");
  const [tool, setTool] = useState<EditorTool>("region");
  const [regions, setRegions] = useState(annotation?.regions ?? []);
  const [strokes, setStrokes] = useState(annotation?.strokes ?? []);
  const [styleChanges, setStyleChanges] = useState(annotation?.styleChanges ?? []);
  const [property, setProperty] = useState("");
  const [value, setValue] = useState("");
  const [activePoints, setActivePoints] = useState<PreviewAnnotationPoint[]>([]);
  const [keyboardCursor, setKeyboardCursor] = useState<PreviewAnnotationPoint>({ x: 24, y: 24 });
  const [keyboardDrawing, setKeyboardDrawing] = useState(false);
  const dragStartRef = useRef<PreviewAnnotationPoint | null>(null);
  const screenshot = annotation?.screenshot ?? null;
  const width = screenshot?.width ?? 1;
  const height = screenshot?.height ?? 1;

  const target = annotation?.elements[0] ?? null;
  const pageLabel = annotation?.pageTitle || annotation?.pageUrl || "Preview";
  const selectedSummary = useMemo(
    () => target?.element.selector || target?.element.tagName || "selected element",
    [target],
  );

  if (!annotation) return null;

  const pointFromPointer = (event: ReactPointerEvent<SVGSVGElement>): PreviewAnnotationPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(width, ((event.clientX - rect.left) / rect.width) * width)),
      y: Math.max(0, Math.min(height, ((event.clientY - rect.top) / rect.height) * height)),
    };
  };

  const finishStroke = (points: PreviewAnnotationPoint[]) => {
    if (points.length < 2) return;
    const stroke: PreviewAnnotationStrokeTarget = {
      id: `stroke-${randomUUID()}`,
      color: "#ef4444",
      width: 3,
      points,
      bounds: previewAnnotationBoundsForPoints(points),
    };
    setStrokes((current) => [...current, stroke]);
  };

  const addStyleChange = () => {
    const nextProperty = property.trim().toLowerCase();
    const nextValue = value.trim();
    if (!target || !nextProperty || !nextValue) return;
    setStyleChanges((current) => [
      ...current.filter((change) => change.property.toLowerCase() !== nextProperty),
      {
        targetId: target.id,
        selector: target.element.selector,
        property: nextProperty,
        previousValue: previewAnnotationPreviousStyleValue(annotation, nextProperty),
        value: nextValue,
      },
    ]);
    setProperty("");
    setValue("");
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onCancel()}>
      <DialogPopup className="max-h-[92vh] w-[min(94vw,72rem)] max-w-none overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Annotate browser preview</DialogTitle>
          <DialogDescription>
            Mark the real captured page and describe the requested change before attaching it to
            chat.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid min-h-0 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 text-xs">
                <p className="truncate font-medium">{pageLabel}</p>
                <p className="truncate font-mono text-muted-foreground">{selectedSummary}</p>
              </div>
              <div className="flex items-center gap-2" aria-label="Annotation tool">
                <div className="tabs-segmented flex" role="group" aria-label="Annotation tool">
                  <Button
                    type="button"
                    size="sm"
                    variant={tool === "region" ? "secondary" : "outline"}
                    onClick={() => setTool("region")}
                    aria-pressed={tool === "region"}
                  >
                    <SquareDashedIcon /> Region
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={tool === "ink" ? "secondary" : "outline"}
                    onClick={() => setTool("ink")}
                    aria-pressed={tool === "ink"}
                  >
                    <PencilIcon /> Draw
                  </Button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRegions([]);
                    setStrokes([]);
                  }}
                  disabled={regions.length === 0 && strokes.length === 0}
                >
                  <EraserIcon /> Clear marks
                </Button>
              </div>
            </div>
            <div className="relative overflow-hidden rounded-lg border border-border bg-muted/30">
              {screenshot ? (
                <svg
                  viewBox={`0 0 ${width} ${height}`}
                  className="block max-h-[62vh] w-full touch-none select-none"
                  role="application"
                  tabIndex={0}
                  aria-label="Preview annotation surface. Use pointer drag, or arrow keys to move the keyboard cursor. Press Enter to add a region, or Space to start and finish an ink stroke."
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    const point = pointFromPointer(event);
                    dragStartRef.current = point;
                    setActivePoints([point]);
                  }}
                  onPointerMove={(event) => {
                    if (
                      !dragStartRef.current ||
                      !event.currentTarget.hasPointerCapture(event.pointerId)
                    )
                      return;
                    const point = pointFromPointer(event);
                    setActivePoints((current) =>
                      tool === "ink" ? [...current, point] : [current[0]!, point],
                    );
                  }}
                  onPointerUp={(event) => {
                    if (!dragStartRef.current) return;
                    const end = pointFromPointer(event);
                    if (tool === "region") {
                      const rect = normalizePreviewAnnotationRect(dragStartRef.current, end);
                      if (rect.width >= 4 && rect.height >= 4)
                        setRegions((current) => [
                          ...current,
                          { id: `region-${randomUUID()}`, rect },
                        ]);
                    } else finishStroke([...activePoints, end]);
                    dragStartRef.current = null;
                    setActivePoints([]);
                  }}
                  onPointerCancel={() => {
                    dragStartRef.current = null;
                    setActivePoints([]);
                  }}
                  onKeyDown={(event) => {
                    const delta = event.shiftKey ? 10 : 2;
                    const movement =
                      event.key === "ArrowLeft"
                        ? { x: -delta, y: 0 }
                        : event.key === "ArrowRight"
                          ? { x: delta, y: 0 }
                          : event.key === "ArrowUp"
                            ? { x: 0, y: -delta }
                            : event.key === "ArrowDown"
                              ? { x: 0, y: delta }
                              : null;
                    if (movement) {
                      event.preventDefault();
                      const point = {
                        x: Math.max(
                          0,
                          Math.min(Math.max(0, width - 1), keyboardCursor.x + movement.x),
                        ),
                        y: Math.max(
                          0,
                          Math.min(Math.max(0, height - 1), keyboardCursor.y + movement.y),
                        ),
                      };
                      setKeyboardCursor(point);
                      if (keyboardDrawing) setActivePoints((current) => [...current, point]);
                    } else if (event.key === "Enter") {
                      event.preventDefault();
                      setRegions((current) => [
                        ...current,
                        {
                          id: `region-${randomUUID()}`,
                          rect: {
                            x: keyboardCursor.x,
                            y: keyboardCursor.y,
                            width: Math.max(1, Math.min(48, width - keyboardCursor.x)),
                            height: Math.max(1, Math.min(48, height - keyboardCursor.y)),
                          },
                        },
                      ]);
                    } else if (event.key === " ") {
                      event.preventDefault();
                      if (keyboardDrawing) finishStroke(activePoints);
                      else setActivePoints([keyboardCursor]);
                      setKeyboardDrawing((current) => !current);
                      if (keyboardDrawing) setActivePoints([]);
                    } else if (event.key === "Escape" && keyboardDrawing) {
                      event.preventDefault();
                      setKeyboardDrawing(false);
                      setActivePoints([]);
                    }
                  }}
                >
                  <image href={screenshot.dataUrl} width={width} height={height} />
                  {annotation.elements.map((element) => (
                    <rect
                      key={element.id}
                      {...element.rect}
                      fill="rgba(59,130,246,.12)"
                      stroke="#3b82f6"
                      strokeWidth="2"
                    />
                  ))}
                  {regions.map((region) => (
                    <rect
                      key={region.id}
                      {...region.rect}
                      fill="rgba(239,68,68,.12)"
                      stroke="#ef4444"
                      strokeWidth="3"
                      strokeDasharray="8 5"
                    />
                  ))}
                  {strokes.map((stroke) => (
                    <polyline
                      key={stroke.id}
                      points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
                      fill="none"
                      stroke={stroke.color}
                      strokeWidth={stroke.width}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {activePoints.length > 1 && tool === "region" ? (
                    <rect
                      {...normalizePreviewAnnotationRect(activePoints[0]!, activePoints.at(-1)!)}
                      fill="rgba(239,68,68,.1)"
                      stroke="#ef4444"
                      strokeWidth="2"
                      strokeDasharray="8 5"
                    />
                  ) : null}
                  {activePoints.length > 1 && tool === "ink" ? (
                    <polyline
                      points={activePoints.map((point) => `${point.x},${point.y}`).join(" ")}
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  ) : null}
                  <circle
                    cx={keyboardCursor.x}
                    cy={keyboardCursor.y}
                    r="5"
                    fill="#fff"
                    stroke="#111827"
                    strokeWidth="2"
                  />
                </svg>
              ) : (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No screenshot was returned by the browser host.
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Pointer: drag to mark. Keyboard: arrows move the cursor, Enter adds a region, Space
              starts/finishes ink.
            </p>
          </div>
          <div className="space-y-4">
            <label className="block space-y-1.5 text-sm font-medium">
              Comment
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className="min-h-28 w-full rounded-md border border-border bg-background p-2 text-sm font-normal"
                placeholder="Describe what should change…"
              />
            </label>
            <div className="space-y-2">
              <p className="text-sm font-medium">Requested style changes</p>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={property}
                  onChange={(event) => setProperty(event.target.value)}
                  placeholder="CSS property"
                  aria-label="CSS property"
                />
                <Input
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="New value"
                  aria-label="New CSS value"
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!property.trim() || !value.trim() || !target}
                onClick={addStyleChange}
              >
                Add style change
              </Button>
              <ul className="space-y-1" aria-label="Requested style changes">
                {styleChanges.map((change) => (
                  <li
                    key={`${change.targetId}:${change.property}`}
                    className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1.5 text-xs"
                  >
                    <span className="min-w-0 break-all font-mono">
                      {change.property}: {change.value}
                    </span>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      onClick={() =>
                        setStyleChanges((current) => current.filter((entry) => entry !== change))
                      }
                      aria-label={`Remove ${change.property} style change`}
                    >
                      ×
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
            <div
              className="rounded-md border border-border/60 p-3 text-xs text-muted-foreground"
              role="status"
            >
              <MousePointer2Icon className="mr-1 inline size-3.5" aria-hidden="true" />
              {regions.length} region{regions.length === 1 ? "" : "s"}, {strokes.length} drawing
              {strokes.length === 1 ? "" : "s"}, {styleChanges.length} style change
              {styleChanges.length === 1 ? "" : "s"}
            </div>
          </div>
        </DialogPanel>
        <DialogFooter className="border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() =>
              props.onAttach({
                ...annotation,
                comment: comment.trim(),
                regions,
                strokes,
                styleChanges,
              })
            }
          >
            Attach to chat
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
