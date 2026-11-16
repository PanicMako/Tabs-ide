import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DicesIcon,
  LayoutGridIcon,
  RotateCcwIcon,
  ScanLineIcon,
} from "lucide-react";

import { cn } from "../../lib/utils";
import {
  useWallpaperControlsStore,
  type WallpaperControls,
} from "../../stores/wallpaperControlsStore";
import { WALLPAPER_PRINT_STYLES } from "../onboarding/wallpaperPrint";
import { PRINT_STRENGTHS, useWallpaperPrintSettings } from "../onboarding/WallpaperPrintPicker";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";

const ROW =
  "surface-control flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-ring";
const ICON =
  "surface-control flex size-8 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-ring";

/** Picks the print style, strength and motion from a popup, showing the current choice in place. */
function PrintPicker() {
  const print = useWallpaperPrintSettings();
  const current = WALLPAPER_PRINT_STYLES.find((option) => option.id === print.style);
  return (
    <Popover>
      <PopoverTrigger render={<button type="button" className={`${ROW} w-full`} />}>
        <ScanLineIcon aria-hidden="true" className="size-3.5" />
        <span className="text-muted-foreground">Print</span>
        <span className="ml-auto truncate font-medium">{current?.label ?? "Halftone"}</span>
        <ChevronRightIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverPopup side="left" align="start" className="w-56 p-2">
        <p className="px-2 pb-1 pt-0.5 text-[11px] font-medium text-muted-foreground">
          Print style
        </p>
        <ul className="grid gap-px">
          {WALLPAPER_PRINT_STYLES.map((option) => {
            const selected = option.id === print.style;
            return (
              <li key={option.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  title={option.description}
                  onClick={() => print.chooseStyle(option.id)}
                  className={cn(
                    "flex h-8 w-full items-center justify-between rounded-lg px-2 text-xs hover:bg-accent",
                    selected && "bg-accent font-medium",
                  )}
                >
                  {option.label}
                  {selected ? <span aria-hidden="true">✓</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <div role="radiogroup" aria-label="Print strength" className="mt-2 flex gap-1">
          {PRINT_STRENGTHS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={print.strength === option.value}
              onClick={() => print.chooseStrength(option.value)}
              className={cn(
                "h-7 flex-1 rounded-lg border px-1 text-[11px]",
                print.strength === option.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="mt-2 flex items-center justify-between px-1 text-xs text-muted-foreground">
          Animate
          <Switch
            aria-label="Animate the print"
            checked={print.animate}
            onCheckedChange={(checked) => print.chooseAnimate(checked)}
          />
        </label>
      </PopoverPopup>
    </Popover>
  );
}

/** Wallpaper and its print, in the workspace card where the rest of the workspace is set up. */
export function WorkspaceLookPane({
  controls: controlsProp,
}: {
  controls?: WallpaperControls | null;
} = {}) {
  const storeControls = useWallpaperControlsStore((state) => state.controls);
  const controls = controlsProp !== undefined ? controlsProp : storeControls;

  if (!controls) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Wallpaper controls appear once a conversation is open.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-xs font-medium text-foreground">Wallpaper</span>
        <Switch
          checked={controls.enabled}
          onCheckedChange={(checked) => controls.setEnabled(checked)}
          aria-label="Toggle wallpaper"
        />
      </div>

      {controls.enabled && (
        <>
          <div className="flex items-center gap-1">
            <button type="button" className={`${ROW} flex-1`} onClick={controls.openGallery}>
              <LayoutGridIcon aria-hidden="true" className="size-3.5" />
              <span>Browse gallery</span>
            </button>
            <button
              type="button"
              className={ICON}
              aria-label="Previous wallpaper"
              title="Previous wallpaper"
              onClick={() => controls.step(-1)}
            >
              <ChevronLeftIcon aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              className={ICON}
              aria-label="Next wallpaper"
              title="Next wallpaper"
              onClick={() => controls.step(1)}
            >
              <ChevronRightIcon aria-hidden="true" className="size-4" />
            </button>
          </div>
          <p className="truncate px-0.5 text-[11px] text-muted-foreground">{controls.label}</p>
          <PrintPicker />
          <div className="flex items-center gap-1.5 pt-0.5">
            <button
              type="button"
              className={`${ROW} flex-1 justify-center`}
              aria-label="Shuffle wallpaper"
              title="Shuffle wallpaper"
              onClick={controls.shuffle}
            >
              <DicesIcon aria-hidden="true" className="size-3.5" />
              <span>Shuffle</span>
            </button>
            {controls.overridden && (
              <button
                type="button"
                className={`${ROW} flex-1 justify-center`}
                aria-label="Use the shared wallpaper"
                title="Use the shared workspace wallpaper"
                onClick={controls.resetOverride}
              >
                <RotateCcwIcon aria-hidden="true" className="size-3.5" />
                <span>Use shared</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
