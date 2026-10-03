import {
  type CustomThemeColors,
  type CustomThemeConfig,
  calculateLuminance,
  ensureMinContrast,
  toHexColor,
} from "./themeDerivation.ts";

export const MAX_THEME_FILE_BYTES = 256 * 1024; // 256 KB safety limit

export const DEFAULT_FALLBACK_DARK: CustomThemeConfig = {
  baseVariant: "dark",
  colors: {
    background: "#141414",
    card: "#181818",
    foreground: "#f5f5f5",
    border: "rgba(255, 255, 255, 0.08)",
    primary: "#366ffb",
  },
  fonts: {
    uiFont: "system-ui",
    editorFont: "monospace",
  },
};

export const DEFAULT_FALLBACK_LIGHT: CustomThemeConfig = {
  baseVariant: "light",
  colors: {
    background: "#ffffff",
    card: "#f6f6f6",
    foreground: "#262626",
    border: "rgba(0, 0, 0, 0.08)",
    primary: "#2563eb",
  },
  fonts: {
    uiFont: "system-ui",
    editorFont: "monospace",
  },
};

type RgbaColor = { r: number; g: number; b: number; a: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Converts #RGB, #RGBA, #RRGGBB, #RRGGBBAA or rgba(...) into RGBA components */
export function parseColor(color: unknown): RgbaColor | null {
  if (typeof color !== "string") return null;
  const str = color.trim();
  if (str === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  if (str.startsWith("#")) {
    const hex = str.slice(1);
    if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
    const expand = (c: string) => Number.parseInt(c + c, 16);
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: expand(hex[0]!),
        g: expand(hex[1]!),
        b: expand(hex[2]!),
        a: hex.length === 4 ? expand(hex[3]!) / 255 : 1,
      };
    }
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }

  const rgbaMatch = str.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i,
  );
  if (rgbaMatch) {
    const r = Math.max(0, Math.min(255, Number.parseInt(rgbaMatch[1]!, 10)));
    const g = Math.max(0, Math.min(255, Number.parseInt(rgbaMatch[2]!, 10)));
    const b = Math.max(0, Math.min(255, Number.parseInt(rgbaMatch[3]!, 10)));
    const a =
      rgbaMatch[4] !== undefined ? Math.max(0, Math.min(1, Number.parseFloat(rgbaMatch[4]))) : 1;
    return { r, g, b, a };
  }

  return null;
}

