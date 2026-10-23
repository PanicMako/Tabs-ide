export type BaseVariant = "light" | "dark";

export type ThemeId =
  | "tabs-dark"
  | "true-black"
  | "tabs-monotone"
  | "tabs-light"
  | "abyss"
  | "dracula"
  | "deep-blue"
  | "solarized-light"
  | "custom";

export type EnvironmentThemePreference = `environment:${string}`;
export type ThemePreference = ThemeId | "system" | EnvironmentThemePreference;

export interface ThemeColors {
  background: string;
  appChromeBackground: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  border: string;
  input: string;
  ring: string;
  accentWashBg: string;
  accentWashBorder: string;
  codeOss: {
    bg: string;
    bgSidebar: string;
    bgElevated: string;
    bgPopover: string;
    inputBg: string;
    text: string;
    textMuted: string;
    accent: string;
  };
}

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
  baseVariant: BaseVariant;
  colors: ThemeColors;
}

export const THEME_DEFINITIONS: Record<ThemeId, ThemeDefinition> = {
  "tabs-dark": {
    id: "tabs-dark",
    name: "Tabs Dark",
    description: "Default high-contrast dark theme with electric blue accent",
    baseVariant: "dark",
    colors: {
      background: "#141414",
      appChromeBackground: "#141414",
      foreground: "#f5f5f5",
      card: "#181818",
      cardForeground: "#f5f5f5",
      popover: "#181818",
      popoverForeground: "#f5f5f5",
      primary: "#1d4ed8",
      primaryForeground: "#ffffff",
      secondary: "rgba(255, 255, 255, 0.04)",
      secondaryForeground: "#f5f5f5",
      muted: "rgba(255, 255, 255, 0.04)",
      mutedForeground: "#8a8a8a",
      accent: "rgba(255, 255, 255, 0.04)",
      accentForeground: "#f5f5f5",
      border: "rgba(255, 255, 255, 0.06)",
      input: "rgba(255, 255, 255, 0.08)",
      ring: "#1d4ed8",
      accentWashBg: "rgba(29, 78, 216, 0.12)",
      accentWashBorder: "rgba(29, 78, 216, 0.32)",
      codeOss: {
        bg: "#141414",
        bgSidebar: "#1a1a1a",
        bgElevated: "#1f1f1f",
        bgPopover: "#181818",
        inputBg: "#1c1c1c",
        text: "#ececec",
        textMuted: "#8a8a8a",
        accent: "#1d4ed8",
      },
    },
  },
  "true-black": {
    id: "true-black",
    name: "True Black",
    description: "Pure OLED black theme with crisp contrast",
    baseVariant: "dark",
    colors: {
      background: "#000000",
      appChromeBackground: "#000000",
      foreground: "#ffffff",
      card: "#0a0a0a",
      cardForeground: "#ffffff",
      popover: "#0a0a0a",
      popoverForeground: "#ffffff",
      primary: "#1d4ed8",
      primaryForeground: "#ffffff",
      secondary: "rgba(255, 255, 255, 0.05)",
      secondaryForeground: "#ffffff",
      muted: "rgba(255, 255, 255, 0.05)",
      mutedForeground: "#888888",
      accent: "rgba(255, 255, 255, 0.05)",
      accentForeground: "#ffffff",
      border: "rgba(255, 255, 255, 0.12)",
      input: "rgba(255, 255, 255, 0.14)",
      ring: "#1d4ed8",
      accentWashBg: "rgba(29, 78, 216, 0.15)",
      accentWashBorder: "rgba(29, 78, 216, 0.40)",
      codeOss: {
        bg: "#000000",
        bgSidebar: "#050505",
        bgElevated: "#0d0d0d",
        bgPopover: "#0a0a0a",
        inputBg: "#0f0f0f",
        text: "#ffffff",
        textMuted: "#888888",
        accent: "#1d4ed8",
      },
    },
  },
  "tabs-monotone": {
    id: "tabs-monotone",
    name: "Monotone",
    description: "A pure black and white theme with a sleek, greyscale aesthetic",
    baseVariant: "dark",
    colors: {
      background: "#09090b",
      appChromeBackground: "#09090b",
      foreground: "#fafafa",
      card: "#18181b",
      cardForeground: "#fafafa",
      popover: "#18181b",
      popoverForeground: "#fafafa",
      primary: "#e5e5e5",
      primaryForeground: "#09090b",
      secondary: "rgba(255, 255, 255, 0.08)",
      secondaryForeground: "#fafafa",
      muted: "rgba(255, 255, 255, 0.08)",
      mutedForeground: "#a1a1aa",
      accent: "rgba(255, 255, 255, 0.08)",
      accentForeground: "#fafafa",
      border: "rgba(255, 255, 255, 0.12)",
      input: "rgba(255, 255, 255, 0.16)",
      ring: "#e5e5e5",
      accentWashBg: "rgba(255, 255, 255, 0.12)",
      accentWashBorder: "rgba(255, 255, 255, 0.25)",
      codeOss: {
        bg: "#09090b",
        bgSidebar: "#050505",
        bgElevated: "#18181b",
        bgPopover: "#18181b",
        inputBg: "#27272a",
        text: "#fafafa",
        textMuted: "#a1a1aa",
        accent: "#e5e5e5",
      },
    },
  },
  "tabs-light": {
    id: "tabs-light",
    name: "Tabs Light",
    description: "Clean, warm light mode with soft neutral surfaces",
    baseVariant: "light",
    colors: {
      background: "#f6f5f2",
      appChromeBackground: "#f6f5f2",
      foreground: "#3a3936",
      card: "#ffffff",
      cardForeground: "#262626",
      popover: "#ffffff",
      popoverForeground: "#262626",
      primary: "#1d4ed8",
      primaryForeground: "#ffffff",
      secondary: "rgba(0, 0, 0, 0.04)",
      secondaryForeground: "#262626",
      muted: "rgba(0, 0, 0, 0.04)",
      mutedForeground: "#5f5f5f",
      accent: "rgba(0, 0, 0, 0.04)",
      accentForeground: "#262626",
      border: "rgba(0, 0, 0, 0.08)",
      input: "rgba(0, 0, 0, 0.10)",
      ring: "#1d4ed8",
      accentWashBg: "rgba(29, 78, 216, 0.09)",
      accentWashBorder: "rgba(29, 78, 216, 0.28)",
      codeOss: {
        bg: "#ffffff",
        bgSidebar: "#f6f6f6",
        bgElevated: "#ffffff",
        bgPopover: "#ffffff",
        inputBg: "#ffffff",
        text: "#262626",
        textMuted: "#5f5f5f",
        accent: "#1d4ed8",
      },
    },
  },
  abyss: {
    id: "abyss",
    name: "Abyss",
    description: "Deep oceanic dark palette with luminous cyan-blue highlights",
    baseVariant: "dark",
    colors: {
      background: "#000c18",
      appChromeBackground: "#000c18",
      foreground: "#c0cbe0",
      card: "#041426",
      cardForeground: "#d8e2f0",
      popover: "#041426",
      popoverForeground: "#d8e2f0",
      primary: "#0099ff",
      primaryForeground: "#000c18",
      secondary: "rgba(0, 153, 255, 0.08)",
      secondaryForeground: "#d8e2f0",
      muted: "rgba(0, 153, 255, 0.06)",
      mutedForeground: "#6880a0",
      accent: "rgba(0, 153, 255, 0.08)",
      accentForeground: "#ffffff",
      border: "rgba(0, 153, 255, 0.14)",
      input: "rgba(0, 153, 255, 0.16)",
      ring: "#0099ff",
      accentWashBg: "rgba(0, 153, 255, 0.12)",
      accentWashBorder: "rgba(0, 153, 255, 0.35)",
      codeOss: {
        bg: "#000c18",
        bgSidebar: "#021020",
        bgElevated: "#04172c",
        bgPopover: "#041426",
        inputBg: "#061a32",
        text: "#c0cbe0",
        textMuted: "#6880a0",
        accent: "#0099ff",
      },
    },
  },
  dracula: {
    id: "dracula",
    name: "Dracula",
    description: "Classic dark theme with purple and pastel accent swatches",
    baseVariant: "dark",
    colors: {
      background: "#282a36",
      appChromeBackground: "#282a36",
      foreground: "#f8f8f2",
      card: "#21222c",
      cardForeground: "#f8f8f2",
      popover: "#21222c",
      popoverForeground: "#f8f8f2",
      primary: "#bd93f9",
      primaryForeground: "#282a36",
      secondary: "rgba(189, 147, 249, 0.10)",
      secondaryForeground: "#f8f8f2",
      muted: "rgba(255, 255, 255, 0.05)",
      mutedForeground: "#6272a4",
      accent: "rgba(189, 147, 249, 0.10)",
      accentForeground: "#ffffff",
      border: "rgba(98, 114, 164, 0.35)",
      input: "rgba(98, 114, 164, 0.25)",
      ring: "#bd93f9",
      accentWashBg: "rgba(189, 147, 249, 0.14)",
      accentWashBorder: "rgba(189, 147, 249, 0.38)",
      codeOss: {
        bg: "#282a36",
        bgSidebar: "#21222c",
        bgElevated: "#343746",
        bgPopover: "#21222c",
        inputBg: "#282a36",
        text: "#f8f8f2",
        textMuted: "#6272a4",
        accent: "#bd93f9",
      },
    },
  },
  "deep-blue": {
    id: "deep-blue",
    name: "Deep Blue",
    description: "Midnight slate dark theme with vivid sky-blue highlights",
    baseVariant: "dark",
    colors: {
      background: "#0f172a",
      appChromeBackground: "#0f172a",
      foreground: "#f1f5f9",
      card: "#1e293b",
      cardForeground: "#f8fafc",
      popover: "#1e293b",
      popoverForeground: "#f8fafc",
      primary: "#38bdf8",
      primaryForeground: "#0f172a",
      secondary: "rgba(56, 189, 248, 0.08)",
      secondaryForeground: "#f1f5f9",
      muted: "rgba(255, 255, 255, 0.05)",
      mutedForeground: "#94a3b8",
      accent: "rgba(56, 189, 248, 0.08)",
      accentForeground: "#ffffff",
      border: "rgba(51, 65, 85, 0.65)",
      input: "rgba(51, 65, 85, 0.75)",
      ring: "#38bdf8",
      accentWashBg: "rgba(56, 189, 248, 0.12)",
      accentWashBorder: "rgba(56, 189, 248, 0.35)",
      codeOss: {
        bg: "#0f172a",
        bgSidebar: "#131d33",
        bgElevated: "#1e293b",
        bgPopover: "#1e293b",
        inputBg: "#16233b",
        text: "#f1f5f9",
        textMuted: "#94a3b8",
        accent: "#38bdf8",
      },
    },
  },
  "solarized-light": {
    id: "solarized-light",
    name: "Solarized Light",
    description: "Warm cream light theme with teal and amber solarized tones",
    baseVariant: "light",
    colors: {
      background: "#fdf6e3",
      appChromeBackground: "#fdf6e3",
      foreground: "#657b83",
      card: "#eee8d5",
      cardForeground: "#586e75",
      popover: "#eee8d5",
      popoverForeground: "#586e75",
      primary: "#268bd2",
      primaryForeground: "#ffffff",
      secondary: "rgba(181, 137, 0, 0.08)",
      secondaryForeground: "#586e75",
      muted: "rgba(0, 0, 0, 0.05)",
      mutedForeground: "#93a1a1",
      accent: "rgba(38, 139, 210, 0.08)",
      accentForeground: "#073642",
      border: "rgba(147, 161, 161, 0.28)",
      input: "rgba(147, 161, 161, 0.32)",
      ring: "#268bd2",
      accentWashBg: "rgba(38, 139, 210, 0.10)",
      accentWashBorder: "rgba(38, 139, 210, 0.30)",
      codeOss: {
        bg: "#fdf6e3",
        bgSidebar: "#eee8d5",
        bgElevated: "#fdf6e3",
        bgPopover: "#eee8d5",
        inputBg: "#fdf6e3",
        text: "#657b83",
        textMuted: "#93a1a1",
        accent: "#268bd2",
      },
    },
  },
  custom: {
    id: "custom",
    name: "Custom",
    description: "User-defined custom colors and font choices",
    baseVariant: "dark",
    colors: {
      background: "#121824",
      appChromeBackground: "#121824",
      foreground: "#e2e8f0",
      card: "#1e293b",
      cardForeground: "#e2e8f0",
      popover: "#1e293b",
      popoverForeground: "#e2e8f0",
      primary: "#38bdf8",
      primaryForeground: "#ffffff",
      secondary: "rgba(255, 255, 255, 0.05)",
      secondaryForeground: "#e2e8f0",
      muted: "rgba(255, 255, 255, 0.05)",
      mutedForeground: "#94a3b8",
      accent: "rgba(255, 255, 255, 0.05)",
      accentForeground: "#e2e8f0",
      border: "#334155",
      input: "rgba(255, 255, 255, 0.10)",
      ring: "#38bdf8",
      accentWashBg: "rgba(56, 189, 248, 0.15)",
      accentWashBorder: "rgba(56, 189, 248, 0.35)",
      codeOss: {
        bg: "#121824",
        bgSidebar: "#1e293b",
        bgElevated: "#1e293b",
        bgPopover: "#1e293b",
        inputBg: "#1e293b",
        text: "#e2e8f0",
        textMuted: "#94a3b8",
        accent: "#38bdf8",
      },
    },
  },
};

