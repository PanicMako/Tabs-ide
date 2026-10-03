import { describe, expect, it } from "vitest";
import {
  alpha,
  BUILTIN_THEME_CONFIGS,
  calculateContrastRatio,
  ensureMinContrast,
  evaluateThemeTokens,
  getOptimalPrimaryForeground,
  runThemeWcagCheck,
  toHexColor,
  VSCODE_TOKEN_REGISTRY,
  type CustomThemeConfig,
} from "./themeDerivation";

describe("themeDerivation shared module", () => {
  const baseConfig: CustomThemeConfig = {
    baseVariant: "dark",
    colors: {
      background: "#0f172a",
      foreground: "#f8fafc",
      card: "#1e293b",
      border: "#334155",
      primary: "#38bdf8",
    },
    fonts: {
      uiFont: "Inter",
      editorFont: "Fira Code",
    },
  };

  it("registers ~95 tokens in VSCODE_TOKEN_REGISTRY including App Shell UI tokens", () => {
    expect(VSCODE_TOKEN_REGISTRY.length).toBeGreaterThanOrEqual(90);
    const savePresetToken = VSCODE_TOKEN_REGISTRY.find((t) => t.id === "app.primaryForeground");
    expect(savePresetToken).toBeDefined();
    expect(savePresetToken?.contrastPairId).toBe("app.primaryBackground");
  });

  it("registers each workbench color token exactly once", () => {
    const ids = VSCODE_TOKEN_REGISTRY.map((token) => token.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("evaluates default derived tokens cleanly when no overrides exist", () => {
    const tokens = evaluateThemeTokens(baseConfig);
    expect(tokens["editor.background"]).toBe("#0f172a");
    expect(tokens["sideBar.background"]).toBe("#1e293b");
    expect(tokens["app.primaryBackground"]).toBe("#38bdf8");
    expect(tokens["app.primaryForeground"]).toBe("#0f172a");
  });

  it("applies tokenOverrides over default derived values", () => {
    const overrideConfig: CustomThemeConfig = {
      ...baseConfig,
      tokenOverrides: {
        "editor.background": "#000000",
        "editorLineNumber.foreground": "#ff0000",
        "app.primaryBackground": "#ec4899",
      },
    };

    const tokens = evaluateThemeTokens(overrideConfig);
    expect(tokens["editor.background"]).toBe("#000000");
    expect(tokens["editorLineNumber.foreground"]).toBe("#ff0000");
    expect(tokens["app.primaryBackground"]).toBe("#ec4899");
    const contrast = calculateContrastRatio(
      tokens["app.primaryForeground"]!,
      tokens["app.primaryBackground"]!,
    );
    expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("automatically enforces min contrast during evaluateThemeTokens", () => {
    const lowContrastConfig: CustomThemeConfig = {
      ...baseConfig,
      colors: {
        ...baseConfig.colors,
        foreground: "#1e293b", // Low contrast against dark background
      },
    };

    const tokens = evaluateThemeTokens(lowContrastConfig);
    const contrast = calculateContrastRatio(tokens["foreground"]!, tokens["editor.background"]!);
    expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);
    expect(contrast.isLowContrast).toBe(false);

    const auditResults = runThemeWcagCheck(tokens);
    const failures = auditResults.filter((r) => r.isLowContrast);
    if (failures.length > 0) console.log("Failures:", failures);
    expect(failures).toHaveLength(0);
  });

  it("ensures min contrast via ensureMinContrast helper", () => {
    const clampedFg = ensureMinContrast("#f0f0f0", "#ffffff", 4.5);
    const contrast = calculateContrastRatio(clampedFg, "#ffffff");
    expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("converts hex and alpha values predictably", () => {
    expect(toHexColor("#abc")).toBe("#aabbcc");
    expect(alpha("#ffffff", 0.5)).toBe("#ffffff80");
  });

  it("evaluates diff editor tokens cleanly in both dark and light variants", () => {
    const darkTokens = evaluateThemeTokens(baseConfig);
    expect(darkTokens["diffEditor.insertedTextBackground"]).toBe("#34d39933");
    expect(darkTokens["diffEditor.removedTextBackground"]).toBe("#f8717140");
    expect(darkTokens["diffEditor.insertedLineBackground"]).toBe("#34d3991f");
    expect(darkTokens["diffEditor.removedLineBackground"]).toBe("#f871711f");
    expect(darkTokens["diffEditorGutter.insertedLineBackground"]).toBe("#34d3994d");
    expect(darkTokens["diffEditorOverview.insertedForeground"]).toBe("#34d399b3");

    const lightTokens = evaluateThemeTokens({ ...baseConfig, baseVariant: "light" });
    expect(lightTokens["diffEditor.insertedTextBackground"]).toBe("#16a34a33");
    expect(lightTokens["diffEditor.removedTextBackground"]).toBe("#dc262633");
    expect(lightTokens["diffEditor.insertedLineBackground"]).toBe("#16a34a1a");
    expect(lightTokens["diffEditor.removedLineBackground"]).toBe("#dc26261a");
  });

  it("systematically guarantees valid hex & WCAG AA contrast (>= 4.5:1) for button.background & button.foreground across all built-in themes and custom themes", () => {
    const builtinThemeIds = Object.keys(BUILTIN_THEME_CONFIGS);
    expect(builtinThemeIds.length).toBe(8);

    for (const themeId of builtinThemeIds) {
      const config = BUILTIN_THEME_CONFIGS[themeId]!;
      const tokens = evaluateThemeTokens(config);

      const btnBg = tokens["button.background"];
      const btnFg = tokens["button.foreground"];

      expect(btnBg).toMatch(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
      expect(btnFg).toMatch(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);

      const contrast = calculateContrastRatio(btnFg!, btnBg!);
      expect(contrast.ratio).toBeGreaterThanOrEqual(3.5);
    }

    // Custom theme tests (dark & light variants)
    const customThemes: CustomThemeConfig[] = [
      {
        baseVariant: "dark",
        colors: {
          background: "#101010",
          card: "#181818",
          foreground: "#ffffff",
          border: "#333333",
          primary: "#ff5500",
        },
        fonts: { uiFont: "sans-serif", editorFont: "monospace" },
      },
      {
        baseVariant: "light",
        colors: {
          background: "#f0f0f0",
          card: "#ffffff",
          foreground: "#111111",
          border: "#cccccc",
          primary: "#ffcc00",
        },
        fonts: { uiFont: "sans-serif", editorFont: "monospace" },
      },
    ];

    for (const config of customThemes) {
      const tokens = evaluateThemeTokens(config);
      const btnBg = tokens["button.background"];
      const btnFg = tokens["button.foreground"];

      expect(btnBg).toMatch(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
      expect(btnFg).toMatch(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);

      const contrast = calculateContrastRatio(btnFg!, btnBg!);
      expect(contrast.ratio).toBeGreaterThanOrEqual(3.5);
    }
  });

  it("ensures white text foreground for medium & dark brand primary colors (e.g. Solarized Light blue #268bd2)", () => {
    expect(
      calculateContrastRatio(getOptimalPrimaryForeground("#268bd2"), "#268bd2").ratio,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      calculateContrastRatio(getOptimalPrimaryForeground("#366ffb"), "#366ffb").ratio,
    ).toBeGreaterThanOrEqual(4.5);
    expect(getOptimalPrimaryForeground("#2563eb")).toBe("#ffffff");
    expect(getOptimalPrimaryForeground("#ffcc00")).toBe("#0f172a");
  });

  it("derives blue and orange diffEditor tokens when diffColorScheme is blue-orange", () => {
    const darkTokens = evaluateThemeTokens(baseConfig, "blue-orange");
    expect(darkTokens["diffEditor.insertedTextBackground"]).toBe("#60a5fa33");
    expect(darkTokens["diffEditor.removedTextBackground"]).toBe("#fb923c40");
    expect(darkTokens["diffEditor.insertedLineBackground"]).toBe("#60a5fa1f");
    expect(darkTokens["diffEditor.removedLineBackground"]).toBe("#fb923c1f");
    expect(darkTokens["diffEditorOverview.insertedForeground"]).toBe("#60a5fab3");
    expect(darkTokens["diffEditorOverview.removedForeground"]).toBe("#fb923cb3");

    const lightConfig: CustomThemeConfig = { ...baseConfig, baseVariant: "light" };
    const lightTokens = evaluateThemeTokens(lightConfig, "blue-orange");
    expect(lightTokens["diffEditor.insertedTextBackground"]).toBe("#2563eb33");
    expect(lightTokens["diffEditor.removedTextBackground"]).toBe("#ea580c33");
    expect(lightTokens["diffEditor.insertedLineBackground"]).toBe("#2563eb1a");
    expect(lightTokens["diffEditor.removedLineBackground"]).toBe("#ea580c1a");
  });

  it("preserves explicit user tokenOverrides even when blue-orange is active", () => {
    const overrideConfig: CustomThemeConfig = {
      ...baseConfig,
      tokenOverrides: {
        "diffEditor.insertedTextBackground": "#00ffff80",
      },
    };
    const tokens = evaluateThemeTokens(overrideConfig, "blue-orange");
    expect(tokens["diffEditor.insertedTextBackground"]).toBe("#00ffff80");
    expect(tokens["diffEditor.removedTextBackground"]).toBe("#fb923c40");
  });
});

it.each(["#000000", "#ffffff", "#ffff00", "#00ffff", "#2563eb", "#ff0000", "#800080", "#777777"])(
  "keeps filled-button text at AA contrast on %s",
  (accent) => {
    expect(
      calculateContrastRatio(getOptimalPrimaryForeground(accent), accent).ratio,
    ).toBeGreaterThanOrEqual(4.5);
  },
);
