import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import {
  makeClaudeCapabilitiesCacheKey,
  makeClaudeContinuationGroupKey,
  makeClaudeEnvironment,
  resolveClaudeHomePath,
} from "./ClaudeHome";

it.layer(NodeServices.layer)("ClaudeHome", (it) => {
  describe("Claude home resolution", () => {
    it.effect("uses the default Claude config directory when no override is configured", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(NodeOS.homedir(), ".claude");

        expect(yield* resolveClaudeHomePath({ homePath: "" })).toBe(resolved);
        expect((yield* makeClaudeEnvironment({ homePath: "" })) === process.env).toBe(true);
      }),
    );

    it.effect("isolates configured Claude data without changing HOME", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const homePath = "~/.claude-work";
        const resolved = path.resolve(NodeOS.homedir(), ".claude-work");

        expect(yield* resolveClaudeHomePath({ homePath })).toBe(resolved);
        const environment = yield* makeClaudeEnvironment({ homePath });
        expect(environment.CLAUDE_CONFIG_DIR).toBe(resolved);
        expect(environment.HOME).toBe(process.env.HOME);
        expect(yield* makeClaudeContinuationGroupKey({ homePath })).toBe(`claude:home:${resolved}`);
        expect(yield* makeClaudeCapabilitiesCacheKey({ binaryPath: "claude", homePath })).toBe(
          `claude\0${resolved}\0`,
        );
      }),
    );

    it.effect(
      "keeps continuation compatible across instances with the same Claude config directory",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const resolved = path.resolve(NodeOS.homedir(), ".claude");

          expect(yield* makeClaudeContinuationGroupKey({ homePath: "" })).toBe(
            `claude:home:${resolved}`,
          );
        }),
    );
  });
});
