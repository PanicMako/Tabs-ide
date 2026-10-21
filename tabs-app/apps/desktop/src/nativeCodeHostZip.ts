import * as FS from "node:fs";
import * as Path from "node:path";

import { filePathFromNativeUri } from "./nativeCodeHostOpen";

export type NativeZipInput =
  | { readonly path: string; readonly contents: string }
  | {
      readonly path: string;
      readonly source: unknown;
      readonly size?: number;
      readonly skipSourceErrors?: boolean;
      readonly compress?: boolean;
    }
  | { readonly sourceArchive: unknown };

type ZipEntry = {
  path: string;
  contents?: string;
  localPath?: string;
  localPathSize?: number;
  skipSourceErrors?: boolean;
  compress?: boolean;
};

export interface NativeZipToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface NativeZipCancellation {
  readonly token: NativeZipToken;
  cancel(): void;
  dispose(): void;
}

export type NativeZipWriter = (
  zipPath: string,
  files: ZipEntry[],
  options?: { token?: NativeZipToken; onProgress?: (bytes: number, path: string) => void },
) => Promise<unknown>;

function checkCancellation(token?: NativeZipToken): void {
  if (token?.isCancellationRequested) {
    const error = new Error("Canceled");
    error.name = "Canceled";
    throw error;
  }
}

export async function createNativeCodeZip(
  zip: NativeZipWriter,
  zipUri: unknown,
  inputs: readonly NativeZipInput[],
  options?: { readonly maxSize?: number; readonly maxEntries?: number },
  execution?: {
    readonly token: NativeZipToken;
    readonly progress: (bytes: number, total: number, path: string) => void;
  },
): Promise<void> {
  checkCancellation(execution?.token);
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
    checkCancellation(execution?.token);
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
          ...(input.compress !== undefined ? { compress: input.compress } : null),
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
  checkCancellation(execution?.token);
  try {
    if (execution) {
      await zip(zipPath, entries, {
        token: execution.token,
        onProgress: (bytes, path) => execution.progress(bytes, uncompressedSize, path),
      });
    } else {
      await zip(zipPath, entries);
    }
    checkCancellation(execution?.token);
  } catch (error) {
    // The writer has closed its streams before rejecting. Remove incomplete output.
    await FS.promises.rm(zipPath, { force: true }).catch(() => undefined);
    throw error;
  }
  if (options?.maxSize !== undefined) {
    const archiveSize = (await FS.promises.stat(zipPath)).size;
    if (archiveSize > options.maxSize) {
      await FS.promises.rm(zipPath, { force: true });
      throw new Error(`ZIP is too large (${archiveSize} bytes; limit ${options.maxSize})`);
    }
  }
}

export interface NativeZipProgress {
  readonly operationId: string;
  readonly bytes: number;
  readonly total: number;
  readonly path: string;
}

/** Operation IDs are scoped to the requesting renderer, including cancellation. */
export class NativeCodeZipOperations {
  private disposed = false;
  private readonly pending = new Set<Promise<void>>();
  private readonly active = new Map<number, Map<string | symbol, NativeZipCancellation>>();

  constructor(
    private readonly zip: NativeZipWriter,
    private readonly cancellation: () => NativeZipCancellation,
    private readonly progress: (value: NativeZipProgress) => void,
  ) {}

  async create(
    owner: number,
    destination: unknown,
    files: readonly NativeZipInput[],
    options?: { maxSize?: number; maxEntries?: number; operationId?: string },
  ): Promise<void> {
    if (this.disposed) throw new Error("ZIP service is shutting down");
    const key = options?.operationId ?? Symbol();
    const operations = this.active.get(owner) ?? new Map();
    if (operations.has(key)) throw new Error("ZIP operation ID is already in use");
    const source = this.cancellation();
    operations.set(key, source);
    this.active.set(owner, operations);
    let finished!: () => void;
    const completion = new Promise<void>((resolve) => {
      finished = resolve;
    });
    this.pending.add(completion);
    let lastReport = 0;
    try {
      await createNativeCodeZip(this.zip, destination, files, options, {
        token: source.token,
        progress: (bytes, total, path) => {
          const now = Date.now();
          if (
            options?.operationId &&
            !source.token.isCancellationRequested &&
            (bytes === total || now - lastReport >= 100)
          ) {
            lastReport = now;
            this.progress({ operationId: options.operationId, bytes, total, path });
          }
        },
      });
    } finally {
      operations.delete(key);
      if (!operations.size) this.active.delete(owner);
      source.dispose();
      this.pending.delete(completion);
      finished();
    }
  }

  cancel(owner: number, operationId: string): void {
    this.active.get(owner)?.get(operationId)?.cancel();
  }

  cancelWindow(owner: number): void {
    for (const source of this.active.get(owner)?.values() ?? []) source.cancel();
  }

  async shutdown(): Promise<void> {
    this.dispose();
    await Promise.all(this.pending);
  }

  dispose(): void {
    this.disposed = true;
    for (const owner of this.active.keys()) this.cancelWindow(owner);
  }
}
