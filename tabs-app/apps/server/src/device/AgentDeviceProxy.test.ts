// @effect-diagnostics nodeBuiltinImport:off - test daemon bound to an ephemeral loopback port.
import { createServer } from "node:http";
import { expect, it } from "@effect/vitest";
import {
  AuthSessionId,
  DeviceComparisonError,
  ProviderInstanceId,
  ThreadId,
  type DeviceComparisonStatus,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as ServerSettings from "../serverSettings.ts";
import { startAgentDeviceProxy } from "./AgentDeviceProxy.ts";
import type { DeviceHost } from "./DeviceHost.ts";
import { makeWithHosts } from "./DeviceService.ts";
import type { DeviceReturnReceipt } from "./AgentDeviceControl.ts";

it.effect(
  "guards the pinned CLI dialect, isolates hosts and hands control back after an in-flight call",
  () =>
    Effect.gen(function* () {
      const calls: { host: string; authorization: string | undefined; payload: any }[] = [];
      let finishTap: (() => void) | undefined;
      let privateScreen = false;
      let privateAfterCapture = false;
      let refsGeneration = 0;
      const approvedApp = "com.example.checkout";
      let appA = approvedApp;
      let labelA = "Continue";
      const daemon = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const server = createServer((request, response) => {
            void (async () => {
              const host = /^\/(a|b)\//.exec(request.url ?? "")?.[1] ?? "";
              if (request.url?.endsWith("/upload")) {
                for await (const _chunk of request) {
                  // Consume the streaming body before confirming upload.
                }
                response.end(JSON.stringify({ ok: true, uploadId: `binary-${host}` }));
                return;
              }
              if (request.url?.endsWith("/artifacts/shot")) {
                response.end(`image-${host}`);
                return;
              }
              const chunks: Buffer[] = [];
              for await (const chunk of request) chunks.push(chunk);
              const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              const authorization = request.headers.authorization;
              calls.push({ host, authorization, payload });
              if (payload.params.command === "click") {
                await new Promise<void>((resolve) => {
                  finishTap = resolve;
                });
              }
              let data: object = { sensitiveDebug: "private log line" };
              if (payload.params.command === "screenshot") {
                data = {
                  path: "/tmp/screenshot.png",
                  artifacts: [
                    { field: "path", artifactId: privateAfterCapture ? "private-shot" : "shot" },
                  ],
                };
                if (privateAfterCapture) privateScreen = true;
              }
              if (payload.params.command === "snapshot") {
                refsGeneration += 1;
                data = {
                  refsGeneration,
                  appBundleId: host === "a" ? appA : approvedApp,
                  nodes: privateScreen
                    ? [
                        {
                          index: 3,
                          ref: "@e3",
                          editable: true,
                          password: true,
                          label: "Password",
                          value: "login-secret",
                        },
                      ]
                    : [
                        {
                          index: 3,
                          ref: "@e3",
                          role: "button",
                          label: host === "a" ? labelA : "Continue",
                          value: "unneeded-node-value",
                        },
                      ],
                };
              }
              response.end(
                JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { ok: true, data } }),
              );
            })().catch(() => response.destroy());
          });
          await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
          return server;
        }),
        (server) =>
          Effect.sync(() => {
            server.close();
            server.closeAllConnections();
            finishTap?.();
          }),
      );
      const address = daemon.address();
      if (!address || typeof address === "string") throw new Error("Missing test daemon port");
      const host = (hostId: string): DeviceHost["Service"] => {
        const ready = {
          nodePath: process.execPath,
          hub: { origin: `http://${hostId}.device.test` },
          agentDevice: {
            baseUrl: `http://127.0.0.1:${address.port}/${hostId}`,
            token: `upstream-${hostId}`,
            entryPath: "/entry",
          },
          run: () => Effect.succeed({ stdout: "", stderr: "", code: 0 }),
          helpers: { serveSimAxSettings: null, serveSimCli: null },
        };
        return {
          id: hostId,
          summary: Effect.succeed({
            id: hostId,
            label: hostId,
            kind: "ssh",
            hubInstalled: true,
            agentDeviceInstalled: true,
            platforms: [{ platform: "android", available: true }],
          }),
          platformAvailability: (platform) => Effect.succeed({ platform, available: true }),
          ensureReady: () => Effect.succeed(ready),
          ensureAgentReady: () => Effect.succeed(ready),
          current: Effect.succeed(ready),
          stopAgent: Effect.void,
          stop: Effect.void,
        };
      };

      const scope = yield* Effect.scope;
      let origin = "";
      const tokens = new Map<string, string>();
      const active = new Set(["provider-a", "provider-b"]);
      const service = yield* makeWithHosts(
        new Map([
          ["a", host("a")],
          ["b", host("b")],
        ]),
        undefined,
        {
          providerActive: (caller) => active.has(caller.providerSessionId),
          configForGrant: (grant, proxy) =>
            Effect.gen(function* () {
              if (!origin) {
                origin = (yield* startAgentDeviceProxy(proxy).pipe(
                  Effect.provideService(Scope.Scope, scope),
                  Effect.orDie,
                )).origin;
              }
              tokens.set(grant.id, grant.token);
              return { command: "/agent-device", configPath: grant.id };
            }),
        },
      ).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                request.url.includes("/api/screenshot")
                  ? new Response("test MCP screenshot")
                  : Response.json({
                      simulators: [],
                      emulators: [
                        {
                          id: "emulator-5554",
                          name: "Pixel",
                          version: "36",
                          platform: "android",
                          booted: true,
                          physical: false,
                        },
                      ],
                    }),
              ),
            ),
          ),
        ),
      );

      yield* service.list;
      const caller = (name: string) => ({
        threadId: ThreadId.make(name),
        providerInstanceId: ProviderInstanceId.make("codex"),
        providerSessionId: `provider-${name}`,
      });
      const target = (hostId: string) => ({ hostId, deviceId: "emulator-5554" });
      const open = (name: string, hostId: string) =>
        service.open({
          ...target(hostId),
          platform: "android",
          threadId: caller(name).threadId,
        });
      const a = yield* open("a", "a");
      const bOnA = yield* open("b", "a");
      const b = yield* open("b", "b");
      const agentTarget = (attachment: typeof a, name: string) =>
        service
          .agentTarget(attachment, caller(name), "/entry")
          .pipe(
            Effect.map(({ configPath, session }) => ["--config", configPath, "--session", session]),
          );
      const argsA = yield* agentTarget(a, "a");
      expect(yield* agentTarget(bOnA, "b").pipe(Effect.flip)).toBeDefined();
      const argsB = yield* agentTarget(b, "b");
      expect(argsA[3]).not.toBe(argsB[3]);
      expect(tokens.get(argsA[1]!)).not.toBe("upstream-a");

      const send = (
        args: ReadonlyArray<string>,
        command: string,
        options?: {
          session?: string;
          serial?: string;
          meta?: Record<string, unknown>;
          positionals?: string[];
        },
      ) =>
        fetch(`${origin}/rpc`, {
          method: "POST",
          headers: { authorization: `Bearer ${tokens.get(args[1]!)}` },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: command,
            method: "agent_device.command",
            params: {
              session: options?.session ?? args[3],
              command,
              positionals: options?.positionals ?? (command === "click" ? ["@e3"] : []),
              flags: {
                platform: "android",
                serial: options?.serial ?? a.deviceId,
                daemonBaseUrl: origin,
              },
              meta: { ...options?.meta, tenantId: "injected" },
              token: "client-token",
            },
          }),
        }).then((response) => response.json() as Promise<any>);
      yield* Effect.promise(async () => {
        expect((await send(argsA, "snapshot", { serial: "other" })).result.ok).toBe(false);
        expect((await send(argsA, "snapshot", { session: argsB[3]! })).result.ok).toBe(false);
        const snapshot = await send(argsA, "snapshot");
        expect(snapshot.result.ok).toBe(true);
        expect(JSON.stringify(snapshot)).not.toContain("unneeded-node-value");
        expect((await send(argsB, "screenshot")).result.ok).toBe(true);
        expect(new Set(calls.map(({ host, authorization }) => `${host}:${authorization}`))).toEqual(
          new Set(["a:Bearer upstream-a", "b:Bearer upstream-b"]),
        );
        expect(calls[1]?.payload.params).toEqual({
          command: "snapshot",
          flags: {
            platform: "android",
            serial: a.deviceId,
            session: argsA[3],
            snapshotForceFull: true,
            noRecord: true,
          },
          positionals: [],
          session: argsA[3],
          meta: {
            sessionExplicit: true,
            lockPlatform: "android",
            lockPolicy: "reject",
            responseLevel: "full",
          },
        });
        const auth = (args: ReadonlyArray<string>) => ({
          authorization: `Bearer ${tokens.get(args[1]!)}`,
        });
        expect((await fetch(`${origin}/artifacts/shot`, { headers: auth(argsA) })).status).toBe(
          404,
        );
        expect(
          await fetch(`${origin}/artifacts/shot`, { headers: auth(argsB) }).then((res) =>
            res.text(),
          ),
        ).toBe("image-b");
        expect(
          (await fetch(`${origin}/upload/preflight`, { method: "POST", headers: auth(argsB) }))
            .status,
        ).toBe(404);
        expect(
          await fetch(`${origin}/upload`, {
            method: "POST",
            headers: auth(argsB),
            body: "APK",
          }).then((res) => res.json()),
        ).toEqual({
          ok: true,
          uploadId: "binary-b",
        });
        expect(
          (await send(argsA, "install", { meta: { uploadedArtifactId: "binary-b" } })).result.ok,
        ).toBe(false);
        expect(
          (await send(argsB, "install", { meta: { uploadedArtifactId: "binary-b" } })).result.ok,
        ).toBe(true);

        for (const verb of ["clipboard", "logs", "network", "record", "trace", "get"]) {
          expect((await send(argsA, verb)).result.ok).toBe(false);
        }
        expect(calls.some(({ payload }) => payload.params.command === "clipboard")).toBe(false);
        privateScreen = true;
        const blocked = await send(argsA, "snapshot");
        expect(blocked.result.error.message).toContain("private input");
        expect(JSON.stringify(blocked)).not.toContain("login-secret");
        expect((await send(argsA, "fill")).result.ok).toBe(false);
        expect((await send(argsA, "screenshot")).result.ok).toBe(false);
        expect(calls.some(({ payload }) => payload.params.command === "fill")).toBe(false);
        privateScreen = false;
        privateAfterCapture = true;
        expect((await send(argsB, "screenshot")).result.ok).toBe(false);
        expect(
          (await fetch(`${origin}/artifacts/private-shot`, { headers: auth(argsB) })).status,
        ).toBe(404);
        privateAfterCapture = false;
        privateScreen = false;
      });
      const capture = service.agentScreenshot(a, caller("a"));
      expect(Buffer.from((yield* capture).png).toString()).toBe("test MCP screenshot");
      privateScreen = true;
      expect((yield* capture.pipe(Effect.flip)).message).toContain("private input");
      privateScreen = false;

      const readStatus = service.comparison({
        action: "status",
        threadId: b.threadId,
        device: target("a"),
      });
      expect((yield* readStatus).agentControl).toMatchObject({
        id: argsA[1],
        threadId: a.threadId,
        phase: "agent",
      });
      expect(yield* service.streamInputAllowed(a.hostId, a.deviceId)).toBe(false);
      const tap = send(argsA, "click");
      yield* Effect.promise(() => expect.poll(() => finishTap).toBeTypeOf("function"));
      const takeControl = (
        action: "takeoverAgentControl" | "stopAgentControl" | "allowAgentControl",
        controlId = argsA[1]!,
      ) => service.comparison({ action, device: target("a"), threadId: b.threadId, controlId });
      expect((yield* takeControl("takeoverAgentControl")).agentControl?.phase).toBe("stopping");
      expect(yield* service.streamInputAllowed(a.hostId, a.deviceId)).toBe(false);
      expect((yield* Effect.promise(() => send(argsA, "snapshot"))).result.ok).toBe(false);
      finishTap!();
      const tapResult = yield* Effect.promise(() => tap);
      expect(tapResult.result.ok).toBe(true);
      expect(JSON.stringify(tapResult)).not.toContain("private log line");
      expect(
        calls.find(({ payload }) => payload.params.command === "click")?.payload.params
          .positionals[0],
      ).toMatch(/^@e3~s\d+$/);
      yield* Effect.promise(() =>
        expect
          .poll((): Promise<DeviceComparisonStatus> => Effect.runPromise(readStatus))
          .toMatchObject({
            agentControl: { phase: "manual", threadId: b.threadId },
          }),
      );
      expect(calls.at(-1)?.payload.params.command).toBe("close");
      expect(yield* service.streamInputAllowed(a.hostId, a.deviceId)).toBe(true);
      expect(yield* agentTarget(a, "a").pipe(Effect.flip)).toBeDefined();
      yield* takeControl("allowAgentControl");
      const nextA = yield* agentTarget(a, "a");
      expect(nextA[3]).not.toBe(argsA[3]);
      expect((yield* takeControl("stopAgentControl", nextA[1])).agentControl?.phase).toBe(
        "stopped",
      );
      expect((yield* Effect.promise(() => send(nextA, "snapshot"))).result.ok).toBe(false);
      expect(yield* agentTarget(a, "a").pipe(Effect.flip)).toBeDefined();
      yield* takeControl("allowAgentControl", nextA[1]);
      const afterStop = yield* agentTarget(a, "a");
      yield* service.close(a);
      const reopenedA = yield* open("a", "a");
      expect((yield* Effect.promise(() => send(afterStop, "snapshot"))).result.ok).toBe(false);
      const callsBeforeRevocation = calls.filter(
        ({ payload }) => payload.params.command !== "close",
      ).length;
      active.delete("provider-b");
      expect((yield* Effect.promise(() => send(argsB, "snapshot"))).result.ok).toBe(false);
      expect(calls.filter(({ payload }) => payload.params.command !== "close")).toHaveLength(
        callsBeforeRevocation,
      );
      const noApproval = service.agentTarget(reopenedA, caller("a"), "/entry", {});
      expect(yield* noApproval.pipe(Effect.flip)).toBeDefined();
      const sessionId = AuthSessionId.make("session-a");
      const requested = {
        action: "requestDeviceApp" as const,
        device: target("a"),
        threadId: a.threadId,
        appId: approvedApp,
      };
      const proposed = (yield* service.comparison(requested, undefined, caller("a")))
        .pendingAppApproval!;
      const approvedAccess = { appId: approvedApp, approvalId: proposed.id };
      const approve = {
        action: "approveDeviceApp" as const,
        device: target("a"),
        threadId: a.threadId,
        approvalId: proposed.id,
      };
      const proposedLauncher = service.agentTarget(
        reopenedA,
        caller("a"),
        "/entry",
        approvedAccess,
      );
      expect(yield* proposedLauncher.pipe(Effect.flip)).toBeDefined();
      expect(
        yield* service.comparison(approve, sessionId, caller("a")).pipe(Effect.flip),
      ).toBeDefined();
      expect(
        yield* service
          .comparison({ ...approve, threadId: b.threadId }, sessionId)
          .pipe(Effect.flip),
      ).toBeDefined();
      const commandsBeforeApproval = calls.filter(
        ({ payload }) => payload.params.command !== "close",
      ).length;
      expect((yield* service.comparison(approve, sessionId)).approvedApp).toEqual(proposed);
      expect(calls.filter(({ payload }) => payload.params.command !== "close")).toHaveLength(
        commandsBeforeApproval,
      );
      active.add("provider-other");
      expect(
        yield* service
          .agentTarget(
            reopenedA,
            { ...caller("a"), providerSessionId: "provider-other" },
            "/entry",
            approvedAccess,
          )
          .pipe(Effect.flip),
      ).toBeDefined();
      expect(
        yield* service
          .agentTarget(reopenedA, caller("a"), "/entry", {
            ...approvedAccess,
            appId: "com.example.other",
          })
          .pipe(Effect.flip),
      ).toBeDefined();
      const launcher = yield* proposedLauncher;
      expect(launcher.approvedAppId).toBe(approvedApp);
      const afterReopen = ["--config", launcher.configPath, "--session", launcher.session];
      expect((yield* Effect.promise(() => send(afterReopen, "snapshot"))).result.ok).toBe(false);
      expect(
        (yield* Effect.promise(() =>
          send(afterReopen, "open", { positionals: ["com.example.other"] }),
        )).result.ok,
      ).toBe(false);
      expect(
        (yield* Effect.promise(() =>
          send(afterReopen, "open", { positionals: [approvedApp, "https://other.example"] }),
        )).result.ok,
      ).toBe(false);
      expect(
        (yield* Effect.promise(() => send(afterReopen, "open", { positionals: [approvedApp] })))
          .result.ok,
      ).toBe(true);
      expect(
        (yield* Effect.promise(() => send(afterReopen, "open", { positionals: [approvedApp] })))
          .result.ok,
      ).toBe(false);
      expect((yield* Effect.promise(() => send(afterReopen, "snapshot"))).result.ok).toBe(true);
      const returnStatus = service.comparison(
        { action: "status", device: target("a"), threadId: reopenedA.threadId },
        sessionId,
      );
      finishTap = undefined;
      const finalTap = send(afterReopen, "click");
      yield* Effect.promise(() => expect.poll(() => finishTap).toBeTypeOf("function"));
      expect(
        (yield* service.comparison(
          {
            action: "takeoverAgentControl",
            device: target("a"),
            threadId: reopenedA.threadId,
            controlId: afterReopen[1]!,
          },
          sessionId,
        )).agentControl?.phase,
      ).toBe("stopping");
      expect(yield* service.streamInputAllowed("a", reopenedA.deviceId)).toBe(false);
      expect((yield* Effect.promise(() => send(afterReopen, "click"))).result.ok).toBe(false);
      finishTap!();
      yield* Effect.promise(() => finalTap);
      yield* Effect.promise(() =>
        expect
          .poll(() => Effect.runPromise(returnStatus))
          .toMatchObject({
            agentControl: { phase: "manual", returnToApp: { appId: approvedApp } },
          }),
      );
      expect(yield* service.streamInputAllowed("a", reopenedA.deviceId)).toBe(true);
      expect(yield* agentTarget(bOnA, "b").pipe(Effect.flip)).toBeDefined();

      const receipts: DeviceReturnReceipt[] = [];
      const callback = (receipt: DeviceReturnReceipt) =>
        Effect.sync(() => {
          receipts.push(receipt);
        });
      const returnControl = {
        action: "returnAgentControl" as const,
        device: target("a"),
        threadId: reopenedA.threadId,
        controlId: afterReopen[1]!,
        appId: approvedApp,
        meaning: "I cleared the delivery notice.",
      };
      expect(
        yield* service
          .comparison(returnControl, AuthSessionId.make("other-session"), undefined, callback)
          .pipe(Effect.flip),
      ).toBeInstanceOf(DeviceComparisonError);
      appA = "com.example.other";
      expect(
        yield* service.comparison(returnControl, sessionId, undefined, callback).pipe(Effect.flip),
      ).toBeInstanceOf(DeviceComparisonError);
      expect(receipts).toHaveLength(0);
      appA = approvedApp;
      labelA = "Review delivery";
      const lost = (receipt: DeviceReturnReceipt) =>
        callback(receipt).pipe(
          Effect.andThen(Effect.fail(new DeviceComparisonError({ reason: "Reply lost" }))),
        );
      expect(
        yield* service.comparison(returnControl, sessionId, undefined, lost).pipe(Effect.flip),
      ).toBeInstanceOf(DeviceComparisonError);
      expect((yield* returnStatus).agentControl?.pendingReturn?.controlId).toBe(afterReopen[1]);
      yield* service.comparison(
        { ...returnControl, meaning: "Changed request" },
        sessionId,
        undefined,
        callback,
      );
      yield* service.comparison(returnControl, sessionId, undefined, callback);
      expect(receipts).toHaveLength(2);
      expect(receipts[0]).toEqual(receipts[1]);
      expect(receipts[0]).toMatchObject({
        target: target("a"),
        threadId: reopenedA.threadId,
        appId: approvedApp,
        changed: true,
        meaning: returnControl.meaning,
      });
      expect((yield* returnStatus).agentControl?.pendingReturn).toBeUndefined();
      expect((yield* Effect.promise(() => send(afterReopen, "snapshot"))).result.ok).toBe(false);
      const reacquired = yield* service.agentTarget(reopenedA, caller("a"), "/entry", {});
      const resumed = ["--config", reacquired.configPath, "--session", reacquired.session];
      expect(resumed[1]).not.toBe(afterReopen[1]);
      expect(resumed[3]).toBe(afterReopen[3]);
      expect(yield* agentTarget(bOnA, "b").pipe(Effect.flip)).toBeDefined();
      expect((yield* Effect.promise(() => send(resumed, "click"))).result.ok).toBe(false);
      expect((yield* Effect.promise(() => send(resumed, "open"))).result.ok).toBe(false);
      expect((yield* Effect.promise(() => send(resumed, "snapshot"))).result.ok).toBe(true);
      appA = "com.example.other";
      expect((yield* Effect.promise(() => send(resumed, "click"))).result.ok).toBe(false);
      yield* service.configure({ agentAccessEnabled: false });
      expect((yield* Effect.promise(() => send(resumed, "snapshot"))).result.ok).toBe(false);
      expect(yield* service.streamInputAllowed(a.hostId, a.deviceId)).toBe(true);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        ServerSettings.layerTest({ enableDeviceSupport: true, enableAgentDeviceAccess: true }),
      ),
    ),
);
