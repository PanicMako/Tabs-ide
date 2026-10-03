import { describe, expect, it } from "vitest";

import { clipTestingPreviewBounds } from "./testingPreviewBounds";

describe("clipTestingPreviewBounds", () => {
  it("keeps the native preview inside the visible Testing scroll viewport", () => {
    expect(
      clipTestingPreviewBounds({
        host: { left: 400, top: -300, right: 1_200, bottom: 700 },
        viewport: { left: 0, top: 104, right: 1_600, bottom: 1_000 },
        zoom: 1,
      }),
    ).toEqual({ x: 400, y: 104, width: 800, height: 596, visible: true });
  });

  it("hides the native preview after its host scrolls fully out of view", () => {
    expect(
      clipTestingPreviewBounds({
        host: { left: 400, top: -900, right: 1_200, bottom: -100 },
        viewport: { left: 0, top: 104, right: 1_600, bottom: 1_000 },
        zoom: 1.25,
      }),
    ).toEqual({ x: 500, y: 130, width: 1_000, height: 0, visible: false });
  });
});
