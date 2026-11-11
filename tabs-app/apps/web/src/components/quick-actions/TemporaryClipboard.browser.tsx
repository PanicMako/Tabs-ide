import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../index.css";
import { TemporaryClipboard } from "./TemporaryClipboard";
const keys = [
  "tabs.quickClipboard.saved",
  "tabs.quickClipboard.history",
  "tabs.quickClipboard.draft",
];
const clear = () =>
  keys.forEach((key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
it("accepts pasted text, searches it, copies it and pins it for later", async () => {
  clear();
  const read = vi.spyOn(navigator.clipboard, "readText").mockResolvedValue("A useful snippet");
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  try {
    await page.viewport(1000, 720);
    await render(<TemporaryClipboard open onOpenChange={() => {}} />);
    await page.getByRole("button", { name: "Paste", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Open clipboard item", exact: true }))
      .toHaveTextContent("A useful snippet");
    await page.screenshot({ path: "__screenshots__/quick-actions/clipboard.png" });
    await page.getByRole("button", { name: "Copy clipboard item", exact: true }).click();
    expect(write).toHaveBeenCalledWith("A useful snippet");
    await page.getByRole("button", { name: "Save clipboard item", exact: true }).click();
    expect(JSON.parse(localStorage.getItem(keys[0]!)!)[0].text).toBe("A useful snippet");
    await page.getByRole("textbox", { name: "Search clipboard" }).fill("missing");
    await expect.element(page.getByText("No matching items", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Search clipboard" }).fill("");
    await page.getByRole("button", { name: "Remove clipboard item", exact: true }).click();
    expect(JSON.parse(localStorage.getItem(keys[0]!)!)).toEqual([]);
  } finally {
    read.mockRestore();
    write.mockRestore();
    clear();
  }
});
it("adds a note and accepts a paste event without an extra save step", async () => {
  clear();
  try {
    await render(<TemporaryClipboard open onOpenChange={() => {}} />);
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.getByRole("textbox", { name: "Clipboard text" }).fill("Saved note");
    await page.getByRole("button", { name: "Save snippet", exact: true }).click();
    expect(JSON.parse(localStorage.getItem(keys[0]!)!)[0].text).toBe("Saved note");
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "Pasted directly");
    document
      .querySelector('[role="dialog"]')!
      .dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
    await expect.element(page.getByText("Pasted directly", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Saved", exact: true }).click();
    expect(document.querySelector('[aria-label="Clipboard items"]')!.textContent).not.toContain(
      "Pasted directly",
    );
  } finally {
    clear();
  }
});

it("pastes an image as an item and can pin it", async () => {
  clear();
  try {
    await render(<TemporaryClipboard open onOpenChange={() => {}} />);
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=",
      ),
      (char) => char.charCodeAt(0),
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "pixel.png", { type: "image/png" }));
    document
      .querySelector('[role="dialog"]')!
      .dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
    await expect.element(page.getByRole("img", { name: "Pasted clipboard image" })).toBeVisible();
    await page.getByRole("button", { name: "Save clipboard item", exact: true }).click();
    expect(JSON.parse(localStorage.getItem(keys[0]!)!)[0]).toMatchObject({
      type: "image",
      pinned: true,
    });
  } finally {
    clear();
  }
});
