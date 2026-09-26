import { useCallback, useEffect, useSyncExternalStore } from "react";
import { evaluateThemeTokens } from "@tabs/shared/themeDerivation";
import {
  DEFAULT_CUSTOM_THEME,
  DEFAULT_FONT_PREFERENCES,
  DEFAULT_THEME_ID,
  THEME_DEFINITIONS,
  getOptimalPrimaryForeground,
  type CustomThemeConfig,
  type FontPreferences,
  type ThemeId,
  type ThemePreference,
} from "../lib/themes";
import type { EnvironmentTheme } from "@tabs/contracts";

type ThemeSnapshot = {
  theme: ThemePreference;
  systemDark: boolean;
  revision: number;
};

const STORAGE_KEY = "tabs:theme";
const CUSTOM_STORAGE_KEY = "tabs:custom-theme";
const FONT_PREFERENCES_STORAGE_KEY = "tabs:font-preferences";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;
let themeRevision = 0;
let lastDesktopTheme: string | null = null;
let previewThemeSyncTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPreviewThemeSync: {
  readonly themeId: string;
  readonly preference: ThemePreference;
  readonly customConfig?: CustomThemeConfig;
  readonly fontPreferences: FontPreferences;
} | null = null;
let transitionCleanupFrame: number | null = null;
let environmentThemes: ReadonlyArray<EnvironmentTheme> = [];

export function setEnvironmentThemes(next: ReadonlyArray<EnvironmentTheme>) {
  if (JSON.stringify(environmentThemes) === JSON.stringify(next)) return;
  environmentThemes = next;
  if (getStoredPreference().startsWith("environment:")) applyTheme(getStoredPreference(), true);
  emitChange();
}

function emitChange() {
  themeRevision += 1;
  lastSnapshot = null;
  for (const listener of listeners) listener();
}

function getSystemDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(MEDIA_QUERY).matches;
}

export function getStoredDiffColorScheme(): "red-green" | "blue-orange" {
  if (typeof document !== "undefined" && document.documentElement?.dataset?.diffColorScheme) {
    const ds = document.documentElement.dataset.diffColorScheme;
    if (ds === "blue-orange" || ds === "red-green") return ds;
  }
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem("tabs:client-settings:v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.diffColorScheme === "blue-orange" || parsed?.diffColorScheme === "red-green") {
          return parsed.diffColorScheme;
        }
      }
    }
  } catch {}
  return "red-green";
}

export function refreshTheme() {
  applyTheme(getStoredPreference(), false);
}

