import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../index.css";
import { TemporaryClipboard } from "./TemporaryClipboard";

it("saves, reloads and removes a local text snippet", async () => {
  localStorage.removeItem("tabs.quickClipboard.saved");
  sessionStorage.removeItem("tabs.quickClipboard.draft");
  try {
    await render(<TemporaryClipboard open onOpenChange={() => {}} />);
    await page.getByRole("textbox", { name: "Clipboard text" }).fill("A useful snippet");
    await page.getByRole("button", { name: "Save snippet", exact: true }).click();
    expect(JSON.parse(localStorage.getItem("tabs.quickClipboard.saved")!)[0].text).toBe(
      "A useful snippet",
    );
    await page.getByRole("button", { name: "Clear draft", exact: true }).click();
    await page.getByRole("button", { name: "Load saved snippet", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Clipboard text" }))
      .toHaveValue("A useful snippet");
    await page.getByRole("button", { name: "Remove saved snippet", exact: true }).click();
    expect(JSON.parse(localStorage.getItem("tabs.quickClipboard.saved")!)).toEqual([]);
  } finally {
    localStorage.removeItem("tabs.quickClipboard.saved");
    sessionStorage.removeItem("tabs.quickClipboard.draft");
  }
});
