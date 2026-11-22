import "../../index.css";

import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ModeAccessPicker } from "./ModeAccessPicker";

describe("ModeAccessPicker", () => {
  it("shows build or plan beside the access icon and opens a panel for both", async () => {
    const toggle = vi.fn();
    const change = vi.fn();
    await render(
      <ModeAccessPicker
        interactionMode="default"
        onToggleInteractionMode={toggle}
        runtimeMode="full-access"
        onRuntimeModeChange={change}
      />,
    );
    await expect
      .element(page.getByRole("button", { name: "Mode and access: builds, Full access" }))
      .toBeVisible();
    await page.getByRole("button", { name: /Mode and access/ }).click();
    await page.getByRole("radio", { name: "Plan" }).click();
    expect(toggle).toHaveBeenCalledTimes(1);
    await page.getByRole("radio", { name: /Supervised/ }).click();
    expect(change).toHaveBeenCalledWith("approval-required");
  });

  it("does not toggle when the chosen mode is already active", async () => {
    const toggle = vi.fn();
    await render(
      <ModeAccessPicker
        interactionMode="plan"
        onToggleInteractionMode={toggle}
        runtimeMode="auto"
        onRuntimeModeChange={vi.fn()}
      />,
    );
    await page.getByRole("button", { name: /Mode and access/ }).click();
    await page.getByRole("radio", { name: "Plan" }).click();
    expect(toggle).not.toHaveBeenCalled();
  });
});
