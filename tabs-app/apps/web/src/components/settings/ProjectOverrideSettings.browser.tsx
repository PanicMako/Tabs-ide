import "../../index.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ProjectId } from "@tabs/contracts";
import { ProjectOverrideSettings } from "./ProjectOverrideSettings";

it("lets a project follow the global setting or answer differently", async () => {
  const view = await render(<ProjectOverrideSettings projectId={"project-1" as ProjectId} />);
  try {
    await expect.element(page.getByText("This project", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Pull automatically", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Let agents use the browser", { exact: true }))
      .toBeVisible();
    // Nothing is overridden yet, so both rows say they follow the global setting.
    await expect.element(page.getByText(/Same as everywhere/).first()).toBeVisible();
  } finally {
    await view.unmount();
  }
});