import {
  type CustomThemeConfig,
  type TokenCategory,
  type TokenMetadata,
  type WcagCheckResult,
  calculateLuminance,
  calculateContrastRatio,
  getOptimalPrimaryForeground,
  evaluateThemeTokens,
  runThemeWcagCheck,
  VSCODE_TOKEN_REGISTRY,
} from "@tabs/shared/themeDerivation";

export type { CustomThemeConfig, TokenCategory, TokenMetadata, WcagCheckResult };
export {
  calculateLuminance,
  calculateContrastRatio,
  getOptimalPrimaryForeground,
  evaluateThemeTokens,
  runThemeWcagCheck,
  VSCODE_TOKEN_REGISTRY,
};

export const DEFAULT_CUSTOM_THEME: CustomThemeConfig = {
  baseVariant: "dark",
  colors: {
    background: "#121824",
    foreground: "#e2e8f0",
    card: "#1e293b",
    border: "#334155",
    primary: "#38bdf8",
  },
  fonts: {
    uiFont: "system-ui",
    editorFont: "Menlo",
  },
};

export const DEFAULT_CUSTOM_THEME_LIGHT: CustomThemeConfig = {
  baseVariant: "light",
  colors: {
    background: "#f8fafc",
    foreground: "#0f172a",
    card: "#ffffff",
    border: "#e2e8f0",
    primary: "#0284c7",
  },
  fonts: {
    uiFont: "system-ui",
    editorFont: "Menlo",
  },
};

