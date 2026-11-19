import "../../../index.css";
import "./companion.css";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { BrowserFindBar, findStatusLabel } from "./BrowserFindBar";

it("labels the count", () => {
  expect(findStatusLabel("", null)).toBe("");
  expect(findStatusLabel("a", { matches: 0, activeMatch: 0 })).toBe("No matches");
  expect(findStatusLabel("a", { matches: 5, activeMatch: 2 })).toBe("2 of 5");
});

it("searches as you type, steps with Enter and Shift+Enter, and closes on Escape", async () => {
  const find = vi.fn(async (_text: string) => ({ matches: 4, activeMatch: 1 }));
  const onClose = vi.fn();
  const view = await render(<BrowserFindBar find={find} onClose={onClose} focusTick={0} />);
  try {
    const box = page.getByRole("searchbox", { name: "Find in page" });
    await box.fill("hello");
    await expect.element(page.getByText("1 of 4")).toBeVisible();
    expect(find).toHaveBeenLastCalledWith("hello", { forward: true, next: false });
    await box.click();
    await userEvent.keyboard("{Enter}");
    expect(find).toHaveBeenLastCalledWith("hello", { forward: true, next: true });
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    expect(find).toHaveBeenLastCalledWith("hello", { forward: false, next: true });
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});
