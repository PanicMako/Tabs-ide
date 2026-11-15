import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  CheckIcon,
  DicesIcon,
  LayoutGridIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { SettingsSection, SettingsSectionHeader } from "./SettingsLayout";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { cn } from "../../lib/utils";
import { useTheme } from "../../hooks/useTheme";
import {
  WALLPAPERS,
  type WallpaperOption,
  getInitialAgentWallpaper,
  saveAgentWallpaperPreference,
  getIsAgentWallpaperEnabled,
  saveIsAgentWallpaperEnabled,
  getCustomWallpapers,
  removeCustomWallpaper,
  getAllAgentWallpapers,
  getAllThreadWallpaperAssignments,
  clearThreadWallpaper,
  AGENT_WALLPAPER_CHANGE_EVENT,
} from "../onboarding/wallpapers";
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
} from "../onboarding/wallpaperPrint";
import { WallpaperPrintLayer } from "../WallpaperPrintLayer";
import { WallpaperGalleryModal } from "../onboarding/WallpaperGalleryModal";
import { WallpaperImportDialog } from "../onboarding/WallpaperImportDialog";

import { useSettingsStudyAppearance } from "./SettingsEditorialFrame";

const STRENGTH_OPTIONS: ReadonlyArray<{ value: WallpaperPrintStrength; label: string }> = [
  { value: 1, label: "Subtle" },
  { value: 2, label: "Balanced" },
  { value: 3, label: "Bold" },
];

/** One style drawn over the current wallpaper, using the same renderer as the workspace. */
function PrintStylePreview({
  style,
  wallpaperUrl,
  strength,
}: {
  readonly style: WallpaperPrintStyle;
  readonly wallpaperUrl: string;
  readonly strength: WallpaperPrintStrength;
}) {
  const [unreadable, setUnreadable] = useState(false);
  const generated = style !== "halftone" && style !== "none" && !unreadable;
  return (
    <div
      aria-hidden="true"
      className="relative aspect-video w-full overflow-hidden rounded-lg bg-neutral-900 bg-cover bg-center"
      style={{ backgroundImage: `url(${wallpaperUrl})` }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,7,12,.1),rgba(5,7,12,.6))]" />
      {style === "none" ? null : generated ? (
        <div className="absolute inset-0">
          <WallpaperPrintLayer
            url={wallpaperUrl}
            style={style}
            strength={strength}
            ink="light"
            onUnavailable={() => setUnreadable(true)}
          />
        </div>
      ) : (
        <div className="agent-wallpaper-halftone absolute inset-0" />
      )}
    </div>
  );
}

