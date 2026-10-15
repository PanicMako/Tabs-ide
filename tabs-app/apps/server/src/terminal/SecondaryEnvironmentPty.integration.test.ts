import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import * as Manager from "./Manager.ts";
import * as NodePtyAdapter from "./NodePtyAdapter.ts";
import * as PtyAdapter from "./PtyAdapter.ts";

const platform = Layer.mergeAll(
  NodeServices.layer,
  NodePtyAdapter.layer.pipe(Layer.provide(NodeServices.layer)),
  ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer)),
);

it.layer(platform, { excludeTestServices: true })("real environment PTYs", (it) => {
  it.effect(
    "isolates identical terminal identities across environments through close and restart",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const ptyAdapter = yield* PtyAdapter.PtyAdapter;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-secondary-pty-" });
        const makeEnvironment = (name: string) =>
          Effect.gen(function* () {
            const cwd = `${root}/${name}`;
            yield* fs.makeDirectory(cwd);
            const manager = yield* Manager.makeWithOptions({
              logsDir: `${cwd}/logs`,
              ptyAdapter,
              shellResolver: () => "/bin/sh",
              env: { HOME: cwd, PATH: "/usr/bin:/bin", SHELL: "/bin/sh", TERM: "xterm" },
              processKillGraceMs: 100,
            });
            return { manager, cwd };
          });
        const primary = yield* makeEnvironment("primary");
        const secondary = yield* makeEnvironment("secondary");
        const identity = { threadId: "same-thread", terminalId: "same-terminal" };
        const primaryReady = yield* Deferred.make<void>();
        const secondaryReady = yield* Deferred.make<void>();
        const secondaryAfterClose = yield* Deferred.make<void>();
        let primaryOutput = "";
        let secondaryOutput = "";
        const unsubscribePrimary = yield* primary.manager.subscribe((event) =>
          Effect.gen(function* () {
            if (event.type !== "output") return;
            primaryOutput += event.data;
            if (primaryOutput.includes(`ENV_PRIMARY:${primary.cwd}`))
              yield* Deferred.succeed(primaryReady, undefined);
          }),
        );
        const unsubscribeSecondary = yield* secondary.manager.subscribe((event) =>
          Effect.gen(function* () {
            if (event.type !== "output") return;
            secondaryOutput += event.data;
            if (secondaryOutput.includes(`ENV_SECONDARY:${secondary.cwd}`))
              yield* Deferred.succeed(secondaryReady, undefined);
            if (/(?:^|[\r\n])SECONDARY_STILL_RUNNING(?:[\r\n]|$)/.test(secondaryOutput))
              yield* Deferred.succeed(secondaryAfterClose, undefined);
          }),
        );
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            unsubscribePrimary();
            unsubscribeSecondary();
          }),
        );
        const a = yield* primary.manager.open({ ...identity, cwd: primary.cwd });
        const b = yield* secondary.manager.open({ ...identity, cwd: secondary.cwd });
        assert.isNotNull(a.pid);
        assert.isNotNull(b.pid);
        assert.notEqual(a.pid, b.pid);
        yield* primary.manager.write({
          ...identity,
          data: "printf 'ENV_PRIMARY:%s\\n' \"$PWD\"\n",
        });
        yield* secondary.manager.write({
          ...identity,
          data: "printf 'ENV_SECONDARY:%s\\n' \"$PWD\"\n",
        });
        yield* Deferred.await(primaryReady).pipe(Effect.timeout("5 seconds"));
        yield* Deferred.await(secondaryReady).pipe(Effect.timeout("5 seconds"));
        assert.notInclude(primaryOutput, "ENV_SECONDARY");
        assert.notInclude(secondaryOutput, "ENV_PRIMARY");
        yield* secondary.manager.resize({ ...identity, cols: 100, rows: 30 });
        yield* primary.manager.close(identity);
        assert.equal((yield* secondary.manager.list())[0]?.status, "running");
        yield* secondary.manager.write({
          ...identity,
          data: "printf 'SECONDARY_STILL_RUNNING\\n'\n",
        });
        yield* Deferred.await(secondaryAfterClose).pipe(Effect.timeout("5 seconds"));
        yield* secondary.manager.close(identity);
        const reopened = yield* secondary.manager.open({ ...identity, cwd: secondary.cwd });
        assert.include(reopened.history, `ENV_SECONDARY:${secondary.cwd}`);
        const restarted = yield* secondary.manager.restart({
          ...identity,
          cwd: secondary.cwd,
          cols: 100,
          rows: 30,
        });
        assert.notEqual(restarted.pid, reopened.pid);
        assert.equal(restarted.history, "");
        yield* secondary.manager.close(identity);
        assert.notEqual((yield* secondary.manager.list())[0]?.status, "running");
      }),
  );
});
