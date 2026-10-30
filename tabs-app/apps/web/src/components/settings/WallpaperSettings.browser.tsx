import "../../index.css";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import WallpaperSettings from "./WallpaperSettings";

it("imports a wallpaper in a dialog without expanding the settings page", async () => {
  const view = await render(<WallpaperSettings />);
  try {
    const opener = page.getByRole("button", { name: "Add Custom Wallpaper", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Add custom wallpaper" });
    await expect.element(dialog).toBeVisible();
    await expect
      .element(dialog.getByRole("button", { name: "Add Image", exact: true }))
      .toBeDisabled();
    await dialog.getByRole("textbox", { name: "Scene name (optional)" }).fill("Evening sky");
    await dialog
      .getByRole("textbox", { name: "Image URL", exact: true })
      .fill("https://example.com/sky.png");
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(opener).toHaveFocus();
    await opener.click();
    await expect
      .element(dialog.getByRole("textbox", { name: "Image URL", exact: true }))
      .toHaveValue("https://example.com/sky.png");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.element(dialog).not.toBeInTheDocument();
  } finally {
    await view.unmount();
  }
});
