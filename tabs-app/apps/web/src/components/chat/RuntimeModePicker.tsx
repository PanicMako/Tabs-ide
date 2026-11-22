import type { RuntimeMode } from "@tabs/contracts";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { resolveCompatibleRuntimeMode, runtimeModeConfig } from "./runtimeModeConfig";

const SLOT = 30; // px per icon button
const PAD = 2; // px of rail padding

/**
 * Permissions, as one quiet icon. Click it and it unfolds in place into a rail of
 * every mode; pick one and the rail folds back down onto the choice. The name of
 * the mode under the pointer shows beside the rail while it is open.
 */
export function RuntimeModePicker(props: {
  readonly runtimeMode: RuntimeMode;
  /** Modes the selected provider offers; every mode when omitted. */
  readonly supportedRuntimeModes?: ReadonlyArray<RuntimeMode> | undefined;
  readonly onChange: (mode: RuntimeMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<RuntimeMode | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { modes: runtimeModeOptions, mode: currentMode } = resolveCompatibleRuntimeMode(
    props.runtimeMode,
    props.supportedRuntimeModes,
  );
  const currentIndex = Math.max(0, runtimeModeOptions.indexOf(currentMode));
  const shown = hovered ?? currentMode;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const openWidth = runtimeModeOptions.length * SLOT + PAD * 2;

  return (
    <div ref={rootRef} className="flex shrink-0 items-center gap-1.5">
      <div
        role={open ? "radiogroup" : undefined}
        aria-label="Permissions"
        className={cn(
          "overflow-hidden rounded-lg transition-[width,background-color] duration-300 ease-[cubic-bezier(0.2,0.9,0.3,1.05)]",
          open ? "bg-muted/60" : "bg-transparent",
        )}
        style={{ width: open ? openWidth : SLOT + PAD * 2, padding: PAD }}
      >
        <div
          className="flex transition-transform duration-300 ease-[cubic-bezier(0.2,0.9,0.3,1.05)]"
          style={{ transform: `translateX(${open ? 0 : -currentIndex * SLOT}px)` }}
        >
          {runtimeModeOptions.map((mode) => {
            const config = runtimeModeConfig[mode];
            const Icon = config.icon;
            const selected = mode === currentMode;
            return (
              <button
                key={mode}
                type="button"
                role={open ? "radio" : undefined}
                aria-checked={open ? selected : undefined}
                aria-label={`${config.label}. ${config.description}`}
                aria-expanded={!open && selected ? open : undefined}
                tabIndex={open || selected ? 0 : -1}
                title={open ? undefined : `${config.label} — click to change`}
                onMouseEnter={() => setHovered(mode)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => {
                  if (!open) {
                    if (selected) setOpen(true);
                    return;
                  }
                  props.onChange(mode);
                  setHovered(null);
                  setOpen(false);
                }}
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-md transition-colors",
                  open
                    ? selected
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                    : "text-muted-foreground/80 hover:text-foreground",
                  !open && !selected && "pointer-events-none opacity-0",
                )}
                style={{ width: SLOT, height: SLOT - 2 }}
              >
                <Icon className="size-4" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
      <span
        aria-live="polite"
        className={cn(
          "composer-runtime-label hidden overflow-hidden whitespace-nowrap text-xs font-medium text-muted-foreground/80 transition-[max-width,color] duration-200 sm:block",
          open ? "max-w-32 text-foreground" : "max-w-32",
        )}
      >
        {runtimeModeConfig[shown].label}
      </span>
    </div>
  );
}
