import "../../index.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";
import { refreshTheme } from "../../hooks/useTheme";
import { AnimationsSettings } from "./AnimationsSettings";
import { ThemesSettings } from "./ThemesSettings";

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => ({
    ...DEFAULT_UNIFIED_SETTINGS,
    splashLoaderStyle: "solari",
    splashLoaderPalette: "mono",
    splashLoaderTheme: "system",
    closeLoaderStyle: "solari",
    closeLoaderPalette: "mono",
    closeLoaderTheme: "system",
  }),
  useUpdateSettings: () => ({ updateSettings: vi.fn() }),
  useDebouncedSettingsUpdate: () => vi.fn(),
}));
vi.mock("../../state/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/settings")>()),
  useServerConfig: () => null,
}));

it("Auto uses the resolved dark theme and fills both animation previews at every width", async () => {
  const original = localStorage.getItem("tabs:theme");
  const size = { width: window.innerWidth, height: window.innerHeight };
  localStorage.setItem("tabs:theme", "true-black");
  refreshTheme();
  const view = await render(<AnimationsSettings />);
  try {
    const viewport = view.container.querySelector('[data-slot="animation-preview-viewport"]')!;
    const canvas = view.container.querySelector('[data-slot="animation-preview-canvas"]')!;
    for (const width of [1280, 390]) {
      await page.viewport(width, 900);
      for (const tab of ["Startup", "Close"]) {
        await page.getByRole("button", { name: tab, exact: true }).click();
        await expect.poll(() => getComputedStyle(viewport).backgroundColor).toBe("rgb(9, 9, 11)");
        await expect
          .poll(() =>
            Math.abs(canvas.getBoundingClientRect().width - viewport.getBoundingClientRect().width),
          )
          .toBeLessThan(1);
        expect(
          Math.abs(canvas.getBoundingClientRect().height - viewport.getBoundingClientRect().height),
        ).toBeLessThan(1);
        expect(getComputedStyle(canvas.firstElementChild!).backgroundColor).toBe("rgb(9, 9, 11)");
      }
    }
    const selector = page.getByRole("radiogroup", { name: "Animation preview theme" });
    await selector.getByRole("radio", { name: "Light", exact: true }).click();
    await expect.poll(() => getComputedStyle(viewport).backgroundColor).toBe("rgb(255, 255, 255)");
    await selector.getByRole("radio", { name: "Auto", exact: true }).click();
    await expect.poll(() => getComputedStyle(viewport).backgroundColor).toBe("rgb(9, 9, 11)");
    await page.viewport(1280, 900);
    await page.screenshot({
      element: viewport.parentElement!,
      path: "__screenshots__/animation-auto.png",
    });
  } finally {
    await view.unmount();
    if (original === null) localStorage.removeItem("tabs:theme");
    else localStorage.setItem("tabs:theme", original);
    refreshTheme();
    await page.viewport(size.width, size.height);
  }
});

it("System Auto keeps its split dark/light design inside the rounded border", async () => {
  const view = await render(<ThemesSettings />);
  try {
    const system = view.container.querySelector(
      '[data-theme-id="system"] [data-shape="thumbnail"]',
    ) as HTMLElement;
    expect(getComputedStyle(system.children[1]!).backgroundImage).toContain("linear-gradient");
    expect(getComputedStyle(system.children[1]!).backgroundImage).toContain("rgb(20, 20, 20)");
    expect(getComputedStyle(system.children[1]!).backgroundImage).toContain("rgb(246, 245, 242)");
    expect(getComputedStyle(system).backgroundClip).toBe("padding-box");
    expect(getComputedStyle(system).borderRadius).toBe("24px");
  } finally {
    await view.unmount();
  }
});