export function getStoredFontPreferences(): FontPreferences {
  try {
    if (typeof localStorage !== "undefined") {
      const clientSettingsRaw = localStorage.getItem("tabs:client-settings:v1");
      const clientFontSettings: Partial<FontPreferences> = {};
      if (clientSettingsRaw) {
        try {
          const parsed = JSON.parse(clientSettingsRaw);
          if (parsed) {
            if (parsed.fontFamilySans) clientFontSettings.uiFont = parsed.fontFamilySans;
            if (parsed.fontFamilyCode) clientFontSettings.editorFont = parsed.fontFamilyCode;
            if (typeof parsed.fontSizeInterface === "number")
              clientFontSettings.fontSizeInterface = parsed.fontSizeInterface;
            if (typeof parsed.fontSizeCode === "number")
              clientFontSettings.fontSizeCode = parsed.fontSizeCode;
            if (typeof parsed.fontSizePrompt === "number")
              clientFontSettings.fontSizePrompt = parsed.fontSizePrompt;
          }
        } catch {}
      }

      const raw = localStorage.getItem(FONT_PREFERENCES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          return {
            uiFont: clientFontSettings.uiFont || parsed.uiFont || DEFAULT_FONT_PREFERENCES.uiFont,
            headingFont:
              parsed.headingFont ||
              clientFontSettings.uiFont ||
              parsed.uiFont ||
              DEFAULT_FONT_PREFERENCES.headingFont,
            editorFont:
              clientFontSettings.editorFont ||
              parsed.editorFont ||
              DEFAULT_FONT_PREFERENCES.editorFont,
            fontSizeInterface:
              clientFontSettings.fontSizeInterface ??
              parsed.fontSizeInterface ??
              DEFAULT_FONT_PREFERENCES.fontSizeInterface,
            fontSizeCode:
              clientFontSettings.fontSizeCode ??
              parsed.fontSizeCode ??
              DEFAULT_FONT_PREFERENCES.fontSizeCode,
            fontSizePrompt:
              clientFontSettings.fontSizePrompt ??
              parsed.fontSizePrompt ??
              DEFAULT_FONT_PREFERENCES.fontSizePrompt,
          };
        }
      }

      if (Object.keys(clientFontSettings).length > 0) {
        return {
          uiFont: clientFontSettings.uiFont || DEFAULT_FONT_PREFERENCES.uiFont,
          headingFont: clientFontSettings.uiFont || DEFAULT_FONT_PREFERENCES.headingFont,
          editorFont: clientFontSettings.editorFont || DEFAULT_FONT_PREFERENCES.editorFont,
          fontSizeInterface:
            clientFontSettings.fontSizeInterface ?? DEFAULT_FONT_PREFERENCES.fontSizeInterface,
          fontSizeCode: clientFontSettings.fontSizeCode ?? DEFAULT_FONT_PREFERENCES.fontSizeCode,
          fontSizePrompt:
            clientFontSettings.fontSizePrompt ?? DEFAULT_FONT_PREFERENCES.fontSizePrompt,
        };
      }
    }
    const customConfig = getStoredCustomThemeConfig();
    if (customConfig && customConfig.fonts) {
      return {
        uiFont: customConfig.fonts.uiFont || DEFAULT_FONT_PREFERENCES.uiFont,
        headingFont: customConfig.fonts.uiFont || DEFAULT_FONT_PREFERENCES.headingFont,
        editorFont: customConfig.fonts.editorFont || DEFAULT_FONT_PREFERENCES.editorFont,
        fontSizeInterface: DEFAULT_FONT_PREFERENCES.fontSizeInterface,
        fontSizeCode: DEFAULT_FONT_PREFERENCES.fontSizeCode,
        fontSizePrompt: DEFAULT_FONT_PREFERENCES.fontSizePrompt,
      };
    }
  } catch (err) {
    // Ignore JSON errors
  }
  return DEFAULT_FONT_PREFERENCES;
}

export function getStoredCustomThemeConfig(): CustomThemeConfig {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_CUSTOM_THEME;
    const raw = localStorage.getItem(CUSTOM_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.colors && parsed.fonts) {
        return {
          baseVariant: parsed.baseVariant === "light" ? "light" : "dark",
          colors: {
            background: parsed.colors.background || DEFAULT_CUSTOM_THEME.colors.background,
            foreground: parsed.colors.foreground || DEFAULT_CUSTOM_THEME.colors.foreground,
            card: parsed.colors.card || DEFAULT_CUSTOM_THEME.colors.card,
            border: parsed.colors.border || DEFAULT_CUSTOM_THEME.colors.border,
            primary: parsed.colors.primary || DEFAULT_CUSTOM_THEME.colors.primary,
          },
          fonts: {
            uiFont: parsed.fonts.uiFont || DEFAULT_CUSTOM_THEME.fonts.uiFont,
            editorFont: parsed.fonts.editorFont || DEFAULT_CUSTOM_THEME.fonts.editorFont,
          },
        };
      }
    }
  } catch (err) {
    // Ignore JSON errors
  }
  return DEFAULT_CUSTOM_THEME;
}

function getStoredPreference(): ThemePreference {
  if (typeof localStorage === "undefined") return "system";
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return "system";
  if (raw === "system") return "system";
  if (raw === "light") return "tabs-light";
  if (raw === "dark") return "tabs-dark";
  if (raw === "custom" || raw in THEME_DEFINITIONS) return raw as ThemeId;
  if (raw.startsWith("environment:") && raw.length > "environment:".length) {
    return raw as ThemePreference;
  }
  return "system";
}

export function resolveActiveThemeId(preference: ThemePreference): ThemePreference {
  if (preference === "system") {
    return getSystemDark() ? "tabs-dark" : "tabs-light";
  }
  if (preference === "custom" || preference in THEME_DEFINITIONS) {
    return preference;
  }
  if (preference.startsWith("environment:")) return preference;
  return DEFAULT_THEME_ID;
}

/**
 * Applies the interface text preference without changing the root rem unit.
 * Tailwind expresses both typography and layout in rem, so assigning a 13px
 * font size to `<html>` silently scales the entire application to 81.25%.
 */
export function applyInterfaceFontSize(style: CSSStyleDeclaration, size: number): void {
  style.setProperty("--font-size-interface", `${size}px`);
  style.removeProperty("font-size");
}

