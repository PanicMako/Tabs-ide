import "../../index.css";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Button } from "./button";
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogPanel,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "./dialog";

it("avoids double padding and keeps long modal content scrollable with reachable actions", async () => {
  const view = await render(
    <Dialog>
      <DialogTrigger render={<Button />}>Open compact form</DialogTrigger>
      <DialogPopup>
        <DialogPanel>
          <DialogHeader>
            <DialogTitle>Compact form</DialogTitle>
            <DialogDescription>Review these items.</DialogDescription>
          </DialogHeader>
          <div>
            {Array.from({ length: 70 }, (_, index) => (
              <p key={`item-${index}`}>Item {index + 1}</p>
            ))}
          </div>
          <DialogFooter>
            <DialogClose render={<Button />}>Done</DialogClose>
          </DialogFooter>
        </DialogPanel>
      </DialogPopup>
    </Dialog>,
  );
  try {
    const trigger = page.getByRole("button", { name: "Open compact form" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Compact form" });
    await expect.element(dialog).toBeVisible();
    const header = dialog.element().querySelector('[data-slot="dialog-header"]')!;
    expect(getComputedStyle(header).paddingLeft).toBe("0px");
    expect(getComputedStyle(header).paddingTop).toBe("0px");
    expect(dialog.element().getBoundingClientRect().height).toBeLessThanOrEqual(
      window.innerHeight - 32,
    );
    const viewport = dialog
      .element()
      .querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
  } finally {
    await view.unmount();
  }
});
