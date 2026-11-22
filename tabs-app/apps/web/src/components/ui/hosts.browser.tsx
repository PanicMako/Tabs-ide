import "../../index.css";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { showContextMenuFallback } from "../../contextMenuFallback";
import { applyTestColorScheme, resetTestColorScheme } from "../../test/colorScheme";
import { ContextMenuHost } from "./ContextMenuHost";
import { Details, Summary } from "./disclosure";
import { TitleTooltipHost } from "./TitleTooltipHost";

it("shows title hints through the themed tooltip and never leaves a native title", async () => {
  applyTestColorScheme("light");
  const view = await render(
    <div className="p-16 text-foreground">
      <TitleTooltipHost />
      <button type="button" title="Save draft">
        S
      </button>
    </div>,
  );
  try {
    const button = page.getByRole("button", { name: "S" });
    await button.hover();
    await expect.element(page.getByText("Save draft")).toBeVisible();
    expect(button.element().hasAttribute("title")).toBe(false);
    expect(document.querySelector('[data-slot="tooltip-popup"]')).not.toBeNull();
    await page.screenshot({ path: "__screenshots__/title-tooltip-light.png" });
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector('[data-slot="tooltip-popup"]')).toBeNull();
  } finally {
    await view.unmount();
    resetTestColorScheme();
  }
});

it("renders context menus in-app, resolves the chosen id and dismisses with Escape", async () => {
  applyTestColorScheme("dark");
  const view = await render(
    <div className="h-72 w-96 bg-background text-foreground">
      <ContextMenuHost />
    </div>,
  );
  try {
    const items = [
      { id: "rename", label: "Rename" },
      { id: "delete", label: "Delete", destructive: true },
    ];
    const chosen = showContextMenuFallback(items, { x: 80, y: 60 });
    await expect.element(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
    await page.screenshot({ path: "__screenshots__/context-menu-dark.png" });
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(chosen).resolves.toBe("delete");

    const dismissed = showContextMenuFallback(items, { x: 40, y: 40 });
    await expect.element(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(dismissed).resolves.toBeNull();
  } finally {
    await view.unmount();
    resetTestColorScheme();
  }
});

it("disclosure opens and closes with animation and ends fully hidden", async () => {
  const view = await render(
    <Details>
      <Summary>More</Summary>
      <p>Body text</p>
    </Details>,
  );
  try {
    const summary = page.getByRole("button", { name: "More" });
    await expect.element(page.getByText("Body text")).not.toBeVisible();
    await summary.click();
    await expect.element(page.getByText("Body text")).toBeVisible();
    await expect.element(summary).toHaveAttribute("aria-expanded", "true");
    await summary.click();
    await expect.element(summary).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => document.querySelector("[data-closing]")).toBeNull();
    await expect.element(page.getByText("Body text")).not.toBeVisible();
    const root = document.querySelector<HTMLElement>('[data-slot="disclosure"]')!;
    expect(root.style.height).toBe("");
  } finally {
    await view.unmount();
  }
});
