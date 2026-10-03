import {
  type ModelSlug,
  type ProviderKind,
  type ProviderOptionSelection,
  type ServerProviderModel,
  type ThreadId,
} from "@tabs/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isClaudeUltrathinkPrompt,
} from "@tabs/shared/model";
import type { ReactNode } from "react";
import { getProviderModelCapabilities } from "../../providerModels";

// Composer model state and trait controls are derived entirely from the
// selected model's capabilities/option descriptors, so these work for any
// provider/driver (codex, claude, cursor, grok, opencode, …) uniformly.
// Options flow as the canonical `ProviderOptionSelection[]` wire form — no
// per-provider typed-option shims.
// Options are configured by each provider dynamically.

export type ComposerProviderStateInput = {
  provider: ProviderKind;
  model: ModelSlug;
  models: ReadonlyArray<ServerProviderModel>;
  prompt: string;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
};

export type ComposerProviderState = {
  provider: ProviderKind;
  promptEffort: string | null;
  modelOptionsForDispatch: ReadonlyArray<ProviderOptionSelection> | undefined;
  composerFrameClassName?: string;
  composerSurfaceClassName?: string;
  modelPickerIconClassName?: string;
};

export function getComposerProviderState(input: ComposerProviderStateInput): ComposerProviderState {
  const { provider, model, models, prompt, modelOptions } = input;
  const caps = getProviderModelCapabilities(models, model, provider);
  const descriptors = getProviderOptionDescriptors({ caps, selections: modelOptions });
  const primarySelectDescriptor = descriptors.find(
    (descriptor): descriptor is Extract<(typeof descriptors)[number], { type: "select" }> =>
      descriptor.type === "select" &&
      (descriptor.id === "reasoningEffort" ||
        descriptor.id === "effort" ||
        descriptor.id === "reasoning" ||
        descriptor.id === "variant" ||
        descriptor.id.toLowerCase().includes("effort") ||
        descriptor.id.toLowerCase().includes("reasoning") ||
        descriptor.id.toLowerCase().includes("variant")),
  );
  const primaryValue = getProviderOptionCurrentValue(primarySelectDescriptor ?? null);
  const promptEffort = typeof primaryValue === "string" ? primaryValue : null;
  const explicitEffort = modelOptions?.find(
    (o) =>
      o.id === "effort" ||
      o.id === "reasoningEffort" ||
      o.id === "reasoning" ||
      (o as any).name === "effort",
  )?.value;
  const isPromptControlled = explicitEffort === undefined && isClaudeUltrathinkPrompt(prompt);
  const ultrathinkActive =
    (primarySelectDescriptor?.promptInjectedValues?.length ?? 0) > 0 &&
    (promptEffort === "ultrathink" || isPromptControlled);

  return {
    provider,
    promptEffort,
    modelOptionsForDispatch: buildProviderOptionSelectionsFromDescriptors(descriptors),
    ...(ultrathinkActive
      ? {
          composerFrameClassName: "ultrathink-frame",
          composerSurfaceClassName:
            "border-transparent shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]",
          modelPickerIconClassName: "ultrathink-chroma",
        }
      : {}),
  };
}
