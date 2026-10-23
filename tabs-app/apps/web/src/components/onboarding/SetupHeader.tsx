import "./setup-typography.css";
import { ImageIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { cn } from "../../lib/utils";

export function SetupHeader({
  logoSrc,
  musicPlaying,
  disabled = false,
  onToggleMusic,
  onWallpaper,
  onSkip,
  className,
}: {
  readonly logoSrc: string;
  readonly musicPlaying: boolean;
  readonly disabled?: boolean;
  readonly onToggleMusic: () => void;
  readonly onWallpaper: () => void;
  readonly onSkip: () => void;
  readonly className?: string;
}) {
  const MusicIcon = musicPlaying ? Volume2Icon : VolumeXIcon;
  const controlClass =
    "inline-flex min-h-9 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full px-2 text-xs sm:px-3 font-medium text-white/90 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50 sm:flex-none";
  return (
    <header
      aria-label="Setup controls"
      className={cn(
        "setup-typography setup-surface relative z-40 mx-auto flex w-full max-w-[960px] flex-wrap items-center justify-between gap-3 rounded-lg border border-white/15 bg-black/60 px-3 py-3 text-white backdrop-blur-xl sm:px-5 transition-all duration-700 ease-in-out",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2.5">
        <img src={logoSrc} alt="" className="size-8 object-contain" />
        <h1 className="setup-brand-title font-normal">Tabs Setup</h1>
      </div>
      <div className="flex w-full items-center gap-1 sm:w-auto">
        <button
          type="button"
          aria-pressed={musicPlaying}
          disabled={disabled}
          onClick={onToggleMusic}
          title={musicPlaying ? "Pause background music" : "Play background music"}
          className={cn(controlClass, "sm:min-w-28", musicPlaying && "bg-white/10")}
        >
          <MusicIcon aria-hidden="true" className="size-3.5" />
          Music {musicPlaying ? "on" : "off"}
        </button>
        <button type="button" disabled={disabled} onClick={onWallpaper} className={controlClass}>
          <ImageIcon aria-hidden="true" className="size-3.5" />
          Wallpaper
        </button>
        <button type="button" disabled={disabled} onClick={onSkip} className={controlClass}>
          Skip setup
        </button>
      </div>
    </header>
  );
}