export type RandomStyleMode = "balanced" | "pastel" | "vivid" | "minimal" | "cyberpunk" | "warm";

export const RANDOM_STYLE_OPTIONS: { id: RandomStyleMode; label: string }[] = [
  { id: "pastel", label: "Pastel Soft" },
  { id: "vivid", label: "Vivid Electric" },
  { id: "minimal", label: "Minimal Mono" },
  { id: "cyberpunk", label: "Cyberpunk Neon" },
  { id: "warm", label: "Warm Earthy" },
  { id: "balanced", label: "Harmonized (Default)" },
];

const AESTHETIC_PREFIXES = [
  "Tokyo",
  "Cyber",
  "Aesthetic",
  "Midnight",
  "Matcha",
  "Sakura",
  "Velvet",
  "Obsidian",
  "Pixel",
  "Lunar",
  "Vibe",
  "Neon",
  "Ghost",
  "Solar",
  "Chai",
  "Cosmic",
  "Electric",
  "Retro",
  "Emerald",
  "Twilight",
  "Solstice",
  "Oasis",
  "Zenith",
  "Nebula",
  "Monaco",
  "Kyoto",
  "Mochi",
  "Indigo",
  "Lumina",
];

const AESTHETIC_SUFFIXES = [
  "Drift",
  "Haze",
  "Glow",
  "Pulse",
  "Check",
  "Bloom",
  "Latte",
  "Signal",
  "Wave",
  "Dust",
  "Aura",
  "Flare",
  "Syntax",
  "Shift",
  "Echo",
  "Mirage",
  "Vibes",
  "Mist",
  "Realm",
  "Matrix",
  "Chroma",
  "Radiance",
  "Spark",
];

export function generateAestheticThemeName(): string {
  const p = AESTHETIC_PREFIXES[Math.floor(Math.random() * AESTHETIC_PREFIXES.length)];
  const s = AESTHETIC_SUFFIXES[Math.floor(Math.random() * AESTHETIC_SUFFIXES.length)];
  return `${p} ${s}`;
}

const CURATED_PASTEL_HARMONIES = [
  { bg: "#faf4f6", card: "#ffffff", border: "#f3dbe3", fg: "#2d1b22", primary: "#d9658b" },
  { bg: "#f5f7f3", card: "#ffffff", border: "#dbe4d5", fg: "#182615", primary: "#4f8045" },
  { bg: "#f6f5fa", card: "#ffffff", border: "#e0dcf2", fg: "#1d162d", primary: "#6c56ce" },
  { bg: "#faf5f3", card: "#ffffff", border: "#f5dfd6", fg: "#2e1c15", primary: "#d46b50" },
  { bg: "#f4f7fb", card: "#ffffff", border: "#d9e4f5", fg: "#122033", primary: "#3174ed" },
  { bg: "#1a1721", card: "#231f2d", border: "#352e45", fg: "#ebdff7", primary: "#b388ff" },
  { bg: "#151a17", card: "#1d2420", border: "#2c3831", fg: "#dcf2e6", primary: "#70c497" },
];

const CURATED_VIVID_HARMONIES = [
  { bg: "#090d16", card: "#111827", border: "#1f2937", fg: "#f9fafb", primary: "#6366f1" },
  { bg: "#06111e", card: "#0b1d32", border: "#143254", fg: "#f0f9ff", primary: "#06b6d4" },
  { bg: "#130a10", card: "#20101b", border: "#381a2f", fg: "#fdf2f8", primary: "#f43f5e" },
  { bg: "#041410", card: "#08241d", border: "#104236", fg: "#ecfdf5", primary: "#10b981" },
  { bg: "#161108", card: "#241c0e", border: "#3f3018", fg: "#fffbeb", primary: "#f59e0b" },
];

const CURATED_MINIMAL_HARMONIES = [
  { bg: "#0f172a", card: "#1e293b", border: "#334155", fg: "#f8fafc", primary: "#38bdf8" },
  { bg: "#121212", card: "#1e1e1e", border: "#2d2d2d", fg: "#ededed", primary: "#f5f5f5" },
  { bg: "#fafafa", card: "#ffffff", border: "#e5e5e5", fg: "#171717", primary: "#2563eb" },
];

const CURATED_CYBERPUNK_HARMONIES = [
  { bg: "#080711", card: "#100e20", border: "#221c3d", fg: "#f3f0ff", primary: "#d946ef" },
  { bg: "#0d021a", card: "#190533", border: "#340a66", fg: "#fae8ff", primary: "#00f0ff" },
  { bg: "#020d07", card: "#051a0e", border: "#0b381d", fg: "#dcffe4", primary: "#00ff66" },
  { bg: "#0a0e1a", card: "#12192e", border: "#1e294d", fg: "#e0e8ff", primary: "#7aa2f7" },
];

const CURATED_WARM_HARMONIES = [
  { bg: "#18120e", card: "#251c16", border: "#3c2d24", fg: "#f7ede8", primary: "#e07a5f" },
  { bg: "#120e0b", card: "#1c1612", border: "#30261f", fg: "#f4eae1", primary: "#d4a373" },
  { bg: "#fcf8f5", card: "#ffffff", border: "#f0dfd5", fg: "#2c1a11", primary: "#c85a32" },
  { bg: "#fdfbf7", card: "#ffffff", border: "#f2e9d8", fg: "#241c10", primary: "#b58900" },
];

