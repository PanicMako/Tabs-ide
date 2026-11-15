import {
  DEFAULT_SPEECH_POST_PROCESSING_PROMPT,
  type EnvironmentSpeechPostProcessingRequest,
} from "@tabs/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { buildTranscriptionPostProcessingPrompt } from "../textGeneration/TranscriptionPostProcessing.ts";
import { applySpeechAliases } from "./customWords.ts";
import { SpeechOperationError } from "./SpeechService.ts";

export class SpeechPostProcessing extends Context.Service<
  SpeechPostProcessing,
  {
    readonly process: (
      input: EnvironmentSpeechPostProcessingRequest,
    ) => Effect.Effect<{ readonly text: string }, SpeechOperationError>;
  }
>()("tabs/speech/postProcessing/SpeechPostProcessing") {}

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const textGeneration = yield* TextGeneration.TextGeneration;
  return SpeechPostProcessing.of({
    process: Effect.fn("SpeechPostProcessing.process")(
      function* (input) {
        if (input.transcript.trim().length === 0) return { text: input.transcript };
        const settings = yield* settingsService.getSettings;
        // Clean-up runs on the writing model the user already chose for commits and titles.
        const modelSelection = settings.textGenerationModelSelection;
        if (modelSelection === null) {
          return yield* Effect.fail(
            new Error("Choose a writing model in Settings to clean up transcripts."),
          );
        }
        const { mode, customInstructions } = input.options.speechPostProcessingPrompt;
        const instructions =
          (mode === "custom" ? customInstructions.trim() : "") ||
          DEFAULT_SPEECH_POST_PROCESSING_PROMPT;
        // Providers run in a working directory; clean-up must not read a checkout.
        const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "tabs-voice-cleanup-" });
        const generated = yield* textGeneration.generateTranscriptionPostProcessing!({
          cwd,
          prompt: buildTranscriptionPostProcessingPrompt(
            instructions,
            input.transcript,
            input.draft,
            input.options.speechCorrectionWord,
          ),
          modelSelection,
        });
        const text = generated.transcription.trim();
        return {
          text:
            text.length > 0
              ? applySpeechAliases(text, input.options.speechCustomWords)
              : input.transcript,
        };
      },
      Effect.scoped,
      Effect.mapError((cause) => new SpeechOperationError({ operation: "post-processing", cause })),
    ),
  });
});

export const layer = Layer.effect(SpeechPostProcessing, make);
