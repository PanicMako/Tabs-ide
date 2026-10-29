import "../../index.css";
import "../../localFonts.css";
import { expect, it, vi } from "vitest";
import { page, userEvent, commands } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ThemesSettings } from "./ThemesSettings";
import {
  CURATED_FONT_COMBOS,
  DEFAULT_FONT_PREFERENCES,
  selectFontCombo,
  getActiveFontCombo,
  resolveFontTypography,
} from "../../lib/themes";
import { SAVED_FONT_MIXES_KEY } from "../../lib/savedFontMixes";
import { refreshTheme, restoreThemeSnapshot, snapshotThemeState } from "../../hooks/useTheme";
import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";

declare module "vitest/internal/browser" {
  interface BrowserCommands {
    scrollFontReel: (deltas: number[]) => Promise<void>;
  }
}

const update = vi.fn();
vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => DEFAULT_UNIFIED_SETTINGS,
  useUpdateSettings: () => ({ updateSettings: update }),
  useDebouncedSettingsUpdate: () => ({ updateSettings: update, flush: vi.fn() }),
}));
vi.mock("../../state/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/settings")>()),
  useServerConfig: () => null,
}));

it("keeps heading-only presets and personal typography roles intact", async () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const snapshot = snapshotThemeState();
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
    expect(view.container.textContent).toContain("Your collection");
    await expect.element(page.getByRole("button", { name: /Select Studio Signal:/ })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: /Select Abstract Forms:/ }))
      .toBeVisible();
    expect(view.container.querySelectorAll(".font-reel-choice").length).toBe(10);
    update.mockClear();
    for (const combo of CURATED_FONT_COMBOS.filter((item) => item.headingOnly)) {
      const button = page.getByRole("button", {
        name: `Select ${combo.name}: ${combo.desc}`,
        exact: true,
      });
      await button.click();
      await expect.element(button).toHaveAttribute("aria-pressed", "true");
      const actual = JSON.parse(localStorage.getItem("tabs:font-preferences")!);
      expect(actual.uiFont).toBe(personal.uiFont);
      expect(actual.supportingFont).toBe(personal.supportingFont);
      expect(actual.editorFont).toBe(personal.editorFont);
      expect(actual.headingFont).toBe(combo.headingFont);
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
  } finally {
    await view.unmount();
    for (const [key, value] of saved) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    restoreThemeSnapshot(snapshot);
    await page.viewport(viewport.width, viewport.height);
  }
});

