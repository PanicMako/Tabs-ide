import "../index.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useConfirm } from "../hooks/useConfirm";
import { useState } from "react";
import { KeepWorkspaceToolDialog, WorkspaceToolActions } from "./WorkspaceToolActions";
it("provides distinct close and keep controls and a custom naming dialog", async () => {
  const keep = vi.fn(),
    close = vi.fn();
  const tool = { id: "temp", label: "Terminal", temporary: true, closable: true };
  function Fixture() {
    const [open, setOpen] = useState(false);
    const { confirm, confirmDialog } = useConfirm();
    return (
      <>
        <WorkspaceToolActions
          tool={tool}
          onClose={(id) => {
            void confirm("Close Terminal? Running commands will stop.").then((accepted) => {
              if (accepted) close(id);
            });
          }}
          onKeep={() => setOpen(true)}
        />
        {confirmDialog}
        <KeepWorkspaceToolDialog
          tool={open ? tool : null}
          onClose={() => setOpen(false)}
          onKeep={(id, label) => {
            keep(id, label);
            setOpen(false);
          }}
        />
      </>
    );
  }
  const view = await render(<Fixture />);
  expect(document.querySelector('[data-slot="workspace-tool-actions"]')!.textContent?.trim()).toBe(
    "",
  );
  await page.getByRole("button", { name: "Keep Terminal in workspace" }).click();
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("textbox", { name: "Tool name" }).fill("Project shell");
  await page.getByRole("button", { name: "Keep tool", exact: true }).click();
  expect(keep).toHaveBeenCalledWith("temp", "Project shell");
  await page.getByRole("button", { name: "Close Terminal", exact: true }).click();
  expect(close).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(close).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Close Terminal", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  expect(close).toHaveBeenCalledWith("temp");
  await view.unmount();
});

it("removes inline close and keep controls after saving a renamed tool", async () => {
  const close = vi.fn();
  function Fixture() {
    const [tool, setTool] = useState({
      id: "scratch-browser-google",
      label: "Scratch browser",
      temporary: true,
      closable: true,
    });
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button">{tool.label}</button>
        <WorkspaceToolActions tool={tool} onClose={close} onKeep={() => setOpen(true)} />
        <KeepWorkspaceToolDialog
          tool={open ? tool : null}
          onClose={() => setOpen(false)}
          onKeep={(_id, label) => {
            setTool((current) => ({ ...current, label, temporary: false }));
            setOpen(false);
          }}
        />
      </>
    );
  }
  const view = await render(<Fixture />);
  try {
    await expect
      .element(view.getByRole("button", { name: "Close Scratch browser", exact: true }))
      .toBeVisible();
    await view.getByRole("button", { name: "Keep Scratch browser in workspace" }).click();
    await page.getByRole("textbox", { name: "Tool name" }).fill("Google");
    await page.getByRole("button", { name: "Keep tool", exact: true }).click();
    await expect.element(view.getByRole("button", { name: "Google", exact: true })).toBeVisible();
    await expect
      .element(view.getByRole("button", { name: "Close Google", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(view.getByRole("button", { name: "Keep Google in workspace" }))
      .not.toBeInTheDocument();
    expect(view.container.querySelector('[data-slot="workspace-tool-actions"]')).toBeNull();
    expect(close).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

it("does not offer inline close controls for an already saved tool", async () => {
  const view = await render(
    <WorkspaceToolActions tool={{ id: "saved-google", label: "Google", closable: true }} />,
  );
  try {
    expect(view.container.querySelector("button")).toBeNull();
  } finally {
    await view.unmount();
  }
});
