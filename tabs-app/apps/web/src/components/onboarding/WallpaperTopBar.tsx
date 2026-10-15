import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DicesIcon,
  FilmIcon,
  LayoutGridIcon,
  PowerOffIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import {
  WALLPAPERS,
  WALLPAPER_CATEGORIES,
  type WallpaperCategory,
  type WallpaperOption,
} from "./wallpapers";

export interface WallpaperTopBarProps {
  readonly activeWallpaperUrl: string;
  readonly onSelectWallpaper: (wallpaper: WallpaperOption) => void;
  readonly onOpenGallery: () => void;
  readonly onDisableWallpaper?: () => void;
  readonly onMinimize?: () => void;
  readonly isMinimized?: boolean;
  readonly onExpand?: () => void;
  readonly onPlaySound?: () => void;
  readonly disabled?: boolean;
  readonly theme?: "light" | "dark";
  readonly isThreadSpecific?: boolean;
  readonly onClearThreadWallpaper?: () => void;
  /**
   * Optional subset of wallpapers to cycle through. Defaults to all WALLPAPERS.
   * Pass BRIGHT_WALLPAPERS to restrict to non-Night scenes (for the wizard).
   */
  readonly wallpapers?: readonly WallpaperOption[];
  /**
   * Direction the filmstrip shelf should open. Defaults to "down".
   */
  readonly dropDirection?: "up" | "down" | "left" | "right";
  /**
   * Whether to show the horizontal filmstrip dock button. Defaults to true.
   */
  readonly showFilmstrip?: boolean;
  /**
   * Layout orientation of the control dock. Defaults to "horizontal".
   */
  readonly orientation?: "horizontal" | "vertical";
}