export type ThemeSnapshotState = {
  readonly theme: ThemePreference;
  readonly customConfig: CustomThemeConfig;
  readonly fontPreferences: FontPreferences;
};

export function snapshotThemeState(): ThemeSnapshotState {
  return {
    theme: getStoredPreference(),
    customConfig: getStoredCustomThemeConfig(),
    fontPreferences: getStoredFontPreferences(),
  };
}

export function previewTheme(
  preference: ThemePreference,
  customConfig?: CustomThemeConfig,
  fontPreferences?: FontPreferences,
): void {
  applyTheme(preference, true, customConfig, fontPreferences, {
    deferDesktopSync: true,
    dispatchResize: false,
  });
}

export function restoreThemeSnapshot(snapshot: ThemeSnapshotState): void {
  applyTheme(snapshot.theme, true, snapshot.customConfig, snapshot.fontPreferences);
}

export function commitCustomTheme(
  config: CustomThemeConfig,
  fontPreferences?: FontPreferences,
): void {
  const previousCustomTheme = localStorage.getItem(CUSTOM_STORAGE_KEY);
  const previousFontPreferences = localStorage.getItem(FONT_PREFERENCES_STORAGE_KEY);
  const previousTheme = localStorage.getItem(STORAGE_KEY);

  try {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(config));
    if (fontPreferences) {
      localStorage.setItem(FONT_PREFERENCES_STORAGE_KEY, JSON.stringify(fontPreferences));
    }
    localStorage.setItem(STORAGE_KEY, "custom");
  } catch (error) {
    const restoreItem = (key: string, previousValue: string | null) => {
      if (previousValue === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, previousValue);
      }
    };
    restoreItem(CUSTOM_STORAGE_KEY, previousCustomTheme);
    restoreItem(FONT_PREFERENCES_STORAGE_KEY, previousFontPreferences);
    restoreItem(STORAGE_KEY, previousTheme);
    throw error;
  }

  applyTheme("custom", true, config, fontPreferences);
  emitChange();
}