export function generateHarmonizedPalette(
  baseVariant: "dark" | "light",
  styleMode: RandomStyleMode = "pastel",
): CustomThemeConfig["colors"] {
  let pool: typeof CURATED_PASTEL_HARMONIES;

  switch (styleMode) {
    case "pastel":
      pool = CURATED_PASTEL_HARMONIES;
      break;
    case "vivid":
      pool = CURATED_VIVID_HARMONIES;
      break;
    case "minimal":
      pool = CURATED_MINIMAL_HARMONIES;
      break;
    case "cyberpunk":
      pool = CURATED_CYBERPUNK_HARMONIES;
      break;
    case "warm":
      pool = CURATED_WARM_HARMONIES;
      break;
    default:
      pool = [...CURATED_PASTEL_HARMONIES, ...CURATED_VIVID_HARMONIES, ...CURATED_WARM_HARMONIES];
      break;
  }

  const matched = pool.filter((p) => {
    const isDarkBg = calculateLuminance(p.bg) < 0.2;
    return baseVariant === "dark" ? isDarkBg : !isDarkBg;
  });

  const selected =
    matched.length > 0
      ? matched[Math.floor(Math.random() * matched.length)]!
      : pool[Math.floor(Math.random() * pool.length)]!;

  let fg = selected.fg;
  let bg = selected.bg;

  let ratio = calculateContrastRatio(fg, bg).ratio;
  if (ratio < 4.5) {
    fg = baseVariant === "dark" ? "#f8fafc" : "#0f172a";
  }

  return {
    background: bg,
    foreground: fg,
    card: selected.card,
    border: selected.border,
    primary: selected.primary,
  };
}

export interface FontPreferences {
  uiFont: string;
  headingFont: string;
  editorFont: string;
  sectionFont?: string | undefined;
  supportingFont?: string | undefined;
  fontSizeInterface?: number | undefined;
  fontSizeCode?: number | undefined;
  fontSizePrompt?: number | undefined;
}

export const DEFAULT_FONT_PREFERENCES: FontPreferences = {
  uiFont: "'Syne', sans-serif",
  headingFont: "'Newsreader', serif",
  editorFont: "Menlo, Monaco, 'Courier New', monospace",
  fontSizeInterface: 13,
  fontSizeCode: 12,
  fontSizePrompt: 13,
};

export const UI_FONT_OPTIONS = [
  { value: "'Syne', sans-serif", label: "Syne (Default)" },
  { value: "system-ui", label: "System UI" },
  { value: "'Open Sans', sans-serif", label: "Open Sans" },
  { value: "'Geist', sans-serif", label: "Geist" },
  { value: "'Ronzino', sans-serif", label: "Ronzino" },
  { value: "'Absans', sans-serif", label: "Absans" },
  { value: "'Necto Mono', monospace", label: "Necto Mono" },
  { value: "'Hanken Grotesk', sans-serif", label: "Hanken Grotesk" },
  { value: "'Funnel Sans', sans-serif", label: "Funnel Sans" },
] as const;

export const HEADING_FONT_OPTIONS = [
  { value: "'KS Bistra', sans-serif", label: "KS Bistra" },
  { value: "'Pavot', sans-serif", label: "Pavot" },
  { value: "'Exotica', sans-serif", label: "Exotica" },
  { value: "'Northern', sans-serif", label: "Northern" },
  { value: "'ZT Otez', serif", label: "ZT Otez" },
  { value: "'Aicon', sans-serif", label: "Aicon" },
  { value: "'Mirano', sans-serif", label: "Mirano" },
  { value: "'Culont', sans-serif", label: "Culont" },
  { value: "'Hebdomadal', sans-serif", label: "Hebdomadal" },
  { value: "'Ductile Display', sans-serif", label: "Ductile Display" },
  { value: "'Mantranaga 36DOT', sans-serif", label: "Mantranaga 36DOT" },
  { value: "'Nafile', sans-serif", label: "Nafile" },
  { value: "'Halo Grotesk', sans-serif", label: "Halo Grotesk" },
  { value: "'Nauryz Redkeds', sans-serif", label: "Nauryz Redkeds" },
  { value: "'Angst', sans-serif", label: "Angst" },
  { value: "'Angst Serif', serif", label: "Angst Serif" },
  { value: "'Equilla', serif", label: "Equilla" },
  { value: "'Deserta', sans-serif", label: "Deserta" },
  { value: "'Darker Grotesque', sans-serif", label: "Darker Grotesque" },
  { value: "'Arck', serif", label: "Arck" },
  { value: "'Moche', sans-serif", label: "Moche" },
  { value: "'Urbanist', sans-serif", label: "Urbanist" },
  { value: "'Sato Sans', sans-serif", label: "Sato Sans" },
  { value: "'Rebel Type Dog', sans-serif", label: "Rebel Type Dog" },
  { value: "'Hashira Mt', serif", label: "Hashira Mt" },
  { value: "'Neutral Face', sans-serif", label: "Neutral Face" },
  { value: "'Stigma', serif", label: "Stigma" },
  { value: "'Sun Seed', sans-serif", label: "Sun Seed" },
  { value: "'Newsreader', serif", label: "Newsreader (Default)" },
  { value: "system-ui", label: "Match Interface Font" },
  { value: "'Instrument Serif', serif", label: "Instrument Serif" },
  { value: "'Doto', sans-serif", label: "Doto" },
  { value: "'Syne', sans-serif", label: "Syne" },
  { value: "'Parkinsans', sans-serif", label: "Parkinsans" },
  { value: "'Coconat', serif", label: "Coconat" },
  { value: "'Aujournuit Wide', sans-serif", label: "Aujournuit Wide" },
  { value: "'Messapia', monospace", label: "Messapia" },
  { value: "'Hanken Grotesk', sans-serif", label: "Hanken Grotesk" },
  { value: "'Funnel Display', sans-serif", label: "Funnel Display" },
  { value: "'Ronzino', sans-serif", label: "Ronzino" },
] as const;

export const EDITOR_FONT_OPTIONS = [
  { value: "Menlo, Monaco, 'Courier New', monospace", label: "Menlo / Monaco (Default)" },
  { value: "'JetBrains Mono', monospace", label: "JetBrains Mono" },
  { value: "'IBM Plex Mono', monospace", label: "IBM Plex Mono" },
  { value: "'Cascadia Code', monospace", label: "Cascadia Code" },
  { value: "Consolas, 'Liberation Mono', monospace", label: "Consolas" },
] as const;

export interface FontComboTypography {
  headingWeight: number;
  headingTracking: string;
  headingTransform: "none" | "uppercase" | "lowercase";
  sectionFont: string;
  sectionWeight: number;
  sectionStyle: "normal" | "italic";
  sectionTransform: "none" | "uppercase" | "lowercase";
  sectionTracking: string;
  rowFont: string;
  rowWeight: number;
  controlsFont: string;
  metadataFont: string;
  specimenFont: string;
  specimenWeight: number;
  specimenStyle: "normal" | "italic";
  supportingFont: string;
  supportingStyle: "normal" | "italic";
}

