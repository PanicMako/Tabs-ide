import {
  type ModelSelection,
  ProviderInstanceId,
  type ProviderKind,
  type ServerProvider,
} from "@tabs/contracts";
import { normalizeModelSlug, resolveSelectableModel } from "@tabs/shared/model";
import { type ProviderPickerKind } from "./session-logic";
import { getComposerProviderState } from "./components/chat/composerProviderRegistry";
import { UnifiedSettings } from "@tabs/contracts/settings";
import {
  getDefaultServerModel,
  getProviderModels,
  resolveSelectableProvider,
} from "./providerModels";
import { deriveProviderInstanceEntries } from "./providerInstances";

const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;

const AUTHORITATIVE_RUNTIME_CATALOG_PROVIDERS = new Set([
  "claudeAgent",
  "cursor",
  "copilot",
  "grok",
]);

// ── Model-selection / option-shape bridges (web ↔ wire) ────────────────
// The wire `ModelSelection` routes on `instanceId` and carries options as the
// canonical `{ id, value }[]` array. The web composer still works with a
// `provider` slug and typed per-provider option objects, so these helpers
// bridge the two shapes. For the built-in single-instance providers the
// instance id equals the provider/driver slug.

export type ModelOptionSelections = ReadonlyArray<{
  readonly id: string;
  readonly value: string | boolean;
}>;

/** Build a wire `ModelSelection` from a provider slug + model + typed options. */
export function makeAppModelSelection(
  provider: string,
  model: string,
  options?: ModelOptionSelections | null,
): ModelSelection {
  const instanceId = ProviderInstanceId.makeUnsafe(provider);
  return {
    instanceId,
    model,
    ...(options && options.length > 0 ? { options } : {}),
  };
}

/** Convert a typed option object (`{ reasoningEffort, fastMode, … }`) to the array form. */
export function typedOptionsToSelections(
  options: Record<string, string | boolean | undefined> | null | undefined,
): ModelOptionSelections | undefined {
  if (!options) return undefined;
  const entries: Array<{ id: string; value: string | boolean }> = [];
  for (const [id, value] of Object.entries(options)) {
    if (value === undefined || value === null) continue;
    entries.push({ id, value });
  }
  return entries.length > 0 ? entries : undefined;
}

/** Convert the array option form back to a plain typed option object. */
export function selectionsToTypedOptions(
  selections: ModelOptionSelections | null | undefined,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const { id, value } of selections ?? []) out[id] = value;
  return out;
}

/** Read the provider/instance slug from a wire selection (instanceId is authoritative). */
export function modelSelectionProvider(
  selection: ModelSelection | null | undefined,
): string | null {
  return selection?.instanceId ?? null;
}

export type ProviderCustomModelConfig = {
  provider: ProviderKind;
  title: string;
  description: string;
  placeholder: string;
  example: string;
};

export interface AppModelOption {
  slug: string;
  name: string;
  isCustom: boolean;
}

const PROVIDER_CUSTOM_MODEL_CONFIG: Record<ProviderKind, ProviderCustomModelConfig> = {
  codex: {
    provider: "codex",
    title: "Codex",
    description: "Save additional Codex model slugs for the picker and `/model` command.",
    placeholder: "your-codex-model-slug",
    example: "gpt-6.7-codex-ultra-preview",
  },
  claudeAgent: {
    provider: "claudeAgent",
    title: "Claude",
    description: "Save additional Claude model slugs for the picker and `/model` command.",
    placeholder: "your-claude-model-slug",
    example: "claude-sonnet-5-0",
  },
};

export const MODEL_PROVIDER_SETTINGS = Object.values(PROVIDER_CUSTOM_MODEL_CONFIG);

