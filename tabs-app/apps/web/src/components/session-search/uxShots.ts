// Test-only helper: capture the same view in light and dark at the two review viewports.
import { page } from "vitest/browser";

import { applyTestColorScheme, resetTestColorScheme } from "../../test/colorScheme";

export const REVIEW_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
] as const;

export async function applyReviewTheme(theme: "light" | "dark") {
  applyTestColorScheme(theme);
}

export async function shootAll(name: string, folder: string, before?: () => Promise<void>) {
  for (const viewport of REVIEW_VIEWPORTS) {
    await page.viewport(viewport.width, viewport.height);
    for (const theme of ["light", "dark"] as const) {
      await applyReviewTheme(theme);
      await before?.();
      await new Promise((resolve) => setTimeout(resolve, 350));
      await page.screenshot({
        path: `__screenshots__/${folder}/${name}-${theme}-${viewport.width}x${viewport.height}.png`,
      });
    }
  }
  resetTestColorScheme();
}
