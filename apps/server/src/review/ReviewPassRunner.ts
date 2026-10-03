/**
 * ReviewPassRunner — Phase 3 of the AI Review Engine.
 *
 * Orchestrates multi-pass analysis across specified review passes (Correctness, Security, API Compatibility).
 * Enforces cost previews and pass ceilings (default 2 passes: correctness + security).
 *
 * @module ReviewPassRunner
 */

import { Effect } from "effect";
import * as Schema from "effect/Schema";
import {
  type ModelSelection,
  type ReviewCostPreviewEvent,
  type ReviewFinding,
  type ReviewFindingSeverity,
  type ReviewProgressEvent,
  type TextGenerationError,
} from "@tabs/contracts";
import type { TextGenerationShape } from "../textGeneration/TextGeneration";
import { buildDiffSummaryPrompt } from "../textGeneration/TextGenerationPrompts";
import { filterAndDeduplicateFindings } from "./VerificationFilter";

export const DEFAULT_REVIEW_PASSES = ["correctness", "security"] as const;
export const OPTIONAL_REVIEW_PASSES = ["api_compatibility"] as const;

export interface ReviewPassInput {
  readonly cwd: string;
  readonly diffSummary: string;
  readonly diffPatch: string;
  readonly commitMessage?: string | undefined;
  readonly userHint?: string | undefined;
  readonly staticAnalysisContext?: string | undefined;
  readonly repoContext?: string | undefined;
  readonly projectRules?: string | undefined;
  readonly modelSelection: ModelSelection;
  /** Configured list of passes to run. Default: ["correctness", "security"]. */
  readonly configuredPasses?: ReadonlyArray<string> | undefined;
  /** Callback emitted before any pass fires to surface estimated cost. */
  readonly onCostPreview?:
    | ((preview: ReviewCostPreviewEvent) => Effect.Effect<void, never, never>)
    | undefined;
  /** Callback emitted during multi-pass execution to report live backend progress. */
  readonly onProgress?:
    | ((event: ReviewProgressEvent) => Effect.Effect<void, never, never>)
    | undefined;
}

export interface ReviewPassRunnerResult {
  readonly summary: string;
  readonly keyChanges: string;
  readonly notesAndRisk: string;
  readonly findings: ReadonlyArray<ReviewFinding>;
  readonly passesRun: ReadonlyArray<string>;
}

/** Raw finding schema emitted directly by the LLM in JSON mode. */
export const ReviewFindingRawSchema = Schema.Struct({
  file: Schema.String,
  line: Schema.Number,
  col: Schema.optional(Schema.Number),
  category: Schema.String,
  severity: Schema.Literals(["error", "warning", "info"]),
  title: Schema.String,
  body: Schema.String,
  confidence: Schema.Number,
  isInDiff: Schema.Boolean,
});
export type ReviewFindingRaw = typeof ReviewFindingRawSchema.Type;

export function resolvePassesToRun(
  configuredPasses?: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (!configuredPasses || configuredPasses.length === 0) {
    return [...DEFAULT_REVIEW_PASSES];
  }
  // Default ceiling is 2 passes; opting into 3 requires explicit config
  const validPasses = configuredPasses.filter(
    (p) => p === "correctness" || p === "security" || p === "api_compatibility",
  );
  return validPasses.length > 0 ? validPasses : [...DEFAULT_REVIEW_PASSES];
}

/**
 * Heuristic estimation of prompt tokens based on input length.
 * Standard estimation: ~4 characters per token (±20%).
 */
export function estimateReviewCost(
  input: ReviewPassInput,
  passesToRun: ReadonlyArray<string>,
): ReviewCostPreviewEvent {
  const basePrompt = buildDiffSummaryPrompt({
    diffSummary: input.diffSummary,
    diffPatch: input.diffPatch,
    commitMessage: input.commitMessage,
    userHint: input.userHint,
    staticAnalysisContext: input.staticAnalysisContext,
    repoContext: input.repoContext,
    projectRules: input.projectRules,
  }).prompt;

  const perPassPromptLength = basePrompt.length + 300; // pass instructions overhead
  const totalChars = perPassPromptLength * passesToRun.length;
  const estimatedInputTokens = Math.round(totalChars / 4);

  return {
    estimatedPassCount: passesToRun.length,
    estimatedInputTokens,
  };
}

