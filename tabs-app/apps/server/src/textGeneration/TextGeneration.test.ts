import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { describe, expect } from "vitest";

import { ProviderInstanceId } from "@tabs/contracts";
import { createModelSelection } from "@tabs/shared/model";

import type { ProviderInstance } from "../provider/ProviderDriver";
import type { ProviderInstanceRegistryShape } from "../provider/Services/ProviderInstanceRegistry";
import type { TextGenerationShape } from "./TextGeneration";

import { makeTextGenerationFromRegistry } from "./TextGeneration";

const makeStubTextGeneration = (overrides: Partial<TextGenerationShape>): TextGenerationShape => ({
  generateCommitMessage: () =>
    Effect.die("generateCommitMessage stub not configured for this test"),
  generatePrContent: () => Effect.die("generatePrContent stub not configured for this test"),
  generateBranchName: () => Effect.die("generateBranchName stub not configured for this test"),
  generateThreadTitle: () => Effect.die("generateThreadTitle stub not configured for this test"),
  generateDiffSummary: () => Effect.die("generateDiffSummary stub not configured for this test"),
  generateStructuredTesting: () =>
    Effect.die("generateStructuredTesting stub not configured for this test"),
  ...overrides,
});

const makeStubInstance = (
  instanceId: ProviderInstanceId,
  textGeneration: TextGenerationShape,
): ProviderInstance =>
  ({
    instanceId,
    driverKind: instanceId as unknown as ProviderInstance["driverKind"],
    continuationIdentity: {
      driverKind: instanceId as unknown as ProviderInstance["driverKind"],
      continuationKey: `${instanceId}:test`,
    },
    displayName: undefined,
    enabled: true,
    capabilities: {
      modelDiscovery: "runtime",
      agentSessions: "supported",
      textGeneration: "supported",
      structuredGeneration: "supported",
      nativeReview: "unsupported",
      login: "external",
      logout: "external",
      accountSwitch: "external",
      installation: "external",
      testingMcpTools: "unsupported",
    },
    lifecycle: { actions: [] },
    snapshot: {} as ProviderInstance["snapshot"],
    adapter: {} as ProviderInstance["adapter"],
    textGeneration,
  }) satisfies ProviderInstance;

const makeStubRegistry = (
  instances: ReadonlyArray<ProviderInstance>,
): ProviderInstanceRegistryShape => {
  const byId = new Map(instances.map((instance) => [instance.instanceId, instance] as const));
  return {
    getInstance: (id) => Effect.succeed(byId.get(id)),
    listInstances: Effect.succeed(instances),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    // Tests never drive changes through this stub; acquire a throwaway
    // subscription on an unused PubSub so the shape is satisfied.
    subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) =>
      PubSub.subscribe(pubsub),
    ),
  };
};

describe("makeTextGenerationFromRegistry", () => {
  it.effect("delegates to the matching instance's textGeneration closure", () =>
    Effect.gen(function* () {
      const personalId = "codex_personal" as ProviderInstanceId;
      const personalCalls: string[] = [];
      const personal = makeStubInstance(
        personalId,
        makeStubTextGeneration({
          generateBranchName: (input) => {
            personalCalls.push(input.message);
            return Effect.succeed({ branch: "personal-branch" });
          },
        }),
      );

      const workId = "codex_work" as ProviderInstanceId;
      const work = makeStubInstance(
        workId,
        makeStubTextGeneration({
          generateBranchName: () => Effect.succeed({ branch: "work-branch" }),
        }),
      );

      const tg = makeTextGenerationFromRegistry(makeStubRegistry([personal, work]));

      const result = yield* tg.generateBranchName({
        cwd: process.cwd(),
        message: "Refactor the routing layer",
        modelSelection: createModelSelection("codex_personal" as ProviderInstanceId, "gpt-5"),
      });

      expect(result.branch).toBe("personal-branch");
      expect(personalCalls).toEqual(["Refactor the routing layer"]);
    }),
  );

  it.effect("fails with TextGenerationError when the instance is unknown", () =>
    Effect.gen(function* () {
      const tg = makeTextGenerationFromRegistry(makeStubRegistry([]));

      const result = yield* tg
        .generateBranchName({
          cwd: process.cwd(),
          message: "anything",
          modelSelection: createModelSelection("missing_instance" as ProviderInstanceId, "gpt-5"),
        })
        .pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("TextGenerationError");
        expect(result.failure.operation).toBe("generateBranchName");
        expect(result.failure.detail).toContain("missing_instance");
      }
    }),
  );

  it.effect("routes structured Testing tasks through the selected provider instance", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.makeUnsafe("codex_work");
      const calls: string[] = [];
      const outputSchema = Schema.Struct({ title: Schema.String });
      const provider = makeStubInstance(
        instanceId,
        makeStubTextGeneration({
          generateStructuredTesting: (input) => {
            calls.push(`${input.taskKind}:${input.reasoningTier}:${input.sanitizedPrompt}`);
            return Effect.succeed({ title: "Generated test" });
          },
        }),
      );
      const tg = makeTextGenerationFromRegistry(makeStubRegistry([provider]));

      const result = yield* tg.generateStructuredTesting({
        cwd: process.cwd(),
        taskKind: "test-generation",
        sanitizedPrompt: "Reviewed case without credentials",
        outputSchema,
        modelSelection: createModelSelection(instanceId, "gpt-5"),
        reasoningTier: "medium",
        budget: { maxEstimatedTokens: 2_000, maxEstimatedCostUsd: 1 },
      });

      expect(result).toEqual({ title: "Generated test" });
      expect(calls).toEqual(["test-generation:medium:Reviewed case without credentials"]);
    }),
  );

  it.effect("does not switch providers when official Playwright tools are unavailable", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.makeUnsafe("claude_selected");
      let called = false;
      const provider = makeStubInstance(
        instanceId,
        makeStubTextGeneration({
          generateStructuredTesting: () => {
            called = true;
            return Effect.succeed({ title: "must not run" });
          },
        }),
      );
      const tg = makeTextGenerationFromRegistry(makeStubRegistry([provider]));
      const result = yield* tg
        .generateStructuredTesting({
          cwd: process.cwd(),
          taskKind: "test-generation",
          sanitizedPrompt: "Reviewed case",
          outputSchema: Schema.Struct({ title: Schema.String }),
          modelSelection: createModelSelection(instanceId, "selected-model"),
          reasoningTier: "medium",
          budget: { maxEstimatedTokens: 2_000, maxEstimatedCostUsd: 1 },
          playwrightTools: {
            command: process.execPath,
            args: [],
            cwd: process.cwd(),
            nodePath: process.cwd(),
          },
        })
        .pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);
      expect(called).toBe(false);
      if (Result.isFailure(result)) expect(result.failure.detail).toContain("not changed");
    }),
  );
});
