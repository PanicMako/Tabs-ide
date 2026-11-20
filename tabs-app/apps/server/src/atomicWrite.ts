import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { resolveSymlinkTarget } from "@tabs/shared/symlink";

export const writeFileStringAtomically = (input: {
  readonly filePath: string;
  readonly contents: string | Uint8Array;
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const targetPath = yield* resolveSymlinkTarget(input.filePath);
      const targetDirectory = path.dirname(targetPath);

      yield* fs.makeDirectory(targetDirectory, { recursive: true });
      const tempDirectory = yield* Effect.acquireRelease(
        fs.makeTempDirectory({
          directory: targetDirectory,
          prefix: `${path.basename(targetPath)}.`,
        }),
        (directory) => fs.remove(directory, { recursive: true }).pipe(Effect.ignore({ log: true })),
      );
      const tempPath = path.join(tempDirectory, "contents.tmp");

      yield* typeof input.contents === "string"
        ? fs.writeFileString(tempPath, input.contents)
        : fs.writeFile(tempPath, input.contents);
      yield* fs.rename(tempPath, targetPath);
    }),
  );
