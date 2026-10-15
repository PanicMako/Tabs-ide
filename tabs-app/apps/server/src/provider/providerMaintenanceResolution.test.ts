import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import { resolveProviderMaintenanceCapabilitiesEffect } from "./providerMaintenance.ts";
it.effect("does not offer an npm updater when a configured command cannot be resolved", () =>
  Effect.gen(function* () {
    const result = yield* resolveProviderMaintenanceCapabilitiesEffect(
      {
        resolve: () => ({
          provider: ProviderDriverKind.make("codex"),
          packageName: "@openai/codex",
          update: {
            command: "npm install -g @openai/codex",
            executable: "npm",
            args: ["install", "-g", "@openai/codex"],
            lockKey: "npm-global",
          },
        }),
      },
      { binaryPath: "tabs-no-such-provider-compat-test", env: { PATH: "" } },
    );
    expect(result.update).toBeNull();
    expect(result.packageName).toBe("@openai/codex");
  }).pipe(Effect.provide(NodeServices.layer)),
);
