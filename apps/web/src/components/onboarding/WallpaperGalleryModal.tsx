import { CheckIcon, DicesIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import {
  WALLPAPERS,
  WALLPAPER_CATEGORIES,
  type WallpaperCategory,
  type WallpaperOption,
} from "./wallpapers";

export interface WallpaperGalleryModalProps {
  readonly isOpen: boolean;
  readonly activeWallpaperUrl: string;
  readonly onSelectWallpaper: (wallpaper: WallpaperOption) => void;
  readonly onClose: () => void;
  readonly onPlaySound?: () => void;
  /**
   * Optional subset of wallpapers to show. Defaults to all WALLPAPERS.
   * Pass BRIGHT_WALLPAPERS to restrict the gallery to non-Night scenes.
   */
  readonly wallpapers?: readonly WallpaperOption[];
}

export function WallpaperGalleryModal({
  isOpen,
  activeWallpaperUrl,
  onSelectWallpaper,
  onClose,
  onPlaySound,
  wallpapers: wallpaperSet,
}: WallpaperGalleryModalProps) {
  const wallpapers = wallpaperSet ?? WALLPAPERS;
  const [selectedCategory, setSelectedCategory] = useState<WallpaperCategory>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Focus search input when opening
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
    setSearchQuery("");
    setSelectedCategory("All");
  }, [isOpen]);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const filteredWallpapers = useMemo(() => {
    return wallpapers.filter((wp) => {
      const matchesCategory = selectedCategory === "All" || wp.category === selectedCategory;
      const matchesSearch =
        searchQuery.trim().length === 0 ||
        wp.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        wp.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        wp.category.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [wallpapers, selectedCategory, searchQuery]);

  if (!isOpen) return null;

  const handleShuffle = () => {
    onPlaySound?.();
    const otherWallpapers = wallpapers.filter((w) => w.url !== activeWallpaperUrl);
    const random =
      otherWallpapers[Math.floor(Math.random() * otherWallpapers.length)] ?? wallpapers[0]!;
    onSelectWallpaper(random);
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallpaper-gallery-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-4xl max-h-[90vh] rounded-3xl border border-white/20 bg-neutral-950/95 backdrop-blur-3xl shadow-[0_32px_90px_rgba(0,0,0,0.9)] overflow-hidden text-white select-none animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4.5 shrink-0 bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl border border-white/15 bg-white/5 shadow-inner">
              <span className="text-base">🖼️</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="wallpaper-gallery-title"
                  className="text-base font-bold text-white tracking-tight"
                >
                  Wallpaper Gallery
                </h2>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-mono font-medium text-white/70 border border-white/10">
                  {wallpapers.length} scenes
                </span>
              </div>
              <p className="text-xs text-white/50">
                Curated aesthetic anime landscapes for your Tabs IDE workspace
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleShuffle}
              className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition-all hover:border-white/30 hover:bg-white/10 hover:text-white cursor-pointer active:scale-95"
              title="Pick a random wallpaper"
            >
              <DicesIcon className="size-3.5 text-amber-400" />
              <span>Surprise Me</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white cursor-pointer"
              title="Close gallery (Esc)"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-white/10 px-6 py-3.5 shrink-0 bg-neutral-900/40">
          {/* Category Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            {WALLPAPER_CATEGORIES.filter(
              (cat) => cat === "All" || wallpapers.some((w) => w.category === cat),
            ).map((cat) => {
              const isSelected = selectedCategory === cat;
              const count =
                cat === "All"
                  ? wallpapers.length
                  : wallpapers.filter((w) => w.category === cat).length;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(cat);
                    onPlaySound?.();
                  }}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-all shrink-0 cursor-pointer select-none border",
                    isSelected
                      ? "border-sky-400/50 bg-sky-500/20 text-sky-200 shadow-[0_0_12px_rgba(56,189,248,0.25)]"
                      : "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <span>{cat}</span>
                  <span className="ml-1 text-[10px] opacity-60">({count})</span>
                </button>
              );
            })}
          </div>

          {/* Search Input */}
          <div className="relative sm:w-56 shrink-0">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-white/40 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search wallpapers..."
              className="w-full rounded-full border border-white/15 bg-black/40 pl-8 pr-3 py-1 text-xs text-white placeholder-white/40 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400/50 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Wallpaper Grid */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
          {filteredWallpapers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-white/50">
              <span className="text-3xl mb-2">🔍</span>
              <p className="text-sm font-medium">No wallpapers found</p>
              <p className="text-xs text-white/40 mt-1">
                Try searching with different terms or selecting another category.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("All");
                }}
                className="mt-4 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs text-white/80 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {filteredWallpapers.map((wp) => {
                const isSelected = wp.url === activeWallpaperUrl;
                return (
                  <button
                    key={wp.id}
                    type="button"
                    onClick={() => {
                      onSelectWallpaper(wp);
                      onPlaySound?.();
                    }}
                    className={cn(
                      "group relative flex flex-col overflow-hidden rounded-2xl border text-left transition-all duration-200 cursor-pointer select-none focus:outline-none",
                      isSelected
                        ? "border-sky-400 ring-2 ring-sky-400/50 bg-sky-950/30 shadow-[0_8px_24px_rgba(56,189,248,0.25)] scale-[1.02]"
                        : "border-white/15 bg-white/[0.03] hover:border-white/35 hover:bg-white/[0.08] hover:scale-[1.01] hover:shadow-lg shadow-black/40",
                    )}
                  >
                    {/* 16:9 Thumbnail Image */}
                    <div className="relative aspect-video w-full overflow-hidden bg-neutral-900">
                      <img
                        src={wp.url}
                        alt={wp.label}
                        loading="lazy"
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-108"
                      />
                      {/* Gradient overlay for text contrast */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />

                      {/* Category Badge */}
                      <span className="absolute left-2 top-2 rounded-md bg-black/60 backdrop-blur-md px-1.5 py-0.5 text-[9px] font-mono font-medium text-white/80 border border-white/10">
                        {wp.category}
                      </span>

                      {/* Active Checkmark Pill */}
                      {isSelected && (
                        <div className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-emerald-500 text-black shadow-md">
                          <CheckIcon className="size-3.5 stroke-[3]" />
                        </div>
                      )}

                      {/* Title overlay inside thumbnail */}
                      <div className="absolute bottom-2 left-2 right-2">
                        <span className="block text-xs font-bold text-white tracking-tight drop-shadow-md truncate">
                          {wp.label}
                        </span>
                      </div>
                    </div>

                    {/* Card Description */}
                    <div className="p-2.5">
                      <p className="text-[11px] text-white/50 leading-tight line-clamp-1 group-hover:text-white/70 transition-colors">
                        {wp.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 px-6 py-3 shrink-0 bg-white/[0.02] text-xs text-white/50">
          <span>Click any wallpaper to apply instantly</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-white px-4 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-neutral-200 cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
