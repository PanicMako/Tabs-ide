import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProjectFileLoader from "./ProjectFileLoader.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(ProjectFileLoader.layer),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "tabs-project-file-",
  });
});

const writeProjectFile = Effect.fn("writeProjectFile")(function* (
  cwd: string,
  fileName: string,
  contents: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.writeFileString(path.join(cwd, fileName), contents).pipe(Effect.orDie);
});

it.layer(TestLayer)("ProjectFileLoader", (it) => {
  describe("load", () => {
    it.effect("loads and parses tabs.json when present", () =>
      Effect.gen(function* () {
        const loader = yield* ProjectFileLoader.ProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(
          cwd,
          "tabs.json",
          `{
            // JSONC is tolerated
            "defaultThreadEnvMode": "worktree",
            "scripts": [
              {
                "name": "Setup",
                "command": "bun install",
                "icon": "configure",
                "runOnWorktreeCreate": true,
              }
            ],
          }`,
        );

        const loaded = yield* loader.load(cwd);

        expect(Option.isSome(loaded)).toBe(true);
        if (Option.isSome(loaded)) {
          expect(loaded.value.defaultThreadEnvMode).toBe("worktree");
          expect(loaded.value.scripts?.[0]?.name).toBe("Setup");
        }
      }),
    );

    it.effect("falls back to t3.json when tabs.json is missing", () =>
      Effect.gen(function* () {
        const loader = yield* ProjectFileLoader.ProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(
          cwd,
          "t3.json",
          `{
            "defaultThreadEnvMode": "local",
          }`,
        );

        const loaded = yield* loader.load(cwd);

        expect(Option.isSome(loaded)).toBe(true);
        if (Option.isSome(loaded)) {
          expect(loaded.value.defaultThreadEnvMode).toBe("local");
        }
      }),
    );

    it.effect("resolves Option.none when no project file exists", () =>
      Effect.gen(function* () {
        const loader = yield* ProjectFileLoader.ProjectFileLoader;
        const cwd = yield* makeTempDir;

        const loaded = yield* loader.load(cwd);

        expect(Option.isNone(loaded)).toBe(true);
      }),
    );

    it.effect("returns Option.none and does not throw for malformed JSON", () =>
      Effect.gen(function* () {
        const loader = yield* ProjectFileLoader.ProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(cwd, "tabs.json", "{ broken json");

        const loaded = yield* loader.load(cwd);

        expect(Option.isNone(loaded)).toBe(true);
      }),
    );
  });
});
