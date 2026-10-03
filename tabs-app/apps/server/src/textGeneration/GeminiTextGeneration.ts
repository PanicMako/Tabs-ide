import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { type GeminiSettings, type ModelSelection, TextGenerationError } from "@tabs/contracts";
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

const GEMINI_TIMEOUT_MS = 60_000;

function mapGeminiError(
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

export const makeGeminiTextGeneration = Effect.fn("makeGeminiTextGeneration")(function* (
  geminiSettings: GeminiSettings,
) {
  const runGeminiJson = Effect.fn("runGeminiJson")(function* <S extends Schema.Top>({
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
    const apiKey = geminiSettings.apiKey?.trim();
    if (!apiKey) {
      return yield* mapGeminiError(
        operation,
        "Gemini API key is not configured — set your Google Gemini API key in Settings → Providers.",
      );
    }

    const baseUrl = (
      geminiSettings.baseUrl?.trim() || "https://generativelanguage.googleapis.com"
    ).replace(/\/+$/, "");
    const model = modelSelection.model || "gemini-3.6-flash";
    yield* logStructuredGenerationRequest({
      operation,
      provider: "gemini",
      model,
      schemaMode: "native",
    });
    const endpoint = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const requestPayload = {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: toJsonSchemaObject(outputSchemaJson),
      },
    };

    const fetchEffect = Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestPayload),
          signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(
            `Gemini API HTTP ${response.status}: ${errorText || response.statusText}`,
          );
        }

        return (await response.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string }>;
            };
          }>;
        };
      },
      catch: (error) =>
        mapGeminiError(
          operation,
          `Gemini API request failed: ${error instanceof Error ? error.message : String(error)}`,
          error,
        ),
    });

    const responseOpt = yield* fetchEffect.pipe(Effect.timeoutOption(GEMINI_TIMEOUT_MS));

    const responseJson = yield* Option.match(responseOpt, {
      onNone: () =>
        Effect.fail(
          mapGeminiError(operation, `Gemini API request timed out after ${GEMINI_TIMEOUT_MS}ms`),
        ),
      onSome: (res) => Effect.succeed(res),
    });

    const candidateText = responseJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      return yield* mapGeminiError(operation, "Gemini API returned an empty text response.");
    }

    const extracted = extractJsonObject(candidateText);

    const jsonObject = yield* Effect.try({
      try: () => JSON.parse(extracted),
      catch: (err) =>
        mapGeminiError(operation, `Failed to parse JSON response from Gemini: ${String(err)}`, err),
    });

    return yield* Schema.decodeUnknownEffect(outputSchemaJson)(jsonObject).pipe(
      Effect.mapError((err) =>
        mapGeminiError(
          operation,
          `Gemini response did not match expected schema: ${String(err)}`,
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

        const result = yield* runGeminiJson({
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

        const result = yield* runGeminiJson({
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

        const result = yield* runGeminiJson({
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

        const result = yield* runGeminiJson({
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

        const result = yield* runGeminiJson({
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
        mapGeminiError(
          "generateStructuredTesting",
          "Testing automation requires a configured coding-agent CLI backend; direct Gemini API generation is disabled for this operation.",
        ),
      ),
  };

  return service;
});
