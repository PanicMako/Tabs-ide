/**
 * The wallpaper controls in the agent chat: one frosted-glass capsule, collapsed to a single
 * button. Styling lives in wallpaper-labs.css (`.wallpaper-dock*`) so it shares the chat's glass.
 */

import {
  ChevronDownIcon,
  DicesIcon,
  ImageIcon,
  LayoutGridIcon,
  PowerOffIcon,
  RotateCcwIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { WallpaperPrintMenu } from "./WallpaperPrintMenu";
import type { WallpaperOption } from "./wallpapers";

function DockButton({
  label,
  tip,
  onClick,
  disabled,
  children,
}: {
  readonly label: string;
  readonly tip: string;
  readonly onClick: () => void;
  readonly disabled?: boolean | undefined;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="wallpaper-dock-button"
      data-tip={tip}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function WallpaperGlassDock({
  activeWallpaper,
  isMinimized,
  isOverridden,
  disabled,
  onOpenGallery,
  onShuffle,
  onReset,
  onDisable,
  onMinimize,
  onExpand,
  onPlaySound,
}: {
  readonly activeWallpaper: WallpaperOption;
  readonly isMinimized: boolean;
  /** A thread or project has its own wallpaper, so a reset button is offered. */
  readonly isOverridden: boolean;
  readonly disabled?: boolean | undefined;
  readonly onOpenGallery: () => void;
  readonly onShuffle: () => void;
  readonly onReset?: (() => void) | undefined;
  readonly onDisable?: (() => void) | undefined;
  readonly onMinimize?: (() => void) | undefined;
  readonly onExpand?: (() => void) | undefined;
  readonly onPlaySound?: (() => void) | undefined;
}) {
  if (isMinimized) {
    return (
      <div className="wallpaper-dock wallpaper-dock-collapsed">
        <DockButton
          label="Expand wallpaper controls"
          tip={`Wallpaper · ${activeWallpaper.label}`}
          disabled={disabled}
          onClick={() => {
            onPlaySound?.();
            onExpand?.();
          }}
        >
          <ImageIcon aria-hidden="true" />
        </DockButton>
      </div>
    );
  }

  return (
    <div className="wallpaper-dock" role="toolbar" aria-label="Wallpaper controls">
      <DockButton
        label="Browse all wallpapers in gallery"
        tip={`${activeWallpaper.label} · Gallery`}
        disabled={disabled}
        onClick={() => {
          onPlaySound?.();
          onOpenGallery();
        }}
      >
        <LayoutGridIcon aria-hidden="true" />
      </DockButton>
      <DockButton
        label="Surprise me with a random wallpaper"
        tip="Shuffle"
        disabled={disabled}
        onClick={onShuffle}
      >
        <DicesIcon aria-hidden="true" />
      </DockButton>
      <WallpaperPrintMenu disabled={disabled} />
      {isOverridden && onReset && (
        <DockButton
          label="Reset to the shared wallpaper"
          tip="Use the shared wallpaper"
          onClick={onReset}
        >
          <RotateCcwIcon aria-hidden="true" />
        </DockButton>
      )}
      <span className="wallpaper-dock-divider" aria-hidden="true" />
      {onDisable && (
        <DockButton
          label="Turn off wallpaper (Hide this icon & switch to default IDE look)"
          tip="Turn wallpaper off"
          disabled={disabled}
          onClick={() => {
            onPlaySound?.();
            onDisable();
          }}
        >
          <PowerOffIcon aria-hidden="true" />
        </DockButton>
      )}
      {onMinimize && (
        <DockButton
          label="Minimize wallpaper controls"
          tip="Collapse"
          disabled={disabled}
          onClick={() => {
            onPlaySound?.();
            onMinimize();
          }}
        >
          <ChevronDownIcon aria-hidden="true" />
        </DockButton>
      )}
    </div>
  );
}
