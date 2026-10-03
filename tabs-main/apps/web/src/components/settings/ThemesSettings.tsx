import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  PaletteIcon,
  PencilIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_INTERFACE_FONT_SIZE,
  DEFAULT_PROMPT_FONT_SIZE,
  DEFAULT_UNIFIED_SETTINGS,
  MAX_CODE_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  MAX_PROMPT_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_INTERFACE_FONT_SIZE,
  MIN_PROMPT_FONT_SIZE,
} from "@tabs/contracts/settings";
import { useConfirm } from "../../hooks/useConfirm";
import {
  useTheme,
  buildFontPreferencesFromThemeConfig,
  commitCustomTheme,
} from "../../hooks/useTheme";
import {
  useDebouncedSettingsUpdate,
  useSettings,
  useUpdateSettings,
} from "../../hooks/useSettings";
import { useServerConfig } from "../../state/settings";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { CustomThemeStudioModal } from "../CustomThemeStudioModal";
import { ThemeImportExportModal } from "../ThemeImportExportModal";
import {
  DEFAULT_FONT_PREFERENCES,
  EDITOR_FONT_OPTIONS,
  FONT_COMBOS,
  HEADING_FONT_OPTIONS,
  THEME_DEFINITIONS,
  UI_FONT_OPTIONS,
  calculateContrastRatio,
  hexToHsv,
  hexToRgb,
  hsvToHex,
  rgbToHex,
  type CustomThemeConfig,
  type FontPreferences,
  type ThemePreference,
} from "../../lib/themes";
import { SettingsSection, SettingsSectionHeader } from "./SettingsLayout";

export interface SavedCustomPreset {
  id: string;
  name: string;
  config: CustomThemeConfig;
  createdAt: number;
}

const SAVED_PRESETS_KEY = "tabs:saved-custom-presets";

function getStoredSavedPresets(): SavedCustomPreset[] {
  try {
    const raw = localStorage.getItem(SAVED_PRESETS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function saveSavedPresetsToStorage(presets: SavedCustomPreset[]) {
  try {
    localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(presets));
  } catch {}
}

const TOOLBAR_STYLES = [
  {
    id: "solid",
    label: "Elevated Solid",
    description: "Pure high-contrast accent block with a soft elastic slide.",
  },
  {
    id: "ghost-mesh",
    label: "Ambient Mesh",
    description: "Soft radial gradient mesh fading elegantly from the bottom edge.",
  },
  {
    id: "spotlight",
    label: "Edge Illumination",
    description: "Directional light emitting smoothly from the top boundary.",
  },
  {
    id: "dot",
    label: "Minimal Indicator",
    description: "Ultra-minimal glowing indicator tracking below the active tab.",
  },
  {
    id: "refraction",
    label: "Frosted Lens",
    description: "Physical glass lens distorting a micro-dot matrix track.",
  },
  {
    id: "titanium",
    label: "Brushed Aluminum",
    description: "Machined brushed metal aesthetic with an animated sweeping glare.",
  },
] as const;

function ToolbarPreview({ styleId }: { styleId: string }) {
  const [activeTab, setActiveTab] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!trackRef.current || !pillRef.current) return;
    const timeoutId = setTimeout(() => {
      const tabs = trackRef.current?.querySelectorAll<HTMLButtonElement>(".nav-tab");
      if (!tabs) return;
      const targetTab = tabs[activeTab];
      if (!targetTab) return;

      const targetLeft = targetTab.offsetLeft;
      const targetWidth = targetTab.offsetWidth;

      if (pillRef.current) {
        pillRef.current.style.transform = `translateX(${targetLeft}px)`;
        pillRef.current.style.width = `${targetWidth}px`;
      }
    }, 10);
    return () => clearTimeout(timeoutId);
  }, [activeTab]);

  return (
    <div
      className="flex items-center justify-center p-4 bg-background/50 rounded-xl border border-border/40 my-2"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <div ref={trackRef} className={cn("nav-track", `design-${styleId}`)}>
        <div ref={pillRef} className="active-pill" />
        {["Code", "Agents", "Browser"].map((label, i) => (
          <button
            key={label}
            type="button"
            className={cn("nav-tab", activeTab === i && "active")}
            onClick={() => setActiveTab(i)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

const CURATED_STUDIO_SWATCHES = [
  "#6366F1",
  "#06B6D4",
  "#10B981",
  "#F43F5E",
  "#F59E0B",
  "#A855F7",
  "#EC4899",
  "#3B82F6",
  "#1E293B",
  "#F8FAFC",
];

function StudioColorPickerPopover({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (val: string) => void;
  onClose: () => void;
}) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [format, setFormat] = useState<"hex" | "rgb">("hex");
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const satValRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHsv(hexToHsv(value));
  }, [value]);

  const updateColorFromHsv = (h: number, s: number, v: number) => {
    const newHex = hsvToHex(h, s, v);
    setHsv({ h, s, v });
    onChange(newHex);
  };

  const currentRgb = useMemo(() => hexToRgb(value) ?? { r: 0, g: 0, b: 0 }, [value]);
  const contrastInfo = useMemo(() => calculateContrastRatio(value, "#000000"), [value]);

  const handleCopy = () => {
    navigator.clipboard.writeText(value.toUpperCase());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      ref={containerRef}
      className="absolute top-full mt-2 right-0 z-50 w-64 rounded-2xl border border-border/80 bg-card p-3 shadow-2xl backdrop-blur-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={satValRef}
        className="relative h-32 w-full rounded-xl cursor-crosshair overflow-hidden border border-black/10"
        style={{
          backgroundColor: `hsl(${hsv.h}, 100%, 50%)`,
          backgroundImage:
            "linear-gradient(to right, #fff, transparent), linear-gradient(to top, #000, transparent)",
        }}
        onMouseDown={(e) => {
          const rect = satValRef.current?.getBoundingClientRect();
          if (!rect) return;
          const handleMove = (moveEvent: MouseEvent) => {
            const x = Math.max(0, Math.min(rect.width, moveEvent.clientX - rect.left));
            const y = Math.max(0, Math.min(rect.height, moveEvent.clientY - rect.top));
            const s = Math.round((x / rect.width) * 100);
            const v = Math.round((1 - y / rect.height) * 100);
            updateColorFromHsv(hsv.h, s, v);
          };
          handleMove(e.nativeEvent);
          const handleUp = () => {
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", handleUp);
          };
          window.addEventListener("mousemove", handleMove);
          window.addEventListener("mouseup", handleUp);
        }}
      >
        <div
          className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md pointer-events-none"
          style={{
            left: `${hsv.s}%`,
            top: `${100 - hsv.v}%`,
            backgroundColor: value,
          }}
        />
      </div>

      <div className="mt-3 relative h-3 w-full rounded-full overflow-hidden">
        <input
          type="range"
          min="0"
          max="360"
          value={hsv.h}
          onChange={(e) => updateColorFromHsv(Number(e.target.value), hsv.s, hsv.v)}
          className="absolute inset-0 w-full opacity-0 cursor-pointer z-10"
        />
        <div
          className="h-full w-full rounded-full border border-black/10"
          style={{
            background:
              "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
          }}
        />
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFormat(format === "hex" ? "rgb" : "hex")}
              className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-1 py-0.5 rounded bg-muted/60"
            >
              {format}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border",
                !contrastInfo.isLowContrast
                  ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                  : "bg-amber-500/10 text-amber-500 border-amber-500/30",
              )}
            >
              {contrastInfo.ratio}:1
            </span>
            <button
              type="button"
              onClick={handleCopy}
              title="Copy hex code"
              className="p-1 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            >
              {copied ? (
                <CheckIcon className="size-3.5 text-foreground" />
              ) : (
                <CopyIcon className="size-3.5" />
              )}
            </button>
          </div>
        </div>

        {format === "hex" ? (
          <div className="relative">
            <input
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="w-full rounded-xl border border-border/80 bg-background px-3 py-1.5 text-xs font-mono font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 uppercase"
            />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            <div>
              <span className="text-[9px] font-bold text-muted-foreground uppercase block text-center">
                R
              </span>
              <input
                type="number"
                min={0}
                max={255}
                value={currentRgb.r}
                onChange={(e) =>
                  onChange(rgbToHex(Number(e.target.value), currentRgb.g, currentRgb.b))
                }
                className="w-full rounded-lg border border-border/80 bg-background py-1 text-center text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
            <div>
              <span className="text-[9px] font-bold text-muted-foreground uppercase block text-center">
                G
              </span>
              <input
                type="number"
                min={0}
                max={255}
                value={currentRgb.g}
                onChange={(e) =>
                  onChange(rgbToHex(currentRgb.r, Number(e.target.value), currentRgb.b))
                }
                className="w-full rounded-lg border border-border/80 bg-background py-1 text-center text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
            <div>
              <span className="text-[9px] font-bold text-muted-foreground uppercase block text-center">
                B
              </span>
              <input
                type="number"
                min={0}
                max={255}
                value={currentRgb.b}
                onChange={(e) =>
                  onChange(rgbToHex(currentRgb.r, currentRgb.g, Number(e.target.value)))
                }
                className="w-full rounded-lg border border-border/80 bg-background py-1 text-center text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2.5">
        {CURATED_STUDIO_SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            onClick={() => onChange(swatch)}
            className={cn(
              "size-4.5 rounded-full border border-black/20 shadow-xs transition-transform hover:scale-125 cursor-pointer",
              value.toLowerCase() === swatch.toLowerCase() &&
                "ring-2 ring-primary ring-offset-1 ring-offset-card",
            )}
            style={{ backgroundColor: swatch }}
          />
        ))}
      </div>
    </div>
  );
}

