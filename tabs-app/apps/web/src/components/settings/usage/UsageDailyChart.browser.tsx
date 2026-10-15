import "../../../index.css";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { UsageDailyChart } from "./UsageDailyChart";
import type { DailyTotals } from "@tabs/shared/usageMerge";
const daily: DailyTotals[] = [
  {
    day: "2026-10-14",
    costUsd: 15,
    totalTokens: 300,
    byProvider: new Map([
      ["codex", { costUsd: 10, totalTokens: 200 }],
      ["antigravity", { costUsd: 5, totalTokens: 100 }],
    ]),
  },
];
test("keeps only the two view controls and renders every provider including Codex", async () => {
  const screen = await render(<UsageDailyChart days={[]} daily={daily} />);
  await screen.getByRole("radio", { name: "By provider", exact: true }).click();
  expect(document.querySelectorAll("path[data-provider]")).toHaveLength(2);
  expect(document.querySelector('path[data-provider="codex"]')?.getAttribute("stroke")).toBe(
    "var(--foreground)",
  );
  await expect
    .element(screen.getByRole("button", { name: "Show all providers" }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Codex", exact: true }))
    .not.toBeInTheDocument();
  await screen.getByRole("radio", { name: "Combined", exact: true }).click();
  expect(document.querySelectorAll("path[data-provider]")).toHaveLength(0);
});

test("keeps the provider tooltip inside the plot and marks each individual line", async () => {
  const screen = await render(<UsageDailyChart days={[]} daily={daily} />);
  await screen.getByRole("radio", { name: "By provider", exact: true }).click();
  const svg = document.querySelector('svg[role="img"]')!;
  const plot = svg.parentElement!;
  const bounds = plot.getBoundingClientRect();
  svg.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      clientX: bounds.right - 2,
      clientY: bounds.bottom - 2,
    }),
  );
  await expect.element(screen.getByText("By Provider", { exact: true })).toBeVisible();
  const tooltip = screen.getByText("By Provider", { exact: true }).element()
    .parentElement!.parentElement!;
  const tooltipBounds = tooltip.getBoundingClientRect();
  expect(tooltipBounds.right).toBeLessThanOrEqual(bounds.right + 1);
  expect(tooltipBounds.bottom).toBeLessThanOrEqual(bounds.bottom + 1);
  expect(svg.querySelectorAll("circle")).toHaveLength(2);
});
