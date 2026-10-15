import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";

import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";

/**
 * Workspace file access requested through the ACP client `fs` capability.
 * The agent gates each write behind `session/request_permission`, so only
 * path containment is checked here.
 */
const CLIENT_FILE_MAX_BYTES = 8 * 1024 * 1024;

function isInsideRoot(path: Path.Path, root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolves an agent-supplied path and rejects anything outside the session
 * roots. Symlinks resolve before the check, including the final component, so
 * a link inside the workspace cannot read or write through to a file outside
 * it. An entry that exists but cannot be resolved, like a dangling link, is
 * rejected rather than written through.
 */
const resolveClientFilePath = Effect.fn("AntigravityClientFiles.resolveClientFilePath")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly allowedRoots: ReadonlyArray<string>;
    readonly requestPath: string;
  }) {
    const { path } = input;
    const resolved = path.resolve(input.requestPath);
    const outside = EffectAcpErrors.AcpRequestError.invalidParams(
      `Path '${input.requestPath}' is outside the session workspace.`,
    );
    const real = yield* input.fileSystem.realPath(resolved).pipe(
      Effect.catch(() =>
        Effect.gen(function* () {
          // Only a missing file (a new write) falls back to its parent; a
          // dangling or unreadable link must not be followed on write.
          const entryExists = yield* input.fileSystem.readLink(resolved).pipe(
            Effect.as(true),
            Effect.catch(() => input.fileSystem.exists(resolved)),
            Effect.orElseSucceed(() => true),
          );
          if (entryExists) return yield* outside;
          // Resolve the nearest existing ancestor, including when several
          // parent directories have not been created yet. Never fall back to
          // a lexical parent beneath an unresolved symlink.
          let ancestor = path.dirname(resolved);
          const missing = [path.basename(resolved)];
          while (true) {
            const canonical = yield* input.fileSystem.realPath(ancestor).pipe(Effect.option);
            if (canonical._tag === "Some") return path.join(canonical.value, ...missing);
            const exists = yield* input.fileSystem.readLink(ancestor).pipe(
              Effect.as(true),
              Effect.catch(() => input.fileSystem.exists(ancestor)),
              Effect.orElseSucceed(() => true),
            );
            if (exists || path.dirname(ancestor) === ancestor) return yield* outside;
            missing.unshift(path.basename(ancestor));
            ancestor = path.dirname(ancestor);
          }
        }),
      ),
    );
    const roots = yield* Effect.forEach(input.allowedRoots, (root) =>
      input.fileSystem.realPath(root).pipe(Effect.orElseSucceed(() => root)),
    );
    if (!roots.some((root) => isInsideRoot(path, root, real))) {
      return yield* outside;
    }
    return real;
  },
);

export const readAntigravityClientTextFile = Effect.fn("AntigravityClientFiles.readTextFile")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly allowedRoots: ReadonlyArray<string>;
    readonly request: EffectAcpSchema.ReadTextFileRequest;
  }): Effect.fn.Return<EffectAcpSchema.ReadTextFileResponse, EffectAcpErrors.AcpError> {
    const filePath = yield* resolveClientFilePath({ ...input, requestPath: input.request.path });
    const roots = yield* Effect.forEach(input.allowedRoots, (root) =>
      input.fileSystem.realPath(root).pipe(Effect.orElseSucceed(() => root)),
    );
    const outside = EffectAcpErrors.AcpRequestError.invalidParams(
      `Path '${input.request.path}' is outside the session workspace.`,
    );

    const handle = yield* Effect.tryPromise({
      try: () =>
        NodeFSP.open(filePath, NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NOFOLLOW ?? 0)),
      catch: () =>
        EffectAcpErrors.AcpRequestError.resourceNotFound(`File '${input.request.path}' not found.`),
    });

    const content = yield* Effect.acquireUseRelease(
      Effect.succeed(handle),
      (h) =>
        Effect.gen(function* () {
          const stat = yield* Effect.tryPromise({
            try: () => h.stat(),
            catch: () =>
              EffectAcpErrors.AcpRequestError.internalError(
                `Could not read '${input.request.path}'.`,
              ),
          });
          if (!stat.isFile() || stat.size > CLIENT_FILE_MAX_BYTES) {
            return yield* EffectAcpErrors.AcpRequestError.invalidParams(
              `File '${input.request.path}' is not a readable text file under ${CLIENT_FILE_MAX_BYTES} bytes.`,
            );
          }
          const reopenedPath = yield* input.fileSystem.realPath(filePath).pipe(Effect.option);
          if (
            reopenedPath._tag === "None" ||
            !roots.some((r) => isInsideRoot(input.path, r, reopenedPath.value))
          ) {
            return yield* outside;
          }
          const current = yield* Effect.tryPromise(() => NodeFSP.stat(reopenedPath.value)).pipe(
            Effect.option,
          );
          if (
            current._tag === "None" ||
            current.value.dev !== stat.dev ||
            current.value.ino !== stat.ino
          ) {
            return yield* outside;
          }
          const text = yield* Effect.tryPromise({
            try: () => h.readFile({ encoding: "utf-8" }),
            catch: () =>
              EffectAcpErrors.AcpRequestError.internalError(
                `Could not read '${input.request.path}'.`,
              ),
          });
          return text;
        }),
      (h) =>
        Effect.tryPromise({ try: () => h.close(), catch: () => undefined }).pipe(Effect.ignore),
    );

    const line = input.request.line ?? undefined;
    const limit = input.request.limit ?? undefined;
    if (line === undefined && limit === undefined) {
      return { content };
    }
    // ACP lines are 1-indexed. `limit` is a line count.
    const lines = content.split("\n");
    const start = Math.max(0, (line ?? 1) - 1);
    const end = limit === undefined ? lines.length : Math.min(lines.length, start + limit);
    return { content: lines.slice(start, end).join("\n") };
  },
);

