import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { assert, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@tabs/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { createServer } from "node:http";

import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
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
        const approvalComplete = yield* Deferred.make<void>();
        let primaryOutput = "";
        let secondaryOutput = "";
        const primaryOutputInstances = new Set<string | undefined>();
        const secondaryOutputInstances = new Set<string | undefined>();
        const unsubscribePrimary = yield* primary.manager.subscribe((event) =>
          Effect.gen(function* () {
            if (event.type !== "output") return;
            primaryOutputInstances.add(event.instanceId);
            primaryOutput += event.data;
            if (primaryOutput.includes(`ENV_PRIMARY:${primary.cwd}`))
              yield* Deferred.succeed(primaryReady, undefined);
          }),
        );
        const unsubscribeSecondary = yield* secondary.manager.subscribe((event) =>
          Effect.gen(function* () {
            if (event.type !== "output") return;
            secondaryOutputInstances.add(event.instanceId);
            secondaryOutput += event.data;
            if (secondaryOutput.includes(`ENV_SECONDARY:${secondary.cwd}`))
              yield* Deferred.succeed(secondaryReady, undefined);
            if (/(?:^|[\r\n])SECONDARY_STILL_RUNNING(?:[\r\n]|$)/.test(secondaryOutput))
              yield* Deferred.succeed(secondaryAfterClose, undefined);
            if (/(?:^|[\r\n])PTY_APPROVAL_COMPLETE(?:[\r\n]|$)/.test(secondaryOutput))
              yield* Deferred.succeed(approvalComplete, undefined);
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
        assert.isString(a.instanceId);
        assert.isString(b.instanceId);
        assert.notEqual(a.instanceId, b.instanceId);
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
        assert.deepEqual([...primaryOutputInstances], [a.instanceId]);
        assert.deepEqual([...secondaryOutputInstances], [b.instanceId]);

        const endpoint = yield* Layer.build(
          NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: 0 }),
        );
        yield* Layer.build(
          McpSessionRegistry.layer.pipe(
            Layer.provide(
              Layer.succeed(ServerEnvironment, {
                getEnvironmentId: Effect.succeed(EnvironmentId.make("disposable-secondary-pty")),
                getDescriptor: Effect.die("unused"),
              }),
            ),
          ),
        ).pipe(Effect.provide(endpoint));
        const credential = yield* McpSessionRegistry.issueActiveMcpCredential({
          threadId: ThreadId.make(identity.threadId),
          providerInstanceId: ProviderInstanceId.make("codex"),
        });
        assert.isDefined(credential);
        const scope = yield* McpSessionRegistry.resolveActiveMcpCredential(
          credential!.config.authorizationHeader.slice("Bearer ".length),
        );
        assert.isDefined(scope);
        const text = "printf 'approved\\n' >> reviewed-marker; printf 'PTY_APPROVAL_COMPLETE\\n'";
        const proposal = yield* secondary.manager.proposeAgentInput(scope!.thread, {
          terminalId: identity.terminalId,
          instanceId: b.instanceId!,
          text,
          pressEnter: true,
        });
        assert.equal(proposal.status, "pending");
        const review = { threadId: identity.threadId, requestId: proposal.requestId };
        const sibling = yield* Effect.flip(
          primary.manager.reviewAgentInput({ ...review, action: "approve" }),
        );
        assert.equal(sibling._tag, "TerminalAgentInputReviewUnavailableError");
        const pending = yield* secondary.manager.reviewAgentInput({ ...review, action: "review" });
        assert.equal(pending.text, text);
        assert.equal(pending.instanceId, b.instanceId);
        assert.isFalse(yield* fs.exists(`${secondary.cwd}/reviewed-marker`));
        const approved = yield* secondary.manager.reviewAgentInput({
          ...review,
          action: "approve",
        });
        assert.equal(approved.status, "delivered");
        assert.notProperty(approved, "text");
        const retried = yield* secondary.manager.reviewAgentInput({ ...review, action: "approve" });
        assert.deepEqual(retried, approved);
        yield* Deferred.await(approvalComplete).pipe(Effect.timeout("5 seconds"));
        assert.equal(yield* fs.readFileString(`${secondary.cwd}/reviewed-marker`), "approved\n");
        assert.isFalse(yield* fs.exists(`${primary.cwd}/reviewed-marker`));

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
        assert.isString(restarted.instanceId);
        assert.notEqual(restarted.instanceId, reopened.instanceId);
        assert.equal(restarted.history, "");
        yield* secondary.manager.close(identity);
        assert.notEqual((yield* secondary.manager.list())[0]?.status, "running");
      }),
  );
});
