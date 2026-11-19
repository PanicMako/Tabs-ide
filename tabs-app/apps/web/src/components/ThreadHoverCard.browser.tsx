import "../index.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ThreadHoverCard } from "./ThreadHoverCard";

it("shows the full title with its status, branch and last activity", async () => {
  const view = await render(
    <ThreadHoverCard
      title="Rewrite the settings navigation so every page fits a short window"
      statusLabel="Working"
      branch="feature/settings-nav"
      updatedAt="2026-11-19T10:00:00.000Z"
    />,
  );
  try {
    await expect
      .element(page.getByText("Rewrite the settings navigation so every page fits a short window"))
      .toBeVisible();
    await expect.element(page.getByText("Working")).toBeVisible();
    await expect.element(page.getByText("feature/settings-nav")).toBeVisible();
    await expect.element(page.getByText("Last activity")).toBeVisible();
  } finally {
    await view.unmount();
  }
});
