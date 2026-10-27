import * as Schema from "effect/Schema";
import type {
  CommitMessageGenerationInput,
  CommitMessageGenerationResult,
  PrContentGenerationInput,
  DiffSummaryGenerationInput,
  TextGenerationShape,
} from "./TextGeneration";
import * as Effect from "effect/Effect";
import { TextGenerationError } from "@tabs/contracts";
import { CommitDraftContext } from "../git/CommitDraftContext";
import {
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildDiffSummaryPrompt,
} from "./TextGenerationPrompts";
import { toJsonSchemaObject } from "./TextGenerationUtils";

const LOCAL_OLLAMA = "http://127.0.0.1:11434";
type LocalFetch = (
  url: string,
  options?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

function validateLocalModel(model: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model) || /cloud/i.test(model))
    throw new Error(
      "Choose a downloaded local Ollama model, such as qwen3:1.7b, in Settings > Source Control.",
    );
}

export async function isLocalCommitModelReady(
  model: string,
  signal: AbortSignal,
  fetchImpl: LocalFetch = fetch,
): Promise<boolean> {
  validateLocalModel(model);
  try {
    const response = await fetchImpl(`${LOCAL_OLLAMA}/api/tags`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(1_500)]),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as {
      models?: { name?: string; remote_host?: string }[];
    };
    return payload.models?.some((item) => item.name === model && !item.remote_host) === true;
  } catch (error) {
    if (signal.aborted) throw error;
    return false;
  }
}

export async function generateLocalCommitMessage(
  input: CommitMessageGenerationInput,
  model: string,
  signal: AbortSignal,
  fetchImpl: LocalFetch = fetch,
): Promise<CommitMessageGenerationResult> {
  return generateLocalDraft(
    buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary.slice(0, 4_000),
      stagedPatch: samplePatch(input.stagedPatch),
      ...(input.includeBranch ? { includeBranch: true } : {}),
      policy: input.policy,
    }),
    model,
    signal,
    fetchImpl,
    512,
    "commit draft",
  );
}

function samplePatch(patch: string): string {
  const context = new CommitDraftContext();
  context.push(new TextEncoder().encode(patch));
  return (context.render() || patch).slice(0, 20_000);
}

export async function generateLocalPrContent(
  input: PrContentGenerationInput,
  model: string,
  signal: AbortSignal,
  fetchImpl: LocalFetch = fetch,
) {
  const generated = await generateLocalDraft(
    buildPrContentPrompt({
      ...input,
      commitSummary: input.commitSummary.slice(0, 4_000),
      diffSummary: input.diffSummary.slice(0, 4_000),
      diffPatch: samplePatch(input.diffPatch),
    }),
    model,
    signal,
    fetchImpl,
    1536,
    "pull request draft",
  );
  return { ...generated, body: markUnverifiedTesting(generated.body) };
}

/** Draft generation has no test-execution evidence. Never imply that suggested checks passed. */
export function markUnverifiedTesting(body: string): string {
  const lines = body.split("\n");
  const output: string[] = [];
  let testingLevel = 0;
  let found = false;
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (testingLevel) {
      if (!heading || heading[1]!.length > testingLevel) continue;
      testingLevel = 0;
    }
    if (heading && /\b(test|tests|testing|verification|validation|checks)\b/i.test(heading[2]!)) {
      output.push(line, "", "- Not run (generation does not execute checks).", "");
      testingLevel = heading[1]!.length;
      found = true;
    } else output.push(line.replace(/^(\s*[-*]\s*)\[[xX]\]/, "$1[ ]"));
  }
  if (!found) output.push("", "## Testing", "", "- Not run (generation does not execute checks).");
  return output.join("\n").trim();
}

export function generateLocalDiffSummary(
  input: DiffSummaryGenerationInput,
  model: string,
  signal: AbortSignal,
  fetchImpl: LocalFetch = fetch,
) {
  return generateLocalDraft(
    buildDiffSummaryPrompt({
      ...input,
      diffSummary: input.diffSummary.slice(0, 4_000),
      diffPatch: samplePatch(input.diffPatch),
      includeFindings: true,
    }),
    model,
    signal,
    fetchImpl,
    1536,
    "diff summary",
  );
}

/** Only Git writing operations use Ollama; agent sessions and other tasks keep their providers. */
export function withLocalGitGeneration(
  remote: TextGenerationShape,
  getModel: Effect.Effect<string, unknown>,
  fetchImpl: LocalFetch = fetch,
): TextGenerationShape {
  const run = <A>(
    operation: string,
    generate: (model: string, signal: AbortSignal) => Promise<A>,
  ) =>
    getModel.pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
      ),
      Effect.flatMap((model) =>
        Effect.tryPromise({
          try: (signal) => generate(model, signal),
          catch: (cause) =>
            new TextGenerationError({
              operation,
              detail: cause instanceof Error ? cause.message : String(cause),
            }),
        }),
      ),
    );
  return {
    ...remote,
    generateCommitMessage: (input) =>
      run("generateCommitMessage", (model, signal) =>
        generateLocalCommitMessage(input, model, signal, fetchImpl),
      ),
    generatePrContent: (input) =>
      run("generatePrContent", (model, signal) =>
        generateLocalPrContent(input, model, signal, fetchImpl),
      ),
    generateDiffSummary: (input) =>
      run("generateDiffSummary", (model, signal) =>
        generateLocalDiffSummary(input, model, signal, fetchImpl),
      ),
  };
}

async function generateLocalDraft<A>(
  { prompt, outputSchema }: { prompt: string; outputSchema: Schema.Codec<A, unknown> },
  model: string,
  signal: AbortSignal,
  fetchImpl: LocalFetch,
  maxOutput: number,
  draftName: string,
): Promise<A> {
  validateLocalModel(model);
  if (!(await isLocalCommitModelReady(model, signal, fetchImpl))) {
    throw new Error(
      `Start Ollama and download ${model} before generating locally. Run ollama pull ${model}; generation preferences are in Settings > Source Control.`,
    );
  }
  let response: Pick<Response, "ok" | "status" | "json">;
  try {
    response = await fetchImpl(`${LOCAL_OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        messages: [{ role: "user", content: prompt }],
        format: toJsonSchemaObject(outputSchema),
        options: { temperature: 0.1, num_ctx: 12288, num_predict: maxOutput },
        keep_alive: "5m",
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(75_000)]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(
      "Local generation is unavailable. Start Ollama and run ollama pull qwen3:1.7b, then try again. Configure generation in Settings > Source Control.",
    );
  }
  if (!response.ok)
    throw new Error(
      `Ollama could not generate a draft (HTTP ${response.status}). Make sure ${model} is downloaded in Ollama. Your message was kept.`,
    );
  const payload = (await response.json()) as { message?: { content?: string } };
  try {
    const parsed = JSON.parse(payload.message?.content ?? "");
    return Schema.decodeUnknownSync(outputSchema)(parsed);
  } catch {
    throw new Error(
      `The local model returned an invalid ${draftName}. Your message was kept. Try again, or choose another local model in Settings > Source Control.`,
    );
  }
}