function applyTheme(
  preference: ThemePreference,
  suppressTransitions = false,
  customConfigOverride?: CustomThemeConfig,
  fontPreferencesOverride?: FontPreferences,
  options: { readonly deferDesktopSync?: boolean; readonly dispatchResize?: boolean } = {},
) {
  if (suppressTransitions) {
    document.documentElement.classList.add("no-transitions");
  }

  const fonts = fontPreferencesOverride ?? getStoredFontPreferences();
  applyFontPreferencesToDom(fonts);

  const activeThemeId = resolveActiveThemeId(preference);

  let config: CustomThemeConfig;
  if (activeThemeId.startsWith("environment:")) {
    const published = environmentThemes.find((item) => `environment:${item.id}` === activeThemeId);
    const fallback =
      published?.appearance === "light"
        ? THEME_DEFINITIONS["tabs-light"]
        : THEME_DEFINITIONS["tabs-dark"];
    const colors = published?.colors ?? {};
    config = {
      baseVariant: published?.appearance ?? fallback.baseVariant,
      colors: {
        background: colors.background ?? published?.canvas ?? fallback.colors.background,
        foreground: colors.foreground ?? fallback.colors.foreground,
        card: colors.card ?? colors.cardBackground ?? fallback.colors.card,
        border: colors.border ?? fallback.colors.border,
        primary: colors.primary ?? published?.accent ?? fallback.colors.primary,
      },
      fonts,
    };
  } else if (activeThemeId === "custom") {
    config = customConfigOverride ?? getStoredCustomThemeConfig();
  } else {
    const def = THEME_DEFINITIONS[activeThemeId as ThemeId] ?? THEME_DEFINITIONS[DEFAULT_THEME_ID];
    config = {
      baseVariant: def.baseVariant,
      colors: {
        background: def.colors.background,
        foreground: def.colors.foreground,
        card: def.colors.card,
        border: def.colors.border,
        primary: def.colors.primary,
      },
      fonts: getStoredFontPreferences(),
    };
  }

  const isDark = config.baseVariant === "dark";
  const diffColorScheme = getStoredDiffColorScheme();
  const evaluatedTokens = evaluateThemeTokens(config, diffColorScheme);

  const background = evaluatedTokens["editor.background"] || config.colors.background;
  const cardBg = evaluatedTokens["app.cardBackground"] || config.colors.card;
  const cardFg = evaluatedTokens["app.cardForeground"] || config.colors.foreground;
  const foreground = evaluatedTokens["foreground"] || config.colors.foreground;
  const border = evaluatedTokens["sideBar.border"] || config.colors.border;
  const primary = evaluatedTokens["app.primaryBackground"] || config.colors.primary;
  const primaryFg =
    evaluatedTokens["app.primaryForeground"] || getOptimalPrimaryForeground(primary);

  const secondaryBg = evaluatedTokens["app.secondaryBackground"] || cardBg;
  const secondaryFg = evaluatedTokens["app.secondaryForeground"] || foreground;
  const accentBg = evaluatedTokens["app.accentBackground"] || cardBg;
  const accentFg = evaluatedTokens["app.accentForeground"] || foreground;
  const popoverBg = evaluatedTokens["app.popoverBackground"] || cardBg;
  const popoverFg = evaluatedTokens["app.popoverForeground"] || foreground;
  const mutedBg = evaluatedTokens["app.mutedBackground"] || cardBg;
  const mutedFg = evaluatedTokens["app.mutedForeground"] || foreground;
  const destructiveBg = evaluatedTokens["app.destructiveBackground"] || "#dc2626";
  const destructiveFg = evaluatedTokens["app.destructiveForeground"] || "#ffffff";

  document.documentElement?.classList?.toggle("dark", isDark);
  document.documentElement?.setAttribute?.("data-theme", activeThemeId);

  const style = document.documentElement?.style;
  if (style) {
    const accentWashBg = `color-mix(in srgb, ${primary} 12%, transparent)`;
    const accentWashBorder = `color-mix(in srgb, ${primary} 32%, transparent)`;

    // App shell core tokens
    style.setProperty("--background", background);
    style.setProperty("--app-chrome-background", background);
    style.setProperty("--foreground", foreground);
    style.setProperty("--card", cardBg);
    style.setProperty("--card-foreground", cardFg);
    style.setProperty("--popover", popoverBg);
    style.setProperty("--popover-foreground", popoverFg);
    style.setProperty("--muted", mutedBg);
    style.setProperty("--muted-foreground", mutedFg);
    style.setProperty("--secondary", secondaryBg);
    style.setProperty("--secondary-foreground", secondaryFg);
    style.setProperty("--accent", accentBg);
    style.setProperty("--accent-foreground", accentFg);
    style.setProperty("--border", border);
    style.setProperty("--input", border);
    style.setProperty("--ring", primary);
    style.setProperty("--primary", primary);
    style.setProperty("--primary-foreground", primaryFg);
    style.setProperty("--destructive", destructiveBg);
    style.setProperty("--destructive-foreground", destructiveFg);
    style.setProperty("--accent-wash-bg", accentWashBg);
    style.setProperty("--accent-wash-border", accentWashBorder);

    // Inject all evaluated token variables onto root style so components can read them
    Object.entries(evaluatedTokens).forEach(([key, val]) => {
      const cssVarName = `--vscode-${key.replace(/\./g, "-")}`;
      style.setProperty(cssVarName, val);
    });

    // Text opacity scale
    [90, 80, 60, 50, 40, 30, 20, 10].forEach((pct) => {
      style.setProperty(`--fg-${pct}`, `color-mix(in srgb, ${foreground} ${pct}%, transparent)`);
    });

    // Sidebar tokens
    style.setProperty("--sidebar-background", cardBg);
    style.setProperty("--sidebar-foreground", foreground);
    style.setProperty("--sidebar-border", border);
    style.setProperty("--sidebar-accent", accentBg);
    style.setProperty("--sidebar-accent-foreground", accentFg);
    style.setProperty("--sidebar-primary", primary);
    style.setProperty("--sidebar-primary-foreground", primaryFg);

    // Code-OSS tokens
    style.setProperty("--tabs-bg", background);
    style.setProperty("--tabs-bg-sidebar", cardBg);
    style.setProperty("--tabs-bg-elevated", cardBg);
    style.setProperty("--tabs-bg-popover", popoverBg);
    style.setProperty("--tabs-input-bg", cardBg);
    style.setProperty("--tabs-text", foreground);
    style.setProperty("--tabs-text-muted", mutedFg);
    style.setProperty("--tabs-accent", primary);
    style.setProperty("--tabs-accent-strong", primary);
    style.setProperty("--tabs-accent-soft", `color-mix(in srgb, ${primary} 15%, transparent)`);

    style.setProperty("--code-oss-bg", background);
    style.setProperty("--code-oss-bg-sidebar", cardBg);
    style.setProperty("--code-oss-bg-elevated", cardBg);
    style.setProperty("--code-oss-bg-popover", popoverBg);
    style.setProperty("--code-oss-input-bg", cardBg);
    style.setProperty("--code-oss-text", foreground);
    style.setProperty("--code-oss-text-muted", mutedFg);
    style.setProperty("--code-oss-accent", primary);
  }

  const desktopConfig =
    activeThemeId === "custom" || activeThemeId.startsWith("environment:") ? config : undefined;
  if (options.deferDesktopSync) {
    schedulePreviewDesktopThemeSync(activeThemeId, preference, desktopConfig, fonts);
  } else {
    cancelPreviewDesktopThemeSync();
    syncDesktopTheme(activeThemeId, preference, desktopConfig, fonts);
  }

  if (
    options.dispatchResize !== false &&
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    window.dispatchEvent(new Event("resize"));
  }

  if (suppressTransitions && typeof document !== "undefined" && document.documentElement) {
    scheduleTransitionCleanup();
  }
}