export function normalizeCustomModelSlugs(
  models: Iterable<string | null | undefined>,
  builtInModelSlugs: ReadonlySet<string>,
  provider: string = "codex",
): string[] {
  const normalizedModels: string[] = [];
  const seen = new Set<string>();

  for (const candidate of models) {
    const normalized = normalizeModelSlug(candidate, provider);
    if (
      !normalized ||
      normalized.length > MAX_CUSTOM_MODEL_LENGTH ||
      builtInModelSlugs.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    normalizedModels.push(normalized);
    if (normalizedModels.length >= MAX_CUSTOM_MODEL_COUNT) {
      break;
    }
  }

  return normalizedModels;
}

import { applyCustomModelOrdering } from "./modelOrdering";

export function getAppModelOptions(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  provider: string,
  selectedModel?: string | null,
): AppModelOption[] {
  const options: AppModelOption[] = getProviderModels(providers, provider).map(
    ({ slug, name, isCustom }) => ({
      slug,
      name,
      isCustom,
    }),
  );
  const seen = new Set(options.map((option) => option.slug));
  const trimmedSelectedModel = selectedModel?.trim().toLowerCase();
  const builtInModelSlugs = new Set(
    getProviderModels(providers, provider)
      .filter((model) => !model.isCustom)
      .map((model) => model.slug),
  );

  const customModels = AUTHORITATIVE_RUNTIME_CATALOG_PROVIDERS.has(provider)
    ? []
    : ((settings.providers as Record<string, { customModels?: ReadonlyArray<string> }>)?.[provider]
        ?.customModels ?? []);
  for (const slug of normalizeCustomModelSlugs(customModels, builtInModelSlugs, provider)) {
    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    options.push({
      slug,
      name: slug,
      isCustom: true,
    });
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  const selectedModelMatchesExistingName =
    typeof trimmedSelectedModel === "string" &&
    options.some((option) => option.name.toLowerCase() === trimmedSelectedModel);
  if (
    !AUTHORITATIVE_RUNTIME_CATALOG_PROVIDERS.has(provider) &&
    normalizedSelectedModel &&
    !seen.has(normalizedSelectedModel) &&
    !selectedModelMatchesExistingName
  ) {
    options.push({
      slug: normalizedSelectedModel,
      name: normalizedSelectedModel,
      isCustom: true,
    });
  }

  const prefs = settings.providerModelPreferences?.[provider as any];
  const hiddenSet = new Set(prefs?.hiddenModels ?? []);
  const visibleOptions = options.filter(
    (option) =>
      option.isCustom ||
      !hiddenSet.has(option.slug) ||
      (selectedModel && (option.slug === selectedModel || option.slug === normalizedSelectedModel)),
  );
  return applyCustomModelOrdering(visibleOptions, prefs?.modelOrder);
}

export function resolveAppModelSelection(
  provider: string,
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedModel: string | null | undefined,
): string {
  const resolvedProvider = resolveSelectableProvider(providers, provider);
  const options = getAppModelOptions(settings, providers, resolvedProvider, selectedModel);
  return (
    resolveSelectableModel(resolvedProvider, selectedModel, options) ??
    getDefaultServerModel(providers, resolvedProvider)
  );
}

// Every provider that can back text generation server-side (commit messages,
// PR content, …). The server `TextGenerationProvider` covers all of these and
// routes on `instanceId`, so the picker must offer them all — not just the two
// legacy `ProviderKind` values. Providers with no resolvable models are filtered
// out by the caller, so unauthenticated/uninstalled ones simply don't appear.
const TEXT_GEN_PROVIDER_KEYS = [
  "codex",
  "claudeAgent",
  "cursor",
  "copilot",
  "grok",
  "opencode",
  "kilo",
] as const satisfies ReadonlyArray<ProviderPickerKind & keyof UnifiedSettings["providers"]>;

export function getCustomModelOptionsByProvider(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedProvider?: string | null,
  selectedModel?: string | null,
): Record<ProviderPickerKind, ReadonlyArray<{ slug: string; name: string }>> {
  const result = {} as Record<ProviderPickerKind, AppModelOption[]>;
  for (const provider of TEXT_GEN_PROVIDER_KEYS) {
    result[provider] = getAppModelOptions(
      settings,
      providers,
      provider,
      selectedProvider === provider ? selectedModel : undefined,
    );
  }
  return result;
}

export function resolveAppModelSelectionState(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection {
  const selection = settings.textGenerationModelSelection;
  const selectionProvider = selection?.instanceId ?? "codex";
  const provider = resolveSelectableProvider(providers, selectionProvider);

  // When the provider changed due to fallback (e.g. selected provider was disabled),
  // don't carry over the old provider's model — use the fallback provider's default.
  const selectedModel = provider === selectionProvider ? (selection?.model ?? null) : null;
  const model = resolveAppModelSelection(provider, settings, providers, selectedModel);
  const { modelOptionsForDispatch } = getComposerProviderState({
    provider: provider as ProviderKind,
    model,
    models: getProviderModels(providers, provider),
    prompt: "",
    modelOptions: provider === selectionProvider ? selection?.options : undefined,
  });

  return makeAppModelSelection(provider, model, modelOptionsForDispatch);
}

/**
 * Instance-keyed model options map. Each configured instance gets its own
 * option list so the model picker can show the same driver's built-in and
 * custom instances side by side without collapsing them.
 */
export function getCustomModelOptionsByInstance(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  _selectedInstanceId?: ProviderInstanceId | null,
  _selectedModel?: string | null,
): ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>> {
  const out = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
  for (const entry of deriveProviderInstanceEntries(providers)) {
    out.set(
      entry.instanceId,
      getAppModelOptions(
        settings,
        providers,
        entry.driverKind as string,
        _selectedInstanceId === entry.instanceId ? _selectedModel : undefined,
      ),
    );
  }
  return out;
}
