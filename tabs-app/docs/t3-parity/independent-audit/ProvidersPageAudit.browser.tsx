import "../../index.css";
import { DEFAULT_UNIFIED_SETTINGS } from "@tabs/contracts";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import ProvidersSettings from "./ProvidersSettings";
const mocks = vi.hoisted(() => ({ settings: null as any, save: vi.fn(), action: vi.fn() }));
vi.mock("../../hooks/useSettings", async (original) => ({
  ...(await original<typeof import("../../hooks/useSettings")>()),
  useSettings: () => mocks.settings,
  useUpdateSettings: () => ({ updateSettings: mocks.save }),
}));
vi.mock("../../hooks/useTheme", () => ({ useTheme: () => ({ fontPreferences: {} }) }));
vi.mock("../../lib/themes", async (original) => ({
  ...(await original<typeof import("../../lib/themes")>()),
  getActiveFontCombo: () => ({}),
  getFontComboPageHeading: () => ({ className: "", fontFamily: "sans-serif" }),
}));
vi.mock("../../state/scopedStateStore", async () => {
  const { useState } = await import("react");
  return {
    useSettingsViewState: () => {
      const [state, setState] = useState({
        openProviderDetails: {},
        customModelInputByProvider: {},
        draftModelOrders: {},
      });
      return [
        state,
        (patch: any) =>
          setState((prev: any) => ({
            ...prev,
            ...(typeof patch === "function" ? patch(prev) : patch),
          })),
      ];
    },
  };
});
it("actual provider page switches detail and dispatches setup without executing it", async () => {
  mocks.settings = structuredClone(DEFAULT_UNIFIED_SETTINGS);
  mocks.save.mockReset();
  mocks.save.mockResolvedValue(true);
  mocks.action.mockReset();
  const providers: any[] = [
    {
      instanceId: "codex",
      enabled: true,
      installed: false,
      status: "error",
      auth: { status: "unauthenticated" },
      models: [],
      version: null,
      checkedAt: new Date().toISOString(),
    },
  ];
  const view = await render(
    <ProvidersSettings
      serverProviders={providers}
      refreshProviders={() => {}}
      isRefreshingProviders={false}
      startProviderAction={mocks.action}
      providerActionBusy={false}
    />,
  );
  try {
    await page.getByRole("button", { name: "Install Codex", exact: true }).click();
    expect(mocks.action).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codex",
        kind: "install",
        command: "npm install -g @openai/codex",
      }),
    );
    const binary = page.getByRole("textbox", { name: "Codex binary path", exact: true });
    await binary.fill("/audit/synthetic-codex");
    await page.getByRole("radio", { name: "Models", exact: true }).click();
    await expect.element(binary).not.toBeVisible();
    await page.getByRole("radio", { name: "Connection", exact: true }).click();
    await expect.element(binary).toHaveValue("/audit/synthetic-codex");
    await page.getByRole("button", { name: /Claude Checking provider status/ }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Claude binary path", exact: true }))
      .toBeVisible();
    expect(mocks.save).toHaveBeenCalledWith({
      providers: { codex: { binaryPath: "/audit/synthetic-codex" } },
    });
    expect(document.querySelectorAll(".provider-detail").length).toBe(1);
  } finally {
    await view.unmount();
  }
});
