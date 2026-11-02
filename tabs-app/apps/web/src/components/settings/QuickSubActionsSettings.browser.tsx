import { useState } from "react";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../index.css";
import { QuickSubActionsSettings } from "./QuickSubActionsSettings";
import { DEFAULT_SUB_ACTIONS, type QuickSubAction } from "../quick-actions/actions";

it("keeps shortcuts readable and edits only one shortcut at a time", async () => {
  const changed = vi.fn();
  function Fixture() {
    const [value, setValue] = useState<readonly QuickSubAction[]>(DEFAULT_SUB_ACTIONS);
    return (
      <QuickSubActionsSettings
        parentId="scratch-browser"
        embedded
        value={value}
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
      />
    );
  }
  await render(<Fixture />);
  expect(document.querySelectorAll("input")).toHaveLength(0);
  await page.getByRole("button", { name: "Edit Google", exact: true }).click();
  await page.getByRole("textbox", { name: "Shortcut name", exact: true }).fill("Docs");
  await page
    .getByRole("textbox", { name: "Shortcut destination", exact: true })
    .fill("https://example.com/docs");
  expect(changed).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Save shortcut", exact: true }).click();
  await page.getByRole("button", { name: "Move Docs earlier", exact: true }).click();
  expect(
    changed.mock.lastCall![0].filter(
      (entry: QuickSubAction) => entry.parentId === "scratch-browser",
    )[0],
  ).toMatchObject({ label: "Docs", query: "https://example.com/docs" });
  await page.getByRole("button", { name: "Edit Docs", exact: true }).click();
  await page.getByRole("textbox", { name: "Shortcut name", exact: true }).fill("Unsaved name");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Edit Docs", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove Docs", exact: true }).click();
  expect(changed.mock.lastCall![0].some((entry: QuickSubAction) => entry.label === "Docs")).toBe(
    false,
  );
  await page.getByRole("button", { name: "Add shortcut", exact: true }).click();
  await page.getByRole("textbox", { name: "Shortcut name", exact: true }).fill("My browser");
  await page.getByRole("button", { name: "Save shortcut", exact: true }).click();
  expect(changed.mock.lastCall![0].at(-1)).toMatchObject({
    parentId: "scratch-browser",
    label: "My browser",
    actionId: "scratch-browser",
    query: "",
  });
  expect(document.querySelector("select")).toBeNull();
});
