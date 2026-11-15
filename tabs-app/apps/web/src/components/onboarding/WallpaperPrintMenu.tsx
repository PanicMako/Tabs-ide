/** Dock button that opens a compact glass picker for the wallpaper print style, strength and motion. */

import { CheckIcon, ScanLineIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { Switch } from "../ui/switch";
import { WALLPAPER_PRINT_STYLES } from "./wallpaperPrint";
import { PRINT_STRENGTHS, useWallpaperPrintSettings } from "./WallpaperPrintPicker";

export function WallpaperPrintMenu({ disabled }: { readonly disabled?: boolean | undefined }) {
  const [open, setOpen] = useState(false);
  const print = useWallpaperPrintSettings();
  const rootRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn("wallpaper-dock-button", open && "is-open")}
        data-tip={open ? undefined : "Print style"}
        title="Wallpaper print style"
        aria-label="Wallpaper print style"
      >
        <ScanLineIcon aria-hidden="true" />
      </button>
      {open && (
        <div role="dialog" aria-label="Wallpaper print style" className="wallpaper-dock-panel">
          <p className="wallpaper-dock-panel-title">Print style</p>
          <ul className="wallpaper-dock-list">
            {WALLPAPER_PRINT_STYLES.map((option) => {
              const selected = option.id === print.style;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => print.chooseStyle(option.id)}
                    className="wallpaper-dock-item"
                  >
                    <span>{option.label}</span>
                    {selected && <CheckIcon aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <div role="radiogroup" aria-label="Print strength" className="wallpaper-dock-segment">
            {PRINT_STRENGTHS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={print.strength === option.value}
                onClick={() => print.chooseStrength(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="wallpaper-dock-switch">
            <span>Animate</span>
            <Switch
              aria-label="Animate the print"
              checked={print.animate}
              onCheckedChange={(checked) => print.chooseAnimate(checked)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
