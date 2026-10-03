import type {
  PreviewAnnotationPayload,
  PreviewAnnotationPoint,
  PreviewAnnotationRect,
} from "@tabs/contracts";

export function previewAnnotationBoundsForPoints(
  points: ReadonlyArray<PreviewAnnotationPoint>,
): PreviewAnnotationRect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, Math.max(...xs) - minX),
    height: Math.max(1, Math.max(...ys) - minY),
  };
}

export function normalizePreviewAnnotationRect(
  start: PreviewAnnotationPoint,
  end: PreviewAnnotationPoint,
): PreviewAnnotationRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function previewAnnotationPreviousStyleValue(
  annotation: PreviewAnnotationPayload,
  property: string,
): string {
  const styles = annotation.elements[0]?.element.styles ?? "";
  const normalized = property.trim().toLowerCase();
  for (const declaration of styles.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    if (declaration.slice(0, separator).trim().toLowerCase() === normalized) {
      return declaration.slice(separator + 1).trim();
    }
  }
  return "";
}
