import "../../index.css";
import "../../localFonts.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ThemesSettings } from "./ThemesSettings";
import { CURATED_FONT_COMBOS, DEFAULT_FONT_PREFERENCES } from "../../lib/themes";
import { SAVED_FONT_MIXES_KEY } from "../../lib/savedFontMixes";
import { refreshTheme, restoreThemeSnapshot, snapshotThemeState } from "../../hooks/useTheme";
import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";

const update = vi.fn();
vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => DEFAULT_UNIFIED_SETTINGS,
  useUpdateSettings: () => ({ updateSettings: update }),
  useDebouncedSettingsUpdate: () => vi.fn(),
}));
vi.mock("../../state/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/settings")>()),
  useServerConfig: () => null,
}));

it("shows a compact curated collection, includes Studio Signal, and changes heading roles only", async () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const theme = snapshotThemeState();
  const keys = [SAVED_FONT_MIXES_KEY, "tabs:font-preferences", "tabs:client-settings:v1"];
  const saved = keys.map((key) => [key, localStorage.getItem(key)] as const);
  const personal = {
    ...DEFAULT_FONT_PREFERENCES,
    uiFont: "'Syne', sans-serif",
    headingFont: "'Coconat', serif",
    sectionFont: "'Newsreader', serif",
    supportingFont: "'Syne', sans-serif",
    editorFont: "Menlo",
  };
  const mix = { id: "personal-signal", name: "Personal Signal", fonts: personal };
  localStorage.setItem(SAVED_FONT_MIXES_KEY, JSON.stringify([mix]));
  localStorage.setItem("tabs:font-preferences", JSON.stringify(personal));
  localStorage.setItem(
    "tabs:client-settings:v1",
    JSON.stringify({ fontFamilySans: personal.uiFont }),
  );
  refreshTheme();
  await page.viewport(1280, 1000);
  const view = await render(<ThemesSettings />);
  try {
    expect(view.container.textContent).not.toContain("Your collection");
    expect(view.container.textContent).not.toContain("Custom Pick");
    await expect.element(page.getByRole("button", { name: /Select Studio Signal:/ })).toBeVisible();
    expect(view.container.querySelectorAll(".font-specimen-card").length).toBe(10);
    expect(view.container.textContent).not.toContain("Paper Trail");
    expect(view.container.textContent).not.toContain("Pixel Mischief");
    await expect
      .element(page.getByRole("button", { name: /Select Abstract Forms:/ }))
      .toBeVisible();
    update.mockClear();
    for (const combo of CURATED_FONT_COMBOS.filter((item) => item.headingOnly)) {
      const button = page.getByRole("button", {
        name: `Select ${combo.name}: ${combo.desc}`,
        exact: true,
      });
      await button.click();
      await expect.element(button).toHaveAttribute("aria-pressed", "true");
      const active = JSON.parse(localStorage.getItem("tabs:font-preferences")!);
      expect(active.uiFont).toBe(personal.uiFont);
      expect(active.supportingFont).toBe(personal.supportingFont);
      expect(active.editorFont).toBe(personal.editorFont);
      expect(active.headingFont).toBe(combo.headingFont);
      expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe(personal.uiFont);
      expect(document.documentElement.style.getPropertyValue("--font-display")).toBe(
        combo.headingFont,
      );
      expect(
        (
          await document.fonts.load(
            `${combo.typography!.headingWeight} 28px ${combo.headingFont.split(",")[0]}`,
          )
        ).length,
      ).toBeGreaterThan(0);
    }
    expect(update).not.toHaveBeenCalled();
    expect(localStorage.getItem(SAVED_FONT_MIXES_KEY)).toBe(JSON.stringify([mix]));
    await page.getByRole("button", { name: /Select Studio Signal:/ }).click();
    const studio = CURATED_FONT_COMBOS.find((combo) => combo.id === "studio-signal")!;
    expect(JSON.parse(localStorage.getItem("tabs:font-preferences")!)).toMatchObject({
      ...personal,
      ...studio.fonts,
      uiFont: studio.uiFont,
      headingFont: studio.headingFont,
    });
    expect(update).toHaveBeenCalledWith({
      fontFamilySans: studio.uiFont,
      fontFamilyCode: studio.fonts!.editorFont,
    });
    await document.fonts.ready;
    await page.screenshot({
      element: view.container.querySelector(".font-specimen-grid")!,
      path: "__screenshots__/heading-collection/presets.png",
    });
    await page.viewport(390, 844);
    for (const card of view.container.querySelectorAll<HTMLElement>(".font-specimen-card")) {
      expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
      expect(card.getBoundingClientRect().height).toBeLessThan(230);
    }
  } finally {
    await view.unmount();
    for (const [key, value] of saved) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    restoreThemeSnapshot(theme);
    await page.viewport(viewport.width, viewport.height);
  }
});
