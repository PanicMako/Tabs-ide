// @effect-diagnostics nodeBuiltinImport:off
/**
 * WorkspaceFileSystem - Effect service contract for workspace file mutations.
 *
 * Owns workspace-root-relative file read/write operations and their associated
 * safety checks and cache invalidation hooks. Reads also accept absolute host
 * paths so clients can show files an agent left outside the workspace; writes
 * never leave the root.
 *
 * @module WorkspaceFileSystem
 */
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";

import type {
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "@tabs/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

const PROJECT_READ_FILE_MAX_BYTES = 1024 * 1024;

export class WorkspaceFileSystemOperationError extends Schema.TaggedError<WorkspaceFileSystemOperationError>()(
  "WorkspaceFileSystemOperationError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
    operationPath: Schema.String,
    operation: Schema.Literals([
      "realpath-workspace-root",
      "realpath-target",
      "open",
      "stat",
      "read",
      "close",
      "make-directory",
      "write-file",
    ]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Workspace file operation '${this.operation}' failed at '${this.operationPath}' for resolved path '${this.resolvedPath}' (requested as '${this.relativePath}' in '${this.workspaceRoot}').`;
  }
}

export class WorkspaceFilePathEscapeError extends Schema.TaggedError<WorkspaceFilePathEscapeError>()(
  "WorkspaceFilePathEscapeError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedWorkspaceRoot: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace file '${this.relativePath}' resolves outside workspace root '${this.workspaceRoot}': ${this.resolvedPath}`;
  }
}

export class WorkspacePathNotFileError extends Schema.TaggedError<WorkspacePathNotFileError>()(
  "WorkspacePathNotFileError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace path '${this.relativePath}' in '${this.workspaceRoot}' is not a file: ${this.resolvedPath}`;
  }
}

export class WorkspaceBinaryFileError extends Schema.TaggedError<WorkspaceBinaryFileError>()(
  "WorkspaceBinaryFileError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace file '${this.relativePath}' in '${this.workspaceRoot}' is binary and cannot be previewed as text.`;
  }
}

export const WorkspaceFileSystemError = Schema.Union([
  WorkspaceFileSystemOperationError,
  WorkspaceFilePathEscapeError,
  WorkspacePathNotFileError,
  WorkspaceBinaryFileError,
]);
export type WorkspaceFileSystemError = typeof WorkspaceFileSystemError.Type;

/** Service tag for workspace file operations. */
export class WorkspaceFileSystem extends Context.Service<
  WorkspaceFileSystem,
  {
    /**
     * Read a UTF-8 text file relative to the workspace root, or any host file by
     * absolute path.
     */
    readonly readFile: (
      input: ProjectReadFileInput,
    ) => Effect.Effect<
      ProjectReadFileResult,
      WorkspaceFileSystemError | WorkspacePaths.WorkspacePathOutsideRootError
    >;
    /**
     * Write a file relative to the workspace root.
     *
     * Creates parent directories as needed and rejects paths that escape the
     * workspace root.
     */
    readonly writeFile: (
      input: ProjectWriteFileInput,
    ) => Effect.Effect<
      ProjectWriteFileResult,
      WorkspaceFileSystemError | WorkspacePaths.WorkspacePathOutsideRootError
    >;
  }
