import * as NodeFS from "node:fs";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  readAntigravityClientTextFile,
  writeAntigravityClientTextFile,
} from "./AntigravityClientFiles.ts";

const platform = Layer.mergeAll(NodeServices.layer);

it.layer(platform, { excludeTestServices: true })(
  "AntigravityClientFiles containment and race hardening",
  (it) => {
    describe("containment boundaries", () => {
      it.effect("reads and writes valid files within the allowed root", () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-acp-client-test-" });
          const canonical = yield* fs.realPath(tempDir);
          const workspace = path.join(canonical, "workspace");
          yield* fs.makeDirectory(workspace);

          const targetFile = path.join(workspace, "sub", "test.txt");
          const writeResult = yield* writeAntigravityClientTextFile({
            fileSystem: fs,
            path,
            allowedRoots: [workspace],
            request: {
              sessionId: "test-session",
              path: targetFile,
              content: "Hello from ACP Client File!\nLine 2\nLine 3",
            },
          });
          expect(writeResult).toEqual({});

          const readResult = yield* readAntigravityClientTextFile({
            fileSystem: fs,
            path,
            allowedRoots: [workspace],
            request: {
              sessionId: "test-session",
              path: targetFile,
            },
          });
          expect(readResult.content).toBe("Hello from ACP Client File!\nLine 2\nLine 3");

          const sliceResult = yield* readAntigravityClientTextFile({
            fileSystem: fs,
            path,
            allowedRoots: [workspace],
            request: {
              sessionId: "test-session",
              path: targetFile,
              line: 2,
              limit: 1,
            },
          });
          expect(sliceResult.content).toBe("Line 2");
        }),
      );

      it.effect("rejects reads and writes outside the allowed workspace root", () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-acp-client-escape-" });
          const canonical = yield* fs.realPath(tempDir);
          const workspace = path.join(canonical, "workspace");
          const outside = path.join(canonical, "outside");
          yield* fs.makeDirectory(workspace);
          yield* fs.makeDirectory(outside);
          yield* fs.writeFileString(path.join(outside, "secret.txt"), "secret-content");

          const readError = yield* readAntigravityClientTextFile({
            fileSystem: fs,
            path,
            allowedRoots: [workspace],
            request: {
              sessionId: "test-session",
              path: path.join(outside, "secret.txt"),
            },
          }).pipe(Effect.flip);
          expect(readError._tag).toBe("AcpRequestError");

          const writeError = yield* writeAntigravityClientTextFile({
            fileSystem: fs,
            path,
            allowedRoots: [workspace],
            request: {
              sessionId: "test-session",
              path: path.join(outside, "pwned.txt"),
              content: "malicious",
            },
          }).pipe(Effect.flip);
          expect(writeError._tag).toBe("AcpRequestError");
          expect(yield* fs.exists(path.join(outside, "pwned.txt"))).toBe(false);
        }),
      );

      it.effect(
        "rejects writes and reads traversing through symlinks targeting outside the workspace",
        () =>
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const tempDir = yield* fs.makeTempDirectoryScoped({
              prefix: "tabs-acp-symlink-escape-",
            });
            const canonical = yield* fs.realPath(tempDir);
            const workspace = path.join(canonical, "workspace");
            const outside = path.join(canonical, "outside");
            yield* fs.makeDirectory(workspace);
            yield* fs.makeDirectory(outside);

            yield* fs.writeFileString(path.join(outside, "secret.txt"), "protected-data");
            yield* fs.symlink(outside, path.join(workspace, "escape_link"));

            const readError = yield* readAntigravityClientTextFile({
              fileSystem: fs,
              path,
              allowedRoots: [workspace],
              request: {
                sessionId: "test-session",
                path: path.join(workspace, "escape_link", "secret.txt"),
              },
            }).pipe(Effect.flip);
            expect(readError._tag).toBe("AcpRequestError");

            const writeError = yield* writeAntigravityClientTextFile({
              fileSystem: fs,
              path,
              allowedRoots: [workspace],
              request: {
                sessionId: "test-session",
                path: path.join(workspace, "escape_link", "injected.txt"),
                content: "injected",
              },
            }).pipe(Effect.flip);
            expect(writeError._tag).toBe("AcpRequestError");
            expect(yield* fs.exists(path.join(outside, "injected.txt"))).toBe(false);
          }),
      );

      it.effect("rejects missing parent beneath an escaping symlink", () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-acp-nested-link-" });
          const canonical = yield* fs.realPath(tempDir);
          const workspace = path.join(canonical, "workspace");
          const outside = path.join(canonical, "outside");
          yield* fs.makeDirectory(workspace);
          yield* fs.makeDirectory(outside);
          yield* fs.symlink(outside, path.join(workspace, "link"));

          const writeError = yield* writeAntigravityClientTextFile({
            fileSystem: fs,
            path,
            allowedRoots: [workspace],
            request: {
              sessionId: "test-session",
              path: path.join(workspace, "link", "new-folder", "result.txt"),
              content: "should-not-write",
            },
          }).pipe(Effect.flip);
          expect(writeError._tag).toBe("AcpRequestError");
          expect(yield* fs.exists(path.join(outside, "new-folder"))).toBe(false);
        }),
      );
    });

    describe("race and ancestor replacement defense", () => {
      it.effect(
        "rejects write when an ancestor is replaced by a symlink to outside directory",
        () =>
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-acp-race-" });
            const canonical = yield* fs.realPath(tempDir);
            const workspace = path.join(canonical, "workspace");
            const outside = path.join(canonical, "outside");
            yield* fs.makeDirectory(workspace);
            yield* fs.makeDirectory(outside);

            const subDir = path.join(workspace, "nested");
            yield* fs.makeDirectory(subDir);
            const targetFile = path.join(subDir, "payload.txt");

            // Simulate ancestor swap before write: subDir replaced with symlink to outside
            yield* fs.remove(subDir, { recursive: true });
            yield* fs.symlink(outside, subDir);

            const error = yield* writeAntigravityClientTextFile({
              fileSystem: fs,
              path,
              allowedRoots: [workspace],
              request: {
                sessionId: "race-session",
                path: targetFile,
                content: "payload",
              },
            }).pipe(Effect.flip);

            expect(error._tag).toBe("AcpRequestError");
            expect(yield* fs.exists(path.join(outside, "payload.txt"))).toBe(false);
          }),
      );

      it.effect(
        "deterministically preserves outside content when ancestor is swapped after authorization and before open/truncate",
        () =>
          Effect.gen(function* () {
            const actualFs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const tempDir = yield* actualFs.makeTempDirectoryScoped({
              prefix: "tabs-acp-race-interleave-",
            });
            const canonical = yield* actualFs.realPath(tempDir);
            const workspace = path.join(canonical, "workspace");
            const outside = path.join(canonical, "outside");
            const parentDir = path.join(workspace, "parent");
            yield* actualFs.makeDirectory(parentDir, { recursive: true });
            yield* actualFs.makeDirectory(outside);

            const insideTarget = path.join(parentDir, "target.txt");
            const outsideTarget = path.join(outside, "target.txt");
            yield* actualFs.writeFileString(insideTarget, "inside");
            yield* actualFs.writeFileString(outsideTarget, "OUTSIDE CONTENT MUST SURVIVE");

            let rootsObserved = 0;
            const observedFs: FileSystem.FileSystem = {
              ...actualFs,
              realPath: (target) =>
                actualFs.realPath(target).pipe(
                  Effect.tap(() => {
                    if (target !== workspace || ++rootsObserved !== 2) return Effect.void;
                    // Swap ancestor after initial authorization in resolveClientFilePath, before openFileSafely
                    return Effect.gen(function* () {
                      yield* actualFs.rename(parentDir, path.join(workspace, "original-parent"));
                      yield* actualFs.symlink(outside, parentDir);
                    });
                  }),
                ),
            };

            const result = yield* writeAntigravityClientTextFile({
              fileSystem: observedFs,
              path,
              allowedRoots: [workspace],
              request: {
                sessionId: "race-session",
                path: insideTarget,
                content: "malicious overwrite",
              },
            }).pipe(Effect.flip);

            expect(result._tag).toBe("AcpRequestError");
            const outsideContent = yield* actualFs.readFileString(outsideTarget);
            expect(outsideContent).toBe("OUTSIDE CONTENT MUST SURVIVE");
          }),
      );

      it.effect(
        "deterministically prevents reading outside content when ancestor is swapped after authorization and before read",
        () =>
          Effect.gen(function* () {
            const actualFs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const tempDir = yield* actualFs.makeTempDirectoryScoped({
              prefix: "tabs-acp-race-read-interleave-",
            });
            const canonical = yield* actualFs.realPath(tempDir);
            const workspace = path.join(canonical, "workspace");
            const outside = path.join(canonical, "outside");
            const parentDir = path.join(workspace, "parent");
            yield* actualFs.makeDirectory(parentDir, { recursive: true });
            yield* actualFs.makeDirectory(outside);

            const insideTarget = path.join(parentDir, "target.txt");
            const outsideTarget = path.join(outside, "target.txt");
            yield* actualFs.writeFileString(insideTarget, "inside");
            yield* actualFs.writeFileString(outsideTarget, "SECRET OUTSIDE CONTENT");

            let rootsObserved = 0;
            const observedFs: FileSystem.FileSystem = {
              ...actualFs,
              realPath: (target) =>
                actualFs.realPath(target).pipe(
                  Effect.tap(() => {
                    if (target !== workspace || ++rootsObserved !== 2) return Effect.void;
                    // Swap ancestor after initial authorization in resolveClientFilePath, before open
                    return Effect.gen(function* () {
                      yield* actualFs.rename(parentDir, path.join(workspace, "original-parent"));
                      yield* actualFs.symlink(outside, parentDir);
                    });
                  }),
                ),
            };

            const result = yield* readAntigravityClientTextFile({
              fileSystem: observedFs,
              path,
              allowedRoots: [workspace],
              request: {
                sessionId: "race-read-session",
                path: insideTarget,
              },
            }).pipe(Effect.flip);

            expect(result._tag).toBe("AcpRequestError");
          }),
      );
    });
  },
);
