import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import type { ComputerRequest } from "../../../computerUse/commands.ts";
import * as ComputerUse from "../../../computerUse/ComputerUseService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ComputerHandlers from "./handlers.ts";
import { ComputerToolkit } from "./tools.ts";

const call = <A>(
  options: {
    enabled: boolean;
    ceiling: "full-access" | "approval-required";
    external?: boolean;
    execute?: ComputerUse.ComputerUse["Service"]["execute"];
    permissions?: ComputerUse.ComputerUse["Service"]["permissions"];
  },
  use: (
    handle: (name: string, input: unknown) => Effect.Effect<unknown>,
    seen: ComputerRequest[],
  ) => Effect.Effect<A, any>,
) =>
  Effect.gen(function* () {
    const seen: ComputerRequest[] = [];
    const threadId = ThreadId.make("thread-1");
    const providerInstanceId = ProviderInstanceId.make("codex-test");
    const fake = ComputerUse.ComputerUse.of({
      control: () => Effect.die("unused"),
      grant: () => undefined,
      revokeAll: Effect.void,
      revokeThread: () => Effect.void,
      execute:
        options.execute ??
        ((request) => {
          seen.push(request);
          return Effect.succeed({ tree: "1 Window", treeIsDiff: false });
        }),
      wait: () => Effect.succeed({ tree: "1 Window", treeIsDiff: false }),
      permissions:
        options.permissions ??
        Effect.succeed({
          platformSupported: true,
          runtimeAvailable: true,
          accessibility: true,
          screenRecording: "granted" as const,
        }),
      screenshot: () => Effect.die("unused"),
    });
    const layer = yield* Layer.build(
      Layer.mergeAll(
        Settings.layerTest({ computerUseEnabled: options.enabled }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () =>
            Effect.succeed({
              id: threadId,
              archivedAt: null,
              deletedAt: null,
              activeRunId: "run-1",
              runtimeMode: options.ceiling,
              interactionMode: "default",
              providerInstanceId,
            } as never),
        }),
        Layer.succeed(ComputerUse.ComputerUse, fake),
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("environment"),
          requestNamespace: "session",
          thread: options.external
            ? undefined
            : { threadId, providerInstanceId, providerSessionId: "ps-test" },
          client: {
            runtimeModeCeiling: options.ceiling,
            sessionId: "client-1",
          } as McpInvocationContext.McpClientCaller,
          issuedAt: 0,
          capabilities: new Set(["orchestration" as const]),
        }),
      ),
    );
    const toolkit = yield* ComputerToolkit.pipe(
      Effect.provide(ComputerHandlers.layer),
      Effect.provide(Layer.succeedContext(layer)),
    );
    const handle = (name: string, input: unknown) =>
      (toolkit.handle as any)(name, input).pipe(
        Stream.unwrap,
        Stream.runCollect,
        Effect.map((parts: ReadonlyArray<{ result: unknown }>) => parts.at(-1)?.result),
        Effect.provide(Layer.succeedContext(layer)),
      ) as Effect.Effect<unknown>;
    return yield* use(handle, seen);
  }).pipe(Effect.scoped);

it.effect("refuses every desktop action while the Labs switch is off", () =>
  call({ enabled: false, ceiling: "full-access" }, (handle, seen) =>
    Effect.gen(function* () {
      for (const [name, input] of [
        ["computer_list_apps", {}],
        ["computer_snapshot", { app: "Notes" }],
        ["computer_click", { app: "Notes", observationId: "current", elementIndex: 1 }],
        ["computer_type", { app: "Notes", observationId: "current", text: "hi" }],
        ["computer_key", { app: "Notes", observationId: "current", key: "Return" }],
        [
          "computer_scroll",
          { app: "Notes", observationId: "current", direction: "down", elementIndex: 1 },
        ],
        ["computer_focus_app", { app: "Notes" }],
        ["computer_screenshot", { app: "Notes", observationId: "current" }],
        ["computer_right_click", { app: "Notes", observationId: "current", elementIndex: 1 }],
        [
          "computer_drag",
          { app: "Notes", observationId: "current", fromElementIndex: 1, toElementIndex: 2 },
        ],
        [
          "computer_set_value",
          { app: "Notes", observationId: "current", elementIndex: 1, value: "x" },
        ],
        [
          "computer_secondary_action",
          { app: "Notes", observationId: "current", elementIndex: 1, action: "AXShowMenu" },
        ],
        ["computer_wait", { app: "Notes", observationId: "current", text: "Saved" }],
      ] as const) {
        const refusal: any = yield* handle(name, input);
        expect(refusal).toMatchObject({ code: "capability_denied" });
        expect(refusal.message).toContain("Settings > Labs > Computer use");
      }
      expect(seen).toEqual([]);
    }),
  ),
);