export interface FontCombo {
  id: string;
  name: string;
  desc: string;
  tag: string;
  uiFont: string;
  headingFont: string;
  /** First part of the split-word specimen — rendered in heavy UI font, lowercase */
  sansText: string;
  /** Middle part of the split-word specimen — rendered in the pairing accent font */
  serifText: string;
  /** Optional trailing word rendered back in the UI font */
  sansText2?: string;
  /** Tailwind classes for sans elements */
  sansClass: string;
  /** Tailwind classes for serif elements */
  serifClass: string;
  /** If true, show as a small neutral pill rather than a big personality card */
  isNeutral?: boolean;
  typography?: FontComboTypography;
  /** New collection presets affect heading roles only. */
  headingOnly?: boolean;
  fonts?: Pick<FontPreferences, "sectionFont" | "supportingFont" | "editorFont">;
}

function headingCombo(
  id: string,
  name: string,
  headingFont: string,
  headingWeight: number,
  accentFont: string,
  accentWeight: number,
  accentStyle: "normal" | "italic",
  sansText: string,
  serifText: string,
): FontCombo {
  return {
    id,
    name,
    headingFont,
    desc: `${headingFont.split(",")[0]!.replaceAll("'", "")} + ${accentFont.split(",")[0]!.replaceAll("'", "")}`,
    tag: "HEADINGS",
    uiFont: "'Manrope', sans-serif",
    sansText,
    serifText,
    sansClass: "normal-case",
    serifClass: "normal-case",
    headingOnly: true,
    typography: {
      headingWeight,
      headingTracking: "0em",
      headingTransform: "none",
      sectionFont: accentFont,
      sectionWeight: accentWeight,
      sectionStyle: accentStyle,
      sectionTransform: "none",
      sectionTracking: "0em",
      rowFont: "'Manrope', sans-serif",
      rowWeight: 600,
      controlsFont: "'Manrope', sans-serif",
      metadataFont: "'Manrope', sans-serif",
      specimenFont: accentFont,
      specimenWeight: accentWeight,
      specimenStyle: accentStyle,
      supportingFont: "'Manrope', sans-serif",
      supportingStyle: "normal",
    },
  };
}

