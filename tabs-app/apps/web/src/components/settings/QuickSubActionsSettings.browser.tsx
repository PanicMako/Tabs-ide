import { useState } from "react";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../index.css";
import { QuickSubActionsSettings } from "./QuickSubActionsSettings";
import { DEFAULT_SUB_ACTIONS, type QuickSubAction } from "../quick-actions/actions";

it("edits browser shortcuts, reorders them accessibly and removes them", async () => {
  const changed = vi.fn();
  function Fixture() {
    const [value, setValue] = useState<readonly QuickSubAction[]>(DEFAULT_SUB_ACTIONS);
    return (
      <QuickSubActionsSettings
        value={value}
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
      />
    );
  }
  await render(<Fixture />);
  await page.getByRole("textbox", { name: "Shortcut name 2", exact: true }).fill("Docs");
  await page
    .getByRole("textbox", { name: "Shortcut URL or search 2", exact: true })
    .fill("https://example.com/docs");
  await page.getByRole("button", { name: "Move Docs earlier", exact: true }).click();
  await expect
    .element(page.getByRole("textbox", { name: "Shortcut name 1", exact: true }))
    .toHaveValue("Docs");
  expect(
    changed.mock.lastCall![0].filter(
      (entry: QuickSubAction) => entry.parentId === "scratch-browser",
    )[0],
  ).toMatchObject({
    label: "Docs",
    query: "https://example.com/docs",
  });
  await page.getByRole("button", { name: "Remove Docs", exact: true }).click();
  expect(changed.mock.lastCall![0].some((entry: QuickSubAction) => entry.label === "Docs")).toBe(
    false,
  );
  await page.getByRole("button", { name: "Add sub-action", exact: true }).click();
  await expect
    .element(page.getByRole("textbox", { name: "Shortcut name 3", exact: true }))
    .toHaveValue("New shortcut");
  expect(document.querySelector("select")).toBeNull();
});
