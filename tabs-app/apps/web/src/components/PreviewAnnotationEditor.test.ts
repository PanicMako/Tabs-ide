import type { PreviewAnnotationPayload } from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import {
  normalizePreviewAnnotationRect,
  previewAnnotationBoundsForPoints,
  previewAnnotationPreviousStyleValue,
} from "./PreviewAnnotationEditor.logic";

const annotation: PreviewAnnotationPayload = {
  id: "annotation-1",
  pageUrl: "http://localhost:5173",
  pageTitle: "Preview",
  comment: "",
  elements: [
    {
      id: "element-1",
      rect: { x: 10, y: 20, width: 100, height: 30 },
      element: {
        pageUrl: "http://localhost:5173",
        pageTitle: "Preview",
        tagName: "button",
        selector: "#save",
        htmlPreview: '<button id="save">Save</button>',
        componentName: null,
        source: null,
        stack: [],
        styles: "color: rgb(10, 20, 30); background-color: white;",
        pickedAt: "2026-09-04T12:00:00.000Z",
      },
    },
  ],
  regions: [],
  strokes: [],
  styleChanges: [],
  screenshot: null,
  createdAt: "2026-09-04T12:00:00.000Z",
};

describe("PreviewAnnotationEditor geometry", () => {
  it("normalizes reverse-direction region drags", () => {
    expect(normalizePreviewAnnotationRect({ x: 90, y: 60 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 80,
      height: 40,
    });
  });

  it("derives a non-zero stroke bounding box", () => {
    expect(
      previewAnnotationBoundsForPoints([
        { x: 5, y: 8 },
        { x: 18, y: 3 },
        { x: 9, y: 20 },
      ]),
    ).toEqual({ x: 5, y: 3, width: 13, height: 17 });
  });

  it("reads actual computed styles without substring matches", () => {
    expect(previewAnnotationPreviousStyleValue(annotation, "color")).toBe("rgb(10, 20, 30)");
    expect(previewAnnotationPreviousStyleValue(annotation, "background")).toBe("");
  });
});
