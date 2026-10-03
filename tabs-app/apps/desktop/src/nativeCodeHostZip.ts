import * as FS from "node:fs";
import * as Path from "node:path";

import { filePathFromNativeUri } from "./nativeCodeHostOpen";

type NativeZipInput =
  | { readonly path: string; readonly contents: string }
  | {
      readonly path: string;
      readonly source: unknown;
      readonly size?: number;
      readonly skipSourceErrors?: boolean;
    }
  | { readonly sourceArchive: unknown };

type ZipEntry = {
  path: string;
  contents?: string;
  localPath?: string;
  localPathSize?: number;
  skipSourceErrors?: boolean;
};

export async function createNativeCodeZip(
  zip: (zipPath: string, files: ZipEntry[]) => Promise<unknown>,
  zipUri: unknown,
  inputs: readonly NativeZipInput[],
  options?: { readonly maxSize?: number; readonly maxEntries?: number },
): Promise<void> {
  const zipPath = filePathFromNativeUri(zipUri);
  if (!zipPath) throw new Error("ZIP destination must be a local file");
  if (options?.maxEntries !== undefined && inputs.length > options.maxEntries) {
    throw new Error(
      `ZIP contains too many entries (${inputs.length}; limit ${options.maxEntries})`,
    );
  }

  const paths = new Set<string>();
  const entries: ZipEntry[] = [];
  let uncompressedSize = 0;
  for (const input of inputs) {
    if ("sourceArchive" in input) {
      throw new Error("Merging an existing ZIP is not supported by the embedded Code host");
    }
    const normalizedPath = input.path.replace(/\\/g, "/");
    if (
      !normalizedPath ||
      normalizedPath.startsWith("/") ||
      normalizedPath.split("/").includes("..")
    ) {
      throw new Error(`Invalid ZIP entry path '${input.path}'`);
    }
    if (paths.has(normalizedPath)) throw new Error(`Duplicate ZIP entry '${normalizedPath}'`);
    paths.add(normalizedPath);

    if ("contents" in input) {
      uncompressedSize += Buffer.byteLength(input.contents);
      entries.push({ path: normalizedPath, contents: input.contents });
    } else {
      const source = filePathFromNativeUri(input.source);
      if (!source) throw new Error(`ZIP source for '${normalizedPath}' must be a local file`);
      try {
        const sourceSize = (await FS.promises.stat(source)).size;
        const size = input.size === undefined ? sourceSize : Math.min(sourceSize, input.size);
        uncompressedSize += size;
        entries.push({
          path: normalizedPath,
          localPath: source,
          localPathSize: size,
          ...(input.skipSourceErrors !== undefined
            ? { skipSourceErrors: input.skipSourceErrors }
            : null),
        });
      } catch (error) {
        if (!input.skipSourceErrors) throw error;
      }
    }
    if (options?.maxSize !== undefined && uncompressedSize > options.maxSize) {
      throw new Error(
        `ZIP expands beyond the allowed size (${uncompressedSize} bytes; limit ${options.maxSize})`,
      );
    }
  }

  await FS.promises.mkdir(Path.dirname(zipPath), { recursive: true });
  await zip(zipPath, entries);
  if (options?.maxSize !== undefined) {
    const archiveSize = (await FS.promises.stat(zipPath)).size;
    if (archiveSize > options.maxSize) {
      await FS.promises.rm(zipPath, { force: true });
      throw new Error(`ZIP is too large (${archiveSize} bytes; limit ${options.maxSize})`);
    }
  }
}
