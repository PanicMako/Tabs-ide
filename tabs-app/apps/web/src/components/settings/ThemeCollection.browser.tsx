import "../../index.css";
import "../../localFonts.css";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ThemePickerGrid } from "./ThemesSettings";
import { DEFAULT_CUSTOM_THEME, type ThemePreference } from "../../lib/themes";
import { previewTheme, restoreThemeSnapshot, snapshotThemeState } from "../../hooks/useTheme";

function Collection({ initial }: { initial: ThemePreference }) {
  const [theme, setTheme] = useState(initial);
  return (
    <ThemePickerGrid
      activeTheme={theme}
      customConfig={DEFAULT_CUSTOM_THEME}
      savedPresets={[]}
      environmentThemes={[]}
      onSelectTheme={(next) => {
        setTheme(next);
        previewTheme(next);
      }}
      onOpenStudio={() => {}}
      onOpenImport={() => {}}
      onDeletePreset={() => {}}
      onRenamePreset={() => {}}
    />
  );
}

it("selects a palette and filters appearances without losing the selected theme", async () => {
  const snapshot = snapshotThemeState();
  const view = await render(<Collection initial="abyss" />);
  try {
    await page.getByRole("button", { name: "Theme: Dusk", exact: true }).click();
    await expect
      .element(
        page
          .getByRole("region", { name: "Printed theme preview" })
          .getByText("Dusk", { exact: true }),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Theme: Dusk", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Light", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Theme: Linen", exact: true }))
      .toBeVisible();
    expect(document.querySelector('[data-theme-id="dracula"]')).toBeNull();
    await expect
      .element(
        page
          .getByRole("region", { name: "Printed theme preview" })
          .getByText("Dusk", { exact: true }),
      )
      .toBeVisible();
  } finally {
    await view.unmount();
    restoreThemeSnapshot(snapshot);
  }
});

it.each(["abyss", "dracula", "deep-blue", "solarized-light"] as const)(
  "renders the %s collection at desktop and phone widths",
  async (theme) => {
    const snapshot = snapshotThemeState();
    previewTheme(theme);
    const view = await render(<Collection initial={theme} />);
    try {
      await document.fonts.ready;
      for (const width of [1280, 390]) {
        await page.viewport(width, 1800);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        expect(document.querySelector(".tp-app-preview")).toBeNull();
        document.querySelectorAll(".theme-printer-presentation *").forEach((element) => {
          element.getAnimations().forEach((animation) => animation.finish());
        });
        await page.screenshot({
          element: document.querySelector(".theme-collection")!,
          path: `__screenshots__/theme-collection/${theme}-${width}.png`,
        });
      }
    } finally {
      await view.unmount();
      restoreThemeSnapshot(snapshot);
    }
  },
);

it("keeps palette creation and import connected to their existing actions", async () => {
  const onOpenStudio = vi.fn();
  const onOpenImport = vi.fn();
  const view = await render(
    <ThemePickerGrid
      activeTheme="true-black"
      customConfig={DEFAULT_CUSTOM_THEME}
      savedPresets={[]}
      environmentThemes={[]}
      onSelectTheme={() => {}}
      onOpenStudio={onOpenStudio}
      onOpenImport={onOpenImport}
      onDeletePreset={() => {}}
      onRenamePreset={() => {}}
    />,
  );
  try {
    await page.getByRole("button", { name: "Create a palette" }).click();
    await page.getByRole("button", { name: "Import a theme" }).click();
    expect(onOpenStudio).toHaveBeenCalledOnce();
    expect(onOpenImport).toHaveBeenCalledOnce();
    expect(document.querySelector(".theme-collection-intro")).toBeNull();
  } finally {
    await view.unmount();
  }
});

it("reprints the selected theme and opens a readable full-size preview", async () => {
  const snapshot = snapshotThemeState();
  const view = await render(<Collection initial="abyss" />);
  try {
    await page.viewport(1280, 1000);
    const firstPrint = document.querySelector(".tp-paper-feed");
    await page.getByRole("button", { name: "Theme: Dusk", exact: true }).click();
    const nextPrint = document.querySelector(".tp-paper-feed");
    expect(nextPrint).not.toBe(firstPrint);
    expect(getComputedStyle(nextPrint!).animationName).toBe("tp-eject");
    expect(document.querySelector(".tp-app-preview")).toBeNull();
    await page.getByRole("button", { name: "View live preview" }).click();
    await expect.element(page.getByRole("dialog")).toBeVisible();
    const windows = document.querySelectorAll(".tp-app-preview");
    expect(windows.length).toBe(1);
    const bounds = windows[0]!.getBoundingClientRect();
    expect(bounds.width).toBeGreaterThan(800);
    expect(bounds.width / bounds.height).toBeCloseTo(16 / 9, 1);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  } finally {
    await view.unmount();
    restoreThemeSnapshot(snapshot);
  }
});