export const FONT_COMBOS: FontCombo[] = [
  // ── Neutral defaults (shown as pills, not big cards) ──────────────────────
  {
    id: "system",
    name: "System UI",
    desc: "Your OS, no opinions",
    tag: "SYSTEM",
    uiFont: "system-ui",
    headingFont: "system-ui",
    sansText: "sys",
    serifText: "tem",
    sansClass: "font-bold tracking-tight normal-case",
    serifClass: "font-normal normal-case",
    isNeutral: true,
  },
  {
    id: "plaintext",
    name: "Plaintext Energy",
    desc: "Zero drama, max readability",
    tag: "NEUTRAL",
    uiFont: "'Open Sans', sans-serif",
    headingFont: "'Inter', system-ui, sans-serif",
    sansText: "open",
    serifText: "sans",
    sansClass: "font-bold tracking-tight normal-case",
    serifClass: "font-normal normal-case",
    isNeutral: true,
  },
  {
    id: "custom",
    name: "Custom Pick",
    desc: "Mix & match any fonts",
    tag: "CUSTOM",
    uiFont: "custom",
    headingFont: "custom",
    sansText: "cus",
    serifText: "tom",
    sansClass: "font-bold tracking-tight normal-case",
    serifClass: "font-normal normal-case",
    isNeutral: true,
  },

  // Approved pairings, plus the unchanged Syne Dropped preset.
  {
    id: "editorial-dark",
    name: "Paper Trail",
    desc: "Instrument Serif + Geist",
    tag: "PAPER",
    uiFont: "'Geist', sans-serif",
    headingFont: "'Instrument Serif', serif",
    sansText: "paper",
    serifText: "trail",
    sansClass: "normal-case",
    serifClass: "normal-case",
    typography: {
      headingWeight: 400,
      headingTracking: "-.03em",
      headingTransform: "none",
      sectionFont: "'Instrument Serif', serif",
      sectionWeight: 400,
      sectionStyle: "italic",
      sectionTransform: "none",
      sectionTracking: "-.015em",
      rowFont: "'Geist', sans-serif",
      rowWeight: 600,
      controlsFont: "'Geist', sans-serif",
      metadataFont: "'Geist Mono', monospace",
      specimenFont: "'Instrument Serif', serif",
      specimenWeight: 400,
      supportingFont: "'Instrument Serif', serif",
      supportingStyle: "normal",
      specimenStyle: "italic",
    },
  },
  {
    id: "dot-matrix",
    name: "Pixel Mischief",
    desc: "Doto + Geist",
    tag: "PIXEL",
    uiFont: "'Geist', sans-serif",
    headingFont: "'Doto', sans-serif",
    sansText: "signal",
    serifText: "noise",
    sansClass: "normal-case",
    serifClass: "normal-case",
    typography: {
      headingWeight: 900,
      headingTracking: "0.02em",
      headingTransform: "uppercase",
      sectionFont: "'Syne', sans-serif",
      sectionWeight: 700,
      sectionStyle: "normal",
      sectionTransform: "none",
      sectionTracking: "-.015em",
      rowFont: "'Doto', sans-serif",
      rowWeight: 800,
      controlsFont: "'Geist Mono', monospace",
      metadataFont: "'Geist Mono', monospace",
      specimenFont: "'Doto', sans-serif",
      specimenWeight: 200,
      supportingFont: "'Geist Mono', monospace",
      supportingStyle: "normal",
      specimenStyle: "normal",
    },
  },
  {
    id: "syne-serif",
    name: "Serif.exe",
    desc: "Syne + Geist",
    tag: "EDITORIAL",
    uiFont: "'Geist', sans-serif",
    headingFont: "'Syne', sans-serif",
    sansText: "soft",
    serifText: "power",
    sansClass: "normal-case",
    serifClass: "normal-case",
    typography: {
      headingWeight: 800,
      headingTracking: "-.04em",
      headingTransform: "none",
      sectionFont: "'Instrument Serif', serif",
      sectionWeight: 400,
      sectionStyle: "italic",
      sectionTransform: "none",
      sectionTracking: "-.015em",
      rowFont: "'Geist', sans-serif",
      rowWeight: 600,
      controlsFont: "'Geist', sans-serif",
      metadataFont: "'Geist Mono', monospace",
      specimenFont: "'Instrument Serif', serif",
      specimenWeight: 400,
      supportingFont: "'Instrument Serif', serif",
      supportingStyle: "italic",
      specimenStyle: "italic",
    },
  },
  {
    id: "sculpted-contrast",
    name: "Velvet Logic",
    desc: "Coconat + Ronzino",
    tag: "SCULPT",
    uiFont: "'Ronzino', sans-serif",
    headingFont: "'Coconat', serif",
    sansText: "velvet",
    serifText: "logic",
    sansClass: "normal-case",
    serifClass: "normal-case",
    typography: {
      headingWeight: 700,
      headingTracking: "-.04em",
      headingTransform: "none",
      sectionFont: "'Ronzino', sans-serif",
      sectionWeight: 700,
      sectionStyle: "normal",
      sectionTransform: "none",
      sectionTracking: "-.015em",
      rowFont: "'Ronzino', sans-serif",
      rowWeight: 600,
      controlsFont: "'Ronzino', sans-serif",
      metadataFont: "'Necto Mono', monospace",
      specimenFont: "'Ronzino', sans-serif",
      specimenWeight: 400,
      supportingFont: "'Ronzino', sans-serif",
      supportingStyle: "normal",
      specimenStyle: "normal",
    },
  },
  {
    id: "open-proportions",
    name: "Orbit Club",
    desc: "Aujournuit Wide + Absans",
    tag: "WIDE",
    uiFont: "'Absans', sans-serif",
    headingFont: "'Aujournuit Wide', sans-serif",
    sansText: "orbit",
    serifText: "club",
    sansClass: "normal-case",
    serifClass: "normal-case",
    typography: {
      headingWeight: 400,
      headingTracking: "-.04em",
      headingTransform: "none",
      sectionFont: "'Absans', sans-serif",
      sectionWeight: 400,
      sectionStyle: "normal",
      sectionTransform: "none",
      sectionTracking: "-.015em",
      rowFont: "'Absans', sans-serif",
      rowWeight: 600,
      controlsFont: "'Absans', sans-serif",
      metadataFont: "'Necto Mono', monospace",
      specimenFont: "'Absans', sans-serif",
      specimenWeight: 400,
      supportingFont: "'Absans', sans-serif",
      supportingStyle: "normal",
      specimenStyle: "normal",
    },
  },
  {
    id: "wide-technical",
    name: "Terminal Bloom",
    desc: "Messapia + Necto Mono",
    tag: "MONO",
    uiFont: "'Necto Mono', monospace",
    headingFont: "'Messapia', monospace",
    sansText: "mono",
    serifText: "bloom",
    sansClass: "normal-case",
    serifClass: "normal-case",
    typography: {
      headingWeight: 700,
      headingTracking: "-.04em",
      headingTransform: "none",
      sectionFont: "'Ronzino', sans-serif",
      sectionWeight: 700,
      sectionStyle: "normal",
      sectionTransform: "none",
      sectionTracking: "-.015em",
      rowFont: "'Necto Mono', monospace",
      rowWeight: 600,
      controlsFont: "'Necto Mono', monospace",
      metadataFont: "'Necto Mono', monospace",
      specimenFont: "'Necto Mono', monospace",
      specimenWeight: 400,
      supportingFont: "'Necto Mono', monospace",
      supportingStyle: "normal",
      specimenStyle: "normal",
    },
  },
  {
    id: "swiss-light",
    name: "Sans Ceremony",
    desc: "Hanken Grotesk + Hanken Grotesk",
    tag: "SWISS",
    uiFont: "'Hanken Grotesk', sans-serif",
    headingFont: "'Hanken Grotesk', sans-serif",
    sansText: "sans",
    serifText: "ceremony",
    sansClass: "normal-case",
    serifClass: "normal-case",
    typography: {
      headingWeight: 800,
      headingTracking: "-.06em",
      headingTransform: "none",
      sectionFont: "'Hanken Grotesk', sans-serif",
      sectionWeight: 700,
      sectionStyle: "normal",
      sectionTransform: "none",
      sectionTracking: "-.015em",
      rowFont: "'Hanken Grotesk', sans-serif",
      rowWeight: 600,
      controlsFont: "'Hanken Grotesk', sans-serif",
      metadataFont: "'Geist Mono', monospace",
      specimenFont: "'Hanken Grotesk', sans-serif",
      specimenWeight: 400,
      supportingFont: "'Hanken Grotesk', sans-serif",
      supportingStyle: "normal",
      specimenStyle: "normal",
    },
  },
  {
    id: "funnel-weights",
    name: "Liquid Syntax",
    desc: "Funnel Display + Funnel Sans",
    tag: "FLUID",
    uiFont: "'Funnel Sans', sans-serif",
    headingFont: "'Funnel Display', sans-serif",
    sansText: "liquid",
    serifText: "syntax",
    sansClass: "normal-case",
    serifClass: "normal-case",
    typography: {
      headingWeight: 800,
      headingTracking: "-.055em",
      headingTransform: "none",
      sectionFont: "'Funnel Display', sans-serif",
      sectionWeight: 600,
      sectionStyle: "normal",
      sectionTransform: "none",
      sectionTracking: "-.015em",
      rowFont: "'Funnel Sans', sans-serif",
      rowWeight: 600,
      controlsFont: "'Funnel Sans', sans-serif",
      metadataFont: "'Fragment Mono', monospace",
      specimenFont: "'Funnel Display', sans-serif",
      specimenWeight: 300,
      supportingFont: "'Funnel Sans', sans-serif",
      supportingStyle: "normal",
      specimenStyle: "normal",
    },
  },
  {
    id: "independent-grotesk",
    name: "After Hours",
    desc: "Ronzino + Necto Mono",
    tag: "INDUSTRIAL",
    uiFont: "'Necto Mono', monospace",
    headingFont: "'Ronzino', sans-serif",
    sansText: "after",
    serifText: "hours",
    sansClass: "normal-case",
    serifClass: "normal-case",
    typography: {
      headingWeight: 700,
      headingTracking: "-.04em",
      headingTransform: "none",
      sectionFont: "'Syne', sans-serif",
      sectionWeight: 700,
      sectionStyle: "normal",
      sectionTransform: "none",
      sectionTracking: "-.015em",
      rowFont: "'Necto Mono', monospace",
      rowWeight: 600,
      controlsFont: "'Necto Mono', monospace",
      metadataFont: "'Necto Mono', monospace",
      specimenFont: "'Necto Mono', monospace",
      specimenWeight: 400,
      supportingFont: "'Ronzino', sans-serif",
      supportingStyle: "normal",
      specimenStyle: "normal",
    },
  },
  {
    id: "syne-dropped",
    name: "Abstract Forms",
    desc: "Syne + Newsreader",
    tag: "BRUTAL",
    uiFont: "'Syne', sans-serif",
    headingFont: "'Newsreader', serif",
    sansText: "ab",
    serifText: "stract ",
    sansText2: "forms",
    sansClass: "font-extrabold tracking-tighter lowercase",
    serifClass: "italic font-normal normal-case",
  },
  {
    ...headingCombo(
      "studio-signal",
      "Studio Signal",
      "'Coconat', serif",
      700,
      "'Sun Seed', sans-serif",
      300,
      "normal",
      "studio",
      "signal",
    ),
    headingOnly: false,
    uiFont: "'Syne', sans-serif",
    desc: "Coconat + Sun Seed + Syne",
    tag: "STUDIO",
    typography: {
      headingWeight: 700,
      headingTracking: "-.04em",
      headingTransform: "none",
      sectionFont: "'Sun Seed', sans-serif",
      sectionWeight: 300,
      sectionStyle: "normal",
      sectionTransform: "none",
      sectionTracking: "-.015em",
      rowFont: "'Syne', sans-serif",
      rowWeight: 700,
      controlsFont: "'Syne', sans-serif",
      metadataFont: "'Syne', sans-serif",
      specimenFont: "'Sun Seed', sans-serif",
      specimenWeight: 300,
      specimenStyle: "normal",
      supportingFont: "'Syne', sans-serif",
      supportingStyle: "normal",
    },
    fonts: {
      sectionFont: "'Sun Seed', sans-serif",
      supportingFont: "'Syne', sans-serif",
      editorFont: "Menlo, Monaco, 'Courier New', monospace",
    },
  },
  headingCombo(
    "bistra-signal",
    "Bistra Signal",
    "'KS Bistra', sans-serif",
    400,
    "'Sato Sans', sans-serif",
    500,
    "normal",
    "clear",
    "signal",
  ),
  headingCombo(
    "pavot-motion",
    "Exotica Motion",
    "'Exotica', sans-serif",
    400,
    "'Arck', serif",
    400,
    "normal",
    "exotica",
    "motion",
  ),
  headingCombo(
    "otez-contrast",
    "Moche Urbanist",
    "'Moche', sans-serif",
    400,
    "'Urbanist', sans-serif",
    700,
    "normal",
    "moche",
    "urbanist",
  ),
  headingCombo(
    "aicon-grid",
    "Aicon Grid",
    "'Aicon', sans-serif",
    600,
    "'Rebel Type Dog', sans-serif",
    400,
    "normal",
    "digital",
    "grid",
  ),
  headingCombo(
    "mirano-flow",
    "Mirano Flow",
    "'Mirano', sans-serif",
    300,
    "'Nafile', sans-serif",
    400,
    "normal",
    "mirano",
    "flow",
  ),
  headingCombo(
    "culont-curve",
    "Culont Curve",
    "'Culont', sans-serif",
    400,
    "'Equilla', serif",
    400,
    "normal",
    "culont",
    "curve",
  ),
  headingCombo(
    "hebdomadal-shift",
    "Hebdomadal Shift",
    "'Hebdomadal', sans-serif",
    400,
    "'Neutral Face', sans-serif",
    400,
    "normal",
    "hebdomadal",
    "shift",
  ),
  headingCombo(
    "ductile-motion",
    "Hashira Modular",
    "'Hashira Mt', serif",
    400,
    "'Halo Grotesk', sans-serif",
    400,
    "normal",
    "hashira",
    "beauty",
  ),
];

