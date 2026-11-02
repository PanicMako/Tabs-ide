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
