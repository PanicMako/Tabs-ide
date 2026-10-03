import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  MODEL_SLUG_ALIASES_BY_PROVIDER,
  type ModelCapabilities,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
} from "@tabs/contracts";

const DEFAULT_PROVIDER_DRIVER_KIND = "codex" as ProviderDriverKind;

export interface SelectableModelOption {
  slug: string;
  name: string;
}

export function createModelCapabilities(input: {
  optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
}): ModelCapabilities {
  const descriptors = input.optionDescriptors;
  const selects = descriptors.filter(
    (d): d is Extract<ProviderOptionDescriptor, { type: "select" }> => d.type === "select",
  );
  const booleans = descriptors.filter(
    (d): d is Extract<ProviderOptionDescriptor, { type: "boolean" }> => d.type === "boolean",
  );
  // Derive the legacy typed capability fields the web UI renders from.
  const effortDescriptor =
    selects.find((d) => d.id === "reasoningEffort" || d.id === "effort") ?? selects[0];
  return {
    optionDescriptors: descriptors.map(cloneDescriptor),
    reasoningEffortLevels:
      effortDescriptor?.options.map((option) => ({
        value: option.id ?? (option as any).value,
        label: option.label,
        ...(option.isDefault !== undefined ? { isDefault: option.isDefault } : {}),
      })) ?? [],
    promptInjectedEffortLevels: [...(effortDescriptor?.promptInjectedValues ?? [])],
    supportsFastMode: booleans.some((d) => d.id === "fastMode"),
    supportsThinkingToggle: booleans.some((d) => d.id === "thinking"),
  };
}

function getRawSelectionValueById(
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  id: string,
): string | boolean | undefined {
  // Defensive: although typed as an array, persisted/migrated draft state can
  // carry the legacy object-map shape of model options. Treat anything that
  // isn't an array as "no selections" rather than throwing
  // (`selections.find is not a function`) during composer render.
  if (!Array.isArray(selections)) {
    return undefined;
  }
  const selection = selections.find((candidate) => candidate.id === id);
  return selection?.value;
}

export function getProviderOptionSelectionValue(
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  id: string,
): string | boolean | undefined {
  return getRawSelectionValueById(selections, id);
}

export function getProviderOptionStringSelectionValue(
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  id: string,
): string | undefined {
  const value = getProviderOptionSelectionValue(selections, id);
  return typeof value === "string" ? value : undefined;
}

export function getProviderOptionBooleanSelectionValue(
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  id: string,
): boolean | undefined {
  const value = getProviderOptionSelectionValue(selections, id);
  return typeof value === "boolean" ? value : undefined;
}

export function getModelSelectionOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): string | boolean | undefined {
  return getProviderOptionSelectionValue(modelSelection?.options, id);
}

export function getModelSelectionStringOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): string | undefined {
  return getProviderOptionStringSelectionValue(modelSelection?.options, id);
}

export function getModelSelectionBooleanOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): boolean | undefined {
  return getProviderOptionBooleanSelectionValue(modelSelection?.options, id);
}

function resolveDescriptorChoiceValue(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
  raw: string | null | undefined,
): string | undefined {
  const trimmed = trimOrNull(raw);
  if (!trimmed) {
    return descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id;
  }
  if (descriptor.options.length === 0) {
    return trimmed;
  }
  // Allow prompt injected values to stick in the UI if they are valid options
  if (descriptor.options.some((option) => option.id === trimmed)) {
    return trimmed;
  }
  return descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id;
}

function cloneDescriptor(descriptor: ProviderOptionDescriptor): ProviderOptionDescriptor {
  return descriptor.type === "select"
    ? {
        ...descriptor,
        options: [...descriptor.options],
        ...(descriptor.promptInjectedValues
          ? { promptInjectedValues: [...descriptor.promptInjectedValues] }
          : {}),
      }
    : { ...descriptor };
}

function cloneSelection(selection: ProviderOptionSelection): ProviderOptionSelection {
  return { ...selection };
}

function withDescriptorCurrentValue(
  descriptor: ProviderOptionDescriptor,
  rawCurrentValue: string | boolean | undefined,
): ProviderOptionDescriptor {
  if (descriptor.type === "boolean") {
    if (typeof rawCurrentValue === "boolean") {
      return {
        ...descriptor,
        currentValue: rawCurrentValue,
      };
    }
    return descriptor;
  }
  const currentValue =
    typeof rawCurrentValue === "string"
      ? resolveDescriptorChoiceValue(descriptor, rawCurrentValue)
      : resolveDescriptorChoiceValue(descriptor, descriptor.currentValue);
  if (!currentValue) {
    const { currentValue: _unusedCurrentValue, ...rest } = descriptor;
    return rest;
  }
  return {
    ...descriptor,
    currentValue,
  };
}

