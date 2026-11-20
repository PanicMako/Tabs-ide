/** Colours a provider account can be tagged with, so two accounts of one provider are easy to tell apart. */
export const PROVIDER_ACCENT_CHOICES: ReadonlyArray<{
  readonly label: string;
  readonly value: string;
}> = [
  { label: "Blue", value: "#4f7cff" },
  { label: "Green", value: "#2f9e6e" },
  { label: "Amber", value: "#c98a1b" },
  { label: "Red", value: "#d05353" },
  { label: "Violet", value: "#8465d6" },
  { label: "Slate", value: "#6b7280" },
];

/** The instance with its accent set, or cleared when `value` is null. Other fields are kept. */
export function withProviderAccent<T extends object>(instance: T, value: string | null): T {
  const { accentColor: _previous, ...rest } = instance as T & { accentColor?: string };
  return (value === null ? rest : { ...rest, accentColor: value }) as T;
}
