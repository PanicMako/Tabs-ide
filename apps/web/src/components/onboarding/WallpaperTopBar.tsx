import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DicesIcon,
  FilmIcon,
  LayoutGridIcon,
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
  readonly onPlaySound?: () => void;
  readonly disabled?: boolean;
  /**
   * Optional subset of wallpapers to cycle through. Defaults to all WALLPAPERS.
   * Pass BRIGHT_WALLPAPERS to restrict to non-Night scenes (for the wizard).
   */
  readonly wallpapers?: readonly WallpaperOption[];
  /**
   * Direction the filmstrip shelf should open. Defaults to "down".
   */
  readonly dropDirection?: "up" | "down";
  /**
   * Whether to show the horizontal filmstrip dock button. Defaults to true.
   */
  readonly showFilmstrip?: boolean;
}

export function WallpaperTopBar({
  activeWallpaperUrl,
  onSelectWallpaper,
  onOpenGallery,
  onPlaySound,
  disabled = false,
  wallpapers: wallpaperSet,
  dropDirection = "down",
  showFilmstrip = true,
}: WallpaperTopBarProps) {
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

  return (
    <div className="relative">
      {/* Sleek Top Wallpaper Control Bar */}
      <div className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/45 p-1 backdrop-blur-2xl shadow-lg shadow-black/40">
        {/* Previous Button */}
        <button
          type="button"
          disabled={disabled}
          onClick={handlePrev}
          className="flex size-7 items-center justify-center rounded-full text-white/70 transition-all hover:bg-white/10 hover:text-white active:scale-95 disabled:opacity-40 cursor-pointer"
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
          className="group flex items-center gap-2 rounded-full py-0.5 pl-1 pr-2.5 transition-all hover:bg-white/10 cursor-pointer"
          title="Click to browse all wallpapers in full gallery"
        >
          {/* Miniature 16:9 preview chip */}
          <div className="relative h-5.5 w-9 overflow-hidden rounded-md border border-white/30 bg-neutral-900 shadow-xs shrink-0 transition-transform duration-200 group-hover:scale-105">
            <img src={activeWallpaper.url} alt="" className="size-full object-cover" />
          </div>

          <div className="flex flex-col text-left">
            <span className="text-[11px] font-semibold leading-tight text-white/95 group-hover:text-white max-w-[100px] sm:max-w-[130px] truncate">
              {activeWallpaper.label}
            </span>
            <span className="text-[9px] font-mono leading-none text-white/50">
              {safeIndex + 1} / {wallpapers.length} • {activeWallpaper.category}
            </span>
          </div>

          <LayoutGridIcon className="size-3 text-white/40 transition-colors group-hover:text-white ml-0.5" />
        </button>

        {/* Next Button */}
        <button
          type="button"
          disabled={disabled}
          onClick={handleNext}
          className="flex size-7 items-center justify-center rounded-full text-white/70 transition-all hover:bg-white/10 hover:text-white active:scale-95 disabled:opacity-40 cursor-pointer"
          title="Next wallpaper (] or Alt+→])"
        >
          <ChevronRightIcon className="size-4" />
        </button>

        {/* Divider */}
        <div className="h-4 w-px bg-white/15 mx-0.5" />

        {/* Surprise Me / Random Shuffle */}
        <button
          type="button"
          disabled={disabled}
          onClick={handleRandom}
          className="flex size-7 items-center justify-center rounded-full text-amber-300/80 transition-all hover:bg-amber-400/20 hover:text-amber-200 active:scale-95 disabled:opacity-40 cursor-pointer"
          title="Surprise me with a random wallpaper"
        >
          <DicesIcon className="size-3.5" />
        </button>

        {/* Toggle Filmstrip Shelf */}
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
                : "text-white/60 hover:bg-white/10 hover:text-white",
            )}
            title="Toggle horizontal wallpaper filmstrip dock"
          >
            <FilmIcon className="size-3.5" />
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
