import { ToolbarStyleReel } from "./ToolbarStyleReel";
import { useInstalledExtensions } from "../../state/extensions";
import {
  extensionThemePresets,
  isActiveExtensionTheme,
  type ExtensionThemePreset,
} from "../../extensionThemes";
import { TypographyReel } from "./TypographyReel";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "../ui/dialog";
import { ThemePrinterPreview } from "./ThemePrinterPreview";
import "./theme-collection.css";
import { BrandIdentitySettings } from "./BrandIdentitySettings";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  Maximize2Icon,
  CopyIcon,
  DownloadIcon,
  PaletteIcon,
  PencilIcon,
  EllipsisIcon,
  ArrowUpRightIcon,
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
  resolveActiveThemeId,
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
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { CustomThemeStudioModal } from "../CustomThemeStudioModal";
import { ThemeImportExportModal } from "../ThemeImportExportModal";
import {
  DEFAULT_FONT_PREFERENCES,
  selectFontCombo,
  EDITOR_FONT_OPTIONS,
  UI_FONT_OPTIONS,
  THEME_DEFINITIONS,
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
import { SavedTypography } from "./SavedTypography";

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

const THEME_COLLECTION_ORDER = [
  "abyss",
  "dracula",
  "deep-blue",
  "solarized-light",
  "tabs-dark",
  "tabs-light",
  "true-black",
  "tabs-monotone",
  "tabs-monotone-light",
];

export function ThemePickerGrid({
  activeTheme,
  customConfig,
  savedPresets,
  onSelectTheme,
  onOpenStudio,
  onOpenImport,
  onOpenExport,
  onDeletePreset,
  onRenamePreset,
  onEditPresetInStudio,
  environmentThemes,
  extensionThemes = [],
}: {
  /** Palettes contributed by installed extensions. */
  extensionThemes?: readonly ExtensionThemePreset[];
  activeTheme: ThemePreference;
  customConfig: CustomThemeConfig;
  savedPresets: SavedCustomPreset[];
  onSelectTheme: (theme: ThemePreference, customOverride?: CustomThemeConfig) => void;
  onOpenStudio: (config: CustomThemeConfig) => void;
  onOpenImport?: (name: string, config: CustomThemeConfig) => void;
  onOpenExport?: (name: string, config: CustomThemeConfig) => void;
  onDeletePreset: (presetId: string) => void;
  onRenamePreset: (presetId: string, newName: string) => void;
  onEditPresetInStudio?: (preset: SavedCustomPreset) => void;
  environmentThemes: NonNullable<ReturnType<typeof useServerConfig>>["environmentThemes"];
}) {
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingNameInput, setEditingNameInput] = useState("");
  const [appearanceFilter, setAppearanceFilter] = useState("All");
  const [previewOpen, setPreviewOpen] = useState(false);
  const selectedDefinition =
    activeTheme === "custom"
      ? undefined
      : THEME_DEFINITIONS[resolveActiveThemeId(activeTheme) as keyof typeof THEME_DEFINITIONS];
  const publishedTheme = activeTheme.startsWith("environment:")
    ? environmentThemes?.find((theme) => `environment:${theme.id}` === activeTheme)
    : undefined;
  const fallbackDefinition =
    THEME_DEFINITIONS[publishedTheme?.appearance === "light" ? "tabs-light" : "tabs-dark"];
  const selectedConfig: CustomThemeConfig =
    activeTheme === "custom"
      ? customConfig
      : {
          baseVariant:
            selectedDefinition?.baseVariant ??
            publishedTheme?.appearance ??
            fallbackDefinition.baseVariant,
          colors: {
            background:
              selectedDefinition?.colors.background ??
              publishedTheme?.colors?.background ??
              publishedTheme?.canvas ??
              fallbackDefinition.colors.background,
            card:
              selectedDefinition?.colors.card ??
              publishedTheme?.colors?.card ??
              publishedTheme?.colors?.cardBackground ??
              fallbackDefinition.colors.card,
            foreground:
              selectedDefinition?.colors.foreground ??
              publishedTheme?.colors?.foreground ??
              fallbackDefinition.colors.foreground,
            border:
              selectedDefinition?.colors.border ??
              publishedTheme?.colors?.border ??
              fallbackDefinition.colors.border,
            primary:
              selectedDefinition?.colors.primary ??
              publishedTheme?.colors?.primary ??
              publishedTheme?.accent ??
              fallbackDefinition.colors.primary,
          },
          fonts: customConfig.fonts,
        };
  const activeSavedPalette =
    activeTheme === "custom"
      ? savedPresets.find(
          ({ config }) =>
            config.baseVariant === customConfig.baseVariant &&
            (["background", "card", "border", "foreground", "primary"] as const).every(
              (key) => config.colors[key] === customConfig.colors[key],
            ) &&
            JSON.stringify(config.tokenOverrides ?? {}) ===
              JSON.stringify(customConfig.tokenOverrides ?? {}),
        )
      : undefined;
  const activeExtensionTheme =
    activeTheme === "custom"
      ? extensionThemes.find((preset) => isActiveExtensionTheme(preset, customConfig))
      : undefined;
  const selectedName =
    activeTheme === "system"
      ? "System Auto"
      : (selectedDefinition?.name ??
        publishedTheme?.name ??
        activeSavedPalette?.name ??
        activeExtensionTheme?.name ??
        "Custom palette");

  const curatedThemes: Array<{
    id: ThemePreference;
    name: string;
    description: string;
    baseVariant: string;
    badge: string;
    bg: string;
    card: string;
    accent: string;
    border: string;
    codeKeyword: string;
    codeString: string;
    /** Set for extension palettes, which apply through the custom pipeline. */
    apply?: CustomThemeConfig;
    active?: boolean;
  }> = [
    {
      id: "system" as const,
      name: "System Auto",
      description: "Match OS color scheme",
      baseVariant: "auto",
      badge: "AUTO",
      bg: fallbackDefinition.colors.background,
      card: fallbackDefinition.colors.card,
      accent: fallbackDefinition.colors.primary,
      border: fallbackDefinition.colors.border,
      codeKeyword: fallbackDefinition.colors.primary,
      codeString: fallbackDefinition.colors.foreground,
    },
    ...Object.values(THEME_DEFINITIONS)
      .filter((t) => t.id !== "custom")
      .sort((a, b) => THEME_COLLECTION_ORDER.indexOf(a.id) - THEME_COLLECTION_ORDER.indexOf(b.id))
      .map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        baseVariant: t.baseVariant,
        badge: t.id === "true-black" ? "OLED" : t.baseVariant.toUpperCase(),
        bg: t.colors.background,
        card: t.colors.card,
        accent: t.colors.primary,
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
    ...extensionThemes.map((preset) => ({
      id: `extension:${preset.id}` as ThemePreference,
      name: preset.name,
      description: `From ${preset.extensionName}`,
      baseVariant: preset.config.baseVariant,
      badge: "EXT",
      bg: preset.config.colors.background,
      card: preset.config.colors.card,
      accent: preset.config.colors.primary,
      border: preset.config.colors.border,
      codeKeyword: preset.config.colors.primary,
      codeString: preset.config.colors.foreground,
      // Applied through the custom pipeline, keeping the user's fonts.
      apply: { ...preset.config, fonts: customConfig.fonts },
      active: activeExtensionTheme?.id === preset.id,
    })),
  ];

  return (
    <div className="theme-collection">
      <div className="theme-collection-layout">
        <div className="theme-collection-filter">
          <div role="group" aria-label="Filter themes by appearance">
            {["All", "Dark", "Light"].map((filter) => (
              <button
                type="button"
                key={filter}
                aria-pressed={appearanceFilter === filter}
                onClick={() => setAppearanceFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>
          <button
            data-shape="preview"
            type="button"
            className="theme-collection-preview-trigger"
            onClick={() => setPreviewOpen(true)}
          >
            <Maximize2Icon aria-hidden="true" />
            View live preview
          </button>
        </div>
        <div className="theme-collection-library">
          <div className="theme-collection-list" role="group" aria-label="Theme collection">
            {curatedThemes
              .filter(
                (t) =>
                  appearanceFilter === "All" ||
                  t.baseVariant === "auto" ||
                  t.baseVariant === appearanceFilter.toLowerCase(),
              )
              .map((t) => {
                return (
                  <button
                    key={t.id}
                    type="button"
                    data-theme-id={t.id}
                    data-theme-choice
                    aria-label={`Theme: ${t.name}`}
                    aria-pressed={t.apply ? Boolean(t.active) : activeTheme === t.id}
                    title={t.apply ? t.description : undefined}
                    onClick={() =>
                      t.apply ? onSelectTheme("custom", t.apply) : onSelectTheme(t.id)
                    }
                    className="theme-collection-choice"
                  >
                    <span
                      className="theme-collection-choice-rail"
                      style={{ background: `linear-gradient(${t.accent}, ${t.bg})` }}
                      aria-hidden="true"
                    />
                    <span className="theme-collection-choice-copy">
                      <span className="theme-collection-choice-name">{t.name}</span>
                      <small>
                        {t.baseVariant === "auto"
                          ? "Auto"
                          : t.baseVariant === "dark"
                            ? "Dark"
                            : "Light"}
                        {t.apply ? ` · ${t.description}` : ""}
                      </small>
                    </span>
                  </button>
                );
              })}
          </div>
          <div className="theme-collection-actions" role="group" aria-label="Palette actions">
            <button type="button" onClick={() => onOpenStudio(selectedConfig)}>
              <PaletteIcon aria-hidden="true" />
              <span>Create a palette</span>
              <ArrowUpRightIcon aria-hidden="true" />
            </button>
            {onOpenImport && (
              <button type="button" onClick={() => onOpenImport(selectedName, selectedConfig)}>
                <DownloadIcon aria-hidden="true" />
                <span>Import a theme</span>
                <ArrowUpRightIcon aria-hidden="true" />
              </button>
            )}
            {onOpenExport && (
              <button type="button" onClick={() => onOpenExport(selectedName, selectedConfig)}>
                <UploadIcon aria-hidden="true" />
                <span>Export current theme</span>
                <ArrowUpRightIcon aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <ThemePrinterPreview
          config={selectedConfig}
          name={selectedName}
          previewOpen={previewOpen}
          onPreviewOpenChange={setPreviewOpen}
        />
      </div>
      {savedPresets.length > 0 && (
        <div className="theme-collection-saved">
          <h4>Your palettes</h4>
          <div className="theme-collection-custom-grid">
            {/* User Saved Presets */}
            {savedPresets.map((preset) => {
              const isSelected = activeSavedPalette?.id === preset.id;
              const isEditing = editingPresetId === preset.id;

              return (
                <div
                  key={preset.id}
                  className="min-w-0 rounded-2xl border border-border bg-card p-3"
                >
                  <button
                    type="button"
                    aria-label={`Use palette ${preset.name}`}
                    aria-pressed={isSelected}
                    onClick={() => onSelectTheme("custom", preset.config)}
                    className="group block w-full cursor-pointer overflow-hidden rounded-xl border border-border focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="flex h-12" aria-hidden="true">
                      {(["background", "card", "border", "foreground", "primary"] as const).map(
                        (key) => (
                          <span
                            key={key}
                            className="flex-1"
                            style={{ backgroundColor: preset.config.colors[key] }}
                          />
                        ),
                      )}
                    </span>
                  </button>

                  {isEditing ? (
                    <form
                      className="mt-2 flex items-center gap-1.5"
                      onSubmit={(event) => {
                        event.preventDefault();
                        onRenamePreset(preset.id, editingNameInput);
                        setEditingPresetId(null);
                      }}
                    >
                      <Input
                        autoFocus
                        aria-label="Palette name"
                        value={editingNameInput}
                        onChange={(event) => setEditingNameInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setEditingPresetId(null);
                        }}
                      />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Save palette name"
                        disabled={!editingNameInput.trim()}
                      >
                        <CheckIcon aria-hidden="true" />
                      </Button>
                    </form>
                  ) : (
                    <div className="mt-2 flex items-center justify-between gap-1">
                      <div className="min-w-0">
                        <p title={preset.name} className="truncate text-sm font-medium">
                          {preset.name}
                        </p>
                        {isSelected && (
                          <span className="text-xs text-muted-foreground">In use</span>
                        )}
                      </div>
                      <Menu>
                        <MenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Manage palette ${preset.name}`}
                            />
                          }
                        >
                          <EllipsisIcon aria-hidden="true" />
                        </MenuTrigger>
                        <MenuPopup align="end">
                          {onEditPresetInStudio && (
                            <MenuItem onClick={() => onEditPresetInStudio(preset)}>
                              <SlidersHorizontalIcon aria-hidden="true" /> Edit palette
                            </MenuItem>
                          )}
                          <MenuItem
                            onClick={() => {
                              setEditingPresetId(preset.id);
                              setEditingNameInput(preset.name);
                            }}
                          >
                            <PencilIcon aria-hidden="true" /> Rename
                          </MenuItem>
                          <MenuItem variant="destructive" onClick={() => onDeletePreset(preset.id)}>
                            <Trash2Icon aria-hidden="true" /> Delete
                          </MenuItem>
                        </MenuPopup>
                      </Menu>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function ThemesSettings() {
  const { confirm, confirmDialog } = useConfirm();
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
  const installedExtensions = useInstalledExtensions();
  const extensionThemes = useMemo(
    () => extensionThemePresets(installedExtensions, customThemeConfig.fonts),
    [installedExtensions, customThemeConfig.fonts],
  );

  const [isStudioOpen, setIsStudioOpen] = useState(false);
  const [studioInitialConfig, setStudioInitialConfig] = useState<CustomThemeConfig | null>(null);
  const [transfer, setTransfer] = useState<{
    tab: "import" | "export";
    name: string;
    config: CustomThemeConfig;
  } | null>(null);
  const [isCustomFontMode, setIsCustomFontMode] = useState(false);
  const [typographyTuneOpen, setTypographyTuneOpen] = useState(false);
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
      setTransfer(null);
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
      const preset = savedPresets.find(({ id }) => id === presetId);
      if (!preset) return;
      const confirmed = await confirm(`Delete “${preset.name}” from Your palettes?`);
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
    [confirm, savedPresets],
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

  const showCustomMixer = isCustomFontMode;
  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        title="Themes"
        description="Choose a palette and personalize your fonts."
      />

      <BrandIdentitySettings />

      <SettingsSection title="Theme collection" className="theme-collection-section">
        <ThemePickerGrid
          activeTheme={theme}
          customConfig={customThemeConfig}
          savedPresets={savedPresets}
          environmentThemes={serverConfig?.environmentThemes}
          extensionThemes={extensionThemes}
          onSelectTheme={(t, overrideConfig) => {
            if (overrideConfig) {
              setCustomThemeConfig(overrideConfig);
              setTheme("custom");
            } else {
              setTheme(t);
            }
          }}
          onOpenStudio={(config) => {
            setEditingStudioPresetName("");
            setStudioInitialConfig(config);
            setIsStudioOpen(true);
          }}
          onOpenImport={(name, config) => setTransfer({ tab: "import", name, config })}
          onOpenExport={(name, config) => setTransfer({ tab: "export", name, config })}
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
        className="typography-reel-section"
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
        <TypographyReel
          fonts={{
            ...fontPreferences,
            fontSizeInterface:
              fontPreferences.fontSizeInterface ??
              settings.fontSizeInterface ??
              DEFAULT_INTERFACE_FONT_SIZE,
            fontSizeCode:
              fontPreferences.fontSizeCode ?? settings.fontSizeCode ?? DEFAULT_CODE_FONT_SIZE,
            fontSizePrompt:
              fontPreferences.fontSizePrompt ?? settings.fontSizePrompt ?? DEFAULT_PROMPT_FONT_SIZE,
          }}
          composerFont={settings.fontFamilyComposer}
          onTune={() => setTypographyTuneOpen(true)}
          onCustom={() => setIsCustomFontMode(true)}
          onSelect={(combo) => {
            setIsCustomFontMode(false);
            const next = selectFontCombo(fontPreferences, combo);
            setFontPreferences(next);
            if (!combo.headingOnly)
              updateSettings({ fontFamilySans: next.uiFont, fontFamilyCode: next.editorFont });
          }}
          savedMixes={
            <SavedTypography
              showMixer={showCustomMixer}
              onCloseMixer={() => setIsCustomFontMode(false)}
              fonts={fontPreferences}
              onChange={(fonts) => {
                setFontPreferences(fonts);
                if (fonts.uiFont !== fontPreferences.uiFont)
                  updateSettings({ fontFamilySans: fonts.uiFont });
                if (fonts.editorFont !== fontPreferences.editorFont)
                  updateSettings({ fontFamilyCode: fonts.editorFont });
              }}
            />
          }
        />
        <Dialog
          open={typographyTuneOpen}
          onOpenChange={(open) => {
            if (!open) void debouncedSettings.flush();
            setTypographyTuneOpen(open);
          }}
        >
          <DialogPopup className="typography-tune-dialog">
            <DialogHeader>
              <DialogTitle>Tune typography</DialogTitle>
              <DialogDescription>
                Adjust interface, editor, composer, and size preferences.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              {!showCustomMixer && (
                <div className="border-t border-border/60 px-4 py-4 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-medium text-foreground">Interface Font</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Font for UI tabs, sidebar, dialogs, cards, and controls.
                      </p>
                    </div>
                    <div className="shrink-0 w-full sm:w-52">
                      <Select
                        items={UI_FONT_OPTIONS}
                        value={fontPreferences.uiFont}
                        onValueChange={(val) => {
                          if (!val) return;
                          setFontPreferences((prev) => ({ ...prev, uiFont: val }));
                          updateSettings({ fontFamilySans: val });
                        }}
                      >
                        <SelectTrigger className="w-full text-xs rounded-xl bg-background border-border/80">
                          <SelectValue placeholder="Select Interface Font" />
                        </SelectTrigger>
                        <SelectPopup align="end">
                          {UI_FONT_OPTIONS.map((f) => (
                            <SelectItem key={f.value} value={f.value} className="text-xs">
                              <span style={{ fontFamily: f.value }}>{f.label}</span>
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>
                  </div>

                  <div className="border-t border-border/40 pt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-medium text-foreground">Editor Font</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Monospace font for code, terminals, and diff views.
                      </p>
                    </div>
                    <div className="shrink-0 w-full sm:w-52">
                      <Select
                        items={EDITOR_FONT_OPTIONS}
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
                        <p className="text-[10px] text-muted-foreground">
                          UI, tabs, sidebar, dialogs
                        </p>
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
                        <p className="text-[10px] text-muted-foreground">
                          Editor, code blocks, diffs
                        </p>
                      </div>
                      <span className="font-mono text-xs font-bold text-foreground bg-muted px-2 py-0.5 rounded-md border border-border/50">
                        {fontPreferences.fontSizeCode ??
                          settings.fontSizeCode ??
                          DEFAULT_CODE_FONT_SIZE}{" "}
                        px
                      </span>
                    </div>
                    <input
                      type="range"
                      min={MIN_CODE_FONT_SIZE}
                      max={MAX_CODE_FONT_SIZE}
                      step={1}
                      value={
                        fontPreferences.fontSizeCode ??
                        settings.fontSizeCode ??
                        DEFAULT_CODE_FONT_SIZE
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
                      items={[
                        { value: "inherit", label: "Inherit Interface Font" },
                        { value: "monospace", label: "Monospace (Same as Editor)" },
                        ...UI_FONT_OPTIONS,
                      ]}
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
            </DialogPanel>
          </DialogPopup>
        </Dialog>
      </SettingsSection>

      <SettingsSection
        title="Toolbar Style"
        description="Preview how the active tool looks in your current theme."
        contentClassName="toolbar-style-panel"
      >
        <ToolbarStyleReel
          value={settings.toolbarStyle}
          onApply={(toolbarStyle) => updateSettings({ toolbarStyle })}
        />
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

      {confirmDialog}

      {transfer && (
        <ThemeImportExportModal
          isOpen
          onClose={() => setTransfer(null)}
          currentConfig={{
            ...transfer.config,
            fonts: {
              ...transfer.config.fonts,
              uiFont: fontPreferences.uiFont,
              editorFont: fontPreferences.editorFont,
              headingFont: fontPreferences.headingFont || fontPreferences.uiFont,
              ...(fontPreferences.sectionFont ? { sectionFont: fontPreferences.sectionFont } : {}),
              ...(fontPreferences.supportingFont
                ? { supportingFont: fontPreferences.supportingFont }
                : {}),
            },
          }}
          currentName={transfer.name}
          initialTab={transfer.tab}
          onImportTheme={handleImportTheme}
        />
      )}
    </div>
  );
}

export default ThemesSettings;
