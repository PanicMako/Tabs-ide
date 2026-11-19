import "../../index.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { NewWorkSettings } from "./NewWorkSettings";
import { SnapShotSettings } from "./SnapShotSettings";
import { SourceControlFlowSettings } from "./SourceControlFlowSettings";
import { SourceControlWritingSettings } from "./SourceControlWritingSettings";
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

it("lists how commits and pull requests are written", async () => {
  const view = await render(<SourceControlWritingSettings />);
  try {
    for (const title of ["Writing style", "Follow pull request templates", "Writer model"]) {
      await expect.element(page.getByText(title, { exact: true })).toBeVisible();
    }
    await expect.element(page.getByText("Match the repository", { exact: true })).toBeVisible();
  } finally {
    await view.unmount();
  }
});

it("lets you choose what new threads can do and where projects are added from", async () => {
  const view = await render(<NewWorkSettings />);
  try {
    await expect.element(page.getByText("New threads can", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Add projects from", { exact: true })).toBeVisible();
    await expect.element(page.getByLabelText("Folder the project picker opens in")).toBeVisible();
  } finally {
    await view.unmount();
  }
});

it("offers a flash and a sound for screenshots", async () => {
  const view = await render(<SnapShotSettings />);
  try {
    await expect.element(page.getByText("Flash on capture", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Play a sound", { exact: true })).toBeVisible();
    // The sound is on by default, so the choice of sound shows.
    await expect.element(page.getByText("Soft pop", { exact: true })).toBeVisible();
  } finally {
    await view.unmount();
  }
});
