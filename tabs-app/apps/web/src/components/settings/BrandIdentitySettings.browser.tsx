import "../../index.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";
import { BrandIdentitySettings } from "./BrandIdentitySettings";
const update = vi.fn();
vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => ({ ...DEFAULT_UNIFIED_SETTINGS, desktopIconTheme: "blue-ink" }),
  useUpdateSettings: () => ({ updateSettings: update }),
}));
it("offers the five static treatments and preserves a custom choice", async () => {
  const view = await render(<BrandIdentitySettings />);
  await expect
    .element(page.getByRole("button", { name: "Use Afterglow", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect
    .element(page.getByRole("button", { name: "Use Afterglow", exact: true }).getByRole("img"))
    .toHaveAttribute("src", "/brand/blue-ink-master.png");
  expect(view.container.querySelectorAll("button[aria-pressed]").length).toBe(5);
  await page.getByRole("button", { name: "Use Blueprint", exact: true }).click();
  expect(update).toHaveBeenLastCalledWith({ desktopIconTheme: "signature" });
  await page.viewport(390, 844);
  expect(view.container.scrollWidth).toBeLessThanOrEqual(view.container.clientWidth);
  await view.unmount();
});
