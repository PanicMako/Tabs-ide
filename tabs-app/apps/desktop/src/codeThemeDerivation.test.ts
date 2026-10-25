import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { evaluateThemeTokens, type CustomThemeConfig } from "@tabs/shared/themeDerivation";

const require = createRequire(import.meta.url);
const embeddedTheme =
  require("../resources/code-oss-extensions/tabs-workbench-integration/themeDerivation.js") as {
    evaluateThemeTokens: typeof evaluateThemeTokens;
  };

it.each(["#eee8d5", "#181818"])(
  "keeps embedded and shell status-bar colors aligned across focus changes on %s",
  (card) => {
    const config: CustomThemeConfig = {
      baseVariant: "dark",
      colors: {
        background: "#121212",
        foreground: "#eeeeee",
        card,
        border: "#333333",
        primary: "#268bd2",
      },
      fonts: { uiFont: "Inter", editorFont: "Menlo" },
    };
    const native = embeddedTheme.evaluateThemeTokens(config);
    const shell = evaluateThemeTokens(config);
    for (const token of ["statusBar.background", "statusBar.inactiveBackground"]) {
      expect(native[token]).toBe(card);
      expect(native[token]).toBe(shell[token]);
    }
  },
);
