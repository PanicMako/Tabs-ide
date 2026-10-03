import { describe, expect, it } from "vitest";
import {
  exportCustomThemeAsJson,
  humanizeThemeName,
  isVsCodeThemeFile,
  MAX_THEME_FILE_BYTES,
  parseNativeTheme,
  parseVsCodeTheme,
  safeRecoverTheme,
  validateAndParseThemeString,
} from "./themeImportExport.ts";
import type { CustomThemeConfig } from "./themeDerivation.ts";

describe("themeImportExport", () => {
  const sampleConfig: CustomThemeConfig = {
    baseVariant: "dark",
    colors: {
      background: "#121212",
      card: "#1e1e1e",
      foreground: "#ffffff",
      border: "#333333",
      primary: "#3b82f6",
    },
    fonts: {
      uiFont: "Inter",
      editorFont: "Fira Code",
      headingFont: "Instrument Serif",
    },
    tokenOverrides: {
      "editor.selectionBackground": "#3b82f640",
    },
  };

  it("humanizes theme filenames and slugs into readable titles", () => {
    expect(humanizeThemeName("one-dark-pro-color-theme.json")).toBe("One Dark Pro");
    expect(humanizeThemeName("catppuccin_mocha")).toBe("Catppuccin Mocha");
    expect(humanizeThemeName("TokyoNight")).toBe("TokyoNight");
    expect(humanizeThemeName("")).toBe("Custom Theme");
  });

  it("detects VS Code theme files from dotted workbench keys or tokenColors", () => {
    expect(
      isVsCodeThemeFile({
        colors: {
          "editor.background": "#1e1e1e",
          "editor.foreground": "#d4d4d4",
        },
      }),
    ).toBe(true);

    expect(
      isVsCodeThemeFile({
        tokenColors: [{ scope: "comment", settings: { foreground: "#6a9955" } }],
      }),
    ).toBe(true);

    expect(
      isVsCodeThemeFile({
        schema: "tabs:custom-theme:v1",
        colors: { background: "#1e1e1e" },
      }),
    ).toBe(false);

    expect(isVsCodeThemeFile(null)).toBe(false);
  });

  it("parses a VS Code theme into a valid CustomThemeConfig", () => {
    const vsCodeTheme = {
      name: "cyberpunk-neon-color-theme",
      type: "dark",
      colors: {
        "editor.background": "#0d0221",
        "sideBar.background": "#0f084b",
        "editor.foreground": "#ffffff",
        "sideBar.border": "#26408b",
        "button.background": "#ff007f",
        "editor.selectionBackground": "#ff007f40",
      },
    };

    const { name, config } = parseVsCodeTheme(vsCodeTheme);
    expect(name).toBe("Cyberpunk Neon");
    expect(config.baseVariant).toBe("dark");
    expect(config.colors.background).toBe("#0d0221");
    expect(config.colors.card).toBe("#0f084b");
    expect(config.colors.primary).toBe("#ff007f");
    expect(config.tokenOverrides?.["editor.selectionBackground"]).toBe("#ff007f40");
  });

  it("derives dark vs light variant from background luminance when type is omitted in VS Code theme", () => {
    const lightTheme = {
      name: "clean-white",
      colors: {
        "editor.background": "#fdfdfd",
        "editor.foreground": "#111111",
        "button.background": "#0066cc",
      },
    };
    const { config } = parseVsCodeTheme(lightTheme);
    expect(config.baseVariant).toBe("light");
  });

  it("parses native Tabs theme format", () => {
    const nativeJson = {
      schema: "tabs:custom-theme:v1",
      name: "Nordic Frost",
      baseVariant: "dark",
      colors: {
        background: "#2e3440",
        card: "#3b4252",
        foreground: "#eceff4",
        border: "#4c566a",
        primary: "#88c0d0",
      },
      fonts: {
        uiFont: "Outfit",
        editorFont: "JetBrains Mono",
      },
    };

    const { name, config } = parseNativeTheme(nativeJson);
    expect(name).toBe("Nordic Frost");
    expect(config.baseVariant).toBe("dark");
    expect(config.colors.background).toBe("#2e3440");
    expect(config.fonts.uiFont).toBe("Outfit");
  });

  it("parses T3 Code theme palette format", () => {
    const t3Json = {
      label: "Amber Glow",
      appearance: "dark",
      colors: {
        canvas: "#18130e",
        secondaryBackground: "#241d15",
        text: "#fff8f0",
        border: "#3d3023",
        accent: "#f59e0b",
      },
    };

    const { name, config } = parseNativeTheme(t3Json);
    expect(name).toBe("Amber Glow");
    expect(config.baseVariant).toBe("dark");
    expect(config.colors.background).toBe("#18130e");
    expect(config.colors.card).toBe("#241d15");
    expect(config.colors.primary).toBe("#f59e0b");
  });

  it("exports custom theme config as formatted JSON and roundtrips through parser", () => {
    const jsonStr = exportCustomThemeAsJson(sampleConfig, "Sample Theme");
    const result = validateAndParseThemeString(jsonStr);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.name).toBe("Sample Theme");
      expect(result.config.baseVariant).toBe("dark");
      expect(result.config.colors.background).toBe("#121212");
      expect(result.config.colors.primary).toBe("#3b82f6");
      expect(result.config.fonts.uiFont).toBe("Inter");
      expect(result.config.fonts.headingFont).toBe("Instrument Serif");
      expect(result.config.tokenOverrides?.["editor.selectionBackground"]).toBe("#3b82f640");
    }
  });

  it("parseNativeTheme correctly reads headingFont from the fonts block", () => {
    const nativeJson = {
      schema: "tabs:custom-theme:v1",
      name: "Syne Dropped",
      baseVariant: "dark",
      colors: {
        background: "#090d16",
        card: "#111827",
        foreground: "#f9fafb",
        border: "#1f2937",
        primary: "#6366f1",
      },
      fonts: {
        uiFont: "'Syne', sans-serif",
        editorFont: "Menlo",
        headingFont: "'Newsreader', serif",
      },
    };
    const { name, config } = parseNativeTheme(nativeJson);
    expect(name).toBe("Syne Dropped");
    expect(config.fonts.uiFont).toBe("'Syne', sans-serif");
    expect(config.fonts.headingFont).toBe("'Newsreader', serif");
    expect(config.fonts.editorFont).toBe("Menlo");
  });

  it("rejects empty or whitespace-only inputs", () => {
    const result = validateAndParseThemeString("   ");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("empty");
    }
  });

  it("rejects oversized inputs (> 256 KB) safely before processing", () => {
    const hugeString = "a".repeat(MAX_THEME_FILE_BYTES + 10);
    const result = validateAndParseThemeString(hugeString);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("too large");
    }
  });

  it("reports clear syntax errors on invalid JSON", () => {
    const result = validateAndParseThemeString("{ colors: not json }");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Invalid JSON syntax");
    }
  });

  it("safeRecoverTheme heals malformed or partial objects back to valid configs", () => {
    const corrupted = {
      baseVariant: "invalid-variant",
      colors: {
        background: "not-a-color",
        // other colors completely missing
      },
    };

    const recovered = safeRecoverTheme(corrupted);
    expect(recovered.baseVariant).toBe("dark");
    expect(recovered.colors.background).toBe("#141414"); // Fell back to valid default
    expect(recovered.colors.card).toBe("#181818");
    expect(recovered.colors.primary).toBe("#366ffb");
    expect(recovered.fonts.uiFont).toBeDefined();
  });
});
