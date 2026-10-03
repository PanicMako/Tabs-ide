import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Maximize2,
  Moon,
  Palette,
  RefreshCw,
  Shuffle,
  Sun,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import {
  calculateLuminance,
  getOptimalPrimaryForeground,
  runThemeWcagCheck,
  toHexColor,
  type CustomThemeConfig,
} from "@tabs/shared/themeDerivation";
import {
  DEFAULT_CUSTOM_THEME,
  DEFAULT_CUSTOM_THEME_LIGHT,
  generateAestheticThemeName,
  generateHarmonizedPalette,
  RANDOM_STYLE_OPTIONS,
  THEME_DEFINITIONS,
  type FontPreferences,
  type RandomStyleMode,
  type ThemeId,
} from "../lib/themes";
import {
  buildFontPreferencesFromThemeConfig,
  commitCustomTheme,
  previewTheme,
  restoreThemeSnapshot,
  snapshotThemeState,
  type ThemeSnapshotState,
} from "../hooks/useTheme";
import { useSettingsDraftSource } from "../state/settingsDraftRegistry";
import { CustomColorPicker } from "./ui/CustomColorPicker";
import { WorkbenchMiniPreview } from "./WorkbenchMiniPreview";
import { ThemeImportExportModal } from "./ThemeImportExportModal";
import { Button } from "./ui/button";
import { Dialog, DialogPopup } from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { toastManager } from "./ui/toast";

export interface CustomThemeStudioModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly config: CustomThemeConfig;
  readonly onChange?: (next: CustomThemeConfig) => void;
  readonly onApply?: (config: CustomThemeConfig, fonts?: FontPreferences) => Promise<void> | void;
  readonly onSavePreset: (name: string, config: CustomThemeConfig) => void;
  readonly initialPresetName?: string;
  /** Called when a theme is imported inside the Studio, passing the resolved font preferences. */
  readonly onFontsImported?: (fonts: FontPreferences) => void;
}

