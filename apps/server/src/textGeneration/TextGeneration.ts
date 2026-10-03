import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Schema from "effect/Schema";
import type {
  ChatAttachment,
  ModelSelection,
  ProviderInstanceId,
  ReviewFinding,
} from "@tabs/contracts";
import { TextGenerationError } from "@tabs/contracts";

import {
  ProviderInstanceRegistry,
  type ProviderInstanceRegistryShape,
} from "../provider/Services/ProviderInstanceRegistry";
import type { ProviderInstance } from "../provider/ProviderDriver";

export type TextGenerationProvider =
  | "codex"
  | "claudeAgent"
  | "cursor"
  | "copilot"
  | "grok"
  | "opencode"
  | "kilo"
  | "gemini"
  | "openrouter";

export interface CommitMessageGenerationInput {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  /** When true, the model also returns a semantic branch name for the change. */
  includeBranch?: boolean;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface CommitMessageGenerationResult {
  subject: string;
  body: string;
  /** Only present when `includeBranch` was set on the input. */
  branch?: string | undefined;
}

export interface PrContentGenerationInput {
  cwd: string;
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface PrContentGenerationResult {
  title: string;
  body: string;
}

export interface BranchNameGenerationInput {
  cwd: string;
  message: string;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface BranchNameGenerationResult {
  branch: string;
}

export interface ThreadTitleGenerationInput {
  cwd: string;
  message: string;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface ThreadTitleGenerationResult {
  title: string;
}

export interface DiffSummaryGenerationInput {
  cwd: string;
  diffSummary: string;
  diffPatch: string;
  commitMessage?: string | undefined;
  userHint?: string | undefined;
  staticAnalysisContext?: string | undefined;
  /** Compressed repo context section (git history + caller analysis). */
  repoContext?: string | undefined;
  /** Project-level review rules from .tabs-review.json instructions field. */
  projectRules?: string | undefined;
  modelSelection: ModelSelection;
}

export interface DiffSummaryGenerationResult {
  summary: string;
  keyChanges: string;
  notesAndRisk: string;
  findings?: ReadonlyArray<ReviewFinding> | undefined;
}

export type TestingTaskKind =
  | "semantic-ranking"
  | "scenario-generation"
  | "story-to-cases"
  | "test-generation"
  | "healing"
  | "visual-triage"
  | "failure-triage";

export type TestingReasoningTier = "low" | "medium" | "high";

export interface StructuredTestingGenerationInput<S extends Schema.Top> {
  readonly playwrightTools?: {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly nodePath: string;
  };
  readonly cwd: string;
  readonly taskKind: TestingTaskKind;
  readonly sanitizedPrompt: string;
  readonly outputSchema: S;
  readonly modelSelection: ModelSelection;
  readonly reasoningTier: TestingReasoningTier;
  readonly budget: {
    readonly maxEstimatedTokens: number;
    readonly maxEstimatedCostUsd: number;
  };
}

export interface TextGenerationService {
  generateCommitMessage(
    input: CommitMessageGenerationInput,
  ): Promise<CommitMessageGenerationResult>;
  generatePrContent(input: PrContentGenerationInput): Promise<PrContentGenerationResult>;
  generateBranchName(input: BranchNameGenerationInput): Promise<BranchNameGenerationResult>;
  generateThreadTitle(input: ThreadTitleGenerationInput): Promise<ThreadTitleGenerationResult>;
  generateDiffSummary(input: DiffSummaryGenerationInput): Promise<DiffSummaryGenerationResult>;
  generateStructuredTesting<S extends Schema.Top>(
    input: StructuredTestingGenerationInput<S>,
  ): Promise<S["Type"]>;
}

/**
 * TextGenerationShape - Service API for commit/PR text generation.
 */
export interface TextGenerationShape {
  /**
   * Generate a commit message from staged change context.
   */
  readonly generateCommitMessage: (
    input: CommitMessageGenerationInput,
  ) => Effect.Effect<CommitMessageGenerationResult, TextGenerationError>;

  /**
   * Generate pull request title/body from branch and diff context.
   */
  readonly generatePrContent: (
    input: PrContentGenerationInput,
  ) => Effect.Effect<PrContentGenerationResult, TextGenerationError>;