/**
 * Execute multi-pass review analysis using the configured TextGeneration driver.
 */
export function runReviewPasses(
  input: ReviewPassInput,
  textGen: TextGenerationShape,
): Effect.Effect<ReviewPassRunnerResult, TextGenerationError> {
  return Effect.gen(function* () {
    const passesToRun = resolvePassesToRun(input.configuredPasses);

    // 1. Emit cost preview before any LLM call fires
    const costPreview = estimateReviewCost(input, passesToRun);
    if (input.onCostPreview) {
      yield* input.onCostPreview(costPreview);
    }

    const allRawFindings: ReviewFinding[] = [];
    let aggregatedSummary = "";
    let aggregatedKeyChanges = "";
    let aggregatedNotesAndRisk = "";

    // 2. Sequential focused passes
    for (let passIndex = 0; passIndex < passesToRun.length; passIndex++) {
      const passName = passesToRun[passIndex]!;

      if (input.onProgress) {
        yield* input.onProgress({
          cwd: input.cwd,
          stage: "pass_executing",
          message: `Running Pass ${passIndex + 1}/${passesToRun.length}: ${passName.toUpperCase().replace("_", " ")} analysis (${input.modelSelection.model})...`,
          passIndex: passIndex + 1,
          totalPasses: passesToRun.length,
          timestamp: new Date().toISOString(),
        });
      }

      let passInstructions = "";
      if (passName === "correctness") {
        passInstructions =
          "PASS 1: CORRECTNESS FOCUS. Scan specifically for logic bugs, null/undefined dereferences, off-by-one errors, unhandled edge cases, and race conditions.";
      } else if (passName === "security") {
        passInstructions =
          "PASS 2: SECURITY FOCUS. Scan specifically for injection risks (SQL, command, XSS), hardcoded secrets, unsafe input validation, authentication/authorization bypasses, and unhandled errors.";
      } else if (passName === "api_compatibility") {
        passInstructions =
          "PASS 3: API COMPATIBILITY FOCUS. Scan specifically for breaking contract changes, modified function signatures, removed exports, and parameter type mismatches.";
      }

      const passHint = [input.userHint?.trim(), passInstructions].filter(Boolean).join("\n\n");

      // Generate diff summary + findings for this pass
      const result = yield* textGen.generateDiffSummary({
        cwd: input.cwd,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        ...(input.commitMessage ? { commitMessage: input.commitMessage } : {}),
        userHint: passHint,
        ...(input.staticAnalysisContext
          ? { staticAnalysisContext: input.staticAnalysisContext }
          : {}),
        ...(input.repoContext ? { repoContext: input.repoContext } : {}),
        ...(input.projectRules ? { projectRules: input.projectRules } : {}),
        modelSelection: input.modelSelection,
      });

      if (result.findings && result.findings.length > 0) {
        allRawFindings.push(...result.findings);
      }

      if (passIndex === 0) {
        aggregatedSummary = result.summary;
        aggregatedKeyChanges = result.keyChanges;
        aggregatedNotesAndRisk = result.notesAndRisk;
      } else {
        if (
          result.notesAndRisk?.trim() &&
          !aggregatedNotesAndRisk.includes(result.notesAndRisk.trim())
        ) {
          aggregatedNotesAndRisk = [aggregatedNotesAndRisk, result.notesAndRisk.trim()]
            .filter(Boolean)
            .join("\n\n");
        }
      }
    }

    if (input.onProgress) {
      yield* input.onProgress({
        cwd: input.cwd,
        stage: "synthesis",
        message: `Synthesizing ${allRawFindings.length} finding(s) & running verification filters...`,
        timestamp: new Date().toISOString(),
      });
    }

    // 3. Verification filter: dedup, confidence threshold, scope check, feedback discount
    const verifiedFindings = filterAndDeduplicateFindings(allRawFindings, {
      cwd: input.cwd,
    });

    return {
      summary: aggregatedSummary,
      keyChanges: aggregatedKeyChanges,
      notesAndRisk: aggregatedNotesAndRisk,
      findings: verifiedFindings,
      passesRun: passesToRun,
    };
  });
}
