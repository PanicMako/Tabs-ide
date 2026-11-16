import "../../index.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { OvermindSection } from "./OvermindSection";

const subagents = [
  {
    id: "n1",
    title: "Overmind · api:implementation · Build the API",
    status: "running",
    childThreadId: "t1",
  },
  {
    id: "n2",
    title: "Overmind · ui:design · Build the UI",
    status: "completed",
    childThreadId: "t2",
    result: "UI merged",
  },
  {
    id: "n3",
    title: "Overmind · db:implementation · Migrate",
    status: "failed",
    childThreadId: "t3",
  },
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
  await expect.element(page.getByText("1 of 3 done · 1 running · 1 failed")).toBeVisible();
  await expect.element(page.getByText("Build the API")).toBeVisible();
  await expect.element(page.getByText("Working", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Done", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Failed", { exact: true })).toBeVisible();
  expect(page.getByText("Unrelated helper").elements()).toHaveLength(0);
});

it("groups tasks by type and previews results in one line", async () => {
  renderSection();
  const implementation = page.getByRole("region", { name: "Implementation tasks" });
  const design = page.getByRole("region", { name: "Design tasks" });
  await expect.element(implementation).toBeVisible();
  await expect.element(design).toBeVisible();
  // Failed work sorts above running work inside its group.
  const titles = implementation.getByText(/Migrate|Build the API/).elements();
  expect(titles.map((el) => el.textContent)).toEqual(["Migrate", "Build the API"]);
  await expect.element(design.getByText("0 of 1")).not.toBeInTheDocument();
  await expect.element(design.getByText("1 of 1")).toBeVisible();
  const toggle = page.getByRole("button", { name: "Show result" });
  await expect.element(toggle).toHaveTextContent("UI merged");
  await toggle.click();
  await expect.element(page.getByRole("button", { name: "Hide result" })).toBeVisible();
});

it("opens a sub-thread and stops only active ones", async () => {
  const { props } = renderSection();
  await page.getByRole("button", { name: "Open" }).first().click();
  expect(props.onOpenThread).toHaveBeenCalledWith("t3");
  expect(page.getByRole("button", { name: "Stop" }).elements()).toHaveLength(1);
  await page.getByRole("button", { name: "Stop" }).click();
  expect(props.onStop).toHaveBeenCalledWith("n1", "t1");
});

it("starts Overmind with the typed goal and reports failures", async () => {
  const onStart = vi.fn(async (_goal: string) => {});
  renderSection({ onStart });
  await page.getByRole("button", { name: "New plan" }).click();
  const start = page.getByRole("button", { name: "Plan with Overmind" });
  await expect.element(start).toBeDisabled();
  await page.getByLabelText("Goal").fill("Migrate the billing module");
  await start.click();
  expect(onStart).toHaveBeenCalledWith("Migrate the billing module");
});

it("keeps the dialog open and shows the error when starting fails", async () => {
  renderSection({
    onStart: vi.fn(async () => {
      throw new Error("Thread is archived");
    }),
  });
  await page.getByRole("button", { name: "New plan" }).click();
  await page.getByLabelText("Goal").fill("x");
  await page.getByRole("button", { name: "Plan with Overmind" }).click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("Thread is archived");
});

it("disables the action when the thread cannot lead", async () => {
  renderSection({ disabled: true, disabledReason: "Start Overmind from the parent conversation" });
  await expect.element(page.getByRole("button", { name: "New plan" })).toBeDisabled();
});

it("shows the team in the plan dialog and opens the team editor", async () => {
  renderSection({ lead: { instanceId: "claudeAgent", model: "claude-opus-5-5" } });
  await page.getByRole("button", { name: "New plan" }).click();
  const team = page.getByRole("region", { name: "Agent team" });
  await expect.element(team).toBeVisible();
  await expect.element(team.getByText("claude-opus-5-5")).toBeVisible();
  await expect.element(team.getByText("Lead decides")).toBeVisible();
  await team.getByRole("button", { name: "Edit" }).click();
  await expect.element(page.getByRole("heading", { name: "Agent team" })).toBeVisible();
  await expect.element(page.getByRole("switch", { name: "Choose sub-agent models" })).toBeVisible();
});
