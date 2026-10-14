import { expect, it } from "vitest";
import { parseMediaRange } from "./WorkspaceAssetRoute";
it("handles bounded, open and suffix ranges for video and PDF requests", () => {
  expect(parseMediaRange(undefined, 100)).toEqual({ start: 0, end: 99 });
  expect(parseMediaRange("bytes=10-20", 100)).toEqual({ start: 10, end: 20 });
  expect(parseMediaRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
  expect(parseMediaRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  expect(parseMediaRange("bytes=0-200", 100)).toEqual({ start: 0, end: 99 });
  for (const range of ["bytes=100-", "bytes=20-10", "bytes=-0", "bytes=0-1,5-6", "invalid"])
    expect(parseMediaRange(range, 100)).toBeNull();
  expect(parseMediaRange(undefined, 0)).toBeNull();
});