export const CustomThemeStudioModal: React.FC<CustomThemeStudioModalProps> = ({
  isOpen,
  onClose,
  config,
  onChange,
  onApply,
  onSavePreset,
  initialPresetName = "",
  onFontsImported,
}) => {
  const [draftConfig, setDraftConfig] = useState<CustomThemeConfig>(config);
  const [draftFonts, setDraftFonts] = useState<FontPreferences | undefined>(undefined);
  const [presetNameInput, setPresetNameInput] = useState(initialPresetName);
  const [randomStyle, setRandomStyle] = useState<RandomStyleMode>("pastel");
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [isImportExportOpen, setIsImportExportOpen] = useState(false);
  const [importExportTab, setImportExportTab] = useState<"import" | "export">("import");
  const [autoTuneFeedback, setAutoTuneFeedback] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const snapshotRef = useRef<ThemeSnapshotState | null>(null);
  const initialDraftConfigRef = useRef<CustomThemeConfig>(config);

  // Snapshot pre-open state and initialize local draft on open
  useEffect(() => {
    if (isOpen) {
      snapshotRef.current = snapshotThemeState();
      initialDraftConfigRef.current = config;
      setDraftConfig(config);
      setDraftFonts(undefined);
      setApplyError(null);
      setPresetNameInput(initialPresetName);
      previewTheme("custom", config);
    }
  }, [isOpen, config, initialPresetName]);

  const isDraftDirty =
    isOpen &&
    (JSON.stringify(draftConfig) !== JSON.stringify(initialDraftConfigRef.current) ||
      (draftFonts !== undefined &&
        JSON.stringify(draftFonts) !== JSON.stringify(snapshotRef.current?.fontPreferences)));
  useSettingsDraftSource("theme-studio", isDraftDirty, "Theme Studio");

  const handleDismiss = useCallback(() => {
    if (snapshotRef.current) {
      restoreThemeSnapshot(snapshotRef.current);
    }
    setApplyError(null);
    onClose();
  }, [onClose]);

  // Extended driver state for extra granular controls
  const mutedFgColor =
    draftConfig.tokenOverrides?.["app.mutedForeground"] ||
    (draftConfig.baseVariant === "dark" ? "#8a8a8a" : "#64748b");
  const selectionColor =
    draftConfig.tokenOverrides?.["editor.selectionBackground"] ||
    (draftConfig.baseVariant === "dark" ? "#38bdf840" : "#2563eb33");
  const hoverWashColor =
    draftConfig.tokenOverrides?.["list.hoverBackground"] ||
    (draftConfig.baseVariant === "dark" ? "#ffffff0f" : "#0000000d");

  // WCAG Contrast audit results
  const wcagResults = useMemo(() => runThemeWcagCheck(draftConfig), [draftConfig]);
  const lowContrastCount = useMemo(
    () => wcagResults.filter((r) => r.isLowContrast).length,
    [wcagResults],
  );

  if (!isOpen) return null;

  const updateDraft = (next: CustomThemeConfig, nextFonts?: FontPreferences) => {
    setDraftConfig(next);
    const fontsToUse = nextFonts ?? draftFonts;
    if (nextFonts) {
      setDraftFonts(nextFonts);
    }
    previewTheme("custom", next, fontsToUse);
    onChange?.(next);
  };

  const updatePrimaryColor = (key: keyof CustomThemeConfig["colors"], value: string) => {
    updateDraft({
      ...draftConfig,
      colors: {
        ...draftConfig.colors,
        [key]: value,
      },
    });
  };

  const updateTokenOverride = (token: string, value: string) => {
    updateDraft({
      ...draftConfig,
      tokenOverrides: {
        ...draftConfig.tokenOverrides,
        [token]: value,
      },
    });
  };

  const handleLoadBuiltinPreset = (presetId: string | null) => {
    if (!presetId) return;
    const def = THEME_DEFINITIONS[presetId as ThemeId];
    if (def) {
      updateDraft({
        baseVariant: def.baseVariant,
        colors: {
          background: def.colors.background,
          foreground: def.colors.foreground,
          card: def.colors.card,
          border: def.colors.border,
          primary: def.colors.primary,
        },
        fonts: draftConfig.fonts,
        tokenOverrides: {},
      });
      setPresetNameInput(`${def.name} Mod`);
    }
  };

  const handleRandomize = () => {
    const randomizedColors = generateHarmonizedPalette(draftConfig.baseVariant, randomStyle);
    updateDraft({
      ...draftConfig,
      colors: randomizedColors,
    });
    setPresetNameInput(generateAestheticThemeName());
  };

  const handleSavePresetAction = () => {
    const name = presetNameInput.trim() || generateAestheticThemeName();
    onSavePreset(name, draftConfig);
    setPresetNameInput("");
  };

  const handleApplyAction = async () => {
    setIsApplying(true);
    setApplyError(null);
    try {
      if (onApply) {
        await onApply(draftConfig, draftFonts);
      } else {
        commitCustomTheme(draftConfig, draftFonts);
        toastManager.add({
          type: "success",
          title: "Theme Applied",
          description: "Custom theme applied and saved.",
        });
        onClose();
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err ?? "Failed to apply theme");
      setApplyError(errorMsg);
      toastManager.add({
        type: "error",
        title: "Save Failed",
        description: errorMsg,
      });
    } finally {
      setIsApplying(false);
    }
  };

  const handleResetToDefault = () => {
    const isLightMode = draftConfig.baseVariant === "light";
    updateDraft(isLightMode ? DEFAULT_CUSTOM_THEME_LIGHT : DEFAULT_CUSTOM_THEME);
  };

  // Active Contrast Auto-Tune Engine
  const handleAutoFixContrast = () => {
    const isDark = draftConfig.baseVariant === "dark";
    const bgLum = calculateLuminance(toHexColor(draftConfig.colors.background));

    let nextFg = draftConfig.colors.foreground;
    if (isDark && bgLum > 0.4) {
      nextFg = "#f5f5f5";
    } else if (!isDark && bgLum < 0.6) {
      nextFg = "#0f172a";
    } else {
      nextFg = isDark ? "#ffffff" : "#0f172a";
    }

    const optimalPrimaryFg = getOptimalPrimaryForeground(draftConfig.colors.primary);

    const nextOverrides: Record<string, string> = { ...draftConfig.tokenOverrides };
    nextOverrides["app.primaryForeground"] = optimalPrimaryFg;
    nextOverrides["button.foreground"] = optimalPrimaryFg;

    for (const result of wcagResults) {
      if (result.recommendedFg) {
        nextOverrides[result.fgToken] = result.recommendedFg;
      }
    }

    updateDraft({
      ...draftConfig,
      colors: {
        ...draftConfig.colors,
        foreground: nextFg,
      },
      tokenOverrides: nextOverrides,
    });

    setAutoTuneFeedback("Contrast Auto-Tuned!");
    setTimeout(() => setAutoTuneFeedback(null), 2500);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleDismiss()}>
      <DialogPopup
        showCloseButton={false}
        className="max-h-[92vh] w-full max-w-5xl flex-col p-0 overflow-hidden rounded-3xl border border-border/80 bg-card text-card-foreground shadow-2xl"
      >
        {/* Clean Neutral Header Bar */}
        <div className="flex items-center justify-between border-b border-border/70 px-6 py-4 bg-background/60 shrink-0">
          <div className="flex items-center gap-3">
            <Palette className="size-5 text-muted-foreground" />
            <div>
              <h3 className="text-base font-bold text-foreground tracking-tight">
                Custom Theme Studio
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Design custom color suites with automated token derivation &amp; live WCAG contrast
                checking.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setImportExportTab("import");
                setIsImportExportOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-xl border border-border/80 bg-muted/50 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer shadow-xs whitespace-nowrap"
              title="Import theme from JSON or VS Code color theme file"
            >
              <Upload className="size-3.5" />
              <span>Import</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setImportExportTab("export");
                setIsImportExportOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-xl border border-border/80 bg-muted/50 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer shadow-xs whitespace-nowrap"
              title="Export theme to JSON file or clipboard"
            >
              <Download className="size-3.5" />
              <span>Export</span>
            </button>

            <button
              type="button"
              onClick={() => setIsPreviewModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3.5 py-1.5 text-xs font-bold text-foreground hover:bg-primary/20 transition-colors cursor-pointer shadow-xs whitespace-nowrap"
            >
              <Maximize2 className="size-3.5" />
              <span>Live Preview</span>
            </button>

            <button
              type="button"
              onClick={handleResetToDefault}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
              title="Reset theme to default"
            >
              <RefreshCw className="size-3.5" />
              <span>Reset</span>
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Close Custom Theme Studio"
              className="rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Actionable Error Alert if Apply Failed */}
        {applyError && (
          <div
            role="alert"
            className="flex items-center justify-between border-b border-destructive/30 bg-destructive/10 px-6 py-2.5 text-xs font-medium text-destructive"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              <span>{applyError}</span>
            </div>
            <button
              type="button"
              onClick={() => setApplyError(null)}
              className="hover:underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Modal Main Content Area: Spacious 2-Column Driver Layout */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Top Control Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            {/* Start from Built-in Preset Baseline Loader */}
            <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/50 p-3 hover:border-primary/30 transition-all">
              <div>
                <span className="text-xs font-semibold text-foreground block tracking-tight">
                  Start from Built-in Preset
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Import a baseline theme to customize
                </span>
              </div>
              <Select onValueChange={handleLoadBuiltinPreset}>
                <SelectTrigger className="h-8 border-border/80 bg-muted/30 text-xs font-medium px-3 rounded-xl min-w-[140px]">
                  <SelectValue placeholder="Select Baseline..." />
                </SelectTrigger>
                <SelectPopup align="end">
                  {Object.values(THEME_DEFINITIONS)
                    .filter((t) => t.id !== "custom")
                    .map((def) => (
                      <SelectItem key={def.id} value={def.id} className="text-xs">
                        {def.name}
                      </SelectItem>
                    ))}
                </SelectPopup>
              </Select>
            </div>

            {/* Base Variant Switcher */}
            <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/50 p-3 hover:border-primary/30 transition-all">
              <div>
                <span className="text-xs font-semibold text-foreground block tracking-tight">
                  Base Window Variant
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Titlebar &amp; window frame chrome theme
                </span>
              </div>
              <div className="tabs-segmented flex" role="group" aria-label="Base window variant">
                <button
                  type="button"
                  onClick={() => updateDraft({ ...draftConfig, baseVariant: "dark" })}
                  aria-pressed={draftConfig.baseVariant === "dark"}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                    draftConfig.baseVariant === "dark"
                      ? "bg-background text-foreground font-bold shadow-xs border border-border/50"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Moon className="size-3.5" />
                  <span>Dark</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateDraft({ ...draftConfig, baseVariant: "light" })}
                  aria-pressed={draftConfig.baseVariant === "light"}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                    draftConfig.baseVariant === "light"
                      ? "bg-background text-foreground font-bold shadow-xs border border-border/50"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Sun className="size-3.5" />
                  <span>Light</span>
                </button>
              </div>
            </div>
          </div>

          {/* Section Heading */}
          <div className="flex items-center justify-between pt-2 border-t border-border/60">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                Palette Driver Controls (8 Granular Keys)
              </h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Core color drivers that automatically compute all ~95 VS Code &amp; app tokens.
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-full bg-muted/60 px-3 py-1 text-[11px] font-medium text-foreground border border-border/80 shadow-2xs">
              <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
              <span className="text-xs font-medium">Derivation Active</span>
            </div>
          </div>

          {/* Spacious 2-Column Driver Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left Column: Drivers 1 to 4 */}
            <div className="space-y-3.5">
              <CustomColorPicker
                label="1. Canvas Background"
                description="Editor canvas & main container background"
                value={draftConfig.colors.background}
                onChange={(val) => updatePrimaryColor("background", val)}
              />
              <CustomColorPicker
                label="2. Text / Foreground"
                description="Headings, body typography, labels, code text"
                value={draftConfig.colors.foreground}
                onChange={(val) => updatePrimaryColor("foreground", val)}
              />
              <CustomColorPicker
                label="3. Card / Surface"
                description="Sidebar, tab bars, modals, floating popovers"
                value={draftConfig.colors.card}
                onChange={(val) => updatePrimaryColor("card", val)}
              />
              <CustomColorPicker
                label="4. Border Outlines"
                description="Dividers, card outlines, tab borders"
                value={draftConfig.colors.border}
                onChange={(val) => updatePrimaryColor("border", val)}
              />
            </div>

            {/* Right Column: Drivers 5 to 8 */}
            <div className="space-y-3.5">
              <CustomColorPicker
                label="5. Primary Accent"
                description="Active tab line, focus ring, primary buttons"
                value={draftConfig.colors.primary}
                onChange={(val) => updatePrimaryColor("primary", val)}
              />
              <CustomColorPicker
                label="6. Muted / Secondary Text"
                description="Subtle typography, line numbers, disabled labels"
                value={mutedFgColor}
                onChange={(val) => updateTokenOverride("app.mutedForeground", val)}
              />
              <CustomColorPicker
                label="7. Selection / Active Highlight"
                description="Code selection highlight & active row glow"
                value={selectionColor}
                onChange={(val) => updateTokenOverride("editor.selectionBackground", val)}
              />
              <CustomColorPicker
                label="8. Hover & Interactive Wash"
                description="Button hover states & list item highlights"
                value={hoverWashColor}
                onChange={(val) => updateTokenOverride("list.hoverBackground", val)}
              />
            </div>
          </div>
        </div>

        {/* Footer Action & WCAG Audit Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between border-t border-border/70 px-6 py-4 bg-muted/20 gap-4 shrink-0">
          {/* WCAG Audit Badge */}
          <div className="flex items-center gap-2">
            {lowContrastCount > 0 ? (
              <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 px-3.5 py-1.5 text-xs text-amber-700 dark:text-amber-400 font-medium">
                <AlertCircle className="size-4 shrink-0" />
                <span>
                  {lowContrastCount} Low Contrast Pair{lowContrastCount > 1 ? "s" : ""}
                </span>
                <button
                  type="button"
                  onClick={handleAutoFixContrast}
                  className="ms-1 underline font-bold hover:text-amber-900 dark:hover:text-amber-300 cursor-pointer flex items-center gap-1 whitespace-nowrap"
                >
                  <Wand2 className="size-3" />
                  <span>Auto-Tune</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl bg-card border border-border/80 px-3.5 py-1.5 text-xs text-foreground font-medium shadow-2xs">
                <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  WCAG AA Contrast Compliant ({wcagResults.length}/{wcagResults.length} Pairs Pass)
                </span>
                <button
                  type="button"
                  onClick={handleAutoFixContrast}
                  className="ms-2 px-2.5 py-1 rounded-lg bg-primary/10 text-foreground text-xs font-bold hover:bg-primary/20 cursor-pointer flex items-center gap-1 whitespace-nowrap"
                  title="Optimize button & token contrast"
                >
                  <Wand2 className="size-3.5" />
                  <span>Auto-Tune</span>
                </button>
              </div>
            )}

            {autoTuneFeedback && (
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 animate-in fade-in duration-200 ms-1">
                {autoTuneFeedback}
              </span>
            )}
          </div>

          {/* Preset Generator & Final Apply / Cancel Actions */}
          <div className="flex items-center flex-wrap gap-2.5 w-full sm:w-auto justify-end">
            <div className="flex items-center rounded-xl border border-border/80 bg-background/80 p-1 shadow-2xs">
              <Select
                value={randomStyle}
                onValueChange={(val) => val && setRandomStyle(val as RandomStyleMode)}
              >
                <SelectTrigger className="h-8 border-0 bg-transparent text-xs font-medium px-2.5 rounded-lg focus:ring-0 shadow-none">
                  <SelectValue placeholder="Style" />
                </SelectTrigger>
                <SelectPopup align="start">
                  {RANDOM_STYLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <div className="h-4 w-px bg-border/80 mx-1" />
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRandomize}
                className="gap-1.5 rounded-lg text-xs font-semibold h-8 px-3 cursor-pointer hover:bg-muted"
              >
                <Shuffle className="size-3.5 text-foreground/80" />
                <span>Randomize</span>
              </Button>
            </div>

            <Input
              type="text"
              placeholder="Preset Name..."
              value={presetNameInput}
              onChange={(e) => setPresetNameInput(e.target.value)}
              className="w-36 h-9 text-xs rounded-xl bg-background border-border/80"
            />

            <Button
              size="sm"
              variant="outline"
              onClick={handleSavePresetAction}
              className="h-9 px-3.5 text-xs font-semibold rounded-xl border-border/80 hover:bg-muted cursor-pointer whitespace-nowrap"
            >
              Save Preset
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              className="h-9 px-3.5 text-xs font-medium rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer whitespace-nowrap"
            >
              Cancel
            </Button>

            <Button
              size="sm"
              onClick={handleApplyAction}
              disabled={isApplying}
              aria-busy={isApplying}
              className="h-9 px-5 text-xs font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm cursor-pointer whitespace-nowrap"
            >
              {isApplying ? "Applying..." : "Apply Theme"}
            </Button>
          </div>
        </div>
      </DialogPopup>

      {/* Dedicated Full-Width Live Preview Modal Overlay */}
      <Dialog open={isPreviewModalOpen} onOpenChange={setIsPreviewModalOpen}>
        <DialogPopup
          showCloseButton={false}
          className="flex flex-col h-full max-h-[90vh] w-full max-w-5xl rounded-3xl border border-border/80 bg-card p-6 shadow-2xl space-y-4"
        >
          <div className="flex items-center justify-between border-b border-border/60 pb-4">
            <div>
              <h3 className="text-lg font-bold text-foreground">
                Full-Width Live Preview Showcase
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                High-definition inspection of custom theme colors across IDE, App Shell, and Token
                surfaces.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsPreviewModalOpen(false)}
              className="rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pt-2">
            <WorkbenchMiniPreview config={draftConfig} />
          </div>
        </DialogPopup>
      </Dialog>

      {isImportExportOpen && (
        <ThemeImportExportModal
          isOpen={isImportExportOpen}
          onClose={() => setIsImportExportOpen(false)}
          currentConfig={draftConfig}
          currentName={presetNameInput || "Custom Theme"}
          initialTab={importExportTab}
          onImportTheme={(name, importedConfig) => {
            const nextFonts = buildFontPreferencesFromThemeConfig(importedConfig);
            updateDraft(importedConfig, nextFonts);
            setPresetNameInput(name);
            onFontsImported?.(nextFonts);
            setIsImportExportOpen(false);
          }}
        />
      )}
    </Dialog>
  );
};
