import "../../index.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ArchivedThreadsSettings } from "./ArchivedThreadsSettings";

it("says what to do when nothing is archived", async () => {
  const view = await render(<ArchivedThreadsSettings />);
  try {
    await expect.element(page.getByText("Archived threads", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Nothing archived")).toBeVisible();
    await expect.element(page.getByText(/wait here/)).toBeVisible();
  } finally {
    await view.unmount();
  }
});
