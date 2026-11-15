/**
 * Draws the wallpaper as ASCII, dither, braille and other prints. The still print is drawn once per
 * size; with `animate`, the same grid is redrawn at a low frame rate while a wave of density flows
 * down through it, so the characters and dots visibly shift.
 */

import { useEffect, useRef, useState } from "react";
import {
  type LuminanceGrid,
  type WallpaperPrintStrength,
  type WallpaperPrintStyle,
  drawWallpaperPrint,
  luminanceFromRgba,
  normalizeLuminance,
  printLayout,
} from "./onboarding/wallpaperPrint";

const MAX_DEVICE_PIXEL_RATIO = 2;
const RESIZE_DEBOUNCE_MS = 140;
/** Redraws per second while animating; the whole print is redrawn, so this stays modest. */
const ANIMATION_FPS = 12;
/** The print fades out toward the bottom, so those rows are not worth animating. */
const ANIMATED_ROW_FRACTION = 0.9;

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(url: string): Promise<HTMLImageElement | null> {
  let pending = imageCache.get(url);
  if (!pending) {
    pending = new Promise((resolve) => {
      const image = new Image();
      // Same-origin and data: wallpapers can be read back; other hosts fail below and fall back.
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
    imageCache.set(url, pending);
  }
  return pending;
}

/** Samples a cover-fitted copy of the artwork at the requested grid size. */
function sampleArtwork(image: HTMLImageElement, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  try {
    const pixels = context.getImageData(0, 0, width, height);
    return normalizeLuminance(luminanceFromRgba(pixels.data, width, height));
  } catch {
    // A cross-origin image taints the canvas; the caller shows the still halftone instead.
    return null;
  }
}

export interface WallpaperPrintLayerProps {
  readonly url: string;
  readonly style: Exclude<WallpaperPrintStyle, "halftone" | "none">;
  readonly strength: WallpaperPrintStrength;
  readonly ink: "light" | "dark";
  readonly className?: string;
  /** Flows a wave of density down the print so its characters and dots move. */
  readonly animate?: boolean;
  /** Called when the artwork cannot be read so the parent can show a fallback texture. */
  readonly onUnavailable?: () => void;
}

export function WallpaperPrintLayer({
  url,
  style,
  strength,
  ink,
  className,
  animate = false,
  onUnavailable,
}: WallpaperPrintLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [drawn, setDrawn] = useState<{
    grid: LuminanceGrid;
    cols: number;
    rows: number;
    size: { width: number; height: number };
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!parent) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      const rect = parent.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width < 8 || height < 8) return;
      setSize((previous) =>
        previous && previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(parent);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  // The still print: sampled and drawn once per url, style, strength, ink and size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    let cancelled = false;
    void loadImage(url).then((image) => {
      if (cancelled) return;
      const context = canvas.getContext("2d");
      if (!image || !context) {
        unavailableRef.current?.();
        return;
      }
      const layout = printLayout(style);
      const cols = Math.ceil(size.width / layout.cellWidth);
      const rows = Math.ceil(size.height / layout.cellHeight);
      const grid = sampleArtwork(image, cols * layout.samplesX, rows * layout.samplesY);
      if (!grid) {
        unavailableRef.current?.();
        return;
      }
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
      canvas.width = Math.round(size.width * ratio);
      canvas.height = Math.round(size.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, size.width, size.height);
      drawWallpaperPrint(context, { style, strength, ink, grid, cols, rows });
      setDrawn({ grid, cols, rows, size });
    });
    return () => {
      cancelled = true;
    };
  }, [url, style, strength, ink, size]);

  // The moving print: the same grid redrawn with a flowing wave until animation stops.
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !drawn || !animate) return;
    const { grid, cols, rows, size: drawnSize } = drawn;
    const animatedRows = Math.ceil(rows * ANIMATED_ROW_FRACTION);
    const frameMs = 1000 / ANIMATION_FPS;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (document.hidden || now - last < frameMs) return;
      last = now;
      context.clearRect(0, 0, drawnSize.width, drawnSize.height);
      drawWallpaperPrint(context, {
        style,
        strength,
        ink,
        grid,
        cols,
        rows,
        rowTo: animatedRows,
        phase: now / 1000,
      });
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      // Back to the still print when animation stops or the settings change.
      context.clearRect(0, 0, drawnSize.width, drawnSize.height);
      drawWallpaperPrint(context, { style, strength, ink, grid, cols, rows });
    };
  }, [animate, drawn, style, strength, ink]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-wallpaper-print={style}
      data-animated={animate ? "true" : "false"}
      className={className}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
