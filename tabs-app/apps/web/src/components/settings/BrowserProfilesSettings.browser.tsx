import "../../index.css";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { BrowserProfilesSettings } from "./BrowserProfilesSettings";

const mocks = vi.hoisted(() => ({ save: vi.fn(), toast: vi.fn() }));
vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => ({ browserProfiles: [], browserDefaultLinkTarget: "tabs" }),
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
vi.mock("../../hooks/useConfirm", () => ({
  useConfirm: () => ({ confirm: vi.fn(), confirmDialog: null }),
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: mocks.toast } }));

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
