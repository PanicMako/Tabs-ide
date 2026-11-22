import "../../index.css";
import type { ComputerUsePermissionStatus } from "@tabs/contracts";
import { useSyncExternalStore } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { shootAll } from "../session-search/uxShots";

let enabled = false;
const listeners = new Set<() => void>();
const setEnabled = (next: boolean) => {
  enabled = next;
  for (const listener of listeners) listener();
};
vi.mock("../../hooks/useSettings", () => ({
  useSettings: (select: (settings: { computerUseEnabled: boolean }) => unknown) =>
    select({
      computerUseEnabled: useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => enabled,
      ),
    }),
  useUpdateSettings: () => ({
    updateSettings: async (patch: { computerUseEnabled?: boolean }) => {
      if (patch.computerUseEnabled !== undefined) setEnabled(patch.computerUseEnabled);
    },
  }),
}));

let status: ComputerUsePermissionStatus = {
  platformSupported: true,
  accessibility: false,
  screenRecording: "denied",
};
const openExternal = vi.fn(async () => {});
vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({
    server: { computerUsePermissions: async () => status },
    shell: { openExternal },
  }),
}));

import { ComputerUseSettingsRow } from "./ComputerUseSettingsRow";

beforeEach(() => {
  enabled = false;
  openExternal.mockClear();
  status = { platformSupported: true, accessibility: false, screenRecording: "denied" };
});

it("guides setup and updates live when permissions are granted", async () => {
  const view = await render(
    <div className="mx-auto max-w-3xl p-8 text-foreground">
      <ComputerUseSettingsRow />
    </div>,
  );
  await shootAll("off", "computer-use");
  await page.getByRole("switch", { name: "Computer use" }).click();
  await expect.element(page.getByText("Let Tabs control apps")).toBeVisible();
  await expect.element(page.getByText(/Waiting for Accessibility/)).toBeVisible();
  await shootAll("setup", "computer-use");

  await page.getByRole("button", { name: "Open System Settings" }).first().click();
  expect(openExternal).toHaveBeenCalledWith(expect.stringContaining("Privacy_Accessibility"));

  // The person grants access in System Settings and returns: the window regains focus.
  status = { platformSupported: true, accessibility: true, screenRecording: "granted" };
  window.dispatchEvent(new Event("focus"));
  await expect.element(page.getByText(/Ready. Agents can use your computer/)).toBeVisible();
  await shootAll("ready", "computer-use");
  await view.unmount();
});

it("explains non-macOS platforms", async () => {
  status = { platformSupported: false, accessibility: false, screenRecording: "unknown" };
  enabled = true;
  const view = await render(<ComputerUseSettingsRow />);
  await expect.element(page.getByText(/only needed on macOS/)).toBeVisible();
  await view.unmount();
});
