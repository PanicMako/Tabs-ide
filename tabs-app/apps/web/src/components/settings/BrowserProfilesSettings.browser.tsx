import "../../index.css";
import type { NativeApi } from "@tabs/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { BrowserProfilesSettings } from "./BrowserProfilesSettings";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  toast: vi.fn(),
  connection: vi.fn<NativeApi["preview"]["partnerCenterConnection"]>(),
}));
vi.mock("../../nativeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../nativeApi")>()),
  readNativeApi: () => ({ preview: { partnerCenterConnection: mocks.connection } }),
}));
vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => ({
    browserProfiles: [],
    browserDefaultLinkTarget: "tabs",
    browserDefaultZoomFactor: 1,
    browserDefaultProfileId: "default",
    browserRecordingFrameRate: 30,
    browserDefaultAppearance: "system",
    enableAgentBrowserAccess: true,
  }),
  useUpdateSettings: () => ({ updateSettings: mocks.save }),
}));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: (atom: string) =>
    atom === "projects" ? [] : { projectSettingsByProjectId: {}, projectTabs: [] },
}));
vi.mock("../../state/threads", () => ({ projectsAtom: "projects" }));
vi.mock("../../state/workspaceShell", () => ({
  workspaceShellAtom: "shell",
  workspaceShellActions: {},
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: mocks.toast } }));

