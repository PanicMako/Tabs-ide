import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderDesktopIcon } from "./desktop-icon";

const square = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#1529e9"/></svg>',
);
describe("desktop icon presentation", () => {
  it("keeps a transparent perimeter around an opaque master on every desktop platform", async () => {
    for (const platform of ["mac", "win", "linux"] as const) {
      for (const size of [16, 32, 256, 1024]) {
        const icon = await renderDesktopIcon(square, size, platform);
        const { data, info } = await sharp(icon)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        expect(info.width).toBe(size);
        expect(info.height).toBe(size);
        for (let i = 0; i < size; i++) {
          expect(data[i * 4 + 3]).toBe(0);
          expect(data[((size - 1) * size + i) * 4 + 3]).toBe(0);
          expect(data[i * size * 4 + 3]).toBe(0);
          expect(data[(i * size + size - 1) * 4 + 3]).toBe(0);
        }
        const center = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
        expect([...data.subarray(center, center + 4)]).toEqual([21, 41, 233, 255]);
      }
    }
  });
  it("normalizes macOS plates independently from Windows and Linux", async () => {
    const visible = async (platform: "mac" | "win" | "linux") => {
      const { data } = await sharp(await renderDesktopIcon(square, 1024, platform))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let count = 0;
      for (let x = 0; x < 1024; x++) if (data[(512 * 1024 + x) * 4 + 3]! >= 128) count++;
      return count;
    };
    expect(await visible("mac")).toBe(824);
    expect(await visible("win")).toBe(896);
    expect(await visible("linux")).toBe(896);
  });
});