>()("t3/workspace/WorkspaceFileSystem") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;

  /**
   * Resolves the file a read targets. Workspace-relative paths must stay inside the
   * root, symlinks included. An absolute path reads a host file in place, such as a
   * report an agent wrote to a temp directory; it gets no root check.
   */
  const resolveReadTarget = Effect.fn("WorkspaceFileSystem.resolveReadTarget")(function* (
    input: ProjectReadFileInput,
  ) {
    const requestedPath = input.relativePath.trim();
    if (path.isAbsolute(requestedPath)) {
      const realTargetPath = yield* Effect.tryPromise({
        try: () => NodeFSP.realpath(requestedPath),
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: requestedPath,
            operationPath: requestedPath,
            operation: "realpath-target",
            cause,
          }),
      });
      return { relativePath: requestedPath, realTargetPath };
    }

    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    const realWorkspaceRoot = yield* fileSystem.realPath(input.cwd).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: input.cwd,
            operation: "realpath-workspace-root",
            cause: (cause as any)?.cause ?? cause,
          }),
      ),
    );
    const realTargetPath = yield* fileSystem.realPath(target.absolutePath).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: target.absolutePath,
            operation: "realpath-target",
            cause: (cause as any)?.cause ?? cause,
          }),
      ),
    );
    const relativeRealPath = path.relative(realWorkspaceRoot, realTargetPath);
    if (
      relativeRealPath.startsWith(`..${path.sep}`) ||
      relativeRealPath === ".." ||
      path.isAbsolute(relativeRealPath)
    ) {
      return yield* new WorkspaceFilePathEscapeError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
        resolvedWorkspaceRoot: realWorkspaceRoot,
        resolvedPath: realTargetPath,
      });
    }
    return { relativePath: target.relativePath, realTargetPath, realWorkspaceRoot };
  });

  const readFile: WorkspaceFileSystem["Service"]["readFile"] = Effect.fn(
    "WorkspaceFileSystem.readFile",
  )(function* (input) {
    const target = yield* resolveReadTarget(input);
    const { realTargetPath, realWorkspaceRoot } = target;

    return yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        // Non-blocking so a FIFO cannot hang the open; the stat below rejects
        // it. Regular files ignore the flag. Windows lacks it.
        try: () =>
          NodeFSP.open(
            realTargetPath,
            NodeFS.constants.O_RDONLY |
              (NodeFS.constants.O_NONBLOCK ?? 0) |
              (path.isAbsolute(input.relativePath.trim()) ? 0 : (NodeFS.constants.O_NOFOLLOW ?? 0)),
          ),
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: realTargetPath,
            operationPath: realTargetPath,
            operation: "open",
            cause,
          }),
      }),
      (handle) =>
        Effect.gen(function* () {
          const stat = yield* Effect.tryPromise({
            try: () => handle.stat(),
            catch: (cause) =>
              new WorkspaceFileSystemOperationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: realTargetPath,
                operationPath: realTargetPath,
                operation: "stat",
                cause,
              }),
          });
          if (!stat.isFile()) {
            return yield* new WorkspacePathNotFileError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
            });
          }

          if (!path.isAbsolute(input.relativePath.trim()) && realWorkspaceRoot !== undefined) {
            const recheck = yield* Effect.tryPromise(() => NodeFSP.realpath(realTargetPath)).pipe(
              Effect.option,
            );
            if (recheck._tag === "None") {
              return yield* new WorkspaceFilePathEscapeError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedWorkspaceRoot: realWorkspaceRoot,
                resolvedPath: realTargetPath,
              });
            }
            const relativeRealPath = path.relative(realWorkspaceRoot, recheck.value);
            if (
              relativeRealPath.startsWith(`..${path.sep}`) ||
              relativeRealPath === ".." ||
              path.isAbsolute(relativeRealPath)
            ) {
              return yield* new WorkspaceFilePathEscapeError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedWorkspaceRoot: realWorkspaceRoot,
                resolvedPath: realTargetPath,
              });
            }
            const current = yield* Effect.tryPromise(() => NodeFSP.stat(recheck.value)).pipe(
              Effect.option,
            );
            if (
              current._tag === "None" ||
              current.value.dev !== stat.dev ||
              current.value.ino !== stat.ino
            ) {
              return yield* new WorkspaceFilePathEscapeError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedWorkspaceRoot: realWorkspaceRoot,
                resolvedPath: realTargetPath,
              });
            }
          }

          const bytesToRead = Math.min(stat.size, PROJECT_READ_FILE_MAX_BYTES);
          const buffer = Buffer.alloc(bytesToRead);
          const { bytesRead } = yield* Effect.tryPromise({
            try: () => handle.read(buffer, 0, bytesToRead, 0),
            catch: (cause) =>
              new WorkspaceFileSystemOperationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: realTargetPath,
                operationPath: realTargetPath,
                operation: "read",
                cause,
              }),
          });
          const fileBytes = buffer.subarray(0, bytesRead);
          if (fileBytes.includes(0)) {
            return yield* new WorkspaceBinaryFileError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
            });
          }

          return {
            relativePath: target.relativePath,
            contents: new TextDecoder("utf-8").decode(fileBytes),
            byteLength: stat.size,
            truncated: stat.size > PROJECT_READ_FILE_MAX_BYTES,
          };
        }),
      (handle) =>
        Effect.tryPromise({
          try: () => handle.close(),
          catch: (cause) =>
            new WorkspaceFileSystemOperationError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
              operationPath: realTargetPath,
              operation: "close",
              cause,
            }),
        }),
    );
  });

  const writeFile: WorkspaceFileSystem["Service"]["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    const realWorkspaceRoot = yield* fileSystem.realPath(input.cwd).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: input.cwd,
            operation: "realpath-workspace-root",
            cause,
          }),
      ),
    );
    const absolutePath = yield* Effect.tryPromise({
      try: async () => {
        let ancestor = target.absolutePath;
        const missing: string[] = [];
        while (true) {
          try {
            const canonical = await NodeFSP.realpath(ancestor);
            const candidate = path.join(canonical, ...missing);
            const relative = path.relative(realWorkspaceRoot, candidate);
            if (
              relative === ".." ||
              relative.startsWith(`..${path.sep}`) ||
              path.isAbsolute(relative)
            ) {
              throw new WorkspaceFilePathEscapeError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedWorkspaceRoot: realWorkspaceRoot,
                resolvedPath: candidate,
              });
            }
            return candidate;
          } catch (cause) {
            if (cause instanceof WorkspaceFilePathEscapeError) throw cause;
            if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
            // A dangling link is an existing entry, not a missing directory.
            const entry = await NodeFSP.lstat(ancestor).catch((error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return undefined;
              throw error;
            });
            if (entry || path.dirname(ancestor) === ancestor) throw cause;
            missing.unshift(path.basename(ancestor));
            ancestor = path.dirname(ancestor);
          }
        }
      },
      catch: (cause) =>
        cause instanceof WorkspaceFilePathEscapeError
          ? cause
          : new WorkspaceFileSystemOperationError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: target.absolutePath,
              operationPath: target.absolutePath,
              operation: "realpath-target",
              cause,
            }),
    });

    yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: path.dirname(target.absolutePath),
            operation: "make-directory",
            cause,
          }),
      ),
    );

    const openFileSafely = async () => {
      try {
        const handle = await NodeFSP.open(
          absolutePath,
          NodeFS.constants.O_WRONLY | (NodeFS.constants.O_NOFOLLOW ?? 0),
          0o666,
        );
        return { handle, created: false };
      } catch (err: any) {
        if (err?.code !== "ENOENT") {
          throw err;
        }
      }
      try {
        const handle = await NodeFSP.open(
          absolutePath,
          NodeFS.constants.O_WRONLY |
            NodeFS.constants.O_CREAT |
            NodeFS.constants.O_EXCL |
            (NodeFS.constants.O_NOFOLLOW ?? 0),
          0o666,
        );
        return { handle, created: true };
      } catch (err: any) {
        if (err?.code === "EEXIST") {
          const handle = await NodeFSP.open(
            absolutePath,
            NodeFS.constants.O_WRONLY | (NodeFS.constants.O_NOFOLLOW ?? 0),
            0o666,
          );
          return { handle, created: false };
        }
        throw err;
      }
    };

    yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        try: openFileSafely,
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: target.absolutePath,
            operation: "open",
            cause,
          }),
      }),
      ({ handle, created }) =>
        Effect.gen(function* () {
          const stat = yield* Effect.tryPromise({
            try: () => handle.stat(),
            catch: (cause) =>
              new WorkspaceFileSystemOperationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: target.absolutePath,
                operationPath: target.absolutePath,
                operation: "stat",
                cause,
              }),
          });
          if (!stat.isFile()) {
            return yield* new WorkspacePathNotFileError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: target.absolutePath,
            });
          }
          const recheck = yield* Effect.tryPromise(() => NodeFSP.realpath(absolutePath)).pipe(
            Effect.option,
          );
          const relativeRealPath =
            recheck._tag === "Some" ? path.relative(realWorkspaceRoot, recheck.value) : "";
          const isEscaped =
            recheck._tag === "None" ||
            relativeRealPath.startsWith(`..${path.sep}`) ||
            relativeRealPath === ".." ||
            path.isAbsolute(relativeRealPath);

          if (isEscaped) {
            if (created) {
              yield* Effect.tryPromise(() => NodeFSP.unlink(absolutePath)).pipe(Effect.ignore);
            }
            return yield* new WorkspaceFilePathEscapeError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedWorkspaceRoot: realWorkspaceRoot,
              resolvedPath: absolutePath,
            });
          }

          const current = yield* Effect.tryPromise(() => NodeFSP.stat(recheck.value)).pipe(
            Effect.option,
          );
          if (
            current._tag === "None" ||
            current.value.dev !== stat.dev ||
            current.value.ino !== stat.ino
          ) {
            if (created) {
              yield* Effect.tryPromise(() => NodeFSP.unlink(absolutePath)).pipe(Effect.ignore);
            }
            return yield* new WorkspaceFilePathEscapeError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedWorkspaceRoot: realWorkspaceRoot,
              resolvedPath: absolutePath,
            });
          }

          yield* Effect.tryPromise({
            try: async () => {
              if (!created) {
                await handle.truncate(0);
              }
              await handle.writeFile(input.contents, "utf-8");
            },
            catch: (cause) =>
              new WorkspaceFileSystemOperationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: target.absolutePath,
                operationPath: target.absolutePath,
                operation: "write-file",
                cause,
              }),
          });
        }),
      ({ handle }) =>
        Effect.tryPromise({
          try: () => handle.close(),
          catch: (cause) =>
            new WorkspaceFileSystemOperationError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: target.absolutePath,
              operationPath: target.absolutePath,
              operation: "close",
              cause,
            }),
        }),
    );
    yield* workspaceEntries.refresh(input.cwd);
    return { relativePath: target.relativePath };
  });

  return WorkspaceFileSystem.of({ readFile, writeFile });
});

export const layer = Layer.effect(WorkspaceFileSystem, make);
