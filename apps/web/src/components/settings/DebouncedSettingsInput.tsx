import React from "react";
import { Input } from "~/components/ui/input";
import { useDebouncedSettingField } from "../../hooks/useSettings";

export interface DebouncedSettingsInputProps extends Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange"
> {
  readonly value: string;
  readonly onPersist: (val: string) => void | Promise<boolean>;
  readonly delay?: number;
}

/**
 * An accessible text input for continuous settings fields that maintains
 * responsive local visual state while debouncing persistent backing-store writes.
 *
 * Flushes immediately on blur, Enter, component unmount, and application shutdown.
 */
export function DebouncedSettingsInput({
  value,
  onPersist,
  delay = 350,
  onBlur,
  onKeyDown,
  ...props
}: DebouncedSettingsInputProps) {
  const field = useDebouncedSettingField<string>({
    value: value ?? "",
    onPersist,
    delay,
  });

  return (
    <Input
      {...props}
      value={field.value}
      onChange={(e) => field.onChange(e.target.value)}
      onBlur={(e) => {
        field.onBlur();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        field.onKeyDown(e);
        onKeyDown?.(e);
      }}
    />
  );
}
