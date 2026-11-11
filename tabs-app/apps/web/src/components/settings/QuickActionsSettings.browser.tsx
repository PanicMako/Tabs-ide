import "../../index.css";
import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts/settings";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import QuickActionsSettings from "./QuickActionsSettings";

const updateSettings = vi.fn();
const quickActions = {
  enabled: true,
  design: "compass",
  actionOrder: [],
  hiddenActions: [],
  pointerGesture: false,
};
vi.mock("~/hooks/useSettings", () => ({
  useSettings: (select?: (settings: unknown) => unknown) => {
    const settings = { ...DEFAULT_UNIFIED_SETTINGS, quickActions };
    return select ? select(settings) : settings;
  },
  useUpdateSettings: () => ({ updateSettings }),
}));
vi.mock("~/state/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/state/settings")>()),
  useKeybindings: () => [],
}));

it("picks a launcher in one click, with the real thing on a stage", async () => {
  await page.viewport(1200, 1500);
  const view = await render(
    <div style={{ width: 1100, padding: 24 }}>
      <QuickActionsSettings />
    </div>,
  );
  try {
    await expect
      .element(page.getByRole("button", { name: "Design: Orbit", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".qa-studio-stage .qa-radial-surface")).not.toBeNull();
    expect(document.querySelectorAll(".qa-arr-slot")).toHaveLength(8);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({
      element: view.container,
      path: "__screenshots__/quick-actions/settings-page.png",
    });
    await page.getByRole("button", { name: "Design: Pie", exact: true }).click();
    expect(updateSettings).toHaveBeenCalledWith({
      quickActions: expect.objectContaining({ design: "sectors" }),
    });
  } finally {
    await view.unmount();
  }
});
