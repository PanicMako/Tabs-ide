import "../index.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { UpdateEverythingDialog } from "./UpdateEverythingDialog";
import { useUpdateEverythingStore } from "./updateEverythingStore";

it("says everything is up to date when nothing needs updating", async () => {
  useUpdateEverythingStore.setState({ open: true });
  const view = await render(<UpdateEverythingDialog />);
  try {
    await expect.element(page.getByText("Everything is up to date")).toBeVisible();
    await page.getByRole("button", { name: "Not now" }).click();
    expect(useUpdateEverythingStore.getState().open).toBe(false);
  } finally {
    await view.unmount();
    useUpdateEverythingStore.setState({ open: false });
  }
});