  /**
   * Generate a concise branch name from a user message.
   */
  readonly generateBranchName: (
    input: BranchNameGenerationInput,
  ) => Effect.Effect<BranchNameGenerationResult, TextGenerationError>;

  /**
   * Generate a concise thread title from a user's first message.
   */
  readonly generateThreadTitle: (
    input: ThreadTitleGenerationInput,
  ) => Effect.Effect<ThreadTitleGenerationResult, TextGenerationError>;

  /**
   * Generate an AI diff summary (CodeRabbit-style).
   */
  readonly generateDiffSummary: (
    input: DiffSummaryGenerationInput,
  ) => Effect.Effect<DiffSummaryGenerationResult, TextGenerationError>;

  readonly generateStructuredTesting: <S extends Schema.Top>(
    input: StructuredTestingGenerationInput<S>,
  ) => Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]>;
}

/**
 * TextGeneration - Service tag for commit and PR text generation.
 */
export class TextGeneration extends Context.Service<TextGeneration, TextGenerationShape>()(
  "tabs/textGeneration/TextGeneration",
) {}

type TextGenerationOp =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "generateDiffSummary"
  | "generateStructuredTesting";

const resolveInstance = (
  registry: ProviderInstanceRegistryShape,
  operation: TextGenerationOp,
  instanceId: ProviderInstanceId,
): Effect.Effect<ProviderInstance["textGeneration"], TextGenerationError> =>
  registry.getInstance(instanceId).pipe(
    Effect.flatMap((instance) =>
      instance
        ? Effect.succeed(instance.textGeneration)
        : Effect.fail(
            new TextGenerationError({
              operation,
              detail: `No provider instance registered for id '${instanceId}'.`,
            }),
          ),
    ),
  );

export const makeTextGenerationFromRegistry = (
  registry: ProviderInstanceRegistryShape,
): TextGenerationShape => ({
  generateCommitMessage: (input) =>
    resolveInstance(registry, "generateCommitMessage", input.modelSelection.instanceId).pipe(
      Effect.flatMap((textGeneration) => textGeneration.generateCommitMessage(input)),
    ),
  generatePrContent: (input) =>
    resolveInstance(registry, "generatePrContent", input.modelSelection.instanceId).pipe(
      Effect.flatMap((textGeneration) => textGeneration.generatePrContent(input)),
    ),
  generateBranchName: (input) =>
    resolveInstance(registry, "generateBranchName", input.modelSelection.instanceId).pipe(
      Effect.flatMap((textGeneration) => textGeneration.generateBranchName(input)),
    ),
  generateThreadTitle: (input) =>
    resolveInstance(registry, "generateThreadTitle", input.modelSelection.instanceId).pipe(
      Effect.flatMap((textGeneration) => textGeneration.generateThreadTitle(input)),
    ),
  generateDiffSummary: (input) =>
    resolveInstance(registry, "generateDiffSummary", input.modelSelection.instanceId).pipe(
      Effect.flatMap((textGeneration) => textGeneration.generateDiffSummary(input)),
    ),
  generateStructuredTesting: (input) =>
    registry.getInstance(input.modelSelection.instanceId).pipe(
      Effect.flatMap((instance) => {
        if (!instance)
          return Effect.fail(
            new TextGenerationError({
              operation: "generateStructuredTesting",
              detail: "Selected provider is unavailable",
            }),
          );
        if (input.playwrightTools && instance.capabilities.testingMcpTools !== "supported")
          return Effect.fail(
            new TextGenerationError({
              operation: "generateStructuredTesting",
              detail:
                "Official Playwright tool integration requires a provider with testing MCP tool support. Your selected provider was not changed. Use the standard builder or choose a supported provider explicitly.",
            }),
          );
        return instance.textGeneration.generateStructuredTesting(input);
      }),
    ),
});

export const layer = Layer.effect(
  TextGeneration,
  Effect.gen(function* () {
    const registry = yield* ProviderInstanceRegistry;
    return makeTextGenerationFromRegistry(registry);
  }),
);
