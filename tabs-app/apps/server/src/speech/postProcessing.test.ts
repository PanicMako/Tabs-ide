import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as SpeechPostProcessing from "./postProcessing.ts";

const request = {
  transcript: "um open the tabs config",
  draft: { text: "Please ", selection: { start: 7, end: 7 } },
  options: {
    speechCustomWords: [{ term: "Tabs", aliases: ["tabs"] }],
    speechPostProcessingPrompt: { mode: "default" as const, customInstructions: "" },
  },
};

const makeLayer = (selection: { instanceId: string; model: string } | null) => {
  const prompts: string[] = [];
  const layer = SpeechPostProcessing.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        ServerSettings.layerTest({
          textGenerationModelSelection:
            selection === null
              ? null
              : {
                  instanceId: ProviderInstanceId.make(selection.instanceId),
                  model: selection.model,
                },
        } as never),
        Layer.mock(TextGeneration.TextGeneration)({
          generateTranscriptionPostProcessing: (input) =>
            Effect.sync(() => {
              prompts.push(input.prompt);
              return { transcription: " Open the tabs config. " };
            }),
        }),
      ),
    ),
  );
  return { prompts, layer };
};

it.effect("cleans a transcript with the writing model and applies custom words", () => {
  const { prompts, layer } = makeLayer({ instanceId: "codex", model: "gpt-5.4-mini" });
  return Effect.gen(function* () {
    const service = yield* SpeechPostProcessing.SpeechPostProcessing;
    const result = yield* service.process(request);
    assert.equal(result.text, "Open the Tabs config.");
    assert.equal(prompts.length, 1);
    assert.include(prompts[0]!, "um open the tabs config");
    assert.include(prompts[0]!, "<composer_before>\nPlease \n</composer_before>");
  }).pipe(Effect.provide(layer));
});

it.effect("fails clearly when no writing model is configured", () => {
  const { prompts, layer } = makeLayer(null);
  return Effect.gen(function* () {
    const service = yield* SpeechPostProcessing.SpeechPostProcessing;
    const error = yield* service.process(request).pipe(Effect.flip);
    assert.equal(error._tag, "SpeechOperationError");
    assert.equal(prompts.length, 0);
  }).pipe(Effect.provide(layer));
});
