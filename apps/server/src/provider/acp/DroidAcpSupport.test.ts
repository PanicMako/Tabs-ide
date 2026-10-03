import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import { buildDroidEnvironment, discoverDroidAcpModels } from "./DroidAcpSupport";

describe("buildDroidEnvironment", () => {
  it("removes an ambient Factory API key when account pairing is selected", () => {
    expect(buildDroidEnvironment({}, { PATH: "/bin", FACTORY_API_KEY: "ambient-key" })).toEqual({
      PATH: "/bin",
    });
  });

  it("injects only an explicitly configured Factory API key", () => {
    expect(
      buildDroidEnvironment(
        { apiKey: "configured-key" },
        { PATH: "/bin", FACTORY_API_KEY: "ambient-key" },
      ),
    ).toEqual({ PATH: "/bin", FACTORY_API_KEY: "configured-key" });
  });

  it.effect("discovers account models and their model-specific reasoning choices", () =>
    Effect.gen(function* () {
      let selectedModel = "model-a";
      const configOptions = (): ReadonlyArray<EffectAcpSchema.SessionConfigOption> => [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: selectedModel,
          options: [
            { value: "model-a", name: "Model A" },
            { value: "model-b", name: "Model B" },
          ],
        },
        {
          id: "reasoning_effort",
          name: "Reasoning",
          category: "thought_level",
          type: "select",
          currentValue: "low",
          options:
            selectedModel === "model-a"
              ? [{ value: "low", name: "Low" }]
              : [
                  { value: "medium", name: "Medium" },
                  { value: "high", name: "High" },
                ],
        },
      ];
      const result = yield* discoverDroidAcpModels({
        getConfigOptions: Effect.sync(configOptions),
        setConfigOption: (id, value) =>
          Effect.sync(() => {
            if (id === "model" && typeof value === "string") selectedModel = value;
            return { configOptions: configOptions() };
          }),
      });

      expect(result.models.map((model) => model.slug)).toEqual(["model-a", "model-b"]);
      expect(result.models[1]?.optionDescriptors?.[0]?.options).toEqual([
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
      ]);
      expect(selectedModel).toBe("model-a");
    }),
  );
});
