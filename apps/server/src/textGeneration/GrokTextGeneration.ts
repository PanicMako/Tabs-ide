import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpErrors from "effect-acp/errors";

import { type GrokSettings, TextGenerationError } from "@tabs/contracts";
import { getModelSelectionStringOptionValue } from "@tabs/shared/model";

import * as TextGenerationOperations from "./TextGenerationOperations.ts";
import { type TextGenerationShape } from "./TextGeneration.ts";
import {
  buildDiffSummaryPrompt,
  buildStructuredTestingPrompt,
} from "./TextGenerationPrompts.ts";
import {
  applyGrokAcpModelSelection,
  currentGrokModelIdFromSessionSetup,
  currentGrokReasoningEffortFromSessionSetup,
  makeGrokAcpRuntime,
  resolveGrokAcpBaseModelId,
} from "../provider/acp/GrokAcpSupport.ts";

const GROK_TIMEOUT_MS = 180_000;

const isTextGenerationError = Schema.is(TextGenerationError);

export const makeGrokTextGeneration = Effect.fn("makeGrokTextGeneration")(function* (
  grokSettings: GrokSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const crypto = yield* Crypto.Crypto;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const runGrokJson: TextGenerationOperations.Runner = (request) => {
    const { operation, cwd, prompt, modelSelection } = request;
    return Effect.gen(function* () {
      const outputRef = yield* Ref.make("");
      const runtime = yield* makeGrokAcpRuntime({
        grokSettings,
        environment,
        childProcessSpawner: commandSpawner,
        cwd,
        clientInfo: { name: "t3-code-git-text", version: "0.0.0" },
      }).pipe(Effect.provideService(Crypto.Crypto, crypto));

      yield* runtime.handleSessionUpdate((notification) => {
        const update = notification.update;
        if (update.sessionUpdate !== "agent_message_chunk") {
          return Effect.void;
        }
        const content = update.content;
        if (content.type !== "text") {
          return Effect.void;
        }
        return Ref.update(outputRef, (current) => current + content.text);
      });

      const promptResult = yield* Effect.gen(function* () {
        const resolvedModel = resolveGrokAcpBaseModelId(modelSelection.model);
        const started = yield* runtime.start();
        const requestedReasoningEffort = getModelSelectionStringOptionValue(
          modelSelection,
          "reasoningEffort",
        );
        yield* applyGrokAcpModelSelection({
          runtime,
          currentModelId: currentGrokModelIdFromSessionSetup(started.sessionSetupResult),
          currentReasoningEffort: currentGrokReasoningEffortFromSessionSetup(
            started.sessionSetupResult,
          ),
          requestedModelId: resolvedModel,
          requestedReasoningEffort,
          mapError: (cause) =>
            new TextGenerationError({
              operation,
              detail: "Failed to set Grok ACP base model for text generation.",
              cause,
            }),
        });
        return yield* runtime.prompt({
          prompt: [{ type: "text", text: prompt }],
        });
      }).pipe(
        Effect.timeoutOption(GROK_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({ operation, detail: "Grok ACP request timed out." }),
              ),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
        Effect.mapError((cause: EffectAcpErrors.AcpError | TextGenerationError) =>
          isTextGenerationError(cause)
            ? cause
            : new TextGenerationError({
                operation,
                detail: "Grok ACP request failed.",
                cause,
              }),
        ),
      );

      const trimmed = (yield* Ref.get(outputRef)).trim();
      if (!trimmed) {
        return yield* new TextGenerationError({
          operation,
          detail:
            promptResult.stopReason === "cancelled"
              ? "Grok ACP request was cancelled."
              : "Grok Agent returned empty output.",
        });
      }

      return yield* TextGenerationOperations.decodeJsonReply(request, "Grok Agent", trimmed);
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation,
              detail: "Grok ACP text generation failed.",
              cause,
            }),
      ),
      Effect.scoped,
    );
  };

  const base = TextGenerationOperations.fromRunner("GrokTextGeneration", runGrokJson);

  const generateDiffSummary: TextGenerationShape["generateDiffSummary"] = Effect.fn(
    "GrokTextGeneration.generateDiffSummary",
  )(function* (input) {
    const { prompt, outputSchema } = buildDiffSummaryPrompt({
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
      commitMessage: input.commitMessage,
      userHint: input.userHint,
      staticAnalysisContext: input.staticAnalysisContext,
      repoContext: input.repoContext,
      projectRules: input.projectRules,
    });

    const generated = yield* runGrokJson({
      operation: "generateDiffSummary",
      cwd: input.cwd,
      prompt,
      outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      summary: generated.summary.trim(),
      keyChanges: generated.keyChanges.trim(),
      notesAndRisk: generated.notesAndRisk.trim(),
      ...(generated.findings ? { findings: generated.findings } : {}),
    };
  });

  const generateStructuredTesting: TextGenerationShape["generateStructuredTesting"] = Effect.fn(
    "GrokTextGeneration.generateStructuredTesting",
  )(function* (input) {
    return yield* runGrokJson({
      operation: "generateStructuredTesting",
      cwd: input.cwd,
      prompt: buildStructuredTestingPrompt(input),
      outputSchema: input.outputSchema,
      modelSelection: input.modelSelection,
    });
  });

  return {
    ...base,
    generateDiffSummary,
    generateStructuredTesting,
  } satisfies TextGenerationShape;
});
