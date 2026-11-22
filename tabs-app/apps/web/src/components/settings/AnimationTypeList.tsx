import { cn } from "../../lib/utils";
import { CURATED_FONT_COMBOS } from "../../lib/themes";

type FontCombo = (typeof CURATED_FONT_COMBOS)[number];

interface TypeOption {
  id: string;
  name: string;
  desc: string;
  tag: string;
  /** Face for the "Ag" specimen. */
  specimen?: { fontFamily?: string; fontWeight?: number; fontStyle?: string } | undefined;
  /** Face for the option's name. */
  label?: string | undefined;
}

function comboOption(combo: FontCombo): TypeOption {
  const typography = combo.typography as
    | {
        specimenFont?: string;
        specimenWeight?: number;
        specimenStyle?: string;
        headingWeight?: number;
      }
    | undefined;
  const heading = combo.headingFont !== "custom" ? combo.headingFont : undefined;
  const ui = combo.uiFont !== "custom" ? combo.uiFont : undefined;
  const specimenFamily = combo.isNeutral ? ui : (typography?.specimenFont ?? heading);
  return {
    id: combo.id,
    name: combo.name,
    desc: combo.desc,
    tag: combo.tag,
    specimen: {
      ...(specimenFamily ? { fontFamily: specimenFamily } : {}),
      ...(typography?.specimenWeight || typography?.headingWeight
        ? { fontWeight: typography?.specimenWeight ?? typography?.headingWeight }
        : {}),
      ...(typography?.specimenStyle ? { fontStyle: typography.specimenStyle } : {}),
    },
    label: ui,
  };
}

const OPTIONS: readonly TypeOption[] = [
  {
    id: "app-default",
    name: "App theme",
    desc: "Follows the fonts of your current theme",
    tag: "Default",
  },
  ...CURATED_FONT_COMBOS.filter((combo) => combo.isNeutral).map(comboOption),
  ...CURATED_FONT_COMBOS.filter((combo) => !combo.isNeutral).map(comboOption),
];

/**
 * The animation's typeface, as a type index: one hairline row per face with
 * a single specimen, instead of a wall of specimen cards.
 */
export function AnimationTypeList({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Animation typeface"
      className="grid grid-cols-1 gap-px border-y border-border/50 bg-border/50 sm:grid-cols-2"
    >
      {OPTIONS.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.id)}
            className={cn(
              "flex min-w-0 cursor-pointer items-center gap-4 rounded-none px-4 py-3 text-left transition-colors duration-150 sm:px-5",
              selected ? "bg-muted" : "bg-background hover:bg-muted/40",
            )}
          >
            <span
              className="w-11 shrink-0 text-[22px] leading-none text-foreground"
              style={option.specimen}
              aria-hidden="true"
            >
              Ag
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                className="truncate text-[13px] font-medium text-foreground"
                style={option.label ? { fontFamily: option.label } : undefined}
              >
                {option.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">{option.desc}</span>
            </span>
            {selected ? (
              <svg
                className="size-3.5 shrink-0 text-foreground"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2 6l3 3 5-5" />
              </svg>
            ) : (
              <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                {option.tag}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
