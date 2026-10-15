// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../frontend/src/scripts/api", () => ({ request: api.request }));
const data = {
  members: [{ user_id: "2", login: "friend", role: "contributor" }],
  invitations: [{ id: "3", login: "invitee", role: "contributor", expires_at: "later" }],
};
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent === text,
  )!;
const refresh = () => button("Refresh maker members");
const status = () => document.querySelector('[role="status"]')!;
beforeEach(() => {
  vi.resetModules();
  api.request.mockReset();
  document.body.innerHTML =
    '<div id="account-content"></div><a href="#other" id="other">Other navigation</a>';
  api.request
    .mockResolvedValueOnce({ login: "owner" })
    .mockResolvedValueOnce({ namespaces: [{ name: "maker", role: "owner" }] })
    .mockResolvedValueOnce(data);
});
afterEach(() => vi.restoreAllMocks());
async function start() {
  await import("../frontend/src/scripts/members");
  await vi.waitFor(() => expect(status().textContent).toBe("1 current member."));
}
function submit(kind: "remove" | "revoke") {
  const control = button(
    kind === "remove" ? "Remove friend from maker" : "Revoke invitation to invitee",
  );
  const form = control.closest("form")!;
  const reason = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    'input:not([type="checkbox"]), textarea',
  )!;
  reason.value = "Acceptance reason";
  const checkbox = form.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (checkbox) checkbox.checked = true;
  control.focus();
  form.dispatchEvent(new Event("submit", { cancelable: true }));
}
it.each(["remove", "revoke"] as const)(
  "clears stale controls when a recorded %s cannot reconcile",
  async (kind) => {
    await start();
    api.request.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Refresh failed"));
    submit(kind);
    await vi.waitFor(() => expect(status().textContent).toContain("The action was recorded"));
    expect(document.querySelectorAll("form")).toHaveLength(0);
    expect(document.activeElement).toBe(refresh());
    expect(refresh().disabled).toBe(false);
  },
);
it("locks both workflows and refresh while a decision is pending", async () => {
  await start();
  let finish!: () => void;
  api.request
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ members: [], invitations: [] });
  submit("remove");
  submit("revoke");
  refresh().dispatchEvent(new Event("click"));
  expect(api.request).toHaveBeenCalledTimes(4);
  expect(api.request).toHaveBeenLastCalledWith("/v1/namespaces/maker/members/2", "DELETE", {
    reason: "Acceptance reason",
  });
  expect(
    [...document.querySelectorAll<HTMLInputElement>("input, textarea, button")].every(
      (entry) => entry.disabled,
    ),
  ).toBe(true);
  finish();
  await vi.waitFor(() => expect(status().textContent).toContain("friend removed"));
});
it("clears uncertain decisions and recovers only through a fresh list", async () => {
  await start();
  api.request.mockRejectedValueOnce(new Error("Connection interrupted"));
  submit("revoke");
  await vi.waitFor(() => expect(status().textContent).toContain("may already have been recorded"));
  expect(document.querySelectorAll("form")).toHaveLength(0);
  api.request.mockResolvedValueOnce(data);
  refresh().click();
  await vi.waitFor(() => expect(document.querySelectorAll("form")).toHaveLength(2));
});
it("requires acknowledgement and reason for removal", async () => {
  await start();
  button("Remove friend from maker")
    .closest("form")!
    .dispatchEvent(new Event("submit", { cancelable: true }));
  expect(api.request).toHaveBeenCalledTimes(3);
});
it("preserves navigation focus after a late mutation", async () => {
  await start();
  let finish!: () => void;
  api.request
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ members: [], invitations: [] });
  submit("remove");
  document.getElementById("other")!.focus();
  finish();
  await vi.waitFor(() => expect(status().textContent).toContain("friend removed"));
  expect(document.activeElement?.id).toBe("other");
});

it.each(["remove", "revoke"] as const)(
  "cancels the expanded %s form without a mutation and restores focus",
  async (kind) => {
    await start();
    const control = button(
      kind === "remove" ? "Remove friend from maker" : "Revoke invitation to invitee",
    );
    const form = control.closest("form")!;
    const details = form.closest("details")!;
    details.open = true;
    const reason = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      'input:not([type="checkbox"]), textarea',
    )!;
    reason.value = "Unsaved reason";
    reason.focus();
    if (kind === "remove") button("Keep unchanged").click();
    else reason.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(details.open).toBe(false);
    expect(reason.value).toBe("");
    expect(document.activeElement).toBe(details.querySelector("summary"));
    expect(api.request).toHaveBeenCalledTimes(3);
  },
);

it("explains why a sole owner has no removal control", async () => {
  api.request
    .mockReset()
    .mockResolvedValueOnce({ login: "owner" })
    .mockResolvedValueOnce({ namespaces: [{ name: "maker", role: "owner" }] })
    .mockResolvedValueOnce({
      members: [{ user_id: "1", login: "owner", role: "owner" }],
      invitations: [],
    });
  await start();
  expect(document.querySelector(".member-protected")?.textContent).toBe("Last owner");
  expect(document.querySelector("form")).toBeNull();
});
