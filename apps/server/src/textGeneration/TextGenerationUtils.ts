import { TextGenerationError } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const isTextGenerationError = Schema.is(TextGenerationError);

/** Convert an Effect Schema to a flat JSON Schema object, inlining `$defs` when present. */
export function toJsonSchemaObject(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(schema);
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return { ...document.schema, $defs: document.definitions };
  }
  return document.schema;
}

function jsonSchemaExample(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null) return null;
  const node = schema as {
    const?: unknown;
    default?: unknown;
    enum?: ReadonlyArray<unknown>;
    type?: string | ReadonlyArray<string>;
    properties?: Record<string, unknown>;
    required?: ReadonlyArray<string>;
    items?: unknown;
  };
  if (node.const !== undefined) return node.const;
  if (node.default !== undefined) return node.default;
  if (node.enum && node.enum.length > 0) return node.enum[0];
  const type = Array.isArray(node.type) ? node.type.find((value) => value !== "null") : node.type;
  switch (type) {
    case "object":
      return Object.fromEntries(
        (node.required ?? []).map((key) => [key, jsonSchemaExample(node.properties?.[key])]),
      );
    case "array":
      return [];
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "string":
      return "";
    default:
      return null;
  }
}

export function buildSchemaConstrainedPrompt(prompt: string, schema: Schema.Top): string {
  const jsonSchema = toJsonSchemaObject(schema);
  return [
    prompt,
    "",
    "Structured output contract:",
    "Return exactly one JSON object that validates against this JSON Schema:",
    JSON.stringify(jsonSchema, null, 2),
    "",
    "Minimal valid example:",
    JSON.stringify(jsonSchemaExample(jsonSchema), null, 2),
    "",
    "Return the JSON object only. Do not use Markdown fences or add commentary.",
  ].join("\n");
}

export function logStructuredGenerationRequest(input: {
  readonly operation: string;
  readonly provider: string;
  readonly model: string;
  readonly schemaMode: "native" | "prompt-fallback-with-example";
}) {
  return Effect.logInfo("structured text-generation request", input);
}

/** Truncate a text section to `maxChars`, appending a `[truncated]` marker when needed. */
export function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const truncated = value.slice(0, maxChars);
  return `${truncated}\n\n[truncated]`;
}

/** Normalise a raw commit subject to imperative-mood, ≤72 chars, no trailing period. */
export function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutTrailingPeriod.length === 0) {
    return "Update project files";
  }

  if (withoutTrailingPeriod.length <= 72) {
    return withoutTrailingPeriod;
  }
  return withoutTrailingPeriod.slice(0, 72).trimEnd();
}

/** Normalise a raw PR title to a single line with a sensible fallback. */
export function sanitizePrTitle(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  if (singleLine.length > 0) {
    return singleLine;
  }
  return "Update project changes";
}

/** Normalise a raw thread title to a compact single-line sidebar-safe label. */
export function sanitizeThreadTitle(raw: string): string {
  const normalized = raw
    .trim()
    .split(/\r?\n/g)[0]
    ?.trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized || normalized.trim().length === 0) {
    return "New thread";
  }

  if (normalized.length <= 50) {
    return normalized;
  }

  return `${normalized.slice(0, 47).trimEnd()}...`;
}

/** CLI name to human-readable label, e.g. "codex" → "Codex CLI (`codex`)" */
function cliLabel(cliName: string): string {
  const capitalized = cliName.charAt(0).toUpperCase() + cliName.slice(1);
  return `${capitalized} CLI (\`${cliName}\`)`;
}

/**
 * Normalize an unknown error from a CLI text generation process into a
 * typed `TextGenerationError`. Parameterized by CLI name so both Codex
 * and Claude (and future providers) can share the same logic.
 */
export function normalizeCliError(
  cliName: string,
  operation: string,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (isTextGenerationError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes(`Command not found: ${cliName}`) ||
      lower.includes(`spawn ${cliName}`) ||
      lower.includes("enoent")
    ) {
      return new TextGenerationError({
        operation,
        detail: `${cliLabel(cliName)} is required but not available on PATH.`,
        cause: error,
      });
    }
    return new TextGenerationError({
      operation,
      detail: `${fallback}: ${error.message}`,
      cause: error,
    });
  }

  return new TextGenerationError({
    operation,
    detail: fallback,
    cause: error,
  });
}