export function getProviderOptionDescriptors(input: {
  caps: ModelCapabilities;
  selections?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
}): ReadonlyArray<ProviderOptionDescriptor> {
  const { caps, selections } = input;
  const baseDescriptors = (caps.optionDescriptors ?? []).map(cloneDescriptor);

  return baseDescriptors.map((descriptor) =>
    withDescriptorCurrentValue(
      descriptor,
      getRawSelectionValueById(selections, descriptor.id) ?? descriptor.currentValue,
    ),
  );
}

export function getProviderOptionCurrentValue(
  descriptor: ProviderOptionDescriptor | null | undefined,
): string | boolean | undefined {
  if (!descriptor) {
    return undefined;
  }
  if (descriptor.type === "boolean") {
    return descriptor.currentValue;
  }
  if (descriptor.currentValue) {
    return descriptor.currentValue;
  }
  const defaultOption = descriptor.options.find((option) => option.isDefault);
  return defaultOption ? (defaultOption.id ?? (defaultOption as any).value) : undefined;
}

export function getProviderOptionCurrentLabel(
  descriptor: ProviderOptionDescriptor | null | undefined,
): string | undefined {
  if (!descriptor) {
    return undefined;
  }
  if (descriptor.type === "boolean") {
    return typeof descriptor.currentValue === "boolean"
      ? descriptor.currentValue
        ? "On"
        : "Off"
      : undefined;
  }
  const currentValue = getProviderOptionCurrentValue(descriptor);
  if (typeof currentValue !== "string") {
    return undefined;
  }
  return descriptor.options.find(
    (option) => option.id === currentValue || (option as any).value === currentValue,
  )?.label;
}

export function buildProviderOptionSelectionsFromDescriptors(
  descriptors: ReadonlyArray<ProviderOptionDescriptor> | null | undefined,
): Array<ProviderOptionSelection> | undefined {
  if (!descriptors || descriptors.length === 0) {
    return undefined;
  }

  const nextSelections: Array<ProviderOptionSelection> = [];

  for (const descriptor of descriptors) {
    const value = getProviderOptionCurrentValue(descriptor);
    if (typeof value === "string" || typeof value === "boolean") {
      nextSelections.push({ id: descriptor.id, value });
    }
  }

  return nextSelections.length > 0 ? nextSelections : undefined;
}

export function getModelSelectionOptionDescriptors(
  modelSelection: ModelSelection | null | undefined,
  caps?: ModelCapabilities | null | undefined,
): ReadonlyArray<ProviderOptionDescriptor> {
  if (!modelSelection) {
    return [];
  }
  if (!caps) {
    return [];
  }
  return getProviderOptionDescriptors({
    caps,
    selections: modelSelection.options,
  });
}

export function isClaudeUltrathinkPrompt(text: string | null | undefined): boolean {
  return typeof text === "string" && /\bultrathink\b/i.test(text);
}

export function normalizeModelSlug(
  model: string | null | undefined,
  // Accepts any provider/instance slug (callers pass `ProviderKind` literals or
  // `ProviderInstanceId`s); the per-provider lookup tables are keyed by driver
  // kind and indexed via a cast.
  provider: string = DEFAULT_PROVIDER_DRIVER_KIND,
): string | null {
  if (typeof model !== "string") {
    return null;
  }

  const trimmed = model.trim();
  if (!trimmed) {
    return null;
  }

  const aliases = MODEL_SLUG_ALIASES_BY_PROVIDER[provider as ProviderDriverKind] ?? {};
  const aliased = Object.prototype.hasOwnProperty.call(aliases, trimmed)
    ? aliases[trimmed]
    : undefined;
  return typeof aliased === "string" ? aliased : trimmed;
}

export function resolveSelectableModel(
  provider: string,
  value: string | null | undefined,
  options: ReadonlyArray<SelectableModelOption>,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const direct = options.find((option) => option.slug === trimmed);
  if (direct) {
    return direct.slug;
  }

  const byName = options.find((option) => option.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) {
    return byName.slug;
  }

  const normalized = normalizeModelSlug(trimmed, provider);
  if (!normalized) {
    return null;
  }

  const resolved = options.find((option) => option.slug === normalized);
  return resolved ? resolved.slug : null;
}

