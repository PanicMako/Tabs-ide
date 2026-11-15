import "../../index.css";
import "../settings/wallpaper-labs.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { WallpaperPrintMenu } from "./WallpaperPrintMenu";
import {
  getWallpaperPrintAnimate,
  getWallpaperPrintStrength,
  getWallpaperPrintStyle,
} from "./wallpaperPrint";

it("changes and saves the print style, strength and motion from the dock", async () => {
  for (const key of [
    "tabs:agentWallpaperPrintStyle",
    "tabs:agentWallpaperPrintStrength",
    "tabs:agentWallpaperPrintAnimate",
  ]) {
    localStorage.removeItem(key);
  }
  const view = await render(
    <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 480, width: 700 }}>
      <WallpaperPrintMenu />
    </div>,
  );
  try {
    expect(getWallpaperPrintStyle()).toBe("halftone");
    await page.getByRole("button", { name: "Wallpaper print style" }).click();
    await expect.element(page.getByRole("dialog", { name: "Wallpaper print style" })).toBeVisible();
    await page.getByRole("button", { name: "Dither" }).click();
    await page.getByRole("radio", { name: "Bold" }).click();
    expect(getWallpaperPrintStyle()).toBe("dither");
    expect(getWallpaperPrintStrength()).toBe(3);
    // Motion is a real switch, not a checkbox.
    const before = getWallpaperPrintAnimate();
    await page.getByRole("switch", { name: "Animate the print" }).click();
    expect(getWallpaperPrintAnimate()).toBe(!before);
    await expect
      .element(page.getByRole("button", { name: "Dither" }))
      .toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Wallpaper print style" }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  } finally {
    for (const key of [
      "tabs:agentWallpaperPrintStyle",
      "tabs:agentWallpaperPrintStrength",
      "tabs:agentWallpaperPrintAnimate",
    ]) {
      localStorage.removeItem(key);
    }
    await view.unmount();
  }
});
