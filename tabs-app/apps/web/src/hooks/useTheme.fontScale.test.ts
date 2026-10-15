import { describe, expect, it, vi } from "vitest";

import { applyInterfaceFontSize, getStoredFontPreferences } from "./useTheme";
import { FONT_COMBOS } from "../lib/themes";

describe("interface font scaling", () => {
  it("does not redefine the root rem unit", () => {
    const setProperty = vi.fn();
    const removeProperty = vi.fn();
    const style = { setProperty, removeProperty } as unknown as CSSStyleDeclaration;

    applyInterfaceFontSize(style, 13);

    expect(setProperty).toHaveBeenCalledWith("--font-size-interface", "13px");
    expect(removeProperty).toHaveBeenCalledWith("font-size");
  });
});

describe("stored font preferences", () => {
  it("restores a selected combo when client settings contain an older font", () => {
    const combo = FONT_COMBOS.find((item) => item.id === "funnel-weights")!;
    const stored = new Map([
      ["tabs:client-settings:v1", JSON.stringify({ fontFamilySans: "'Syne', sans-serif" })],
      [
        "tabs:font-preferences",
        JSON.stringify({ uiFont: combo.uiFont, headingFont: combo.headingFont }),
      ],
    ]);
    const originalStorage = globalThis.localStorage;
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null });

    try {
      const preferences = getStoredFontPreferences();
      expect(preferences.uiFont).toBe(combo.uiFont);
      expect(preferences.headingFont).toBe(combo.headingFont);
    } finally {
      vi.stubGlobal("localStorage", originalStorage);
    }
  });
});

it("restores independent typography roles from storage", () => {
  const custom = {
    uiFont: "'Syne', sans-serif",
    headingFont: "'Coconat', serif",
    sectionFont: "'Parkinsans', sans-serif",
    supportingFont: "'Absans', sans-serif",
    editorFont: "Menlo",
  };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === "tabs:font-preferences" ? JSON.stringify(custom) : null),
  });
  try {
    expect(getStoredFontPreferences()).toMatchObject(custom);
  } finally {
    vi.unstubAllGlobals();
  }
});