it.effect("denies external clients even with full access", () =>
  call({ enabled: true, ceiling: "full-access", external: true }, (handle, seen) =>
    Effect.gen(function* () {
      const refusal: any = yield* handle("computer_click", {
        app: "Notes",
        observationId: "current",
        elementIndex: 1,
      });
      expect(refusal).toMatchObject({ code: "capability_denied" });
      expect(seen).toEqual([]);
    }),
  ),
);

it.effect("runs a validated native-window request for a normal approval-required thread", () =>
  call({ enabled: true, ceiling: "approval-required" }, (handle, seen) =>
    Effect.gen(function* () {
      const result: any = yield* handle("computer_click", {
        app: "window:approved",
        observationId: "current",
        elementIndex: 3,
      });
      expect(result.tree).toBe("1 Window");
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        op: "click",
        app: { kind: "attachment", selector: "window:approved" },
        target: { kind: "element", index: 3 },
      });
    }),
  ),
);

it.effect("rejects bad arguments and blocked shortcuts before touching the desktop", () =>
  call({ enabled: true, ceiling: "full-access" }, (handle, seen) =>
    Effect.gen(function* () {
      const both: any = yield* handle("computer_click", {
        app: "Notes",
        observationId: "current",
        elementIndex: 1,
        x: 1,
        y: 2,
      });
      expect(both).toMatchObject({ code: "invalid_request" });
      const quitKey =
        process.platform === "darwin"
          ? "Cmd+Q"
          : process.platform === "win32"
            ? "Alt+F4"
            : "Ctrl+Q";
      const quitEffect = process.platform === "win32" ? "close the app" : "quit the app";
      const quit: any = yield* handle("computer_key", {
        app: "Notes",
        observationId: "current",
        key: quitKey,
      });
      expect(quit).toMatchObject({ code: "invalid_request" });
      expect(quit.message).toContain(quitEffect);
      expect(seen).toEqual([]);
    }),
  ),
);

it.effect("reports a refused secret field as a denial", () =>
  call(
    {
      enabled: true,
      ceiling: "full-access",
      execute: () =>
        Effect.fail(
          new ComputerUse.ComputerUseError({
            code: "sensitive_field",
            message: "Refusing to type.",
          }),
        ),
    },
    (handle) =>
      Effect.gen(function* () {
        const refusal: any = yield* handle("computer_type", {
          app: "window:approved",
          observationId: "current",
          text: "hunter2",
        });
        expect(refusal).toMatchObject({ code: "capability_denied", message: "Refusing to type." });
      }),
  ),
);

it.effect("does not install the Windows runtime while the Labs switch is off", () => {
  let checkedPermissions = false;
  return call(
    {
      enabled: false,
      ceiling: "approval-required",
      permissions: Effect.sync(() => {
        checkedPermissions = true;
        return {
          platformSupported: true,
          runtimeAvailable: true,
          accessibility: true,
          screenRecording: "granted" as const,
        };
      }),
    },
    (handle) =>
      Effect.gen(function* () {
        const status: any = yield* handle("computer_permissions", {});
        expect(status).toMatchObject({
          enabled: false,
          runtimeAvailable: false,
          accessibility: false,
        });
        expect(status.guidance).toContain("Computer use");
        expect(checkedPermissions).toBe(false);
      }),
  );
});

it.effect("refuses app names and PIDs before invoking the desktop", () =>
  call({ enabled: true, ceiling: "full-access" }, (handle, seen) =>
    Effect.gen(function* () {
      expect(yield* handle("computer_snapshot", { app: "pid:7" })).toMatchObject({
        code: "capability_denied",
      });
      expect(yield* handle("computer_list_apps", {})).toMatchObject({
        tree: expect.stringContaining("Ask the user"),
      });
      expect(seen).toEqual([]);
    }),
  ),
);
