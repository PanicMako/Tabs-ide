import { Schema } from "effect";
import { ServerProviderModel, type ModelSourceKind } from "./server.ts";
import type { ModelCapabilities } from "./model.ts";

export const ServerProviderModelListSchema = Schema.Array(ServerProviderModel);

/**
 * Validates a single model object using Effect/Schema.
 * Returns decoded model if valid, or null if invalid.
 */
export function validateServerProviderModel(candidate: unknown): ServerProviderModel | null {
  const decode = Schema.decodeUnknownOption(ServerProviderModel);
  const result = decode(candidate);
  return result._tag === "Some" ? result.value : null;
}

/**
 * Validates an array of model objects.
 * Returns only valid items matching ServerProviderModelSchema.
 */
export function validateServerProviderModelList(candidates: unknown): ServerProviderModel[] {
  if (!Array.isArray(candidates)) return [];
  const validModels: ServerProviderModel[] = [];
  for (const item of candidates) {
    const valid = validateServerProviderModel(item);
    if (valid) {
      validModels.push(valid);
    } else {
      console.warn("[ModelDiscovery] Dropped malformed model entry from provider payload:", item);
    }
  }
  return validModels;
}

/**
 * Dynamic model capability auto-generator for unknown model slugs.
 * Infers reasoning, fastMode, and contextWindow from family patterns (opus, sonnet, gpt, gemini).
 * For unknown patterns, falls back to conservative generic defaults.
 */
export function inferModelCapabilitiesFromSlug(
  slug: string,
  _source: ModelSourceKind = "inferred",
): ModelCapabilities {
  const lower = slug.toLowerCase();

  // Pattern A1: High reasoning Claude models (Opus, Sonnet, Fable, Claude)
  if (
    lower.includes("opus") ||
    lower.includes("sonnet") ||
    lower.includes("fable") ||
    lower.includes("claude")
  ) {
    return {
      reasoningEffortLevels: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High", isDefault: true },
        { value: "xhigh", label: "Extra High" },
        { value: "max", label: "Max" },
        { value: "ultracode", label: "Ultracode" },
        { value: "ultrathink", label: "Ultrathink" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      promptInjectedEffortLevels: ["ultrathink"],
      optionDescriptors: [
        {
          id: "effort",
          label: "Reasoning",
          type: "select",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High", isDefault: true },
            { id: "xhigh", label: "Extra High" },
            { id: "max", label: "Max" },
            { id: "ultracode", label: "Ultracode" },
            { id: "ultrathink", label: "Ultrathink" },
          ],
          promptInjectedValues: ["ultrathink"],
        },
        {
          id: "fastMode",
          label: "Fast Mode",
          type: "boolean",
        },
        {
          id: "contextWindow",
          label: "Context Window",
          type: "select",
          options: [
            { id: "200k", label: "200k" },
            { id: "1m", label: "1M", isDefault: true },
          ],
        },
      ],
    };
  }

  // Pattern A2: GPT-5 / Codex high reasoning models (standard reasoning, serviceTier, no prompt injection)
  if (
    lower.includes("gpt-5") ||
    lower.includes("codex") ||
    lower.includes("gpt-4") ||
    lower.includes("o1") ||
    lower.includes("o3") ||
    lower.includes("o4")
  ) {
    return {
      reasoningEffortLevels: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High", isDefault: true },
        { value: "xhigh", label: "Extra High" },
        { value: "max", label: "Max" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      promptInjectedEffortLevels: [],
      optionDescriptors: [
        {
          id: "reasoningEffort",
          label: "Reasoning",
          type: "select",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High", isDefault: true },
            { id: "xhigh", label: "Extra High" },
            { id: "max", label: "Max" },
          ],
        },
        {
          id: "serviceTier",
          label: "Service Tier",
          type: "select",
          options: [
            { id: "default", label: "Standard", isDefault: true },
            { id: "fast", label: "Fast" },
          ],
          currentValue: "default",
        },
      ],
    };
  }

  // Pattern B: Fast lightweight models (Haiku, Mini, Flash)
  if (lower.includes("haiku") || lower.includes("mini") || lower.includes("flash")) {
    return {
      reasoningEffortLevels: [],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      promptInjectedEffortLevels: [],
      optionDescriptors: [
        {
          id: "fastMode",
          label: "Fast Mode",
          type: "boolean",
        },
      ],
    };
  }

  // Pattern C: Conservative generic defaults for unrecognised model families
  return {
    reasoningEffortLevels: [],
    supportsFastMode: false,
    supportsThinkingToggle: false,
    promptInjectedEffortLevels: [],
    optionDescriptors: [
      {
        id: "contextWindow",
        label: "Context Window",
        type: "select",
        options: [{ id: "128k", label: "128k", isDefault: true }],
      },
    ],
  };
}