function applyFontPreferencesToDom(fonts: FontPreferences): void {
  const style = document.documentElement?.style;
  if (!style) return;

  style.setProperty("--font-sans", fonts.uiFont);
  style.setProperty("--font-display", fonts.headingFont || fonts.uiFont);
  style.setProperty("--font-mono", fonts.editorFont);
  if (typeof fonts.fontSizeInterface === "number") {
    applyInterfaceFontSize(style, fonts.fontSizeInterface);
  }
  if (typeof fonts.fontSizeCode === "number") {
    style.setProperty("--font-size-code", `${fonts.fontSizeCode}px`);
    style.setProperty("--diffs-font-size", `${fonts.fontSizeCode}px`);
  }
  if (typeof fonts.fontSizePrompt === "number") {
    style.setProperty("--font-size-prompt", `${fonts.fontSizePrompt}px`);
  }
}

function scheduleTransitionCleanup(): void {
  if (typeof requestAnimationFrame !== "function") {
    setTimeout(() => document.documentElement?.classList.remove("no-transitions"), 0);
    return;
  }

  if (transitionCleanupFrame !== null) cancelAnimationFrame(transitionCleanupFrame);
  transitionCleanupFrame = requestAnimationFrame(() => {
    transitionCleanupFrame = requestAnimationFrame(() => {
      transitionCleanupFrame = null;
      document.documentElement?.classList.remove("no-transitions");
    });
  });
}

function schedulePreviewDesktopThemeSync(
  themeId: string,
  preference: ThemePreference,
  customConfig: CustomThemeConfig | undefined,
  fontPreferences: FontPreferences,
): void {
  queuedPreviewThemeSync = {
    themeId,
    preference,
    ...(customConfig ? { customConfig } : {}),
    fontPreferences,
  };
  if (previewThemeSyncTimer !== null) return;

  previewThemeSyncTimer = setTimeout(() => {
    previewThemeSyncTimer = null;
    flushPreviewDesktopThemeSync();
  }, 120);
}

function flushPreviewDesktopThemeSync(): void {
  if (previewThemeSyncTimer !== null) {
    clearTimeout(previewThemeSyncTimer);
    previewThemeSyncTimer = null;
  }
  const queued = queuedPreviewThemeSync;
  queuedPreviewThemeSync = null;
  if (!queued) return;
  syncDesktopTheme(queued.themeId, queued.preference, queued.customConfig, queued.fontPreferences);
}

function cancelPreviewDesktopThemeSync(): void {
  if (previewThemeSyncTimer !== null) {
    clearTimeout(previewThemeSyncTimer);
    previewThemeSyncTimer = null;
  }
  queuedPreviewThemeSync = null;
}

function syncDesktopTheme(
  themeId: string,
  preference: ThemePreference,
  customConfig?: CustomThemeConfig,
  fontPreferences?: FontPreferences,
) {
  const bridge = window.desktopBridge;
  if (!bridge) {
    return;
  }

  const fonts = fontPreferences ?? getStoredFontPreferences();
  const diffColorScheme = getStoredDiffColorScheme();
  const enhancedConfig = customConfig ? { ...customConfig, diffColorScheme } : undefined;
  const payload = {
    themeId,
    preference,
    diffColorScheme,
    fontPreferences: fonts,
    ...((themeId === "custom" || themeId.startsWith("environment:")) && enhancedConfig
      ? { customConfig: enhancedConfig }
      : {}),
  };
  lastDesktopTheme = themeId;
  void bridge.setTheme(payload as any).catch(() => {
    if (lastDesktopTheme === themeId) {
      lastDesktopTheme = null;
    }
  });
}

