import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  DicesIcon,
  LayoutGridIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { SettingsSection, SettingsRow, SettingsSectionHeader } from "./SettingsLayout";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import { useTheme } from "../../hooks/useTheme";
import {
  WALLPAPERS,
  WALLPAPER_CATEGORIES,
  type WallpaperCategory,
  type WallpaperOption,
  getInitialAgentWallpaper,
  saveAgentWallpaperPreference,
  getIsAgentWallpaperEnabled,
  saveIsAgentWallpaperEnabled,
  getCustomWallpapers,
  addCustomWallpaper,
  removeCustomWallpaper,
  getAllAgentWallpapers,
  getAllThreadWallpaperAssignments,
  clearThreadWallpaper,
  AGENT_WALLPAPER_CHANGE_EVENT,
} from "../onboarding/wallpapers";
import { WallpaperGalleryModal } from "../onboarding/WallpaperGalleryModal";

import { useSettingsStudyAppearance } from "./SettingsEditorialFrame";

export default function WallpaperSettings() {
  const { resolvedTheme: workspaceTheme } = useTheme();
  const studyAppearance = useSettingsStudyAppearance();
  const resolvedTheme = studyAppearance ?? workspaceTheme;
  const isLight = resolvedTheme === "light";

  const [isEnabled, setIsEnabled] = useState<boolean>(() => getIsAgentWallpaperEnabled());
  const [activeWallpaper, setActiveWallpaper] = useState<WallpaperOption>(() =>
    getInitialAgentWallpaper(),
  );
  const [customWallpapers, setCustomWallpapers] = useState<readonly WallpaperOption[]>(() =>
    getCustomWallpapers(),
  );
  const [threadAssignments, setThreadAssignments] = useState<Record<string, string>>(() =>
    getAllThreadWallpaperAssignments(),
  );
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<WallpaperCategory>("All");
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState("");
  const [customLabelInput, setCustomLabelInput] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync state on events
  const syncState = useCallback(() => {
    setIsEnabled(getIsAgentWallpaperEnabled());
    setActiveWallpaper(getInitialAgentWallpaper());
    setCustomWallpapers(getCustomWallpapers());
    setThreadAssignments(getAllThreadWallpaperAssignments());
  }, []);

  useEffect(() => {
    window.addEventListener(AGENT_WALLPAPER_CHANGE_EVENT, syncState);
    window.addEventListener("storage", syncState);
    return () => {
      window.removeEventListener(AGENT_WALLPAPER_CHANGE_EVENT, syncState);
      window.removeEventListener("storage", syncState);
    };
  }, [syncState]);

  const handleToggle = (checked: boolean) => {
    saveIsAgentWallpaperEnabled(checked);
    setIsEnabled(checked);
  };

  const handleSelect = (wp: WallpaperOption) => {
    saveAgentWallpaperPreference(wp.url);
    setActiveWallpaper(wp);
  };

  const handleShuffle = () => {
    const all = getAllAgentWallpapers();
    const others = all.filter((w) => w.url !== activeWallpaper.url);
    const random = others[Math.floor(Math.random() * others.length)] ?? all[0]!;
    handleSelect(random);
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
        setCustomWallpapers(getCustomWallpapers());
        handleSelect(added);
        setShowAddCustom(false);
      }
    };
    reader.readAsDataURL(file);
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
    setCustomWallpapers(getCustomWallpapers());
    handleSelect(added);
    setShowAddCustom(false);
  };

  const handleDeleteCustom = (id: string) => {
    removeCustomWallpaper(id);
    setCustomWallpapers(getCustomWallpapers());
    // If the active wallpaper was deleted, fall back to default
    if (activeWallpaper.id === id) {
      handleSelect(WALLPAPERS[0]!);
    }
  };

  const handleClearThreadAssignment = (threadId: string) => {
    clearThreadWallpaper(threadId);
    setThreadAssignments(getAllThreadWallpaperAssignments());
  };

  const allWallpapers = getAllAgentWallpapers();
  const filteredWallpapers = useMemo(() => {
    if (selectedCategory === "All") return allWallpapers;
    return allWallpapers.filter((w) => w.category === selectedCategory);
  }, [allWallpapers, selectedCategory]);

  const threadEntries = Object.entries(threadAssignments);

  return (
    <div className="flex flex-col gap-7">
      <SettingsSectionHeader
        title="Workspace Wallpapers"
        description="Immersive aesthetic backdrops for the agent workspace with animated particles, dual light/dark mode blending, and per-thread customization."
      />

      {/* ── Main Feature Toggle Section ───────────────────────────── */}
      <SettingsSection
        title="Workspace Wallpapers"
        description="Configure whether wallpapers are active in the agent chat area."
      >
        <SettingsRow
          title="Enable Workspace Wallpapers"
          description="Off by default for a classic dark IDE look. When enabled, displays anime backgrounds in the workspace that gracefully blend with Light and Dark modes."
          status={
            isEnabled ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-500 border border-emerald-500/30">
                Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground border border-border/50">
                Off
              </span>
            )
          }
          control={<Switch checked={isEnabled} onCheckedChange={handleToggle} />}
        />
      </SettingsSection>

      {/* ── Active Wallpaper Showcase (No nested container!) ─────── */}
      {isEnabled && (
        <SettingsSection
          title="Active Wallpaper"
          description="Currently active workspace wallpaper. Adapts automatically to Light and Dark mode."
        >
          <div className="p-5 sm:p-6 w-full flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 min-w-0 flex-1">
              {/* 16:9 widescreen preview card */}
              <div className="relative aspect-video w-full sm:w-52 shrink-0 overflow-hidden rounded-xl border border-border shadow-md bg-neutral-900 group">
                <img
                  src={activeWallpaper.url}
                  alt={activeWallpaper.label}
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-emerald-500 text-black px-2 py-0.5 text-[10px] font-bold shadow-xs">
                  <CheckIcon className="size-3 stroke-[3]" />
                  <span>ACTIVE</span>
                </div>
                <span className="absolute bottom-2 left-2.5 text-xs font-semibold text-white truncate max-w-[85%] drop-shadow-sm">
                  {activeWallpaper.label}
                </span>
              </div>

              {/* Details & Adaptation hint */}
              <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base font-semibold text-foreground tracking-tight">
                    {activeWallpaper.label}
                  </span>
                  <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-mono font-medium text-muted-foreground border border-border/60">
                    {activeWallpaper.category}
                  </span>
                  {activeWallpaper.isCustom && (
                    <span className="rounded-full bg-sky-500/15 text-sky-400 px-2.5 py-0.5 text-[11px] font-medium border border-sky-400/30">
                      Custom
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                  {activeWallpaper.description}
                </p>
                <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground/80">
                  <span>
                    {isLight
                      ? "☀️ Radiant Light Mode: Artwork washes smoothly into pure white canvas"
                      : "🌙 Cinematic Dark Mode: Deep neutral vignette with depth mask"}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2.5 shrink-0 w-full md:w-auto justify-end flex-wrap pt-2 md:pt-0 border-t md:border-t-0 border-border/50">
              <Button
                variant="outline"
                size="sm"
                onClick={handleShuffle}
                className="gap-1.5 cursor-pointer rounded-lg hover:border-amber-500/40 hover:text-amber-500 transition-colors"
              >
                <DicesIcon className="size-3.5 text-amber-500" />
                <span>Surprise Me</span>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsGalleryOpen(true)}
                className="gap-1.5 cursor-pointer rounded-lg shadow-xs"
              >
                <LayoutGridIcon className="size-3.5" />
                <span>Full Gallery ({allWallpapers.length})</span>
              </Button>
            </div>
          </div>
        </SettingsSection>
      )}

      {/* ── Curated Gallery Section ──────────────────────────────── */}
      <SettingsSection
        title="Curated Gallery"
        description="Browse high-resolution anime scenes and click to set as active."
      >
        <div className="p-5 sm:p-6 w-full flex flex-col gap-5">
          {/* Category Filter Pills with generous padding and count badges */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1.5 pt-0.5 px-0.5 scrollbar-thin">
            {WALLPAPER_CATEGORIES.map((cat) => {
              const isCatSelected = selectedCategory === cat;
              const count =
                cat === "All"
                  ? allWallpapers.length
                  : allWallpapers.filter((w) => w.category === cat).length;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all shrink-0 cursor-pointer border select-none",
                    isCatSelected
                      ? "border-primary bg-primary text-primary-foreground font-semibold shadow-xs"
                      : "border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground hover:border-border",
                  )}
                >
                  <span>{cat}</span>
                  <span
                    className={cn(
                      "text-[10px] font-mono px-1.5 py-0.2 rounded-full",
                      isCatSelected
                        ? "bg-primary-foreground/20 text-primary-foreground font-bold"
                        : "bg-muted-foreground/15 text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 16:9 Wallpaper Card Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {filteredWallpapers.map((wp) => {
              const isSelected = wp.url === activeWallpaper.url;
              return (
                <button
                  key={wp.id}
                  type="button"
                  onClick={() => handleSelect(wp)}
                  className={cn(
                    "group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-200 cursor-pointer select-none focus:outline-none",
                    isSelected
                      ? "border-sky-500 ring-2 ring-sky-500/40 bg-sky-500/5 shadow-md scale-[1.02]"
                      : "border-border/60 bg-card/40 hover:border-border hover:shadow-lg hover:scale-[1.02]",
                  )}
                >
                  <div className="relative aspect-video w-full overflow-hidden bg-neutral-900">
                    <img
                      src={wp.url}
                      alt={wp.label}
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent pointer-events-none" />
                    <span className="absolute left-2 top-2 rounded bg-black/60 backdrop-blur-xs px-1.5 py-0.5 text-[9px] font-mono font-medium text-white/90 border border-white/10">
                      {wp.category}
                    </span>
                    {isSelected && (
                      <div className="absolute right-2 top-2 flex size-5.5 items-center justify-center rounded-full bg-emerald-500 text-black shadow-md ring-2 ring-emerald-400/40">
                        <CheckIcon className="size-3.5 stroke-[3]" />
                      </div>
                    )}
                    <span className="absolute bottom-2 left-2.5 right-2.5 text-xs font-bold text-white truncate drop-shadow-md">
                      {wp.label}
                    </span>
                  </div>
                  <div className="p-2.5">
                    <p className="text-[11px] text-muted-foreground leading-snug line-clamp-1">
                      {wp.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </SettingsSection>

      {/* ── Custom Wallpaper Manager ─────────────────────────────── */}
      <SettingsSection
        title="Custom Wallpapers"
        description="Add your own favorite anime images from your computer or web URLs."
      >
        <div className="p-5 sm:p-6 w-full flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {customWallpapers.length === 0
                ? "No custom wallpapers imported yet."
                : `${customWallpapers.length} custom image${customWallpapers.length === 1 ? "" : "s"} imported.`}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddCustom((prev) => !prev)}
              className="gap-1.5 cursor-pointer self-start sm:self-auto"
            >
              <PlusIcon className="size-3.5" />
              <span>{showAddCustom ? "Cancel" : "Add Custom Wallpaper"}</span>
            </Button>
          </div>

          {/* Add Custom drawer / input form */}
          {showAddCustom && (
            <div className="flex flex-col gap-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 animate-in slide-in-from-top-2 duration-150">
              <span className="text-xs font-semibold text-foreground">Import Anime Wallpaper</span>
              <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-2 cursor-pointer shrink-0"
                >
                  <UploadIcon className="size-3.5 text-sky-500" />
                  <span>Upload Local File</span>
                </Button>
                <span className="text-xs text-muted-foreground text-center md:text-left">
                  or URL:
                </span>
                <Input
                  type="text"
                  value={customLabelInput}
                  onChange={(e) => setCustomLabelInput(e.target.value)}
                  placeholder="Scene Name (optional)"
                  className="h-8.5 text-xs md:w-48"
                />
                <Input
                  type="url"
                  value={customUrlInput}
                  onChange={(e) => setCustomUrlInput(e.target.value)}
                  placeholder="https://images.example.com/anime.jpg"
                  className="h-8.5 text-xs flex-1"
                />
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleAddUrl}
                  disabled={!customUrlInput.trim()}
                  className="cursor-pointer shrink-0"
                >
                  Add Image
                </Button>
              </div>
            </div>
          )}

          {/* Empty State vs Card Grid */}
          {customWallpapers.length === 0 && !showAddCustom ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-8 text-center bg-card/20">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted/60 mb-2.5">
                <UploadIcon className="size-5 text-muted-foreground" />
              </div>
              <span className="text-xs font-medium text-foreground">No Custom Wallpapers</span>
              <p className="text-[11px] text-muted-foreground max-w-sm mt-1">
                Upload your favorite high-resolution anime scenes from your desktop or import them
                via URL.
              </p>
              <Button
                variant="outline"
                size="xs"
                onClick={() => setShowAddCustom(true)}
                className="mt-3 gap-1.5 text-xs cursor-pointer"
              >
                <PlusIcon className="size-3" />
                <span>Import First Wallpaper</span>
              </Button>
            </div>
          ) : (
            customWallpapers.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 pt-1">
                {customWallpapers.map((wp) => {
                  const isActive = wp.url === activeWallpaper.url;
                  return (
                    <div
                      key={wp.id}
                      className={cn(
                        "group relative flex flex-col overflow-hidden rounded-xl border transition-all",
                        isActive
                          ? "border-sky-500 ring-2 ring-sky-500/40 bg-sky-500/5 shadow-sm"
                          : "border-border/70 bg-card/40 hover:border-border",
                      )}
                    >
                      <div className="relative aspect-video w-full overflow-hidden bg-neutral-900">
                        <img src={wp.url} alt={wp.label} className="size-full object-cover" />
                        {isActive && (
                          <div className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-black shadow-xs">
                            <CheckIcon className="size-3 stroke-[3]" />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteCustom(wp.id)}
                          className="absolute left-2 bottom-2 flex size-6.5 items-center justify-center rounded-md bg-black/70 text-red-400 hover:bg-red-600 hover:text-white transition-colors cursor-pointer shadow-xs"
                          title="Delete custom wallpaper"
                          aria-label="Delete custom wallpaper"
                        >
                          <Trash2Icon className="size-3" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between p-2.5">
                        <span
                          className="text-xs font-medium text-foreground truncate"
                          title={wp.label}
                        >
                          {wp.label}
                        </span>
                        {!isActive && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => handleSelect(wp)}
                            className="h-6 text-[10px] cursor-pointer"
                          >
                            Use
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      </SettingsSection>

      {/* ── Per-Thread Wallpaper Assignments ──────────────────────── */}
      <SettingsSection
        title="Per-Thread Wallpapers"
        description="Wallpapers assigned specifically to individual chat threads."
      >
        <div className="p-5 sm:p-6 w-full flex flex-col gap-3">
          {threadEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 p-6 text-center bg-card/20">
              <span className="text-xs font-medium text-foreground">No Per-Thread Overrides</span>
              <p className="text-[11px] text-muted-foreground max-w-md mx-auto mt-1">
                All chat threads currently use the global active wallpaper. When inside any thread,
                you can customize its individual background using the wallpaper menu.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {threadEntries.map(([threadId, url]) => {
                const matched = allWallpapers.find((w) => w.url === url);
                return (
                  <div
                    key={threadId}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/40 p-3 hover:border-border transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative aspect-video w-16 overflow-hidden rounded-lg border border-border shrink-0 bg-neutral-900">
                        <img src={url} alt="" className="size-full object-cover" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-semibold text-foreground truncate max-w-[200px] sm:max-w-xs">
                          Thread: {threadId.slice(0, 16)}...
                        </span>
                        <span className="text-[11px] text-muted-foreground truncate">
                          {matched?.label ?? "Custom Wallpaper"}
                        </span>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => handleClearThreadAssignment(threadId)}
                      className="gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                    >
                      <RotateCcwIcon className="size-3" />
                      <span>Reset to Default</span>
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SettingsSection>

      {/* ── Full Modal ────────────────────────────────────────────── */}
      <WallpaperGalleryModal
        isOpen={isGalleryOpen}
        activeWallpaperUrl={activeWallpaper.url}
        theme={resolvedTheme}
        onSelectWallpaper={(wp) => {
          handleSelect(wp);
          setIsGalleryOpen(false);
        }}
        onDisableWallpaper={() => {
          handleToggle(false);
          setIsGalleryOpen(false);
        }}
        onClose={() => setIsGalleryOpen(false)}
        wallpapers={allWallpapers}
      />
    </div>
  );
}
