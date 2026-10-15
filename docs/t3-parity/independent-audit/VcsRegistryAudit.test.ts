import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Registry from "./VcsDriverRegistry.ts";
import * as Process from "./VcsProcess.ts";

const live = Registry.layer.pipe(
  Layer.provideMerge(Process.layer),
  Layer.provideMerge(NodeServices.layer),
);
it.effect("real Git cache follows nested repository creation and removal", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const process = yield* Process.VcsProcess;
    const registry = yield* Registry.VcsDriverRegistry;
    const temp = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-vcs-audit-" });
    const root = yield* fs.realPath(temp);
    const nested = path.join(root, "nested");
    const cwd = path.join(nested, "child");
    yield* fs.makeDirectory(cwd, { recursive: true });
    const init = (directory: string) =>
      process.run({
        operation: "audit.init",
        command: "git",
        args: ["init", "--quiet"],
        cwd: directory,
      });
    assert.strictEqual(yield* registry.detect({ cwd, requestedKind: "git" }), null);
    yield* init(root);
    assert.strictEqual(
      (yield* registry.resolve({ cwd, requestedKind: "git" })).repository.rootPath,
      root,
    );
    assert.strictEqual(
      (yield* registry.resolve({ cwd, requestedKind: "git" })).repository.rootPath,
      root,
    );
    yield* init(nested);
    assert.strictEqual(
      (yield* registry.resolve({ cwd, requestedKind: "git" })).repository.rootPath,
      nested,
    );
    yield* fs.remove(path.join(nested, ".git"), { recursive: true });
    assert.strictEqual(
      (yield* registry.resolve({ cwd, requestedKind: "git" })).repository.rootPath,
      root,
    );
  }).pipe(Effect.provide(live)),
);
