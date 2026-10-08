import { isValidElement, Children, type ReactNode } from "react";
import { SunMoon, Moon, Sun, Clock3 } from "lucide-react";
import { OrbitGroup } from "./orbit-group";
import { cn } from "../../lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  icon?: ReactNode;
}

function labelIcon(label: ReactNode): ReactNode | undefined {
  if (!isValidElement(label)) return undefined;
  const props = label.props as { size?: number; children?: ReactNode };
  if (label.type === "svg" || (typeof label.type !== "string" && typeof props.size === "number"))
    return label;
  for (const child of Children.toArray(props.children)) {
    const icon = labelIcon(child);
    if (icon) return icon;
  }
  return undefined;
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  className,
  itemClassName,
  size = "default",
  orbitKind = "spotlight",
  "aria-label": ariaLabel,
}: {
  value: T;
  onValueChange: (val: T) => void;
  options: ReadonlyArray<SegmentOption<T>>;
  className?: string;
  itemClassName?: string;
  size?: "sm" | "default";
  orbitKind?: "spotlight" | "theme" | "time" | "icons";
  "aria-label"?: string;
}) {
  const icons = options.map((option) => option.icon ?? labelIcon(option.label));
  const kind =
    orbitKind === "spotlight" && icons.length > 0 && icons.every(Boolean) ? "icons" : orbitKind;
  const selectedSymbol = icons[options.findIndex((option) => option.value === value)];
  const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
  const tabStop =
    selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled);
  return (
    <OrbitGroup
      orbitKind={kind}
      symbol={
        kind === "theme" ? (
          value === "dark" ? (
            <Moon size={17} />
          ) : value === "light" ? (
            <Sun size={17} />
          ) : (
            <SunMoon size={17} />
          )
        ) : kind === "time" ? (
          value === "12-hour" ? (
            "12"
          ) : value === "24-hour" ? (
            "24"
          ) : (
            <Clock3 size={17} />
          )
        ) : kind === "icons" ? (
          selectedSymbol
        ) : undefined
      }
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("tabs-segmented inline-flex items-center rounded-lg select-none", className)}
    >
      {options.map((opt, index) => {
        const isSelected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            data-value={opt.value}
            aria-checked={isSelected}
            aria-label={opt.ariaLabel}
            tabIndex={index === tabStop ? 0 : -1}
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
              "font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5",
              size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-xs",
              isSelected
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
              opt.disabled && "opacity-50 cursor-not-allowed",
              itemClassName,
            )}
          >
            <span className="orbit-label">{opt.label}</span>
          </button>
        );
      })}
    </OrbitGroup>
  );
}
