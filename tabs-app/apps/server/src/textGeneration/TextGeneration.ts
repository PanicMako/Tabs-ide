import type { PullRequestReviewGuideStop } from "@tabs/contracts";
import * as Context from "effect/Context";
import { executeWhenGated } from "../provider/ProviderInstallationGate.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Schema from "effect/Schema";
import type {
  BranchNamingOptions,
  ChatAttachment,
  ModelSelection,
  ProviderInstanceId,
  ReviewFinding,
} from "@tabs/contracts";
import { TextGenerationError } from "@tabs/contracts";

import { withLocalGitGeneration } from "./LocalCommitDraft";
import { ServerSettingsService } from "../serverSettings";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import type { TextGenerationPolicy } from "./TextGenerationPolicy.ts";

export type TextGenerationProvider =
  | "codex"
  | "claudeAgent"
  | "cursor"
  | "copilot"
  | "grok"
  | "opencode"
  | "kilo"
  | "openrouter";

export interface CommitMessageGenerationInput {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  /** When true, the model also returns a semantic branch name for the change. */
  includeBranch?: boolean;
  policy?: TextGenerationPolicy | undefined;
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
  changeRequestTemplate?: string | undefined;
  policy?: TextGenerationPolicy | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface PrContentGenerationResult {
  title: string;
  body: string;
}

export interface BranchNameGenerationInput {
  naming?: BranchNamingOptions | undefined;
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
  linkedContext?: string | undefined;
  cwd: string;
  message: string;
  /** Present when replacing an existing title from the current thread history. */
  previousTitle?: string | undefined;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface TranscriptionPostProcessingInput {
  readonly cwd: string;
  /** Instructions, transcript and surrounding draft, built by `buildTranscriptionPostProcessingPrompt`. */
  readonly prompt: string;
  readonly modelSelection: ModelSelection;
}

export interface ReviewGuideGenerationInput {
  readonly cwd: string;
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  /** The files the pull request changes, as the host names them. */
  readonly files: ReadonlyArray<string>;
  /** The unified diff the guide is written from, already bounded by the caller. */
  readonly patch: string;
  /** Conversation already settled on the pull request, so the guide does not re-raise it. */
  readonly settledReview: string;
  /** Extra instructions from the reader or the project, empty when there are none. */
  readonly instructions: string;
  readonly modelSelection: ModelSelection;
}

export interface ReviewGuideGenerationResult {
  readonly stops: ReadonlyArray<PullRequestReviewGuideStop>;
}

export interface TeammateProfileGenerationInput {
  readonly cwd: string;
  readonly name: string;
  /** What the owner says the teammate is for, in their own words. */
  readonly purpose: string;
  readonly modelSelection: ModelSelection;
}

export interface TeammateProfileGenerationResult {
  /** SOUL.md: who the teammate is and how it works. */
  readonly soul: string;
  /** What it pays attention to when it looks around a project. */
  readonly focus: string;
}

export interface TranscriptionPostProcessingResult {
  readonly transcription: string;
}

export interface ThreadTitleGenerationResult {
  title: string;
  needsRefinement?: boolean | undefined;
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

  /** Cleans a dictated transcript. Providers without it report the operation unsupported. */
  readonly generateTranscriptionPostProcessing?: (
    input: TranscriptionPostProcessingInput,
  ) => Effect.Effect<TranscriptionPostProcessingResult, TextGenerationError>;

  /** Writes a guided tour of a pull request. Providers without it report the operation unsupported. */
  readonly generateReviewGuide?: (
    input: ReviewGuideGenerationInput,
  ) => Effect.Effect<ReviewGuideGenerationResult, TextGenerationError>;

  /** Drafts a teammate's soul and look-around focus from its purpose. Optional per provider. */
  readonly generateTeammateProfile?: (
    input: TeammateProfileGenerationInput,
  ) => Effect.Effect<TeammateProfileGenerationResult, TextGenerationError>;

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
  | "generateTranscriptionPostProcessing"
  | "generateReviewGuide"
  | "generateTeammateProfile"
  | "generateStructuredTesting";

const resolveInstance = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
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

const makeUngatedTextGenerationFromRegistry = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
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
  generateTranscriptionPostProcessing: (input) =>
    resolveInstance(
      registry,
      "generateTranscriptionPostProcessing",
      input.modelSelection.instanceId,
    ).pipe(
      Effect.flatMap((textGeneration) =>
        textGeneration.generateTranscriptionPostProcessing
          ? textGeneration.generateTranscriptionPostProcessing(input)
          : Effect.fail(
              new TextGenerationError({
                operation: "generateTranscriptionPostProcessing",
                detail: "The writing model's provider cannot clean up transcripts.",
              }),
            ),
      ),
    ),
  generateReviewGuide: (input) =>
    resolveInstance(registry, "generateReviewGuide", input.modelSelection.instanceId).pipe(
      Effect.flatMap((textGeneration) =>
        textGeneration.generateReviewGuide
          ? textGeneration.generateReviewGuide(input)
          : Effect.fail(
              new TextGenerationError({
                operation: "generateReviewGuide",
                detail: "The review guide model's provider cannot write guides.",
              }),
            ),
      ),
    ),
  generateTeammateProfile: (input) =>
    resolveInstance(registry, "generateTeammateProfile", input.modelSelection.instanceId).pipe(
      Effect.flatMap((textGeneration) =>
        textGeneration.generateTeammateProfile
          ? textGeneration.generateTeammateProfile(input)
          : Effect.fail(
              new TextGenerationError({
                operation: "generateTeammateProfile",
                detail: "The writing model's provider cannot draft teammates.",
              }),
            ),
      ),
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
        if (input.playwrightTools && instance.capabilities?.testingMcpTools !== "supported")
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

/**
 * Runs every operation through the installation gate, so a provider update
 * waits for in-flight text generation and generation waits for the update.
 */
export const makeTextGenerationFromRegistry = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
): TextGenerationShape => {
  const base = makeUngatedTextGenerationFromRegistry(registry);
  return {
    generateCommitMessage: (input) =>
      executeWhenGated(input.modelSelection.instanceId, base.generateCommitMessage(input)),
    generatePrContent: (input) =>
      executeWhenGated(input.modelSelection.instanceId, base.generatePrContent(input)),
    generateBranchName: (input) =>
      executeWhenGated(input.modelSelection.instanceId, base.generateBranchName(input)),
    generateThreadTitle: (input) =>
      executeWhenGated(input.modelSelection.instanceId, base.generateThreadTitle(input)),
    generateDiffSummary: (input) =>
      executeWhenGated(input.modelSelection.instanceId, base.generateDiffSummary(input)),
    generateTranscriptionPostProcessing: (input) =>
      executeWhenGated(
        input.modelSelection.instanceId,
        base.generateTranscriptionPostProcessing!(input),
      ),
    generateReviewGuide: (input) =>
      executeWhenGated(input.modelSelection.instanceId, base.generateReviewGuide!(input)),
    generateTeammateProfile: (input) =>
      executeWhenGated(input.modelSelection.instanceId, base.generateTeammateProfile!(input)),
    generateStructuredTesting: (input) =>
      executeWhenGated(input.modelSelection.instanceId, base.generateStructuredTesting(input)),
  };
};

export const layer = Layer.effect(
  TextGeneration,
  Effect.gen(function* () {
    const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    const settings = yield* ServerSettingsService;
    return withLocalGitGeneration(
      makeTextGenerationFromRegistry(registry),
      settings.getSettings.pipe(Effect.map((value) => value.commitDraftLocalModel)),
    );
  }),
);
