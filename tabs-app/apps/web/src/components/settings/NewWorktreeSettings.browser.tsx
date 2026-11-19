import "../../index.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { NewWorktreeSettings } from "./NewWorktreeSettings";

it("shows how new worktrees start and what their branches are called", async () => {
  const view = await render(<NewWorktreeSettings />);
  try {
    await expect.element(page.getByText("New worktrees", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Start from the latest remote")).toBeVisible();
    await expect.element(page.getByText("Submodules", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Branch names", { exact: true })).toBeVisible();
    // The default naming mode is a fixed prefix, so the prefix field is shown.
    await expect.element(page.getByLabelText("Branch prefix")).toBeVisible();
  } finally {
    await view.unmount();
  }
});