beforeEach(() => {
  mocks.connection.mockReset().mockResolvedValue({ configured: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function enableDesktopBridge() {
  vi.stubGlobal("desktopBridge", {
    getWsUrl: () => "ws://127.0.0.1:4321/ws",
    setTheme: async () => {},
  });
}

const tenantId = "11111111-1111-1111-1111-111111111111";
const clientId = "22222222-2222-2222-2222-222222222222";

it("keeps profile creation compact, saves generated identifiers and preserves optional fields", async () => {
  mocks.save.mockClear();
  const view = await render(<BrowserProfilesSettings />);
  try {
    await page.getByRole("button", { name: "Create Profile", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New browser profile" });
    await expect.element(dialog).toBeVisible();
    const name = dialog.getByRole("textbox", { name: "Name", exact: true });
    await expect.element(name).toHaveFocus();
    await expect
      .element(dialog.element().querySelector<HTMLInputElement>("#browser-profile-id")!)
      .not.toBeVisible();
    await name.fill("Client Acme");
    const color = dialog.getByRole("button", { name: "Profile color #10b981" });
    await color.click();
    await expect.element(color).toHaveAttribute("aria-pressed", "true");
    await dialog.getByText("More options", { exact: true }).click();
    await expect
      .element(dialog.getByRole("textbox", { name: "Identifier", exact: true }))
      .toHaveValue("client-acme");
    await dialog.getByRole("textbox", { name: "Note (optional)" }).fill("Client tools");
    await dialog.getByRole("button", { name: "Create profile", exact: true }).click();
    expect(mocks.save).toHaveBeenCalledWith({
      browserProfiles: expect.arrayContaining([
        expect.objectContaining({
          id: "client-acme",
          label: "Client Acme",
          color: "#10b981",
          description: "Client tools",
        }),
      ]),
    });
    await expect.element(dialog).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Create Profile", exact: true }).click();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Create Profile", exact: true }))
      .toHaveFocus();
    expect(mocks.save).toHaveBeenCalledTimes(1);
  } finally {
    await view.unmount();
  }
});

it("shows the default zoom and page appearance for new browser tabs", async () => {
  const view = await render(<BrowserProfilesSettings />);
  try {
    await expect.element(page.getByText("New tabs open at")).toBeVisible();
    await expect.element(page.getByText("100%", { exact: true })).toBeVisible();
    await expect.element(page.getByText("New tabs use profile")).toBeVisible();
    await expect.element(page.getByText("Recording smoothness")).toBeVisible();
    await expect.element(page.getByText("Page appearance", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Follow the system", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("heading", { name: "Microsoft Partner Center" }))
      .not.toBeInTheDocument();
    expect(mocks.connection).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

it("hides Partner Center setup in a desktop window routed to another environment", async () => {
  enableDesktopBridge();
  const originalUrl = new URL(window.location.href);
  const remoteUrl = new URL(originalUrl);
  remoteUrl.searchParams.set("tabsWsUrl", "wss://remote.example.test/ws");
  remoteUrl.searchParams.set("tabsEnvironmentId", "remote");
  window.history.replaceState(window.history.state, "", remoteUrl);
  const view = await render(<BrowserProfilesSettings />);
  try {
    await expect
      .element(page.getByRole("heading", { name: "Microsoft Partner Center" }))
      .not.toBeInTheDocument();
    expect(mocks.connection).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    window.history.replaceState(window.history.state, "", originalUrl);
  }
});

it("saves Partner Center credentials and opens reconnect with a blank password field", async () => {
  enableDesktopBridge();
  mocks.connection
    .mockResolvedValueOnce({ configured: false })
    .mockResolvedValueOnce({ configured: true });
  const view = await render(<BrowserProfilesSettings />);
  try {
    await expect.element(page.getByText("Not configured", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    const secret = page.getByLabelText("Client secret", { exact: true });
    await expect.element(secret).toHaveAttribute("type", "password");
    await expect
      .element(page.getByRole("link", { name: "Microsoft setup instructions" }))
      .toBeVisible();
    await page.getByLabelText("Directory (tenant) ID").fill(tenantId);
    await page.getByLabelText("Application (client) ID").fill(clientId);
    await secret.fill("sample-client-secret");
    await page.getByRole("button", { name: "Save connection" }).click();

    await expect.element(page.getByText("Configured", { exact: true })).toBeVisible();
    expect(mocks.connection).toHaveBeenNthCalledWith(1, { action: "read" });
    expect(mocks.connection).toHaveBeenNthCalledWith(2, {
      action: "configure",
      connection: { tenantId, clientId, clientSecret: "sample-client-secret" },
    });
    await expect.element(secret).not.toBeInTheDocument();
    const reconnect = page.getByRole("button", { name: "Reconnect" });
    await expect.element(reconnect).toHaveFocus();
    await reconnect.click();
    await expect.element(secret).toHaveValue("");
    await secret.fill("cancelled-secret");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.element(reconnect).toHaveFocus();
    await reconnect.click();
    await expect.element(secret).toHaveValue("");
    expect(mocks.connection).toHaveBeenCalledTimes(2);
  } finally {
    await view.unmount();
  }
});

it("clears a rejected secret without displaying the API error", async () => {
  enableDesktopBridge();
  mocks.connection
    .mockResolvedValueOnce({ configured: true })
    .mockRejectedValueOnce(new Error("rejected-secret"));
  const view = await render(<BrowserProfilesSettings />);
  try {
    await page.getByRole("button", { name: "Reconnect" }).click();
    const save = page.getByRole("button", { name: "Save connection" });
    await save.click();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Enter valid Entra tenant and application IDs");
    expect(mocks.connection).toHaveBeenCalledTimes(1);
    await page.getByLabelText("Directory (tenant) ID").fill(tenantId);
    await page.getByLabelText("Application (client) ID").fill(clientId);
    const secret = page.getByLabelText("Client secret", { exact: true });
    await secret.fill("rejected-secret");
    await save.click();

    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Could not save the Partner Center connection.");
    await expect.element(secret).toHaveValue("");
    await expect.element(page.getByText("rejected-secret")).not.toBeInTheDocument();
    await expect.element(page.getByText("Configured", { exact: true })).toBeVisible();
  } finally {
    await view.unmount();
  }
});

it("disconnects Partner Center only after confirmation", async () => {
  enableDesktopBridge();
  mocks.connection.mockResolvedValueOnce({ configured: true });
  const view = await render(<BrowserProfilesSettings />);
  try {
    const disconnect = page.getByRole("button", { name: "Disconnect", exact: true });
    await disconnect.click();
    const confirmation = page.getByRole("alertdialog");
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    expect(mocks.connection).toHaveBeenCalledTimes(1);
    await disconnect.click();
    await confirmation.getByRole("button", { name: "Confirm" }).click();

    await expect.element(page.getByText("Not configured", { exact: true })).toBeVisible();
    expect(mocks.connection).toHaveBeenNthCalledWith(2, { action: "clear" });
  } finally {
    await view.unmount();
  }
});
