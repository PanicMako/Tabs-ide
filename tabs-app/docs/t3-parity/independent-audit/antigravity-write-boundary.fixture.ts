import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { writeAntigravityClientTextFile } from "./AntigravityClientFiles.ts";
it.effect("diagnostic: missing parent below symlink writes outside allowed root", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-antigravity-boundary-" });
    const canonical = yield* fs.realPath(dir);
    const root = path.join(canonical, "allowed");
    const outside = path.join(canonical, "outside");
    yield* fs.makeDirectory(root);
    yield* fs.makeDirectory(outside);
    yield* fs.symlink(outside, path.join(root, "link"));
    yield* writeAntigravityClientTextFile({
      fileSystem: fs,
      path,
      allowedRoots: [root],
      request: {
        sessionId: "diagnostic",
        path: path.join(root, "link", "new-folder", "result.txt"),
        content: "synthetic-evidence",
      },
    });
    assert.equal(
      yield* fs.readFileString(path.join(outside, "new-folder", "result.txt")),
      "synthetic-evidence",
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