function resolveModelSlug(model: string | null | undefined, provider: string): string {
  const normalized = normalizeModelSlug(model, provider);
  if (!normalized) {
    if (provider === "copilot") return "";
    return DEFAULT_MODEL_BY_PROVIDER[provider as ProviderDriverKind] ?? DEFAULT_MODEL;
  }
  return normalized;
}

export function resolveModelSlugForProvider(
  provider: string,
  model: string | null | undefined,
): string {
  return resolveModelSlug(model, provider);
}

/** Trim a string, returning null for empty/missing values. */
export function trimOrNull<T extends string>(value: T | null | undefined): T | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim() as T;
  return trimmed || null;
}

function cloneSelections(
  selections: ReadonlyArray<ProviderOptionSelection>,
): Array<ProviderOptionSelection> {
  return selections.map(cloneSelection);
}

export function createModelSelection(
  instanceId: ProviderInstanceId,
  model: string,
  options?: ReadonlyArray<ProviderOptionSelection> | null,
): ModelSelection {
  const selections = options ? cloneSelections(options) : [];
  const base: ModelSelection = {
    instanceId,

    model,
  };
  return selections.length > 0 ? { ...base, options: selections } : base;
}

/**
 * Returns the effort value if it is a prompt-injected value according to
 * any select descriptor in the given capabilities, or null otherwise.
 *
 * Unlike a single `find`, this checks every descriptor so that the
 * correct descriptor's `promptInjectedValues` list is consulted even when
 * multiple select descriptors exist.
 */
export function resolvePromptInjectedEffort(
  caps: ModelCapabilities,
  rawEffort: string | null | undefined,
): string | null {
  const trimmed = trimOrNull(rawEffort);
  if (!trimmed) return null;
  const descriptors = getProviderOptionDescriptors({ caps });
  for (const descriptor of descriptors) {
    if (descriptor.type === "select" && descriptor.promptInjectedValues?.includes(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

export function applyClaudePromptEffortPrefix(
  text: string,
  effort: string | null | undefined,
): string {
  if (effort !== "ultrathink") {
    // Strip the prefix if it exists when going back to a lower effort
    const match = text.match(/^Ultrathink:\s*\n?/i);
    if (match) {
      return text.slice(match[0].length);
    }
    return text;
  }

  const trimmed = text.trimStart();
  if (!trimmed) {
    return "Ultrathink:\n";
  }
  if (trimmed.toLowerCase().startsWith("ultrathink:")) {
    return text;
  }
  return `Ultrathink:\n${text}`;
}

// ── Compat shims: pre-migration ModelCapabilities (effort) + default model ──
// The old capabilities carried `reasoningEffortLevels`; the new contracts use
// generic `optionDescriptors`. These keep the web building until it adopts the
// descriptor model directly (provider migration Stage F).

const selectOptionDescriptors = (caps: ModelCapabilities) =>
  (caps.optionDescriptors ?? []).filter(
    (d): d is Extract<ProviderOptionDescriptor, { type: "select" }> => d.type === "select",
  );

export function getDefaultModel(provider: string = "codex"): string {
  if (provider === "copilot") return "";
  return DEFAULT_MODEL_BY_PROVIDER[provider as ProviderDriverKind] ?? DEFAULT_MODEL;
}

export function hasEffortLevel(caps: ModelCapabilities, value: string): boolean {
  if (((caps as any).reasoningEffortLevels ?? []).some((level: any) => level.value === value)) {
    return true;
  }
  // Fall back to the generic descriptor model for providers that publish
  // effort via `optionDescriptors` instead of the legacy `reasoningEffortLevels`.
  return selectOptionDescriptors(caps).some((d) => d.options.some((o) => o.id === value));
}

export function getDefaultEffort(caps: ModelCapabilities): string | null {
  const defaultLevel = ((caps as any).reasoningEffortLevels ?? []).find(
    (level: any) => level.isDefault,
  );
  if (defaultLevel) return defaultLevel.value;
  for (const descriptor of selectOptionDescriptors(caps)) {
    const fallback = descriptor.options.find((o) => o.isDefault);
    if (fallback) return fallback.id;
  }
  return null;
}
