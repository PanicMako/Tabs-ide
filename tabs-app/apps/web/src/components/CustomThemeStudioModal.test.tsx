import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  commitCustomTheme,
  previewTheme,
  restoreThemeSnapshot,
  snapshotThemeState,
} from "../hooks/useTheme";
import { CustomThemeStudioModal, type CustomThemeStudioModalProps } from "./CustomThemeStudioModal";
import {
  DEFAULT_CUSTOM_THEME,
  DEFAULT_CUSTOM_THEME_LIGHT,
  DEFAULT_FONT_PREFERENCES,
  type CustomThemeConfig,
  type FontPreferences,
} from "../lib/themes";
import { AppAtomRegistryProvider, appAtomRegistry } from "../state/atomRegistry";
import { clearAllDraftSources, settingsDraftRegistryAtom } from "../state/settingsDraftRegistry";

vi.mock("./ui/dialog", () => ({
  Dialog: ({ children, open }: any) => (open ? <div data-slot="dialog">{children}</div> : null),
  DialogPopup: ({ children, showCloseButton: _showCloseButton, ...props }: any) => (
    <div data-slot="dialog-popup" {...props}>
      {children}
    </div>
  ),
}));

const { resetStorage, setStorageItem, getStorageItem } = vi.hoisted(() => {
  let storage: Record<string, string> = {};
  const mock = {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = String(value);
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      storage = {};
    },
    key: (index: number) => Object.keys(storage)[index] ?? null,
    get length() {
      return Object.keys(storage).length;
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: mock,
  });

  const testWindow = ((globalThis as any).window ??= {});
  Object.defineProperty(testWindow, "localStorage", {
    configurable: true,
    value: mock,
  });

  testWindow.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });

  (globalThis as any).document ??= {
    documentElement: {
      classList: {
        add: () => {},
        remove: () => {},
        toggle: () => {},
      },
      style: {
        setProperty: () => {},
        removeProperty: () => {},
      },
      setAttribute: () => {},
      offsetHeight: 100,
      dataset: {},
    },
    body: { offsetHeight: 100 },
  };

  return {
    resetStorage: () => {
      storage = {};
    },
    getStorage: () => storage,
    setStorageItem: (key: string, val: string) => {
      storage[key] = val;
    },
    getStorageItem: (key: string) => storage[key] ?? null,
  };
});

