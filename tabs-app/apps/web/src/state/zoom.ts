import { useEffect, useState } from "react";

const ZOOM_STORAGE_KEY = "tabs-zoom-factor";
const DEFAULT_ZOOM = 1.0;
export const MIN_ZOOM = 0.75;
export const MAX_ZOOM = 1.5;
export const ZOOM_SNAP_POINTS = [0.75, 0.9, 1.0, 1.1, 1.25, 1.5] as const;

let memoryZoomStorage: string | null = null;

export function snapZoomFactor(factor: number): number {
  let closest: (typeof ZOOM_SNAP_POINTS)[number] = ZOOM_SNAP_POINTS[0];
  let minDiff = Math.abs(factor - closest);
  for (const point of ZOOM_SNAP_POINTS) {
    const diff = Math.abs(factor - point);
    if (diff < minDiff) {
      minDiff = diff;
      closest = point;
    }
  }
  return closest;
}

export function getZoomFactor(): number {
  const stored =
    typeof localStorage !== "undefined"
      ? localStorage.getItem(ZOOM_STORAGE_KEY)
      : memoryZoomStorage;
  if (!stored) return DEFAULT_ZOOM;
  const parsed = parseFloat(stored);
  if (isNaN(parsed)) return DEFAULT_ZOOM;
  return snapZoomFactor(parsed);
}

export function applyZoomFactor(factor: number): number {
  const clamped = snapZoomFactor(factor);
  if (typeof window !== "undefined" && window.desktopBridge?.setZoomFactor) {
    void window.desktopBridge.setZoomFactor(clamped).catch(() => undefined);
    if (document.documentElement) {
      (document.documentElement.style as unknown as { zoom: string }).zoom = "";
      document.documentElement.style.width = "";
      document.documentElement.style.height = "";
      document.documentElement.style.minHeight = "";
    }
  } else if (typeof document !== "undefined" && document.documentElement) {
    const el = document.documentElement;
    (el.style as unknown as { zoom: string }).zoom = String(clamped);
    el.style.width = "";
    el.style.height = "";
    el.style.minHeight = "";
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(clamped));
  } else {
    memoryZoomStorage = String(clamped);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("tabs-zoom-change", { detail: { zoomFactor: clamped } }));
  }
  return clamped;
}

export function zoomIn(): number {
  const current = getZoomFactor();
  const index = ZOOM_SNAP_POINTS.findIndex((p) => p >= current);
  const nextIndex =
    index < 0 ? ZOOM_SNAP_POINTS.length - 1 : Math.min(ZOOM_SNAP_POINTS.length - 1, index + 1);
  return applyZoomFactor(ZOOM_SNAP_POINTS[nextIndex] ?? DEFAULT_ZOOM);
}

export function zoomOut(): number {
  const current = getZoomFactor();
  const index = ZOOM_SNAP_POINTS.findIndex((p) => p >= current);
  const nextIndex = index <= 0 ? 0 : index - 1;
  return applyZoomFactor(ZOOM_SNAP_POINTS[nextIndex] ?? DEFAULT_ZOOM);
}

export function resetZoom(): number {
  return applyZoomFactor(DEFAULT_ZOOM);
}

export function initializeZoom(): void {
  const current = getZoomFactor();
  applyZoomFactor(current);
}

export function useZoomFactor(): [number, (factor: number) => void] {
  const [zoomFactor, setZoomState] = useState<number>(() => getZoomFactor());

  useEffect(() => {
    const current = getZoomFactor();
    setZoomState(current);
    applyZoomFactor(current);

    const handleZoomChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ zoomFactor?: number }>;
      if (customEvent.detail && typeof customEvent.detail.zoomFactor === "number") {
        setZoomState(customEvent.detail.zoomFactor);
      } else {
        setZoomState(getZoomFactor());
      }
    };

    window.addEventListener("tabs-zoom-change", handleZoomChange);
    return () => {
      window.removeEventListener("tabs-zoom-change", handleZoomChange);
    };
  }, []);

  const updateZoom = (factor: number) => {
    const next = applyZoomFactor(factor);
    setZoomState(next);
  };

  return [zoomFactor, updateZoom];
}
