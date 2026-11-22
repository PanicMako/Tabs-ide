import type { VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  type selectTriggerVariants,
} from "./select";

export interface SimpleSelectOption {
  readonly value: string;
  readonly label: React.ReactNode;
  readonly disabled?: boolean;
}

/**
 * Themed replacement for a native `<select>`: an options array in, the same string value
 * out. Use `Select*` directly only when items need custom layout.
 */
export function SimpleSelect({
  value,
  onValueChange,
  options,
  "aria-label": ariaLabel,
  placeholder,
  disabled,
  size = "sm",
  className,
  popupClassName,
  align = "start",
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: ReadonlyArray<SimpleSelectOption>;
  "aria-label": string;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  size?: VariantProps<typeof selectTriggerVariants>["size"];
  className?: string | undefined;
  popupClassName?: string | undefined;
  align?: "start" | "center" | "end";
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next);
      }}
    >
      <SelectTrigger aria-label={ariaLabel} size={size} className={cn("w-auto", className)}>
        <SelectValue>{selected?.label ?? placeholder ?? ""}</SelectValue>
      </SelectTrigger>
      <SelectPopup align={align} className={popupClassName}>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            hideIndicator
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
