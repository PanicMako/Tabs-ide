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
it("uses typed dates and times and supports cancel without confirming", async () => {
  const confirm = vi.fn();
  const cancel = vi.fn();
  const view = await render(<SchedulePicker onConfirm={confirm} onCancel={cancel} />);
  try {
    await page.getByLabelText("Date", { exact: true }).fill("2030-04-12");
    await page.getByLabelText("Time · 24h").fill("09:45");
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    const date = confirm.mock.calls[0]![0] as Date;
    expect([
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
    ]).toEqual([2030, 3, 12, 9, 45]);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(cancel).toHaveBeenCalledOnce();
  } finally {
    await view.unmount();
  }
});
