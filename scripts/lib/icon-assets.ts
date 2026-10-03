import { Buffer } from "node:buffer";

import { Data, Effect, FileSystem, Path } from "effect";
import sharp from "sharp";

import { BRAND_LOGO_SVG_PATHS, PUBLIC_BRAND_ICON_FILENAMES } from "./brand-assets.ts";

class IconAssetError extends Data.TaggedError("IconAssetError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const ICO_SIZES = [16, 32, 48, 64, 128, 256] as const;
const LEGACY_BROWSER_ICON_FILENAMES = ["icon.svg"] as const;

function createIcoBuffer(
  icons: ReadonlyArray<{ readonly size: number; readonly png: Buffer }>,
): Buffer {
  const entries = [...icons].sort((a, b) => a.size - b.size);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(entries.length * 16);
  const payloads: Buffer[] = [];
  let offset = header.length + directory.length;

  entries.forEach((entry, index) => {
    const directoryOffset = index * 16;
    const dimensionByte = entry.size >= 256 ? 0 : entry.size;
    directory.writeUInt8(dimensionByte, directoryOffset);
    directory.writeUInt8(dimensionByte, directoryOffset + 1);
    directory.writeUInt8(0, directoryOffset + 2);
    directory.writeUInt8(0, directoryOffset + 3);
    directory.writeUInt16LE(1, directoryOffset + 4);
    directory.writeUInt16LE(32, directoryOffset + 6);
    directory.writeUInt32LE(entry.png.length, directoryOffset + 8);
    directory.writeUInt32LE(offset, directoryOffset + 12);
    payloads.push(entry.png);
    offset += entry.png.length;
  });

  return Buffer.concat([header, directory, ...payloads]);
}

async function renderSvgToPngBuffer(svgPath: string, size: number): Promise<Buffer> {
  return sharp(svgPath)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function renderSvgToIcoBuffer(svgPath: string): Promise<Buffer> {
  const icons = await Promise.all(
    ICO_SIZES.map(async (size) => ({ size, png: await renderSvgToPngBuffer(svgPath, size) })),
  );
  return createIcoBuffer(icons);
}

function writeBufferFile(targetPath: string, buffer: Buffer) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFile(targetPath, buffer);
  });
}

export function renderSvgToPngFile(svgPath: string, targetPath: string, size: number) {
  return Effect.gen(function* () {
    const buffer = yield* Effect.tryPromise({
      try: () => renderSvgToPngBuffer(svgPath, size),
      catch: (cause) =>
        new IconAssetError({
          message: `Failed to render ${svgPath} to ${targetPath}`,
          cause,
        }),
    });
    yield* writeBufferFile(targetPath, buffer);
  });
}

export function renderSvgToIcoFile(svgPath: string, targetPath: string) {
  return Effect.gen(function* () {
    const buffer = yield* Effect.tryPromise({
      try: () => renderSvgToIcoBuffer(svgPath),
      catch: (cause) =>
        new IconAssetError({
          message: `Failed to render ${svgPath} to ${targetPath}`,
          cause,
        }),
    });
    yield* writeBufferFile(targetPath, buffer);
  });
}

export function prepareBrowserBrandAssets(clientDir: string, repoRoot: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const lightSvgPath = path.join(repoRoot, BRAND_LOGO_SVG_PATHS.light);
    const darkSvgPath = path.join(repoRoot, BRAND_LOGO_SVG_PATHS.dark);

    if (!(yield* fs.exists(lightSvgPath))) {
      return yield* new IconAssetError({ message: `Missing light brand SVG: ${lightSvgPath}` });
    }
    if (!(yield* fs.exists(darkSvgPath))) {
      return yield* new IconAssetError({ message: `Missing dark brand SVG: ${darkSvgPath}` });
    }

    yield* fs.makeDirectory(clientDir, { recursive: true });
    for (const fileName of LEGACY_BROWSER_ICON_FILENAMES) {
      yield* fs
        .remove(path.join(clientDir, fileName), { force: true })
        .pipe(Effect.catch(() => Effect.void));
    }
    yield* fs.copyFile(
      lightSvgPath,
      path.join(clientDir, PUBLIC_BRAND_ICON_FILENAMES.iconLightSvg),
    );
    yield* fs.copyFile(darkSvgPath, path.join(clientDir, PUBLIC_BRAND_ICON_FILENAMES.iconDarkSvg));
    yield* renderSvgToIcoFile(
      lightSvgPath,
      path.join(clientDir, PUBLIC_BRAND_ICON_FILENAMES.faviconIco),
    );
    yield* renderSvgToPngFile(
      lightSvgPath,
      path.join(clientDir, PUBLIC_BRAND_ICON_FILENAMES.favicon16Png),
      16,
    );
    yield* renderSvgToPngFile(
      lightSvgPath,
      path.join(clientDir, PUBLIC_BRAND_ICON_FILENAMES.favicon32Png),
      32,
    );
    yield* renderSvgToPngFile(
      lightSvgPath,
      path.join(clientDir, PUBLIC_BRAND_ICON_FILENAMES.appleTouchIconPng),
      180,
    );
  });
}