// Apply immediately on module load to prevent flash
if (typeof window !== "undefined") {
  applyTheme(getStoredPreference());
}

/**
 * Builds a FontPreferences object from a CustomThemeConfig's font block,
 * merging with the current stored preferences to preserve size settings.
 * Call this after importing a theme to sync the font state into localStorage.
 */
export function buildFontPreferencesFromThemeConfig(config: CustomThemeConfig): FontPreferences {
  const current = getStoredFontPreferences();
  return {
    uiFont: config.fonts.uiFont || current.uiFont,
    headingFont: config.fonts.headingFont || config.fonts.uiFont || current.headingFont,
    editorFont: config.fonts.editorFont || current.editorFont,
    fontSizeInterface: current.fontSizeInterface,
    fontSizeCode: current.fontSizeCode,
    fontSizePrompt: current.fontSizePrompt,
  };
}

function getSnapshot(): ThemeSnapshot {
  const theme = getStoredPreference();
  const systemDark = theme === "system" ? getSystemDark() : false;

  if (
    lastSnapshot &&
    lastSnapshot.theme === theme &&
    lastSnapshot.systemDark === systemDark &&
    lastSnapshot.revision === themeRevision
  ) {
    return lastSnapshot;
  }

  lastSnapshot = { theme, systemDark, revision: themeRevision };
  return lastSnapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener);

  if (typeof window === "undefined") {
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }

  // Listen for system preference changes
  const mq = typeof window.matchMedia === "function" ? window.matchMedia(MEDIA_QUERY) : null;
  const handleChange = () => {
    if (getStoredPreference() === "system") applyTheme("system", true);
    emitChange();
  };
  mq?.addEventListener?.("change", handleChange);

  // Listen for storage changes from other tabs
  const handleStorage = (e: StorageEvent) => {
    if (
      e.key === STORAGE_KEY ||
      e.key === CUSTOM_STORAGE_KEY ||
      e.key === FONT_PREFERENCES_STORAGE_KEY
    ) {
      applyTheme(getStoredPreference(), true);
      emitChange();
    }
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    listeners = listeners.filter((l) => l !== listener);
    mq?.removeEventListener?.("change", handleChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const theme = snapshot.theme;

  const activeThemeId = resolveActiveThemeId(theme);
  const customConfig = getStoredCustomThemeConfig();
  const themeDef = activeThemeId.startsWith("environment:")
    ? undefined
    : THEME_DEFINITIONS[activeThemeId as ThemeId];
  const resolvedTheme: "light" | "dark" = activeThemeId.startsWith("environment:")
    ? (environmentThemes.find((item) => `environment:${item.id}` === activeThemeId)?.appearance ??
      "dark")
    : activeThemeId === "custom"
      ? customConfig.baseVariant
      : (themeDef?.baseVariant ?? (getSystemDark() ? "dark" : "light"));

  const setTheme = useCallback((next: ThemePreference | "light" | "dark") => {
    const normalized: ThemePreference =
      next === "light" ? "tabs-light" : next === "dark" ? "tabs-dark" : next;
    localStorage.setItem(STORAGE_KEY, normalized);
    applyTheme(normalized, true);
    emitChange();
  }, []);

  const setCustomThemeConfig = useCallback((config: CustomThemeConfig) => {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(config));
    applyTheme("custom", true, config);
    emitChange();
  }, []);

  const setFontPreferences = useCallback(
    (next: FontPreferences | ((prev: FontPreferences) => FontPreferences)) => {
      const current = getStoredFontPreferences();
      const updated = typeof next === "function" ? next(current) : next;
      localStorage.setItem(FONT_PREFERENCES_STORAGE_KEY, JSON.stringify(updated));
      applyFontPreferencesToDom(updated);
      emitChange();
    },
    [],
  );

  // Keep DOM in sync on mount/change
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return {
    theme,
    setTheme,
    activeThemeId,
    themeDef,
    resolvedTheme,
    customThemeConfig: getStoredCustomThemeConfig(),
    setCustomThemeConfig,
    fontPreferences: getStoredFontPreferences(),
    setFontPreferences,
  } as const;
}
