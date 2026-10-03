import type { PreviewAnnotationPayload } from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import { appendPreviewAnnotationPrompt } from "./previewAnnotation";

const annotation: PreviewAnnotationPayload = {
  id: "annotation-1",
  pageUrl: "http://localhost:5173/settings",
  pageTitle: "Settings",
  comment: "Make this clearer",
  elements: [],
  regions: [{ id: "region-1", rect: { x: 4, y: 8, width: 120, height: 40 } }],
  strokes: [],
  styleChanges: [
    {
      targetId: "target-1",
      selector: "#save",
      property: "color",
      previousValue: "gray",
      value: "black",
    },
  ],
  screenshot: {
    dataUrl: "data:image/png;base64,AA==",
    width: 120,
    height: 40,
    cropRect: { x: 4, y: 8, width: 120, height: 40 },
  },
  createdAt: "2026-09-04T12:00:00.000Z",
};

describe("appendPreviewAnnotationPrompt", () => {
  it("encodes real page context and requested visual changes", () => {
    const result = appendPreviewAnnotationPrompt("Update the form", annotation);

    expect(result).toContain("Update the form\n\n<preview_annotation>");
    expect(result).toContain("Page: Settings");
    expect(result).toContain("Comment: Make this clearer");
    expect(result).toContain("Style change: color: gray -> black");
    expect(result).toContain("Marked regions: 1");
    expect(result).toContain("attached image");
  });
});
