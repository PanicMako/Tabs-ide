import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MonitorPlayIcon, RotateCcwIcon, SaveIcon, XIcon } from "lucide-react";
import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";
import { useConfirm } from "../../hooks/useConfirm";
import { useTheme } from "../../hooks/useTheme";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useSettingsDraftSource } from "../../state/settingsDraftRegistry";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { SplashScreen } from "../SplashScreen";
import { CloseScreen } from "../CloseScreen";
import { FONT_COMBOS, UI_FONT_OPTIONS } from "../../lib/themes";
import {
  SettingResetButton,
  SettingsHeaderPortal,
  SettingsRow,
  SettingsSection,
  SettingsSectionHeader,
} from "./SettingsLayout";

function StartupPreviewOverlay({ loader, palette, theme, fontComboId, customFont, onClose }: any) {
  const previewHoldMs = 2_000;
  const previewExitMs = 1_000;
  const [isExiting, setIsExiting] = useState(false);
  const onCloseRef = useRef(onClose);
  const overlayRef = useRef<HTMLDivElement>(null);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlayRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, previewHoldMs);

    return () => clearTimeout(exitTimer);
  }, []);

  useEffect(() => {
    if (isExiting) {
      const closeTimer = setTimeout(() => {
        onCloseRef.current();
      }, previewExitMs + 200);
      return () => clearTimeout(closeTimer);
    }
  }, [isExiting]);

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Startup animation preview"
      tabIndex={-1}
      className={cn(
        "fixed inset-0 z-[99999] cursor-pointer will-change-transform transition-transform duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]",
        isExiting ? "-translate-y-full" : "translate-y-0",
      )}
      onClick={() => setIsExiting(true)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setIsExiting(true);
        if (event.key === "Tab") {
          event.preventDefault();
          event.currentTarget.querySelector("button")?.focus();
        }
      }}
    >
      <button
        type="button"
        aria-label="Close startup animation preview"
        className="absolute right-5 top-5 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        onClick={() => setIsExiting(true)}
      >
        <XIcon className="size-5" aria-hidden="true" />
      </button>
      <SplashScreen
        loader={loader}
        palette={palette}
        theme={theme}
        fontComboId={fontComboId}
        customFont={customFont}
      />
    </div>
  );
}

function ClosePreviewOverlay({ loader, palette, theme, fontComboId, customFont, onClose }: any) {
  const [phase, setPhase] = useState<any>("idle");
  const [isExiting, setIsExiting] = useState(false);
  const onCloseRef = useRef(onClose);
  const overlayRef = useRef<HTMLDivElement>(null);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlayRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setPhase("closing");
    }, 1000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!isExiting) return;
    const closeTimer = setTimeout(() => onCloseRef.current(), 700);
    return () => clearTimeout(closeTimer);
  }, [isExiting]);

  const handleIntroEnd = () => setIsExiting(true);

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Close animation preview"
      tabIndex={-1}
      className={cn(
        "fixed inset-0 z-[99999] cursor-pointer will-change-transform transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]",
        isExiting ? "-translate-y-full" : "translate-y-0",
      )}
      onClick={() => setIsExiting(true)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setIsExiting(true);
        if (event.key === "Tab") {
          event.preventDefault();
          event.currentTarget.querySelector("button")?.focus();
        }
      }}
    >
      <button
        type="button"
        aria-label="Close animation preview"
        className="absolute right-5 top-5 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        onClick={() => setIsExiting(true)}
      >
        <XIcon className="size-5" aria-hidden="true" />
      </button>
      <CloseScreen
        loader={loader}
        palette={palette}
        theme={theme}
        phase={phase}
        fontComboId={fontComboId}
        customFont={customFont}
        onIntroEnd={handleIntroEnd}
      />
    </div>
  );
}

