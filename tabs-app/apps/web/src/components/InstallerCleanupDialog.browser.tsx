import "../index.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { InstallerCleanupDialog } from "./InstallerCleanupDialog";

it("keeps installers on cancellation and remembers the choice", async () => {
  const original = window.desktopBridge;
  const name = `Tabs-keep-${crypto.randomUUID()}.dmg`;
  const trash = vi.fn(async () => undefined);
  window.desktopBridge = {
    getInstallerCleanupCandidate: async () => ({ name, size: 1e9 }),
    trashInstalledDmg: trash,
  } as unknown as NonNullable<Window["desktopBridge"]>;
  let view = await render(<InstallerCleanupDialog />);
  try {
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Keep installer" }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(trash).not.toHaveBeenCalled();
    await view.unmount();
    view = await render(<InstallerCleanupDialog />);
    expect(localStorage.getItem(`tabs:kept-installer:${name}`)).toBe("yes");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  } finally {
    await view.unmount();
    localStorage.removeItem(`tabs:kept-installer:${name}`);
    if (original) window.desktopBridge = original;
    else delete window.desktopBridge;
  }
});

it("announces verification failures and allows retry before closing", async () => {
  const original = window.desktopBridge;
  const trash = vi
    .fn()
    .mockRejectedValueOnce(new Error("Could not verify this installer."))
    .mockResolvedValueOnce(undefined);
  window.desktopBridge = {
    getInstallerCleanupCandidate: async () => ({ name: "Tabs-retry.dmg", size: 2e9 }),
    trashInstalledDmg: trash,
  } as unknown as NonNullable<Window["desktopBridge"]>;
  const view = await render(<InstallerCleanupDialog />);
  try {
    await page.getByRole("button", { name: "Move to Trash", exact: true }).click();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Could not verify this installer.");
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Move to Trash", exact: true }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(trash).toHaveBeenCalledTimes(2);
  } finally {
    await view.unmount();
    if (original) window.desktopBridge = original;
    else delete window.desktopBridge;
  }
});
