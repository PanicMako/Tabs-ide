import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { type OpenRouterSettings, type ModelSelection, TextGenerationError } from "@tabs/contracts";
import { sanitizeBranchFragment } from "@tabs/shared/git";
import { extractJsonObject } from "@tabs/shared/schemaJson";

import { type TextGenerationShape, type ThreadTitleGenerationResult } from "./TextGeneration";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildDiffSummaryPrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts";
import {
  logStructuredGenerationRequest,
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
  toJsonSchemaObject,
} from "./TextGenerationUtils";

const OPENROUTER_TIMEOUT_MS = 60_000;

function mapOpenRouterError(
  operation:
    | "generateCommitMessage"
    | "generatePrContent"
    | "generateBranchName"
    | "generateThreadTitle"
    | "generateDiffSummary"
    | "generateStructuredTesting",
  detail: string,
  cause?: unknown,
): TextGenerationError {
  return new TextGenerationError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

export const makeOpenRouterTextGeneration = Effect.fn("makeOpenRouterTextGeneration")(function* (
  openRouterSettings: OpenRouterSettings,
) {
  const runOpenRouterJson = Effect.fn("runOpenRouterJson")(function* <S extends Schema.Top>({
    operation,
    prompt,
    outputSchemaJson,
    modelSelection,
  }: {
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle"
      | "generateDiffSummary"
      | "generateStructuredTesting";
    prompt: string;
    outputSchemaJson: S;
    modelSelection: ModelSelection;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const apiKey = openRouterSettings.apiKey?.trim();
    if (!apiKey) {
      return yield* mapOpenRouterError(
        operation,
        "OpenRouter API key is not configured - set it in Settings > Providers.",
      );
    }

    const baseUrl = (openRouterSettings.baseUrl?.trim() || "https://openrouter.ai/api/v1").replace(
      /\/+$/,
      "",
    );
    const model = modelSelection.model;
    if (!model) {
      return yield* mapOpenRouterError(operation, "Select an OpenRouter model first.");
    }
    yield* logStructuredGenerationRequest({
      operation,
      provider: "openrouter",
      model,
      schemaMode: "native",
    });
    const endpoint = `${baseUrl}/chat/completions`;

    const requestPayload = {
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: operation,
          strict: true,
          schema: toJsonSchemaObject(outputSchemaJson),
        },
      },
      // Tabs never silently falls back to another paid upstream. A future
      // explicit routing preference may opt back in per provider instance.
      provider: { allow_fallbacks: false },
      usage: { include: true },
    };

    const fetchEffect = Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestPayload),
          signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(
            `OpenRouter API HTTP ${response.status}: ${errorText || response.statusText}`,
          );
        }

        return (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
      },
      catch: (error) =>
        mapOpenRouterError(
          operation,
          `OpenRouter API request failed: ${error instanceof Error ? error.message : String(error)}`,
          error,
        ),
    });

    const responseOpt = yield* fetchEffect.pipe(Effect.timeoutOption(OPENROUTER_TIMEOUT_MS));

    const responseJson = yield* Option.match(responseOpt, {
      onNone: () =>
        Effect.fail(
          mapOpenRouterError(
            operation,
            `OpenRouter API request timed out after ${OPENROUTER_TIMEOUT_MS}ms`,
          ),
        ),
      onSome: (res) => Effect.succeed(res),
    });

    const candidateText = responseJson.choices?.[0]?.message?.content;
    if (!candidateText) {
      return yield* mapOpenRouterError(
        operation,
        "OpenRouter API returned an empty text response.",
      );
    }

    const extracted = extractJsonObject(candidateText);

    const jsonObject = yield* Effect.try({
      try: () => JSON.parse(extracted),
      catch: (err) =>
        mapOpenRouterError(
          operation,
          `Failed to parse JSON response from OpenRouter: ${String(err)}`,
          err,
        ),
    });

    return yield* Schema.decodeUnknownEffect(outputSchemaJson)(jsonObject).pipe(
      Effect.mapError((err) =>
        mapOpenRouterError(
          operation,
          `OpenRouter response did not match expected schema: ${String(err)}`,
          err,
        ),
      ),
    );
  });

  const service: TextGenerationShape = {
    generateCommitMessage: (input) =>
      Effect.gen(function* () {
        const { prompt, outputSchema } = buildCommitMessagePrompt({
          branch: input.branch,
          stagedSummary: input.stagedSummary,
          stagedPatch: input.stagedPatch,
          includeBranch: input.includeBranch ?? false,
        });

        const result = yield* runOpenRouterJson({
          operation: "generateCommitMessage",
          prompt,
          outputSchemaJson: outputSchema,
          modelSelection: input.modelSelection,
        });

        return {
          subject: sanitizeCommitSubject(result.subject),
          body: result.body.trim(),
          ...("branch" in result && typeof result.branch === "string"
            ? { branch: sanitizeBranchFragment(result.branch) }
            : {}),
        };
      }),

    generatePrContent: (input) =>
      Effect.gen(function* () {
        const { prompt, outputSchema } = buildPrContentPrompt({
          baseBranch: input.baseBranch,
          headBranch: input.headBranch,
          commitSummary: input.commitSummary,
          diffSummary: input.diffSummary,
          diffPatch: input.diffPatch,
        });

        const result = yield* runOpenRouterJson({
          operation: "generatePrContent",
          prompt,
          outputSchemaJson: outputSchema,
          modelSelection: input.modelSelection,
        });

        return {
          title: sanitizePrTitle(result.title),
          body: result.body.trim(),
        };
      }),

    generateBranchName: (input) =>
      Effect.gen(function* () {
        const { prompt, outputSchema } = buildBranchNamePrompt({
          message: input.message,
          attachments: input.attachments,
        });

        const result = yield* runOpenRouterJson({
          operation: "generateBranchName",
          prompt,
          outputSchemaJson: outputSchema,
          modelSelection: input.modelSelection,
        });

        return {
          branch: sanitizeBranchFragment(result.branch),
        };
      }),

    generateThreadTitle: (input) =>
      Effect.gen(function* () {
        const { prompt, outputSchema } = buildThreadTitlePrompt({
          message: input.message,
          attachments: input.attachments,
        });

        const result = yield* runOpenRouterJson({
          operation: "generateThreadTitle",
          prompt,
          outputSchemaJson: outputSchema,
          modelSelection: input.modelSelection,
        });

        return {
          title: sanitizeThreadTitle(result.title),
        } satisfies ThreadTitleGenerationResult;
      }),

    generateDiffSummary: (input) =>
      Effect.gen(function* () {
        const { prompt, outputSchema } = buildDiffSummaryPrompt({
          diffSummary: input.diffSummary,
          diffPatch: input.diffPatch,
          commitMessage: input.commitMessage,
          userHint: input.userHint,
          staticAnalysisContext: input.staticAnalysisContext,
          repoContext: input.repoContext,
          projectRules: input.projectRules,
        });

        const result = yield* runOpenRouterJson({
          operation: "generateDiffSummary",
          prompt,
          outputSchemaJson: outputSchema,
          modelSelection: input.modelSelection,
        });

        return {
          summary: result.summary.trim(),
          keyChanges: result.keyChanges.trim(),
          notesAndRisk: result.notesAndRisk.trim(),
          ...(result.findings ? { findings: result.findings } : {}),
        };
      }),

    generateStructuredTesting: () =>
      Effect.fail(
        mapOpenRouterError(
          "generateStructuredTesting",
          "Testing automation requires a configured coding-agent CLI backend; direct OpenRouter API generation is disabled for this operation.",
        ),
      ),
  };

  return service;
});
