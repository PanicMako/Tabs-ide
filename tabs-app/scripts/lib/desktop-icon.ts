import { dirname, join } from "node:path";
import sharp from "sharp";

/** Finder's install icon is baked into the app; runtime icon preferences are separate. */
export function desktopInstallerIconSource(signatureSource: string, platform: DesktopIconPlatform) {
  return platform === "mac"
    ? join(dirname(signatureSource), "tabs-afterglow.svg")
    : signatureSource;
}

export type DesktopIconPlatform = "mac" | "win" | "linux";

// Legacy Electron PNG/ICNS icons are composited directly, without Icon Composer's
// automatic presentation. Keep the plate inside the canvas rather than edge to edge.
const PLATE_SIZE = { mac: 824, win: 896, linux: 896 } as const;

export async function renderDesktopIcon(
  source: string | Buffer,
  size: number,
  platform: DesktopIconPlatform,
): Promise<Buffer> {
  const plate = Math.max(1, Math.round((size * PLATE_SIZE[platform]) / 1024));
  const before = Math.floor((size - plate) / 2);
  const after = size - plate - before;
  return sharp(source)
    .resize(plate, plate, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: before,
      bottom: after,
      left: before,
      right: after,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}
