import { expect, it } from "@effect/vitest";
import { EMPTY_USER_THEME, EnvironmentId } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThemeHandlers from "./handlers.ts";
import { ThemeToolkit } from "./tools.ts";

const dependencies = (runtimeModeCeiling: "full-access" | "approval-required") =>
  Layer.mergeAll(
    Settings.layerTest(),
    Layer.mock(ThreadManagement.ThreadManagementService)({}),
    Layer.mock(ThreadCommandExecutor.ThreadCommandExecutor)({}),
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("environment"),
      requestNamespace: "session",
      thread: undefined,
      client: { runtimeModeCeiling } as McpInvocationContext.McpClientCaller,
      issuedAt: 0,
      capabilities: new Set(["orchestration" as const]),
    }),
  );

const call = <A>(
  ceiling: "full-access" | "approval-required",
  use: (handle: (name: string, input: unknown) => Effect.Effect<unknown>) => Effect.Effect<A, any>,
) =>
  Effect.gen(function* () {
    // Built once so the handlers and the test share one settings store.
    const layer = yield* Layer.build(dependencies(ceiling));
    const toolkit = yield* ThemeToolkit.pipe(
      Effect.provide(ThemeHandlers.layer),
      Effect.provide(Layer.succeedContext(layer)),
    );
    const handle = (name: string, input: unknown) =>
      (toolkit.handle as any)(name, input).pipe(
        Stream.unwrap,
        Stream.runCollect,
        Effect.map((parts: ReadonlyArray<{ result: unknown }>) => parts.at(-1)?.result),
        Effect.provide(Layer.succeedContext(layer)),
      ) as Effect.Effect<unknown>;
    return yield* use(handle);
  }).pipe(Effect.scoped);

it.effect("reads an empty theme with the guide", () =>
  call("approval-required", (handle) =>
    Effect.gen(function* () {
      const result: any = yield* handle("t3_theme_read", {});
      expect(result.theme).toEqual(EMPTY_USER_THEME);
      expect(result.guide).toContain("t3_theme_set");
      expect(result.guide).toContain("background");
    }),
  ),
);

it.effect("sets colors and css, then resets", () =>
  call("full-access", (handle) =>
    Effect.gen(function* () {
      const set: any = yield* handle("t3_theme_set", {
        colors: { background: "#112233" },
        css: ".chat-markdown{line-height:1.8}",
      });
      expect(set.theme.colors).toEqual({ background: "#112233" });
      expect(set.theme.updatedAt).not.toBe("");
      const read: any = yield* handle("t3_theme_read", {});
      expect(read.theme.css).toBe(".chat-markdown{line-height:1.8}");

      const cleared: any = yield* handle("t3_theme_set", { reset: true });
      expect(cleared.theme.colors).toEqual({});
      expect(cleared.theme.css).toBe("");
    }),
  ),
);

it.effect("refuses CSS that loads files and keeps the old theme", () =>
  call("full-access", (handle) =>
    Effect.gen(function* () {
      yield* handle("t3_theme_set", { css: "a{color:red}" });
      const refusal: any = yield* handle("t3_theme_set", {
        css: "@import url(https://x.test/a.css);",
      });
      expect(refusal).toMatchObject({ code: "invalid_request" });
      const read: any = yield* handle("t3_theme_read", {});
      expect(read.theme.css).toBe("a{color:red}");
    }),
  ),
);

it.effect("refuses unknown roles and non-hex values", () =>
  call("full-access", (handle) =>
    Effect.gen(function* () {
      const role: any = yield* handle("t3_theme_set", { colors: { nope: "#000000" } });
      expect(role).toMatchObject({ code: "invalid_request" });
      const value: any = yield* handle("t3_theme_set", { dark: { background: "red; x" } });
      expect(value).toMatchObject({ code: "invalid_request" });
    }),
  ),
);

it.effect("refuses writes without full access", () =>
  call("approval-required", (handle) =>
    Effect.gen(function* () {
      const refusal: any = yield* handle("t3_theme_set", { colors: { background: "#000000" } });
      expect(refusal).toMatchObject({ code: "capability_denied" });
    }),
  ),
);