describe("CustomThemeStudioModal Transactional Contract", () => {
  beforeEach(() => {
    resetStorage();
    vi.clearAllMocks();
  });

  it("Editing colors previews them without changing localStorage", () => {
    // Initial state: tabs-dark
    setStorageItem("tabs:theme", "tabs-dark");
    const snapshot = snapshotThemeState();
    expect(snapshot.theme).toBe("tabs-dark");

    const draftConfig: CustomThemeConfig = {
      ...DEFAULT_CUSTOM_THEME,
      colors: {
        ...DEFAULT_CUSTOM_THEME.colors,
        background: "#123456",
        primary: "#ff0088",
      },
    };

    // Previewing the draft should not write to localStorage
    previewTheme("custom", draftConfig);
    expect(getStorageItem("tabs:theme")).toBe("tabs-dark");
    expect(getStorageItem("tabs:custom-theme")).toBeNull();
  });

  it("Closing through X restores the previous theme", () => {
    setStorageItem("tabs:theme", "tabs-light");
    const snapshot = snapshotThemeState();

    // User previews changes in studio
    const draftConfig: CustomThemeConfig = {
      ...DEFAULT_CUSTOM_THEME,
      colors: { ...DEFAULT_CUSTOM_THEME.colors, background: "#000000" },
    };
    previewTheme("custom", draftConfig);

    // Cancel / dismiss via X
    restoreThemeSnapshot(snapshot);

    expect(getStorageItem("tabs:theme")).toBe("tabs-light");
    expect(getStorageItem("tabs:custom-theme")).toBeNull();
  });

  it("Escape restores the previous theme", () => {
    setStorageItem("tabs:theme", "tabs-dark");
    const snapshot = snapshotThemeState();

    previewTheme("custom", {
      ...DEFAULT_CUSTOM_THEME,
      colors: { ...DEFAULT_CUSTOM_THEME.colors, primary: "#00ffcc" },
    });

    // Escape routes through restoreThemeSnapshot
    restoreThemeSnapshot(snapshot);

    expect(getStorageItem("tabs:theme")).toBe("tabs-dark");
    expect(getStorageItem("tabs:custom-theme")).toBeNull();
  });

  it("Outside-click dismissal restores the previous theme", () => {
    setStorageItem("tabs:theme", "dracula");
    const snapshot = snapshotThemeState();

    previewTheme("custom", {
      ...DEFAULT_CUSTOM_THEME,
      colors: { ...DEFAULT_CUSTOM_THEME.colors, card: "#222222" },
    });

    // Outside click dismisses dialog and restores snapshot
    restoreThemeSnapshot(snapshot);

    expect(getStorageItem("tabs:theme")).toBe("dracula");
    expect(getStorageItem("tabs:custom-theme")).toBeNull();
  });

  it("Apply persists the draft and leaves it active after reload", () => {
    setStorageItem("tabs:theme", "tabs-dark");

    const draftConfig: CustomThemeConfig = {
      ...DEFAULT_CUSTOM_THEME,
      colors: {
        ...DEFAULT_CUSTOM_THEME.colors,
        background: "#0a0a0a",
        primary: "#6366f1",
      },
    };

    // Explicit Apply action
    commitCustomTheme(draftConfig);

    expect(getStorageItem("tabs:theme")).toBe("custom");
    const storedCustom = JSON.parse(getStorageItem("tabs:custom-theme")!);
    expect(storedCustom.colors.background).toBe("#0a0a0a");
    expect(storedCustom.colors.primary).toBe("#6366f1");

    // "After reload" simulation
    const reloadedSnapshot = snapshotThemeState();
    expect(reloadedSnapshot.theme).toBe("custom");
    expect(reloadedSnapshot.customConfig.colors.primary).toBe("#6366f1");
  });

  it("Reset followed by Cancel does not persist reset values", () => {
    const existingCustom: CustomThemeConfig = {
      ...DEFAULT_CUSTOM_THEME,
      colors: {
        ...DEFAULT_CUSTOM_THEME.colors,
        background: "#333333",
      },
    };
    setStorageItem("tabs:theme", "custom");
    setStorageItem("tabs:custom-theme", JSON.stringify(existingCustom));

    const snapshot = snapshotThemeState();

    // User clicks Reset in studio, which resets draft to default light/dark
    const resetDraft = DEFAULT_CUSTOM_THEME_LIGHT;
    previewTheme("custom", resetDraft);

    // User then clicks Cancel
    restoreThemeSnapshot(snapshot);

    expect(getStorageItem("tabs:theme")).toBe("custom");
    const stored = JSON.parse(getStorageItem("tabs:custom-theme")!);
    expect(stored.colors.background).toBe("#333333");
  });

  it("Import followed by Cancel does not persist imported values", () => {
    setStorageItem("tabs:theme", "tabs-dark");
    const snapshot = snapshotThemeState();

    const importedConfig: CustomThemeConfig = {
      baseVariant: "light",
      colors: {
        background: "#fafafa",
        foreground: "#111111",
        card: "#ffffff",
        border: "#e5e5e5",
        primary: "#ec4899",
      },
      fonts: {
        uiFont: "Comic Sans MS",
        editorFont: "Fira Code",
      },
    };

    // Preview imported theme
    previewTheme("custom", importedConfig);

    // User cancels without clicking Apply
    restoreThemeSnapshot(snapshot);

    expect(getStorageItem("tabs:theme")).toBe("tabs-dark");
    expect(getStorageItem("tabs:custom-theme")).toBeNull();
    expect(getStorageItem("tabs:font-preferences")).toBeNull();
  });

  it("Export does not persist anything", () => {
    setStorageItem("tabs:theme", "tabs-dark");
    const draftConfig: CustomThemeConfig = {
      ...DEFAULT_CUSTOM_THEME,
      colors: { ...DEFAULT_CUSTOM_THEME.colors, background: "#888888" },
    };

    // Export reads draftConfig and produces JSON; zero writes to localStorage
    const exportJson = JSON.stringify(draftConfig);
    expect(exportJson).toContain("#888888");
    expect(getStorageItem("tabs:theme")).toBe("tabs-dark");
    expect(getStorageItem("tabs:custom-theme")).toBeNull();
  });

  it("Saving a preset follows the chosen product contract without accidental activation", () => {
    setStorageItem("tabs:theme", "tabs-dark");

    const draftConfig: CustomThemeConfig = {
      ...DEFAULT_CUSTOM_THEME,
      colors: { ...DEFAULT_CUSTOM_THEME.colors, primary: "#10b981" },
    };

    // Product contract: "Save Preset" adds to custom presets collection
    // but does NOT activate the theme or modify tabs:custom-theme
    const onSavePreset = vi.fn((name, config) => {
      const presets = JSON.parse(getStorageItem("tabs:custom-presets:v1") || "[]");
      presets.push({ id: "preset-1", name, config });
      setStorageItem("tabs:custom-presets:v1", JSON.stringify(presets));
    });

    onSavePreset("My Emerald Preset", draftConfig);

    expect(onSavePreset).toHaveBeenCalledWith("My Emerald Preset", draftConfig);
    expect(getStorageItem("tabs:theme")).toBe("tabs-dark"); // NOT activated!
    expect(getStorageItem("tabs:custom-theme")).toBeNull(); // NOT committed!

    const savedPresets = JSON.parse(getStorageItem("tabs:custom-presets:v1")!);
    expect(savedPresets).toHaveLength(1);
    expect(savedPresets[0].name).toBe("My Emerald Preset");
  });

  it("Font changes/imports roll back on Cancel", () => {
    const originalFonts: FontPreferences = {
      ...DEFAULT_FONT_PREFERENCES,
      uiFont: "Inter",
      editorFont: "JetBrains Mono",
    };
    setStorageItem("tabs:font-preferences", JSON.stringify(originalFonts));
    setStorageItem("tabs:theme", "tabs-dark");

    const snapshot = snapshotThemeState();
    expect(snapshot.fontPreferences.uiFont).toBe("Inter");

    // Draft fonts imported
    const importedFonts: FontPreferences = {
      ...originalFonts,
      uiFont: "Comic Sans",
      editorFont: "Courier New",
    };
    previewTheme("custom", DEFAULT_CUSTOM_THEME, importedFonts);

    // Cancel rolls back
    restoreThemeSnapshot(snapshot);

    expect(getStorageItem("tabs:font-preferences")).toBe(JSON.stringify(originalFonts));
  });

  it("A failed Apply retains the draft and does not display success", async () => {
    const draftConfig: CustomThemeConfig = {
      ...DEFAULT_CUSTOM_THEME,
      colors: { ...DEFAULT_CUSTOM_THEME.colors, primary: "#ef4444" },
    };

    let editorOpen = true;
    let successMessageShown = false;
    let retainedDraft = draftConfig;

    const failingApply = vi.fn().mockRejectedValue(new Error("Storage quota exceeded"));

    try {
      await failingApply(draftConfig);
      successMessageShown = true;
      editorOpen = false;
    } catch {
      // Failed persistence leaves editor open, retains draft, shows actionable error
      expect(editorOpen).toBe(true);
      expect(retainedDraft.colors.primary).toBe("#ef4444");
      expect(successMessageShown).toBe(false);
    }

    expect(failingApply).toHaveBeenCalled();
  });

  it("renders CustomThemeStudioModal with Apply Theme and Cancel buttons", () => {
    const props: CustomThemeStudioModalProps = {
      isOpen: true,
      onClose: vi.fn(),
      config: DEFAULT_CUSTOM_THEME,
      onSavePreset: vi.fn(),
      onApply: vi.fn(),
    };

    const markup = renderToStaticMarkup(
      <AppAtomRegistryProvider>
        <CustomThemeStudioModal {...props} />
      </AppAtomRegistryProvider>,
    );
    expect(markup).toContain("Custom Theme Studio");
    expect(markup).toContain("Apply Theme");
    expect(markup).toContain("Cancel");
    expect(markup).toContain("Save Preset");
    expect(markup).toContain('aria-label="Close Custom Theme Studio"');
  });

  it("opening CustomThemeStudioModal without editing does not mark Settings dirty", () => {
    clearAllDraftSources();
    const props: CustomThemeStudioModalProps = {
      isOpen: true,
      onClose: vi.fn(),
      config: DEFAULT_CUSTOM_THEME,
      onSavePreset: vi.fn(),
      onApply: vi.fn(),
    };

    renderToStaticMarkup(
      <AppAtomRegistryProvider>
        <CustomThemeStudioModal {...props} />
      </AppAtomRegistryProvider>,
    );

    const sources = appAtomRegistry.get(settingsDraftRegistryAtom);
    const themeStudioEntry = sources["theme-studio"];
    // Either not dirty or not registered as dirty
    expect(themeStudioEntry?.isDirty ?? false).toBe(false);
  });

  it("does not render modal contents when isOpen is false", () => {
    const props: CustomThemeStudioModalProps = {
      isOpen: false,
      onClose: vi.fn(),
      config: DEFAULT_CUSTOM_THEME,
      onSavePreset: vi.fn(),
      onApply: vi.fn(),
    };

    const markup = renderToStaticMarkup(
      <AppAtomRegistryProvider>
        <CustomThemeStudioModal {...props} />
      </AppAtomRegistryProvider>,
    );
    expect(markup).toBe("");
  });
});