export default function WallpaperSettings({ onBack }: { onBack?: () => void } = {}) {
  const { resolvedTheme: workspaceTheme } = useTheme();
  const studyAppearance = useSettingsStudyAppearance();
  const resolvedTheme = studyAppearance ?? workspaceTheme;

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
  const [printStyle, setPrintStyle] = useState<WallpaperPrintStyle>(() => getWallpaperPrintStyle());
  const [printStrength, setPrintStrength] = useState<WallpaperPrintStrength>(() =>
    getWallpaperPrintStrength(),
  );
  const [printAnimate, setPrintAnimate] = useState<boolean>(() => getWallpaperPrintAnimate());
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const importOpener = useRef<HTMLElement | null>(null);

  // Sync state on events
  const syncState = useCallback(() => {
    setIsEnabled(getIsAgentWallpaperEnabled());
    setActiveWallpaper(getInitialAgentWallpaper());
    setCustomWallpapers(getCustomWallpapers());
    setThreadAssignments(getAllThreadWallpaperAssignments());
    setPrintStyle(getWallpaperPrintStyle());
    setPrintStrength(getWallpaperPrintStrength());
    setPrintAnimate(getWallpaperPrintAnimate());
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

  const threadEntries = Object.entries(threadAssignments);

  return (
    <div className="flex flex-col gap-7">
      <SettingsSectionHeader
        title="Workspace Wallpapers"
        description="Choose a background for agent chats. Individual threads can use a different image."
        preTitle={
          onBack ? (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={onBack}
              aria-label="Back to Labs"
              className="size-8 shrink-0 rounded-full border-border/80 bg-background/60 hover:bg-accent hover:border-foreground/30 text-muted-foreground hover:text-foreground shadow-xs transition-colors active:scale-95"
            >
              <ArrowLeftIcon className="size-4" aria-hidden="true" />
            </Button>
          ) : undefined
        }
      />

      <section
        aria-labelledby="wallpaper-current-heading"
        className="@container rounded-[var(--radius-surface)] border border-border bg-card p-4 sm:p-5"
      >
        <div className="grid gap-5 @xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] @xl:items-center">
          <div className="aspect-video overflow-hidden rounded-xl bg-muted">
            <img src={activeWallpaper.url} alt="" className="size-full object-cover" />
          </div>
          <div className="grid min-w-0 content-center gap-4 @xl:px-2">
            <div>
              <h2
                id="wallpaper-current-heading"
                className="text-sm font-medium text-muted-foreground"
              >
                Workspace wallpaper
              </h2>
              <p className="mt-1 wrap-anywhere text-xl font-semibold text-foreground">
                {activeWallpaper.label}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {activeWallpaper.description}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setIsGalleryOpen(true)}>
                <LayoutGridIcon aria-hidden="true" /> Change wallpaper
              </Button>
              <Button variant="ghost" onClick={handleShuffle}>
                <DicesIcon aria-hidden="true" /> Shuffle
              </Button>
            </div>
            <label className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <span className="text-sm">Show in agent chats</span>
              <Switch checked={isEnabled} onCheckedChange={handleToggle} />
            </label>
          </div>
        </div>
      </section>

      <SettingsSection
        title="Print style"
        description="Draw the wallpaper as text, lines or pixels. It is rendered once, so it costs nothing while you work."
      >
        <div className="grid gap-4 p-4 sm:p-5">
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,150px),1fr))] gap-3">
            {WALLPAPER_PRINT_STYLES.map((option) => {
              const selected = option.id === printStyle;
              return (
                <li key={option.id} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setPrintStyle(option.id);
                      saveWallpaperPrintStyle(option.id);
                    }}
                    className={cn(
                      "grid w-full cursor-pointer gap-2 rounded-xl p-1.5 text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring",
                      selected ? "ring-2 ring-ring" : "hover:bg-accent/60",
                    )}
                  >
                    <PrintStylePreview
                      style={option.id}
                      wallpaperUrl={activeWallpaper.url}
                      strength={printStrength}
                    />
                    <span className="px-0.5">
                      <span className="block text-sm font-medium text-foreground">
                        {option.label}
                      </span>
                      <span className="block text-xs leading-snug text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div
            role="radiogroup"
            aria-label="Print strength"
            className="inline-flex w-fit rounded-full border border-border p-0.5"
          >
            {STRENGTH_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={printStrength === option.value}
                onClick={() => {
                  setPrintStrength(option.value);
                  saveWallpaperPrintStrength(option.value);
                }}
                className={cn(
                  "cursor-pointer rounded-full px-3.5 py-1 text-xs font-medium transition-colors",
                  printStrength === option.value
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="grid gap-0.5">
              <span className="text-sm">Animate the print</span>
              <span className="text-xs text-muted-foreground">
                The print's characters and dots flow and shift. Paused when Reduce motion is on; off
                by default on Windows and Linux.
              </span>
            </span>
            <Switch
              checked={printAnimate}
              onCheckedChange={(checked) => {
                setPrintAnimate(checked);
                saveWallpaperPrintAnimate(checked);
              }}
            />
          </label>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Custom Wallpapers"
        description="Use an image from your computer or add one by URL."
        headerAction={
          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              importOpener.current = event.currentTarget;
              setShowAddCustom(true);
            }}
          >
            <PlusIcon aria-hidden="true" /> Add Custom Wallpaper
          </Button>
        }
      >
        {customWallpapers.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">
            Images you add will appear here and in the wallpaper gallery.
          </p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,170px),1fr))] gap-4 p-4 sm:p-5">
            {customWallpapers.map((wallpaper) => {
              const selected = wallpaper.url === activeWallpaper.url;
              return (
                <li key={wallpaper.id} className="grid min-w-0 content-start gap-2">
                  <button
                    type="button"
                    aria-label={`Use ${wallpaper.label}`}
                    aria-pressed={selected}
                    onClick={() => handleSelect(wallpaper)}
                    className={cn(
                      "relative aspect-video cursor-pointer overflow-hidden rounded-xl bg-muted outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring",
                      selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                    )}
                  >
                    <img
                      src={wallpaper.url}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                    {selected && (
                      <span className="absolute end-2 top-2 grid size-6 place-items-center rounded-full bg-background text-foreground">
                        <CheckIcon className="size-3.5" aria-hidden="true" />
                      </span>
                    )}
                  </button>
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-sm" title={wallpaper.label}>
                      {wallpaper.label}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDeleteCustom(wallpaper.id)}
                      aria-label={`Delete ${wallpaper.label}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>

      <WallpaperImportDialog
        isOpen={showAddCustom}
        onClose={() => setShowAddCustom(false)}
        onImport={handleSelect}
        finalFocus={importOpener}
      />

      {/* ── Per-Thread Wallpaper Assignments ──────────────────────── */}
      <SettingsSection
        title="Per-Thread Wallpapers"
        description="Wallpapers assigned specifically to individual chat threads."
      >
        <div className="p-5 sm:p-6 w-full flex flex-col gap-3">
          {threadEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No thread overrides. To set one, open the wallpaper menu in that chat.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {threadEntries.map(([threadId, url]) => {
                const matched = allWallpapers.find((w) => w.url === url);
                return (
                  <div
                    key={threadId}
                    className="flex items-center justify-between gap-3 border border-border/70 bg-card/40 p-3 hover:border-border transition-colors"
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
                      <span>Use workspace wallpaper</span>
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
