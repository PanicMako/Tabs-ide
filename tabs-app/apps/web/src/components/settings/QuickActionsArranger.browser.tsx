import "../../index.css";
import { useState } from "react";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  DEFAULT_SUB_ACTIONS,
  type CustomQuickAction,
  type QuickSubAction,
} from "../quick-actions/actions";
import { QuickActionsArranger } from "./QuickActionsArranger";

function Fixture() {
  const [order, setOrder] = useState<readonly string[]>([]);
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [subActions, setSubActions] = useState<readonly QuickSubAction[]>(DEFAULT_SUB_ACTIONS);
  const [customActions, setCustomActions] = useState<readonly CustomQuickAction[]>([]);
  return (
    <div style={{ width: 720 }}>
      <QuickActionsArranger
        order={order}
        hidden={hidden}
        subActions={subActions}
        customActions={customActions}
        onPatch={(next) => {
          if (next.actionOrder) setOrder(next.actionOrder);
          if (next.hiddenActions) setHidden(next.hiddenActions);
          if (next.subActions) setSubActions(next.subActions);
          if (next.customActions) setCustomActions(next.customActions);
        }}
      />
    </div>
  );
}

const zone = (name: string) => document.querySelector(`section[aria-label="${name}"]`)!;

it("moves actions between the ring, More and Hidden", async () => {
  await page.viewport(800, 1100);
  const view = await render(<Fixture />);
  try {
    expect(zone("On the ring").textContent).toContain("7/7");
    expect(zone("On the ring").textContent).toContain("New workspace tab");
    await page.getByRole("button", { name: "Hidden: New workspace tab", exact: true }).click();
    expect(zone("Hidden").textContent).toContain("New workspace tab");
    // The ring refills from More instead of leaving a gap.
    expect(zone("On the ring").textContent).toContain("7/7");
    expect(zone("On the ring").textContent).toContain("Return to code");
    await page.getByRole("button", { name: "On the ring: Usage & limits", exact: true }).click();
    expect(zone("On the ring").textContent).toContain("Usage & limits");
    await expect
      .element(page.getByRole("button", { name: "Hidden: Customize quick actions", exact: true }))
      .toBeDisabled();
    await page.getByRole("button", { name: "Configure Temporary browser shortcuts" }).click();
    await page.getByRole("button", { name: "Edit Google", exact: true }).click();
    // Edits happen in place, with no dialog in the way.
    await expect
      .element(page.getByRole("textbox", { name: "Shortcut name", exact: true }))
      .toBeVisible();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await page.screenshot({
      element: view.container,
      path: "__screenshots__/quick-actions/arranger.png",
    });
  } finally {
    await view.unmount();
  }
});

it("creates, edits and deletes a custom action on the ring", async () => {
  await page.viewport(800, 1100);
  const view = await render(<Fixture />);
  try {
    await page.getByRole("button", { name: "New action", exact: true }).click();
    await page.getByRole("button", { name: "Save action", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Give it a name.");
    await page.getByRole("textbox", { name: "Action name" }).fill("Team docs");
    await page.getByRole("button", { name: "Use the book icon" }).click();
    await page.getByRole("textbox", { name: "Web address" }).fill("https://example.com/docs");
    await page.screenshot({
      element: view.container,
      path: "__screenshots__/quick-actions/custom-form.png",
    });
    await page.getByRole("button", { name: "Save action", exact: true }).click();
    expect(zone("On the ring").textContent).toContain("Team docs");
    expect(zone("On the ring").textContent).toContain("7/7");
    await page.getByRole("button", { name: "Configure Team docs shortcuts" }).click();
    await page.getByRole("textbox", { name: "Action name" }).fill("Docs");
    await page.getByRole("button", { name: "Save action", exact: true }).click();
    expect(zone("On the ring").textContent).toContain("Docs");
    await page.getByRole("button", { name: "Hidden: Docs", exact: true }).click();
    expect(zone("Hidden").textContent).toContain("Docs");
    await page.getByRole("button", { name: "Configure Docs shortcuts" }).click();
    await page.getByRole("button", { name: "Delete action", exact: true }).click();
    expect(zone("Hidden").textContent).not.toContain("Docs");
  } finally {
    await view.unmount();
  }
});
