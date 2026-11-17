import "../../index.css";
import "../agents/companion/designs/designs.css";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { MessageEditor } from "./MessageEditor";

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

it("edits text, drops an image, adds one, and saves it all together", async () => {
  const onSave = vi.fn(async () => true);
  const onCancel = vi.fn();
  const view = await render(
    <div data-companion-design="grouped" style={{ width: 420 }}>
      <MessageEditor
        label="Draft text"
        initialText="Fix the header"
        images={[
          { id: "a", name: "before.png", src: PIXEL },
          { id: "b", name: "after.png", src: PIXEL },
        ]}
        onSave={onSave}
        onCancel={onCancel}
      />
    </div>,
  );
  try {
    const field = page.getByRole("textbox", { name: "Draft text" });
    await userEvent.clear(field);
    await userEvent.type(field, "Fix the header and footer");
    await page.getByRole("button", { name: "Remove before.png" }).click();
    const picker = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(
      [Uint8Array.from(atob(PIXEL.split(",")[1]!), (c) => c.charCodeAt(0))],
      "new.png",
      {
        type: "image/png",
      },
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    picker.files = transfer.files;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    await expect.element(page.getByRole("button", { name: "Remove new.png" })).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();
    expect(onSave).toHaveBeenCalledWith({
      text: "Fix the header and footer",
      keptImageIds: ["b"],
      addedImages: [file],
    });
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalled());
  } finally {
    await view.unmount();
  }
});

it("cancels with Escape and keeps Save off until something changes", async () => {
  const onCancel = vi.fn();
  const view = await render(
    <div data-companion-design="grouped">
      <MessageEditor
        label="Draft text"
        initialText="Same"
        images={[]}
        onSave={vi.fn()}
        onCancel={onCancel}
      />
    </div>,
  );
  try {
    await expect.element(page.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});
