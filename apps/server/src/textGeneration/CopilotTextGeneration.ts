import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpErrors from "effect-acp/errors";

import { type CopilotSettings, type ModelSelection } from "@tabs/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@tabs/shared/git";
import { extractJsonObject, fromLenientJson } from "@tabs/shared/schemaJson";

import { TextGenerationError } from "@tabs/contracts";
import { type ThreadTitleGenerationResult, type TextGenerationShape } from "./TextGeneration";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildDiffSummaryPrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
  buildStructuredTestingPrompt,
} from "./TextGenerationPrompts";
import {
  buildSchemaConstrainedPrompt,
  logStructuredGenerationRequest,
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils";
import {
  applyCopilotAcpModelSelection,
  currentCopilotModelIdFromSessionSetup,
  makeCopilotAcpRuntime,
  resolveCopilotAcpBaseModelId,
} from "../provider/acp/CopilotAcpSupport";

const COPILOT_TIMEOUT_MS = 180_000;

function mapCopilotAcpError(
  operation:
    | "generateCommitMessage"
    | "generatePrContent"
    | "generateBranchName"
    | "generateThreadTitle"
    | "generateDiffSummary"
    | "generateStructuredTesting",
  detail: string,
  cause: unknown,
): TextGenerationError {
  return new TextGenerationError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function isTextGenerationError(error: unknown): error is TextGenerationError {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "TextGenerationError"
  );
}

export const makeCopilotTextGeneration = Effect.fn("makeCopilotTextGeneration")(function* (
  copilotSettings: CopilotSettings,
  environment: NodeJS.ProcessEnv = process.env,
  isModelAdvertised?: (modelId: string) => Effect.Effect<boolean, never, never>,
) {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const runCopilotJson = <S extends Schema.Top>({
    operation,
    cwd,
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
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    modelSelection: ModelSelection;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const structuredPrompt = buildSchemaConstrainedPrompt(prompt, outputSchemaJson);
      yield* logStructuredGenerationRequest({
        operation,
        provider: "copilot",
        model: modelSelection.model,
        schemaMode: "prompt-fallback-with-example",
      });
      const resolvedModel = resolveCopilotAcpBaseModelId(modelSelection.model);
      if (!resolvedModel) {
        return yield* new TextGenerationError({
          operation,
          detail: "GitHub Copilot requires a model from the current account catalog.",
        });
      }
      if (isModelAdvertised && !(yield* isModelAdvertised(resolvedModel))) {
        return yield* new TextGenerationError({
          operation,
          detail: `GitHub Copilot model '${resolvedModel}' is stale or undiscovered. Refresh providers and select an advertised model.`,
        });
      }
      const outputRef = yield* Ref.make("");
      const runtime = yield* makeCopilotAcpRuntime({
        copilotSettings,
        environment,
        childProcessSpawner: commandSpawner,
        cwd,
        clientInfo: { name: "tabs-ide-git-text", version: "0.0.0" },
      });

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
        const started = yield* runtime.start();
        yield* applyCopilotAcpModelSelection({
          runtime,
          currentModelId: currentCopilotModelIdFromSessionSetup(started.sessionSetupResult),
          requestedModelId: resolvedModel,
          mapError: (cause) =>
            mapCopilotAcpError(
              operation,
              "Failed to set GitHub Copilot ACP base model for text generation.",
              cause,
            ),
        });

        return yield* runtime.prompt({
          prompt: [{ type: "text", text: structuredPrompt }],
        });
      }).pipe(
        Effect.timeoutOption(COPILOT_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({
                  operation,
                  detail: "GitHub Copilot ACP request timed out.",
                }),
              ),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
        Effect.mapError((cause: EffectAcpErrors.AcpError | TextGenerationError) =>
          isTextGenerationError(cause)
            ? cause
            : mapCopilotAcpError(operation, "GitHub Copilot ACP request failed.", cause),
        ),
      );

      const trimmed = (yield* Ref.get(outputRef)).trim();
      if (!trimmed) {
        return yield* new TextGenerationError({
          operation,
          detail:
            promptResult.stopReason === "cancelled"
              ? "GitHub Copilot ACP request was cancelled."
              : "GitHub Copilot Agent returned empty output.",
        });
      }

      const decodeOutput = Schema.decodeEffect(fromLenientJson(outputSchemaJson));
      return yield* decodeOutput(extractJsonObject(trimmed)).pipe(
        Effect.catchTag("SchemaError", (cause) =>
          Effect.fail(
            new TextGenerationError({
              operation,
              detail: "GitHub Copilot Agent returned invalid structured output.",
              cause,
            }),
          ),
        ),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : mapCopilotAcpError(operation, "GitHub Copilot ACP text generation failed.", cause),
      ),
      Effect.scoped,
    );

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
    "CopilotTextGeneration.generateCommitMessage",
  )(function* (input) {
    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    });

    const generated = yield* runCopilotJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      subject: sanitizeCommitSubject(generated.subject),
      body: generated.body.trim(),
      ...("branch" in generated && typeof generated.branch === "string"
        ? { branch: sanitizeFeatureBranchName(generated.branch) }
        : {}),
    };
  });

  const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
    "CopilotTextGeneration.generatePrContent",
  )(function* (input) {
    const { prompt, outputSchema } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    });

    const generated = yield* runCopilotJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    };
  });

  const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
    "CopilotTextGeneration.generateBranchName",
  )(function* (input) {
    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    const generated = yield* runCopilotJson({
      operation: "generateBranchName",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      branch: sanitizeBranchFragment(generated.branch),
    };
  });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
    "CopilotTextGeneration.generateThreadTitle",
  )(function* (input) {
    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    const generated = yield* runCopilotJson({
      operation: "generateThreadTitle",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizeThreadTitle(generated.title),
    } satisfies ThreadTitleGenerationResult;
  });

  const generateDiffSummary: TextGenerationShape["generateDiffSummary"] = Effect.fn(
    "CopilotTextGeneration.generateDiffSummary",
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

    const generated = yield* runCopilotJson({
      operation: "generateDiffSummary",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
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
    "CopilotTextGeneration.generateStructuredTesting",
  )(function* (input) {
    return yield* runCopilotJson({
      operation: "generateStructuredTesting",
      cwd: input.cwd,
      prompt: buildStructuredTestingPrompt(input),
      outputSchemaJson: input.outputSchema,
      modelSelection: input.modelSelection,
    });
  });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
    generateDiffSummary,
    generateStructuredTesting,
  } satisfies TextGenerationShape;
});
