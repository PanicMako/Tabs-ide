import "../../index.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { SourceControlFlowSettings } from "./SourceControlFlowSettings";
import { ThreadFlowSettings } from "./ThreadFlowSettings";

it("lists what threads do on their own", async () => {
  const view = await render(<ThreadFlowSettings />);
  try {
    for (const title of [
      "Resume after a usage limit",
      "Snooze until the limit resets",
      "Carry on after Tabs updates",
      "Mark done when merged",
      "Mark done when quiet",
    ]) {
      await expect.element(page.getByText(title, { exact: true })).toBeVisible();
    }
  } finally {
    await view.unmount();
  }
});

it("lists how branches stay current and how pull requests merge", async () => {
  const view = await render(<SourceControlFlowSettings />);
  try {
    for (const title of [
      "Pull automatically",
      "Check for new commits",
      "Merge pull requests with",
      "Leave out agent credits",
    ]) {
      await expect.element(page.getByText(title, { exact: true })).toBeVisible();
    }
    await expect.element(page.getByText("Ask each time", { exact: true })).toBeVisible();
  } finally {
    await view.unmount();
  }
});