it("uses every current local pairing in the reel and applies its real font roles", async () => {
  const snapshot = snapshotThemeState();
  const keys = [SAVED_FONT_MIXES_KEY, "tabs:font-preferences", "tabs:client-settings:v1"];
  const saved = keys.map((key) => [key, localStorage.getItem(key)] as const);
  localStorage.setItem("tabs:font-preferences", JSON.stringify(DEFAULT_FONT_PREFERENCES));
  refreshTheme();
  await page.viewport(1440, 1400);
  const view = await render(<ThemesSettings />);
  try {
    expect(view.container.querySelector(".font-specimen-grid")).toBeNull();
    expect(view.container.querySelectorAll(".font-reel-choice").length).toBe(10);
    await expect
      .element(page.getByRole("slider", { name: "Interface font size slider" }))
      .not.toBeInTheDocument();
    const lockedChoice = page.getByRole("button", { name: /Select Abstract Forms:/ });
    await expect.element(lockedChoice).toBeDisabled();
    await page.getByRole("button", { name: "Edit fonts", exact: true }).click();
    const presets = CURATED_FONT_COMBOS.filter((c) => !c.isNeutral);
    for (const combo of presets) {
      const button = page.getByRole("button", {
        name: `Select ${combo.name}: ${combo.desc}`,
        exact: true,
      });
      await button.click();
      await expect.element(button).toHaveAttribute("aria-pressed", "true");
      const actual = JSON.parse(localStorage.getItem("tabs:font-preferences")!);
      const wanted = selectFontCombo(DEFAULT_FONT_PREFERENCES, combo);
      expect(actual.uiFont).toBe(wanted.uiFont);
      expect(actual.headingFont).toBe(wanted.headingFont);
      expect(resolveFontTypography(actual).sectionFont).toBe(
        resolveFontTypography(wanted).sectionFont,
      );
      expect(actual.editorFont).toBe(wanted.editorFont);
      expect(
        (
          await document.fonts.load(
            `${combo.typography?.headingWeight ?? 600} 32px ${(combo.id === "syne-dropped" ? combo.uiFont : combo.headingFont).split(",")[0]}`,
          )
        ).length,
      ).toBeGreaterThan(0);
      expect(
        (
          await document.fonts.load(
            `${combo.typography?.specimenWeight ?? 400} 24px ${combo.typography?.specimenFont.split(",")[0] ?? combo.uiFont.split(",")[0]}`,
          )
        ).length,
      ).toBeGreaterThan(0);
      const selectedStyle = getComputedStyle(button.element().querySelector(".font-reel-name")!);
      if (combo.id === "syne-dropped") expect(selectedStyle.fontFamily).toContain("Syne");
      await expect
        .poll(() => Number(getComputedStyle(button.element()).opacity))
        .toBeGreaterThan(0.98);
      if (combo.id === "culont-curve" || combo.id === "otez-contrast") {
        const family = combo.id === "culont-curve" ? "Horovod" : "ZT Floogn";
        const faces = Array.from(document.fonts).filter(
          (face) => face.family.replaceAll('"', "").replaceAll("'", "") === family,
        );
        expect(faces.length).toBeGreaterThan(0);
        faces.forEach((face) =>
          expect(Reflect.get(face, "sizeAdjust")).toBe(
            combo.id === "culont-curve" ? "120%" : "125%",
          ),
        );
        expect(document.documentElement.style.getPropertyValue("--font-interface-tracking")).toBe(
          combo.id === "culont-curve" ? "0.03em" : "0.04em",
        );
        await page.screenshot({
          element: view.container.querySelector(".typography-reel")!,
          path: `__screenshots__/typography-reel/${combo.id}-readability.png`,
        });
        await page.viewport(390, 1600);
        const mobileRoot = view.container.querySelector<HTMLElement>(".typography-reel")!;
        expect(mobileRoot.scrollWidth).toBeLessThanOrEqual(mobileRoot.clientWidth);
        mobileRoot.scrollIntoView({ block: "start" });
        await page.screenshot({
          element: mobileRoot,
          path: `__screenshots__/typography-reel/${combo.id}-readability-390.png`,
        });
        await page.viewport(1440, 1400);
      }
      const sample = view.container.querySelector(".font-reel-app-content h4")!;
      if (combo.id === "culont-curve") expect(getComputedStyle(sample).fontSize).toBe("40px");
      expect(getComputedStyle(sample).fontFamily).toBe(
        getComputedStyle(button.element().querySelector(".font-reel-name")!).fontFamily,
      );
    }
    await page.getByRole("radio", { name: "Code", exact: true }).click();
    const code = view.container.querySelector(".font-reel-code-document")!;
    expect(code.textContent).toContain("Hashira Mt");
    expect(code.textContent).toContain("Fragment Mono");
    await page.getByRole("radio", { name: "Text", exact: true }).click();
    await page.getByRole("button", { name: "Tune", exact: true }).click();
    await expect.element(page.getByRole("dialog", { name: "Tune typography" })).toBeVisible();
    await expect
      .element(page.getByRole("slider", { name: "Interface font size slider" }))
      .toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Custom mix", exact: true }).click();
    await expect.element(page.getByRole("dialog", { name: "Create typography mix" })).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    for (const width of [1440, 768, 390]) {
      await page.viewport(width, 1600);
      await document.fonts.ready;
      const root = view.container.querySelector<HTMLElement>(".typography-reel")!;
      expect(root.getBoundingClientRect().width).toBeLessThanOrEqual(width);
      expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
      root.scrollIntoView({ block: "start" });
      await page.screenshot({
        element: view.container.querySelector(".typography-reel")!,
        path: `__screenshots__/typography-reel/${width}.png`,
      });
    }
    const last = page.getByRole("button", {
      name: `Select ${presets[9]!.name}: ${presets[9]!.desc}`,
      exact: true,
    });
    await last.element().focus();
    await userEvent.keyboard("{ArrowUp}");
    await expect
      .element(
        page.getByRole("button", {
          name: `Select ${presets[8]!.name}: ${presets[8]!.desc}`,
          exact: true,
        }),
      )
      .toHaveAttribute("aria-pressed", "true");
    const wheelTarget = view.container.querySelector<HTMLElement>(".font-reel")!;
    await expect.poll(() => Math.abs(wheelTarget.scrollTop - 8 * 72)).toBeLessThan(1);
    const wheel = new WheelEvent("wheel", { deltaY: -6, cancelable: true, bubbles: true });
    wheelTarget.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    await commands.scrollFontReel(Array.from({ length: 24 }, () => -9));
    await expect
      .element(
        page.getByRole("button", {
          name: `Select ${presets[5]!.name}: ${presets[5]!.desc}`,
          exact: true,
        }),
      )
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => getActiveFontCombo(JSON.parse(localStorage.getItem("tabs:font-preferences")!)).id)
      .toBe(presets[5]!.id);
    await expect.poll(() => Math.abs(wheelTarget.scrollTop - 5 * 72)).toBeLessThan(1);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Edit fonts", exact: true }))
      .toBeVisible();
    expect(getComputedStyle(wheelTarget).overflowY).toBe("hidden");
    await expect
      .element(
        page.getByRole("button", {
          name: `Select ${presets[5]!.name}: ${presets[5]!.desc}`,
          exact: true,
        }),
      )
      .toBeDisabled();
    const lockedFonts = localStorage.getItem("tabs:font-preferences");
    await commands.scrollFontReel(Array.from({ length: 10 }, () => 18));
    expect(localStorage.getItem("tabs:font-preferences")).toBe(lockedFonts);
    const lockedRoot = view.container.querySelector<HTMLElement>(".typography-reel")!;
    lockedRoot.scrollIntoView({ block: "start" });
    await page.screenshot({
      element: lockedRoot,
      path: "__screenshots__/typography-reel/locked-390.png",
    });
  } finally {
    await view.unmount();
    for (const [key, value] of saved) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    restoreThemeSnapshot(snapshot);
  }
});