/** Visible collection; retired definitions remain above for saved-setting compatibility. */
export const CURATED_FONT_COMBOS = FONT_COMBOS.filter(
  (combo) =>
    (combo.isNeutral && combo.id !== "custom") ||
    combo.id === "syne-dropped" ||
    combo.id === "studio-signal" ||
    combo.headingOnly,
);

// Upgrade only exact retired preset pairs; preserve custom choices, sizes and editor font.
const PREVIOUS_FONT_COMBOS = [
  ["'Inter Tight', sans-serif", "'Unbounded', sans-serif", "swiss-light"],
  ["'Space Grotesk', sans-serif", "'Russo One', sans-serif", "independent-grotesk"],
  ["'Bricolage Grotesque', sans-serif", "'Black Han Sans', sans-serif", "sculpted-contrast"],
  ["'Albert Sans', sans-serif", "'Rammetto One', sans-serif", "open-proportions"],
  ["'Hanken Grotesk', sans-serif", "'Paytone One', sans-serif", "swiss-light"],
  ["'Chivo', sans-serif", "'Bowlby One', sans-serif", "editorial-dark"],
  ["'DM Sans', sans-serif", "'Rubik Mono One', sans-serif", "wide-technical"],
  ["'Spline Sans', sans-serif", "'Mochiy Pop One', sans-serif", "dot-matrix"],
  ["'Red Hat Display', sans-serif", "'Science Gothic', sans-serif", "funnel-weights"],
  ["'Inter Tight', sans-serif", "'Sora', sans-serif", "swiss-light"],
  ["'Space Grotesk', sans-serif", "'Chakra Petch', sans-serif", "independent-grotesk"],
  ["'Bricolage Grotesque', sans-serif", "'Dela Gothic One', sans-serif", "sculpted-contrast"],
  ["'Chivo', sans-serif", "'Anybody', sans-serif", "editorial-dark"],
  ["'Rethink Sans', sans-serif", "'Archivo Black', sans-serif", "open-proportions"],
  ["'Onest', sans-serif", "'Gabarito', sans-serif", "swiss-light"],
  ["'Schibsted Grotesk', sans-serif", "'Space Mono', monospace", "wide-technical"],
  ["'Figtree', sans-serif", "'Climate Crisis', sans-serif", "dot-matrix"],
  ["'Lexend', sans-serif", "'Urbanist', sans-serif", "funnel-weights"],
  ["'Inter Tight', sans-serif", "'Instrument Serif', serif", "swiss-light"],
  ["'Space Grotesk', sans-serif", "'DotGothic16', sans-serif", "independent-grotesk"],
  ["'Bricolage Grotesque', sans-serif", "'Fraunces', serif", "sculpted-contrast"],
  ["'Chivo', sans-serif", "'Cormorant Garamond', serif", "editorial-dark"],
  ["'Plus Jakarta Sans', sans-serif", "'Playfair Display', serif", "open-proportions"],
  ["'Outfit', sans-serif", "'JetBrains Mono', monospace", "swiss-light"],
  ["'Epilogue', sans-serif", "'IBM Plex Mono', monospace", "wide-technical"],
  ["'Manrope', sans-serif", "'Instrument Serif', serif", "dot-matrix"],
  ["'Unbounded', sans-serif", "'Newsreader', serif", "funnel-weights"],
] as const;
export function upgradeFontPreferences(fonts: FontPreferences): FontPreferences {
  if (fonts.sectionFont || fonts.supportingFont) return fonts;
  if (fonts.headingFont === "'Northern', sans-serif") {
    return { ...fonts, headingFont: "'Exotica', sans-serif" };
  }
  if (fonts.headingFont === "'ZT Otez', serif") {
    return { ...fonts, headingFont: "'Moche', sans-serif" };
  }
  if (
    fonts.headingFont === "'Ductile Display', sans-serif" ||
    fonts.headingFont === "'Mantranaga 36DOT', sans-serif" ||
    fonts.headingFont === "'Darker Grotesque', sans-serif"
  ) {
    return { ...fonts, headingFont: "'Hashira Mt', serif" };
  }
  const previous = PREVIOUS_FONT_COMBOS.find(
    ([ui, heading]) => ui === fonts.uiFont && heading === fonts.headingFont,
  );
  const replacement = previous && FONT_COMBOS.find((combo) => combo.id === previous[2]);
  return replacement
    ? { ...fonts, uiFont: replacement.uiFont, headingFont: replacement.headingFont }
    : fonts;
}

