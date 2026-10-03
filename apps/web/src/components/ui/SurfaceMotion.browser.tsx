import "../../index.css";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Dialog, DialogTrigger, DialogPopup, DialogTitle, DialogDescription } from "./dialog";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "./menu";

vi.mock("../../panelAnimations", () => ({
  usePanelAnimationSettings: () => ({ active: true, durationMs: 200, reducedMotion: false }),
}));

it("dismisses animated dialogs and menus and restores keyboard focus on repeated opens", async () => {
  const view = await render(
    <>
      <Dialog>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogPopup>
          <DialogTitle>Motion check</DialogTitle>
          <DialogDescription>Check popup focus and presence.</DialogDescription>
        </DialogPopup>
      </Dialog>
      <Menu>
        <MenuTrigger>Open menu</MenuTrigger>
        <MenuPopup>
          <MenuItem>Menu action</MenuItem>
        </MenuPopup>
      </Menu>
    </>,
  );
  try {
    const trigger = page.getByRole("button", { name: "Open dialog" });
    for (let index = 0; index < 2; index++) {
      await trigger.click();
      await expect.element(page.getByRole("dialog")).toBeVisible();
      await userEvent.keyboard("{Escape}");
      await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
      await expect.element(trigger).toHaveFocus();
    }
    const menuTrigger = page.getByRole("button", { name: "Open menu" });
    for (let index = 0; index < 2; index++) {
      await menuTrigger.click();
      await expect.element(page.getByRole("menuitem", { name: "Menu action" })).toBeVisible();
      await userEvent.keyboard("{Escape}");
      await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
      await expect.element(menuTrigger).toHaveFocus();
    }
  } finally {
    await view.unmount();
  }
});