export function WallpaperTopBar({
  activeWallpaperUrl,
  onSelectWallpaper,
  onOpenGallery,
  onDisableWallpaper,
  onMinimize,
  isMinimized = false,
  onExpand,
  onPlaySound,
  disabled = false,
  theme = "dark",
  isThreadSpecific = false,
  onClearThreadWallpaper,
  wallpapers: wallpaperSet,
  dropDirection = "down",
  showFilmstrip = true,
  orientation = "horizontal",
}: WallpaperTopBarProps) {
  const isLight = theme === "light";
  const wallpapers = wallpaperSet ?? WALLPAPERS;
  const [isFilmstripOpen, setIsFilmstripOpen] = useState(false);
  const [filmstripCategory, setFilmstripCategory] = useState<WallpaperCategory>("All");
  const filmstripScrollRef = useRef<HTMLDivElement | null>(null);

  const currentIndex = wallpapers.findIndex((w) => w.url === activeWallpaperUrl);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const activeWallpaper = wallpapers[safeIndex] ?? wallpapers[0]!;

  const handlePrev = () => {
    if (disabled) return;
    onPlaySound?.();
    const nextIdx = (safeIndex - 1 + wallpapers.length) % wallpapers.length;
    onSelectWallpaper(wallpapers[nextIdx]!);
  };

  const handleNext = () => {
    if (disabled) return;
    onPlaySound?.();
    const nextIdx = (safeIndex + 1) % wallpapers.length;
    onSelectWallpaper(wallpapers[nextIdx]!);
  };

  const handleRandom = () => {
    if (disabled) return;
    onPlaySound?.();
    const others = wallpapers.filter((_, idx) => idx !== safeIndex);
    const random = others[Math.floor(Math.random() * others.length)] ?? wallpapers[0]!;
    onSelectWallpaper(random);
  };

  // Keyboard navigation when not inside an input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return;
      // Ignore if user is typing in an input or textarea
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      if (e.key === "[" || (e.altKey && e.key === "ArrowLeft")) {
        e.preventDefault();
        handlePrev();
      } else if (e.key === "]" || (e.altKey && e.key === "ArrowRight")) {
        e.preventDefault();
        handleNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // Filter wallpapers for filmstrip
  const filmstripWallpapers =
    filmstripCategory === "All"
      ? wallpapers
      : wallpapers.filter((w) => w.category === filmstripCategory);

  // Scroll active wallpaper into view inside filmstrip
  useEffect(() => {
    if (!isFilmstripOpen || !filmstripScrollRef.current) return;
    const activeThumb = filmstripScrollRef.current.querySelector(
      `[data-wallpaper-id="${activeWallpaper.id}"]`,
    );
    if (activeThumb) {
      activeThumb.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  }, [activeWallpaper.id, isFilmstripOpen]);

  const scrollFilmstrip = (direction: "left" | "right") => {
    if (!filmstripScrollRef.current) return;
    const scrollAmount = 320;
    filmstripScrollRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  if (isMinimized) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            onPlaySound?.();
            onExpand?.();
          }}
          aria-label="Expand wallpaper controls"
          className={cn(
            "group relative flex size-10 items-center justify-center rounded-full backdrop-blur-2xl shadow-xl transition-all duration-300 hover:scale-110 active:scale-95 cursor-pointer border select-none animate-in fade-in zoom-in-95 duration-200",
            isLight
              ? "border-slate-200/90 bg-white/90 shadow-slate-900/10 hover:border-slate-300 hover:bg-white"
              : "border-white/20 bg-black/75 shadow-black/50 hover:border-white/35 hover:bg-black/90",
          )}
          style={{
            boxShadow: isLight
              ? `0 8px 24px -2px rgba(0, 0, 0, 0.15), 0 0 16px ${activeWallpaper.accentColor}30`
              : `0 8px 24px -2px rgba(0, 0, 0, 0.6), 0 0 18px ${activeWallpaper.accentColor}40`,
          }}
          title={`Wallpaper: ${activeWallpaper.label} (Click to open controls)`}
        >
          {/* Circular Lens */}
          <div
            className="size-7.5 overflow-hidden rounded-full border shadow-inner transition-transform duration-300 group-hover:scale-105"
            style={{ borderColor: activeWallpaper.accentColor }}
          >
            <img src={activeWallpaper.url} alt="" className="size-full object-cover" />
          </div>

          {/* Floating Label on Hover (left) */}
          <div className="pointer-events-none absolute right-full top-1/2 -translate-y-1/2 mr-3 flex items-center gap-2 rounded-xl border border-white/15 bg-neutral-950/90 px-3 py-1.5 backdrop-blur-2xl shadow-xl opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 whitespace-nowrap z-50">
            <span className="text-xs font-semibold text-white">{activeWallpaper.label}</span>
            <span className="text-[10px] text-white/50">Click to change</span>
          </div>
        </button>
      </div>
    );
  }

  if (orientation === "vertical") {
    return (
      <div className="relative">
        <div
          className={cn(
            "relative flex flex-col items-center gap-1.5 rounded-2xl p-1.5 backdrop-blur-2xl shadow-2xl transition-all duration-300 border select-none group/dock animate-in fade-in zoom-in-95 duration-200",
            isLight
              ? "border-slate-200/90 bg-white/90 text-slate-800 shadow-slate-900/15"
              : "border-white/15 bg-black/75 text-white shadow-black/60",
          )}
          style={{
            boxShadow: isLight
              ? `0 10px 30px -5px rgba(0, 0, 0, 0.1), 0 0 15px ${activeWallpaper.accentColor}25`
              : `0 12px 36px -4px rgba(0, 0, 0, 0.7), 0 0 20px ${activeWallpaper.accentColor}35`,
          }}
        >
          {/* Active Wallpaper Thumbnail Lens */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onPlaySound?.();
              onOpenGallery();
            }}
            className="group/lens relative h-6 w-9 overflow-hidden rounded-lg border shadow-xs transition-transform duration-200 hover:scale-105 active:scale-95 cursor-pointer shrink-0"
            style={{ borderColor: activeWallpaper.accentColor }}
            title="Browse all wallpapers in gallery"
            aria-label="Browse all wallpapers in gallery"
          >
            <img src={activeWallpaper.url} alt="" className="size-full object-cover" />

            {/* Slide-out title tag on hover to the left */}
            <div className="pointer-events-none absolute right-full top-1/2 -translate-y-1/2 mr-3 flex items-center gap-2 rounded-xl border border-white/20 bg-neutral-950/95 px-3 py-1.5 backdrop-blur-2xl shadow-2xl opacity-0 -translate-x-1 transition-all duration-200 group-hover/lens:opacity-100 group-hover/lens:translate-x-0 whitespace-nowrap z-50">
              <span className="text-xs font-semibold text-white">{activeWallpaper.label}</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-mono text-white/70">
                {activeWallpaper.category}
              </span>
              {isThreadSpecific && (
                <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-medium text-sky-300 border border-sky-400/30">
                  Thread
                </span>
              )}
            </div>
          </button>

          <div className={cn("h-px w-5 my-0.5", isLight ? "bg-slate-200" : "bg-white/15")} />

          {/* Surprise Me / Shuffle Button */}
          <button
            type="button"
            disabled={disabled}
            onClick={handleRandom}
            className={cn(
              "group/dice relative flex size-8 items-center justify-center rounded-xl transition-all active:scale-90 disabled:opacity-40 cursor-pointer",
              isLight
                ? "text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                : "text-amber-400/90 hover:bg-amber-400/20 hover:text-amber-300",
            )}
            title="Surprise me with a random wallpaper"
            aria-label="Surprise me with a random wallpaper"
          >
            <DicesIcon className="size-4 transition-transform duration-300 group-hover/dice:rotate-45" />
            <div className="pointer-events-none absolute right-full top-1/2 -translate-y-1/2 mr-3 rounded-xl border border-white/15 bg-neutral-950/95 px-2.5 py-1 text-xs font-medium text-white shadow-xl opacity-0 -translate-x-1 transition-all duration-200 group-hover/dice:opacity-100 group-hover/dice:translate-x-0 whitespace-nowrap z-50">
              Surprise Me
            </div>
          </button>

          {/* Full Gallery Grid Button */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onPlaySound?.();
              onOpenGallery();
            }}
            className={cn(
              "group/grid relative flex size-8 items-center justify-center rounded-xl transition-all active:scale-90 disabled:opacity-40 cursor-pointer",
              isLight
                ? "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                : "text-white/70 hover:bg-white/15 hover:text-white",
            )}
            title="Browse all wallpapers in gallery"
            aria-label="Browse all wallpapers in gallery"
          >
            <LayoutGridIcon className="size-4" />
            <div className="pointer-events-none absolute right-full top-1/2 -translate-y-1/2 mr-3 rounded-xl border border-white/15 bg-neutral-950/95 px-2.5 py-1 text-xs font-medium text-white shadow-xl opacity-0 -translate-x-1 transition-all duration-200 group-hover/grid:opacity-100 group-hover/grid:translate-x-0 whitespace-nowrap z-50">
              Full Gallery
            </div>
          </button>

          {/* Reset Thread Override Button (if thread-specific) */}
          {isThreadSpecific && onClearThreadWallpaper && (
            <button
              type="button"
              onClick={onClearThreadWallpaper}
              className="flex size-7 items-center justify-center rounded-xl text-sky-400 hover:bg-sky-500/20 cursor-pointer transition-all"
              title="Reset to global workspace wallpaper"
              aria-label="Reset to global workspace wallpaper"
            >
              <RotateCcwIcon className="size-3.5" />
            </button>
          )}

          {/* Disable / Turn Off Wallpaper Button */}
          {onDisableWallpaper && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onPlaySound?.();
                onDisableWallpaper();
              }}
              className={cn(
                "flex size-7 items-center justify-center rounded-xl transition-all active:scale-90 disabled:opacity-40 cursor-pointer",
                isLight
                  ? "text-slate-400 hover:bg-red-50 hover:text-red-600"
                  : "text-white/35 hover:bg-red-500/20 hover:text-red-400",
              )}
              title="Turn off wallpaper (Hide this icon & switch to default IDE look)"
              aria-label="Turn off wallpaper (Hide this icon & switch to default IDE look)"
            >
              <PowerOffIcon className="size-3" />
            </button>
          )}

          {/* Minimize / Collapse Button */}
          {onMinimize && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onPlaySound?.();
                onMinimize();
              }}
              className={cn(
                "flex size-7 items-center justify-center rounded-xl transition-all active:scale-90 disabled:opacity-40 cursor-pointer",
                isLight
                  ? "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  : "text-white/40 hover:bg-white/15 hover:text-white",
              )}
              title="Minimize wallpaper controls"
              aria-label="Minimize wallpaper controls"
            >
              <ChevronDownIcon className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Sleek Wallpaper Control Pill Bar */}
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-full p-1 backdrop-blur-2xl shadow-xl transition-colors",
          isLight
            ? "border border-slate-200/90 bg-white/85 text-slate-800 shadow-slate-900/10"
            : "border border-white/15 bg-black/55 text-white shadow-black/40",
        )}
      >
        {/* Previous Button */}
        <button
          type="button"
          disabled={disabled}
          onClick={handlePrev}
          className={cn(
            "flex size-7 items-center justify-center rounded-full transition-all active:scale-95 disabled:opacity-40 cursor-pointer",
            isLight
              ? "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              : "text-white/70 hover:bg-white/10 hover:text-white",
          )}
          title="Previous wallpaper ([ or Alt+←])"
        >
          <ChevronLeftIcon className="size-4" />
        </button>

        {/* Current Wallpaper Preview & Trigger for Full Gallery */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onPlaySound?.();
            onOpenGallery();
          }}
          className={cn(
            "group flex items-center gap-2 rounded-full py-0.5 pl-1 pr-2.5 transition-all cursor-pointer",
            isLight ? "hover:bg-slate-100" : "hover:bg-white/10",
          )}
          title="Click to browse wallpapers in full gallery"
        >
          {/* Miniature 16:9 preview chip */}
          <div
            className={cn(
              "relative h-5.5 w-9 overflow-hidden rounded-md border shadow-xs shrink-0 transition-transform duration-200 group-hover:scale-105",
              isLight ? "border-slate-300 bg-slate-100" : "border-white/30 bg-neutral-900",
            )}
          >
            <img src={activeWallpaper.url} alt="" className="size-full object-cover" />
          </div>

          <div className="flex flex-col text-left">
            <div className="flex items-center gap-1">
              <span
                className={cn(
                  "text-[11px] font-semibold leading-tight max-w-[100px] sm:max-w-[130px] truncate",
                  isLight
                    ? "text-slate-900 group-hover:text-black"
                    : "text-white/95 group-hover:text-white",
                )}
              >
                {activeWallpaper.label}
              </span>
              {isThreadSpecific && (
                <span
                  className={cn(
                    "rounded px-1 py-0.2 text-[8px] font-medium leading-none shrink-0",
                    isLight
                      ? "bg-sky-100 text-sky-800 border border-sky-200"
                      : "bg-sky-500/20 text-sky-300 border border-sky-400/30",
                  )}
                  title="Specific to this thread"
                >
                  Thread
                </span>
              )}
            </div>
            <span
              className={cn(
                "text-[9px] font-mono leading-none",
                isLight ? "text-slate-500" : "text-white/50",
              )}
            >
              {safeIndex + 1} / {wallpapers.length} • {activeWallpaper.category}
            </span>
          </div>

          <LayoutGridIcon
            className={cn(
              "size-3 transition-colors ml-0.5",
              isLight
                ? "text-slate-400 group-hover:text-slate-700"
                : "text-white/40 group-hover:text-white",
            )}
          />
        </button>

        {/* Reset thread-specific wallpaper button (if thread-specific) */}
        {isThreadSpecific && onClearThreadWallpaper && (
          <button
            type="button"
            onClick={onClearThreadWallpaper}
            className={cn(
              "flex size-6 items-center justify-center rounded-full transition-all active:scale-95 cursor-pointer",
              isLight
                ? "text-sky-600 hover:bg-sky-100 hover:text-sky-800"
                : "text-sky-300 hover:bg-sky-500/20 hover:text-sky-200",
            )}
            title="Reset to global workspace wallpaper"
          >
            <RotateCcwIcon className="size-3" />
          </button>
        )}

        {/* Next Button */}
        <button
          type="button"
          disabled={disabled}
          onClick={handleNext}
          className={cn(
            "flex size-7 items-center justify-center rounded-full transition-all active:scale-95 disabled:opacity-40 cursor-pointer",
            isLight
              ? "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              : "text-white/70 hover:bg-white/10 hover:text-white",
          )}
          title="Next wallpaper (] or Alt+→])"
        >
          <ChevronRightIcon className="size-4" />
        </button>

        {/* Divider */}
        <div className={cn("h-4 w-px mx-0.5", isLight ? "bg-slate-300" : "bg-white/15")} />

        {/* Surprise Me / Random Shuffle */}
        <button
          type="button"
          disabled={disabled}
          onClick={handleRandom}
          className={cn(
            "flex size-7 items-center justify-center rounded-full transition-all active:scale-95 disabled:opacity-40 cursor-pointer",
            isLight
              ? "text-amber-600 hover:bg-amber-100 hover:text-amber-700"
              : "text-amber-300/80 hover:bg-amber-400/20 hover:text-amber-200",
          )}
          title="Surprise me with a random wallpaper"
        >
          <DicesIcon className="size-3.5" />
        </button>

        {/* Direct Full Gallery Grid Button */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onPlaySound?.();
            onOpenGallery();
          }}
          className={cn(
            "flex size-7 items-center justify-center rounded-full transition-all active:scale-95 disabled:opacity-40 cursor-pointer",
            isLight
              ? "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              : "text-white/65 hover:bg-white/10 hover:text-white",
          )}
          title="Browse all wallpapers in gallery"
        >
          <LayoutGridIcon className="size-3.5" />
        </button>

        {/* Optional Toggle Filmstrip Shelf */}
        {showFilmstrip && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onPlaySound?.();
              setIsFilmstripOpen((prev) => !prev);
            }}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-all active:scale-95 disabled:opacity-40 cursor-pointer",
              isFilmstripOpen
                ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/40"
                : isLight
                  ? "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  : "text-white/60 hover:bg-white/10 hover:text-white",
            )}
            title="Toggle horizontal wallpaper filmstrip dock"
          >
            <FilmIcon className="size-3.5" />
          </button>
        )}

        {/* Disable / Turn Off Wallpaper Button */}
        {onDisableWallpaper && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onPlaySound?.();
              onDisableWallpaper();
            }}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-all active:scale-95 disabled:opacity-40 cursor-pointer",
              isLight
                ? "text-red-500 hover:bg-red-50 hover:text-red-700"
                : "text-red-400/60 hover:bg-red-500/20 hover:text-red-300",
            )}
            title="Turn off wallpaper (Hide this icon & switch to default IDE look)"
          >
            <PowerOffIcon className="size-3" />
          </button>
        )}

        {/* Minimize / Collapse Button */}
        {onMinimize && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onPlaySound?.();
              onMinimize();
            }}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-all active:scale-95 disabled:opacity-40 cursor-pointer",
              isLight
                ? "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                : "text-white/60 hover:bg-white/10 hover:text-white",
            )}
            title="Minimize wallpaper controls"
            aria-label="Minimize wallpaper controls"
          >
            <ChevronDownIcon className="size-3.5" />
          </button>
        )}
      </div>

      {/* Floating Horizontal Filmstrip Shelf */}
      {isFilmstripOpen && (
        <div
          className={cn(
            "absolute right-0 w-[min(92vw,700px)] rounded-2xl border border-white/20 bg-neutral-950/95 p-3.5 backdrop-blur-3xl shadow-[0_20px_60px_rgba(0,0,0,0.85)] z-50 animate-in fade-in zoom-in-95 duration-150",
            dropDirection === "up" ? "bottom-full mb-3" : "top-full mt-3",
          )}
        >
          {/* Top row with Category filters and Grid Modal link */}
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10 mb-2.5">
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
              {WALLPAPER_CATEGORIES.map((cat) => {
                const isSelected = filmstripCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setFilmstripCategory(cat);
                      onPlaySound?.();
                    }}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all shrink-0 cursor-pointer",
                      isSelected
                        ? "bg-white/20 text-white font-semibold shadow-xs"
                        : "text-white/60 hover:text-white hover:bg-white/10",
                    )}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                setIsFilmstripOpen(false);
                onOpenGallery();
              }}
              className="flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300 shrink-0 cursor-pointer"
            >
              <LayoutGridIcon className="size-3" />
              <span>Full Grid</span>
            </button>
          </div>

          {/* Horizontal scrollable track with left/right scroll arrows */}
          <div className="relative group">
            {/* Scroll Left Button */}
            <button
              type="button"
              onClick={() => scrollFilmstrip("left")}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 flex size-7 items-center justify-center rounded-full bg-black/70 border border-white/20 text-white backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black cursor-pointer shadow-lg"
            >
              <ChevronLeftIcon className="size-4" />
            </button>

            {/* Thumbnail Track */}
            <div
              ref={filmstripScrollRef}
              className="flex items-center gap-2.5 overflow-x-auto py-1 scroll-smooth scrollbar-thin scrollbar-thumb-white/20"
            >
              {filmstripWallpapers.map((wp) => {
                const isSelected = wp.url === activeWallpaperUrl;
                return (
                  <button
                    key={wp.id}
                    data-wallpaper-id={wp.id}
                    type="button"
                    onClick={() => {
                      onSelectWallpaper(wp);
                      onPlaySound?.();
                    }}
                    className={cn(
                      "group/card relative flex flex-col shrink-0 w-28 overflow-hidden rounded-xl border text-left transition-all duration-200 cursor-pointer select-none",
                      isSelected
                        ? "border-sky-400 ring-2 ring-sky-400/50 scale-105 shadow-md shadow-sky-500/20"
                        : "border-white/15 bg-white/5 hover:border-white/40 hover:scale-[1.02]",
                    )}
                  >
                    {/* 16:9 Thumbnail */}
                    <div className="relative aspect-video w-full overflow-hidden bg-neutral-900">
                      <img
                        src={wp.url}
                        alt={wp.label}
                        loading="lazy"
                        className="size-full object-cover transition-transform duration-200 group-hover/card:scale-110"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

                      {isSelected && (
                        <div className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-black">
                          <CheckIcon className="size-2.5 stroke-[3]" />
                        </div>
                      )}

                      <span className="absolute bottom-1 left-1.5 right-1.5 text-[10px] font-semibold text-white truncate drop-shadow-sm">
                        {wp.label}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Scroll Right Button */}
            <button
              type="button"
              onClick={() => scrollFilmstrip("right")}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 flex size-7 items-center justify-center rounded-full bg-black/70 border border-white/20 text-white backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black cursor-pointer shadow-lg"
            >
              <ChevronRightIcon className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