export function getFontComboPageHeading(combo: FontCombo, fonts?: FontPreferences) {
  const keepInterfaceHeading =
    combo.id === "syne-dropped" || (combo.isNeutral && combo.id !== "custom");
  const typography =
    combo.id === "custom" && fonts ? resolveFontTypography(fonts) : combo.typography;
  return {
    className: keepInterfaceHeading ? combo.sansClass : combo.serifClass,
    fontFamily: keepInterfaceHeading ? "var(--font-sans)" : "var(--font-display)",
    fontSize: [
      "'Hebdomadal', sans-serif",
      "'Culont', sans-serif",
      "'KS Bistra', sans-serif",
      "'Exotica', sans-serif",
      "'Mirano', sans-serif",
      "'Darker Grotesque', sans-serif",
      "'Hashira Mt', serif",
    ].includes(fonts?.headingFont ?? combo.headingFont)
      ? "40px"
      : undefined,
    ...(typography
      ? {
          fontWeight: typography.headingWeight,
          letterSpacing: typography.headingTracking,
          textTransform: typography.headingTransform,
        }
      : { fontWeight: undefined, letterSpacing: undefined, textTransform: "capitalize" as const }),
  };
}

export function getActiveFontCombo(fonts: FontPreferences): FontCombo {
  const fullPreset = FONT_COMBOS.find(
    (combo) =>
      combo.fonts &&
      combo.uiFont === fonts.uiFont &&
      combo.headingFont === fonts.headingFont &&
      combo.fonts.sectionFont === fonts.sectionFont &&
      combo.fonts.supportingFont === fonts.supportingFont,
  );
  if (fullPreset) return fullPreset;
  const headingPreset =
    !fonts.sectionFont &&
    FONT_COMBOS.find((combo) => combo.headingOnly && combo.headingFont === fonts.headingFont);
  if (headingPreset) return headingPreset;
  if (fonts.sectionFont || fonts.supportingFont) return FONT_COMBOS.find((c) => c.id === "custom")!;
  const match = FONT_COMBOS.find(
    (c) => c.uiFont === fonts.uiFont && c.headingFont === fonts.headingFont,
  );
  return match ?? FONT_COMBOS.find((c) => c.id === "custom")!;
}

/** Resolve each text role separately, including mixtures that are not named presets. */
export function resolveFontTypography(fonts: FontPreferences) {
  const combo = getActiveFontCombo(fonts);
  const preset = combo.typography;
  const display =
    preset ?? FONT_COMBOS.find((c) => c.headingFont === fonts.headingFont)?.typography;
  const sectionFont = fonts.sectionFont ?? preset?.sectionFont ?? fonts.headingFont;
  const section = FONT_COMBOS.find((c) => c.typography?.sectionFont === sectionFont)?.typography;
  const isSerifSection =
    sectionFont.includes("Newsreader") || sectionFont.includes("Instrument Serif");
  const supportingFont =
    fonts.supportingFont ??
    (combo.headingOnly ? fonts.uiFont : (preset?.supportingFont ?? fonts.uiFont));
  return {
    headingWeight:
      display?.headingWeight ??
      (fonts.headingFont.includes("Serif") || fonts.headingFont.includes("Newsreader") ? 400 : 700),
    headingTracking: display?.headingTracking ?? "-.025em",
    headingTransform: display?.headingTransform ?? ("none" as const),
    sectionFont,
    sectionWeight:
      preset && !fonts.sectionFont
        ? preset.sectionWeight
        : (section?.sectionWeight ?? (isSerifSection ? 400 : 600)),
    sectionStyle:
      preset && !fonts.sectionFont
        ? preset.sectionStyle
        : isSerifSection
          ? ("italic" as const)
          : ("normal" as const),
    sectionTransform: preset && !fonts.sectionFont ? preset.sectionTransform : ("none" as const),
    sectionTracking: preset && !fonts.sectionFont ? preset.sectionTracking : "-.015em",
    rowFont: combo.headingOnly || combo.fonts ? fonts.uiFont : (preset?.rowFont ?? fonts.uiFont),
    rowWeight: combo.headingOnly || combo.fonts ? 700 : (preset?.rowWeight ?? 700),
    controlsFont:
      combo.headingOnly || combo.fonts ? fonts.uiFont : (preset?.controlsFont ?? fonts.uiFont),
    metadataFont:
      combo.headingOnly || combo.fonts ? fonts.uiFont : (preset?.metadataFont ?? fonts.uiFont),
    supportingFont,
    supportingStyle: fonts.supportingFont
      ? supportingFont.includes("Newsreader") || supportingFont.includes("Instrument Serif")
        ? ("italic" as const)
        : ("normal" as const)
      : (preset?.supportingStyle ?? ("normal" as const)),
  };
}

export function prepareCustomFontPreferences(fonts: FontPreferences): FontPreferences {
  const resolved = resolveFontTypography(fonts);
  return {
    ...fonts,
    headingFont: getActiveFontCombo(fonts).id === "syne-dropped" ? fonts.uiFont : fonts.headingFont,
    sectionFont: resolved.sectionFont,
    supportingFont: resolved.supportingFont,
  };
}

/** Heading presets preserve body/code preferences; full presets apply their explicit roles. */
export function selectFontCombo(fonts: FontPreferences, combo: FontCombo): FontPreferences {
  if (combo.headingOnly)
    return { ...fonts, headingFont: combo.headingFont, sectionFont: undefined };
  return {
    ...fonts,
    uiFont: combo.uiFont,
    headingFont: combo.headingFont,
    sectionFont: undefined,
    supportingFont: undefined,
    ...combo.fonts,
  };
}

export const MIXER_FONT_OPTIONS = Array.from(
  new Map(
    [
      ...UI_FONT_OPTIONS,
      ...HEADING_FONT_OPTIONS,
      { value: "'Geist Mono', monospace", label: "Geist Mono" },
      { value: "'Fragment Mono', monospace", label: "Fragment Mono" },
    ].map((f) => [
      f.value,
      { value: f.value, label: f.value === "system-ui" ? "System UI" : f.label },
    ]),
  ).values(),
);

// Color utilities re-exported from @tabs/shared/themeDerivation above.

/**
 * Converts a hex color to HSV (Hue 0-360, Saturation 0-1, Value 0-1).
 */
export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  let clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (clean.length !== 6 && clean.length !== 8) return { h: 220, s: 0.8, v: 0.8 };

  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }

  const s = max === 0 ? 0 : d / max;
  const v = max;

  return { h: Math.round(h), s, v };
}

/**
 * Converts HSV (Hue 0-360, Saturation 0-1, Value 0-1) to hex string `#RRGGBB`.
 */
export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0,
    g = 0,
    b = 0;
  if (h >= 0 && h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h >= 60 && h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h >= 180 && h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h >= 240 && h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }

  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Converts a hex color to RGB integers { r, g, b }.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (clean.length !== 6 && clean.length !== 8) return { r: 99, g: 102, b: 241 };

  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

/**
 * Converts RGB integers to hex string `#RRGGBB`.
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export const DEFAULT_THEME_ID: ThemeId = "tabs-dark";
