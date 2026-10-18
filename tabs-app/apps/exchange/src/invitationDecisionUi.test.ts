// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../frontend/src/scripts/api", async (original) => ({
  ...(await original<typeof import("../frontend/src/scripts/api")>()),
  request: api.request,
}));
const invitation = {
  id: "1",
  namespace: "maker",
  role: "contributor",
  inviter_login: "owner",
  expires_at: "later",
};
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
const button = (text: string) => buttons().find((entry) => entry.textContent === text)!;
const status = () => document.querySelector('[role="status"]')!;
beforeEach(() => {
  vi.resetModules();
  api.request.mockReset();
  document.body.innerHTML =
    '<div id="account-content"></div><a href="#outside" id="outside">Other navigation</a>';
  api.request
    .mockResolvedValueOnce({ publishingEnabled: true, termsVersion: "test" })
    .mockResolvedValueOnce({ invitations: [invitation] });
});
afterEach(() => vi.restoreAllMocks());
async function start() {
  await import("../frontend/src/scripts/invitations");
  await vi.waitFor(() => expect(status().textContent).toContain("Showing 1 pending"));
}
function agree() {
  const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
}
it("does not accept without explicit agreement", async () => {
  await start();
  button("Accept invitation").dispatchEvent(new Event("click"));
  expect(api.request).toHaveBeenCalledTimes(2);
});
it("serializes decisions with list refresh and restores keyboard focus", async () => {
  await start();
  agree();
  let finish!: () => void;
  api.request
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ invitations: [] });
  button("Accept invitation").focus();
  button("Accept invitation").click();
  button("Decline invitation").dispatchEvent(new Event("click"));
  button("Refresh invitations").dispatchEvent(new Event("click"));
  expect(api.request).toHaveBeenCalledTimes(3);
  expect(button("Refresh invitations").disabled).toBe(true);
  finish();
  await vi.waitFor(() => expect(status().textContent).toContain("Invitation accepted"));
  expect(document.activeElement).toBe(button("Refresh invitations"));
});
it.each([true, false])(
  "requires fresh invitations after uncertain recovery (recorded=%s)",
  async (recorded) => {
    await start();
    if (recorded) api.request.mockResolvedValueOnce({});
    api.request.mockRejectedValueOnce(new Error("Connection lost"));
    button("Decline invitation").click();
    await vi.waitFor(() =>
      expect(status().textContent).toContain("Refresh invitations before another decision"),
    );
    expect(buttons().some((entry) => entry.textContent === "Decline invitation")).toBe(false);
    expect(button("Refresh invitations").disabled).toBe(false);
    api.request.mockResolvedValueOnce({ invitations: [invitation] });
    button("Refresh invitations").click();
    await vi.waitFor(() => expect(status().textContent).toContain("Showing 1 pending"));
  },
);
it("does not steal focus from navigation on late decision completion", async () => {
  await start();
  let finish!: () => void;
  api.request
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ invitations: [] });
  button("Decline invitation").focus();
  button("Decline invitation").click();
  document.getElementById("outside")!.focus();
  finish();
  await vi.waitFor(() => expect(status().textContent).toBe("Invitation declined."));
  expect(document.activeElement?.id).toBe("outside");
});
