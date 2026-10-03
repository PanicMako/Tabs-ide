import "../index.css";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { DesktopUpdateState } from "@tabs/contracts";

import { DesktopUpdateReleaseNotes } from "./DesktopUpdateReleaseNotes";

const availableUpdate: DesktopUpdateState = {
  enabled: true,
  status: "available",
  currentVersion: "1.3.12",
  hostArch: "arm64",
  appArch: "arm64",
  runningUnderArm64Translation: false,
  availableVersion: "1.4.0",
  releaseNotes:
    "## What changed\n\n- **Faster startup**\n- [Full details](https://example.com)\n- [Unsafe link](javascript:alert(1))",
  downloadedVersion: null,
  downloadPercent: null,
  checkedAt: "2026-09-21T12:00:00.000Z",
  message: null,
  errorContext: null,
  canRetry: false,
};

test("opens formatted release notes and restores focus when dismissed", async () => {
  const screen = await render(<DesktopUpdateReleaseNotes state={availableUpdate} />);
  const trigger = screen.getByRole("button", { name: "What's new in Tabs 1.4.0" });

  await expect.element(trigger).toBeVisible();
  await trigger.click();
  await expect.element(page.getByText("What’s new in Tabs 1.4.0")).toBeVisible();
  await expect.element(page.getByText("Faster startup")).toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "Full details" }))
    .toHaveAttribute("href", "https://example.com");
  await expect.element(page.getByText("Unsafe link")).toBeVisible();
  await expect.element(page.getByRole("link", { name: "Unsafe link" })).not.toBeInTheDocument();

  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByText("Faster startup")).not.toBeInTheDocument();
  await expect.element(trigger).toHaveFocus();
});

test("does not show a changelog action when update metadata has no notes", async () => {
  const screen = await render(
    <DesktopUpdateReleaseNotes state={{ ...availableUpdate, releaseNotes: null }} />,
  );

  await expect
    .element(screen.getByRole("button", { name: "What's new in Tabs 1.4.0" }))
    .not.toBeInTheDocument();
});

test("dismisses release notes modal via X, backdrop, and Done button", async () => {
  const screen = await render(<DesktopUpdateReleaseNotes state={availableUpdate} />);
  const trigger = screen.getByRole("button", { name: "What's new in Tabs 1.4.0" });

  await trigger.click();
  const closeButton = page.getByRole("button", { name: "Close what’s new" });
  await expect.element(closeButton).toBeVisible();
  await userEvent.click(closeButton);
  await expect.element(page.getByText("What’s new in Tabs 1.4.0")).not.toBeInTheDocument();

  await trigger.click();
  const viewport = document.querySelector('[data-slot="dialog-viewport"]');
  if (!viewport) throw new Error("Release notes viewport is missing");
  await page.elementLocator(viewport).click({ position: { x: 4, y: 4 } });
  await expect.element(page.getByText("What’s new in Tabs 1.4.0")).not.toBeInTheDocument();

  await trigger.click();
  const doneButton = page.getByRole("button", { name: "Done" });
  await expect.element(doneButton).toBeVisible();
  await userEvent.click(doneButton);
  await expect.element(page.getByText("What’s new in Tabs 1.4.0")).not.toBeInTheDocument();
});
