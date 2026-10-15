import * as Effect from "../../../apps/server/node_modules/effect/dist/Effect.js";
import * as Layer from "../../../apps/server/node_modules/effect/dist/Layer.js";
import * as NodeServices from "../../../apps/server/node_modules/@effect/platform-node/dist/NodeServices.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as Config from "../../../apps/server/src/config.ts";
import * as Entries from "../../../apps/server/src/workspace/WorkspaceEntries.ts";
import * as Paths from "../../../apps/server/src/workspace/WorkspacePaths.ts";
import * as Files from "../../../apps/server/src/workspace/WorkspaceFileSystem.ts";
import * as Vcs from "../../../apps/server/src/vcs/VcsDriverRegistry.ts";
import * as Process from "../../../apps/server/src/vcs/VcsProcess.ts";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "tabs-audit-write-"));
const cwd = path.join(root, "workspace");
const outside = path.join(root, "outside");
await fs.mkdir(cwd);
await fs.mkdir(outside);
const victim = path.join(outside, "fixture.txt");
await fs.writeFile(victim, "original");
await fs.symlink(outside, path.join(cwd, "linked"));
const layer = Files.layer.pipe(
  Layer.provide(Paths.layer),
  Layer.provide(Entries.layer.pipe(Layer.provide(Paths.layer))),
  Layer.provide(Vcs.layer.pipe(Layer.provide(Process.layer))),
  Layer.provide(Config.ServerConfig.layerTest(cwd, { prefix: "tabs-audit-config-" })),
  Layer.provide(NodeServices.layer),
);
try {
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const service = yield* Files.WorkspaceFileSystem;
        return yield* service.writeFile({
          cwd,
          relativePath: "linked/fixture.txt",
          contents: "overwritten",
        });
      }).pipe(Effect.provide(layer)),
    ),
  );
  console.log(
    JSON.stringify({
      result,
      outsideContents: await fs.readFile(victim, "utf8"),
      fixtureRoot: root,
    }),
  );
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
