import { it, expect } from "vite-plus/test";
import { readImageDimensions } from "./imageDimensions.ts";
it("rejects an invalid GIF version header", () => {
  const bytes = new Uint8Array([71, 73, 70, 56, 120, 120, 20, 0, 10, 0]);
  expect(readImageDimensions(bytes)).toBeNull();
});
it("rejects a PNG with an invalid signature tail", () => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 0, 0, 0, 0], 0);
  bytes.set([73, 72, 68, 82], 12);
  bytes[19] = 20;
  bytes[23] = 10;
  expect(readImageDimensions(bytes)).toBeNull();
});
