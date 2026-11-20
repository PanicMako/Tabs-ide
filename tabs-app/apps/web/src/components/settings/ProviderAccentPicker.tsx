import { PROVIDER_ACCENT_CHOICES } from "./providerAccent";

/** A row of small colour swatches for tagging a provider account. Picking the chosen one again clears it. */
export function ProviderAccentPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string | undefined;
  onChange: (value: string | null) => void;
}) {
  return (
    <div role="group" aria-label={`Colour for ${name}`} className="flex items-center gap-1">
      {PROVIDER_ACCENT_CHOICES.map((choice) => {
        const selected = value === choice.value;
        return (
          <button
            key={choice.value}
            type="button"
            aria-label={`${choice.label} for ${name}`}
            aria-pressed={selected}
            title={selected ? `${choice.label} (click to clear)` : choice.label}
            onClick={() => onChange(selected ? null : choice.value)}
            className="size-4 border border-border [border-radius:var(--radius-control)] aria-pressed:ring-1 aria-pressed:ring-foreground aria-pressed:ring-offset-1 aria-pressed:ring-offset-background"
            style={{ backgroundColor: choice.value }}
          />
        );
      })}
    </div>
  );
}
