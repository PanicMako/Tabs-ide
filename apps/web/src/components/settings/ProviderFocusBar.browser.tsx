import "../../index.css";
import "./providers.css";
import { useState } from "react";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ProviderFocusBar, type ProviderView } from "./ProviderFocusBar";
function Workspace() {
  const [view, setView] = useState<ProviderView>("models");
  return (
    <div className="provider-detail" style={{ width: 340 }}>
      <ProviderFocusBar view={view} onChange={setView} modelCount={12} pinnedCount={2} />
      <div hidden={view !== "connection"}>
        <input aria-label="API key" />
      </div>
      <div hidden={view !== "models"}>Model catalogue</div>
    </div>
  );
}
it("keeps connection drafts when switching views with the keyboard", async () => {
  const view = await render(<Workspace />);
  try {
    await expect.element(page.getByText("Model catalogue")).toBeVisible();
    const connection = page.getByRole("radio", { name: "Connection", exact: true });
    await connection.click();
    await page.getByRole("textbox", { name: "API key" }).fill("draft-key");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expect.element(connection).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(page.getByText("Model catalogue")).toBeVisible();
    await expect.element(page.getByLabelText("API key")).not.toBeVisible();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(page.getByRole("textbox", { name: "API key" })).toHaveValue("draft-key");
  } finally {
    await view.unmount();
  }
});
