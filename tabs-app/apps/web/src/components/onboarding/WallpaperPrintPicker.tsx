/** Compact print controls (style, strength, motion) shared by the gallery and other surfaces. */

import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { Switch } from "../ui/switch";
import {
  WALLPAPER_PRINT_STYLES,
  type WallpaperPrintStrength,
  type WallpaperPrintStyle,
  getWallpaperPrintAnimate,
  getWallpaperPrintStrength,
  getWallpaperPrintStyle,
  saveWallpaperPrintAnimate,
  saveWallpaperPrintStrength,
  saveWallpaperPrintStyle,
} from "./wallpaperPrint";
import { AGENT_WALLPAPER_CHANGE_EVENT } from "./wallpapers";

export const PRINT_STRENGTHS: ReadonlyArray<{ value: WallpaperPrintStrength; label: string }> = [
  { value: 1, label: "Subtle" },
  { value: 2, label: "Balanced" },
  { value: 3, label: "Bold" },
];

/** Reads and writes the saved print settings, staying in sync with every other control. */
export function useWallpaperPrintSettings() {
  const [style, setStyle] = useState<WallpaperPrintStyle>(() => getWallpaperPrintStyle());
  const [strength, setStrength] = useState<WallpaperPrintStrength>(() =>
    getWallpaperPrintStrength(),
  );
  const [animate, setAnimate] = useState<boolean>(() => getWallpaperPrintAnimate());
  useEffect(() => {
    const sync = () => {
      setStyle(getWallpaperPrintStyle());
      setStrength(getWallpaperPrintStrength());
      setAnimate(getWallpaperPrintAnimate());
    };
    window.addEventListener(AGENT_WALLPAPER_CHANGE_EVENT, sync);
    return () => window.removeEventListener(AGENT_WALLPAPER_CHANGE_EVENT, sync);
  }, []);
  return {
    style,
    strength,
    animate,
    chooseStyle: (value: WallpaperPrintStyle) => {
      setStyle(value);
      saveWallpaperPrintStyle(value);
    },
    chooseStrength: (value: WallpaperPrintStrength) => {
      setStrength(value);
      saveWallpaperPrintStrength(value);
    },
    chooseAnimate: (value: boolean) => {
      setAnimate(value);
      saveWallpaperPrintAnimate(value);
    },
  };
}

export function WallpaperPrintPicker({ className }: { readonly className?: string }) {
  const print = useWallpaperPrintSettings();
  const chip = (selected: boolean) =>
    cn(
      "cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors",
      selected
        ? "border-foreground bg-foreground text-background"
        : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
    );
  return (
    <div className={cn("grid gap-3", className)} data-slot="wallpaper-print-picker">
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Print</span>
        <div className="flex flex-wrap gap-1.5">
          {WALLPAPER_PRINT_STYLES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={print.style === option.id}
              title={option.description}
              onClick={() => print.chooseStyle(option.id)}
              className={chip(print.style === option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Print strength" className="flex gap-1.5">
          {PRINT_STRENGTHS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={print.strength === option.value}
              onClick={() => print.chooseStrength(option.value)}
              className={chip(print.strength === option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          Animate
          <Switch
            aria-label="Animate the print"
            checked={print.animate}
            onCheckedChange={(checked) => print.chooseAnimate(checked)}
          />
        </label>
      </div>
    </div>
  );
}
