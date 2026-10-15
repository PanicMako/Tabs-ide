import "../../index.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { SchedulePicker, parseSchedule } from "./SchedulePicker";
it("rejects invalid dates and times without silently rolling them over", () => {
  expect(parseSchedule("2030-02-30", "12:30")).toBeNull();
  expect(parseSchedule("2030-01-01", "25:30")).toBeNull();
  expect(parseSchedule("2030-01-01", "12:60")).toBeNull();
  expect(parseSchedule("2032-02-29", "12:30")?.getDate()).toBe(29);
});
it("blocks past dates and lets a quick preset create a future schedule", async () => {
  const confirm = vi.fn();
  const parentSubmit = vi.fn();
  const view = await render(
    <div
      onSubmit={(event) => {
        event.preventDefault();
        parentSubmit();
      }}
    >
      <SchedulePicker value={new Date("2020-01-01T12:00:00")} onConfirm={confirm} />
    </div>,
  );
  try {
    await expect.element(page.getByText("Choose a future time.")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Schedule", exact: true }))
      .toBeDisabled();
    await page.getByRole("button", { name: "+30 min" }).click();
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]![0].getTime()).toBeGreaterThan(Date.now());
    expect(parentSubmit).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});
it("selects the +1 hour preset and enables the schedule submission", async () => {
  const confirm = vi.fn();
  const view = await render(
    <SchedulePicker value={new Date("2020-01-01T12:00:00")} onConfirm={confirm} />,
  );
  try {
    const before = Date.now();
    await page.getByRole("button", { name: "+1 hour" }).click();
    const submitBtn = page.getByRole("button", { name: "Schedule", exact: true });
    await expect.element(submitBtn).not.toBeDisabled();
    await submitBtn.click();
    expect(confirm).toHaveBeenCalledOnce();
    const scheduledTime = confirm.mock.calls[0]![0].getTime();
    expect(scheduledTime).toBeGreaterThanOrEqual(before + 59 * 60_000);
    expect(scheduledTime).toBeLessThanOrEqual(before + 62 * 60_000);
  } finally {
    await view.unmount();
  }
});
it("picks calendar dates and scrolls time wheels without manual input", async () => {
  const confirm = vi.fn();
  const cancel = vi.fn();
  const view = await render(
    <SchedulePicker value={new Date(2030, 3, 12, 9, 44)} onConfirm={confirm} onCancel={cancel} />,
  );
  try {
    const dateLabel = new Date(2030, 3, 13).toLocaleDateString([], {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    await page.getByRole("button", { name: dateLabel }).click();
    const minutes = page.getByRole("listbox", { name: "Minutes" }).element();
    minutes.dispatchEvent(new WheelEvent("wheel", { deltaY: 36, bubbles: true }));
    minutes.scrollTop = 45 * 36;
    minutes.dispatchEvent(new Event("scroll"));
    await expect
      .element(
        page
          .getByRole("listbox", { name: "Minutes" })
          .getByRole("option", { name: "45", exact: true }),
      )
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    const date = confirm.mock.calls[0]![0] as Date;
    expect([
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
    ]).toEqual([2030, 3, 13, 9, 45]);
    const hours = page.getByRole("listbox", { name: "Hours" }).element();
    hours.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await expect
      .element(
        page
          .getByRole("listbox", { name: "Hours" })
          .getByRole("option", { name: "10", exact: true }),
      )
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(cancel).toHaveBeenCalledOnce();
  } finally {
    await view.unmount();
  }
});
