import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { DesktopUpdateState } from "@tabs/contracts";
import { AboutSettings } from "./AboutSettings";

vi.mock("../../env", () => ({ isElectron: true }));

test("retries a failed update check from About and shows the resulting update", async () => {
  const failedCheck: DesktopUpdateState = {
    enabled: true,
    status: "error",
    currentVersion: "2.2.2",
    hostArch: "arm64",
    appArch: "arm64",
    runningUnderArm64Translation: false,
    availableVersion: null,
    releaseNotes: null,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt: null,
    message: "GitHub returned HTTP 403 while checking for updates.",
    errorContext: "check",
    canRetry: true,
  };
  const retryUpdateCheck = vi.fn(
    async (): Promise<DesktopUpdateState> => ({
      ...failedCheck,
      status: "available",
      availableVersion: "2.3.0",
      message: null,
      errorContext: null,
      canRetry: false,
    }),
  );
  vi.stubGlobal("desktopBridge", {
    getCodeHostState: async () => null,
    getUpdateState: async () => failedCheck,
    onUpdateState: () => () => {},
    retryUpdateCheck,
    setTheme: async () => {},
  });
  try {
    const screen = await render(<AboutSettings />);
    const retry = screen.getByRole("button", { name: "Retry update check" });
    await expect.element(screen.getByRole("button", { name: "View releases" })).toBeVisible();
    (retry.element() as HTMLButtonElement).focus();
    await userEvent.keyboard("{Enter}");
    expect(retryUpdateCheck).toHaveBeenCalledTimes(1);
    await expect.element(screen.getByRole("button", { name: "Download update" })).toBeVisible();
  } finally {
    vi.unstubAllGlobals();
  }
});
