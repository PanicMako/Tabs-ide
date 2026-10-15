import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import { execFileSync } from "node:child_process";
import * as ServerConfig from "../config.ts";
import * as Secret from "../auth/ServerSecretStore.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import {
  issueDraftWorkspaceAssetUrl,
  resolveDraftWorkspaceAsset,
  ASSET_ROUTE_PREFIX,
} from "./AssetAccess.ts";
import { openMediaFile } from "./MediaFile.ts";
const config = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "tabs-boundary-audit-",
});
const live = Layer.mergeAll(
  config,
  WorkspacePaths.layer,
  Secret.layer.pipe(Layer.provide(config)),
).pipe(Layer.provideMerge(NodeServices.layer));
it.effect("audit exact draft token rejects at expiry boundary", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-expiry-audit-" });
    yield* fs.writeFileString(path.join(cwd, "report.html"), "preview");
    yield* TestClock.setTime(0);
    const issued = yield* issueDraftWorkspaceAssetUrl({
      _tag: "draft-workspace-file",
      cwd,
      path: "report.html",
    });
    const suffix = issued.relativeUrl.slice(ASSET_ROUTE_PREFIX.length + 1);
    const token = suffix.slice(0, suffix.indexOf("/"));
    assert.equal(issued.expiresAt, 3600000);
    yield* TestClock.setTime(issued.expiresAt - 1);
    assert.isString(yield* resolveDraftWorkspaceAsset(token, "report.html"));
    assert.equal(yield* resolveDraftWorkspaceAsset(token, "other.html"), null);
    assert.equal(yield* resolveDraftWorkspaceAsset(token + "tampered", "report.html"), null);
    yield* TestClock.setTime(issued.expiresAt);
    assert.equal(yield* resolveDraftWorkspaceAsset(token, "report.html"), null);
  }).pipe(Effect.provide(live)),
);
it.effect("audit actual FIFO is rejected without waiting for a writer", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-fifo-audit-" });
    const fifo = path.join(yield* fs.realPath(cwd), "blocked.mp4");
    yield* Effect.sync(() => execFileSync("mkfifo", [fifo]));
    assert.equal(yield* openMediaFile(fifo), null);
  }).pipe(Effect.provide(NodeServices.layer)),
);