/** Composites a semi-transparent color over an opaque base */
export function flattenOver(color: RgbaColor, base: RgbaColor): string {
  if (color.a >= 1) {
    const hex = (n: number) =>
      Math.max(0, Math.min(255, Math.round(n)))
        .toString(16)
        .padStart(2, "0");
    return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
  }
  const r = Math.round(color.r * color.a + base.r * (1 - color.a));
  const g = Math.round(color.g * color.a + base.g * (1 - color.a));
  const b = Math.round(color.b * color.a + base.b * (1 - color.a));
  const hex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function toHex(color: RgbaColor): string {
  const hex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

/** Humanizes a theme slug or filename */
export function humanizeThemeName(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/\.json$/i, "")
    .replace(/-color-theme$/i, "");
  if (/\s/.test(trimmed) || !/[-_.]/.test(trimmed)) {
    return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "Custom Theme";
  }
  return trimmed
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Recognizes a VS Code theme file by workbench keys with dots or tokenColors */
export function isVsCodeThemeFile(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.schema === "tabs:custom-theme:v1") return false;
  const colors = isRecord(value.colors) ? value.colors : {};
  const hasWorkbenchKeys = Object.keys(colors).some((k) => k.includes("."));
  return hasWorkbenchKeys || Array.isArray(value.tokenColors);
}

/** Resolves theme variant (light vs dark) from type or background luminance */
export function resolveThemeVariant(
  value: Record<string, unknown>,
  backgroundHex: string,
): "dark" | "light" {
  const type = typeof value.type === "string" ? value.type.toLowerCase() : null;
  if (type === "light" || type === "hc-light") return "light";
  if (type === "dark" || type === "hc-black") return "dark";
  const lum = calculateLuminance(backgroundHex);
  return lum < 0.2 ? "dark" : "light";
}

/**
 * Parses a VS Code color theme file (*-color-theme.json) into a Tabs CustomThemeConfig
 */
export function parseVsCodeTheme(
  value: Record<string, unknown>,
  fallbackName?: string,
): { config: CustomThemeConfig; name: string } {
  const colors = isRecord(value.colors) ? (value.colors as Record<string, string>) : {};
  const name =
    (typeof value.name === "string" && value.name.trim().length > 0
      ? humanizeThemeName(value.name)
      : typeof value.displayName === "string" && value.displayName.trim().length > 0
        ? humanizeThemeName(value.displayName)
        : fallbackName
          ? humanizeThemeName(fallbackName)
          : "Imported Theme") || "Imported Theme";

  const pick = (...keys: string[]): RgbaColor | null => {
    for (const key of keys) {
      if (typeof colors[key] === "string") {
        const parsed = parseColor(colors[key]);
        if (parsed) return parsed;
      }
    }
    return null;
  };

  // Base canvas / editor background
  const editorBg = pick("editor.background", "panel.background", "sideBar.background") ?? {
    r: 20,
    g: 20,
    b: 20,
    a: 1,
  };
  const bgHex = toHex(editorBg);
  const baseVariant = resolveThemeVariant(value, bgHex);
  const isLight = baseVariant === "light";

  // Card background (sidebar, widgets, popovers)
  const cardRaw = pick(
    "sideBar.background",
    "editorWidget.background",
    "activityBar.background",
    "menu.background",
  );
  const cardHex = cardRaw ? flattenOver(cardRaw, editorBg) : isLight ? "#f6f6f6" : "#1e1e1e";

  // Foreground
  const fgRaw = pick("editor.foreground", "foreground");
  const fgHex = fgRaw ? flattenOver(fgRaw, editorBg) : isLight ? "#1e293b" : "#f8fafc";

  // Border
  const borderRaw = pick("sideBar.border", "panel.border", "editorGroup.border", "widget.border");
  const borderHex = borderRaw
    ? flattenOver(borderRaw, editorBg)
    : isLight
      ? "rgba(0, 0, 0, 0.08)"
      : "rgba(255, 255, 255, 0.08)";

  // Primary / Accent
  const primaryRaw = pick(
    "button.background",
    "activityBarBadge.background",
    "focusBorder",
    "progressBar.background",
  );
  const primaryHex = primaryRaw
    ? flattenOver(primaryRaw, editorBg)
    : isLight
      ? "#2563eb"
      : "#38bdf8";

  // Extract explicit token overrides from colors
  const tokenOverrides: Record<string, string> = {};
  for (const [key, val] of Object.entries(colors)) {
    if (typeof val === "string" && val.trim().length > 0) {
      tokenOverrides[key] = val.trim();
    }
  }

  const hasOverrides = Object.keys(tokenOverrides).length > 0;

  return {
    name,
    config: {
      baseVariant,
      colors: {
        background: bgHex,
        card: cardHex,
        foreground: ensureMinContrast(fgHex, bgHex, 4.5),
        border: borderHex,
        primary: primaryHex,
      },
      ...(hasOverrides ? { tokenOverrides } : {}),
      fonts: {
        uiFont: "system-ui",
        editorFont: "monospace",
      },
    },
  };
}

/**
 * Parses native Tabs custom theme JSON or T3 theme definition
 */
export function parseNativeTheme(
  value: Record<string, unknown>,
  fallbackName?: string,
): { config: CustomThemeConfig; name: string } {
  const name =
    typeof value.name === "string" && value.name.trim().length > 0
      ? value.name.trim()
      : typeof value.label === "string" && value.label.trim().length > 0
        ? value.label.trim()
        : fallbackName
          ? humanizeThemeName(fallbackName)
          : "Custom Theme";

  // Case 1: Tabs CustomThemeConfig format
  if (isRecord(value.colors) && typeof value.baseVariant === "string") {
    const rawColors = value.colors as Record<string, string>;
    const baseVariant: "dark" | "light" = value.baseVariant === "light" ? "light" : "dark";
    const fallback = baseVariant === "light" ? DEFAULT_FALLBACK_LIGHT : DEFAULT_FALLBACK_DARK;

    const background = toHexColor(rawColors.background) || fallback.colors.background;
    const foreground = toHexColor(rawColors.foreground) || fallback.colors.foreground;
    const card = toHexColor(rawColors.card) || fallback.colors.card;
    const border = rawColors.border || fallback.colors.border;
    const primary = toHexColor(rawColors.primary) || fallback.colors.primary;

    const fonts = isRecord(value.fonts)
      ? {
          uiFont: typeof value.fonts.uiFont === "string" ? value.fonts.uiFont : "system-ui",
          editorFont:
            typeof value.fonts.editorFont === "string" ? value.fonts.editorFont : "monospace",
          ...(typeof value.fonts.headingFont === "string" && value.fonts.headingFont.trim()
            ? { headingFont: value.fonts.headingFont.trim() }
            : {}),
        }
      : fallback.fonts;

    const tokenOverrides = isRecord(value.tokenOverrides)
      ? (value.tokenOverrides as Record<string, string>)
      : undefined;

    return {
      name,
      config: {
        baseVariant,
        colors: {
          background,
          card,
          foreground: ensureMinContrast(foreground, background, 4.5),
          border,
          primary,
        },
        ...(tokenOverrides ? { tokenOverrides } : {}),
        fonts,
      },
    };
  }

  // Case 2: T3 Code theme palette format ({ appearance, colors: { canvas, accent, ... } })
  if (isRecord(value.colors) && (value.appearance === "dark" || value.appearance === "light")) {
    const rawColors = value.colors as Record<string, string>;
    const baseVariant: "dark" | "light" = value.appearance === "light" ? "light" : "dark";
    const fallback = baseVariant === "light" ? DEFAULT_FALLBACK_LIGHT : DEFAULT_FALLBACK_DARK;

    const background =
      toHexColor(rawColors.canvas || rawColors.background) || fallback.colors.background;
    const foreground =
      toHexColor(rawColors.foreground || rawColors.text) || fallback.colors.foreground;
    const card =
      toHexColor(rawColors.card || rawColors.secondaryBackground) || fallback.colors.card;
    const border = rawColors.border || fallback.colors.border;
    const primary = toHexColor(rawColors.accent || rawColors.primary) || fallback.colors.primary;

    return {
      name,
      config: {
        baseVariant,
        colors: {
          background,
          card,
          foreground: ensureMinContrast(foreground, background, 4.5),
          border,
          primary,
        },
        fonts: fallback.fonts,
      },
    };
  }

  throw new Error("Unrecognized theme format: missing baseVariant/appearance or required colors.");
}

/**
 * Validates, detects format, and parses theme JSON text with safety guards
 */
export function validateAndParseThemeString(
  jsonString: string,
  fileName?: string,
): { success: true; config: CustomThemeConfig; name: string } | { success: false; error: string } {
  if (typeof jsonString !== "string" || jsonString.trim().length === 0) {
    return { success: false, error: "Theme file is empty." };
  }

  const byteLength = new TextEncoder().encode(jsonString).length;
  if (byteLength > MAX_THEME_FILE_BYTES) {
    const kb = Math.round(byteLength / 1024);
    return {
      success: false,
      error: `Theme file is too large (${kb} KB). Maximum allowed theme size is 256 KB.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err: any) {
    return {
      success: false,
      error: `Invalid JSON syntax: ${err?.message || "Check JSON formatting"}`,
    };
  }

  if (!isRecord(parsed)) {
    return {
      success: false,
      error: "Theme file must contain a top-level JSON object.",
    };
  }

  try {
    if (isVsCodeThemeFile(parsed)) {
      const result = parseVsCodeTheme(parsed, fileName);
      return { success: true, ...result };
    }
    const result = parseNativeTheme(parsed, fileName);
    return { success: true, ...result };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "Unable to extract theme colors from file.",
    };
  }
}

/**
 * Exports a Tabs CustomThemeConfig to formatted JSON
 */
export function exportCustomThemeAsJson(config: CustomThemeConfig, name: string): string {
  const fonts: Record<string, string> = {
    uiFont: config.fonts.uiFont,
    editorFont: config.fonts.editorFont,
  };
  if (config.fonts.headingFont) {
    fonts.headingFont = config.fonts.headingFont;
  }
  const payload = {
    schema: "tabs:custom-theme:v1",
    version: 1,
    name: name.trim() || "Custom Theme",
    baseVariant: config.baseVariant,
    colors: config.colors,
    fonts,
    ...(config.tokenOverrides && Object.keys(config.tokenOverrides).length > 0
      ? { tokenOverrides: config.tokenOverrides }
      : {}),
    ...(config.diffColorScheme ? { diffColorScheme: config.diffColorScheme } : {}),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Recovers any malformed theme configuration by falling back missing fields to defaults
 */
export function safeRecoverTheme(
  input: unknown,
  fallbackVariant: "dark" | "light" = "dark",
): CustomThemeConfig {
  const fallback = fallbackVariant === "light" ? DEFAULT_FALLBACK_LIGHT : DEFAULT_FALLBACK_DARK;
  if (!isRecord(input)) return fallback;

  const baseVariant = input.baseVariant === "light" ? "light" : "dark";
  const colors = isRecord(input.colors) ? (input.colors as Record<string, string>) : {};
  const fonts = isRecord(input.fonts) ? (input.fonts as Record<string, string>) : {};
  const tokenOverrides = isRecord(input.tokenOverrides)
    ? (input.tokenOverrides as Record<string, string>)
    : undefined;

  const toValidHex = (val: unknown, def: string): string => {
    const parsed = parseColor(val);
    return parsed ? toHex(parsed) : def;
  };

  const diffColorScheme =
    input.diffColorScheme === "blue-orange" || input.diffColorScheme === "red-green"
      ? input.diffColorScheme
      : undefined;

  return {
    baseVariant,
    colors: {
      background: toValidHex(colors.background, fallback.colors.background),
      foreground: toValidHex(colors.foreground, fallback.colors.foreground),
      card: toValidHex(colors.card, fallback.colors.card),
      border:
        colors.border && typeof colors.border === "string" ? colors.border : fallback.colors.border,
      primary: toValidHex(colors.primary, fallback.colors.primary),
    },
    fonts: {
      uiFont:
        typeof fonts.uiFont === "string" && fonts.uiFont.trim().length > 0
          ? fonts.uiFont
          : fallback.fonts.uiFont,
      editorFont:
        typeof fonts.editorFont === "string" && fonts.editorFont.trim().length > 0
          ? fonts.editorFont
          : fallback.fonts.editorFont,
      ...(typeof fonts.headingFont === "string" && fonts.headingFont.trim().length > 0
        ? { headingFont: fonts.headingFont.trim() }
        : {}),
    },
    ...(tokenOverrides ? { tokenOverrides } : {}),
    ...(diffColorScheme ? { diffColorScheme } : {}),
  };
}
