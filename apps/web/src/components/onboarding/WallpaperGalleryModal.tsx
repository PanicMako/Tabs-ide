import {
  CheckIcon,
  DicesIcon,
  PlusIcon,
  PowerOffIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import {
  WALLPAPERS,
  WALLPAPER_CATEGORIES,
  addCustomWallpaper,
  removeCustomWallpaper,
  type WallpaperCategory,
  type WallpaperOption,
} from "./wallpapers";

export interface WallpaperGalleryModalProps {
  readonly isOpen: boolean;
  readonly activeWallpaperUrl: string;
  readonly threadId?: string | null;
  readonly isThreadSpecific?: boolean;
  readonly theme?: "light" | "dark";
  readonly onSelectWallpaper: (wallpaper: WallpaperOption, scope: "global" | "thread") => void;
  readonly onClearThreadWallpaper?: () => void;
  readonly onClose: () => void;
  readonly onDisableWallpaper?: () => void;
  readonly onPlaySound?: () => void;
  /**
   * Optional subset of wallpapers to show. Defaults to all WALLPAPERS.
   */
  readonly wallpapers?: readonly WallpaperOption[];
}

export function WallpaperGalleryModal({
  isOpen,
  activeWallpaperUrl,
  threadId = null,
  isThreadSpecific = false,
  theme = "dark",
  onSelectWallpaper,
  onClearThreadWallpaper,
  onClose,
  onDisableWallpaper,
  onPlaySound,
  wallpapers: wallpaperSet,
}: WallpaperGalleryModalProps) {
  const isLight = theme === "light";
  const wallpapers = wallpaperSet ?? WALLPAPERS;
  const [selectedCategory, setSelectedCategory] = useState<WallpaperCategory>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [targetScope, setTargetScope] = useState<"thread" | "global">(
    threadId ? "thread" : "global",
  );
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState("");
  const [customLabelInput, setCustomLabelInput] = useState("");

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync scope when threadId changes
  useEffect(() => {
    setTargetScope(threadId ? "thread" : "global");
  }, [threadId]);

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
    setShowAddCustom(false);
  }, [isOpen]);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key !== "Tab") return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) ?? [],
      ).filter((node) => node.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [isOpen]);

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
    onSelectWallpaper(random, targetScope);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        const cleanName = file.name.replace(/\.[^/.]+$/, "");
        const added = addCustomWallpaper({
          label: cleanName || "Custom Anime Scene",
          url: dataUrl,
          description: "Uploaded custom image",
        });
        setSelectedCategory("Custom");
        onSelectWallpaper(added, targetScope);
        setShowAddCustom(false);
      }
    };
    reader.readAsDataURL(file);
    // Reset file input value so user can upload the same file again if desired
    e.target.value = "";
  };

  const handleAddUrl = () => {
    if (!customUrlInput.trim()) return;
    const added = addCustomWallpaper({
      label: customLabelInput.trim() || "Custom Anime Scene",
      url: customUrlInput.trim(),
      description: "Added via URL",
    });
    setCustomUrlInput("");
    setCustomLabelInput("");
    setSelectedCategory("Custom");
    onSelectWallpaper(added, targetScope);
    setShowAddCustom(false);
  };

  const handleDeleteCustom = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeCustomWallpaper(id);
  };

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallpaper-gallery-title"
      className={cn(
        "fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 backdrop-blur-md animate-in fade-in duration-200",
        isLight ? "bg-slate-900/40" : "bg-black/80",
      )}
      onClick={onClose}
    >
      <div
        className={cn(
          "relative flex flex-col w-full max-w-4xl max-h-[88vh] rounded-3xl border shadow-2xl backdrop-blur-3xl overflow-hidden select-none animate-in zoom-in-95 duration-200",
          isLight
            ? "border-slate-200 bg-white/95 text-slate-900 shadow-slate-900/20"
            : "border-white/20 bg-neutral-950/95 text-white shadow-[0_32px_90px_rgba(0,0,0,0.9)]",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div
          className={cn(
            "flex items-center justify-between border-b px-6 py-4.5 shrink-0",
            isLight ? "border-slate-200/80 bg-slate-50/50" : "border-white/10 bg-white/[0.02]",
          )}
        >
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex size-9 items-center justify-center rounded-xl border shadow-inner",
                isLight ? "border-slate-200 bg-white" : "border-white/15 bg-white/5",
              )}
            >
              <span className="text-base">🖼️</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="wallpaper-gallery-title"
                  className={cn(
                    "text-base font-bold tracking-tight",
                    isLight ? "text-slate-900" : "text-white",
                  )}
                >
                  Wallpaper Gallery
                </h2>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-mono font-medium border",
                    isLight
                      ? "bg-slate-100 text-slate-600 border-slate-200"
                      : "bg-white/10 text-white/70 border-white/10",
                  )}
                >
                  {wallpapers.length} scenes
                </span>
              </div>
              <p className={cn("text-xs", isLight ? "text-slate-500" : "text-white/50")}>
                Aesthetic anime landscapes for your workspace • Works in Light & Dark Mode
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onDisableWallpaper && (
              <button
                type="button"
                onClick={() => {
                  onDisableWallpaper();
                  onClose();
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all cursor-pointer active:scale-95",
                  isLight
                    ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                    : "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20",
                )}
                title="Turn off wallpaper (Hide pill and use standard IDE background)"
              >
                <PowerOffIcon className="size-3.5" />
                <span>Turn Off</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleShuffle}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all cursor-pointer active:scale-95",
                isLight
                  ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                  : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white",
              )}
              title="Pick a random wallpaper"
            >
              <DicesIcon className="size-3.5 text-amber-500" />
              <span>Surprise Me</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className={cn(
                "flex size-8 items-center justify-center rounded-full border transition-colors cursor-pointer",
                isLight
                  ? "border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white",
              )}
              title="Close gallery (Esc)"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </div>

        {/* Scope selector bar (if thread is active) */}
        {threadId && (
          <div
            className={cn(
              "flex items-center justify-between border-b px-6 py-2 text-xs",
              isLight
                ? "border-slate-200 bg-sky-50/70 text-slate-700"
                : "border-white/10 bg-sky-950/20 text-white/80",
            )}
          >
            <span className="font-medium">Apply wallpaper to:</span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="wallpaper-scope"
                  checked={targetScope === "thread"}
                  onChange={() => setTargetScope("thread")}
                  className="accent-sky-500"
                />
                <span>This thread only</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="wallpaper-scope"
                  checked={targetScope === "global"}
                  onChange={() => setTargetScope("global")}
                  className="accent-sky-500"
                />
                <span>All threads (Global)</span>
              </label>
              {isThreadSpecific && onClearThreadWallpaper && (
                <button
                  type="button"
                  onClick={() => {
                    onClearThreadWallpaper();
                    onClose();
                  }}
                  className="ml-3 flex items-center gap-1 text-[11px] text-sky-600 hover:underline cursor-pointer"
                >
                  <RotateCcwIcon className="size-3" />
                  <span>Reset to global wallpaper</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Filter and Search Bar */}
        <div
          className={cn(
            "flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b px-6 py-3.5 shrink-0",
            isLight ? "border-slate-200 bg-slate-100/60" : "border-white/10 bg-neutral-900/40",
          )}
        >
          {/* Category Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            {WALLPAPER_CATEGORIES.filter(
              (cat) =>
                cat === "All" || cat === "Custom" || wallpapers.some((w) => w.category === cat),
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
                      ? isLight
                        ? "border-sky-500 bg-sky-50 text-sky-800 font-semibold shadow-xs"
                        : "border-sky-400/50 bg-sky-500/20 text-sky-200 shadow-[0_0_12px_rgba(56,189,248,0.25)]"
                      : isLight
                        ? "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                        : "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <span>{cat}</span>
                  <span className="ml-1 text-[10px] opacity-60">({count})</span>
                </button>
              );
            })}
          </div>

          {/* Search Input & Custom Upload Trigger */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAddCustom((prev) => !prev)}
              className={cn(
                "flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border transition-colors cursor-pointer shrink-0",
                showAddCustom
                  ? "border-sky-500 bg-sky-500 text-white"
                  : isLight
                    ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white",
              )}
            >
              <PlusIcon className="size-3.5" />
              <span>Add Custom</span>
            </button>

            <div className="relative sm:w-52 shrink-0">
              <SearchIcon
                className={cn(
                  "absolute left-3 top-1/2 -translate-y-1/2 size-3.5 pointer-events-none",
                  isLight ? "text-slate-400" : "text-white/40",
                )}
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search wallpapers..."
                className={cn(
                  "w-full rounded-full border pl-8 pr-3 py-1 text-xs focus:outline-none focus:ring-1 transition-colors",
                  isLight
                    ? "border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:ring-sky-500/30"
                    : "border-white/15 bg-black/40 text-white placeholder-white/40 focus:border-sky-400 focus:ring-sky-400/50",
                )}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs opacity-50 hover:opacity-100 cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Custom Wallpaper Adder Banner */}
        {showAddCustom && (
          <div
            className={cn(
              "flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b px-6 py-3 shrink-0 animate-in slide-in-from-top-2 duration-150",
              isLight ? "border-slate-200 bg-sky-50/50" : "border-white/10 bg-neutral-900/90",
            )}
          >
            {/* Upload File */}
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                  isLight
                    ? "border-sky-300 bg-sky-100 text-sky-800 hover:bg-sky-200"
                    : "border-sky-500/40 bg-sky-500/20 text-sky-300 hover:bg-sky-500/30",
                )}
              >
                <UploadIcon className="size-3.5" />
                <span>Upload Image File</span>
              </button>
              <span className={cn("text-xs", isLight ? "text-slate-400" : "text-white/40")}>
                or
              </span>
            </div>

            {/* Paste URL */}
            <div className="flex flex-1 items-center gap-2 max-w-md">
              <input
                type="text"
                value={customLabelInput}
                onChange={(e) => setCustomLabelInput(e.target.value)}
                placeholder="Name (optional)"
                className={cn(
                  "w-32 rounded-lg border px-2.5 py-1 text-xs focus:outline-none",
                  isLight
                    ? "border-slate-200 bg-white text-slate-800"
                    : "border-white/15 bg-black/40 text-white",
                )}
              />
              <input
                type="url"
                value={customUrlInput}
                onChange={(e) => setCustomUrlInput(e.target.value)}
                placeholder="Paste image URL (https://...)"
                className={cn(
                  "flex-1 rounded-lg border px-2.5 py-1 text-xs focus:outline-none",
                  isLight
                    ? "border-slate-200 bg-white text-slate-800"
                    : "border-white/15 bg-black/40 text-white",
                )}
              />
              <button
                type="button"
                onClick={handleAddUrl}
                disabled={!customUrlInput.trim()}
                className="rounded-lg bg-sky-500 px-3 py-1 text-xs font-semibold text-white transition-opacity disabled:opacity-40 cursor-pointer hover:bg-sky-600"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* Wallpaper Grid */}
        <div
          className={cn(
            "flex-1 overflow-y-auto p-6 scrollbar-thin",
            isLight
              ? "scrollbar-thumb-slate-300 scrollbar-track-transparent"
              : "scrollbar-thumb-white/20 scrollbar-track-transparent",
          )}
        >
          {filteredWallpapers.length === 0 ? (
            <div
              className={cn(
                "flex flex-col items-center justify-center py-16 text-center",
                isLight ? "text-slate-500" : "text-white/50",
              )}
            >
              <span className="text-3xl mb-2">🔍</span>
              <p className="text-sm font-medium">No wallpapers found</p>
              <p className={cn("text-xs mt-1", isLight ? "text-slate-400" : "text-white/40")}>
                Try searching with different terms or upload your own custom wallpaper.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("All");
                }}
                className={cn(
                  "mt-4 rounded-full border px-4 py-1.5 text-xs transition-colors cursor-pointer",
                  isLight
                    ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white",
                )}
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
                      onSelectWallpaper(wp, targetScope);
                      onPlaySound?.();
                    }}
                    className={cn(
                      "group relative flex flex-col overflow-hidden rounded-2xl border text-left transition-all duration-200 cursor-pointer select-none focus:outline-none",
                      isSelected
                        ? isLight
                          ? "border-sky-500 ring-2 ring-sky-500/40 bg-sky-50 shadow-md scale-[1.02]"
                          : "border-sky-400 ring-2 ring-sky-400/50 bg-sky-950/30 shadow-[0_8px_24px_rgba(56,189,248,0.25)] scale-[1.02]"
                        : isLight
                          ? "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md hover:scale-[1.01]"
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
                      <span className="absolute left-2 top-2 rounded-md bg-black/60 backdrop-blur-md px-1.5 py-0.5 text-[9px] font-mono font-medium text-white/90 border border-white/10">
                        {wp.category}
                      </span>

                      {/* Custom Delete Action */}
                      {wp.isCustom && (
                        <button
                          type="button"
                          onClick={(e) => handleDeleteCustom(e, wp.id)}
                          className="absolute left-2 bottom-2 z-10 flex size-6 items-center justify-center rounded-md bg-black/60 text-red-400 hover:bg-red-600 hover:text-white transition-colors cursor-pointer"
                          title="Delete custom wallpaper"
                        >
                          <Trash2Icon className="size-3.5" />
                        </button>
                      )}

                      {/* Active Checkmark Pill */}
                      {isSelected && (
                        <div className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-emerald-500 text-black shadow-md">
                          <CheckIcon className="size-3.5 stroke-[3]" />
                        </div>
                      )}

                      {/* Title overlay inside thumbnail */}
                      <div className="absolute bottom-2 left-2 right-2">
                        <span
                          className={cn(
                            "block text-xs font-bold text-white tracking-tight drop-shadow-md truncate",
                            wp.isCustom ? "ml-7" : "",
                          )}
                        >
                          {wp.label}
                        </span>
                      </div>
                    </div>

                    {/* Card Description */}
                    <div className="p-2.5">
                      <p
                        className={cn(
                          "text-[11px] leading-tight line-clamp-1 transition-colors",
                          isLight
                            ? "text-slate-500 group-hover:text-slate-800"
                            : "text-white/50 group-hover:text-white/70",
                        )}
                      >
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
        <div
          className={cn(
            "flex items-center justify-between border-t px-6 py-3 shrink-0 text-xs",
            isLight
              ? "border-slate-200 bg-slate-50 text-slate-500"
              : "border-white/10 bg-white/[0.02] text-white/50",
          )}
        >
          <span>
            {targetScope === "thread" && threadId
              ? "Clicking a wallpaper applies it to this thread"
              : "Clicking a wallpaper applies it across all threads"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "rounded-xl px-4 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
              isLight
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "bg-white text-black hover:bg-neutral-200",
            )}
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
