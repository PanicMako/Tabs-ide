import type { ProviderOptionDescriptor, ProviderOptionSelection } from "@tabs/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentValue,
} from "@tabs/shared/model";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

/** The option that holds how hard the model thinks: the first real choice list that is not the agent. */
export function effortDescriptor(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): SelectDescriptor | null {
  return (
    descriptors.find(
      (descriptor): descriptor is SelectDescriptor =>
        descriptor.type === "select" && descriptor.id !== "agent" && descriptor.options.length > 1,
    ) ?? null
  );
}

/**
 * The selections after moving the effort one step up or down, or null when there is nowhere to
 * go: no effort option, or already at the end. It does not wrap, so a held key stops at the limit.
 */
export function stepEffort(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  direction: 1 | -1,
): Array<ProviderOptionSelection> | null {
  const effort = effortDescriptor(descriptors);
  if (!effort) return null;
  // Choices that only exist as a typed prefix (like "ultrathink") are not steps on the ladder.
  const ladder = effort.options.filter(
    (option) => !effort.promptInjectedValues?.includes(option.id),
  );
  const current = getProviderOptionCurrentValue(effort);
  const index = ladder.findIndex((option) => option.id === current);
  const nextIndex = index === -1 ? (direction === 1 ? 0 : ladder.length - 1) : index + direction;
  const next = ladder[nextIndex];
  if (!next || nextIndex === index) return null;
  const updated = descriptors.map((descriptor) =>
    descriptor === effort ? { ...effort, currentValue: next.id } : descriptor,
  );
  return buildProviderOptionSelectionsFromDescriptors(updated) ?? null;
}
