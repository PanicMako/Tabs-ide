import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { makeClaudeContinuationGroupKey, makeClaudeEnvironment } from "./ClaudeHome.ts";

it.layer(NodeServices.layer)("Claude driver environment audit", (it) => {
  it.effect("driver-equivalent continuation call distinguishes runtime config homes", () =>
    Effect.gen(function* () {
      const config = { homePath: "" };
      const first = { HOME: "/audit-user", CLAUDE_CONFIG_DIR: "/audit/claude-first" };
      const second = { HOME: "/audit-user", CLAUDE_CONFIG_DIR: "/audit/claude-second" };
      const runtimeFirst = yield* makeClaudeEnvironment(config, first);
      const runtimeSecond = yield* makeClaudeEnvironment(config, second);
      expect(runtimeFirst.CLAUDE_CONFIG_DIR).not.toBe(runtimeSecond.CLAUDE_CONFIG_DIR);
      const firstKey = yield* makeClaudeContinuationGroupKey(config);
      const secondKey = yield* makeClaudeContinuationGroupKey(config);
      expect(firstKey).not.toBe(secondKey);
    }),
  );
  it.effect("passing runtime environments produces distinct continuation keys", () =>
    Effect.gen(function* () {
      const config = { homePath: "" };
      const first = yield* makeClaudeContinuationGroupKey(config, {
        CLAUDE_CONFIG_DIR: "/audit/claude-first",
      });
      const second = yield* makeClaudeContinuationGroupKey(config, {
        CLAUDE_CONFIG_DIR: "/audit/claude-second",
      });
      expect(first).toBe("claude:home:/audit/claude-first");
      expect(second).toBe("claude:home:/audit/claude-second");
    }),
  );
});
