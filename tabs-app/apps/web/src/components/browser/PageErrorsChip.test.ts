import { describe, expect, it } from "vitest";
import { pageErrorAnnotation } from "./PageErrorsChip";

describe("page errors handed to the agent", () => {
  it("carries the latest error, its source and the page", () => {
    const annotation = pageErrorAnnotation({
      errors: {
        count: 3,
        latest: {
          text: "TypeError: cannot read 'map' of undefined",
          source: "http://localhost:5173/src/App.tsx:42",
          at: "2026-11-12T11:00:00Z",
        },
      },
      pageUrl: "http://localhost:5173/",
      pageTitle: "Shop",
    });
    expect(annotation.pageUrl).toBe("http://localhost:5173/");
    expect(annotation.comment).toContain("(3 so far; latest shown)");
    expect(annotation.comment).toContain("TypeError: cannot read 'map' of undefined");
    expect(annotation.comment).toContain("Source: http://localhost:5173/src/App.tsx:42");
    expect(annotation.elements).toEqual([]);
    expect(annotation.screenshot).toBeNull();
  });
});