export function AnimationsSettings() {
  const { confirm } = useConfirm();
  const { theme } = useTheme();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();

  const [previewStyle, setPreviewStyle] = useState(settings.splashLoaderStyle);
  const [previewPalette, setPreviewPalette] = useState(settings.splashLoaderPalette);
  const [previewTheme, setPreviewTheme] = useState<"system" | "dark" | "light">(
    settings.splashLoaderTheme,
  );

  const [closePreviewStyle, setClosePreviewStyle] = useState(settings.closeLoaderStyle);
  const [closePreviewPalette, setClosePreviewPalette] = useState(settings.closeLoaderPalette);
  const [closePreviewTheme, setClosePreviewTheme] = useState<"system" | "dark" | "light">(
    settings.closeLoaderTheme,
  );
  const [closeReplayKey, setCloseReplayKey] = useState(0);
  const [startupReplayKey, setStartupReplayKey] = useState(0);

  const [animationTab, setAnimationTab] = useState<"startup" | "close">("startup");

  /* Startup Animation Font State */
  const [savedStartupAnimationFontComboId, setSavedStartupAnimationFontComboId] = useState<string>(
    () => {
      try {
        return (
          window.localStorage?.getItem("tabs.startupAnimationFontComboId") ??
          window.localStorage?.getItem("tabs.animationFontComboId") ??
          "app-default"
        );
      } catch {
        return "app-default";
      }
    },
  );
  const [savedStartupCustomAnimationFont, setSavedStartupCustomAnimationFont] = useState<string>(
    () => {
      try {
        return (
          window.localStorage?.getItem("tabs.startupCustomAnimationFont") ??
          window.localStorage?.getItem("tabs.customAnimationFont") ??
          "'Inter', sans-serif"
        );
      } catch {
        return "'Inter', sans-serif";
      }
    },
  );

  const [previewStartupAnimationFontComboId, setPreviewStartupAnimationFontComboId] =
    useState<string>(savedStartupAnimationFontComboId);
  const [previewStartupCustomAnimationFont, setPreviewStartupCustomAnimationFont] =
    useState<string>(savedStartupCustomAnimationFont);

  /* Close Animation Font State */
  const [savedCloseAnimationFontComboId, setSavedCloseAnimationFontComboId] = useState<string>(
    () => {
      try {
        return (
          window.localStorage?.getItem("tabs.closeAnimationFontComboId") ??
          window.localStorage?.getItem("tabs.animationFontComboId") ??
          "app-default"
        );
      } catch {
        return "app-default";
      }
    },
  );
  const [savedCloseCustomAnimationFont, setSavedCloseCustomAnimationFont] = useState<string>(() => {
    try {
      return (
        window.localStorage?.getItem("tabs.closeCustomAnimationFont") ??
        window.localStorage?.getItem("tabs.customAnimationFont") ??
        "'Inter', sans-serif"
      );
    } catch {
      return "'Inter', sans-serif";
    }
  });

  const [previewCloseAnimationFontComboId, setPreviewCloseAnimationFontComboId] = useState<string>(
    savedCloseAnimationFontComboId,
  );
  const [previewCloseCustomAnimationFont, setPreviewCloseCustomAnimationFont] = useState<string>(
    () => savedCloseCustomAnimationFont,
  );

  const isAnimationsDirty =
    previewStyle !== settings.splashLoaderStyle ||
    previewPalette !== settings.splashLoaderPalette ||
    previewTheme !== settings.splashLoaderTheme ||
    closePreviewStyle !== settings.closeLoaderStyle ||
    closePreviewPalette !== settings.closeLoaderPalette ||
    closePreviewTheme !== settings.closeLoaderTheme ||
    previewStartupAnimationFontComboId !== savedStartupAnimationFontComboId ||
    (previewStartupAnimationFontComboId === "custom" &&
      previewStartupCustomAnimationFont !== savedStartupCustomAnimationFont) ||
    previewCloseAnimationFontComboId !== savedCloseAnimationFontComboId ||
    (previewCloseAnimationFontComboId === "custom" &&
      previewCloseCustomAnimationFont !== savedCloseCustomAnimationFont);

  useSettingsDraftSource("animations", isAnimationsDirty, "Animations");

  const activeFontComboId =
    animationTab === "startup"
      ? previewStartupAnimationFontComboId
      : previewCloseAnimationFontComboId;
  const setActiveFontComboId =
    animationTab === "startup"
      ? setPreviewStartupAnimationFontComboId
      : setPreviewCloseAnimationFontComboId;

  const activeCustomFont =
    animationTab === "startup"
      ? previewStartupCustomAnimationFont
      : previewCloseCustomAnimationFont;
  const setActiveCustomFont =
    animationTab === "startup"
      ? setPreviewStartupCustomAnimationFont
      : setPreviewCloseCustomAnimationFont;

  const [fullscreenClosePreview, setFullscreenClosePreview] = useState(false);
  const [fullscreenStartupPreview, setFullscreenStartupPreview] = useState(false);

  const effectivePreviewTheme = previewTheme === "system" ? theme : previewTheme;
  const effectiveClosePreviewTheme = closePreviewTheme === "system" ? theme : closePreviewTheme;

  const activeStyle = animationTab === "startup" ? previewStyle : closePreviewStyle;
  const setActiveStyle = animationTab === "startup" ? setPreviewStyle : setClosePreviewStyle;

  const activePalette = animationTab === "startup" ? previewPalette : closePreviewPalette;
  const setActivePalette = animationTab === "startup" ? setPreviewPalette : setClosePreviewPalette;

  const activeTheme = animationTab === "startup" ? previewTheme : closePreviewTheme;
  const setActiveTheme = animationTab === "startup" ? setPreviewTheme : setClosePreviewTheme;

  const activeEffectiveTheme =
    animationTab === "startup" ? effectivePreviewTheme : effectiveClosePreviewTheme;

  useEffect(() => {
    setPreviewStyle(settings.splashLoaderStyle);
    setPreviewPalette(settings.splashLoaderPalette);
    setPreviewTheme(settings.splashLoaderTheme);

    setClosePreviewStyle(settings.closeLoaderStyle);
    setClosePreviewPalette(settings.closeLoaderPalette);
    setClosePreviewTheme(settings.closeLoaderTheme);

    setPreviewStartupAnimationFontComboId(savedStartupAnimationFontComboId);
    setPreviewStartupCustomAnimationFont(savedStartupCustomAnimationFont);
    setPreviewCloseAnimationFontComboId(savedCloseAnimationFontComboId);
    setPreviewCloseCustomAnimationFont(savedCloseCustomAnimationFont);
  }, [
    savedCloseAnimationFontComboId,
    savedCloseCustomAnimationFont,
    savedStartupAnimationFontComboId,
    savedStartupCustomAnimationFont,
    settings.closeLoaderPalette,
    settings.closeLoaderStyle,
    settings.closeLoaderTheme,
    settings.splashLoaderPalette,
    settings.splashLoaderStyle,
    settings.splashLoaderTheme,
  ]);

  return (
    <div className="space-y-6">
      {fullscreenStartupPreview &&
        createPortal(
          <StartupPreviewOverlay
            key={startupReplayKey}
            loader={previewStyle}
            palette={previewPalette}
            theme={effectivePreviewTheme}
            fontComboId={previewStartupAnimationFontComboId}
            customFont={previewStartupCustomAnimationFont}
            onClose={() => setFullscreenStartupPreview(false)}
          />,
          document.body,
        )}
      {fullscreenClosePreview &&
        createPortal(
          <ClosePreviewOverlay
            key={closeReplayKey}
            loader={closePreviewStyle}
            palette={closePreviewPalette}
            theme={effectiveClosePreviewTheme}
            fontComboId={previewCloseAnimationFontComboId}
            customFont={previewCloseCustomAnimationFont}
            onClose={() => setFullscreenClosePreview(false)}
          />,
          document.body,
        )}

      <SettingsSectionHeader
        title="Animations"
        description="Customize interactive UI transitions and startup animation preferences."
        actions={
          <SettingsHeaderPortal>
            <Button
              size="xs"
              variant="outline"
              className="no-drag cursor-pointer"
              onClick={async () => {
                const confirmed = await confirm(
                  "Restore default settings?\n\nThis will reset the animation toggles.",
                );
                if (confirmed) {
                  updateSettings({
                    sliderAnimationsEnabled: DEFAULT_UNIFIED_SETTINGS.sliderAnimationsEnabled,
                    animatedTrackFillEnabled: DEFAULT_UNIFIED_SETTINGS.animatedTrackFillEnabled,
                  });
                }
              }}
            >
              <RotateCcwIcon className="size-3.5 mr-1" />
              Restore defaults
            </Button>
          </SettingsHeaderPortal>
        }
      />

      <SettingsSection title="Animation Controls">
        <div className="flex flex-col gap-10">
          <div className="flex flex-col gap-5">
            <div className="px-4 sm:px-5 pt-4 sm:pt-5 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {animationTab === "startup" ? "Startup Animation" : "Close Animation"}
              </h3>
              <div className="tabs-segmented flex" role="group" aria-label="Animation preview">
                <button
                  type="button"
                  aria-pressed={animationTab === "startup"}
                  onClick={() => setAnimationTab("startup")}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap cursor-pointer",
                    animationTab === "startup"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                  )}
                >
                  Startup
                </button>
                <button
                  type="button"
                  aria-pressed={animationTab === "close"}
                  onClick={() => setAnimationTab("close")}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap cursor-pointer",
                    animationTab === "close"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                  )}
                >
                  Close
                </button>
              </div>
            </div>

            {/* Live Preview Container */}
            <div className="px-4 sm:px-5">
              <div className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-xl border border-border shadow-sm">
                <div
                  className={cn(
                    "aspect-video w-full relative overflow-hidden flex items-center justify-center transition-colors duration-300",
                    activeEffectiveTheme === "dark" ? "bg-[#09090b]" : "bg-white",
                  )}
                >
                  <div
                    className="absolute"
                    style={{
                      width: "1280px",
                      height: "720px",
                      transform: "scale(0.5)",
                    }}
                  >
                    {animationTab === "startup" ? (
                      <SplashScreen
                        key={startupReplayKey}
                        loader={activeStyle}
                        palette={activePalette}
                        theme={activeTheme}
                      />
                    ) : (
                      <CloseScreen
                        key={closeReplayKey}
                        loader={activeStyle}
                        palette={activePalette}
                        theme={activeTheme}
                        phase="closing"
                        onIntroEnd={() => {}}
                      />
                    )}
                  </div>
                </div>
                <div className="bg-muted px-4 py-3 flex items-center justify-between border-t border-border">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground mr-2">Preview Theme:</span>
                    <div className="flex bg-background/80 rounded-md p-1 gap-0.5 shadow-inner border border-black/5 dark:border-white/5">
                      {["system", "dark", "light"].map((t) => (
                        <button
                          key={t}
                          onClick={() => setActiveTheme(t as any)}
                          className={cn(
                            "px-3 py-1 text-xs font-medium rounded transition-colors capitalize cursor-pointer",
                            activeTheme === t
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {t === "system" ? "Auto" : t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs cursor-pointer"
                    onClick={() => {
                      if (animationTab === "startup") {
                        setStartupReplayKey((k) => k + 1);
                        setFullscreenStartupPreview(true);
                      } else {
                        setCloseReplayKey((k) => k + 1);
                        setFullscreenClosePreview(true);
                      }
                    }}
                  >
                    <MonitorPlayIcon className="mr-1.5 size-3" /> Preview Fullscreen
                  </Button>
                </div>
              </div>
            </div>

            <SettingsRow
              title="Style"
              description={`Choose the visual aesthetic for the ${animationTab} animation.`}
              control={
                <div className="tabs-segmented flex" role="group" aria-label="Animation style">
                  {[
                    { value: "glass", label: "Molten Glass" },
                    { value: "solari", label: "Solari Grid" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setActiveStyle(option.value as any)}
                      aria-pressed={activeStyle === option.value}
                      className={cn(
                        "px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap cursor-pointer",
                        activeStyle === option.value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              }
            />

            <SettingsRow
              title="Color palette"
              description={`Choose the color palette for the ${animationTab} animation.`}
              control={
                <div className="tabs-segmented flex" role="group" aria-label="Animation palette">
                  {[
                    { value: "block", label: "Solid Block" },
                    { value: "mono", label: "Monochrome" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setActivePalette(option.value as any)}
                      aria-pressed={activePalette === option.value}
                      className={cn(
                        "px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap cursor-pointer",
                        activePalette === option.value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              }
            />

            {/* Animation Font Combos */}
            <div className="pt-2">
              <div className="px-4 py-2 border-t border-border/40">
                <h4 className="text-sm font-semibold text-foreground">
                  Animation Typography &amp; Font
                </h4>
                <p className="text-xs text-muted-foreground">
                  Select a dedicated font combo for startup and close loader animations.
                </p>
              </div>

              <div className="px-4 py-2 flex items-center gap-2 flex-wrap bg-muted/20">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mr-1">
                  Defaults
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveFontComboId("app-default");
                  }}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-all duration-200 cursor-pointer",
                    activeFontComboId === "app-default"
                      ? "border-primary bg-primary/10 text-primary shadow-[0_0_10px_hsl(var(--primary)/0.2)]"
                      : "border-border/70 bg-card text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {activeFontComboId === "app-default" && (
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
                  App Theme Font
                  <span className="text-[8px] font-bold tracking-widest px-1 py-0.5 rounded border border-primary/30 text-primary/70 bg-primary/5">
                    DEFAULT
                  </span>
                </button>

                {FONT_COMBOS.filter((c) => c.isNeutral).map((combo) => {
                  const isActive = activeFontComboId === combo.id;
                  return (
                    <button
                      key={combo.id}
                      type="button"
                      onClick={() => {
                        setActiveFontComboId(combo.id);
                      }}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-all duration-200 cursor-pointer",
                        isActive
                          ? "border-primary bg-primary/10 text-primary shadow-[0_0_10px_hsl(var(--primary)/0.2)]"
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
                            ? "border-primary/30 text-primary/70 bg-primary/5"
                            : "border-border/50 text-muted-foreground/50",
                        )}
                      >
                        {combo.tag}
                      </span>
                    </button>
                  );
                })}
              </div>

              {activeFontComboId === "custom" && (
                <div className="px-4 py-3.5 bg-muted/30 border-y border-border/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="text-xs font-semibold text-foreground">
                        Custom Animation Display Font
                      </h5>
                      <p className="text-[10px] text-muted-foreground">
                        Select a custom typography font for startup and close loader animations.
                      </p>
                    </div>
                    <span className="text-[9px] font-bold tracking-widest px-2 py-0.5 rounded border border-primary/30 text-primary bg-primary/5 uppercase">
                      CUSTOM
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5 rounded-lg border border-border/60 bg-card p-3">
                      <label className="text-xs font-semibold text-foreground block">
                        Animation Display Font
                      </label>
                      <p className="text-[10px] text-muted-foreground line-clamp-1">
                        Main title, Solari cards &amp; status messages
                      </p>
                      <Select
                        value={activeCustomFont}
                        onValueChange={(val) => {
                          if (!val) return;
                          setActiveCustomFont(val);
                        }}
                      >
                        <SelectTrigger className="w-full text-xs rounded-lg bg-background border-border/80">
                          <SelectValue placeholder="Select Display Font" />
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

                    <div className="space-y-1.5 rounded-lg border border-border/60 bg-card p-3">
                      <label className="text-xs font-semibold text-foreground block">
                        Quick Display Picks
                      </label>
                      <p className="text-[10px] text-muted-foreground line-clamp-1">
                        One-click font presets for splash loader
                      </p>
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {[
                          {
                            name: "Syne",
                            font: "'Syne', sans-serif",
                          },
                          {
                            name: "Unbounded",
                            font: "'Unbounded', sans-serif",
                          },
                          {
                            name: "Outfit",
                            font: "'Outfit', sans-serif",
                          },
                          {
                            name: "Space Grotesk",
                            font: "'Space Grotesk', sans-serif",
                          },
                          {
                            name: "JetBrains Mono",
                            font: "'JetBrains Mono', monospace",
                          },
                        ].map((preset) => (
                          <button
                            key={preset.name}
                            type="button"
                            onClick={() => {
                              setActiveCustomFont(preset.font);
                            }}
                            className={cn(
                              "px-2 py-1 text-[10px] font-semibold rounded border transition-all cursor-pointer",
                              activeCustomFont === preset.font
                                ? "border-primary bg-primary text-primary-foreground shadow-xs"
                                : "border-border/60 bg-background text-muted-foreground hover:text-foreground hover:border-border",
                            )}
                            style={{ fontFamily: preset.font }}
                          >
                            {preset.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 border-t border-border/40">
                {FONT_COMBOS.filter((c) => !c.isNeutral).map((combo) => {
                  const isActive = activeFontComboId === combo.id;
                  return (
                    <button
                      key={combo.id}
                      type="button"
                      onClick={() => {
                        setActiveFontComboId(combo.id);
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
                          className={cn("text-[26px] leading-none", combo.sansClass)}
                          style={{
                            fontFamily: combo.uiFont !== "custom" ? combo.uiFont : undefined,
                          }}
                        >
                          {combo.sansText}
                        </span>
                        <span
                          className={cn("text-[26px] leading-none", combo.serifClass)}
                          style={{
                            fontFamily:
                              combo.headingFont !== "custom" ? combo.headingFont : undefined,
                          }}
                        >
                          {combo.serifText}
                        </span>
                        {"sansText2" in combo && combo.sansText2 ? (
                          <span
                            className={cn("text-[26px] leading-none block", combo.sansClass)}
                            style={{
                              fontFamily: combo.uiFont !== "custom" ? combo.uiFont : undefined,
                            }}
                          >
                            {combo.sansText2}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-auto w-full pt-1 border-t border-border/30 flex items-center justify-between">
                        <div>
                          <div
                            className={cn(
                              "text-xs font-bold leading-tight",
                              isActive ? "text-primary" : "text-foreground",
                            )}
                          >
                            {combo.name}
                          </div>
                          <div className="text-[10px] text-muted-foreground/70 leading-tight">
                            {combo.desc}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border uppercase tracking-wider shrink-0 ml-1",
                            isActive
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border/60 bg-muted/40 text-muted-foreground",
                          )}
                        >
                          {combo.tag}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {isAnimationsDirty && (
            <div className="flex justify-end p-4 sm:p-5 border-t border-border">
              <Button
                onClick={() => {
                  updateSettings({
                    splashLoaderStyle: previewStyle,
                    splashLoaderPalette: previewPalette,
                    splashLoaderTheme: previewTheme,
                    closeLoaderStyle: closePreviewStyle,
                    closeLoaderPalette: closePreviewPalette,
                    closeLoaderTheme: closePreviewTheme,
                  });
                  try {
                    window.localStorage?.setItem(
                      "tabs.startupAnimationFontComboId",
                      previewStartupAnimationFontComboId,
                    );
                    window.localStorage?.setItem(
                      "tabs.startupCustomAnimationFont",
                      previewStartupCustomAnimationFont,
                    );
                    window.localStorage?.setItem(
                      "tabs.closeAnimationFontComboId",
                      previewCloseAnimationFontComboId,
                    );
                    window.localStorage?.setItem(
                      "tabs.closeCustomAnimationFont",
                      previewCloseCustomAnimationFont,
                    );
                    window.localStorage?.setItem(
                      "tabs.animationFontComboId",
                      previewStartupAnimationFontComboId,
                    );
                    window.localStorage?.setItem(
                      "tabs.customAnimationFont",
                      previewStartupCustomAnimationFont,
                    );
                  } catch {}
                  setSavedStartupAnimationFontComboId(previewStartupAnimationFontComboId);
                  setSavedStartupCustomAnimationFont(previewStartupCustomAnimationFont);
                  setSavedCloseAnimationFontComboId(previewCloseAnimationFontComboId);
                  setSavedCloseCustomAnimationFont(previewCloseCustomAnimationFont);
                  toastManager.add({
                    type: "success",
                    title: "Settings Saved",
                    description: "Animation settings and font preferences updated.",
                  });
                }}
                className="gap-2 cursor-pointer"
              >
                <SaveIcon className="size-4" />
                Save Settings
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-5 pt-4 sm:pt-5 border-t border-border">
            <h3 className="px-4 sm:px-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Interface
            </h3>
            <SettingsRow
              title="Slider animations"
              description="Smoothly animate the model picker's reasoning-effort slider."
              resetAction={
                settings.sliderAnimationsEnabled !==
                DEFAULT_UNIFIED_SETTINGS.sliderAnimationsEnabled ? (
                  <SettingResetButton
                    label="slider animations"
                    onClick={() =>
                      updateSettings({
                        sliderAnimationsEnabled: DEFAULT_UNIFIED_SETTINGS.sliderAnimationsEnabled,
                      })
                    }
                  />
                ) : null
              }
              control={
                <Switch
                  checked={settings.sliderAnimationsEnabled}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      sliderAnimationsEnabled: Boolean(checked),
                    })
                  }
                  aria-label="Slider animations"
                />
              }
            />

            <SettingsRow
              title="Animated slider fill"
              description="Smoothly animate the fill color of sliders when value changes."
              resetAction={
                settings.animatedTrackFillEnabled !==
                DEFAULT_UNIFIED_SETTINGS.animatedTrackFillEnabled ? (
                  <SettingResetButton
                    label="animated slider fill"
                    onClick={() =>
                      updateSettings({
                        animatedTrackFillEnabled: DEFAULT_UNIFIED_SETTINGS.animatedTrackFillEnabled,
                      })
                    }
                  />
                ) : null
              }
              control={
                <Switch
                  checked={settings.animatedTrackFillEnabled}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      animatedTrackFillEnabled: Boolean(checked),
                    })
                  }
                  aria-label="Animated slider fill"
                />
              }
            />

            <SettingsRow
              title="Nyan Cat slider"
              description="Always use the Nyan Cat animated rainbow slider across all models."
              resetAction={
                settings.nyanCatSliderMode !== DEFAULT_UNIFIED_SETTINGS.nyanCatSliderMode ? (
                  <SettingResetButton
                    label="Nyan Cat slider"
                    onClick={() =>
                      updateSettings({
                        nyanCatSliderMode: DEFAULT_UNIFIED_SETTINGS.nyanCatSliderMode,
                      })
                    }
                  />
                ) : null
              }
              control={
                <Switch
                  checked={settings.nyanCatSliderMode}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      nyanCatSliderMode: Boolean(checked),
                    })
                  }
                  aria-label="Nyan Cat slider"
                />
              }
            />
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

export default AnimationsSettings;
