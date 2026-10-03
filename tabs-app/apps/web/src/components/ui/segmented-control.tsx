import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  className,
  itemClassName,
  size = "default",
  "aria-label": ariaLabel,
}: {
  value: T;
  onValueChange: (val: T) => void;
  options: ReadonlyArray<SegmentOption<T>>;
  className?: string;
  itemClassName?: string;
  size?: "sm" | "default";
  "aria-label"?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("tabs-segmented inline-flex items-center select-none", className)}
    >
      {options.map((opt, index) => {
        const isSelected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={opt.ariaLabel}
            tabIndex={isSelected ? 0 : -1}
            disabled={opt.disabled}
            onClick={() => onValueChange(opt.value)}
            onKeyDown={(event) => {
              const direction =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!direction && event.key !== "Home" && event.key !== "End") return;
              event.preventDefault();
              let next = event.key === "Home" ? -1 : event.key === "End" ? options.length : index;
              const step = event.key === "Home" ? 1 : event.key === "End" ? -1 : direction;
              for (let attempt = 0; attempt < options.length; attempt += 1) {
                next = (next + step + options.length) % options.length;
                const target = options[next];
                if (!target || target.disabled) continue;
                onValueChange(target.value);
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>('button[role="radio"]')
                  [next]?.focus();
                break;
              }
            }}
            className={cn(
              "font-semibold rounded-md transition-all whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5",
              size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-xs",
              isSelected
                ? "font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
              opt.disabled && "opacity-50 cursor-not-allowed",
              itemClassName,
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
