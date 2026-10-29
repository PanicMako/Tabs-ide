import "../../index.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "./menu";
it("keeps zero-padding menus opaque unless transparency is explicitly requested", async () => {
  const view = await render(
    <Menu>
      <MenuTrigger>Open actions</MenuTrigger>
      <MenuPopup className="p-0">
        <MenuItem>Open project</MenuItem>
      </MenuPopup>
    </Menu>,
  );
  try {
    await page.getByRole("button", { name: "Open actions" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Open project" })).toBeVisible();
    const popup = document.querySelector<HTMLElement>('[data-slot="menu-popup"]')!;
    expect(getComputedStyle(popup).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(popup).borderTopStyle).toBe("solid");
  } finally {
    await view.unmount();
  }
});
