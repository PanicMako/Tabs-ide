import "../../index.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { OvermindSection } from "./OvermindSection";

const subagents = [
  { id: "n1", title: "Overmind · api · Build the API", status: "running", childThreadId: "t1" },
  {
    id: "n2",
    title: "Overmind · ui · Build the UI",
    status: "completed",
    childThreadId: "t2",
    result: "UI merged",
  },
  { id: "n3", title: "Overmind · db · Migrate", status: "failed", childThreadId: "t3" },
  { id: "n4", title: "Unrelated helper", status: "running", childThreadId: "t4" },
];

const renderSection = (overrides: Partial<Parameters<typeof OvermindSection>[0]> = {}) => {
  const props = {
    subagents,
    rowClassName: "row",
    disabled: false,
    disabledReason: null,
    onOpenThread: vi.fn(),
    onStop: vi.fn(),
    onStart: vi.fn(async () => {}),
    ...overrides,
  };
  return { props, screen: render(<OvermindSection {...props} />) };
};

it("shows only Overmind tasks with live status and a progress line", async () => {
  renderSection();
  await expect
    .element(page.getByText("Overmind: 1 of 3 done · 1 running · 1 failed"))
    .toBeVisible();
  await expect.element(page.getByText("Build the API")).toBeVisible();
  await expect.element(page.getByText("Working", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Done", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Failed", { exact: true })).toBeVisible();
  expect(page.getByText("Unrelated helper").elements()).toHaveLength(0);
});

it("opens a sub-thread and stops only active ones", async () => {
  const { props } = renderSection();
  await page.getByRole("button", { name: "Open" }).first().click();
  expect(props.onOpenThread).toHaveBeenCalledWith("t1");
  expect(page.getByRole("button", { name: "Stop" }).elements()).toHaveLength(1);
  await page.getByRole("button", { name: "Stop" }).click();
  expect(props.onStop).toHaveBeenCalledWith("n1", "t1");
});

it("starts Overmind with the typed goal and reports failures", async () => {
  const onStart = vi.fn(async (_goal: string) => {});
  renderSection({ onStart });
  await page.getByRole("button", { name: "Run with Overmind" }).click();
  const start = page.getByRole("button", { name: "Start" });
  await expect.element(start).toBeDisabled();
  await page.getByLabelText("Goal").fill("Migrate the billing module");
  await start.click();
  expect(onStart).toHaveBeenCalledWith("Migrate the billing module", null);
});

it("keeps the dialog open and shows the error when starting fails", async () => {
  renderSection({
    onStart: vi.fn(async () => {
      throw new Error("Thread is archived");
    }),
  });
  await page.getByRole("button", { name: "Run with Overmind" }).click();
  await page.getByLabelText("Goal").fill("x");
  await page.getByRole("button", { name: "Start" }).click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("Thread is archived");
});

it("disables the action when the thread cannot lead", async () => {
  renderSection({ disabled: true, disabledReason: "Start Overmind from the parent conversation" });
  await expect.element(page.getByRole("button", { name: "Run with Overmind" })).toBeDisabled();
});
