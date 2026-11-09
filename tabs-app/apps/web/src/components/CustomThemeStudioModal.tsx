import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Maximize2,
  RefreshCw,
  Shuffle,
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
import { Dialog, DialogPopup, DialogTitle, DialogDescription, DialogDetails } from "./ui/dialog";
import { SegmentedControl } from "./ui/segmented-control";
import { ThemeWorkspaceSpecimen } from "./settings/ThemeWorkspaceSpecimen";
import "./settings/palette-studio.css";
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
      setAutoTuneFeedback(null);
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isApplying && handleDismiss()}>
      <DialogPopup
        showCloseButton={false}
        bottomStickOnMobile={false}
        backdropClassName="bg-black/50 backdrop-blur-none"
        className="palette-studio max-w-5xl overflow-hidden bg-background"
      >
        <header className="palette-studio-header">
          <div>
            <DialogTitle className="text-xl">Custom Theme Studio</DialogTitle>
            <DialogDescription className="mt-1">
              Build a palette for your Tabs workspace.
            </DialogDescription>
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Close Custom Theme Studio"
            onClick={handleDismiss}
            disabled={isApplying}
          >
            <X aria-hidden="true" />
          </Button>
        </header>

        <div className="palette-studio-body">
          <div className="palette-studio-layout">
            <figure className="palette-studio-preview">
              <figcaption className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">Workspace preview</span>
                <Button size="sm" variant="ghost" onClick={() => setIsPreviewModalOpen(true)}>
                  <Maximize2 aria-hidden="true" /> Expand preview
                </Button>
              </figcaption>
              <ThemeWorkspaceSpecimen config={draftConfig} />
              <div className="palette-studio-strip" aria-hidden="true">
                {[
                  draftConfig.colors.background,
                  draftConfig.colors.card,
                  draftConfig.colors.border,
                  draftConfig.colors.foreground,
                  draftConfig.colors.primary,
                ].map((color, index) => (
                  <span key={index} style={{ backgroundColor: color }} />
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div role="status" className="flex items-center gap-2 text-muted-foreground">
                  {lowContrastCount > 0 ? (
                    <AlertCircle
                      className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
                      aria-hidden="true"
                    />
                  ) : (
                    <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                  )}
                  <span>
                    {lowContrastCount > 0
                      ? `${lowContrastCount} color ${lowContrastCount === 1 ? "pair needs" : "pairs need"} more contrast`
                      : `All ${wcagResults.length} contrast checks passed`}
                  </span>
                  {autoTuneFeedback && <span className="sr-only">{autoTuneFeedback}</span>}
                </div>
                <Button size="sm" variant="ghost" onClick={handleAutoFixContrast}>
                  <Wand2 aria-hidden="true" /> Auto-tune
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-3">
                <label className="grid min-w-40 flex-1 gap-1.5 text-xs font-medium">
                  Preset name
                  <Input
                    type="text"
                    placeholder="Name your palette"
                    value={presetNameInput}
                    onChange={(event) => setPresetNameInput(event.target.value)}
                  />
                </label>
                <Button variant="outline" onClick={handleSavePresetAction}>
                  Save Preset
                </Button>
              </div>
            </figure>

            <section aria-label="Palette controls" className="palette-studio-controls">
              <div className="palette-studio-baseline">
                <div className="grid min-w-0 gap-1.5">
                  <span className="text-xs font-medium">Starting palette</span>
                  <Select onValueChange={handleLoadBuiltinPreset}>
                    <SelectTrigger aria-label="Starting palette" className="w-full min-w-0">
                      <SelectValue placeholder="Choose a preset" />
                    </SelectTrigger>
                    <SelectPopup align="start">
                      {Object.values(THEME_DEFINITIONS)
                        .filter((theme) => theme.id !== "custom")
                        .map((theme) => (
                          <SelectItem key={theme.id} value={theme.id}>
                            {theme.name}
                          </SelectItem>
                        ))}
                    </SelectPopup>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium">Window appearance</span>
                  <SegmentedControl
                    size="sm"
                    aria-label="Window appearance"
                    value={draftConfig.baseVariant}
                    onValueChange={(baseVariant) => updateDraft({ ...draftConfig, baseVariant })}
                    options={[
                      { value: "dark", label: "Dark" },
                      { value: "light", label: "Light" },
                    ]}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-2.5">
                <span className="text-xs font-medium">Generate colors</span>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={randomStyle}
                    onValueChange={(value) => value && setRandomStyle(value as RandomStyleMode)}
                  >
                    <SelectTrigger aria-label="Random palette style">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup align="start">
                      {RANDOM_STYLE_OPTIONS.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <Button size="sm" variant="outline" onClick={handleRandomize}>
                    <Shuffle aria-hidden="true" /> Randomize
                  </Button>
                </div>
              </div>
              <div className="palette-studio-colors">
                <h3 className="mb-1 text-sm font-semibold">Palette colors</h3>
                <CustomColorPicker
                  label="Background"
                  description="Editor and workspace"
                  value={draftConfig.colors.background}
                  onChange={(value) => updatePrimaryColor("background", value)}
                />
                <CustomColorPicker
                  label="Text"
                  description="Labels and code"
                  value={draftConfig.colors.foreground}
                  onChange={(value) => updatePrimaryColor("foreground", value)}
                />
                <CustomColorPicker
                  label="Surfaces"
                  description="Tabs, sidebars and dialogs"
                  value={draftConfig.colors.card}
                  onChange={(value) => updatePrimaryColor("card", value)}
                />
                <CustomColorPicker
                  label="Accent"
                  description="Buttons, focus and active tabs"
                  value={draftConfig.colors.primary}
                  onChange={(value) => updatePrimaryColor("primary", value)}
                />
              </div>
              <DialogDetails title="Advanced colors">
                <CustomColorPicker
                  label="Borders"
                  description="Outlines and dividers"
                  value={draftConfig.colors.border}
                  onChange={(value) => updatePrimaryColor("border", value)}
                />
                <CustomColorPicker
                  label="Secondary text"
                  description="Hints and line numbers"
                  value={mutedFgColor}
                  onChange={(value) => updateTokenOverride("app.mutedForeground", value)}
                />
                <CustomColorPicker
                  label="Selection"
                  description="Selected text and rows"
                  value={selectionColor}
                  onChange={(value) => updateTokenOverride("editor.selectionBackground", value)}
                />
                <CustomColorPicker
                  label="Hover"
                  description="Buttons and list rows"
                  value={hoverWashColor}
                  onChange={(value) => updateTokenOverride("list.hoverBackground", value)}
                />
              </DialogDetails>
              <DialogDetails title="Palette tools">
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setImportExportTab("import");
                      setIsImportExportOpen(true);
                    }}
                  >
                    <Upload aria-hidden="true" /> Import
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setImportExportTab("export");
                      setIsImportExportOpen(true);
                    }}
                  >
                    <Download aria-hidden="true" /> Export
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleResetToDefault}>
                    <RefreshCw aria-hidden="true" /> Reset colors
                  </Button>
                </div>
              </DialogDetails>
            </section>
          </div>
        </div>

        {applyError && (
          <p role="alert" className="px-6 py-2 text-sm text-destructive">
            {applyError}
          </p>
        )}
        <footer className="palette-studio-footer">
          <span className="text-xs text-muted-foreground">Apply to use this palette in Tabs.</span>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={handleDismiss} disabled={isApplying}>
              Cancel
            </Button>
            <Button onClick={handleApplyAction} disabled={isApplying} aria-busy={isApplying}>
              {isApplying ? "Applying…" : "Apply Theme"}
            </Button>
          </div>
        </footer>
      </DialogPopup>

      {/* Dedicated Full-Width Live Preview Modal Overlay */}
      <Dialog open={isPreviewModalOpen} onOpenChange={setIsPreviewModalOpen}>
        <DialogPopup
          showCloseButton={false}
          className="flex flex-col h-full max-h-[90vh] w-full max-w-5xl rounded-3xl border border-border/80 bg-card p-6 shadow-2xl space-y-4"
        >
          <div className="flex items-center justify-between border-b border-border/60 pb-4">
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">Theme preview</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Preview your theme across Tabs.
              </DialogDescription>
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
          destination="draft"
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
