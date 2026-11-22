"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "~/lib/utils";

/**
 * Themed single-thumb range slider (replaces `<input type="range">`). Neutral track, a
 * foreground-filled indicator and a round thumb with a visible focus ring.
 */
function Slider({
  className,
  value,
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  onValueCommitted,
  disabled,
  "aria-label": ariaLabel,
  "aria-valuetext": ariaValueText,
}: {
  className?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onValueChange: (value: number) => void;
  /** Fires once when the user releases the thumb or finishes a key press. */
  onValueCommitted?: (value: number) => void;
  disabled?: boolean;
  "aria-label": string;
  "aria-valuetext"?: string;
}) {
  return (
    <SliderPrimitive.Root
      className={cn("w-full", className)}
      data-slot="slider"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(next) => onValueChange(Array.isArray(next) ? (next[0] ?? min) : next)}
      onValueCommitted={(next) => onValueCommitted?.(Array.isArray(next) ? (next[0] ?? min) : next)}
    >
      <SliderPrimitive.Control className="flex h-5 w-full cursor-pointer touch-none items-center select-none data-disabled:cursor-not-allowed data-disabled:opacity-50">
        <SliderPrimitive.Track
          className="relative h-1 w-full rounded-full bg-foreground/12"
          data-slot="slider-track"
        >
          <SliderPrimitive.Indicator
            className="rounded-full bg-foreground/70"
            data-slot="slider-indicator"
          />
          <SliderPrimitive.Thumb
            aria-label={ariaLabel}
            getAriaValueText={ariaValueText ? () => ariaValueText : undefined}
            className="size-3.5 rounded-full border border-foreground/20 bg-background shadow-xs outline-none transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            data-slot="slider-thumb"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