function ThemePickerGrid({
  activeTheme,
  customConfig,
  savedPresets,
  onSelectTheme,
  onOpenStudio,
  onOpenImport,
  onDeletePreset,
  onRenamePreset,
  onEditPresetInStudio,
  environmentThemes,
}: {
  activeTheme: ThemePreference;
  customConfig: CustomThemeConfig;
  savedPresets: SavedCustomPreset[];
  onSelectTheme: (theme: ThemePreference, customOverride?: CustomThemeConfig) => void;
  onOpenStudio: () => void;
  onOpenImport?: () => void;
  onDeletePreset: (presetId: string) => void;
  onRenamePreset: (presetId: string, newName: string) => void;
  onEditPresetInStudio?: (preset: SavedCustomPreset) => void;
  environmentThemes: NonNullable<ReturnType<typeof useServerConfig>>["environmentThemes"];
}) {
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingNameInput, setEditingNameInput] = useState("");

  const curatedThemes = [
    {
      id: "system" as const,
      name: "System Auto",
      description: "Match OS color scheme",
      baseVariant: "auto",
      badge: "AUTO",
      bg: "linear-gradient(135deg, #141414 50%, #f6f5f2 50%)",
      card: "#181818",
      accent: "#366ffb",
      border: "rgba(255,255,255,0.15)",
      codeKeyword: "#38bdf8",
      codeString: "#a7f3d0",
    },
    ...Object.values(THEME_DEFINITIONS)
      .filter((t) => t.id !== "custom")
      .map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        baseVariant: t.baseVariant,
        badge: t.id === "true-black" ? "OLED" : t.baseVariant.toUpperCase(),
        bg: t.colors.background,
        card: t.colors.card,
        accent: t.colors.codeOss.accent || t.colors.primary,
        border: t.colors.border,
        codeKeyword: t.colors.primary,
        codeString: t.colors.accentForeground || t.colors.foreground,
      })),
    ...(environmentThemes ?? []).map((published) => {
      const fallback =
        published.appearance === "light"
          ? THEME_DEFINITIONS["tabs-light"]
          : THEME_DEFINITIONS["tabs-dark"];
      const colors = published.colors ?? {};
      return {
        id: `environment:${published.id}` as ThemePreference,
        name: published.name,
        description: "Published by the connected environment",
        baseVariant: published.appearance,
        badge: "REMOTE",
        bg: colors.background ?? published.canvas ?? fallback.colors.background,
        card: colors.card ?? colors.cardBackground ?? fallback.colors.card,
        accent: colors.primary ?? published.accent ?? fallback.colors.primary,
        border: colors.border ?? fallback.colors.border,
        codeKeyword: colors.primary ?? published.accent ?? fallback.colors.primary,
        codeString: colors.foreground ?? fallback.colors.foreground,
      };
    }),
  ];

  return (
    <div className="p-5 sm:p-6 w-full">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4.5 w-full">
        {curatedThemes.map((t) => {
          const isSelected = activeTheme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              data-theme-id={t.id}
              aria-label={`Theme: ${t.name}`}
              onClick={() => onSelectTheme(t.id)}
              className={cn(
                "group relative flex flex-col justify-between overflow-hidden rounded-2xl border p-3.5 text-left transition-all duration-300 cursor-pointer select-none",
                isSelected
                  ? "border-foreground/50 bg-card/90 shadow-md"
                  : "border-border/60 bg-card/40 backdrop-blur-md hover:border-border hover:bg-card/70 hover:shadow-lg hover:-translate-y-0.5",
              )}
            >
              <div
                className="relative h-24 w-full overflow-hidden rounded-xl border border-black/10 dark:border-white/10 shadow-xs transition-transform duration-300 group-hover:scale-[1.02]"
                style={{ background: t.bg }}
              >
                <div
                  className="flex items-center justify-between px-2.5 py-1.5 border-b border-black/10 dark:border-white/10"
                  style={{ backgroundColor: t.card }}
                >
                  <div className="flex items-center gap-1.5">
                    <div className="size-2 rounded-full" style={{ backgroundColor: t.accent }} />
                    <div
                      className="size-1.5 rounded-full opacity-40"
                      style={{ backgroundColor: t.accent }}
                    />
                    <div
                      className="size-1.5 rounded-full opacity-20"
                      style={{ backgroundColor: t.accent }}
                    />
                  </div>
                  <div className="h-1.5 w-10 rounded-full opacity-50 bg-foreground" />
                </div>

                <div className="flex h-full">
                  <div
                    className="w-7 border-r border-black/10 dark:border-white/10 p-1 flex flex-col gap-1"
                    style={{ backgroundColor: t.card }}
                  >
                    <div className="h-1 w-full rounded-sm opacity-40 bg-foreground" />
                    <div className="h-1 w-3/4 rounded-sm opacity-20 bg-foreground" />
                    <div className="h-1 w-1/2 rounded-sm opacity-20 bg-foreground" />
                  </div>

                  <div className="flex-1 p-2 flex flex-col gap-1.5">
                    <div className="flex items-center gap-1">
                      <div
                        className="h-1 w-6 rounded-full opacity-80"
                        style={{ backgroundColor: t.codeKeyword }}
                      />
                      <div className="h-1 w-10 rounded-full opacity-50 bg-foreground" />
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="h-1 w-4 rounded-full opacity-30 bg-foreground" />
                      <div
                        className="h-1 w-12 rounded-full opacity-70"
                        style={{ backgroundColor: t.codeString }}
                      />
                    </div>
                    <div
                      className="h-1 w-8 rounded-full opacity-90"
                      style={{ backgroundColor: t.accent }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-3.5 flex items-end justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-bold tracking-tight text-foreground block truncate">
                    {t.name}
                  </span>
                  <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5 font-normal">
                    {t.description}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider",
                    isSelected
                      ? "bg-foreground/10 text-foreground border border-foreground/20"
                      : "bg-muted text-muted-foreground border border-border/40",
                  )}
                >
                  {t.badge}
                </span>
              </div>
            </button>
          );
        })}

        {/* User Saved Presets */}
        {savedPresets.map((preset) => {
          const isSelected =
            activeTheme === "custom" &&
            JSON.stringify(customConfig.colors) === JSON.stringify(preset.config.colors);
          const isEditing = editingPresetId === preset.id;

          return (
            <div
              key={preset.id}
              className={cn(
                "group relative flex flex-col justify-between overflow-hidden rounded-2xl border p-3.5 text-left transition-all duration-300 select-none",
                isSelected
                  ? "border-foreground/50 bg-card/90 shadow-md"
                  : "border-border/60 bg-card/40 backdrop-blur-md hover:border-border hover:bg-card/70 hover:shadow-lg hover:-translate-y-0.5",
              )}
            >
              {!isEditing && (
                <div className="absolute top-2.5 right-2.5 z-20 opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center gap-0.5 rounded-xl border border-border/80 bg-background/95 p-1 shadow-lg backdrop-blur-md">
                  <button
                    type="button"
                    title="Edit Theme in Studio"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditPresetInStudio?.(preset);
                    }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                  >
                    <SlidersHorizontalIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Rename Preset"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingPresetId(preset.id);
                      setEditingNameInput(preset.name);
                    }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                  >
                    <PencilIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Delete Saved Preset"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeletePreset(preset.id);
                    }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors cursor-pointer"
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => !isEditing && onSelectTheme("custom", preset.config)}
                className="w-full text-left flex flex-col justify-between h-full cursor-pointer"
              >
                <div
                  className="relative h-24 w-full overflow-hidden rounded-xl border border-black/10 dark:border-white/10 shadow-xs transition-transform duration-300 group-hover:scale-[1.02]"
                  style={{ background: preset.config.colors.background }}
                >
                  <div
                    className="flex items-center justify-between px-2.5 py-1.5 border-b border-black/10 dark:border-white/10"
                    style={{ backgroundColor: preset.config.colors.card }}
                  >
                    <div className="flex items-center gap-1.5">
                      <div
                        className="size-2 rounded-full"
                        style={{
                          backgroundColor: preset.config.colors.primary,
                        }}
                      />
                    </div>
                    <div className="h-1.5 w-10 rounded-full opacity-50 bg-foreground" />
                  </div>

                  <div className="flex h-full p-2 flex-col gap-1.5">
                    <div
                      className="h-1.5 w-12 rounded-full"
                      style={{ backgroundColor: preset.config.colors.primary }}
                    />
                    <div
                      className="h-1.5 w-20 rounded-full opacity-70"
                      style={{
                        backgroundColor: preset.config.colors.foreground,
                      }}
                    />
                  </div>
                </div>

                {isEditing ? (
                  <div
                    className="mt-3 flex items-center gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Input
                      autoFocus
                      value={editingNameInput}
                      onChange={(e) => setEditingNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onRenamePreset(preset.id, editingNameInput);
                          setEditingPresetId(null);
                        } else if (e.key === "Escape") {
                          setEditingPresetId(null);
                        }
                      }}
                      className="h-7 text-xs rounded-lg bg-background border-border/80 text-foreground px-2"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        onRenamePreset(preset.id, editingNameInput);
                        setEditingPresetId(null);
                      }}
                      className="p-1 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer shrink-0"
                    >
                      <CheckIcon className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="mt-3.5 flex items-end justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-bold tracking-tight text-foreground block truncate">
                        {preset.name}
                      </span>
                      <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5 font-normal">
                        User Saved Preset
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider bg-muted text-muted-foreground border border-border/80">
                      SAVED
                    </span>
                  </div>
                )}
              </button>
            </div>
          );
        })}

        {/* Studio Launcher Card */}
        <button
          type="button"
          onClick={onOpenStudio}
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-dashed border-border/70 bg-card/20 p-3.5 text-left transition-all duration-300 hover:border-foreground/40 hover:bg-card/40 cursor-pointer select-none"
        >
          <div className="relative flex h-24 w-full flex-col items-center justify-center rounded-xl border border-border/40 bg-muted/20 gap-2 group-hover:bg-muted/40 transition-colors">
            <PaletteIcon className="size-5 text-foreground transition-transform group-hover:scale-110" />
            <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground">
              Launch Studio Drawer
            </span>
          </div>

          <div className="mt-3.5 flex items-end justify-between gap-2">
            <div className="min-w-0 flex-1">
              <span className="text-xs font-bold tracking-tight text-foreground block truncate">
                Custom Theme Studio
              </span>
              <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5 font-normal">
                Build &amp; randomize custom palettes
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider text-muted-foreground border border-border/40">
              STUDIO
            </span>
          </div>
        </button>

        {/* Import Theme Card */}
        {onOpenImport && (
          <button
            type="button"
            onClick={onOpenImport}
            className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-dashed border-border/70 bg-card/20 p-3.5 text-left transition-all duration-300 hover:border-foreground/40 hover:bg-card/40 cursor-pointer select-none"
          >
            <div className="relative flex h-24 w-full flex-col items-center justify-center rounded-xl border border-border/40 bg-muted/20 gap-2 group-hover:bg-muted/40 transition-colors">
              <DownloadIcon className="size-5 text-foreground transition-transform group-hover:scale-110" />
              <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground">
                Import Theme JSON
              </span>
            </div>

            <div className="mt-3.5 flex items-end justify-between gap-2">
              <div className="min-w-0 flex-1">
                <span className="text-xs font-bold tracking-tight text-foreground block truncate">
                  Import Theme
                </span>
                <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5 font-normal">
                  Drop VS Code or Tabs theme JSON
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider text-muted-foreground border border-border/40">
                IMPORT
              </span>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}

export function ThemesSettings() {
  const { confirm } = useConfirm();
  const {
    theme,
    setTheme,
    customThemeConfig,
    setCustomThemeConfig,
    fontPreferences,
    setFontPreferences,
  } = useTheme();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const debouncedSettings = useDebouncedSettingsUpdate(350);
  const serverConfig = useServerConfig();

  const [isStudioOpen, setIsStudioOpen] = useState(false);
  const [studioInitialConfig, setStudioInitialConfig] = useState<CustomThemeConfig | null>(null);
  const [isImportExportOpen, setIsImportExportOpen] = useState(false);
  const [importExportTab, setImportExportTab] = useState<"import" | "export">("import");
  const [isCustomFontMode, setIsCustomFontMode] = useState(false);
  const [editingStudioPresetName, setEditingStudioPresetName] = useState("");
  const [savedPresets, setSavedPresets] = useState<SavedCustomPreset[]>(() =>
    getStoredSavedPresets(),
  );

  const handleImportTheme = useCallback(
    (name: string, config: CustomThemeConfig) => {
      const newPreset: SavedCustomPreset = {
        id: `custom-saved-${Date.now()}`,
        name,
        config,
        createdAt: Date.now(),
      };
      setSavedPresets((prev) => {
        const next = [newPreset, ...prev];
        saveSavedPresetsToStorage(next);
        return next;
      });
      setCustomThemeConfig(config);
      setTheme("custom");
      // Sync imported fonts into the FontPreferences store so the DOM updates
      const nextFontPrefs = buildFontPreferencesFromThemeConfig(config);
      setFontPreferences(nextFontPrefs);
      setIsImportExportOpen(false);
      toastManager.add({
        type: "success",
        title: "Theme Imported",
        description: `Imported "${name}" successfully.`,
      });
    },
    [setCustomThemeConfig, setTheme, setFontPreferences],
  );

  const handleSavePreset = useCallback((name: string, config: CustomThemeConfig) => {
    const newPreset: SavedCustomPreset = {
      id: `custom-saved-${Date.now()}`,
      name,
      config,
      createdAt: Date.now(),
    };
    setSavedPresets((prev) => {
      const next = [newPreset, ...prev];
      saveSavedPresetsToStorage(next);
      return next;
    });
    toastManager.add({
      type: "success",
      title: "Preset Saved",
      description: `Preset "${name}" saved cleanly.`,
    });
  }, []);

  const handleApplyStudio = useCallback(
    (draftConfig: CustomThemeConfig, draftFonts?: FontPreferences) => {
      commitCustomTheme(draftConfig, draftFonts);
      setIsStudioOpen(false);
      setStudioInitialConfig(null);
      toastManager.add({
        type: "success",
        title: "Theme Applied",
        description: "Custom theme applied and saved.",
      });
    },
    [],
  );

  const handleDeletePreset = useCallback(
    async (presetId: string) => {
      const confirmed = await confirm("Are you sure you want to delete this custom preset?");
      if (!confirmed) return;

      setSavedPresets((prev) => {
        const next = prev.filter((p) => p.id !== presetId);
        saveSavedPresetsToStorage(next);
        return next;
      });
      toastManager.add({
        type: "info",
        title: "Preset Deleted",
        description: "Custom theme preset removed.",
      });
    },
    [confirm],
  );

  const handleRenamePreset = useCallback((presetId: string, newName: string) => {
    if (!newName.trim()) return;
    setSavedPresets((prev) => {
      const next = prev.map((p) => (p.id === presetId ? { ...p, name: newName.trim() } : p));
      saveSavedPresetsToStorage(next);
      return next;
    });
    toastManager.add({
      type: "success",
      title: "Preset Renamed",
      description: `Renamed to "${newName.trim()}".`,
    });
  }, []);

  const isCustomSelection = !FONT_COMBOS.some(
    (combo) =>
      combo.id !== "custom" &&
      fontPreferences.uiFont === combo.uiFont &&
      fontPreferences.headingFont === combo.headingFont,
  );
  const showCustomMixer = isCustomFontMode || isCustomSelection;

  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        title="Themes"
        description="Choose from curated palettes or build a fully personalized custom color and typography theme."
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFontPreferences(DEFAULT_FONT_PREFERENCES);
                toastManager.add({
                  type: "info",
                  title: "Fonts Reset",
                  description: "Typography preferences restored to defaults.",
                });
              }}
              className="gap-2 rounded-xl text-xs px-3.5 py-2 font-medium shadow-xs text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <RotateCcwIcon className="size-3.5" />
              Reset to Defaults
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setImportExportTab("import");
                setIsImportExportOpen(true);
              }}
              className="gap-2 rounded-xl text-xs px-3.5 py-2 font-medium shadow-xs cursor-pointer"
            >
              <DownloadIcon className="size-4 text-foreground" />
              Import Theme
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setImportExportTab("export");
                setIsImportExportOpen(true);
              }}
              className="gap-2 rounded-xl text-xs px-3.5 py-2 font-medium shadow-xs cursor-pointer"
            >
              <UploadIcon className="size-4 text-foreground" />
              Export Theme
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsStudioOpen(true)}
              className="gap-2 rounded-xl text-xs px-3.5 py-2 font-medium shadow-xs cursor-pointer"
            >
              <PaletteIcon className="size-4 text-foreground" />
              Open Custom Studio
            </Button>
          </div>
        }
      />

      <SettingsSection title="App Themes & Styling">
        <ThemePickerGrid
          activeTheme={theme}
          customConfig={customThemeConfig}
          savedPresets={savedPresets}
          environmentThemes={serverConfig?.environmentThemes}
          onSelectTheme={(t, overrideConfig) => {
            if (overrideConfig) {
              setCustomThemeConfig(overrideConfig);
              setTheme("custom");
            } else {
              setTheme(t);
            }
          }}
          onOpenStudio={() => {
            setEditingStudioPresetName("");
            setStudioInitialConfig(null);
            setIsStudioOpen(true);
          }}
          onOpenImport={() => {
            setImportExportTab("import");
            setIsImportExportOpen(true);
          }}
          onDeletePreset={handleDeletePreset}
          onRenamePreset={handleRenamePreset}
          onEditPresetInStudio={(preset) => {
            setEditingStudioPresetName(preset.name);
            setStudioInitialConfig(preset.config);
            setIsStudioOpen(true);
          }}
        />
      </SettingsSection>

      <SettingsSection
        title="Typography & Fonts"
        headerAction={
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setFontPreferences(DEFAULT_FONT_PREFERENCES);
              updateSettings({
                fontFamilySans: DEFAULT_UNIFIED_SETTINGS.fontFamilySans,
                fontFamilyCode: DEFAULT_UNIFIED_SETTINGS.fontFamilyCode,
                fontFamilyComposer: DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer,
                fontSizeInterface: DEFAULT_INTERFACE_FONT_SIZE,
                fontSizeCode: DEFAULT_CODE_FONT_SIZE,
                fontSizePrompt: DEFAULT_PROMPT_FONT_SIZE,
              });
              toastManager.add({
                type: "info",
                title: "Fonts Reset",
                description: "Typography preferences restored to defaults.",
              });
            }}
            className="gap-1.5 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-foreground cursor-pointer h-6 px-2.5"
          >
            <RotateCcwIcon className="size-3" />
            Reset to Defaults
          </Button>
        }
      >
        <div className="px-4 pt-4 pb-2 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mr-1">
            Defaults
          </span>
          {FONT_COMBOS.filter((c) => c.isNeutral).map((combo) => {
            const isCustomCombo = combo.id === "custom";
            const isActive = isCustomCombo
              ? showCustomMixer
              : !showCustomMixer &&
                fontPreferences.uiFont === combo.uiFont &&
                fontPreferences.headingFont === combo.headingFont;

            return (
              <button
                key={combo.id}
                type="button"
                onClick={() => {
                  if (isCustomCombo) {
                    setIsCustomFontMode(true);
                  } else {
                    setIsCustomFontMode(false);
                    setFontPreferences((prev) => ({
                      ...prev,
                      uiFont: combo.uiFont,
                      headingFont: combo.headingFont,
                    }));
                    updateSettings({ fontFamilySans: combo.uiFont });
                  }
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-all duration-200 cursor-pointer",
                  isActive
                    ? "border-primary bg-primary/10 text-foreground shadow-[0_0_10px_hsl(var(--primary)/0.2)]"
                    : "border-border/70 bg-card text-muted-foreground hover:border-border hover:text-foreground",
                )}
                style={{
                  fontFamily: combo.uiFont !== "custom" ? combo.uiFont : undefined,
                }}
              >
                {isActive && (
                  <svg
                    className="size-2.5 shrink-0"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                )}
                {combo.name}
                <span
                  className={cn(
                    "text-[8px] font-bold tracking-widest px-1 py-0.5 rounded border",
                    isActive
                      ? "border-primary/30 text-foreground/70 bg-primary/5"
                      : "border-border/50 text-muted-foreground/50",
                  )}
                >
                  {combo.tag}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mx-4 border-t border-border/40 mb-0" />

        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {FONT_COMBOS.filter((c) => !c.isNeutral).map((combo) => {
            const isActive =
              !showCustomMixer &&
              fontPreferences.uiFont === combo.uiFont &&
              fontPreferences.headingFont === combo.headingFont;

            return (
              <button
                key={combo.id}
                type="button"
                onClick={() => {
                  setIsCustomFontMode(false);
                  setFontPreferences((prev) => ({
                    ...prev,
                    uiFont: combo.uiFont,
                    headingFont: combo.headingFont,
                  }));
                  updateSettings({ fontFamilySans: combo.uiFont });
                }}
                className={cn(
                  "group relative flex flex-col items-start rounded-xl border p-3.5 text-left transition-all duration-200 cursor-pointer overflow-hidden",
                  isActive
                    ? "border-primary bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.3),0_4px_20px_hsl(var(--primary)/0.15)]"
                    : "border-border/70 bg-card hover:border-border hover:shadow-md hover:scale-[1.02]",
                )}
              >
                {isActive && (
                  <div className="absolute top-2.5 right-2.5 size-4 rounded-full bg-primary flex items-center justify-center shadow-[0_0_8px_hsl(var(--primary)/0.6)]">
                    <svg
                      className="size-2.5 text-primary-foreground"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2 6l3 3 5-5" />
                    </svg>
                  </div>
                )}

                <div className="mb-3 leading-none">
                  <span
                    className={cn("text-[28px] leading-none", combo.sansClass)}
                    style={{
                      fontFamily: combo.uiFont,
                      color: "inherit",
                    }}
                  >
                    {combo.sansText}
                  </span>
                  <span
                    className={cn("text-[28px] leading-none", combo.serifClass)}
                    style={{
                      fontFamily: combo.headingFont,
                      color: "inherit",
                    }}
                  >
                    {combo.serifText}
                  </span>
                  {combo.sansText2 && (
                    <span
                      className={cn("text-[28px] leading-none", combo.sansClass)}
                      style={{
                        fontFamily: combo.uiFont,
                        color: "inherit",
                      }}
                    >
                      {combo.sansText2}
                    </span>
                  )}
                </div>

                <div className="mt-auto w-full">
                  <div
                    className={cn(
                      "text-[11px] font-semibold leading-tight truncate",
                      isActive ? "text-foreground" : "text-foreground",
                    )}
                    style={{ fontFamily: combo.uiFont }}
                  >
                    {combo.name}
                  </div>
                  <div className="flex items-center justify-between mt-1 gap-1">
                    <span className="text-[9.5px] text-muted-foreground/60 leading-none truncate">
                      {combo.desc}
                    </span>
                    <span
                      className={cn(
                        "text-[7.5px] font-bold tracking-widest px-1.5 py-0.5 rounded border shrink-0",
                        isActive
                          ? "border-primary/40 text-foreground bg-primary/10"
                          : "border-border/50 text-muted-foreground/50",
                      )}
                    >
                      {combo.tag}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {showCustomMixer && (
          <div className="mx-4 my-2 p-4 rounded-xl border border-primary/40 bg-primary/5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Custom Typography Mixer
              </h4>
              <span className="text-[10px] text-muted-foreground font-medium">
                Mix &amp; match any UI, heading, or editor font
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              <div className="space-y-1.5 rounded-lg border border-border/60 bg-card/60 p-3">
                <label className="text-xs font-semibold text-foreground block">
                  Interface Font
                </label>
                <p className="text-[10px] text-muted-foreground line-clamp-1">
                  UI labels, buttons, navigation
                </p>
                <Select
                  value={fontPreferences.uiFont}
                  onValueChange={(val) => {
                    if (!val) return;
                    setFontPreferences((prev) => ({ ...prev, uiFont: val }));
                    updateSettings({ fontFamilySans: val });
                  }}
                >
                  <SelectTrigger className="w-full text-xs rounded-lg bg-background border-border/80">
                    <SelectValue placeholder="Select Interface Font" />
                  </SelectTrigger>
                  <SelectPopup align="start">
                    {UI_FONT_OPTIONS.map((f) => (
                      <SelectItem key={f.value} value={f.value} className="text-xs">
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>

              <div className="space-y-1.5 rounded-lg border border-border/60 bg-card/60 p-3">
                <label className="text-xs font-semibold text-foreground block">Heading Font</label>
                <p className="text-[10px] text-muted-foreground line-clamp-1">
                  Headings, section titles, headers
                </p>
                <Select
                  value={fontPreferences.headingFont}
                  onValueChange={(val) =>
                    val &&
                    setFontPreferences((prev) => ({
                      ...prev,
                      headingFont: val,
                    }))
                  }
                >
                  <SelectTrigger className="w-full text-xs rounded-lg bg-background border-border/80">
                    <SelectValue placeholder="Select Heading Font" />
                  </SelectTrigger>
                  <SelectPopup align="start">
                    {HEADING_FONT_OPTIONS.map((f) => (
                      <SelectItem key={f.value} value={f.value} className="text-xs">
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>

              <div className="space-y-1.5 rounded-lg border border-border/60 bg-card/60 p-3">
                <label className="text-xs font-semibold text-foreground block">Editor Font</label>
                <p className="text-[10px] text-muted-foreground line-clamp-1">
                  Monospace code, terminals, inputs
                </p>
                <Select
                  value={fontPreferences.editorFont}
                  onValueChange={(val) => {
                    if (!val) return;
                    setFontPreferences((prev) => ({ ...prev, editorFont: val }));
                    updateSettings({ fontFamilyCode: val });
                  }}
                >
                  <SelectTrigger className="w-full text-xs rounded-lg bg-background border-border/80">
                    <SelectValue placeholder="Select Editor Font" />
                  </SelectTrigger>
                  <SelectPopup align="start">
                    {EDITOR_FONT_OPTIONS.map((f) => (
                      <SelectItem key={f.value} value={f.value} className="text-xs">
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>
          </div>
        )}

        {!showCustomMixer && (
          <div className="border-t border-border/60 px-4 py-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-medium text-foreground">Editor Font</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Monospace font for code, terminals, and diff views.
                </p>
              </div>
              <div className="shrink-0 w-full sm:w-52">
                <Select
                  value={fontPreferences.editorFont}
                  onValueChange={(val) => {
                    if (!val) return;
                    setFontPreferences((prev) => ({ ...prev, editorFont: val }));
                    updateSettings({ fontFamilyCode: val });
                  }}
                >
                  <SelectTrigger className="w-full text-xs rounded-xl bg-background border-border/80">
                    <SelectValue placeholder="Select Editor Font" />
                  </SelectTrigger>
                  <SelectPopup align="end">
                    {EDITOR_FONT_OPTIONS.map((f) => (
                      <SelectItem key={f.value} value={f.value} className="text-xs">
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-border/60 px-4 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
              Font Sizes &amp; Proportions
            </h4>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setFontPreferences((prev) => ({
                  ...prev,
                  fontSizeInterface: DEFAULT_INTERFACE_FONT_SIZE,
                  fontSizeCode: DEFAULT_CODE_FONT_SIZE,
                  fontSizePrompt: DEFAULT_PROMPT_FONT_SIZE,
                }));
                updateSettings({
                  fontSizeInterface: DEFAULT_INTERFACE_FONT_SIZE,
                  fontSizeCode: DEFAULT_CODE_FONT_SIZE,
                  fontSizePrompt: DEFAULT_PROMPT_FONT_SIZE,
                });
              }}
              className="text-[11px] h-6 px-2 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <RotateCcwIcon className="size-3 mr-1" />
              Reset Sizes
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-foreground block">
                    Interface Size
                  </label>
                  <p className="text-[10px] text-muted-foreground">UI, tabs, sidebar, dialogs</p>
                </div>
                <span className="font-mono text-xs font-bold text-foreground bg-muted px-2 py-0.5 rounded-md border border-border/50">
                  {fontPreferences.fontSizeInterface ??
                    settings.fontSizeInterface ??
                    DEFAULT_INTERFACE_FONT_SIZE}{" "}
                  px
                </span>
              </div>
              <input
                type="range"
                min={MIN_INTERFACE_FONT_SIZE}
                max={MAX_INTERFACE_FONT_SIZE}
                step={1}
                value={
                  fontPreferences.fontSizeInterface ??
                  settings.fontSizeInterface ??
                  DEFAULT_INTERFACE_FONT_SIZE
                }
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setFontPreferences((prev) => ({
                    ...prev,
                    fontSizeInterface: val,
                  }));
                  debouncedSettings.updateSettings({ fontSizeInterface: val });
                }}
                onBlur={() => {
                  void debouncedSettings.flush();
                }}
                aria-label="Interface font size slider"
                className="w-full accent-primary h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer focus:outline-none"
              />
              <div className="flex justify-between text-[10px] font-mono text-muted-foreground/60">
                <span>{MIN_INTERFACE_FONT_SIZE}px</span>
                <span>Default ({DEFAULT_INTERFACE_FONT_SIZE}px)</span>
                <span>{MAX_INTERFACE_FONT_SIZE}px</span>
              </div>
            </div>

            <div className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-foreground block">
                    Code &amp; Diffs Size
                  </label>
                  <p className="text-[10px] text-muted-foreground">Editor, code blocks, diffs</p>
                </div>
                <span className="font-mono text-xs font-bold text-foreground bg-muted px-2 py-0.5 rounded-md border border-border/50">
                  {fontPreferences.fontSizeCode ?? settings.fontSizeCode ?? DEFAULT_CODE_FONT_SIZE}{" "}
                  px
                </span>
              </div>
              <input
                type="range"
                min={MIN_CODE_FONT_SIZE}
                max={MAX_CODE_FONT_SIZE}
                step={1}
                value={
                  fontPreferences.fontSizeCode ?? settings.fontSizeCode ?? DEFAULT_CODE_FONT_SIZE
                }
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setFontPreferences((prev) => ({
                    ...prev,
                    fontSizeCode: val,
                  }));
                  debouncedSettings.updateSettings({ fontSizeCode: val });
                }}
                onBlur={() => {
                  void debouncedSettings.flush();
                }}
                aria-label="Code font size slider"
                className="w-full accent-primary h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer focus:outline-none"
              />
              <div className="flex justify-between text-[10px] font-mono text-muted-foreground/60">
                <span>{MIN_CODE_FONT_SIZE}px</span>
                <span>Default ({DEFAULT_CODE_FONT_SIZE}px)</span>
                <span>{MAX_CODE_FONT_SIZE}px</span>
              </div>
            </div>

            <div className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-foreground block">
                    Prompt Composer Size
                  </label>
                  <p className="text-[10px] text-muted-foreground">Message input area</p>
                </div>
                <span className="font-mono text-xs font-bold text-foreground bg-muted px-2 py-0.5 rounded-md border border-border/50">
                  {fontPreferences.fontSizePrompt ??
                    settings.fontSizePrompt ??
                    DEFAULT_PROMPT_FONT_SIZE}{" "}
                  px
                </span>
              </div>
              <input
                type="range"
                min={MIN_PROMPT_FONT_SIZE}
                max={MAX_PROMPT_FONT_SIZE}
                step={1}
                value={
                  fontPreferences.fontSizePrompt ??
                  settings.fontSizePrompt ??
                  DEFAULT_PROMPT_FONT_SIZE
                }
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setFontPreferences((prev) => ({
                    ...prev,
                    fontSizePrompt: val,
                  }));
                  debouncedSettings.updateSettings({ fontSizePrompt: val });
                }}
                onBlur={() => {
                  void debouncedSettings.flush();
                }}
                aria-label="Prompt font size slider"
                className="w-full accent-primary h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer focus:outline-none"
              />
              <div className="flex justify-between text-[10px] font-mono text-muted-foreground/60">
                <span>{MIN_PROMPT_FONT_SIZE}px</span>
                <span>Default ({DEFAULT_PROMPT_FONT_SIZE}px)</span>
                <span>{MAX_PROMPT_FONT_SIZE}px</span>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-border/60 px-4 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-medium text-foreground">Prompt Composer Font</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Font family for the chat message composer (defaults to interface font).
              </p>
            </div>
            <div className="shrink-0 w-full sm:w-52">
              <Select
                value={settings.fontFamilyComposer || "inherit"}
                onValueChange={(val) =>
                  updateSettings({
                    fontFamilyComposer: val === "inherit" ? "" : val,
                  })
                }
              >
                <SelectTrigger className="w-full text-xs rounded-xl bg-background border-border/80">
                  <SelectValue placeholder="Inherit Interface Font" />
                </SelectTrigger>
                <SelectPopup align="end">
                  <SelectItem value="inherit" className="text-xs">
                    Inherit Interface Font
                  </SelectItem>
                  <SelectItem value="monospace" className="text-xs">
                    Monospace (Same as Editor)
                  </SelectItem>
                  {UI_FONT_OPTIONS.map((f) => (
                    <SelectItem key={f.value} value={f.value} className="text-xs">
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Toolbar Style">
        <div className="flex flex-col gap-8 p-4 sm:p-5">
          <div className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-border shadow-sm">
            <div className="absolute inset-0 bg-gradient-to-br from-background via-card to-background opacity-80" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent opacity-50" />
            <div className="relative flex flex-col items-center justify-center p-8 pt-14 pb-10 min-h-[260px] gap-6">
              <h3 className="absolute top-5 left-6 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">
                Preview Stage
              </h3>
              <div className="flex-1 flex items-center justify-center">
                <ToolbarPreview styleId={settings.toolbarStyle} />
              </div>

              {(() => {
                const activeStyle =
                  TOOLBAR_STYLES.find((s) => s.id === settings.toolbarStyle) ?? TOOLBAR_STYLES[0];
                return (
                  <div className="flex flex-col items-center text-center">
                    <div className="flex items-center gap-2 mb-1.5">
                      <h4 className="font-medium text-[15px] tracking-tight text-foreground">
                        {activeStyle?.label}
                      </h4>
                      <span className="bg-muted text-foreground border border-border px-2 py-0.5 rounded-full text-[9px] uppercase font-bold tracking-wider">
                        Active
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground max-w-[280px] leading-relaxed">
                      {activeStyle?.description}
                    </p>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {TOOLBAR_STYLES.map((style) => {
              const isSelected = settings.toolbarStyle === style.id;
              return (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => updateSettings({ toolbarStyle: style.id })}
                  className={cn(
                    "group relative flex flex-col items-start p-4 rounded-xl border transition-all duration-300 text-left overflow-hidden cursor-pointer",
                    isSelected
                      ? "bg-card border-foreground/30 shadow-xs"
                      : "bg-transparent border-border/40 hover:bg-card/50 hover:border-border/80",
                  )}
                >
                  <div className="relative flex items-center justify-between w-full mb-1.5">
                    <span className="font-semibold text-sm transition-colors text-foreground">
                      {style.label}
                    </span>
                    {isSelected && (
                      <div className="size-2 rounded-full bg-foreground/90 shadow-[0_0_6px_rgba(255,255,255,0.4)]" />
                    )}
                  </div>
                  <p className="relative text-[12px] text-muted-foreground line-clamp-2 leading-relaxed">
                    {style.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </SettingsSection>

      <CustomThemeStudioModal
        isOpen={isStudioOpen}
        onClose={() => {
          setIsStudioOpen(false);
          setStudioInitialConfig(null);
        }}
        config={studioInitialConfig ?? customThemeConfig}
        initialPresetName={editingStudioPresetName}
        onSavePreset={handleSavePreset}
        onApply={handleApplyStudio}
      />

      {(() => {
        // Derive the correct config and name for export based on the *active* theme
        // (not always the custom slot — e.g. when Dracula or Abyss is selected).
        let exportConfig: CustomThemeConfig = {
          ...customThemeConfig,
          fonts: {
            ...customThemeConfig.fonts,
            uiFont: fontPreferences.uiFont,
            editorFont: fontPreferences.editorFont,
            headingFont: fontPreferences.headingFont || fontPreferences.uiFont,
          },
        };
        let exportName = editingStudioPresetName || "Custom Theme";

        if (theme !== "custom" && theme !== "system" && !theme.startsWith("environment:")) {
          const def = THEME_DEFINITIONS[theme as import("../../lib/themes").ThemeId];
          if (def) {
            exportConfig = {
              baseVariant: def.baseVariant,
              colors: {
                background: def.colors.background,
                foreground: def.colors.foreground,
                card: def.colors.card,
                border: def.colors.border,
                primary: def.colors.primary,
              },
              fonts: {
                uiFont: fontPreferences.uiFont,
                editorFont: fontPreferences.editorFont,
                headingFont: fontPreferences.headingFont || fontPreferences.uiFont,
              },
            };
            exportName = def.name;
          }
        }

        return (
          <ThemeImportExportModal
            isOpen={isImportExportOpen}
            onClose={() => setIsImportExportOpen(false)}
            currentConfig={exportConfig}
            currentName={exportName}
            initialTab={importExportTab}
            onImportTheme={handleImportTheme}
          />
        );
      })()}
    </div>
  );
}

export default ThemesSettings;
