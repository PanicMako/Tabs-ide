import "../../index.css";
import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { DesktopBridge } from "@tabs/contracts";
import DataRecoveryScreen from "./DataRecoveryScreen";
import DataRecoverySettings from "./DataRecoverySettings";

const originalBridge = window.desktopBridge;
afterEach(() => {
  if (originalBridge) window.desktopBridge = originalBridge;
  else delete window.desktopBridge;
});
const current = {
  id: "snapshot-current",
  version: "2.0.0",
  createdAt: "2026-10-29T10:00:00Z",
  reason: "before-version-change",
  bytes: 2_000_000,
};
const older = { ...current, id: "snapshot-older", version: "1.0.0", reason: "daily" };
function bridge() {
  const restart = vi.fn(async () => true);
  const remove = vi.fn(async () => undefined);
  window.desktopBridge = {
    listDataBackups: vi.fn(async () => ({
      version: "2.0.0",
      directory: "/local/tabs/backups",
      notice: null,
      backups: [current, older],
    })),
    restartForDataBackup: restart,
    deleteDataBackup: remove,
    openDataBackupFolder: vi.fn(async () => undefined),
    setTheme: vi.fn(async () => undefined),
  } as unknown as DesktopBridge;
  return { restart, remove };
}

test("shows version compatibility and confirms restoration in a high-layer startup recovery panel", async () => {
  await page.viewport(1200, 850);
  const { restart } = bridge();
  const view = await render(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        transform: "translateY(0)",
        background: "var(--background)",
        color: "var(--foreground)",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 640, maxHeight: "90vh", overflowY: "auto", margin: "auto" }}>
        <DataRecoverySettings />
      </div>
    </div>,
  );
  try {
    await expect.element(view.getByRole("button", { name: `Prepare ${older.id}` })).toBeEnabled();
    const restore = view.getByRole("button", { name: `Restore ${current.id}` });
    await restore.click();
    await expect.element(page.getByRole("alertdialog")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(restart).not.toHaveBeenCalled();
    await expect.poll(() => document.activeElement).toBe(restore.element());
    await restore.click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => restart.mock.calls).toEqual([[current.id]]);
  } finally {
    await view.unmount();
  }
});

test("requires confirmation before deleting a snapshot and reports failures", async () => {
  const { remove } = bridge();
  remove.mockRejectedValueOnce(new Error("Snapshot could not be removed."));
  const view = await render(<DataRecoverySettings />);
  try {
    await view.getByRole("button", { name: `Delete ${current.id}` }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(remove).not.toHaveBeenCalled();
    await view.getByRole("button", { name: `Delete ${current.id}` }).click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect
      .element(view.getByRole("alert"))
      .toHaveTextContent("Snapshot could not be removed.");
    expect(remove).toHaveBeenCalledWith(current.id);
  } finally {
    await view.unmount();
  }
});

test("fits the recovery controls on a narrow screen", async () => {
  await page.viewport(390, 844);
  bridge();
  const view = await render(
    <div style={{ padding: 16, background: "var(--background)", color: "var(--foreground)" }}>
      <DataRecoverySettings />
    </div>,
  );
  try {
    await expect.element(view.getByRole("button", { name: `Restore ${current.id}` })).toBeVisible();
    const bounds = view.container.getBoundingClientRect();
    expect(view.container.scrollWidth).toBeLessThanOrEqual(Math.ceil(bounds.width));
    await page.screenshot({ element: view.container, path: "__screenshots__/recovery/narrow.png" });
  } finally {
    await view.unmount();
  }
});

test("offers recovery without a router, authentication shell or working backend", async () => {
  await page.viewport(1100, 780);
  const { restart } = bridge();
  const view = await render(
    <DataRecoveryScreen error="Startup paused to protect your saved data." />,
  );
  try {
    await expect
      .element(view.getByRole("heading", { name: "Recover your Tabs workspace" }))
      .toBeVisible();
    await expect
      .element(view.getByRole("alert"))
      .toHaveTextContent("Startup paused to protect your saved data.");
    await view.getByRole("button", { name: "Restart & back up" }).click();
    expect(restart).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => restart.mock.calls).toEqual([[]]);
  } finally {
    await view.unmount();
  }
});

test("prepares a different version offline with explicit quit and target-version instructions", async () => {
  const { restart } = bridge();
  const view = await render(<DataRecoverySettings />);
  try {
    await view.getByRole("button", { name: `Prepare ${older.id}` }).click();
    await expect
      .element(page.getByRole("alertdialog"))
      .toHaveTextContent("install or open Tabs 1.0.0");
    expect(restart).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => restart.mock.calls).toEqual([[older.id, true]]);
  } finally {
    await view.unmount();
  }
});