export const writeAntigravityClientTextFile = Effect.fn("AntigravityClientFiles.writeTextFile")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly allowedRoots: ReadonlyArray<string>;
    readonly request: EffectAcpSchema.WriteTextFileRequest;
  }): Effect.fn.Return<EffectAcpSchema.WriteTextFileResponse, EffectAcpErrors.AcpError> {
    const filePath = yield* resolveClientFilePath({ ...input, requestPath: input.request.path });
    const roots = yield* Effect.forEach(input.allowedRoots, (root) =>
      input.fileSystem.realPath(root).pipe(Effect.orElseSucceed(() => root)),
    );
    const outside = EffectAcpErrors.AcpRequestError.invalidParams(
      `Path '${input.request.path}' is outside the session workspace.`,
    );

    yield* input.fileSystem
      .makeDirectory(input.path.dirname(filePath), { recursive: true })
      .pipe(
        Effect.mapError(() =>
          EffectAcpErrors.AcpRequestError.internalError(`Could not write '${input.request.path}'.`),
        ),
      );

    const openFileSafely = async () => {
      try {
        const h = await NodeFSP.open(
          filePath,
          NodeFS.constants.O_WRONLY | (NodeFS.constants.O_NOFOLLOW ?? 0),
          0o666,
        );
        return { handle: h, created: false };
      } catch (err: any) {
        if (err?.code !== "ENOENT") {
          throw err;
        }
      }
      try {
        const h = await NodeFSP.open(
          filePath,
          NodeFS.constants.O_WRONLY |
            NodeFS.constants.O_CREAT |
            NodeFS.constants.O_EXCL |
            (NodeFS.constants.O_NOFOLLOW ?? 0),
          0o666,
        );
        return { handle: h, created: true };
      } catch (err: any) {
        if (err?.code === "EEXIST") {
          const h = await NodeFSP.open(
            filePath,
            NodeFS.constants.O_WRONLY | (NodeFS.constants.O_NOFOLLOW ?? 0),
            0o666,
          );
          return { handle: h, created: false };
        }
        throw err;
      }
    };

    yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        try: openFileSafely,
        catch: () =>
          EffectAcpErrors.AcpRequestError.internalError(`Could not write '${input.request.path}'.`),
      }),
      ({ handle: h, created }) =>
        Effect.gen(function* () {
          const stat = yield* Effect.tryPromise({
            try: () => h.stat(),
            catch: () =>
              EffectAcpErrors.AcpRequestError.internalError(
                `Could not write '${input.request.path}'.`,
              ),
          });
          if (!stat.isFile()) {
            return yield* outside;
          }
          const reopenedPath = yield* input.fileSystem.realPath(filePath).pipe(Effect.option);
          if (
            reopenedPath._tag === "None" ||
            !roots.some((r) => isInsideRoot(input.path, r, reopenedPath.value))
          ) {
            if (created) {
              yield* Effect.tryPromise(() => NodeFSP.unlink(filePath)).pipe(Effect.ignore);
            }
            return yield* outside;
          }
          const current = yield* Effect.tryPromise(() => NodeFSP.stat(reopenedPath.value)).pipe(
            Effect.option,
          );
          if (
            current._tag === "None" ||
            current.value.dev !== stat.dev ||
            current.value.ino !== stat.ino
          ) {
            if (created) {
              yield* Effect.tryPromise(() => NodeFSP.unlink(filePath)).pipe(Effect.ignore);
            }
            return yield* outside;
          }
          yield* Effect.tryPromise({
            try: async () => {
              if (!created) {
                await h.truncate(0);
              }
              await h.writeFile(input.request.content, "utf-8");
            },
            catch: () =>
              EffectAcpErrors.AcpRequestError.internalError(
                `Could not write '${input.request.path}'.`,
              ),
          });
        }),
      ({ handle: h }) =>
        Effect.tryPromise({ try: () => h.close(), catch: () => undefined }).pipe(Effect.ignore),
    );

    return {};
  },
);
